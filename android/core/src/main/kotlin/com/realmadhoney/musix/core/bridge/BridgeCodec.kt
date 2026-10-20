package com.realmadhoney.musix.core.bridge

import kotlinx.serialization.SerializationException
import kotlinx.serialization.json.Json

sealed interface DecodeResult {
    data class Accepted(
        val event: BridgeEvent,
    ) : DecodeResult

    data class Rejected(
        val reason: String,
    ) : DecodeResult
}

object BridgeCodec {
    const val MAX_MESSAGE_CHARS = 4_000_000
    private const val MAX_TEXT = 2000
    private const val MAX_ID = 512
    private const val MAX_URL = 4096
    private const val MAX_TOKEN = 8192
    private const val MAX_ITEMS = 2000
    private const val MAX_SECTIONS = 200
    private const val MAX_REQUEST_ID = 64
    private val VIDEO_ID = Regex("^[A-Za-z0-9_-]{6,20}$")
    private val PLAYLIST_ID = Regex("^[A-Za-z0-9_-]{2,128}$")

    val json: Json =
        Json {
            classDiscriminator = "type"
            ignoreUnknownKeys = true
            encodeDefaults = true
            explicitNulls = true
            isLenient = false
            allowSpecialFloatingPointValues = false
        }

    fun decodeEvent(raw: String): DecodeResult {
        if (raw.length > MAX_MESSAGE_CHARS) {
            return DecodeResult.Rejected("message too large")
        }
        val event =
            try {
                json.decodeFromString(BridgeEvent.serializer(), raw)
            } catch (error: SerializationException) {
                return DecodeResult.Rejected(error.message ?: "malformed message")
            } catch (error: IllegalArgumentException) {
                return DecodeResult.Rejected(error.message ?: "malformed message")
            }
        val problem = problemWith(event)
        return if (problem == null) DecodeResult.Accepted(event) else DecodeResult.Rejected(problem)
    }

    fun encodeCommand(command: BridgeCommand): String {
        val problem = problemWith(command)
        require(problem == null) { problem ?: "invalid command" }
        return json.encodeToString(BridgeCommand.serializer(), command)
    }

    fun problemWith(event: BridgeEvent): String? {
        if (event.v != BRIDGE_VERSION) {
            return "unsupported version ${event.v}"
        }
        return when (event) {
            is BridgeEvent.Ready -> {
                if (event.clientVersion.length > 64) "client version too long" else null
            }

            is BridgeEvent.State -> {
                stateProblem(event.state)
            }

            is BridgeEvent.Queue -> {
                queueProblem(event.items)
            }

            is BridgeEvent.BrowseResult -> {
                requestIdProblem(event.requestId) ?: pageProblem(event.page)
            }

            is BridgeEvent.SearchResult -> {
                requestIdProblem(event.requestId)
                    ?: (if (event.query.length > 500) "query too long" else null)
                    ?: pageProblem(event.page)
            }

            is BridgeEvent.SignedIn -> {
                urlProblem(event.avatarUrl, "avatarUrl")
            }

            is BridgeEvent.SignedOut, is BridgeEvent.AdStart, is BridgeEvent.AdEnd -> {
                null
            }

            is BridgeEvent.Ack -> {
                requestIdProblem(event.requestId)
            }

            is BridgeEvent.Error -> {
                (if (event.message.length > MAX_TEXT) "error message too long" else null)
                    ?: event.requestId?.let { requestIdProblem(it) }
            }
        }
    }

    fun problemWith(command: BridgeCommand): String? {
        if (command.v != BRIDGE_VERSION) {
            return "unsupported version ${command.v}"
        }
        requestIdProblem(command.requestId)?.let { return it }
        return when (command) {
            is BridgeCommand.SeekTo -> {
                if (command.seconds.isFinite() && command.seconds >= 0) null else "invalid seek position"
            }

            is BridgeCommand.SetVolume -> {
                if (unit(command.volume)) null else "invalid volume"
            }

            is BridgeCommand.Duck -> {
                if (unit(command.level)) null else "invalid duck level"
            }

            is BridgeCommand.PlayVideoId -> {
                playProblem(command.videoId, command.playlistId)
            }

            is BridgeCommand.PlayQueueIndex -> {
                if (command.index in 0 until MAX_ITEMS) null else "invalid queue index"
            }

            is BridgeCommand.Browse -> {
                if (command.nodeId.isNotEmpty() && command.nodeId.length <= MAX_TOKEN) null else "invalid node"
            }

            is BridgeCommand.Search -> {
                if (command.query.isNotBlank() && command.query.length <= 500) null else "invalid query"
            }

            is BridgeCommand.LoadContinuation -> {
                if (command.token.isNotEmpty() && command.token.length <= MAX_TOKEN && command.nodeId.length <= MAX_TOKEN) {
                    null
                } else {
                    "invalid continuation"
                }
            }

            is BridgeCommand.PlaylistTargets -> {
                if (isValidVideoId(command.videoId)) null else "invalid video id"
            }

            is BridgeCommand.AddToPlaylist -> {
                if (isValidVideoId(command.videoId) && isValidPlaylistId(command.playlistId)) null else "invalid playlist target"
            }

            is BridgeCommand.SavePlaylist -> {
                if (isValidPlaylistId(command.playlistId)) null else "invalid playlist id"
            }

            is BridgeCommand.Play,
            is BridgeCommand.Pause,
            is BridgeCommand.TogglePlay,
            is BridgeCommand.Next,
            is BridgeCommand.Previous,
            is BridgeCommand.ToggleMute,
            is BridgeCommand.ToggleLike,
            is BridgeCommand.ToggleDislike,
            is BridgeCommand.SetShuffle,
            is BridgeCommand.SetRepeat,
            is BridgeCommand.Configure,
            -> {
                null
            }
        }
    }

    fun isValidVideoId(value: String): Boolean = VIDEO_ID.matches(value)

    fun isValidPlaylistId(value: String): Boolean = PLAYLIST_ID.matches(value)

    private fun playProblem(
        videoId: String,
        playlistId: String?,
    ): String? {
        if (playlistId != null && !isValidPlaylistId(playlistId)) {
            return "invalid playlist id"
        }
        if (videoId.isEmpty()) {
            return if (playlistId == null) "a video or playlist id is required" else null
        }
        return if (isValidVideoId(videoId)) null else "invalid video id"
    }

    private fun unit(value: Double): Boolean = value.isFinite() && value >= 0.0 && value <= 1.0

    private fun nonNegative(value: Double): Boolean = value.isFinite() && value >= 0.0

    private fun requestIdProblem(value: String): String? =
        if (value.isNotEmpty() &&
            value.length <= MAX_REQUEST_ID
        ) {
            null
        } else {
            "invalid request id"
        }

    private fun textProblem(
        value: String,
        max: Int,
        field: String,
    ): String? = if (value.length <= max) null else "$field too long"

    private fun urlProblem(
        value: String,
        field: String,
    ): String? {
        if (value.length > MAX_URL) {
            return "$field too long"
        }
        return if (value.isEmpty() || value.startsWith("https://")) null else "$field must be https"
    }

    private fun stateProblem(state: BridgeState): String? =
        textProblem(state.videoId, MAX_ID, "videoId")
            ?: textProblem(state.playlistId, MAX_ID, "playlistId")
            ?: textProblem(state.title, MAX_TEXT, "title")
            ?: textProblem(state.artist, MAX_TEXT, "artist")
            ?: textProblem(state.album, MAX_TEXT, "album")
            ?: urlProblem(state.artworkUrl, "artworkUrl")
            ?: (if (nonNegative(state.durationSec)) null else "invalid duration")
            ?: (if (nonNegative(state.positionSec)) null else "invalid position")
            ?: (if (nonNegative(state.bufferedSec)) null else "invalid buffered position")
            ?: (if (unit(state.volume)) null else "invalid volume")

    private fun queueProblem(items: List<QueueEntry>): String? {
        if (items.size > MAX_ITEMS) {
            return "queue too long"
        }
        for (entry in items) {
            val problem =
                (if (entry.index >= 0) null else "invalid queue index")
                    ?: textProblem(entry.videoId, MAX_ID, "videoId")
                    ?: textProblem(entry.title, MAX_TEXT, "title")
                    ?: textProblem(entry.artist, MAX_TEXT, "artist")
                    ?: textProblem(entry.artworkUrl, MAX_URL, "artworkUrl")
                    ?: (if (nonNegative(entry.durationSec)) null else "invalid duration")
            if (problem != null) {
                return problem
            }
        }
        return null
    }

    private fun itemProblem(item: FlatItem): String? =
        (if (item.id.isNotEmpty() && item.id.length <= MAX_TOKEN) null else "invalid item id")
            ?: textProblem(item.title, MAX_TEXT, "title")
            ?: textProblem(item.subtitle, MAX_TEXT, "subtitle")
            ?: textProblem(item.artworkUrl, MAX_URL, "artworkUrl")
            ?: item.videoId?.let { textProblem(it, MAX_ID, "videoId") }
            ?: item.playlistId?.let { textProblem(it, MAX_ID, "playlistId") }
            ?: item.browseId?.let { textProblem(it, MAX_TOKEN, "browseId") }
            ?: item.continuation?.let { textProblem(it, MAX_TOKEN, "continuation") }
            ?: item.durationSec?.let { if (nonNegative(it)) null else "invalid duration" }

    private fun pageProblem(page: BrowsePage): String? {
        val header =
            textProblem(page.nodeId, MAX_TOKEN, "nodeId")
                ?: textProblem(page.title, MAX_TEXT, "title")
                ?: page.continuation?.let { textProblem(it, MAX_TOKEN, "continuation") }
                ?: (if (page.sections.size <= MAX_SECTIONS) null else "too many sections")
                ?: (if (page.items.size <= MAX_ITEMS) null else "too many items")
        if (header != null) {
            return header
        }
        for (section in page.sections) {
            val problem =
                textProblem(section.id, MAX_TOKEN, "section id")
                    ?: textProblem(section.title, MAX_TEXT, "section title")
                    ?: section.browseId?.let { textProblem(it, MAX_TOKEN, "section browseId") }
                    ?: (if (section.items.size <= MAX_ITEMS) null else "too many section items")
                    ?: section.items.firstNotNullOfOrNull { itemProblem(it) }
            if (problem != null) {
                return problem
            }
        }
        return page.items.firstNotNullOfOrNull { itemProblem(it) }
    }
}
