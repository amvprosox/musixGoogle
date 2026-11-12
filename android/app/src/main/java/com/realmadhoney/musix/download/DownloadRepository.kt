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
    private val json = Json { ignoreUnknownKeys = true }
    private val jobs = ConcurrentHashMap<String, Job>()

    private val itemsFlow = MutableStateFlow<List<DownloadItem>>(emptyList())
    val items: StateFlow<List<DownloadItem>> = itemsFlow.asStateFlow()

    private val offlinePlayingFlow = MutableStateFlow<NowPlaying?>(null)
    val offlineNowPlaying: StateFlow<NowPlaying?> = offlinePlayingFlow.asStateFlow()

    private var mediaPlayer: MediaPlayer? = null
    private var offlineVideoId: String? = null
    private var tickerJob: Job? = null
    private var cachedVisitorData: String = ""

    init {
        ensureDirectories()
        load()
    }

    private fun ensureDirectories() {
        musicDir.mkdirs()
        thumbnailsDir.mkdirs()
        miscDir.mkdirs()
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
            onMessage("Already downloading ${spec.title}")
            return
        }
        if (current != null && current.status == DownloadStatus.COMPLETED && File(current.audioPath).isFile) {
            onMessage("${spec.title} is already downloaded")
            return
        }

        val item =
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
                createdAt = System.currentTimeMillis(),
            )
        synchronized(this) {
            itemsFlow.value = listOf(item) + itemsFlow.value.filterNot { it.videoId == spec.videoId }
            persist()
        }
        onMessage("Downloading MP3: ${item.title}")

        val job =
            ioScope.launch {
                runDownload(item, spec.artworkUrl)
            }
        jobs[spec.videoId] = job
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
            }
            currentCoroutineContext().ensureActive()
            val stream = resolveAudioStream(videoId) ?: throw IOException("Could not resolve audio stream")
            downloadStreamChunks(videoId, stream, partFile)
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
            onMessage("Downloaded MP3: ${item.title}")
        } catch (cancelled: CancellationException) {
            partFile.delete()
            throw cancelled
        } catch (error: Exception) {
            partFile.delete()
            Log.w(TAG, "Download failed for $videoId", error)
            updateItem(videoId, save = true) {
                it.copy(
                    status = DownloadStatus.FAILED,
                    progress = 0f,
                    error = error.message ?: "Download failed",
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
        try {
            val conn = URL("https://music.youtube.com").openConnection() as? HttpURLConnection ?: return ""
            try {
                conn.connectTimeout = TIMEOUT_MS
                conn.readTimeout = TIMEOUT_MS
                conn.setRequestProperty(
                    "User-Agent",
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
                )
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

    private fun resolveAudioStream(videoId: String): ResolvedAudioStream? {
        val visitorData = resolveVisitorData()
        for (client in CLIENTS) {
            try {
                val sdkField = if (client.sdk != null) """"androidSdkVersion":${client.sdk},""" else ""
                val visitorField = if (visitorData.isNotEmpty()) """"visitorData":"$visitorData",""" else ""
                val clientObj =
                    """{"clientName":"${client.name}","clientVersion":"${client.version}",$sdkField$visitorField"hl":"en","gl":"US"}"""
                val body =
                    """{"videoId":"$videoId","context":{"client":$clientObj},"contentCheckOk":true,"racyCheckOk":true}"""
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
                    if (visitorData.isNotEmpty()) {
                        conn.setRequestProperty("X-Goog-Visitor-Id", visitorData)
                    }
                    conn.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
                    if (conn.responseCode !in 200..299) {
                        continue
                    }
                    val text = conn.inputStream.bufferedReader().use { it.readText() }
                    val root = json.parseToJsonElement(text).jsonObject
                    val adaptive =
                        root["streamingData"]
                            ?.jsonObject
                            ?.get("adaptiveFormats")
                            ?.jsonArray ?: continue
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
                        return ResolvedAudioStream(
                            url = best.url,
                            contentLength = best.contentLength,
                            userAgent = client.userAgent,
                        )
                    }
                } finally {
                    conn.disconnect()
                }
            } catch (error: Exception) {
                Log.w(TAG, "Stream resolution attempt failed for ${client.name}", error)
            }
        }
        return null
    }

    private suspend fun downloadStreamChunks(
        videoId: String,
        stream: ResolvedAudioStream,
        dest: File,
    ) = withContext(Dispatchers.IO) {
        val urls = alternateUrls(stream.url)
        var urlIndex = 0
        var totalBytes = stream.contentLength
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
                        throw IOException("HTTP ${conn.responseCode}")
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
                for (attempt in 0 until minOf(urls.size, 6)) {
                    val target = urls[(urlIndex + attempt) % urls.size]
                    val conn = URL(target).openConnection() as? HttpURLConnection ?: continue
                    try {
                        conn.connectTimeout = TIMEOUT_MS
                        conn.readTimeout = TIMEOUT_MS
                        conn.setRequestProperty("User-Agent", stream.userAgent)
                        conn.setRequestProperty("Range", "bytes=$downloadedBytes-$end")
                        val code = conn.responseCode
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
                    throw IOException("Failed to download audio chunk")
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
        val userAgent: String,
        val sdk: Int?,
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
    )

    private companion object {
        const val TAG = "MusixDownload"
        const val TIMEOUT_MS = 15_000
        const val CHUNK_SIZE = 524_288L
        const val VR_UA =
            "com.google.android.apps.youtube.vr.oculus/1.60.19 " +
                "(Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip"
        val UNSAFE_FILENAME_REGEX = Regex("""[/\\:*?"<>|]""")
        val WHITESPACE_REGEX = Regex("""\s+""")
        val VISITOR_REGEX = Regex(""""VISITOR_DATA":"([^"]+)"""")
        val CLIENTS =
            listOf(
                ClientSpec(
                    name = "ANDROID_VR",
                    version = "1.60.19",
                    userAgent = VR_UA,
                    sdk = 32,
                ),
                ClientSpec(
                    name = "ANDROID",
                    version = "20.10.38",
                    userAgent = "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
                    sdk = 34,
                ),
                ClientSpec(
                    name = "IOS",
                    version = "20.10.4",
                    userAgent = "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
                    sdk = null,
                ),
            )
    }
}
