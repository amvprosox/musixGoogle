package com.realmadhoney.musix.voice

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioRecord
import android.media.AudioRouting
import android.media.MediaPlayer
import android.media.MediaRecorder
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.speech.tts.TextToSpeech
import android.util.Log
import androidx.core.content.ContextCompat
import com.realmadhoney.musix.R
import com.realmadhoney.musix.core.voice.AiIntent
import com.realmadhoney.musix.core.voice.AiIntentParser
import com.realmadhoney.musix.core.voice.FreeModel
import com.realmadhoney.musix.core.voice.VoiceAction
import com.realmadhoney.musix.core.voice.VoiceCommand
import com.realmadhoney.musix.core.voice.VoiceIntentMatcher
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.Locale
import kotlin.coroutines.resume
import kotlin.math.sqrt

enum class VoiceSource { Local, Ai }

data class VoiceCommandEvent(
    val action: VoiceAction,
    val query: String,
    val reply: String,
    val transcript: String,
    val source: VoiceSource,
)

data class MicrophoneOption(
    val id: Int,
    val name: String,
)

sealed interface VoiceState {
    data object Off : VoiceState

    data object NeedsPack : VoiceState

    data class Downloading(
        val progress: Float,
    ) : VoiceState

    data object Loading : VoiceState

    data object NeedsPermission : VoiceState

    data object Listening : VoiceState

    data object Awake : VoiceState

    data object Thinking : VoiceState

    data class Error(
        val message: String,
    ) : VoiceState
}

data class VoiceUiState(
    val enabled: Boolean = false,
    val state: VoiceState = VoiceState.Off,
    val packInstalled: Boolean = false,
    val heard: String = "",
    val notice: String = "",
    val inputs: List<MicrophoneOption> = emptyList(),
    val microphone: Int = VoiceStore.AUTO_MICROPHONE,
    val activeInput: String = "",
    val hasVoiceprint: Boolean = false,
    val speakerCheck: Boolean = true,
    val threshold: Double = VoiceProcessorSettings.DEFAULT_THRESHOLD,
    val sensitivity: Double = VoiceStore.DEFAULT_SENSITIVITY.toDouble(),
    val aiEnabled: Boolean = true,
    val hasAiKey: Boolean = false,
    val freeModelCount: Int = 0,
    val enrollPrompt: String = "",
    val busy: Boolean = false,
    val commands: List<VoiceCommand> = VoiceIntentMatcher.defaultCommands,
) {
    val stateText: String
        get() =
            when (state) {
                VoiceState.Off -> "Off"
                VoiceState.NeedsPack -> "Download the voice pack to start listening."
                is VoiceState.Downloading -> "Downloading voice pack ${(state.progress * PERCENT).toInt()}%"
                VoiceState.Loading -> "Starting the voice engine"
                VoiceState.NeedsPermission -> "Allow the microphone to start listening."
                VoiceState.Listening -> "Listening for \"prosox\""
                VoiceState.Awake -> "Yes?"
                VoiceState.Thinking -> "Thinking"
                is VoiceState.Error -> state.message
            }

    private companion object {
        const val PERCENT = 100
    }
}

class VoiceController(
    private val context: Context,
    private val duck: (Boolean) -> Unit,
    private val isOffline: () -> Boolean,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val store = VoiceStore(context)
    private val audioManager = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
    private val main = Handler(Looper.getMainLooper())
    private val stateFlow =
        MutableStateFlow(
            VoiceUiState(
                enabled = store.enabled,
                microphone = store.microphone,
                hasVoiceprint = store.voiceprint.isNotEmpty(),
                speakerCheck = store.speakerCheck,
                threshold = store.threshold,
                sensitivity = store.sensitivity,
                aiEnabled = store.aiEnabled,
                hasAiKey = store.readAiKey().isNotEmpty(),
                commands = store.commands,
            ),
        )
    val state: StateFlow<VoiceUiState> = stateFlow.asStateFlow()

    private val commandFlow = MutableSharedFlow<VoiceCommandEvent>(extraBufferCapacity = 8)
    val commands: SharedFlow<VoiceCommandEvent> = commandFlow.asSharedFlow()

    private var processor: VoiceProcessor? = null
    private var record: AudioRecord? = null
    private var captureThread: Thread? = null

    @Volatile private var capturing = false

    @Volatile private var recording: ArrayList<Float>? = null
    private var tts: TextToSpeech? = null
    private var ttsReady = false
    private var pendingSpeech: String? = null
    private var freeModels: List<FreeModel> = emptyList()
    private var modelsFetchedAt = 0L

    private val deviceCallback =
        object : AudioDeviceCallback() {
            override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>) {
                val before =
                    stateFlow.value.inputs
                        .map { it.id }
                        .toSet()
                refreshInputs()
                val added = stateFlow.value.inputs.firstOrNull { it.id !in before }
                if (added != null && before.isNotEmpty()) {
                    stateFlow.update { it.copy(notice = "Microphone connected: ${added.name}") }
                }
                if (capturing) restartCapture()
            }

            override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>) {
                refreshInputs()
                if (capturing) restartCapture()
            }
        }

    private val packBase: File get() = context.filesDir

    init {
        audioManager.registerAudioDeviceCallback(deviceCallback, main)
        refreshInputs()
        applyEnabled()
    }

    val hasPermission: Boolean
        get() = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED

    fun setEnabled(value: Boolean) {
        store.enabled = value
        stateFlow.update { it.copy(enabled = value, notice = "") }
        applyEnabled()
    }

    fun setMicrophone(id: Int) {
        store.microphone = id
        stateFlow.update { it.copy(microphone = id) }
        if (capturing) restartCapture()
    }

    fun setSpeakerCheck(value: Boolean) {
        store.speakerCheck = value
        stateFlow.update { it.copy(speakerCheck = value) }
        pushSettings()
    }

    fun setThreshold(value: Double) {
        store.threshold = value
        stateFlow.update { it.copy(threshold = value) }
        pushSettings()
    }

    fun setSensitivity(value: Double) {
        store.sensitivity = value
        stateFlow.update { it.copy(sensitivity = value) }
    }

    fun setAiEnabled(value: Boolean) {
        store.aiEnabled = value
        stateFlow.update { it.copy(aiEnabled = value) }
    }

    fun setAiKey(value: String?) {
        store.writeAiKey(value.orEmpty())
        freeModels = emptyList()
        stateFlow.update { it.copy(hasAiKey = store.readAiKey().isNotEmpty(), freeModelCount = 0) }
    }

    fun setCommands(value: List<VoiceCommand>) {
        val clean = VoiceIntentMatcher.sanitize(value)
        store.commands = clean
        stateFlow.update { it.copy(commands = clean) }
        pushSettings()
    }

    fun resetCommands() = setCommands(VoiceIntentMatcher.defaultCommands)

    fun forgetVoice() {
        store.voiceprint = FloatArray(0)
        stateFlow.update { it.copy(hasVoiceprint = false, enrollPrompt = "") }
        pushSettings()
    }

    fun onPermissionResult(granted: Boolean) {
        if (granted) {
            applyEnabled()
        } else {
            stateFlow.update { it.copy(state = VoiceState.Error("Allow microphone access for Musix in Android settings.")) }
        }
    }

    fun onForeground() {
        if (stateFlow.value.enabled && hasPermission && processor != null && !capturing) {
            startCapture()
        }
        if (capturing) startService()
    }

    fun reloadEngine() {
        stopCapture()
        processor?.shutdown()
        processor = null
        applyEnabled()
    }

    fun downloadPack() {
        if (stateFlow.value.busy) return
        stateFlow.update { it.copy(busy = true, state = VoiceState.Downloading(0f)) }
        scope.launch {
            try {
                withContext(Dispatchers.IO) {
                    VoicePack.install(packBase) { progress ->
                        stateFlow.update { current ->
                            if (current.state is VoiceState.Downloading) current.copy(state = VoiceState.Downloading(progress)) else current
                        }
                    }
                }
                stateFlow.update { it.copy(busy = false, state = VoiceState.Loading) }
                applyEnabled()
            } catch (error: IOException) {
                Log.w(TAG, "Voice pack download failed", error)
                stateFlow.update {
                    it.copy(busy = false, state = VoiceState.Error("Voice pack download failed. Check your connection and try again."))
                }
            }
        }
    }

    private fun applyEnabled() {
        val installed = VoicePack.isInstalled(packBase)
        stateFlow.update { it.copy(packInstalled = installed) }
        if (!stateFlow.value.enabled) {
            stopCapture()
            processor?.shutdown()
            processor = null
            stopService()
            stateFlow.update { it.copy(state = VoiceState.Off) }
            return
        }
        if (!installed) {
            stateFlow.update { it.copy(state = VoiceState.NeedsPack) }
            return
        }
        if (processor == null) {
            loadEngine()
        } else if (!capturing) {
            startIfAllowed()
        }
    }

    private fun loadEngine() {
        stateFlow.update { it.copy(state = VoiceState.Loading) }
        val next = VoiceProcessor { event -> main.post { handle(event) } }
        processor = next
        pushSettings()
        next.load(VoicePack.directory(packBase), stateFlow.value.sensitivity) { ok ->
            main.post {
                if (processor !== next) return@post
                if (ok) {
                    startIfAllowed()
                } else {
                    stateFlow.update { it.copy(state = VoiceState.Error("The voice pack could not be loaded. Download it again.")) }
                }
            }
        }
    }

    private fun startIfAllowed() {
        if (!hasPermission) {
            stateFlow.update { it.copy(state = VoiceState.NeedsPermission) }
            return
        }
        startCapture()
        if (capturing) startService()
    }

    private fun pushSettings() {
        val current = stateFlow.value
        processor?.update(
            VoiceProcessorSettings(
                commands = current.commands,
                speakerCheck = current.speakerCheck,
                threshold = current.threshold,
                voiceprint = store.voiceprint,
            ),
        )
    }

    private fun refreshInputs() {
        val devices = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
        val inputs =
            devices
                .filter { it.type != AudioDeviceInfo.TYPE_TELEPHONY && it.type != TYPE_REMOTE_SUBMIX }
                .map { MicrophoneOption(it.id, describe(it)) }
                .distinctBy { it.id }
        stateFlow.update { it.copy(inputs = inputs) }
    }

    private fun describe(device: AudioDeviceInfo): String {
        val kind =
            when (device.type) {
                AudioDeviceInfo.TYPE_BUILTIN_MIC -> "Phone microphone"
                AudioDeviceInfo.TYPE_WIRED_HEADSET -> "Wired headset"
                AudioDeviceInfo.TYPE_USB_DEVICE, AudioDeviceInfo.TYPE_USB_HEADSET, AudioDeviceInfo.TYPE_USB_ACCESSORY -> "USB microphone"
                AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> "Bluetooth headset"
                else -> "Microphone"
            }
        val name =
            device.productName
                ?.toString()
                .orEmpty()
                .trim()
        val address = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) device.address.orEmpty() else ""
        return when {
            device.type == AudioDeviceInfo.TYPE_BUILTIN_MIC && address.isNotEmpty() -> "$kind ($address)"
            name.isNotEmpty() && device.type != AudioDeviceInfo.TYPE_BUILTIN_MIC -> "$kind: $name"
            else -> kind
        }
    }

    private fun preferredDevice(): AudioDeviceInfo? {
        val devices = audioManager.getDevices(AudioManager.GET_DEVICES_INPUTS)
        val chosen = stateFlow.value.microphone
        if (chosen != VoiceStore.AUTO_MICROPHONE) {
            devices.firstOrNull { it.id == chosen }?.let { return it }
        }
        return devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_WIRED_HEADSET || it.type == AudioDeviceInfo.TYPE_USB_HEADSET }
            ?: devices.firstOrNull { it.type == AudioDeviceInfo.TYPE_BUILTIN_MIC }
    }

    private fun restartCapture() {
        if (!stateFlow.value.enabled || processor == null) return
        stopCapture()
        startCapture()
    }

    @SuppressLint("MissingPermission")
    private fun startCapture() {
        if (capturing) return
        if (!hasPermission) {
            stateFlow.update { it.copy(state = VoiceState.NeedsPermission) }
            return
        }
        val minBuffer =
            AudioRecord.getMinBufferSize(SherpaVoiceEngine.SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_FLOAT)
        if (minBuffer <= 0) {
            stateFlow.update { it.copy(state = VoiceState.Error("No microphone is available.")) }
            return
        }
        val recorder =
            try {
                AudioRecord(
                    MediaRecorder.AudioSource.VOICE_RECOGNITION,
                    SherpaVoiceEngine.SAMPLE_RATE,
                    AudioFormat.CHANNEL_IN_MONO,
                    AudioFormat.ENCODING_PCM_FLOAT,
                    maxOf(minBuffer, CHUNK * FLOAT_BYTES * 4),
                )
            } catch (error: IllegalArgumentException) {
                Log.w(TAG, "Microphone setup failed", error)
                null
            } catch (error: SecurityException) {
                Log.w(TAG, "Microphone permission missing", error)
                null
            }
        if (recorder == null || recorder.state != AudioRecord.STATE_INITIALIZED) {
            recorder?.release()
            stateFlow.update { it.copy(state = VoiceState.Error("The microphone is busy in another app.")) }
            return
        }
        recorder.preferredDevice = preferredDevice()
        try {
            recorder.startRecording()
        } catch (error: IllegalStateException) {
            recorder.release()
            stateFlow.update { it.copy(state = VoiceState.Error("The microphone could not start.")) }
            return
        }
        record = recorder
        capturing = true
        stateFlow.update {
            it.copy(state = VoiceState.Listening, activeInput = recorder.routedDevice?.let(::describe) ?: "Phone microphone")
        }
        recorder.addOnRoutingChangedListener(
            AudioRouting.OnRoutingChangedListener { routing ->
                val name = routing.routedDevice?.let(::describe).orEmpty()
                stateFlow.update { it.copy(activeInput = name) }
            },
            main,
        )
        captureThread =
            Thread({ readLoop(recorder) }, "musix-mic").apply {
                isDaemon = true
                start()
            }
    }

    private fun readLoop(recorder: AudioRecord) {
        val buffer = FloatArray(CHUNK)
        while (capturing && record === recorder) {
            val read = recorder.read(buffer, 0, buffer.size, AudioRecord.READ_BLOCKING)
            if (read <= 0) {
                if (read < 0) break
                continue
            }
            val samples = buffer.copyOf(read)
            val clip = recording
            if (clip != null) {
                synchronized(clip) { samples.forEach { clip.add(it) } }
            } else {
                processor?.accept(samples)
            }
        }
    }

    private fun stopCapture() {
        if (!capturing && record == null) return
        capturing = false
        val recorder = record
        record = null
        try {
            recorder?.stop()
        } catch (error: IllegalStateException) {
            Log.w(TAG, "Microphone stop failed", error)
        }
        captureThread?.join(JOIN_MS)
        captureThread = null
        recorder?.release()
    }

    private fun startService() {
        try {
            ContextCompat.startForegroundService(context, Intent(context, VoiceService::class.java))
        } catch (error: IllegalStateException) {
            Log.w(TAG, "Voice service could not start; listening only while Musix is open", error)
        } catch (error: SecurityException) {
            Log.w(TAG, "Voice service is not allowed", error)
        }
    }

    private fun stopService() {
        context.stopService(Intent(context, VoiceService::class.java))
    }

    private fun handle(event: VoiceProcessorEvent) {
        when (event) {
            VoiceProcessorEvent.Wake -> {
                stateFlow.update { it.copy(state = VoiceState.Awake) }
                duck(true)
                playYes()
            }

            is VoiceProcessorEvent.Thinking -> {
                stateFlow.update { it.copy(state = VoiceState.Thinking, heard = event.text) }
            }

            VoiceProcessorEvent.Rejected -> {
                finish("That did not sound like your voice.")
            }

            VoiceProcessorEvent.Empty -> {
                finish("I did not hear a command.")
            }

            is VoiceProcessorEvent.Resolved -> {
                scope.launch {
                    resolve(event.text)
                    finish(null)
                }
            }
        }
    }

    private fun finish(notice: String?) {
        duck(false)
        stateFlow.update {
            it.copy(
                state = if (capturing) VoiceState.Listening else it.state,
                notice = notice ?: it.notice,
            )
        }
    }

    private fun playYes() {
        val player = MediaPlayer()
        try {
            player.setAudioAttributes(
                AudioAttributes
                    .Builder()
                    .setUsage(AudioAttributes.USAGE_ASSISTANT)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                    .build(),
            )
            context.resources.openRawResourceFd(R.raw.voice_yes).use { file ->
                player.setDataSource(file.fileDescriptor, file.startOffset, file.length)
            }
            player.setOnCompletionListener { it.release() }
            player.prepare()
            player.start()
        } catch (error: IOException) {
            Log.w(TAG, "Could not play the reply sound", error)
            player.release()
        } catch (error: IllegalStateException) {
            player.release()
        }
    }

    fun say(text: String) {
        if (text.isBlank()) return
        val engine = tts
        if (engine == null) {
            pendingSpeech = text
            tts =
                TextToSpeech(context) { status ->
                    main.post {
                        ttsReady = status == TextToSpeech.SUCCESS
                        if (ttsReady) configureVoice()
                        pendingSpeech?.let { speak(it) }
                        pendingSpeech = null
                    }
                }
            return
        }
        if (ttsReady) speak(text) else pendingSpeech = text
    }

    private fun configureVoice() {
        val engine = tts ?: return
        engine.language = Locale.US
        val male = listOf("-iom-", "-tpd-", "-iol-")
        val voices = engine.voices.orEmpty().filter { it.locale.language == "en" && !it.isNetworkConnectionRequired }
        voices.firstOrNull { voice -> male.any { voice.name.contains(it, ignoreCase = true) } }?.let { engine.voice = it }
        engine.setPitch(VOICE_PITCH)
        engine.setSpeechRate(VOICE_RATE)
    }

    private fun speak(text: String) {
        tts?.setAudioAttributes(
            AudioAttributes
                .Builder()
                .setUsage(AudioAttributes.USAGE_ASSISTANT)
                .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                .build(),
        )
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "musix-voice")
    }

    fun notice(text: String) {
        stateFlow.update { it.copy(notice = text) }
    }

    private suspend fun resolve(text: String) {
        val commands = stateFlow.value.commands
        val local = VoiceIntentMatcher.match(text, commands)
        if (local != null) {
            commandFlow.emit(VoiceCommandEvent(local.action, local.query, "", text, VoiceSource.Local))
            return
        }
        if (VoiceIntentMatcher.isOutOfScope(text)) {
            notice(VoiceIntentMatcher.OUT_OF_SCOPE_REPLY)
            say(VoiceIntentMatcher.OUT_OF_SCOPE_REPLY)
            return
        }
        val ai = askAi(text)
        val action = ai?.action
        if (ai != null && action != null) {
            commandFlow.emit(VoiceCommandEvent(action, ai.query, ai.reply, text, VoiceSource.Ai))
            return
        }
        notice("Sorry, I did not understand \"$text\".")
        say("Sorry, I did not catch that.")
    }

    private suspend fun loadFreeModels(key: String): List<FreeModel> {
        if (freeModels.isNotEmpty() && System.currentTimeMillis() - modelsFetchedAt < MODELS_TTL_MS) return freeModels
        val body = withContext(Dispatchers.IO) { http("GET", "${AiIntentParser.BASE}/models", key, null) } ?: return emptyList()
        if (body.first != HttpURLConnection.HTTP_OK) return emptyList()
        freeModels = AiIntentParser.freeModels(body.second)
        modelsFetchedAt = System.currentTimeMillis()
        stateFlow.update { it.copy(freeModelCount = freeModels.size) }
        return freeModels
    }

    private suspend fun askAi(text: String): AiIntent? {
        val key = store.readAiKey()
        if (!stateFlow.value.aiEnabled || key.isEmpty()) return null
        val offline = isOffline()
        for (model in loadFreeModels(key).take(MAX_MODELS)) {
            if (!AiIntentParser.isFreeModelId(model.id)) continue
            val request = AiIntentParser.requestBody(model.id, text.take(MAX_TEXT), offline)
            val response =
                withContext(Dispatchers.IO) { http("POST", "${AiIntentParser.BASE}/chat/completions", key, request) } ?: continue
            val status = response.first
            if (status == HTTP_TOO_MANY || status >= HttpURLConnection.HTTP_INTERNAL_ERROR) continue
            if (status != HttpURLConnection.HTTP_OK) return null
            AiIntentParser.parseIntent(AiIntentParser.chatContent(response.second))?.let { return it }
        }
        return null
    }

    private fun http(
        method: String,
        address: String,
        key: String,
        body: String?,
    ): Pair<Int, String>? {
        val connection = URL(address).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = method
            connection.connectTimeout = HTTP_TIMEOUT_MS
            connection.readTimeout = HTTP_TIMEOUT_MS
            connection.setRequestProperty("Authorization", "Bearer $key")
            connection.setRequestProperty("X-Title", "Musix")
            if (body != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText().take(MAX_RESPONSE) }.orEmpty()
            code to text
        } catch (error: IOException) {
            Log.w(TAG, "AI request failed", error)
            null
        } finally {
            connection.disconnect()
        }
    }

    private suspend fun recordClip(millis: Long): FloatArray {
        if (!capturing) startCapture()
        if (!capturing) return FloatArray(0)
        val clip = ArrayList<Float>()
        recording = clip
        delay(millis)
        recording = null
        return synchronized(clip) { clip.toFloatArray() }
    }

    private suspend fun embedding(samples: FloatArray): FloatArray {
        val active = processor ?: return FloatArray(0)
        return suspendCancellableCoroutine { continuation ->
            active.embedding(samples) { result -> continuation.resume(result) }
        }
    }

    fun enroll() {
        val current = stateFlow.value
        if (current.busy) return
        if (processor == null || !capturing) {
            notifyEnroll("Turn on the voice assistant first.")
            return
        }
        stateFlow.update { it.copy(busy = true) }
        scope.launch {
            try {
                val vectors = ArrayList<FloatArray>()
                for ((index, phrase) in ENROLL_PHRASES.withIndex()) {
                    notifyEnroll("Say (${index + 1}/${ENROLL_PHRASES.size}): \"$phrase\"")
                    val vector = embedding(recordClip(ENROLL_CLIP_MS))
                    if (vector.isNotEmpty()) vectors += vector
                }
                val dim = vectors.firstOrNull()?.size ?: 0
                if (vectors.size < MIN_ENROLL_CLIPS || dim == 0) {
                    notifyEnroll("Could not hear enough. Try again somewhere quieter.")
                    return@launch
                }
                val mean = FloatArray(dim)
                for (vector in vectors) {
                    for (index in 0 until dim) mean[index] += vector[index] / vectors.size
                }
                val norm = sqrt(mean.fold(0f) { sum, value -> sum + value * value })
                if (norm > 0f) for (index in mean.indices) mean[index] /= norm
                val lowest = vectors.minOf { VoiceProcessor.cosine(it, mean) }
                val threshold = Math.round((lowest - ENROLL_MARGIN).coerceIn(MIN_THRESHOLD, MAX_THRESHOLD) * 100) / 100.0
                store.voiceprint = mean
                store.speakerCheck = true
                store.threshold = threshold
                stateFlow.update { it.copy(hasVoiceprint = true, speakerCheck = true, threshold = threshold) }
                pushSettings()
                notifyEnroll("Voice saved. Match threshold set to ${"%.2f".format(Locale.US, threshold)}.")
            } finally {
                stateFlow.update { it.copy(busy = false) }
            }
        }
    }

    fun testVoice() {
        val current = stateFlow.value
        val print = store.voiceprint
        if (current.busy) return
        if (print.isEmpty()) {
            notifyEnroll("Teach Musix your voice first.")
            return
        }
        stateFlow.update { it.copy(busy = true) }
        scope.launch {
            try {
                notifyEnroll("Say anything for 3 seconds...")
                val vector = embedding(recordClip(TEST_CLIP_MS))
                if (vector.size != print.size) {
                    notifyEnroll("Could not hear you. Try again.")
                    return@launch
                }
                val score = VoiceProcessor.cosine(vector, print)
                val needed = stateFlow.value.threshold
                val verdict = if (score >= needed) "that is you" else "not a match"
                notifyEnroll(
                    "Match score ${"%.2f".format(Locale.US, score)} (needs ${"%.2f".format(Locale.US, needed)}): $verdict.",
                )
            } finally {
                stateFlow.update { it.copy(busy = false) }
            }
        }
    }

    private fun notifyEnroll(text: String) {
        stateFlow.update { it.copy(enrollPrompt = text) }
    }

    companion object {
        private const val TAG = "MusixVoice"
        private const val CHUNK = 1600
        private const val TYPE_REMOTE_SUBMIX = 25
        private const val FLOAT_BYTES = 4
        private const val JOIN_MS = 500L
        private const val VOICE_PITCH = 0.85f
        private const val VOICE_RATE = 0.95f
        private const val MODELS_TTL_MS = 6 * 60 * 60 * 1000L
        private const val MAX_MODELS = 4
        private const val MAX_TEXT = 400
        private const val MAX_RESPONSE = 2_000_000
        private const val HTTP_TIMEOUT_MS = 9_000
        private const val HTTP_TOO_MANY = 429
        private const val ENROLL_CLIP_MS = 3_500L
        private const val TEST_CLIP_MS = 3_000L
        private const val MIN_ENROLL_CLIPS = 3
        private const val ENROLL_MARGIN = 0.15
        private const val MIN_THRESHOLD = 0.25
        private const val MAX_THRESHOLD = 0.7
        val ENROLL_PHRASES =
            listOf(
                "Prosox, play my favorite songs.",
                "Prosox, what is playing right now?",
                "I like listening to music in the morning.",
                "Prosox, turn on shuffle and play something new.",
                "The weather is nice and the coffee is warm.",
            )
    }
}
