package com.realmadhoney.musix

import android.content.Context
import android.util.Log
import com.realmadhoney.musix.artwork.ArtworkStore
import com.realmadhoney.musix.core.bridge.BridgeCommand
import com.realmadhoney.musix.core.bridge.BridgeErrorCode
import com.realmadhoney.musix.core.bridge.CommandResult
import com.realmadhoney.musix.core.bridge.ContinuationKind
import com.realmadhoney.musix.core.bridge.SearchFilter
import com.realmadhoney.musix.core.browse.BrowsePager
import com.realmadhoney.musix.core.browse.LoadFailure
import com.realmadhoney.musix.core.browse.NodeSnapshot
import com.realmadhoney.musix.core.browse.PageLoad
import com.realmadhoney.musix.core.browse.PageSource
import com.realmadhoney.musix.core.cache.JsonFileStore
import com.realmadhoney.musix.core.cache.TtlCache
import com.realmadhoney.musix.data.SettingsRepository
import com.realmadhoney.musix.engine.AdBlocker
import com.realmadhoney.musix.engine.EngineConfig
import com.realmadhoney.musix.engine.InjectedScripts
import com.realmadhoney.musix.engine.WebEngine
import com.realmadhoney.musix.net.Connectivity
import com.realmadhoney.musix.player.MediaItemFactory
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import java.io.File

class AppGraph(
    private val context: Context,
) {
    private val ioScope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    val settings = SettingsRepository(context, ioScope)

    val connectivity = Connectivity(context)

    val artwork = ArtworkStore(ArtworkStore.authorityFor(context), File(context.cacheDir, "artwork"))

    val mediaItems = MediaItemFactory(context.packageName) { url -> if (url.isEmpty()) null else artwork.contentUri(url) }

    private val engineFlow = MutableStateFlow<WebEngine?>(null)
    val engine: StateFlow<WebEngine?> = engineFlow.asStateFlow()

    private val messageFlow = MutableSharedFlow<String>(extraBufferCapacity = 16)
    val messages: SharedFlow<String> = messageFlow.asSharedFlow()

    var engineConfig: EngineConfig = EngineConfig()

    private val browseCache =
        TtlCache(
            ttlMs = BROWSE_TTL_MS,
            clock = System::currentTimeMillis,
            maxEntries = 64,
            disk =
                JsonFileStore(
                    directory = File(context.cacheDir, "browse"),
                    serializer = NodeSnapshot.serializer(),
                    onError = { what, error -> Log.w(TAG, "Browse cache $what failed", error) },
                ),
        )

    val pager = BrowsePager(EnginePageSource { engineFlow.value }, browseCache)

    private val adBlocker: AdBlocker by lazy { AdBlocker.load(context.assets) }

    private val scripts: InjectedScripts by lazy { InjectedScripts.load(context.assets) }

    fun createEngine(scope: CoroutineScope): WebEngine {
        engineFlow.value?.let { return it }
        val created =
            WebEngine(
                appContext = context.applicationContext,
                config = engineConfig,
                blocker = adBlocker,
                scripts = scripts,
                adSkip = { settings.currentAdSkip() },
                scope = scope,
            )
        engineFlow.value = created
        return created
    }

    fun releaseEngine(engine: WebEngine) {
        engine.release()
        if (engineFlow.value === engine) {
            engineFlow.value = null
        }
    }

    fun postMessage(message: String) {
        messageFlow.tryEmit(message)
    }

    fun clearCaches() {
        pager.clear()
        artwork.clear()
    }

    private class EnginePageSource(
        private val engine: () -> WebEngine?,
    ) : PageSource {
        override suspend fun browse(nodeId: String): PageLoad = map(engine()?.queue?.data { BridgeCommand.Browse(it, nodeId) })

        override suspend fun search(query: String): PageLoad =
            map(engine()?.queue?.data { BridgeCommand.Search(it, query, SearchFilter.ALL) })

        override suspend fun more(
            nodeId: String,
            token: String,
            kind: ContinuationKind,
        ): PageLoad = map(engine()?.queue?.data { BridgeCommand.LoadContinuation(it, token, kind, nodeId) })

        private fun map(result: CommandResult?): PageLoad =
            when (result) {
                null, CommandResult.NotReady -> {
                    PageLoad.Failed(LoadFailure.NotReady)
                }

                CommandResult.TimedOut -> {
                    PageLoad.Failed(LoadFailure.TimedOut)
                }

                CommandResult.Acknowledged -> {
                    PageLoad.Failed(LoadFailure.Error("The page returned no results"))
                }

                is CommandResult.Page -> {
                    PageLoad.Loaded(result.page)
                }

                is CommandResult.Failed -> {
                    when (result.code) {
                        BridgeErrorCode.NOT_SIGNED_IN -> PageLoad.Failed(LoadFailure.SignedOut)
                        BridgeErrorCode.NETWORK -> PageLoad.Failed(LoadFailure.Offline)
                        BridgeErrorCode.NOT_READY -> PageLoad.Failed(LoadFailure.NotReady)
                        else -> PageLoad.Failed(LoadFailure.Error(result.message))
                    }
                }
            }
    }

    private companion object {
        const val TAG = "MusixGraph"
        const val BROWSE_TTL_MS = 10 * 60_000L
    }
}
