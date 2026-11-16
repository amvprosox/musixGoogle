package com.realmadhoney.musix.core.voice

enum class VoiceAction(
    val id: String,
    val label: String,
) {
    Pause("pause", "Pause"),
    Resume("resume", "Resume"),
    Next("next", "Next song"),
    Previous("previous", "Previous song"),
    ShuffleOn("shuffleOn", "Shuffle on"),
    ShuffleOff("shuffleOff", "Shuffle off"),
    Repeat("repeat", "Repeat all"),
    RepeatOne("repeatOne", "Repeat this song"),
    RepeatOff("repeatOff", "Repeat off"),
    Like("like", "Like song"),
    Dislike("dislike", "Dislike song"),
    VolumeUp("volumeUp", "Volume up"),
    VolumeDown("volumeDown", "Volume down"),
    Mute("mute", "Mute"),
    Unmute("unmute", "Unmute"),
    SeekForward("seekForward", "Forward 10 seconds"),
    SeekBack("seekBack", "Back 10 seconds"),
    Restart("restart", "Restart song"),
    WhatsPlaying("whatsPlaying", "What's playing"),
    ShowLyrics("showLyrics", "Show lyrics"),
    HideLyrics("hideLyrics", "Hide lyrics"),
    DownloadSong("downloadSong", "Download this song"),
    SetTheme("setTheme", "Change theme"),
    Search("search", "Search"),
    Play("play", "Play something"),
    PlayDownloads("playDownloads", "Play downloads"),
    PlayDownloadedPlaylist("playDownloadedPlaylist", "Play a downloaded playlist"),
    OpenHome("openHome", "Open Home"),
    OpenExplore("openExplore", "Open Explore"),
    OpenLibrary("openLibrary", "Open Library"),
    OpenLiked("openLiked", "Open Liked songs"),
    OpenPlaylists("openPlaylists", "Open Playlists"),
    OpenDownloads("openDownloads", "Open Downloads"),
    OpenSettings("openSettings", "Open Settings"),
    OpenQueue("openQueue", "Open queue"),
    OpenSearch("openSearch", "Open Search"),
    ;

    companion object {
        fun fromId(id: String): VoiceAction? = entries.firstOrNull { it.id == id }
    }
}

data class VoiceCommand(
    val action: VoiceAction,
    val phrases: List<String>,
)

data class VoiceIntent(
    val action: VoiceAction,
    val query: String,
    val score: Double,
)

data class WakeResult(
    val heard: Boolean,
    val rest: String,
)

object VoiceIntentMatcher {
    const val WAKE_WORD = "veru"
    const val OUT_OF_SCOPE_REPLY = "I can only control Musix music playback."
    private const val MATCH_THRESHOLD = 0.72
    private const val STRONG_MATCH = 0.8
    private const val TAIL_PENALTY = 0.9
    private const val WAKE_THRESHOLD = 0.7
    private const val SLOT = "{query}"
    private const val SLOT_MARK = "qqslotqq"
    private const val MAX_PHRASES = 12
    private const val MAX_PHRASE_CHARS = 80
    private const val MAX_REPLY_CHARS = 160
    private val wakeVariants =
        listOf(
            "veru",
            "vero",
            "beru",
            "be ru",
            "veyru",
            "vey ru",
            "biro",
            "bi ro",
            "bero",
            "be ro",
            "berru",
            "biru",
            "vayru",
            "bayru",
            "ve ru",
            "veroo",
            "beroo",
            "beyru",
            "bey ru",
        )
    private val wakeDeny = setOf("very", "every", "vary", "berry", "bury", "bureau", "burrow", "borrow", "barrow", "bureaus")
    private val outOfScope =
        listOf(
            "source code",
            "your code",
            "the code",
            "codebase",
            "code base",
            "programming",
            "developer mode",
            "developer",
            "system prompt",
            "your prompt",
            "your instructions",
            "ignore previous",
            "ignore your",
            "ignore all",
            "forget your",
            "jailbreak",
            "api key",
            "password",
            "token",
            "terminal",
            "command line",
            "run a command",
            "shell command",
            "execute",
            "delete files",
            "internal",
            "how are you built",
            "how were you made",
            "what model are you",
            "which model",
            "hack",
            "exploit",
        )

    val defaultCommands: List<VoiceCommand> =
        listOf(
            VoiceCommand(VoiceAction.Pause, listOf("pause", "pause the music", "stop", "stop the music", "stop playing")),
            VoiceCommand(VoiceAction.Resume, listOf("resume", "play", "continue", "keep playing", "play the music")),
            VoiceCommand(
                VoiceAction.Next,
                listOf("next", "next song", "skip", "skip this", "skip this song", "play the next song"),
            ),
            VoiceCommand(
                VoiceAction.Previous,
                listOf("previous", "previous song", "go back", "last song", "play the previous song", "back"),
            ),
            VoiceCommand(VoiceAction.ShuffleOn, listOf("shuffle", "shuffle on", "turn on shuffle", "shuffle the music")),
            VoiceCommand(VoiceAction.ShuffleOff, listOf("shuffle off", "turn off shuffle", "stop shuffle", "no shuffle")),
            VoiceCommand(VoiceAction.Repeat, listOf("repeat", "repeat all", "turn on repeat", "loop", "loop everything")),
            VoiceCommand(
                VoiceAction.RepeatOne,
                listOf("repeat this song", "repeat this", "repeat one", "loop this song", "on repeat"),
            ),
            VoiceCommand(VoiceAction.RepeatOff, listOf("repeat off", "turn off repeat", "stop repeating", "no repeat")),
            VoiceCommand(VoiceAction.Like, listOf("like", "like this", "like this song", "i like this song")),
            VoiceCommand(VoiceAction.Dislike, listOf("dislike", "dislike this", "i dont like this", "thumbs down")),
            VoiceCommand(VoiceAction.VolumeUp, listOf("volume up", "louder", "turn it up", "turn up the volume")),
            VoiceCommand(VoiceAction.VolumeDown, listOf("volume down", "quieter", "turn it down", "turn down the volume")),
            VoiceCommand(VoiceAction.Mute, listOf("mute", "mute the music", "silence")),
            VoiceCommand(VoiceAction.Unmute, listOf("unmute", "unmute the music", "sound on")),
            VoiceCommand(
                VoiceAction.SeekForward,
                listOf("forward", "skip forward", "fast forward", "forward ten seconds"),
            ),
            VoiceCommand(
                VoiceAction.SeekBack,
                listOf("rewind", "go back ten seconds", "skip back", "back ten seconds"),
            ),
            VoiceCommand(
                VoiceAction.Restart,
                listOf("restart", "restart the song", "play from the start", "start over"),
            ),
            VoiceCommand(
                VoiceAction.WhatsPlaying,
                listOf("whats playing", "what song is this", "what is this song", "who is singing", "what am i listening to"),
            ),
            VoiceCommand(VoiceAction.ShowLyrics, listOf("show lyrics", "lyrics", "open lyrics", "show the lyrics")),
            VoiceCommand(VoiceAction.HideLyrics, listOf("hide lyrics", "close lyrics", "hide the lyrics")),
            VoiceCommand(
                VoiceAction.DownloadSong,
                listOf("download this song", "download this", "save this song offline", "download"),
            ),
            VoiceCommand(
                VoiceAction.SetTheme,
                listOf(
                    "switch to {query} theme",
                    "change theme to {query}",
                    "use {query} theme",
                    "{query} mode",
                    "theme {query}",
                ),
            ),
            VoiceCommand(
                VoiceAction.Search,
                listOf("search {query}", "search for {query}", "find {query}", "look for {query}"),
            ),
            VoiceCommand(
                VoiceAction.PlayDownloadedPlaylist,
                listOf(
                    "play my downloaded playlist {query}",
                    "play downloaded playlist {query}",
                    "play my downloaded {query}",
                    "play offline playlist {query}",
                ),
            ),
            VoiceCommand(
                VoiceAction.PlayDownloads,
                listOf("play my downloads", "play downloads", "play offline", "play my offline music", "play downloaded songs"),
            ),
            VoiceCommand(
                VoiceAction.Play,
                listOf("play {query}", "put on {query}", "i want to hear {query}", "listen to {query}"),
            ),
            VoiceCommand(VoiceAction.OpenHome, listOf("open home", "go home", "home")),
            VoiceCommand(VoiceAction.OpenExplore, listOf("open explore", "explore", "go to explore")),
            VoiceCommand(VoiceAction.OpenLibrary, listOf("open library", "open my library", "library")),
            VoiceCommand(
                VoiceAction.OpenLiked,
                listOf("open liked songs", "open my liked songs", "liked songs", "open liked music"),
            ),
            VoiceCommand(VoiceAction.OpenPlaylists, listOf("open playlists", "open my playlists", "my playlists")),
            VoiceCommand(VoiceAction.OpenDownloads, listOf("open downloads", "open my downloads", "show downloads")),
            VoiceCommand(VoiceAction.OpenSettings, listOf("open settings", "settings", "show settings")),
            VoiceCommand(VoiceAction.OpenQueue, listOf("open queue", "show queue", "whats next", "show up next")),
            VoiceCommand(VoiceAction.OpenSearch, listOf("open search", "go to search")),
        )

    fun normalize(text: String): String {
        val lowered = text.lowercase().replace("'", "").replace("’", "")
        val out = StringBuilder()
        var lastSpace = true
        for (char in lowered) {
            if (char in 'a'..'z' || char in '0'..'9') {
                out.append(char)
                lastSpace = false
            } else if (!lastSpace) {
                out.append(' ')
                lastSpace = true
            }
        }
        return out.toString().trim()
    }

    fun similarity(
        a: String,
        b: String,
    ): Double {
        if (a == b) return 1.0
        if (a.isEmpty() || b.isEmpty()) return 0.0
        var prev = IntArray(b.length + 1) { it }
        for (i in 1..a.length) {
            val cur = IntArray(b.length + 1)
            cur[0] = i
            for (j in 1..b.length) {
                val cost = if (a[i - 1] == b[j - 1]) 0 else 1
                cur[j] = minOf(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost)
            }
            prev = cur
        }
        return 1.0 - prev[b.length].toDouble() / maxOf(a.length, b.length)
    }

    private fun words(text: String): List<String> = text.split(' ').filter { it.isNotEmpty() }

    fun stripWakeWord(text: String): WakeResult {
        val words = words(normalize(text))
        if (words.firstOrNull() in wakeDeny) return WakeResult(false, words.joinToString(" "))
        for (take in listOf(2, 1)) {
            if (words.size < take) continue
            val head = words.take(take).joinToString(" ")
            val best = wakeVariants.maxOf { similarity(head, it) }
            if (best >= WAKE_THRESHOLD) {
                return WakeResult(true, words.drop(take).joinToString(" "))
            }
        }
        return WakeResult(false, words.joinToString(" "))
    }

    private fun fixedWordCount(phrase: String): Int = words(phrase).count { it != SLOT }

    private fun matchSlot(
        words: List<String>,
        phrase: String,
    ): Pair<Double, String>? {
        val parts = phrase.split(SLOT).map { it.trim() }
        val prefixText = parts.firstOrNull().orEmpty()
        val suffixText = parts.getOrNull(1).orEmpty()
        val prefixWords = words(prefixText)
        val suffixWords = words(suffixText)
        var best: Pair<Double, String>? = null
        for (delta in listOf(0, -1, 1)) {
            val take = prefixWords.size + delta
            if (take < 0 || (prefixWords.isNotEmpty() && take == 0) || take >= words.size) continue
            val head = words.take(take).joinToString(" ")
            val prefixScore = if (prefixWords.isEmpty()) 1.0 else similarity(head, prefixText)
            var rest = words.drop(take)
            var suffixScore = 1.0
            if (suffixWords.isNotEmpty()) {
                if (rest.size <= suffixWords.size) continue
                suffixScore = similarity(rest.takeLast(suffixWords.size).joinToString(" "), suffixText)
                rest = rest.dropLast(suffixWords.size)
            }
            val query = rest.joinToString(" ").trim()
            if (query.isEmpty()) continue
            val score = minOf(prefixScore, suffixScore)
            if (best == null || score > best.first) {
                best = score to query
            }
        }
        return best
    }

    fun match(
        text: String,
        commands: List<VoiceCommand> = defaultCommands,
    ): VoiceIntent? {
        val normalized = normalize(text)
        if (normalized.isEmpty()) return null
        val words = words(normalized)
        val candidates = mutableListOf<Pair<VoiceIntent, Int>>()
        for (command in commands) {
            for (raw in command.phrases) {
                val phrase = normalize(raw.replace(SLOT, " $SLOT_MARK ")).replace(SLOT_MARK, SLOT)
                if (phrase.isEmpty()) continue
                val weight = fixedWordCount(phrase)
                if (phrase.contains(SLOT)) {
                    val found = matchSlot(words, phrase)
                    if (found != null && found.first >= MATCH_THRESHOLD) {
                        candidates += VoiceIntent(command.action, found.second, found.first) to weight
                    }
                    continue
                }
                var score = similarity(normalized, phrase)
                val phraseWords = words(phrase).size
                for (extra in listOf(1, 2)) {
                    if (words.size == phraseWords + extra) {
                        score = maxOf(score, similarity(words.drop(extra).joinToString(" "), phrase) * TAIL_PENALTY)
                    }
                }
                if (score >= MATCH_THRESHOLD) {
                    candidates += VoiceIntent(command.action, "", score) to weight
                }
            }
        }
        if (candidates.isEmpty()) return null
        val strong = candidates.filter { it.first.score >= STRONG_MATCH }
        if (strong.isNotEmpty()) {
            return strong
                .sortedWith(compareByDescending<Pair<VoiceIntent, Int>> { it.second }.thenByDescending { it.first.score })
                .first()
                .first
        }
        return candidates
            .sortedWith(compareByDescending<Pair<VoiceIntent, Int>> { it.first.score }.thenByDescending { it.second })
            .first()
            .first
    }

    fun sanitize(commands: List<VoiceCommand>?): List<VoiceCommand> {
        if (commands == null) return defaultCommands
        val byAction = mutableMapOf<VoiceAction, List<String>>()
        for (command in commands) {
            byAction[command.action] =
                command.phrases
                    .map { it.trim().take(MAX_PHRASE_CHARS) }
                    .filter { it.isNotEmpty() }
                    .take(MAX_PHRASES)
        }
        return defaultCommands.map { VoiceCommand(it.action, byAction[it.action] ?: it.phrases) }
    }

    fun isOutOfScope(text: String): Boolean {
        val normalized = " ${normalize(text)} "
        return outOfScope.any { normalized.contains(" $it ") }
    }

    fun safeReply(reply: String): String {
        val trimmed = reply.trim()
        val lower = trimmed.lowercase()
        val unsafe = trimmed.any { it in "{}<>`$\\" } || lower.contains("http:") || lower.contains("https:")
        if (trimmed.isEmpty() || trimmed.length > MAX_REPLY_CHARS || unsafe || isOutOfScope(trimmed)) return ""
        return trimmed
    }

    fun dropLeadingWords(
        text: String,
        commands: List<VoiceCommand>,
    ): String {
        val words = words(text)
        var best = words.drop(1).joinToString(" ")
        var bestScore = -1.0
        for (take in listOf(1, 2)) {
            val rest = words.drop(take).joinToString(" ")
            val score = if (rest.isEmpty()) -1.0 else match(rest, commands)?.score ?: -1.0
            if (score > bestScore) {
                bestScore = score
                best = rest
            }
        }
        return best
    }
}
