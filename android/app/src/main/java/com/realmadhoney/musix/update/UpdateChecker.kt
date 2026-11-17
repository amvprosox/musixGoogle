package com.realmadhoney.musix.update

import com.realmadhoney.musix.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import org.json.JSONObject
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

    private var lastCheck = 0L

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
        const val AUTO_INTERVAL_MS = 6 * 60 * 60 * 1000L
    }
}
