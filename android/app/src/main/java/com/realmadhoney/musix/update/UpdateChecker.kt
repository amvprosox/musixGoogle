package com.realmadhoney.musix.update

import android.content.Context
import android.content.Intent
import androidx.core.content.FileProvider
import com.realmadhoney.musix.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Checks the latest GitHub release for a newer Android build: when the app opens and every
 * few hours while online. Download opens the new APK so the phone can install it.
 */
class UpdateChecker {
    data class Update(
        val version: String,
        val versionCode: Int,
        val apkUrl: String,
    )

    private val available = MutableStateFlow<Update?>(null)
    val update: StateFlow<Update?> = available.asStateFlow()

    private val message = MutableStateFlow("Musix checks for updates when it opens and every few hours.")
    val status: StateFlow<String> = message.asStateFlow()

    private val apk = MutableStateFlow<File?>(null)

    /** The downloaded update, ready for the one-tap install. */
    val readyApk: StateFlow<File?> = apk.asStateFlow()

    private var lastCheck = 0L

    /** Downloads the new APK in the background so installing takes one tap. */
    suspend fun download(
        context: Context,
        update: Update,
    ): File? {
        message.value = "Downloading Musix ${update.version} in the background..."
        val file =
            withContext(Dispatchers.IO) {
                runCatching {
                    val dir = File(context.cacheDir, "updates").apply { mkdirs() }
                    val target = File(dir, "musix-update.apk")
                    val partial = File(dir, "musix-update.apk.part")
                    val connection = URL(update.apkUrl).openConnection() as HttpURLConnection
                    connection.connectTimeout = TIMEOUT_MS
                    connection.readTimeout = DOWNLOAD_TIMEOUT_MS
                    try {
                        check(connection.responseCode == HttpURLConnection.HTTP_OK)
                        val expected = connection.contentLengthLong
                        connection.inputStream.use { input -> partial.outputStream().use { input.copyTo(it) } }
                        check(expected <= 0 || partial.length() == expected)
                        target.delete()
                        check(partial.renameTo(target))
                        target
                    } finally {
                        connection.disconnect()
                    }
                }.getOrNull()
            }
        apk.value = file
        message.value =
            if (file != null) {
                "Musix ${update.version} is downloaded. Tap Install to update."
            } else {
                "The update could not be downloaded. Musix will try again later."
            }
        return file
    }

    /** Opens Android's installer for the downloaded update (one tap on Install). */
    fun installIntent(
        context: Context,
        file: File,
    ): Intent =
        Intent(Intent.ACTION_VIEW)
            .setDataAndType(
                FileProvider.getUriForFile(context, "${context.packageName}.updates", file),
                "application/vnd.android.package-archive",
            ).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)

    suspend fun check(manual: Boolean): Update? {
        lastCheck = System.currentTimeMillis()
        if (manual) {
            message.value = "Checking for updates..."
        }
        val latest =
            withContext(Dispatchers.IO) {
                runCatching {
                    val connection = URL(LATEST_FILE).openConnection() as HttpURLConnection
                    connection.connectTimeout = TIMEOUT_MS
                    connection.readTimeout = TIMEOUT_MS
                    connection.instanceFollowRedirects = true
                    try {
                        if (connection.responseCode != HttpURLConnection.HTTP_OK) {
                            null
                        } else {
                            JSONObject(connection.inputStream.bufferedReader().use { it.readText() })
                        }
                    } finally {
                        connection.disconnect()
                    }
                }.getOrNull()
            }
        if (latest == null) {
            if (manual) {
                message.value = "Could not check for updates. Check your connection."
            }
            return null
        }
        val version = latest.optString("version")
        val versionCode = latest.optInt("androidVersionCode")
        val apk = latest.optJSONObject("files")?.optString("android").orEmpty()
        val found =
            if (versionCode > BuildConfig.VERSION_CODE && apk.matches(Regex("[\\w.-]+"))) {
                Update(version, versionCode, "$RELEASES/latest/download/$apk")
            } else {
                null
            }
        available.value = found
        message.value =
            if (found != null) {
                "Musix $version (build $versionCode) is available."
            } else {
                "You have the latest Musix ($version)."
            }
        return found
    }

    suspend fun autoCheck(): Update? =
        if (System.currentTimeMillis() - lastCheck < AUTO_INTERVAL_MS) {
            null
        } else {
            check(manual = false)
        }

    companion object {
        private const val RELEASES = "https://github.com/amvprosox/musixGoogle/releases"
        private const val LATEST_FILE = "$RELEASES/latest/download/latest.json"
        private const val TIMEOUT_MS = 15_000
        private const val DOWNLOAD_TIMEOUT_MS = 60_000
        const val AUTO_INTERVAL_MS = 6 * 60 * 60 * 1000L
    }
}
