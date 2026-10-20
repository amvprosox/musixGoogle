package com.realmadhoney.musix.core.bridge

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

const val BRIDGE_VERSION = 1

@Serializable
enum class LikeStatus { LIKE, DISLIKE, INDIFFERENT }

@Serializable
enum class RepeatMode { NONE, ALL, ONE }

@Serializable
enum class ItemType {
    @SerialName("song")
    SONG,

    @SerialName("video")
    VIDEO,

    @SerialName("album")
    ALBUM,

    @SerialName("playlist")
    PLAYLIST,

    @SerialName("artist")
    ARTIST,

    @SerialName("shelf")
    SHELF,
}

@Serializable
enum class SearchFilter {
    @SerialName("all")
    ALL,

    @SerialName("songs")
    SONGS,

    @SerialName("videos")
    VIDEOS,

    @SerialName("albums")
    ALBUMS,

    @SerialName("playlists")
    PLAYLISTS,

    @SerialName("artists")
    ARTISTS,
}

@Serializable
enum class BridgePlatform {
    @SerialName("electron")
    ELECTRON,

    @SerialName("android")
    ANDROID,

    @SerialName("ios")
    IOS,

    @SerialName("none")
    NONE,
}

@Serializable
enum class BridgeErrorCode {
    @SerialName("not_ready")
    NOT_READY,

    @SerialName("not_signed_in")
    NOT_SIGNED_IN,

    @SerialName("network")
    NETWORK,

    @SerialName("http")
    HTTP,

    @SerialName("parse")
    PARSE,

    @SerialName("invalid_command")
    INVALID_COMMAND,

    @SerialName("unsupported")
    UNSUPPORTED,

    @SerialName("element_missing")
    ELEMENT_MISSING,
}

@Serializable
data class BridgeState(
    val videoId: String,
    val playlistId: String,
    val title: String,
    val artist: String,
    val album: String,
    val artworkUrl: String,
    val durationSec: Double,
    val positionSec: Double,
    val bufferedSec: Double,
    val isPlaying: Boolean,
    val isBuffering: Boolean,
    val volume: Double,
    val isMuted: Boolean,
    val likeStatus: LikeStatus,
    val shuffle: Boolean,
    val repeatMode: RepeatMode,
    val isAd: Boolean,
    val isSignedIn: Boolean,
) {
    val hasTrack: Boolean get() = videoId.isNotEmpty() || title.isNotEmpty()

    companion object {
        val EMPTY =
            BridgeState(
                videoId = "",
                playlistId = "",
                title = "",
                artist = "",
                album = "",
                artworkUrl = "",
                durationSec = 0.0,
                positionSec = 0.0,
                bufferedSec = 0.0,
                isPlaying = false,
                isBuffering = false,
                volume = 1.0,
                isMuted = false,
                likeStatus = LikeStatus.INDIFFERENT,
                shuffle = false,
                repeatMode = RepeatMode.NONE,
                isAd = false,
                isSignedIn = false,
            )
    }
}

@Serializable
data class QueueEntry(
    val index: Int,
    val videoId: String,
    val title: String,
    val artist: String,
    val artworkUrl: String,
    val durationSec: Double,
    val isCurrent: Boolean,
)

@Serializable
data class FlatItem(
    val id: String,
    val title: String,
    val subtitle: String,
    val artworkUrl: String,
    val type: ItemType,
    val playable: Boolean,
    val browsable: Boolean,
    val videoId: String?,
    val playlistId: String?,
    val browseId: String?,
    val durationSec: Double?,
    val continuation: String?,
)

@Serializable
data class FlatSection(
    val id: String,
    val title: String,
    val browseId: String?,
    val items: List<FlatItem>,
)

@Serializable
data class BrowsePage(
    val nodeId: String,
    val title: String,
    val sections: List<FlatSection>,
    val items: List<FlatItem>,
    val continuation: String?,
)
