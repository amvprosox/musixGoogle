package com.realmadhoney.musix.car

import android.content.ComponentName
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawing
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.core.content.ContextCompat
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import com.realmadhoney.musix.AppGraph
import com.realmadhoney.musix.BuildConfig
import com.realmadhoney.musix.MusixApplication
import com.realmadhoney.musix.R
import com.realmadhoney.musix.engine.AccountState
import com.realmadhoney.musix.platform.PlatformInfo
import com.realmadhoney.musix.service.PlaybackService
import com.realmadhoney.musix.ui.screens.SettingsScreen
import com.realmadhoney.musix.ui.screens.SignInScreen
import com.realmadhoney.musix.ui.theme.Musix
import com.realmadhoney.musix.ui.theme.MusixTheme
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.launch

@UnstableApi
class CarSettingsActivity : ComponentActivity() {
    private var controller: ListenableFuture<MediaController>? = null
    private var showSignIn by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        showSignIn = intent?.action == ACTION_SIGN_IN
        val graph = (application as MusixApplication).graph
        setContent {
            MusixTheme(dark = true) {
                CarSettings(graph, showSignIn, onShowSignIn = { showSignIn = it })
            }
        }
    }

    override fun onStart() {
        super.onStart()
        val token = SessionToken(this, ComponentName(this, PlaybackService::class.java))
        controller = MediaController.Builder(this, token).buildAsync()
    }

    override fun onStop() {
        controller?.let { MediaController.releaseFuture(it) }
        controller = null
        super.onStop()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == ACTION_SIGN_IN) {
            showSignIn = true
        }
    }

    companion object {
        const val ACTION_SIGN_IN = "com.realmadhoney.musix.action.SIGN_IN"
    }
}

@OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)
@Composable
private fun CarSettings(
    graph: AppGraph,
    showSignIn: Boolean,
    onShowSignIn: (Boolean) -> Unit,
) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val engine by graph.engine.collectAsState()
    val account by remember(graph) { graph.engine.flatMapLatest { it?.account ?: flowOf(AccountState.Unknown) } }
        .collectAsState(initial = AccountState.Unknown)
    val adSkip by graph.settings.adSkip.collectAsState(initial = true)
    val restrictions = remember { PlatformInfo.drivingRestrictions(context) }
    val restricted by restrictions.restricted.collectAsState()
    DisposableEffect(restrictions) { onDispose { restrictions.release() } }
    val snackbar = remember { SnackbarHostState() }
    val unavailable = stringResource(R.string.signin_unavailable)
    val signedOut = stringResource(R.string.settings_sign_out_done)
    val cacheDone = stringResource(R.string.settings_cache_done)
    val scope = rememberCoroutineScope()
    LaunchedEffect(graph) { graph.messages.collect { snackbar.showSnackbar(it) } }
    Box(Modifier.fillMaxSize().background(Musix.colors.bg).windowInsetsPadding(WindowInsets.safeDrawing)) {
        if (showSignIn) {
            SignInScreen(engine = engine, account = account, drivingRestricted = restricted, onDone = { onShowSignIn(false) })
        } else {
            SettingsScreen(
                account = account,
                adSkip = adSkip,
                blockedRequests = engine?.blockedRequests ?: 0L,
                versionName = BuildConfig.VERSION_NAME,
                onBack = null,
                onSignIn = { onShowSignIn(true) },
                onSignOut = {
                    scope.launch {
                        val current = engine
                        if (current == null) {
                            graph.postMessage(unavailable)
                        } else {
                            current.signOut()
                            graph.pager.clear()
                            graph.settings.clearResume()
                            graph.postMessage(signedOut)
                        }
                    }
                },
                onAdSkip = { enabled -> scope.launch { graph.settings.setAdSkip(enabled) } },
                onClearCache = {
                    graph.clearCaches()
                    graph.postMessage(cacheDone)
                },
            )
        }
        SnackbarHost(snackbar, modifier = Modifier.align(Alignment.BottomCenter))
    }
}
