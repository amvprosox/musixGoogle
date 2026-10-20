package com.realmadhoney.musix.ui

import android.content.ComponentName
import android.content.Context
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.session.CommandButton
import androidx.media3.session.LibraryResult
import androidx.media3.session.MediaBrowser
import androidx.media3.session.MediaConstants
import androidx.media3.session.MediaController
import androidx.media3.session.SessionError
import androidx.media3.session.SessionResult
import androidx.media3.session.SessionToken
import com.google.common.util.concurrent.ListenableFuture
import com.realmadhoney.musix.service.MusixCommands
import com.realmadhoney.musix.service.PlaybackService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.guava.await
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import java.util.concurrent.CancellationException
import java.util.concurrent.ExecutionException

data class NowPlaying(
    val hasTrack: Boolean,
    val mediaId: String,
    val title: String,
    val artist: String,
    val album: String,
    val artworkUri: Uri?,
    val isPlaying: Boolean,
    val isBuffering: Boolean,
    val positionMs: Long,
    val durationMs: Long,
    val canSeek: Boolean,
    val canSkip: Boolean,
    val liked: Boolean,
    val shuffle: Boolean,
    val repeatMode: Int,
    val error: String?,
) {
    companion object {
        val EMPTY =
            NowPlaying(
                hasTrack = false,
                mediaId = "",
                title = "",
                artist = "",
                album = "",
                artworkUri = null,
                isPlaying = false,
                isBuffering = false,
                positionMs = 0,
                durationMs = 0,
                canSeek = false,
                canSkip = false,
                liked = false,
                shuffle = false,
                repeatMode = Player.REPEAT_MODE_OFF,
                error = null,
            )
    }
}

data class BrowseEntry(
    val mediaId: String,
    val title: String,
    val subtitle: String,
    val artworkUri: Uri?,
    val browsable: Boolean,
    val playable: Boolean,
    val group: String?,
    val mediaType: Int?,
)

sealed interface BrowseResult {
    data class Items(
        val entries: List<BrowseEntry>,
    ) : BrowseResult

    data class Failed(
        val message: String,
        val needsSignIn: Boolean,
        val offline: Boolean,
    ) : BrowseResult
}

@UnstableApi
class PlayerConnection(
    private val context: Context,
    private val scope: CoroutineScope,
) {
    private var browser: MediaBrowser? = null
    private var pending: ListenableFuture<MediaBrowser>? = null
    private var ticker: Job? = null

    private val nowPlayingFlow = MutableStateFlow(NowPlaying.EMPTY)
    val nowPlaying: StateFlow<NowPlaying> = nowPlayingFlow.asStateFlow()

    private val connectedFlow = MutableStateFlow(false)
    val connected: StateFlow<Boolean> = connectedFlow.asStateFlow()

    private val messageFlow = MutableSharedFlow<String>(extraBufferCapacity = 8)
    val messages: SharedFlow<String> = messageFlow.asSharedFlow()

    private val listener =
        object : Player.Listener {
            override fun onEvents(
                player: Player,
                events: Player.Events,
            ) {
                refresh()
            }
        }

    private val controllerListener =
        object : MediaBrowser.Listener {
            override fun onMediaButtonPreferencesChanged(
                controller: MediaController,
                mediaButtonPreferences: MutableList<CommandButton>,
            ) {
                refresh()
            }

            override fun onError(
                controller: MediaController,
                sessionError: SessionError,
            ) {
                messageFlow.tryEmit(sessionError.message)
            }

            override fun onDisconnected(controller: MediaController) {
                connectedFlow.value = false
                browser = null
            }
        }

    fun connect() {
        if (browser != null || pending != null) {
            return
        }
        val token = SessionToken(context, ComponentName(context, PlaybackService::class.java))
        val future = MediaBrowser.Builder(context, token).setListener(controllerListener).buildAsync()
        pending = future
        future.addListener(
            {
                pending = null
                val connectedBrowser =
                    try {
                        future.get()
                    } catch (error: ExecutionException) {
                        Log.w(TAG, "Could not connect to the player", error)
                        messageFlow.tryEmit("Could not connect to the player. Try reopening Musix.")
                        null
                    } catch (error: CancellationException) {
                        null
                    }
                if (connectedBrowser != null) {
                    browser = connectedBrowser
                    connectedBrowser.addListener(listener)
                    connectedFlow.value = true
                    refresh()
                    startTicker()
                }
            },
            ContextCompat.getMainExecutor(context),
        )
    }

    fun release() {
        ticker?.cancel()
        ticker = null
        pending?.cancel(true)
        pending = null
        browser?.removeListener(listener)
        browser?.release()
        browser = null
        connectedFlow.value = false
    }

    fun play(mediaId: String) {
        val current = browser ?: return notConnected()
        current.setMediaItem(MediaItem.Builder().setMediaId(mediaId).build())
        current.prepare()
        current.play()
    }

    fun playFromSearch(query: String): Boolean {
        val current = browser ?: return false
        val request =
            MediaItem.RequestMetadata
                .Builder()
                .setSearchQuery(query.take(200))
                .build()
        current.setMediaItem(MediaItem.Builder().setRequestMetadata(request).build())
        current.prepare()
        current.play()
        return true
    }

    fun togglePlay() {
        val current = browser ?: return notConnected()
        if (current.playWhenReady) current.pause() else current.play()
    }

    fun next() {
        browser?.seekToNext() ?: notConnected()
    }

    fun previous() {
        browser?.seekToPrevious() ?: notConnected()
    }

    fun seekTo(positionMs: Long) {
        browser?.seekTo(positionMs.coerceAtLeast(0L)) ?: notConnected()
        nowPlayingFlow.value = nowPlayingFlow.value.copy(positionMs = positionMs.coerceAtLeast(0L))
    }

    fun retry() {
        browser?.prepare() ?: notConnected()
    }

    fun toggleLike() = custom(MusixCommands.like.customAction)

    fun toggleShuffle() = custom(MusixCommands.shuffle.customAction)

    fun cycleRepeat() = custom(MusixCommands.repeat.customAction)

    suspend fun children(
        parentId: String,
        page: Int,
        pageSize: Int,
    ): BrowseResult {
        val current = browser ?: return BrowseResult.Failed("Connecting to the player…", needsSignIn = false, offline = false)
        val result =
            try {
                current.getChildren(parentId, page, pageSize, null).await()
            } catch (error: ExecutionException) {
                return BrowseResult.Failed(error.cause?.message ?: "Could not load this page.", needsSignIn = false, offline = false)
            }
        return toBrowseResult(result)
    }

    suspend fun search(
        query: String,
        page: Int,
        pageSize: Int,
    ): BrowseResult {
        val current = browser ?: return BrowseResult.Failed("Connecting to the player…", needsSignIn = false, offline = false)
        return try {
            val started = current.search(query, null).await()
            if (started.resultCode != LibraryResult.RESULT_SUCCESS) {
                return failed(started.sessionError)
            }
            toBrowseResult(current.getSearchResult(query, page, pageSize, null).await())
        } catch (error: ExecutionException) {
            BrowseResult.Failed(error.cause?.message ?: "Search failed.", needsSignIn = false, offline = false)
        }
    }

    private fun toBrowseResult(result: LibraryResult<com.google.common.collect.ImmutableList<MediaItem>>): BrowseResult {
        val items = result.value
        if (result.resultCode != LibraryResult.RESULT_SUCCESS || items == null) {
            return failed(result.sessionError)
        }
        return BrowseResult.Items(
            items.map { item ->
                val metadata = item.mediaMetadata
                BrowseEntry(
                    mediaId = item.mediaId,
                    title = metadata.title?.toString().orEmpty(),
                    subtitle = metadata.subtitle?.toString() ?: metadata.artist?.toString().orEmpty(),
                    artworkUri = metadata.artworkUri,
                    browsable = metadata.isBrowsable == true,
                    playable = metadata.isPlayable == true,
                    group = metadata.extras?.getString(MediaConstants.EXTRAS_KEY_CONTENT_STYLE_GROUP_TITLE),
                    mediaType = metadata.mediaType,
                )
            },
        )
    }

    private fun failed(error: SessionError?): BrowseResult.Failed =
        BrowseResult.Failed(
            message = error?.message ?: "Could not load this page.",
            needsSignIn = error?.code == SessionError.ERROR_SESSION_AUTHENTICATION_EXPIRED,
            offline = error?.code == SessionError.ERROR_IO,
        )

    private fun custom(action: String) {
        val current = browser ?: return notConnected()
        val command = MusixCommands.all.firstOrNull { it.customAction == action } ?: return
        val future = current.sendCustomCommand(command, Bundle.EMPTY)
        scope.launch {
            val result =
                try {
                    future.await()
                } catch (error: ExecutionException) {
                    messageFlow.tryEmit(error.cause?.message ?: "That action failed.")
                    return@launch
                }
            if (result.resultCode != SessionResult.RESULT_SUCCESS) {
                messageFlow.tryEmit(result.sessionError?.message ?: "That action failed.")
            }
        }
    }

    private fun notConnected() {
        messageFlow.tryEmit("The player is still connecting.")
    }

    private fun startTicker() {
        ticker?.cancel()
        ticker =
            scope.launch {
                while (isActive) {
                    if (browser?.isPlaying == true) {
                        refresh()
                    }
                    delay(TICK_MS)
                }
            }
    }

    private fun refresh() {
        val current = browser ?: return
        val item = current.currentMediaItem
        val metadata = item?.mediaMetadata
        val buttons = current.mediaButtonPreferences
        val liked =
            buttons.any { it.sessionCommand?.customAction == MusixCommands.ACTION_LIKE && it.icon == CommandButton.ICON_HEART_FILLED }
        val duration = current.duration
        nowPlayingFlow.value =
            NowPlaying(
                hasTrack = item != null && current.mediaItemCount > 0,
                mediaId = item?.mediaId.orEmpty(),
                title = metadata?.title?.toString().orEmpty(),
                artist = metadata?.artist?.toString().orEmpty(),
                album = metadata?.albumTitle?.toString().orEmpty(),
                artworkUri = metadata?.artworkUri,
                isPlaying = current.playWhenReady,
                isBuffering = current.playbackState == Player.STATE_BUFFERING,
                positionMs = current.currentPosition.coerceAtLeast(0L),
                durationMs = if (duration > 0) duration else 0L,
                canSeek = current.isCommandAvailable(Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM),
                canSkip = current.isCommandAvailable(Player.COMMAND_SEEK_TO_NEXT),
                liked = liked,
                shuffle = current.shuffleModeEnabled,
                repeatMode = current.repeatMode,
                error = current.playerError?.message,
            )
    }

    private companion object {
        const val TAG = "MusixConnection"
        const val TICK_MS = 500L
    }
}
