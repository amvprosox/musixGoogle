package com.realmadhoney.musix.core.player

import com.realmadhoney.musix.core.bridge.BridgeState
import com.realmadhoney.musix.core.bridge.QueueEntry
import com.realmadhoney.musix.core.bridge.RepeatMode
import com.realmadhoney.musix.core.browse.MediaIds

data class TrackSpec(
    val uid: String,
    val mediaId: String,
    val videoId: String,
    val title: String,
    val artist: String,
    val album: String,
    val artworkUrl: String,
    val durationMs: Long?,
    val isAd: Boolean,
)

data class TimelineSpec(
    val tracks: List<TrackSpec>,
    val currentIndex: Int,
) {
    val current: TrackSpec? get() = tracks.getOrNull(currentIndex)

    companion object {
        val EMPTY = TimelineSpec(emptyList(), 0)
    }
}

enum class SeekIntent { NEXT, PREVIOUS, DIRECT }

sealed interface SeekAction {
    data class SeekWithinTrack(
        val seconds: Double,
    ) : SeekAction

    data object NextTrack : SeekAction

    data object PreviousTrack : SeekAction

    data class JumpToQueueIndex(
        val index: Int,
    ) : SeekAction

    data object Ignore : SeekAction
}

object PlaybackModel {
    const val LOADING_TITLE = "Loading"
    const val PREVIOUS_RESTART_THRESHOLD_MS = 3_000L

    fun timeline(
        state: BridgeState,
        queue: List<QueueEntry>,
    ): TimelineSpec {
        val playlistId = state.playlistId.ifEmpty { null }
        val ordered = queue.sortedBy { it.index }
        if (ordered.isEmpty()) {
            if (!state.hasTrack) {
                return TimelineSpec.EMPTY
            }
            return TimelineSpec(listOf(fromState(state, "s0-${state.videoId}", playlistId)), 0)
        }
        var currentIndex = ordered.indexOfFirst { it.isCurrent }
        if (currentIndex < 0 && state.videoId.isNotEmpty()) {
            currentIndex = ordered.indexOfFirst { it.videoId == state.videoId }
        }
        if (currentIndex < 0 && state.hasTrack) {
            return TimelineSpec(listOf(fromState(state, "s0-${state.videoId}", playlistId)), 0)
        }
        val safeIndex = currentIndex.coerceAtLeast(0)
        val tracks =
            ordered.mapIndexed { position, entry ->
                val uid = "q$position-${entry.videoId}"
                val base =
                    TrackSpec(
                        uid = uid,
                        mediaId = MediaIds.track(entry.videoId.ifEmpty { "unknown" }, playlistId),
                        videoId = entry.videoId,
                        title = entry.title,
                        artist = entry.artist,
                        album = "",
                        artworkUrl = entry.artworkUrl,
                        durationMs = if (entry.durationSec > 0) (entry.durationSec * 1000).toLong() else null,
                        isAd = false,
                    )
                if (position == safeIndex && state.hasTrack && (state.videoId == entry.videoId || state.isAd)) {
                    merge(base, state)
                } else {
                    base
                }
            }
        return TimelineSpec(tracks, safeIndex)
    }

    fun positionMs(state: BridgeState): Long =
        if (state.isAd) {
            0L
        } else {
            (state.positionSec * 1000).toLong().coerceAtLeast(0L)
        }

    fun bufferedMs(state: BridgeState): Long =
        if (state.isAd) {
            0L
        } else {
            (state.bufferedSec * 1000).toLong().coerceAtLeast(positionMs(state))
        }

    fun translateSeek(
        currentIndex: Int,
        targetIndex: Int,
        targetPositionMs: Long,
        trackCount: Int,
        intent: SeekIntent = SeekIntent.DIRECT,
    ): SeekAction {
        if (trackCount <= 0) {
            return SeekAction.Ignore
        }
        return when (intent) {
            SeekIntent.NEXT -> {
                SeekAction.NextTrack
            }

            SeekIntent.PREVIOUS -> {
                if (targetIndex == currentIndex) SeekAction.SeekWithinTrack(0.0) else SeekAction.PreviousTrack
            }

            SeekIntent.DIRECT -> {
                when {
                    targetIndex < 0 || targetIndex >= trackCount -> SeekAction.Ignore
                    targetIndex == currentIndex -> SeekAction.SeekWithinTrack(targetPositionMs.coerceAtLeast(0L) / 1000.0)
                    targetIndex == currentIndex + 1 -> SeekAction.NextTrack
                    targetIndex == currentIndex - 1 -> SeekAction.PreviousTrack
                    else -> SeekAction.JumpToQueueIndex(targetIndex)
                }
            }
        }
    }

    fun previousAction(positionMs: Long): SeekAction =
        if (positionMs > PREVIOUS_RESTART_THRESHOLD_MS) {
            SeekAction.SeekWithinTrack(0.0)
        } else {
            SeekAction.PreviousTrack
        }

    fun nextRepeatMode(mode: RepeatMode): RepeatMode =
        when (mode) {
            RepeatMode.NONE -> RepeatMode.ALL
            RepeatMode.ALL -> RepeatMode.ONE
            RepeatMode.ONE -> RepeatMode.NONE
        }

    private fun fromState(
        state: BridgeState,
        uid: String,
        playlistId: String?,
    ): TrackSpec =
        merge(
            TrackSpec(
                uid = uid,
                mediaId = MediaIds.track(state.videoId.ifEmpty { "unknown" }, playlistId),
                videoId = state.videoId,
                title = state.title,
                artist = state.artist,
                album = state.album,
                artworkUrl = state.artworkUrl,
                durationMs = null,
                isAd = false,
            ),
            state,
        )

    private fun merge(
        base: TrackSpec,
        state: BridgeState,
    ): TrackSpec {
        if (state.isAd) {
            return base.copy(title = LOADING_TITLE, artist = "", album = "", artworkUrl = "", durationMs = null, isAd = true)
        }
        return base.copy(
            title = state.title.ifEmpty { base.title },
            artist = state.artist.ifEmpty { base.artist },
            album = state.album,
            artworkUrl = state.artworkUrl.ifEmpty { base.artworkUrl },
            durationMs = if (state.durationSec > 0) (state.durationSec * 1000).toLong() else base.durationMs,
        )
    }
}
