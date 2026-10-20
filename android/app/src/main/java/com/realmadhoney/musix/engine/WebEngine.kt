package com.realmadhoney.musix.engine

import android.annotation.SuppressLint
import android.content.Context
import android.content.MutableContextWrapper
import android.graphics.Color
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.util.Log
import android.view.ViewGroup
import android.webkit.CookieManager
import android.webkit.JavascriptInterface
import android.webkit.WebStorage
import android.webkit.WebView
import android.widget.FrameLayout
import androidx.core.net.toUri
import androidx.webkit.ScriptHandler
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import com.realmadhoney.musix.core.bridge.BridgeCodec
import com.realmadhoney.musix.core.bridge.BridgeCommand
import com.realmadhoney.musix.core.bridge.BridgeEvent
import com.realmadhoney.musix.core.bridge.BridgeState
import com.realmadhoney.musix.core.bridge.BridgeTransport
import com.realmadhoney.musix.core.bridge.CommandQueue
import com.realmadhoney.musix.core.bridge.CommandResult
import com.realmadhoney.musix.core.bridge.DecodeResult
import com.realmadhoney.musix.core.bridge.QueueEntry
import com.realmadhoney.musix.core.resume.ResumeSnapshot
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.serialization.builtins.serializer
import java.lang.ref.WeakReference
import kotlin.coroutines.resume

sealed interface EngineStatus {
    data object Starting : EngineStatus

    data object Loading : EngineStatus

    data object Ready : EngineStatus

    data class Recovering(
        val attempt: Int,
    ) : EngineStatus

    data class Offline(
        val message: String,
    ) : EngineStatus

    data class Failed(
        val message: String,
    ) : EngineStatus
}

sealed interface AccountState {
    data object Unknown : AccountState

    data class SignedIn(
        val avatarUrl: String,
    ) : AccountState

    data object SignedOut : AccountState
}

data class EngineError(
    val message: String,
)

class WebEngine(
    private val appContext: Context,
    private val config: EngineConfig,
    private val blocker: AdBlocker,
    private val scripts: InjectedScripts,
    private val adSkip: suspend () -> Boolean,
    private val scope: CoroutineScope,
    private val clock: () -> Long = { SystemClock.elapsedRealtime() },
) {
    private val wrapper = MutableContextWrapper(appContext)
    private val mainHandler = Handler(Looper.getMainLooper())
    private var webView: WebView? = null
    private var host: WeakReference<FrameLayout>? = null
    private var scriptHandlers: List<ScriptHandler> = emptyList()
    private var fallbackInjection = false
    private var recoveryJob: Job? = null
    private var restoreJob: Job? = null
    private var crashTimes = ArrayDeque<Long>()
    private var pendingRestore: Pair<ResumeSnapshot, Boolean>? = null
    private var released = false
    private var nativeAgent = ""
    private var pageAgent = ""

    val queue = CommandQueue(BridgeTransport { deliver(it) })

    private val bridgeStateFlow = MutableStateFlow(BridgeState.EMPTY)
    val bridgeState: StateFlow<BridgeState> = bridgeStateFlow.asStateFlow()

    private val queueFlow = MutableStateFlow<List<QueueEntry>>(emptyList())
    val queueEntries: StateFlow<List<QueueEntry>> = queueFlow.asStateFlow()

    private val statusFlow = MutableStateFlow<EngineStatus>(EngineStatus.Starting)
    val status: StateFlow<EngineStatus> = statusFlow.asStateFlow()

    private val accountFlow = MutableStateFlow<AccountState>(AccountState.Unknown)
    val account: StateFlow<AccountState> = accountFlow.asStateFlow()

    private val errorFlow = MutableSharedFlow<EngineError>(extraBufferCapacity = 16)
    val errors: SharedFlow<EngineError> = errorFlow.asSharedFlow()

    private val externalLinkFlow = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val externalLinks: SharedFlow<String> = externalLinkFlow.asSharedFlow()

    val blockedRequests: Long get() = blocker.blockedCount

    val currentUrl: String? get() = webView?.url

    fun start() {
        checkMain()
        if (released || webView != null) {
            return
        }
        createView()
        load(config.homeUrl)
    }

    fun reload() {
        checkMain()
        if (released) {
            return
        }
        recoveryJob?.cancel()
        val view = webView
        if (view == null) {
            createView()
            load(config.homeUrl)
        } else {
            load(view.url?.takeIf { config.isAllowedOrigin(it) } ?: config.homeUrl)
        }
    }

    fun openSignIn() {
        checkMain()
        if (webView == null) {
            start()
        }
        load(config.signInUrl)
    }

    fun openHome() {
        checkMain()
        load(config.homeUrl)
    }

    fun canGoBack(): Boolean = webView?.canGoBack() ?: false

    fun goBack() {
        webView?.goBack()
    }

    fun attachTo(container: FrameLayout) {
        checkMain()
        val view = webView ?: return
        if (view.parent === container) {
            return
        }
        (view.parent as? ViewGroup)?.removeView(view)
        wrapper.baseContext = container.context
        container.addView(view, FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))
        host = WeakReference(container)
    }

    fun detachFrom(container: FrameLayout) {
        checkMain()
        val view = webView
        if (view != null && view.parent === container) {
            container.removeView(view)
        }
        if (host?.get() === container) {
            host = null
            wrapper.baseContext = appContext
        }
    }

    suspend fun signOut() {
        withContext(Dispatchers.Main.immediate) {
            queue.markNotReady()
            suspendCancellableCoroutine { continuation ->
                CookieManager.getInstance().removeAllCookies { continuation.resume(Unit) }
            }
            CookieManager.getInstance().flush()
            WebStorage.getInstance().deleteAllData()
            webView?.clearCache(true)
            accountFlow.value = AccountState.SignedOut
            bridgeStateFlow.value = BridgeState.EMPTY
            queueFlow.value = emptyList()
            load(config.homeUrl)
        }
    }

    fun release() {
        checkMain()
        released = true
        recoveryJob?.cancel()
        restoreJob?.cancel()
        queue.markNotReady()
        destroyView()
    }

    suspend fun restore(
        snapshot: ResumeSnapshot,
        play: Boolean,
    ): CommandResult {
        val started =
            queue.player { BridgeCommand.PlayVideoId(it, snapshot.videoId, snapshot.playlistId) }
        if (started != CommandResult.Acknowledged) {
            return started
        }
        val arrived = withTimeoutOrNull(RESTORE_TIMEOUT_MS) { bridgeState.first { it.videoId == snapshot.videoId && !it.isAd } }
        if (arrived == null) {
            return CommandResult.TimedOut
        }
        if (snapshot.positionSec > 1.0) {
            val seek = queue.player { BridgeCommand.SeekTo(it, snapshot.positionSec) }
            if (seek != CommandResult.Acknowledged) {
                return seek
            }
        }
        return if (play) CommandResult.Acknowledged else queue.player { BridgeCommand.Pause(it) }
    }

    internal fun onPageStarted(url: String?) {
        if (!config.isAllowedOrigin(url)) {
            queue.markNotReady()
            statusFlow.value = EngineStatus.Loading
            return
        }
        queue.markNotReady()
        if (statusFlow.value !is EngineStatus.Recovering) {
            statusFlow.value = EngineStatus.Loading
        }
        if (fallbackInjection) {
            webView?.evaluateJavascript(fallbackBundle(), null)
        }
    }

    internal fun onMainFrameError(
        offline: Boolean,
        description: String,
    ) {
        queue.markNotReady()
        statusFlow.value =
            if (offline) {
                EngineStatus.Offline("You're offline. Musix will reconnect when the network is back.")
            } else {
                EngineStatus.Failed("YouTube Music could not be loaded: $description")
            }
    }

    internal fun onRendererGone(crashed: Boolean) {
        Log.w(TAG, "Renderer process gone, crashed=$crashed")
        val state = bridgeStateFlow.value
        val snapshot = ResumeSnapshot.from(state, System.currentTimeMillis())
        if (snapshot != null) {
            pendingRestore = snapshot to state.isPlaying
        }
        queue.markNotReady()
        bridgeStateFlow.value = state.copy(isPlaying = false, isBuffering = false)
        val parent = host?.get()
        destroyView()
        val now = clock()
        crashTimes.addLast(now)
        while (crashTimes.isNotEmpty() && now - crashTimes.first() > CRASH_WINDOW_MS) {
            crashTimes.removeFirst()
        }
        if (crashTimes.size > MAX_CRASHES) {
            statusFlow.value = EngineStatus.Failed("The YouTube Music page keeps stopping. Tap retry to start it again.")
            crashTimes.clear()
            return
        }
        val attempt = crashTimes.size
        statusFlow.value = EngineStatus.Recovering(attempt)
        recoveryJob?.cancel()
        recoveryJob =
            scope.launch {
                delay(minOf(MAX_BACKOFF_MS, BASE_BACKOFF_MS shl (attempt - 1)))
                if (released) {
                    return@launch
                }
                createView()
                if (parent != null) {
                    attachTo(parent)
                }
                load(config.homeUrl)
            }
    }

    internal fun onExternalLink(url: String) {
        externalLinkFlow.tryEmit(url)
    }

    internal fun shouldBlock(uri: android.net.Uri): Boolean = blocker.shouldBlock(uri)

    internal fun localContent(request: android.webkit.WebResourceRequest): android.webkit.WebResourceResponse? =
        config.localContent?.respond(request)

    internal fun isAllowedNavigation(host: String?): Boolean = config.isAllowedNavigation(host)

    internal fun onBridgeMessage(raw: String) {
        when (val result = BridgeCodec.decodeEvent(raw)) {
            is DecodeResult.Rejected -> Log.w(TAG, "Rejected bridge message: ${result.reason}")
            is DecodeResult.Accepted -> handle(result.event)
        }
    }

    private fun handle(event: BridgeEvent) {
        if (queue.onEvent(event)) {
            return
        }
        when (event) {
            is BridgeEvent.Ready -> {
                onReady()
            }

            is BridgeEvent.State -> {
                bridgeStateFlow.value = event.state
                if (event.state.isSignedIn) {
                    if (accountFlow.value !is AccountState.SignedIn) {
                        accountFlow.value = AccountState.SignedIn("")
                    }
                }
            }

            is BridgeEvent.Queue -> {
                queueFlow.value = event.items
            }

            is BridgeEvent.SignedIn -> {
                accountFlow.value = AccountState.SignedIn(event.avatarUrl)
            }

            is BridgeEvent.SignedOut -> {
                accountFlow.value = AccountState.SignedOut
            }

            is BridgeEvent.AdStart, is BridgeEvent.AdEnd -> {}

            is BridgeEvent.Error -> {
                Log.w(TAG, "Bridge error ${event.code}: ${event.message}")
                errorFlow.tryEmit(EngineError(event.message))
            }

            is BridgeEvent.Ack, is BridgeEvent.BrowseResult, is BridgeEvent.SearchResult -> {}
        }
    }

    private fun onReady() {
        queue.markReady()
        statusFlow.value = EngineStatus.Ready
        scope.launch {
            val skipAds = adSkip()
            val configure = queue.player { BridgeCommand.Configure(it, skipAds) }
            if (configure != CommandResult.Acknowledged) {
                Log.w(TAG, "Configure failed: $configure")
            }
            val restore = pendingRestore ?: return@launch
            pendingRestore = null
            restoreJob?.cancel()
            restoreJob =
                scope.launch {
                    val result = restore(restore.first, restore.second)
                    if (result != CommandResult.Acknowledged) {
                        errorFlow.tryEmit(EngineError("Playback could not be restored after the page restarted."))
                    }
                }
        }
    }

    private suspend fun deliver(json: String): Boolean =
        withContext(Dispatchers.Main.immediate) {
            val view = webView ?: return@withContext false
            val literal = BridgeCodec.json.encodeToString(String.serializer(), json)
            val script =
                "(function(){var b=window.__musixBridge;if(!b||typeof b.receive!=='function'){return false;}b.receive($literal);return true;})()"
            val delivered =
                withTimeoutOrNull(DELIVERY_TIMEOUT_MS) {
                    suspendCancellableCoroutine { continuation ->
                        view.evaluateJavascript(script) { result -> continuation.resume(result == "true") }
                    }
                }
            delivered ?: true
        }

    internal fun switchAgent(
        view: WebView,
        host: String?,
    ): Boolean {
        val wanted = if (UserAgents.isAccountsHost(host)) nativeAgent else pageAgent
        if (wanted.isEmpty() || view.settings.userAgentString == wanted) {
            return false
        }
        view.settings.userAgentString = wanted
        return true
    }

    private fun load(url: String) {
        val view = webView ?: return
        statusFlow.value = if (statusFlow.value is EngineStatus.Recovering) statusFlow.value else EngineStatus.Loading
        switchAgent(view, url.toUri().host)
        view.loadUrl(url)
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun createView(): WebView {
        val view = WebView(wrapper)
        view.setBackgroundColor(Color.BLACK)
        view.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            mediaPlaybackRequiresUserGesture = false
            allowFileAccess = false
            allowContentAccess = false
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = false
            displayZoomControls = false
            nativeAgent = userAgentString
            pageAgent = if (config.desktopUserAgent) UserAgents.desktop(userAgentString) else userAgentString
            userAgentString = pageAgent
        }
        CookieManager.getInstance().setAcceptCookie(true)
        CookieManager.getInstance().setAcceptThirdPartyCookies(view, true)
        view.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false)
        view.webViewClient = EngineClient(this)
        view.webChromeClient = EngineChromeClient()
        installScripts(view)
        webView = view
        return view
    }

    private fun installScripts(view: WebView) {
        val handlers = ArrayList<ScriptHandler>()
        var useListener = false
        if (config.useMessageListener && WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            useListener = true
            WebViewCompat.addWebMessageListener(view, LISTENER_NAME, config.allowedOrigins) { _, message, _, isMainFrame, _ ->
                val data = message.data
                if (isMainFrame && data != null) {
                    onBridgeMessage(data)
                }
            }
        } else {
            view.addJavascriptInterface(JavascriptReceiver(view), "AndroidBridge")
        }
        if (WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT)) {
            fallbackInjection = false
            if (useListener) {
                handlers += WebViewCompat.addDocumentStartJavaScript(view, scripts.messageShim(LISTENER_NAME), config.allowedOrigins)
            }
            if (scripts.scriptlets.isNotBlank()) {
                handlers += WebViewCompat.addDocumentStartJavaScript(view, scripts.scriptlets, config.allowedOrigins)
            }
            if (scripts.cosmeticCss.isNotBlank()) {
                handlers += WebViewCompat.addDocumentStartJavaScript(view, scripts.cosmeticInstaller, config.allowedOrigins)
            }
            handlers += WebViewCompat.addDocumentStartJavaScript(view, scripts.bridge, config.allowedOrigins)
        } else {
            fallbackInjection = true
        }
        fallbackUsesShim = useListener
        scriptHandlers = handlers
    }

    private var fallbackUsesShim = false

    private fun fallbackBundle(): String =
        buildString {
            if (fallbackUsesShim) {
                append(scripts.messageShim(LISTENER_NAME))
            }
            append(scripts.scriptlets)
            append(';')
            append(scripts.cosmeticInstaller)
            append(';')
            append(scripts.bridge)
        }

    private fun destroyView() {
        val view = webView ?: return
        webView = null
        scriptHandlers.forEach { it.remove() }
        scriptHandlers = emptyList()
        (view.parent as? ViewGroup)?.removeView(view)
        view.stopLoading()
        view.destroy()
    }

    private fun checkMain() {
        check(Looper.myLooper() == Looper.getMainLooper()) { "WebEngine must be used on the main thread" }
    }

    private inner class JavascriptReceiver(
        view: WebView,
    ) {
        private val viewRef = WeakReference(view)

        @JavascriptInterface
        fun receive(json: String?) {
            val payload = json ?: return
            if (payload.length > BridgeCodec.MAX_MESSAGE_CHARS) {
                return
            }
            mainHandler.post {
                val view = viewRef.get() ?: return@post
                if (view === webView && config.isAllowedOrigin(view.url)) {
                    onBridgeMessage(payload)
                }
            }
        }
    }

    companion object {
        private const val TAG = "MusixEngine"
        const val LISTENER_NAME = "MusixNative"
        private const val DELIVERY_TIMEOUT_MS = 2_000L
        private const val RESTORE_TIMEOUT_MS = 15_000L
        private const val BASE_BACKOFF_MS = 1_000L
        private const val MAX_BACKOFF_MS = 30_000L
        private const val CRASH_WINDOW_MS = 5 * 60_000L
        private const val MAX_CRASHES = 5
    }
}
