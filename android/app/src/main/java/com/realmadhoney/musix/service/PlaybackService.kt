package com.realmadhoney.musix.service

import android.app.PendingIntent
import android.content.Intent
import android.os.Looper
import android.os.PowerManager
import android.util.Log
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.DefaultMediaNotificationProvider
import androidx.media3.session.MediaLibraryService
import androidx.media3.session.MediaSession
import androidx.media3.session.SessionError
import com.realmadhoney.musix.MusixApplication
import com.realmadhoney.musix.R
import com.realmadhoney.musix.audio.AudioFocusController
import com.realmadhoney.musix.core.bridge.BridgeCommand
import com.realmadhoney.musix.core.bridge.BridgeErrorCode
import com.realmadhoney.musix.core.bridge.CommandResult
import com.realmadhoney.musix.core.browse.MediaIds
import com.realmadhoney.musix.core.browse.RootTab
import com.realmadhoney.musix.core.player.PlaybackModel
import com.realmadhoney.musix.core.resume.ResumeSnapshot
import com.realmadhoney.musix.engine.AccountState
import com.realmadhoney.musix.engine.EngineStatus
import com.realmadhoney.musix.engine.WebEngine
import com.realmadhoney.musix.platform.PlatformInfo
import com.realmadhoney.musix.player.WebViewPlayer
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

@UnstableApi
class PlaybackService : MediaLibraryService() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var session: MediaLibrarySession? = null
    private var player: WebViewPlayer? = null
    private var engine: WebEngine? = null
    private var focus: AudioFocusController? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var lastSavedAt = 0L
    private var lastSaved: ResumeSnapshot? = null

    override fun onCreate() {
        super.onCreate()
        val graph = (application as MusixApplication).graph
        val engine = graph.createEngine(scope)
        this.engine = engine
        val focus = AudioFocusController(this, EngineCommands(engine), scope)
        this.focus = focus
        val backend = EngineBackend(engine, focus)
        val player = WebViewPlayer(Looper.getMainLooper(), backend, graph.mediaItems, scope) { message -> showError(message) }
        this.player = player
        val resolver = LibraryResolver(graph.pager, graph.mediaItems) { graph.settings.currentResume() }
        val callback =
            LibraryCallback(
                resolver = resolver,
                items = graph.mediaItems,
                scope = scope,
                signInIntent = pendingIntent(REQUEST_SIGN_IN, PlatformInfo.signInActivity(this)),
                resume = { graph.settings.currentResume() },
                customCommand = { action -> runCustomCommand(engine, action) },
            )
        val built =
            MediaLibrarySession
                .Builder(this, player, callback)
                .setSessionActivity(pendingIntent(REQUEST_OPEN, PlatformInfo.sessionActivity(this)))
                .setMediaButtonPreferences(MusixCommands.buttons(engine.bridgeState.value, signedIn = false))
                .build()
        session = built
        val notifications = DefaultMediaNotificationProvider.Builder(this).setChannelName(R.string.notification_channel).build()
        notifications.setSmallIcon(R.drawable.ic_stat_musix)
        setMediaNotificationProvider(notifications)
        graph.connectivity.start()
        engine.start()
        observe(graph, engine, focus, built, resolver)
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaLibrarySession? = session

    override fun onTaskRemoved(rootIntent: Intent?) {
        val current = player
        if (current == null || !current.playWhenReady || current.mediaItemCount == 0) {
            stopSelf()
        }
    }

    override fun onDestroy() {
        val graph = (application as MusixApplication).graph
        session?.release()
        session = null
        player?.release()
        player = null
        focus?.release()
        focus = null
        engine?.let { graph.releaseEngine(it) }
        engine = null
        graph.connectivity.stop()
        releaseWakeLock()
        scope.cancel()
        super.onDestroy()
    }

    private fun observe(
        graph: com.realmadhoney.musix.AppGraph,
        engine: WebEngine,
        focus: AudioFocusController,
        session: MediaLibrarySession,
        resolver: LibraryResolver,
    ) {
        scope.launch {
            engine.bridgeState.map { it.isPlaying }.distinctUntilChanged().collect { playing ->
                focus.onPlaybackChanged(playing)
            }
        }
        scope.launch {
            engine.bridgeState.map { it.isPlaying to it.videoId }.distinctUntilChanged().collect { (playing, _) ->
                if (playing) acquireWakeLock() else releaseWakeLock()
            }
        }
        scope.launch {
            combine(engine.bridgeState, engine.account) { state, account -> MusixCommands.buttons(state, account is AccountState.SignedIn) }
                .distinctUntilChanged()
                .collect { session.setMediaButtonPreferences(it) }
        }
        scope.launch {
            engine.bridgeState.collect { state ->
                val now = System.currentTimeMillis()
                val snapshot = ResumeSnapshot.from(state, now) ?: return@collect
                val previous = lastSaved
                val changedTrack = previous?.videoId != snapshot.videoId
                val due = now - lastSavedAt >= RESUME_SAVE_INTERVAL_MS
                val pausedAtNewPosition = !state.isPlaying && previous?.positionSec != snapshot.positionSec
                if (changedTrack || due || pausedAtNewPosition) {
                    lastSaved = snapshot
                    lastSavedAt = now
                    graph.settings.saveResume(snapshot)
                }
            }
        }
        scope.launch {
            graph.connectivity.isOnline.drop(1).collect { online ->
                val status = engine.status.value
                if (online && (status is EngineStatus.Offline || status is EngineStatus.Failed)) {
                    engine.reload()
                }
            }
        }
        scope.launch {
            engine.errors.collect { showError(it.message) }
        }
        scope.launch {
            engine.account.drop(1).distinctUntilChanged { a, b -> a::class == b::class }.collect {
                resolver.invalidateAll()
                RootTab.entries.forEach { tab -> session.notifyChildrenChanged(MediaIds.tab(tab), Int.MAX_VALUE, null) }
            }
        }
        scope.launch {
            graph.settings.adSkip.drop(1).collect { enabled ->
                val result = engine.queue.player { BridgeCommand.Configure(it, enabled) }
                if (result != CommandResult.Acknowledged) {
                    Log.w(TAG, "Could not update ad skipping: $result")
                }
            }
        }
    }

    private suspend fun runCustomCommand(
        engine: WebEngine,
        action: String,
    ): CommandResult {
        val state = engine.bridgeState.value
        return when (action) {
            MusixCommands.ACTION_LIKE -> {
                engine.queue.player { BridgeCommand.ToggleLike(it) }
            }

            MusixCommands.ACTION_SHUFFLE -> {
                engine.queue.player { BridgeCommand.SetShuffle(it, !state.shuffle) }
            }

            MusixCommands.ACTION_REPEAT -> {
                engine.queue.player {
                    BridgeCommand.SetRepeat(
                        it,
                        PlaybackModel.nextRepeatMode(state.repeatMode),
                    )
                }
            }

            else -> {
                CommandResult.Failed(BridgeErrorCode.UNSUPPORTED, "Unknown action")
            }
        }
    }

    private fun showError(message: String) {
        (application as MusixApplication).graph.postMessage(message)
        session?.sendError(SessionError(SessionError.ERROR_UNKNOWN, message))
    }

    private fun pendingIntent(
        requestCode: Int,
        intent: Intent,
    ): PendingIntent =
        PendingIntent.getActivity(
            this,
            requestCode,
            intent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

    private fun acquireWakeLock() {
        val lock =
            wakeLock ?: getSystemService(PowerManager::class.java)
                ?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Musix:playback")
                ?.apply { setReferenceCounted(false) }
        wakeLock = lock
        lock?.acquire(WAKE_LOCK_TIMEOUT_MS)
    }

    private fun releaseWakeLock() {
        val lock = wakeLock ?: return
        if (lock.isHeld) {
            lock.release()
        }
    }

    private companion object {
        const val TAG = "MusixService"
        const val REQUEST_OPEN = 1
        const val REQUEST_SIGN_IN = 2
        const val RESUME_SAVE_INTERVAL_MS = 15_000L
        const val WAKE_LOCK_TIMEOUT_MS = 3 * 60 * 60_000L
    }
}
