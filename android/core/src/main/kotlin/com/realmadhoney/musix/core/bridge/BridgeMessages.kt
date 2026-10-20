package com.realmadhoney.musix.core.bridge

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
sealed interface BridgeEvent {
    val v: Int

    @Serializable
    @SerialName("ready")
    data class Ready(
        override val v: Int,
        val platform: BridgePlatform,
        val clientVersion: String,
    ) : BridgeEvent

    @Serializable
    @SerialName("state")
    data class State(
        override val v: Int,
        val state: BridgeState,
    ) : BridgeEvent

    @Serializable
    @SerialName("queue")
    data class Queue(
        override val v: Int,
        val items: List<QueueEntry>,
    ) : BridgeEvent

    @Serializable
    @SerialName("browseResult")
    data class BrowseResult(
        override val v: Int,
        val requestId: String,
        val page: BrowsePage,
    ) : BridgeEvent

    @Serializable
    @SerialName("searchResult")
    data class SearchResult(
        override val v: Int,
        val requestId: String,
        val query: String,
        val page: BrowsePage,
    ) : BridgeEvent

    @Serializable
    @SerialName("signedIn")
    data class SignedIn(
        override val v: Int,
        val avatarUrl: String,
    ) : BridgeEvent

    @Serializable
    @SerialName("signedOut")
    data class SignedOut(
        override val v: Int,
    ) : BridgeEvent

    @Serializable
    @SerialName("adStart")
    data class AdStart(
        override val v: Int,
    ) : BridgeEvent

    @Serializable
    @SerialName("adEnd")
    data class AdEnd(
        override val v: Int,
    ) : BridgeEvent

    @Serializable
    @SerialName("ack")
    data class Ack(
        override val v: Int,
        val requestId: String,
    ) : BridgeEvent

    @Serializable
    @SerialName("error")
    data class Error(
        override val v: Int,
        val code: BridgeErrorCode,
        val message: String,
        val requestId: String?,
    ) : BridgeEvent
}

@Serializable
enum class ContinuationKind {
    @SerialName("browse")
    BROWSE,

    @SerialName("search")
    SEARCH,
}

@Serializable
sealed interface BridgeCommand {
    val v: Int
    val requestId: String

    @Serializable
    @SerialName("play")
    data class Play(
        override val requestId: String,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("pause")
    data class Pause(
        override val requestId: String,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("togglePlay")
    data class TogglePlay(
        override val requestId: String,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("next")
    data class Next(
        override val requestId: String,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("previous")
    data class Previous(
        override val requestId: String,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("seekTo")
    data class SeekTo(
        override val requestId: String,
        val seconds: Double,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("setVolume")
    data class SetVolume(
        override val requestId: String,
        val volume: Double,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("toggleMute")
    data class ToggleMute(
        override val requestId: String,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("toggleLike")
    data class ToggleLike(
        override val requestId: String,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("toggleDislike")
    data class ToggleDislike(
        override val requestId: String,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("setShuffle")
    data class SetShuffle(
        override val requestId: String,
        val enabled: Boolean,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("setRepeat")
    data class SetRepeat(
        override val requestId: String,
        val mode: RepeatMode,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("playVideoId")
    data class PlayVideoId(
        override val requestId: String,
        val videoId: String,
        val playlistId: String?,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("playQueueIndex")
    data class PlayQueueIndex(
        override val requestId: String,
        val index: Int,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("browse")
    data class Browse(
        override val requestId: String,
        val nodeId: String,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("search")
    data class Search(
        override val requestId: String,
        val query: String,
        val filter: SearchFilter,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("loadContinuation")
    data class LoadContinuation(
        override val requestId: String,
        val token: String,
        val kind: ContinuationKind,
        val nodeId: String,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("configure")
    data class Configure(
        override val requestId: String,
        val adSkip: Boolean,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("duck")
    data class Duck(
        override val requestId: String,
        val level: Double,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("playlistTargets")
    data class PlaylistTargets(
        override val requestId: String,
        val videoId: String,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("addToPlaylist")
    data class AddToPlaylist(
        override val requestId: String,
        val videoId: String,
        val playlistId: String,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand

    @Serializable
    @SerialName("savePlaylist")
    data class SavePlaylist(
        override val requestId: String,
        val playlistId: String,
        val save: Boolean,
        override val v: Int = BRIDGE_VERSION,
    ) : BridgeCommand
}
