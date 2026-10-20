package com.realmadhoney.musix.core.resume

import com.realmadhoney.musix.core.bridge.BridgeCodec
import com.realmadhoney.musix.core.bridge.BridgeState
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

@Serializable
data class ResumeSnapshot(
    val videoId: String,
    val playlistId: String?,
    val title: String,
    val artist: String,
    val album: String,
    val artworkUrl: String,
    val positionSec: Double,
    val durationSec: Double,
    val savedAt: Long,
) {
    val positionMs: Long get() = (positionSec * 1000).toLong().coerceAtLeast(0L)

    companion object {
        private val json = Json { ignoreUnknownKeys = true }
        private const val END_MARGIN_SEC = 5.0

        fun from(
            state: BridgeState,
            now: Long,
        ): ResumeSnapshot? {
            if (state.isAd || !BridgeCodec.isValidVideoId(state.videoId) || state.title.isBlank()) {
                return null
            }
            val nearEnd = state.durationSec > 0 && state.positionSec >= state.durationSec - END_MARGIN_SEC
            return ResumeSnapshot(
                videoId = state.videoId,
                playlistId = state.playlistId.takeIf { BridgeCodec.isValidPlaylistId(it) },
                title = state.title,
                artist = state.artist,
                album = state.album,
                artworkUrl = state.artworkUrl,
                positionSec = if (nearEnd) 0.0 else state.positionSec.coerceAtLeast(0.0),
                durationSec = state.durationSec,
                savedAt = now,
            )
        }

        fun encode(snapshot: ResumeSnapshot): String = json.encodeToString(serializer(), snapshot)

        fun decode(raw: String?): ResumeSnapshot? {
            if (raw.isNullOrBlank()) {
                return null
            }
            val parsed =
                try {
                    json.decodeFromString(serializer(), raw)
                } catch (error: SerializationException) {
                    return null
                } catch (error: IllegalArgumentException) {
                    return null
                }
            return parsed.takeIf { BridgeCodec.isValidVideoId(it.videoId) && it.positionSec.isFinite() }
        }
    }
}
