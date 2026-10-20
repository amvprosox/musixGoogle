package com.realmadhoney.musix.artwork

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.util.Base64
import android.util.Log
import androidx.core.net.toUri
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class ArtworkStore(
    private val authority: String,
    private val directory: File,
    private val maxBytes: Int = MAX_IMAGE_BYTES,
    private val maxFiles: Int = MAX_FILES,
    private val fetch: (URL) -> ByteArray = ::download,
) {
    fun contentUri(remoteUrl: String): Uri? {
        if (!isAllowedRemote(remoteUrl)) {
            return null
        }
        val token = Base64.encodeToString(remoteUrl.toByteArray(Charsets.UTF_8), Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING)
        return Uri
            .Builder()
            .scheme(ContentResolver.SCHEME_CONTENT)
            .authority(authority)
            .appendPath(PATH)
            .appendPath(token)
            .build()
    }

    fun remoteUrlFor(uri: Uri): String? {
        if (uri.authority != authority) {
            return null
        }
        val segments = uri.pathSegments
        if (segments.size != 2 || segments[0] != PATH) {
            return null
        }
        val decoded =
            try {
                String(Base64.decode(segments[1], Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING), Charsets.UTF_8)
            } catch (error: IllegalArgumentException) {
                return null
            }
        return decoded.takeIf { isAllowedRemote(it) }
    }

    @Synchronized
    fun fileFor(uri: Uri): File? {
        val remote = remoteUrlFor(uri) ?: return null
        val target = File(directory, hash(remote) + ".img")
        if (target.isFile && target.length() > 0) {
            target.setLastModified(System.currentTimeMillis())
            return target
        }
        return try {
            val bytes = fetch(URL(remote))
            if (bytes.isEmpty() || bytes.size > maxBytes || !looksLikeImage(bytes)) {
                null
            } else {
                if (!directory.isDirectory && !directory.mkdirs()) {
                    throw IOException("Could not create ${directory.path}")
                }
                val temp = File(directory, target.name + ".tmp")
                temp.writeBytes(bytes)
                if (!temp.renameTo(target)) {
                    temp.delete()
                    throw IOException("Could not store ${target.name}")
                }
                prune()
                target
            }
        } catch (error: IOException) {
            Log.w(TAG, "Artwork download failed for ${remote.toUri().host}", error)
            null
        }
    }

    fun clear() {
        directory.listFiles()?.forEach { it.delete() }
    }

    private fun prune() {
        val files = directory.listFiles { file -> file.name.endsWith(".img") } ?: return
        if (files.size <= maxFiles) {
            return
        }
        files.sortedBy { it.lastModified() }.take(files.size - maxFiles).forEach { it.delete() }
    }

    private fun hash(value: String): String =
        MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString("") { "%02x".format(it) }

    companion object {
        private const val TAG = "MusixArtwork"
        const val PATH = "a"
        private const val MAX_IMAGE_BYTES = 4 * 1024 * 1024
        private const val MAX_FILES = 400
        private const val TIMEOUT_MS = 10_000
        private val ALLOWED_SUFFIXES = listOf("ytimg.com", "googleusercontent.com", "ggpht.com")

        fun isAllowedRemote(url: String): Boolean {
            if (url.length > 4096 || !url.startsWith("https://")) {
                return false
            }
            val host =
                try {
                    URL(url).host.lowercase()
                } catch (error: java.net.MalformedURLException) {
                    return false
                }
            return ALLOWED_SUFFIXES.any { host == it || host.endsWith(".$it") }
        }

        fun looksLikeImage(bytes: ByteArray): Boolean {
            if (bytes.size < 12) {
                return false
            }
            val jpeg = bytes[0] == 0xFF.toByte() && bytes[1] == 0xD8.toByte()
            val png = bytes[0] == 0x89.toByte() && bytes[1] == 'P'.code.toByte() && bytes[2] == 'N'.code.toByte()
            val webp = String(bytes, 0, 4, Charsets.US_ASCII) == "RIFF" && String(bytes, 8, 4, Charsets.US_ASCII) == "WEBP"
            val gif = String(bytes, 0, 3, Charsets.US_ASCII) == "GIF"
            return jpeg || png || webp || gif
        }

        fun download(url: URL): ByteArray {
            val connection = url.openConnection() as? HttpURLConnection ?: throw IOException("Not an HTTP URL")
            try {
                connection.connectTimeout = TIMEOUT_MS
                connection.readTimeout = TIMEOUT_MS
                connection.instanceFollowRedirects = true
                connection.setRequestProperty("Accept", "image/webp,image/jpeg,image/png,image/*")
                val code = connection.responseCode
                if (code !in 200..299) {
                    throw IOException("HTTP $code")
                }
                val finalHost = connection.url.host.lowercase()
                if (!isAllowedRemote("https://$finalHost/")) {
                    throw IOException("Redirected to a host that is not allowed")
                }
                connection.inputStream.use { input ->
                    val buffer = java.io.ByteArrayOutputStream()
                    val chunk = ByteArray(16 * 1024)
                    var total = 0
                    while (true) {
                        val read = input.read(chunk)
                        if (read < 0) {
                            break
                        }
                        total += read
                        if (total > MAX_IMAGE_BYTES) {
                            throw IOException("Image is too large")
                        }
                        buffer.write(chunk, 0, read)
                    }
                    return buffer.toByteArray()
                }
            } finally {
                connection.disconnect()
            }
        }

        fun authorityFor(context: Context): String = context.packageName + ".artwork"
    }
}
