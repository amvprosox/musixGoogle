package com.realmadhoney.musix.download

import android.content.Context
import android.media.MediaPlayer
import android.net.Uri
import android.util.Log
import androidx.media3.common.Player
import com.realmadhoney.musix.core.bridge.BridgeCodec
import com.realmadhoney.musix.ui.NowPlaying
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Semaphore
import kotlinx.coroutines.sync.withPermit
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.File
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.ConcurrentHashMap

@Serializable
enum class DownloadStatus {
    DOWNLOADING,
    COMPLETED,
    FAILED,
}

@Serializable
data class DownloadItem(
    val id: String,
    val videoId: String,
    val title: String,
    val artist: String,
    val album: String,
    val durationSec: Long,
    val artworkPath: String,
    val audioPath: String,
    val status: DownloadStatus,
    val progress: Float,
    val error: String? = null,
    val createdAt: Long,
) {
    fun artworkUri(): Uri? {
        if (artworkPath.isEmpty()) {
            return null
        }
        val file = File(artworkPath)
        return if (file.isFile) Uri.fromFile(file) else null
    }
}

data class DownloadTrackSpec(
    val videoId: String,
    val title: String,
    val artist: String,
    val album: String,
    val durationSec: Long,
    val artworkUrl: String,
)

data class DetectedLibrary(
    val id: String,
    val title: String,
    val subtitle: String,
    val artworkUrl: String,
    val tracks: List<DownloadTrackSpec>,
)

class DownloadRepository(
    context: Context,
    private val ioScope: CoroutineScope,
    private val onMessage: (String) -> Unit,
) {
    private val directory = File(context.filesDir, "downloads")
    private val musicDir = File(directory, "music")
    private val thumbnailsDir = File(directory, "thumbnails")
    private val miscDir = File(directory, "misc")
    private val storeFile = File(miscDir, "downloads.json")
    private val logFile = File(miscDir, "downloads.log")
    private val json = Json { ignoreUnknownKeys = true }
    private val jobs = ConcurrentHashMap<String, Job>()
    private val downloadSlots = Semaphore(MAX_CONCURRENT_DOWNLOADS)

    private val itemsFlow = MutableStateFlow<List<DownloadItem>>(emptyList())
    val items: StateFlow<List<DownloadItem>> = itemsFlow.asStateFlow()

    private val logsFlow = MutableStateFlow<List<String>>(emptyList())
    val logs: StateFlow<List<String>> = logsFlow.asStateFlow()

    private val offlinePlayingFlow = MutableStateFlow<NowPlaying?>(null)
    val offlineNowPlaying: StateFlow<NowPlaying?> = offlinePlayingFlow.asStateFlow()

    private var mediaPlayer: MediaPlayer? = null
    private var offlineVideoId: String? = null
    private var tickerJob: Job? = null
    private var cachedVisitorData: String = ""
    private var logFileLines = 0

    init {
        ensureDirectories()
        loadLogs()
        load()
    }

    private fun ensureDirectories() {
        musicDir.mkdirs()
        thumbnailsDir.mkdirs()
        miscDir.mkdirs()
    }

    @Synchronized
    private fun loadLogs() {
        if (!logFile.isFile) {
            logsFlow.value = emptyList()
            return
        }
        try {
            val lines = logFile.readLines(Charsets.UTF_8).filter { it.isNotBlank() }
            logFileLines = lines.size
            logsFlow.value = lines.takeLast(MAX_LOG_LINES)
        } catch (error: IOException) {
            logsFlow.value = emptyList()
        }
    }

    @Synchronized
    fun appendLog(message: String) {
        val stamp = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date())
        val line = "[$stamp] $message"
        val next = (logsFlow.value + line).takeLast(MAX_LOG_LINES)
        logsFlow.value = next
        try {
            ensureDirectories()
            logFileLines++
            if (logFileLines > MAX_LOG_LINES * 2) {
                logFile.writeText(next.joinToString("\n") + "\n", Charsets.UTF_8)
                logFileLines = next.size
            } else {
                logFile.appendText(line + "\n", Charsets.UTF_8)
            }
        } catch (error: IOException) {
            Log.w(TAG, "Failed to write downloads.log", error)
        }
    }

    @Synchronized
    fun clearLogs() {
        logsFlow.value = emptyList()
        logFileLines = 0
        try {
            logFile.writeText("", Charsets.UTF_8)
        } catch (error: IOException) {
            Log.w(TAG, "Failed to clear downloads.log", error)
        }
    }

    private fun sanitizeTitle(
        title: String,
        videoId: String,
    ): String {
        val cleaned =
            title
                .replace(UNSAFE_FILENAME_REGEX, "-")
                .replace(WHITESPACE_REGEX, " ")
                .trim(' ', '.')
                .take(120)
                .trim()
        return cleaned.ifEmpty { videoId }
    }

    private fun fileStemFor(
        title: String,
        videoId: String,
    ): String {
        val base = sanitizeTitle(title, videoId)
        val conflict =
            itemsFlow.value.any { other ->
                other.videoId != videoId &&
                    sanitizeTitle(other.title, other.videoId).equals(base, ignoreCase = true)
            }
        return if (conflict) "$base ($videoId)" else base
    }

    private fun writeDescriptionFile(
        stem: String,
        item: DownloadItem,
    ) {
        try {
            val lines =
                buildList {
                    add("Title: ${item.title}")
                    if (item.artist.isNotEmpty()) {
                        add("Artist: ${item.artist}")
                    }
                    if (item.album.isNotEmpty()) {
                        add("Album: ${item.album}")
                    }
                    if (item.durationSec > 0) {
                        add("Duration: ${item.durationSec}s")
                    }
                    add("Video ID: ${item.videoId}")
                }
            File(miscDir, "$stem.txt").writeText(lines.joinToString("\n") + "\n", Charsets.UTF_8)
        } catch (error: IOException) {
            Log.w(TAG, "Failed to write description file", error)
        }
    }

    fun startDownload(spec: DownloadTrackSpec) {
        if (!BridgeCodec.isValidVideoId(spec.videoId) || spec.title.isBlank()) {
            onMessage("Play a song first.")
            return
        }
        val current = itemsFlow.value.firstOrNull { it.videoId == spec.videoId }
        if (current != null && current.status == DownloadStatus.DOWNLOADING) {
            appendLog("Skip ${spec.title} (${spec.videoId}): already downloading")
            onMessage("Already downloading ${spec.title}")
            return
        }
        if (current != null && current.status == DownloadStatus.COMPLETED && File(current.audioPath).isFile) {
            appendLog("Skip ${spec.title} (${spec.videoId}): already downloaded")
            onMessage("Already downloaded")
            return
        }
        queueTrack(spec)
        onMessage("Downloading MP3: ${spec.title.trim()}")
    }

    fun downloadBatch(
        title: String,
        specs: List<DownloadTrackSpec>,
    ) {
        val unique = LinkedHashMap<String, DownloadTrackSpec>()
        for (spec in specs) {
            if (BridgeCodec.isValidVideoId(spec.videoId) && spec.title.isNotBlank() && !unique.containsKey(spec.videoId)) {
                unique[spec.videoId] = spec
            }
        }
        if (unique.isEmpty()) {
            return
        }
        var skipped = 0
        val existingById = itemsFlow.value.associateBy { it.videoId }
        val toQueue = ArrayList<DownloadTrackSpec>()
        for (spec in unique.values) {
            val existing = existingById[spec.videoId]
            val done = existing != null && existing.status == DownloadStatus.COMPLETED && File(existing.audioPath).isFile
            val active = existing != null && existing.status == DownloadStatus.DOWNLOADING && jobs.containsKey(spec.videoId)
            if (done || active) {
                skipped++
                appendLog("Batch [$title]: skipping already downloaded ${spec.title} (${spec.videoId})")
                continue
            }
            toQueue.add(spec)
        }
        queueTracks(toQueue)
        val started = toQueue.size
        if (started == 0 && skipped > 0) {
            appendLog("Batch [$title]: all $skipped songs already downloaded")
            onMessage("Already downloaded")
        } else {
            appendLog("Batch [$title]: queued $started songs, skipped $skipped already downloaded")
            val skipNote = if (skipped > 0) " (skipped $skipped already downloaded)" else ""
            onMessage("Downloading $started songs from $title$skipNote")
        }
    }

    private fun queueTrack(spec: DownloadTrackSpec) {
        queueTracks(listOf(spec))
    }

    private fun queueTracks(specs: List<DownloadTrackSpec>) {
        if (specs.isEmpty()) {
            return
        }
        val now = System.currentTimeMillis()
        val newItems =
            specs.mapIndexed { index, spec ->
                DownloadItem(
                    id = spec.videoId,
                    videoId = spec.videoId,
                    title = spec.title.trim(),
                    artist = spec.artist.trim(),
                    album = spec.album.trim(),
                    durationSec = spec.durationSec.coerceAtLeast(0L),
                    artworkPath = "",
                    audioPath = "",
                    status = DownloadStatus.DOWNLOADING,
                    progress = 0f,
                    error = null,
                    createdAt = now - index,
                )
            }
        val newIds = newItems.mapTo(HashSet()) { it.videoId }
        synchronized(this) {
            itemsFlow.value = newItems + itemsFlow.value.filterNot { it.videoId in newIds }
            persist()
        }
        for ((index, item) in newItems.withIndex()) {
            val artworkUrl = specs[index].artworkUrl
            appendLog("Queued download: ${item.title} (${item.videoId})")
            jobs[item.videoId]?.cancel()
            val job =
                ioScope.launch {
                    downloadSlots.withPermit {
                        ensureActive()
                        updateItem(item.videoId, save = false) { it.copy(progress = maxOf(it.progress, 0.01f)) }
                        appendLog("Start download: ${item.title} (${item.videoId})")
                        runDownload(item, artworkUrl)
                    }
                }
            jobs[item.videoId] = job
        }
    }

    fun deleteDownload(videoId: String) {
        jobs.remove(videoId)?.cancel()
        if (offlineVideoId == videoId) {
            stopOffline()
        }
        val target = itemsFlow.value.firstOrNull { it.videoId == videoId }
        val stem = if (target != null) fileStemFor(target.title, videoId) else videoId
        synchronized(this) {
            itemsFlow.value = itemsFlow.value.filterNot { it.videoId == videoId }
            persist()
        }
        ioScope.launch {
            if (target != null) {
                if (target.audioPath.isNotEmpty()) {
                    File(target.audioPath).delete()
                }
                if (target.artworkPath.isNotEmpty()) {
                    File(target.artworkPath).delete()
                }
            }
            File(musicDir, "$stem.mp3").delete()
            File(thumbnailsDir, "$stem.jpg").delete()
            File(miscDir, "$stem.txt").delete()
            File(miscDir, "$videoId.part").delete()
            File(directory, "$videoId.mp3").delete()
            File(directory, "$videoId.jpg").delete()
            File(directory, "$videoId.part").delete()
        }
    }

    fun playOffline(
        item: DownloadItem,
        pauseOnline: () -> Unit,
    ) {
        val audioFile = File(item.audioPath)
        if (item.status != DownloadStatus.COMPLETED || !audioFile.isFile) {
            onMessage("Downloaded file is not available.")
            return
        }
        pauseOnline()
        stopMediaPlayer()
        try {
            val player = MediaPlayer()
            FileInputStream(audioFile).use { fis ->
                player.setDataSource(fis.fd)
            }
            player.prepare()
            val prev = offlinePlayingFlow.value
            val repeatMode = prev?.repeatMode ?: Player.REPEAT_MODE_OFF
            val shuffle = prev?.shuffle ?: false
            player.setOnCompletionListener {
                val active = offlinePlayingFlow.value
                if (active != null && active.repeatMode == Player.REPEAT_MODE_ONE) {
                    player.seekTo(0)
                    player.start()
                    syncOfflineState()
                } else if (!stepOffline(1, wrap = active?.repeatMode == Player.REPEAT_MODE_ALL, pauseOnline = pauseOnline)) {
                    syncOfflineState()
                }
            }
            player.start()
            mediaPlayer = player
            offlineVideoId = item.videoId
            val durationMs =
                if (player.duration > 0) {
                    player.duration.toLong()
                } else {
                    item.durationSec * 1000L
                }
            offlinePlayingFlow.value =
                NowPlaying(
                    hasTrack = true,
                    mediaId = item.videoId,
                    title = item.title,
                    artist = item.artist,
                    album = item.album,
                    artworkUri = item.artworkUri(),
                    isPlaying = true,
                    isBuffering = false,
                    positionMs = 0L,
                    durationMs = durationMs,
                    canSeek = true,
                    canSkip = true,
                    liked = false,
                    shuffle = shuffle,
                    repeatMode = repeatMode,
                    error = null,
                )
            startOfflineTicker()
        } catch (error: IOException) {
            Log.w(TAG, "Offline playback failed", error)
            onMessage("Could not play downloaded MP3.")
        }
    }

    fun stopOffline() {
        tickerJob?.cancel()
        tickerJob = null
        stopMediaPlayer()
        offlineVideoId = null
        offlinePlayingFlow.value = null
    }

    fun toggleOfflinePlay(): Boolean {
        val player = mediaPlayer ?: return false
        if (player.isPlaying) {
            player.pause()
        } else {
            player.start()
        }
        syncOfflineState()
        return true
    }

    fun seekOfflineTo(positionMs: Long): Boolean {
        val player = mediaPlayer ?: return false
        player.seekTo(positionMs.coerceAtLeast(0L).toInt())
        syncOfflineState()
        return true
    }

    fun nextOffline(pauseOnline: () -> Unit): Boolean {
        if (mediaPlayer == null) {
            return false
        }
        stepOffline(1, wrap = true, pauseOnline = pauseOnline)
        return true
    }

    fun previousOffline(pauseOnline: () -> Unit): Boolean {
        val player = mediaPlayer ?: return false
        if (player.currentPosition > 3_000) {
            player.seekTo(0)
            syncOfflineState()
            return true
        }
        stepOffline(-1, wrap = true, pauseOnline = pauseOnline)
        return true
    }

    fun toggleOfflineShuffle(): Boolean {
        val current = offlinePlayingFlow.value ?: return false
        offlinePlayingFlow.value = current.copy(shuffle = !current.shuffle)
        return true
    }

    fun cycleOfflineRepeat(): Boolean {
        val current = offlinePlayingFlow.value ?: return false
        val nextMode =
            when (current.repeatMode) {
                Player.REPEAT_MODE_OFF -> Player.REPEAT_MODE_ALL
                Player.REPEAT_MODE_ALL -> Player.REPEAT_MODE_ONE
                else -> Player.REPEAT_MODE_OFF
            }
        offlinePlayingFlow.value = current.copy(repeatMode = nextMode)
        return true
    }

    fun offlinePositionMs(): Long? {
        val player = mediaPlayer ?: return null
        return try {
            player.currentPosition.toLong().coerceAtLeast(0L)
        } catch (error: IllegalStateException) {
            offlinePlayingFlow.value?.positionMs
        }
    }

    private fun stepOffline(
        direction: Int,
        wrap: Boolean,
        pauseOnline: () -> Unit,
    ): Boolean {
        val completed =
            itemsFlow.value.filter {
                it.status == DownloadStatus.COMPLETED && it.audioPath.isNotEmpty() && File(it.audioPath).isFile
            }
        if (completed.isEmpty()) {
            return false
        }
        val idx = completed.indexOfFirst { it.videoId == offlineVideoId }
        if (idx < 0) {
            return false
        }
        val nextIdx = idx + direction
        if (nextIdx in completed.indices) {
            playOffline(completed[nextIdx], pauseOnline)
            return true
        }
        if (wrap) {
            val wrapped = if (direction > 0) completed.first() else completed.last()
            playOffline(wrapped, pauseOnline)
            return true
        }
        return false
    }

    private fun startOfflineTicker() {
        tickerJob?.cancel()
        tickerJob =
            ioScope.launch(Dispatchers.Main) {
                while (isActive && mediaPlayer != null) {
                    syncOfflineState()
                    delay(500L)
                }
            }
    }

    private fun syncOfflineState() {
        val player = mediaPlayer ?: return
        val current = offlinePlayingFlow.value ?: return
        try {
            val pos = player.currentPosition.toLong().coerceAtLeast(0L)
            val dur = if (player.duration > 0) player.duration.toLong() else current.durationSecFor()
            offlinePlayingFlow.value =
                current.copy(
                    isPlaying = player.isPlaying,
                    positionMs = pos.coerceAtMost(if (dur > 0) dur else pos),
                    durationMs = dur,
                )
        } catch (error: IllegalStateException) {
            Log.w(TAG, "Offline player state read failed", error)
        }
    }

    private fun NowPlaying.durationSecFor(): Long = durationMs

    private fun stopMediaPlayer() {
        val current = mediaPlayer
        mediaPlayer = null
        if (current != null) {
            try {
                if (current.isPlaying) {
                    current.stop()
                }
            } catch (error: IllegalStateException) {
                Log.w(TAG, "MediaPlayer stop ignored", error)
            }
            current.release()
        }
    }

    private suspend fun runDownload(
        item: DownloadItem,
        artworkUrl: String,
    ) {
        val videoId = item.videoId
        ensureDirectories()
        val stem = fileStemFor(item.title, videoId)
        val partFile = File(miscDir, "$videoId.part")
        val finalFile = File(musicDir, "$stem.mp3")
        try {
            writeDescriptionFile(stem, item)
            val thumbPath = downloadThumbnail(stem, videoId, artworkUrl)
            if (thumbPath.isNotEmpty()) {
                updateItem(videoId, save = true) { it.copy(artworkPath = thumbPath) }
                appendLog("Saved thumbnail for $videoId -> thumbnails/$stem.jpg")
            }
            currentCoroutineContext().ensureActive()
            val streams = resolveAudioStreams(videoId)
            if (streams.isEmpty()) {
                throw IOException("Could not resolve audio stream")
            }
            var streamSuccess = false
            var lastError: Exception? = null
            for (stream in streams) {
                currentCoroutineContext().ensureActive()
                try {
                    partFile.delete()
                    appendLog("Downloading stream (${stream.clientName}, len=${stream.contentLength}) for $videoId")
                    downloadStreamChunks(videoId, stream, partFile)
                    streamSuccess = true
                    break
                } catch (cancelled: CancellationException) {
                    throw cancelled
                } catch (err: Exception) {
                    lastError = err
                    appendLog("Stream ${stream.clientName} failed for $videoId: ${err.message}")
                }
            }
            if (!streamSuccess) {
                throw lastError ?: IOException("All audio streams failed")
            }
            currentCoroutineContext().ensureActive()
            if (!partFile.isFile || partFile.length() <= 0L) {
                throw IOException("Downloaded file is empty")
            }
            if (finalFile.exists()) {
                finalFile.delete()
            }
            if (!partFile.renameTo(finalFile)) {
                partFile.copyTo(finalFile, overwrite = true)
                partFile.delete()
            }
            updateItem(videoId, save = true) {
                it.copy(
                    audioPath = finalFile.absolutePath,
                    status = DownloadStatus.COMPLETED,
                    progress = 1f,
                    error = null,
                )
            }
            appendLog("Completed download for $videoId -> music/$stem.mp3")
            onMessage("Downloaded MP3: ${item.title}")
        } catch (cancelled: CancellationException) {
            partFile.delete()
            appendLog("Cancelled download for $videoId")
            throw cancelled
        } catch (error: Exception) {
            partFile.delete()
            Log.w(TAG, "Download failed for $videoId", error)
            val msg = error.message ?: "Download failed"
            appendLog("ERROR ($videoId - ${item.title}): $msg")
            updateItem(videoId, save = true) {
                it.copy(
                    status = DownloadStatus.FAILED,
                    progress = 0f,
                    error = msg,
                )
            }
            onMessage("Download failed: ${item.title}")
        } finally {
            partFile.delete()
            jobs.remove(videoId)
        }
    }

    private fun downloadThumbnail(
        stem: String,
        videoId: String,
        artworkUrl: String,
    ): String {
        val candidates =
            buildList {
                if (artworkUrl.startsWith("https://")) {
                    add(artworkUrl.replace(Regex("=w\\d+-h\\d+[^&?]*"), "=w544-h544-l90-rj"))
                }
                add("https://i.ytimg.com/vi/$videoId/hqdefault.jpg")
            }
        val dest = File(thumbnailsDir, "$stem.jpg")
        for (url in candidates) {
            try {
                val conn = URL(url).openConnection() as? HttpURLConnection ?: continue
                try {
                    conn.connectTimeout = TIMEOUT_MS
                    conn.readTimeout = TIMEOUT_MS
                    conn.instanceFollowRedirects = true
                    if (conn.responseCode in 200..299) {
                        val bytes = conn.inputStream.use { it.readBytes() }
                        if (bytes.size >= 128) {
                            dest.writeBytes(bytes)
                            return dest.absolutePath
                        }
                    }
                } finally {
                    conn.disconnect()
                }
            } catch (error: IOException) {
                Log.w(TAG, "Thumbnail fetch failed", error)
            }
        }
        return ""
    }

    private fun resolveVisitorData(): String {
        if (cachedVisitorData.length > 10) {
            return cachedVisitorData
        }
        val ua =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
                "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
        try {
            val swConn = URL("https://www.youtube.com/sw.js_data").openConnection() as? HttpURLConnection
            if (swConn != null) {
                try {
                    swConn.connectTimeout = TIMEOUT_MS
                    swConn.readTimeout = TIMEOUT_MS
                    swConn.setRequestProperty("User-Agent", ua)
                    if (swConn.responseCode in 200..299) {
                        val raw = swConn.inputStream.bufferedReader().use { it.readText() }
                        val match =
                            SW_VISITOR_REGEX
                                .find(raw)
                                ?.groupValues
                                ?.getOrNull(1)
                                .orEmpty()
                        if (match.isNotEmpty()) {
                            cachedVisitorData = match
                            appendLog("Resolved visitorData from sw.js_data (${match.take(14)}...)")
                            return match
                        }
                    }
                } finally {
                    swConn.disconnect()
                }
            }
        } catch (error: IOException) {
            appendLog("sw.js_data visitorData fetch failed: ${error.message}")
        }
        try {
            val conn = URL("https://www.youtube.com").openConnection() as? HttpURLConnection ?: return ""
            try {
                conn.connectTimeout = TIMEOUT_MS
                conn.readTimeout = TIMEOUT_MS
                conn.setRequestProperty("User-Agent", ua)
                if (conn.responseCode in 200..299) {
                    val html = conn.inputStream.bufferedReader().use { it.readText() }
                    val found = VISITOR_REGEX.find(html)
                    val match = found?.groupValues?.getOrNull(1) ?: ""
                    if (match.isNotEmpty()) {
                        cachedVisitorData = match
                        return match
                    }
                }
            } finally {
                conn.disconnect()
            }
        } catch (error: IOException) {
            Log.w(TAG, "Failed to fetch visitor data", error)
        }
        return ""
    }

    private fun resolveAudioStreams(videoId: String): List<ResolvedAudioStream> {
        val visitorData = resolveVisitorData()
        val streams = ArrayList<ResolvedAudioStream>()
        for (client in CLIENTS) {
            try {
                val extraFields =
                    buildString {
                        if (client.sdk != null) {
                            append(""""androidSdkVersion":${client.sdk},""")
                        }
                        if (client.osName != null) {
                            append(""""osName":"${client.osName}",""")
                        }
                        if (client.osVersion != null) {
                            append(""""osVersion":"${client.osVersion}",""")
                        }
                        if (client.deviceMake != null) {
                            append(""""deviceMake":"${client.deviceMake}",""")
                        }
                        if (client.deviceModel != null) {
                            append(""""deviceModel":"${client.deviceModel}",""")
                        }
                        if (visitorData.isNotEmpty()) {
                            append(""""visitorData":"$visitorData",""")
                        }
                    }
                val clientObj =
                    """{"clientName":"${client.name}","clientVersion":"${client.version}",$extraFields"hl":"en","gl":"US"}"""
                val playbackCtx =
                    if (client.html5Pref) {
                        ""","playbackContext":{"contentPlaybackContext":{"html5Preference":"HTML5_PREF_WANTS"}}"""
                    } else {
                        ""
                    }
                val body =
                    """{"videoId":"$videoId","context":{"client":$clientObj}$playbackCtx,"contentCheckOk":true,"racyCheckOk":true}"""
                val conn =
                    URL("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
                        .openConnection() as? HttpURLConnection ?: continue
                try {
                    conn.requestMethod = "POST"
                    conn.doOutput = true
                    conn.connectTimeout = TIMEOUT_MS
                    conn.readTimeout = TIMEOUT_MS
                    conn.setRequestProperty("Content-Type", "application/json")
                    conn.setRequestProperty("User-Agent", client.userAgent)
                    conn.setRequestProperty("Origin", "https://www.youtube.com")
                    conn.setRequestProperty("X-YouTube-Client-Name", client.clientId)
                    conn.setRequestProperty("X-YouTube-Client-Version", client.version)
                    if (visitorData.isNotEmpty()) {
                        conn.setRequestProperty("X-Goog-Visitor-Id", visitorData)
                    }
                    conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                    if (conn.responseCode !in 200..299) {
                        appendLog("Innertube ${client.name} returned HTTP ${conn.responseCode} for $videoId")
                        continue
                    }
                    val text = conn.inputStream.bufferedReader().use { it.readText() }
                    val root = json.parseToJsonElement(text).jsonObject
                    val playStatus =
                        root["playabilityStatus"]
                            ?.jsonObject
                            ?.get("status")
                            ?.jsonPrimitive
                            ?.content
                            .orEmpty()
                    val adaptive =
                        root["streamingData"]
                            ?.jsonObject
                            ?.get("adaptiveFormats")
                            ?.jsonArray
                    if (adaptive == null) {
                        appendLog("Innertube ${client.name} status=$playStatus (no adaptiveFormats) for $videoId")
                        continue
                    }
                    val candidates = ArrayList<AudioCandidate>()
                    for (element in adaptive) {
                        val obj = element.jsonObject
                        val url = obj["url"]?.jsonPrimitive?.content.orEmpty()
                        val mime = obj["mimeType"]?.jsonPrimitive?.content.orEmpty()
                        if (url.isEmpty() || !mime.startsWith("audio/")) {
                            continue
                        }
                        val len = obj["contentLength"]?.jsonPrimitive?.content?.toLongOrNull() ?: 0L
                        val bitrate = obj["bitrate"]?.jsonPrimitive?.content?.toIntOrNull() ?: 0
                        candidates.add(
                            AudioCandidate(
                                url = url,
                                contentLength = len,
                                bitrate = bitrate,
                                isMp4 = mime.startsWith("audio/mp4"),
                            ),
                        )
                    }
                    val best =
                        candidates
                            .sortedWith(
                                compareByDescending<AudioCandidate> { it.isMp4 }
                                    .thenByDescending { it.bitrate },
                            ).firstOrNull()
                    if (best != null) {
                        appendLog("Resolved stream via ${client.name} (${best.bitrate}bps, len=${best.contentLength}) for $videoId")
                        streams.add(
                            ResolvedAudioStream(
                                url = best.url,
                                contentLength = best.contentLength,
                                userAgent = client.userAgent,
                                clientName = client.name,
                            ),
                        )
                    }
                } finally {
                    conn.disconnect()
                }
            } catch (error: Exception) {
                appendLog("Innertube ${client.name} exception for $videoId: ${error.message}")
            }
        }
        return streams
    }

    private suspend fun downloadStreamChunks(
        videoId: String,
        stream: ResolvedAudioStream,
        dest: File,
    ) = withContext(Dispatchers.IO) {
        val urls = alternateUrls(stream.url)
        var urlIndex = 0
        val totalBytes = stream.contentLength
        var downloadedBytes = 0L
        var lastEmit = 0L

        FileOutputStream(dest).use { output ->
            if (totalBytes <= 0L) {
                val conn = URL(urls.first()).openConnection() as? HttpURLConnection ?: throw IOException("Bad URL")
                try {
                    conn.connectTimeout = TIMEOUT_MS
                    conn.readTimeout = TIMEOUT_MS
                    conn.setRequestProperty("User-Agent", stream.userAgent)
                    if (conn.responseCode !in 200..299) {
                        throw IOException("Stream HTTP ${conn.responseCode}")
                    }
                    conn.inputStream.use { input ->
                        val buf = ByteArray(16_384)
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val read = input.read(buf)
                            if (read < 0) {
                                break
                            }
                            output.write(buf, 0, read)
                        }
                    }
                } finally {
                    conn.disconnect()
                }
                return@use
            }

            while (downloadedBytes < totalBytes) {
                currentCoroutineContext().ensureActive()
                val end = minOf(downloadedBytes + CHUNK_SIZE - 1L, totalBytes - 1L)
                var chunkWritten = false
                var lastStatus = 0
                for (attempt in 0 until minOf(urls.size, 6)) {
                    val target = urls[(urlIndex + attempt) % urls.size]
                    val conn = URL(target).openConnection() as? HttpURLConnection ?: continue
                    try {
                        conn.connectTimeout = TIMEOUT_MS
                        conn.readTimeout = TIMEOUT_MS
                        conn.setRequestProperty("User-Agent", stream.userAgent)
                        conn.setRequestProperty("Range", "bytes=$downloadedBytes-$end")
                        val code = conn.responseCode
                        lastStatus = code
                        if (code == 206 || code == 200) {
                            val bytes = conn.inputStream.use { it.readBytes() }
                            if (bytes.isNotEmpty()) {
                                output.write(bytes)
                                downloadedBytes += bytes.size
                                urlIndex = (urlIndex + attempt) % urls.size
                                chunkWritten = true
                                break
                            }
                        }
                    } catch (error: IOException) {
                        Log.w(TAG, "Chunk attempt failed", error)
                    } finally {
                        conn.disconnect()
                    }
                }
                if (!chunkWritten) {
                    throw IOException("Stream HTTP $lastStatus at byte $downloadedBytes")
                }
                val now = System.currentTimeMillis()
                if (now - lastEmit >= 180L || downloadedBytes >= totalBytes) {
                    lastEmit = now
                    val progress = (downloadedBytes.toFloat() / totalBytes.toFloat()).coerceIn(0f, 0.99f)
                    updateItem(videoId, save = false) { it.copy(progress = progress) }
                }
            }
        }
    }

    private fun alternateUrls(rawUrl: String): List<String> {
        val result = ArrayList<String>()
        result.add(rawUrl)
        try {
            val uri = URI(rawUrl)
            val host = uri.host ?: return result
            if (!host.endsWith(".googlevideo.com")) {
                return result
            }
            val query = uri.rawQuery.orEmpty()
            val mn =
                query
                    .split("&")
                    .firstOrNull { it.startsWith("mn=") }
                    ?.substringAfter("mn=")
                    ?.replace("%2C", ",")
                    .orEmpty()
            if (mn.isEmpty()) {
                return result
            }
            val mirrors = mn.split(",").map { it.trim() }.filter { it.isNotEmpty() }
            for (mirror in mirrors) {
                for (idx in 1..5) {
                    val candidateHost = "rr$idx---$mirror.googlevideo.com"
                    if (candidateHost != host) {
                        val swapped = rawUrl.replaceFirst("://$host", "://$candidateHost")
                        result.add(swapped)
                    }
                }
            }
        } catch (error: Exception) {
            Log.w(TAG, "Mirror host parse failed", error)
        }
        return result
    }

    @Synchronized
    private fun updateItem(
        videoId: String,
        save: Boolean,
        transform: (DownloadItem) -> DownloadItem,
    ) {
        val current = itemsFlow.value
        val index = current.indexOfFirst { it.videoId == videoId }
        if (index < 0) {
            return
        }
        val next = current.toMutableList()
        next[index] = transform(next[index])
        itemsFlow.value = next
        if (save) {
            persist()
        }
    }

    @Synchronized
    private fun load() {
        ensureDirectories()
        val legacyStore = File(directory, "downloads.json")
        if (!storeFile.isFile && legacyStore.isFile) {
            if (!legacyStore.renameTo(storeFile)) {
                legacyStore.copyTo(storeFile, overwrite = true)
                legacyStore.delete()
            }
        }
        if (!storeFile.isFile) {
            itemsFlow.value = emptyList()
            return
        }
        try {
            val raw = storeFile.readText(Charsets.UTF_8)
            val decoded = json.decodeFromString(ListSerializer(DownloadItem.serializer()), raw)
            itemsFlow.value =
                decoded.map { item ->
                    if (item.status == DownloadStatus.DOWNLOADING) {
                        item.copy(status = DownloadStatus.FAILED, progress = 0f, error = "Download interrupted")
                    } else {
                        item
                    }
                }
            persist()
        } catch (error: Exception) {
            Log.w(TAG, "Could not load downloads.json", error)
            itemsFlow.value = emptyList()
        }
    }

    @Synchronized
    private fun persist() {
        try {
            ensureDirectories()
            val tmp = File(miscDir, "downloads.json.tmp")
            val encoded = json.encodeToString(ListSerializer(DownloadItem.serializer()), itemsFlow.value)
            tmp.writeText(encoded, Charsets.UTF_8)
            if (!tmp.renameTo(storeFile)) {
                tmp.copyTo(storeFile, overwrite = true)
                tmp.delete()
            }
        } catch (error: Exception) {
            Log.w(TAG, "Could not persist downloads.json", error)
        }
    }

    private data class ClientSpec(
        val name: String,
        val version: String,
        val clientId: String,
        val userAgent: String,
        val sdk: Int? = null,
        val osName: String? = null,
        val osVersion: String? = null,
        val deviceMake: String? = null,
        val deviceModel: String? = null,
        val html5Pref: Boolean = false,
    )

    private data class AudioCandidate(
        val url: String,
        val contentLength: Long,
        val bitrate: Int,
        val isMp4: Boolean,
    )

    private data class ResolvedAudioStream(
        val url: String,
        val contentLength: Long,
        val userAgent: String,
        val clientName: String,
    )

    private companion object {
        const val TAG = "MusixDownload"
        const val TIMEOUT_MS = 15_000
        const val CHUNK_SIZE = 524_288L
        const val MAX_LOG_LINES = 500
        const val MAX_CONCURRENT_DOWNLOADS = 3
        const val VISIONOS_UA =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) " +
                "AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
        const val VR_UA =
            "com.google.android.apps.youtube.vr.oculus/1.60.19 " +
                "(Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip"
        val UNSAFE_FILENAME_REGEX = Regex("""[/\\:*?"<>|]""")
        val WHITESPACE_REGEX = Regex("""\s+""")
        val SW_VISITOR_REGEX = Regex(""""(Cgt[A-Za-z0-9_%-]+)"""")
        val VISITOR_REGEX = Regex(""""VISITOR_DATA":"([^"]+)"""")
        val CLIENTS =
            listOf(
                ClientSpec(
                    name = "VISIONOS",
                    version = "1.02",
                    clientId = "101",
                    userAgent = VISIONOS_UA,
                    osName = "visionOS",
                    osVersion = "26.5.23O471",
                    deviceMake = "Apple",
                    deviceModel = "RealityDevice17,1",
                    html5Pref = true,
                ),
                ClientSpec(
                    name = "ANDROID_VR",
                    version = "1.60.19",
                    clientId = "28",
                    userAgent = VR_UA,
                    sdk = 32,
                ),
                ClientSpec(
                    name = "IOS",
                    version = "20.10.4",
                    clientId = "5",
                    userAgent = "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
                ),
                ClientSpec(
                    name = "ANDROID",
                    version = "20.10.38",
                    clientId = "3",
                    userAgent = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
                    sdk = 34,
                ),
            )
    }
}
