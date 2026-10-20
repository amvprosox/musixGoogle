package com.realmadhoney.musix.player

import android.os.Looper
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.SimpleBasePlayer
import androidx.media3.common.util.UnstableApi
import com.google.common.util.concurrent.Futures
import com.google.common.util.concurrent.ListenableFuture
import com.realmadhoney.musix.core.bridge.BridgeCommand
import com.realmadhoney.musix.core.bridge.BridgeErrorCode
import com.realmadhoney.musix.core.bridge.BridgeState
import com.realmadhoney.musix.core.bridge.CommandResult
import com.realmadhoney.musix.core.bridge.QueueEntry
import com.realmadhoney.musix.core.bridge.RepeatMode
import com.realmadhoney.musix.core.browse.MediaIds
import com.realmadhoney.musix.core.browse.MediaRef
import com.realmadhoney.musix.core.player.PlaybackModel
import com.realmadhoney.musix.core.player.SeekAction
import com.realmadhoney.musix.core.player.SeekIntent
import com.realmadhoney.musix.core.player.TimelineSpec
import com.realmadhoney.musix.engine.EngineStatus
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.guava.future
import kotlinx.coroutines.launch

interface PlaybackBackend {
    val bridgeState: StateFlow<BridgeState>
    val queueEntries: StateFlow<List<QueueEntry>>
    val status: StateFlow<EngineStatus>

    suspend fun send(build: (String) -> BridgeCommand): CommandResult

    suspend fun play(): CommandResult

    suspend fun pause(): CommandResult

    suspend fun stop(): CommandResult

    suspend fun resumeAt(
        videoId: String,
        playlistId: String?,
        positionMs: Long,
    ): CommandResult

    fun retry()
}

@UnstableApi
class WebViewPlayer(
    looper: Looper,
    private val backend: PlaybackBackend,
    private val items: MediaItemFactory,
    private val scope: CoroutineScope,
    private val onFailure: (String) -> Unit,
) : SimpleBasePlayer(looper) {
    private var bridge: BridgeState = BridgeState.EMPTY
    private var status: EngineStatus = EngineStatus.Starting
    private var timeline: TimelineSpec = TimelineSpec.EMPTY
    private var playlist: List<MediaItemData> = emptyList()
    private var orderedQueue: List<QueueEntry> = emptyList()
    private val job: Job =
        scope.launch {
            combine(backend.bridgeState, backend.queueEntries, backend.status) { state, queue, engineStatus ->
                Triple(state, queue, engineStatus)
            }.collect { (state, queue, engineStatus) ->
                val next = PlaybackModel.timeline(state, queue)
                if (next != timeline) {
                    timeline = next
                    playlist =
                        next.tracks.map { track ->
                            MediaItemData
                                .Builder(track.uid)
                                .setMediaItem(items.fromTrack(track))
                                .setDurationUs(track.durationMs?.let { it * 1000 } ?: C.TIME_UNSET)
                                .setIsSeekable(!track.isAd && track.durationMs != null)
                                .setIsDynamic(track.isAd)
                                .build()
                        }
                }
                bridge = state
                orderedQueue = queue.sortedBy { it.index }
                status = engineStatus
                invalidateState()
            }
        }

    override fun getState(): State {
        val hasTrack = playlist.isNotEmpty()
        val error = errorFor(status)
        val playbackState =
            when {
                error != null -> Player.STATE_IDLE
                !hasTrack -> Player.STATE_IDLE
                bridge.isAd || bridge.isBuffering -> Player.STATE_BUFFERING
                else -> Player.STATE_READY
            }
        val builder =
            State
                .Builder()
                .setAvailableCommands(commands(hasTrack))
                .setPlayWhenReady(bridge.isPlaying && error == null, Player.PLAY_WHEN_READY_CHANGE_REASON_REMOTE)
                .setPlaybackState(playbackState)
                .setPlayerError(error)
                .setShuffleModeEnabled(bridge.shuffle)
                .setRepeatMode(repeatModeOf(bridge.repeatMode))
                .setVolume(if (bridge.isMuted) 0f else bridge.volume.toFloat().coerceIn(0f, 1f))
                .setAudioAttributes(AUDIO_ATTRIBUTES)
                .setMaxSeekToPreviousPositionMs(PlaybackModel.PREVIOUS_RESTART_THRESHOLD_MS)
                .setPlaylist(playlist)
        if (hasTrack) {
            builder.setCurrentMediaItemIndex(timeline.currentIndex.coerceIn(0, playlist.size - 1))
            val position = PlaybackModel.positionMs(bridge)
            val moving = bridge.isPlaying && !bridge.isBuffering && !bridge.isAd
            builder.setContentPositionMs(
                if (moving) PositionSupplier.getExtrapolating(position, 1f) else PositionSupplier.getConstant(position),
            )
            builder.setContentBufferedPositionMs(PositionSupplier.getConstant(PlaybackModel.bufferedMs(bridge)))
        }
        return builder.build()
    }

    override fun handleSetPlayWhenReady(playWhenReady: Boolean): ListenableFuture<*> =
        scope.future {
            report(if (playWhenReady) backend.play() else backend.pause())
        }

    override fun handlePrepare(): ListenableFuture<*> {
        if (status is EngineStatus.Failed || status is EngineStatus.Offline) {
            backend.retry()
        }
        return Futures.immediateVoidFuture()
    }

    override fun handleStop(): ListenableFuture<*> = scope.future { report(backend.stop()) }

    override fun handleRelease(): ListenableFuture<*> {
        job.cancel()
        return Futures.immediateVoidFuture()
    }

    override fun handleSetShuffleModeEnabled(shuffleModeEnabled: Boolean): ListenableFuture<*> =
        scope.future { report(backend.send { BridgeCommand.SetShuffle(it, shuffleModeEnabled) }) }

    override fun handleSetRepeatMode(repeatMode: Int): ListenableFuture<*> {
        val mode =
            when (repeatMode) {
                Player.REPEAT_MODE_ALL -> RepeatMode.ALL
                Player.REPEAT_MODE_ONE -> RepeatMode.ONE
                else -> RepeatMode.NONE
            }
        return scope.future { report(backend.send { BridgeCommand.SetRepeat(it, mode) }) }
    }

    override fun handleSetVolume(
        volume: Float,
        volumeOperationType: Int,
    ): ListenableFuture<*> {
        val level = volume.toDouble().coerceIn(0.0, 1.0)
        return scope.future { report(backend.send { BridgeCommand.SetVolume(it, level) }) }
    }

    override fun handleSeek(
        mediaItemIndex: Int,
        positionMs: Long,
        seekCommand: Int,
    ): ListenableFuture<*> {
        val intent =
            when (seekCommand) {
                Player.COMMAND_SEEK_TO_NEXT, Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM -> SeekIntent.NEXT
                Player.COMMAND_SEEK_TO_PREVIOUS, Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM -> SeekIntent.PREVIOUS
                else -> SeekIntent.DIRECT
            }
        val target = if (positionMs == C.TIME_UNSET) 0L else positionMs
        val action = PlaybackModel.translateSeek(timeline.currentIndex, mediaItemIndex, target, playlist.size, intent)
        return scope.future {
            val result =
                when (action) {
                    is SeekAction.SeekWithinTrack -> backend.send { BridgeCommand.SeekTo(it, action.seconds) }
                    SeekAction.NextTrack -> backend.send { BridgeCommand.Next(it) }
                    SeekAction.PreviousTrack -> backend.send { BridgeCommand.Previous(it) }
                    is SeekAction.JumpToQueueIndex -> backend.send { BridgeCommand.PlayQueueIndex(it, queueIndexFor(action.index)) }
                    SeekAction.Ignore -> CommandResult.Acknowledged
                }
            report(result)
        }
    }

    override fun handleSetMediaItems(
        mediaItems: MutableList<MediaItem>,
        startIndex: Int,
        startPositionMs: Long,
    ): ListenableFuture<*> {
        val index = if (startIndex == C.INDEX_UNSET) 0 else startIndex
        val item = mediaItems.getOrNull(index) ?: mediaItems.firstOrNull()
        val ref = item?.mediaId?.let { MediaIds.parse(it) }
        val position = if (startPositionMs == C.TIME_UNSET) 0L else startPositionMs.coerceAtLeast(0L)
        return scope.future {
            val result =
                when (ref) {
                    is MediaRef.Track -> {
                        if (position > 0L) {
                            backend.resumeAt(ref.videoId, ref.playlistId, position)
                        } else {
                            backend.send { BridgeCommand.PlayVideoId(it, ref.videoId, ref.playlistId) }
                        }
                    }

                    is MediaRef.Node -> {
                        ref.playlistId?.let { playlistId -> backend.send { BridgeCommand.PlayVideoId(it, "", playlistId) } }
                            ?: CommandResult.Failed(BridgeErrorCode.INVALID_COMMAND, "This item cannot be played directly.")
                    }

                    else -> {
                        CommandResult.Failed(BridgeErrorCode.INVALID_COMMAND, "This item cannot be played.")
                    }
                }
            report(result)
        }
    }

    private fun queueIndexFor(timelineIndex: Int): Int = orderedQueue.getOrNull(timelineIndex)?.index ?: timelineIndex

    private fun report(result: CommandResult) {
        val message =
            when (result) {
                CommandResult.Acknowledged, is CommandResult.Page -> null
                CommandResult.NotReady -> "YouTube Music is still loading. Try again in a moment."
                CommandResult.TimedOut -> "YouTube Music did not respond. Try again."
                is CommandResult.Failed -> result.message
            }
        if (message != null) {
            onFailure(message)
        }
    }

    private fun commands(hasTrack: Boolean): Player.Commands {
        val builder =
            Player.Commands
                .Builder()
                .addAll(
                    Player.COMMAND_PLAY_PAUSE,
                    Player.COMMAND_PREPARE,
                    Player.COMMAND_STOP,
                    Player.COMMAND_SET_MEDIA_ITEM,
                    Player.COMMAND_GET_CURRENT_MEDIA_ITEM,
                    Player.COMMAND_GET_TIMELINE,
                    Player.COMMAND_GET_METADATA,
                    Player.COMMAND_SET_SHUFFLE_MODE,
                    Player.COMMAND_SET_REPEAT_MODE,
                    Player.COMMAND_GET_VOLUME,
                    Player.COMMAND_SET_VOLUME,
                    Player.COMMAND_GET_AUDIO_ATTRIBUTES,
                    Player.COMMAND_RELEASE,
                )
        if (hasTrack && !bridge.isAd) {
            builder.addAll(
                Player.COMMAND_SEEK_IN_CURRENT_MEDIA_ITEM,
                Player.COMMAND_SEEK_TO_DEFAULT_POSITION,
                Player.COMMAND_SEEK_TO_PREVIOUS,
                Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM,
                Player.COMMAND_SEEK_TO_NEXT,
                Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM,
                Player.COMMAND_SEEK_TO_MEDIA_ITEM,
            )
        }
        return builder.build()
    }

    private fun errorFor(status: EngineStatus): PlaybackException? =
        when (status) {
            is EngineStatus.Offline -> PlaybackException(status.message, null, PlaybackException.ERROR_CODE_IO_NETWORK_CONNECTION_FAILED)
            is EngineStatus.Failed -> PlaybackException(status.message, null, PlaybackException.ERROR_CODE_REMOTE_ERROR)
            else -> null
        }

    private fun repeatModeOf(mode: RepeatMode): Int =
        when (mode) {
            RepeatMode.NONE -> Player.REPEAT_MODE_OFF
            RepeatMode.ALL -> Player.REPEAT_MODE_ALL
            RepeatMode.ONE -> Player.REPEAT_MODE_ONE
        }

    private companion object {
        val AUDIO_ATTRIBUTES: AudioAttributes =
            AudioAttributes
                .Builder()
                .setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                .build()
    }
}
