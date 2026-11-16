package com.realmadhoney.musix.voice

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import androidx.core.content.edit
import com.realmadhoney.musix.core.voice.VoiceAction
import com.realmadhoney.musix.core.voice.VoiceCommand
import com.realmadhoney.musix.core.voice.VoiceIntentMatcher
import kotlinx.serialization.Serializable
import kotlinx.serialization.SerializationException
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@Serializable
private data class StoredCommand(
    val action: String,
    val phrases: List<String>,
)

class VoiceStore(
    context: Context,
) {
    private val prefs = context.getSharedPreferences("musix_voice", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    var enabled: Boolean
        get() = prefs.getBoolean(ENABLED, false)
        set(value) = prefs.edit { putBoolean(ENABLED, value) }

    var microphone: Int
        get() = prefs.getInt(MICROPHONE, AUTO_MICROPHONE)
        set(value) = prefs.edit { putInt(MICROPHONE, value) }

    var speakerCheck: Boolean
        get() = prefs.getBoolean(SPEAKER_CHECK, true)
        set(value) = prefs.edit { putBoolean(SPEAKER_CHECK, value) }

    var threshold: Double
        get() = prefs.getFloat(THRESHOLD, VoiceProcessorSettings.DEFAULT_THRESHOLD.toFloat()).toDouble()
        set(value) = prefs.edit { putFloat(THRESHOLD, value.toFloat()) }

    var sensitivity: Double
        get() = prefs.getFloat(SENSITIVITY, DEFAULT_SENSITIVITY).toDouble()
        set(value) = prefs.edit { putFloat(SENSITIVITY, value.toFloat()) }

    var aiEnabled: Boolean
        get() = prefs.getBoolean(AI_ENABLED, true)
        set(value) = prefs.edit { putBoolean(AI_ENABLED, value) }

    var voiceprint: FloatArray
        get() =
            prefs
                .getString(VOICEPRINT, "")
                .orEmpty()
                .split(',')
                .mapNotNull { it.toFloatOrNull() }
                .toFloatArray()
        set(value) = prefs.edit { putString(VOICEPRINT, value.joinToString(",")) }

    var commands: List<VoiceCommand>
        get() {
            val raw = prefs.getString(COMMANDS, null) ?: return VoiceIntentMatcher.defaultCommands
            val stored =
                try {
                    json.decodeFromString(ListSerializer(StoredCommand.serializer()), raw)
                } catch (error: SerializationException) {
                    return VoiceIntentMatcher.defaultCommands
                } catch (error: IllegalArgumentException) {
                    return VoiceIntentMatcher.defaultCommands
                }
            return VoiceIntentMatcher.sanitize(
                stored.mapNotNull { entry -> VoiceAction.fromId(entry.action)?.let { VoiceCommand(it, entry.phrases) } },
            )
        }
        set(value) {
            val stored = value.map { StoredCommand(it.action.id, it.phrases) }
            prefs.edit { putString(COMMANDS, json.encodeToString(ListSerializer(StoredCommand.serializer()), stored)) }
        }

    fun readAiKey(): String {
        val raw = prefs.getString(AI_KEY, null) ?: return ""
        val parts = raw.split(':')
        if (parts.size != 2) return ""
        return try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(TAG_BITS, Base64.decode(parts[0], Base64.NO_WRAP)))
            String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8)
        } catch (error: GeneralSecurityException) {
            Log.w(TAG, "Could not read the saved AI key", error)
            ""
        } catch (error: IllegalArgumentException) {
            ""
        }
    }

    fun writeAiKey(value: String) {
        val trimmed = value.trim()
        if (trimmed.isEmpty()) {
            prefs.edit { remove(AI_KEY) }
            return
        }
        try {
            val cipher = Cipher.getInstance(TRANSFORMATION)
            cipher.init(Cipher.ENCRYPT_MODE, secretKey())
            val sealed = cipher.doFinal(trimmed.toByteArray(Charsets.UTF_8))
            val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP)
            prefs.edit { putString(AI_KEY, "$iv:${Base64.encodeToString(sealed, Base64.NO_WRAP)}") }
        } catch (error: GeneralSecurityException) {
            Log.w(TAG, "Could not save the AI key", error)
        }
    }

    private fun secretKey(): SecretKey {
        val keyStore = KeyStore.getInstance(KEYSTORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }
        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, KEYSTORE)
        generator.init(
            KeyGenParameterSpec
                .Builder(KEY_ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(KEY_BITS)
                .build(),
        )
        return generator.generateKey()
    }

    companion object {
        const val AUTO_MICROPHONE = 0
        const val DEFAULT_SENSITIVITY = 0.5f
        private const val TAG = "MusixVoice"
        private const val ENABLED = "enabled"
        private const val MICROPHONE = "microphone"
        private const val SPEAKER_CHECK = "speaker_check"
        private const val THRESHOLD = "threshold"
        private const val SENSITIVITY = "sensitivity"
        private const val AI_ENABLED = "ai_enabled"
        private const val VOICEPRINT = "voiceprint"
        private const val COMMANDS = "commands"
        private const val AI_KEY = "ai_key"
        private const val KEYSTORE = "AndroidKeyStore"
        private const val KEY_ALIAS = "musix_openrouter"
        private const val TRANSFORMATION = "AES/GCM/NoPadding"
        private const val TAG_BITS = 128
        private const val KEY_BITS = 256
    }
}
