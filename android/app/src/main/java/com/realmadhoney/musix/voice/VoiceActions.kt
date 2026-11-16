package com.realmadhoney.musix.voice

import android.content.Context
import android.media.AudioManager
import androidx.media3.common.Player
import com.realmadhoney.musix.core.bridge.BridgeCodec
import com.realmadhoney.musix.core.bridge.BridgeCommand
import com.realmadhoney.musix.core.bridge.BrowsePage
import com.realmadhoney.musix.core.bridge.CommandResult
import com.realmadhoney.musix.core.bridge.FlatItem
import com.realmadhoney.musix.core.bridge.LikeStatus
import com.realmadhoney.musix.core.bridge.RepeatMode
import com.realmadhoney.musix.core.bridge.SearchFilter
import com.realmadhoney.musix.core.voice.VoiceAction
import com.realmadhoney.musix.core.voice.VoiceIntentMatcher
import com.realmadhoney.musix.data.SettingsRepository
import com.realmadhoney.musix.download.DownloadItem
import com.realmadhoney.musix.download.DownloadRepository
import com.realmadhoney.musix.download.DownloadStatus
import com.realmadhoney.musix.download.DownloadTrackSpec
import com.realmadhoney.musix.engine.WebEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.launch
import java.io.File

sealed interface VoiceUiRequest {
    data class OpenTab(
        val tab: String,
    ) : VoiceUiRequest

    data class OpenBrowse(
        val browseId: String,
    ) : VoiceUiRequest

    data object OpenSettings : VoiceUiRequest

    data object OpenNowPlaying : VoiceUiRequest

    data class Lyrics(
        val show: Boolean,
    ) : VoiceUiRequest

    data class Search(
        val query: String,
    ) : VoiceUiRequest

    data object FocusSearch : VoiceUiRequest
}

class VoiceActions(
    context: Context,
    private val voice: VoiceController,
    private val engine: StateFlow<WebEngine?>,
    private val downloads: DownloadRepository,
    private val settings: SettingsRepository,
    private val online: StateFlow<Boolean>,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val requestFlow = MutableSharedFlow<VoiceUiRequest>(extraBufferCapacity = 8)
    val requests: SharedFlow<VoiceUiRequest> = requestFlow.asSharedFlow()

    init {
        scope.launch { voice.commands.collect { execute(it) } }
    }

    private val offlineActive: Boolean get() = downloads.offlineNowPlaying.value != null

    private fun ui(request: VoiceUiRequest) {
        requestFlow.tryEmit(request)
    }

    private suspend fun player(build: (String) -> BridgeCommand): Boolean {
        val active = engine.value ?: return false
        return active.queue.player(build) == CommandResult.Acknowledged
    }

    private fun pauseOnline() {
        scope.launch { player { BridgeCommand.Pause(it) } }
    }

    private fun completed(): List<DownloadItem> =
        downloads.items.value.filter { it.status == DownloadStatus.COMPLETED && File(it.audioPath).isFile }

    private suspend fun execute(command: VoiceCommandEvent) {
        voice.notice(if (command.transcript.isEmpty()) command.action.label else "\"${command.transcript}\"")
        if (command.reply.isNotEmpty()) voice.say(command.reply)
        val bridge = engine.value?.bridgeState?.value
        val offline = offlineActive
        when (command.action) {
            VoiceAction.Pause -> {
                if (!downloads.setOfflinePlaying(false)) player { BridgeCommand.Pause(it) }
            }

            VoiceAction.Resume -> {
                if (!downloads.setOfflinePlaying(true)) player { BridgeCommand.Play(it) }
            }

            VoiceAction.Next -> {
                if (!downloads.nextOffline(::pauseOnline)) player { BridgeCommand.Next(it) }
            }

            VoiceAction.Previous -> {
                if (!downloads.previousOffline(::pauseOnline)) player { BridgeCommand.Previous(it) }
            }

            VoiceAction.ShuffleOn, VoiceAction.ShuffleOff -> {
                val enabled = command.action == VoiceAction.ShuffleOn
                if (!downloads.setOfflineShuffle(enabled)) player { BridgeCommand.SetShuffle(it, enabled) }
            }

            VoiceAction.Repeat, VoiceAction.RepeatOne, VoiceAction.RepeatOff -> {
                val (offlineMode, onlineMode) =
                    when (command.action) {
                        VoiceAction.Repeat -> Player.REPEAT_MODE_ALL to RepeatMode.ALL
                        VoiceAction.RepeatOne -> Player.REPEAT_MODE_ONE to RepeatMode.ONE
                        else -> Player.REPEAT_MODE_OFF to RepeatMode.NONE
                    }
                if (!downloads.setOfflineRepeat(offlineMode)) player { BridgeCommand.SetRepeat(it, onlineMode) }
            }

            VoiceAction.Like, VoiceAction.Dislike -> {
                val like = command.action == VoiceAction.Like
                when {
                    offline || bridge == null || !bridge.hasTrack -> {
                        voice.say("Liking songs needs YouTube Music playing.")
                    }

                    like && bridge.likeStatus != LikeStatus.LIKE -> {
                        player { BridgeCommand.ToggleLike(it) }
                    }

                    !like && bridge.likeStatus != LikeStatus.DISLIKE -> {
                        player { BridgeCommand.ToggleDislike(it) }
                    }
                }
            }

            VoiceAction.VolumeUp, VoiceAction.VolumeDown -> {
                val direction = if (command.action == VoiceAction.VolumeUp) AudioManager.ADJUST_RAISE else AudioManager.ADJUST_LOWER
                repeat(VOLUME_STEPS) {
                    audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, 0)
                }
                audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, AudioManager.ADJUST_SAME, AudioManager.FLAG_SHOW_UI)
            }

            VoiceAction.Mute, VoiceAction.Unmute -> {
                val direction = if (command.action == VoiceAction.Mute) AudioManager.ADJUST_MUTE else AudioManager.ADJUST_UNMUTE
                audioManager.adjustStreamVolume(AudioManager.STREAM_MUSIC, direction, AudioManager.FLAG_SHOW_UI)
            }

            VoiceAction.SeekForward, VoiceAction.SeekBack, VoiceAction.Restart -> {
                seek(command.action, bridge?.positionSec ?: 0.0)
            }

            VoiceAction.WhatsPlaying -> {
                val now = downloads.offlineNowPlaying.value
                val title = now?.title ?: bridge?.title.orEmpty()
                val artist = now?.artist ?: bridge?.artist.orEmpty()
                if (title.isEmpty()) {
                    voice.say("Nothing is playing right now.")
                } else {
                    val line = if (artist.isEmpty()) title else "$title by $artist"
                    voice.notice("Now playing: $line")
                    voice.say("This is $line")
                }
            }

            VoiceAction.ShowLyrics, VoiceAction.HideLyrics -> {
                ui(VoiceUiRequest.Lyrics(command.action == VoiceAction.ShowLyrics))
            }

            VoiceAction.DownloadSong -> {
                downloadCurrent()
            }

            VoiceAction.SetTheme -> {
                val theme = themeFromSpeech(command.query)
                if (theme != null) {
                    settings.setTheme(theme)
                } else {
                    voice.notice("I do not know the \"${command.query}\" theme.")
                }
            }

            VoiceAction.Search -> {
                ui(VoiceUiRequest.Search(command.query))
            }

            VoiceAction.Play -> {
                play(command.query)
            }

            VoiceAction.PlayDownloads -> {
                val first = completed().firstOrNull()
                if (first != null) {
                    downloads.playOffline(first, ::pauseOnline)
                } else {
                    voice.say("You have no downloads yet.")
                }
            }

            VoiceAction.PlayDownloadedPlaylist -> {
                playDownloadedPlaylist(command.query)
            }

            VoiceAction.OpenHome -> {
                ui(VoiceUiRequest.OpenTab("home"))
            }

            VoiceAction.OpenExplore -> {
                ui(VoiceUiRequest.OpenTab("explore"))
            }

            VoiceAction.OpenLibrary -> {
                ui(VoiceUiRequest.OpenTab("library"))
            }

            VoiceAction.OpenLiked -> {
                ui(VoiceUiRequest.OpenBrowse("VLLM"))
            }

            VoiceAction.OpenPlaylists -> {
                ui(VoiceUiRequest.OpenBrowse("FEmusic_liked_playlists"))
            }

            VoiceAction.OpenDownloads -> {
                ui(VoiceUiRequest.OpenTab("downloads"))
            }

            VoiceAction.OpenSettings -> {
                ui(VoiceUiRequest.OpenSettings)
            }

            VoiceAction.OpenQueue -> {
                ui(VoiceUiRequest.OpenNowPlaying)
            }

            VoiceAction.OpenSearch -> {
                ui(VoiceUiRequest.FocusSearch)
            }
        }
    }

    private suspend fun seek(
        action: VoiceAction,
        onlinePositionSec: Double,
    ) {
        val offlinePosition = downloads.offlinePositionMs()
        if (offlinePosition != null) {
            val target =
                when (action) {
                    VoiceAction.SeekForward -> offlinePosition + SEEK_MS
                    VoiceAction.SeekBack -> offlinePosition - SEEK_MS
                    else -> 0L
                }
            downloads.seekOfflineTo(target.coerceAtLeast(0L))
            return
        }
        val target =
            when (action) {
                VoiceAction.SeekForward -> onlinePositionSec + SEEK_SECONDS
                VoiceAction.SeekBack -> onlinePositionSec - SEEK_SECONDS
                else -> 0.0
            }
        player { BridgeCommand.SeekTo(it, target.coerceAtLeast(0.0)) }
    }

    private fun downloadCurrent() {
        val bridge = engine.value?.bridgeState?.value
        if (offlineActive) {
            voice.say("This song is already downloaded.")
            return
        }
        if (bridge == null || !bridge.hasTrack || bridge.isAd || !BridgeCodec.isValidVideoId(bridge.videoId)) {
            voice.say("Play a song first.")
            return
        }
        downloads.startDownload(
            DownloadTrackSpec(
                videoId = bridge.videoId,
                title = bridge.title.ifEmpty { bridge.videoId },
                artist = bridge.artist,
                album = bridge.album,
                durationSec = bridge.durationSec.toLong().coerceAtLeast(0L),
                artworkUrl = bridge.artworkUrl,
            ),
        )
    }

    private suspend fun play(query: String) {
        val wantsOnline = online.value && !offlineActive
        if (wantsOnline) {
            val title = playFromSearch(query)
            if (title != null) {
                voice.notice("Playing $title")
                return
            }
        }
        val match =
            VoiceMatching.best(query, completed()) { item ->
                listOf(item.title, "${item.title} ${item.artist}", item.artist)
            }
        if (match != null) {
            downloads.playOffline(match, ::pauseOnline)
            voice.notice("Playing offline: ${match.title}")
        } else {
            voice.notice("I could not find \"$query\".")
            voice.say("I could not find that.")
        }
    }

    private suspend fun playFromSearch(query: String): String? {
        val active = engine.value ?: return null
        val lowered = VoiceIntentMatcher.normalize(query)
        val (filter, text) =
            when {
                lowered.startsWith("playlist ") -> SearchFilter.PLAYLISTS to lowered.removePrefix("playlist ")
                lowered.startsWith("album ") -> SearchFilter.ALBUMS to lowered.removePrefix("album ")
                lowered.startsWith("the album ") -> SearchFilter.ALBUMS to lowered.removePrefix("the album ")
                else -> SearchFilter.SONGS to query
            }
        val result = active.queue.data { BridgeCommand.Search(it, text, filter) }
        val page = (result as? CommandResult.Page)?.page ?: return null
        val items = page.allItems()
        if (filter == SearchFilter.SONGS) {
            val song = items.firstOrNull { it.videoId != null } ?: return null
            val videoId = song.videoId ?: return null
            player { BridgeCommand.PlayVideoId(it, videoId, song.playlistId) }
            return song.title
        }
        val collection = items.firstOrNull { it.browseId != null || it.playlistId != null } ?: return null
        val browseId = collection.browseId
        val inner =
            if (browseId != null) {
                (active.queue.data { BridgeCommand.Browse(it, browseId) } as? CommandResult.Page)?.page
            } else {
                null
            }
        val first = inner?.allItems()?.firstOrNull { it.videoId != null } ?: return null
        val videoId = first.videoId ?: return null
        player { BridgeCommand.PlayVideoId(it, videoId, first.playlistId ?: collection.playlistId) }
        return collection.title
    }

    private fun BrowsePage.allItems(): List<FlatItem> = items + sections.flatMap { it.items }

    private fun playDownloadedPlaylist(query: String) {
        val library = VoiceMatching.best(query, downloads.savedLibraries.value) { listOf(it.title) }
        val byId = completed().associateBy { it.videoId }
        val scope = library?.videoIds?.filter { byId.containsKey(it) }.orEmpty()
        val first = scope.firstOrNull()?.let { byId[it] }
        if (library != null && first != null) {
            downloads.playOffline(first, ::pauseOnline, scope = scope)
            voice.notice("Playing offline: ${library.title}")
        } else {
            voice.notice("No downloaded playlist matches \"$query\".")
            voice.say("I could not find that playlist in your downloads.")
        }
    }

    private fun themeFromSpeech(query: String): String? {
        val text = VoiceIntentMatcher.normalize(query)
        val table =
            listOf(
                "graphite" to listOf("graphite", "grey", "gray", "dark grey", "dark gray"),
                "slate" to listOf("slate", "slate grey", "slate gray", "light grey", "light gray"),
                "amoled" to listOf("amoled", "black", "pure black", "oled"),
                "light" to listOf("light", "white", "bright", "day"),
                "dark" to listOf("midnight", "dark", "blue", "navy", "night"),
            )
        var best: String? = null
        var bestScore = 0.0
        for ((theme, words) in table) {
            for (word in words) {
                val score = if (text.contains(word)) 1.0 else VoiceIntentMatcher.similarity(text, word)
                if (score > bestScore) {
                    bestScore = score
                    best = theme
                }
            }
        }
        return if (bestScore >= THEME_MATCH) best else null
    }

    private companion object {
        const val VOLUME_STEPS = 2
        const val SEEK_MS = 10_000L
        const val SEEK_SECONDS = 10.0
        const val THEME_MATCH = 0.6
    }
}

object VoiceMatching {
    private const val CONTAINS_SCORE = 0.9
    private const val MIN_SCORE = 0.55

    fun <T> best(
        query: String,
        items: List<T>,
        text: (T) -> List<String>,
    ): T? {
        val needle = VoiceIntentMatcher.normalize(query)
        if (needle.isEmpty()) return null
        var best: T? = null
        var bestScore = 0.0
        for (item in items) {
            for (raw in text(item)) {
                val hay = VoiceIntentMatcher.normalize(raw)
                if (hay.isEmpty()) continue
                val contains = if (hay.contains(needle) || needle.contains(hay)) CONTAINS_SCORE else 0.0
                val score = maxOf(contains, VoiceIntentMatcher.similarity(needle, hay))
                if (score > bestScore) {
                    bestScore = score
                    best = item
                }
            }
        }
        return if (bestScore >= MIN_SCORE) best else null
    }
}
