package com.realmadhoney.musix.voice

import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest
import java.util.zip.ZipInputStream

object VoicePack {
    const val NAME = "musix-voice-pack-1"
    private const val URL_STRING = "https://github.com/amvprosox/musixGoogle/releases/download/voice-pack-1/$NAME.zip"
    private const val SHA256 = "617b4b97ee0bb45d7f9ca4c82ef8eccfc58e74d2e77313986c4ce78a1f7d7792"
    private const val EXPECTED_BYTES = 55_653_713L
    private const val TIMEOUT_MS = 30_000
    private const val MAX_REDIRECTS = 5
    private const val BUFFER = 64 * 1024

    fun directory(base: File): File = File(base, "voice/$NAME")

    fun isInstalled(base: File): Boolean = File(directory(base), "manifest.json").isFile && SherpaVoiceEngine.isInstalled(directory(base))

    @Throws(IOException::class)
    fun install(
        base: File,
        onProgress: (Float) -> Unit,
    ) {
        val voiceDir = File(base, "voice").apply { mkdirs() }
        val zip = File(voiceDir, "$NAME.zip.part")
        download(zip, onProgress)
        if (sha256(zip) != SHA256) {
            zip.delete()
            throw IOException("Voice pack checksum did not match")
        }
        val staging = File(voiceDir, "$NAME.partial")
        staging.deleteRecursively()
        staging.mkdirs()
        val root = staging.canonicalPath + File.separator
        ZipInputStream(zip.inputStream().buffered()).use { input ->
            while (true) {
                val entry = input.nextEntry ?: break
                val relative = entry.name.removePrefix("$NAME/")
                if (entry.isDirectory || relative.isEmpty()) continue
                val target = File(staging, relative)
                if (!target.canonicalPath.startsWith(root)) throw IOException("Voice pack has an unsafe path")
                target.parentFile?.mkdirs()
                target.outputStream().use { input.copyTo(it, BUFFER) }
            }
        }
        zip.delete()
        if (!File(staging, "manifest.json").isFile || !SherpaVoiceEngine.isInstalled(staging)) {
            staging.deleteRecursively()
            throw IOException("Voice pack is incomplete")
        }
        val target = directory(base)
        target.deleteRecursively()
        if (!staging.renameTo(target)) {
            staging.deleteRecursively()
            throw IOException("Could not save the voice pack")
        }
    }

    private fun download(
        file: File,
        onProgress: (Float) -> Unit,
    ) {
        var url = URL(URL_STRING)
        var connection: HttpURLConnection
        var redirects = 0
        while (true) {
            connection = url.openConnection() as HttpURLConnection
            connection.connectTimeout = TIMEOUT_MS
            connection.readTimeout = TIMEOUT_MS
            connection.instanceFollowRedirects = false
            val code = connection.responseCode
            if (code in 300..399 && redirects < MAX_REDIRECTS) {
                val location = connection.getHeaderField("Location") ?: throw IOException("Redirect without a location")
                connection.disconnect()
                val next = URL(url, location)
                if (next.protocol != "https") throw IOException("Voice pack redirect is not secure")
                url = next
                redirects++
                continue
            }
            if (code != HttpURLConnection.HTTP_OK) {
                connection.disconnect()
                throw IOException("Voice pack download failed (HTTP $code)")
            }
            break
        }
        try {
            val total = connection.contentLengthLong.takeIf { it > 0 } ?: EXPECTED_BYTES
            var received = 0L
            connection.inputStream.use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(BUFFER)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        output.write(buffer, 0, read)
                        received += read
                        onProgress((received.toFloat() / total).coerceAtMost(PROGRESS_CAP))
                    }
                }
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun sha256(file: File): String {
        val digest = MessageDigest.getInstance("SHA-256")
        file.inputStream().use { input ->
            val buffer = ByteArray(BUFFER)
            while (true) {
                val read = input.read(buffer)
                if (read < 0) break
                digest.update(buffer, 0, read)
            }
        }
        return digest.digest().joinToString("") { "%02x".format(it) }
    }

    private const val PROGRESS_CAP = 0.99f
}
