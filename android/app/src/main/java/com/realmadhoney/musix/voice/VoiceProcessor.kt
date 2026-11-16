package com.realmadhoney.musix.voice

import com.realmadhoney.musix.core.voice.VoiceCommand
import com.realmadhoney.musix.core.voice.VoiceIntentMatcher
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException
import kotlin.random.Random

data class VoiceProcessorSettings(
    val commands: List<VoiceCommand> = VoiceIntentMatcher.defaultCommands,
    val speakerCheck: Boolean = true,
    val threshold: Double = DEFAULT_THRESHOLD,
    val voiceprint: FloatArray = FloatArray(0),
) {
    override fun equals(other: Any?): Boolean =
        other is VoiceProcessorSettings &&
            commands == other.commands &&
            speakerCheck == other.speakerCheck &&
            threshold == other.threshold &&
            voiceprint.contentEquals(other.voiceprint)

    override fun hashCode(): Int = commands.hashCode() * 31 + voiceprint.contentHashCode()

    companion object {
        const val DEFAULT_THRESHOLD = 0.45
    }
}

sealed interface VoiceProcessorEvent {
    data object Wake : VoiceProcessorEvent

    data class Thinking(
        val text: String,
    ) : VoiceProcessorEvent

    data class Resolved(
        val text: String,
    ) : VoiceProcessorEvent

    data object Rejected : VoiceProcessorEvent

    data object Empty : VoiceProcessorEvent
}

class VoiceProcessor(
    private val onEvent: (VoiceProcessorEvent) -> Unit,
) {
    private val worker = Executors.newSingleThreadExecutor { Thread(it, "musix-voice").apply { isDaemon = true } }
    private var engine: SherpaVoiceEngine? = null
    private var settings = VoiceProcessorSettings()
    private var pending = FloatArray(0)
    private val history = FloatArray(HISTORY_SAMPLES)
    private var vadFed = 0L
    private var keywordHeard = false
    private var awaitingUntil = 0L
    private var wakeAudio: FloatArray? = null
    private var awake = false

    fun load(
        pack: File,
        sensitivity: Double,
        done: (Boolean) -> Unit,
    ) {
        if (!submit {
                engine?.release()
                engine = SherpaVoiceEngine.create(pack, sensitivity)
                done(engine != null)
            }
        ) {
            done(false)
        }
    }

    fun unload() {
        submit {
            engine?.release()
            engine = null
            pending = FloatArray(0)
            awaitingUntil = 0L
            wakeAudio = null
            awake = false
        }
    }

    fun shutdown() {
        unload()
        worker.shutdown()
    }

    fun update(next: VoiceProcessorSettings) {
        submit { settings = next }
    }

    fun embedding(
        samples: FloatArray,
        done: (FloatArray) -> Unit,
    ) {
        if (!submit { done(engine?.embedding(samples) ?: FloatArray(0)) }) {
            done(FloatArray(0))
        }
    }

    fun accept(samples: FloatArray) {
        submit { process(samples) }
    }

    private fun submit(block: () -> Unit): Boolean =
        try {
            worker.execute(block)
            true
        } catch (error: RejectedExecutionException) {
            false
        }

    private fun process(samples: FloatArray) {
        val engine = engine ?: return
        if (samples.isEmpty()) return
        val dithered = FloatArray(samples.size) { samples[it] + Random.nextFloat() * 2 * DITHER - DITHER }
        if (engine.spotKeyword(dithered)) {
            keywordHeard = true
            wake()
        }
        pending += dithered
        var offset = 0
        while (pending.size - offset >= SherpaVoiceEngine.VAD_WINDOW) {
            val window = pending.copyOfRange(offset, offset + SherpaVoiceEngine.VAD_WINDOW)
            offset += SherpaVoiceEngine.VAD_WINDOW
            for (index in window.indices) {
                history[((vadFed + index) % history.size).toInt()] = window[index]
            }
            vadFed += window.size
            for (segment in engine.feedVad(window)) {
                handle(engine, withLeadIn(segment.start, segment.samples))
            }
        }
        pending = pending.copyOfRange(offset, pending.size)
        if (awaitingUntil > 0L && System.currentTimeMillis() > awaitingUntil && !engine.isSpeaking) {
            awaitingUntil = 0L
            wakeAudio = null
            awake = false
            onEvent(VoiceProcessorEvent.Empty)
        }
    }

    private fun withLeadIn(
        start: Long,
        samples: FloatArray,
    ): FloatArray {
        val from = maxOf(0L, start - LEAD_IN_SAMPLES, vadFed - history.size)
        val lead = (start - from).toInt()
        if (lead <= 0 || start > vadFed) return samples
        val out = FloatArray(lead + samples.size)
        for (index in 0 until lead) {
            out[index] = history[((from + index) % history.size).toInt()]
        }
        samples.copyInto(out, lead)
        return out
    }

    private fun wake() {
        if (awake) return
        awake = true
        onEvent(VoiceProcessorEvent.Wake)
    }

    private fun handle(
        engine: SherpaVoiceEngine,
        samples: FloatArray,
    ) {
        val keyword = keywordHeard
        keywordHeard = false
        val text = VoiceIntentMatcher.normalize(engine.transcribe(samples))
        if (awaitingUntil > 0L) {
            var cleaned = text
            for (prefix in listOf("yes ", "yeah ", "yep ")) {
                if (cleaned.startsWith(prefix)) cleaned = cleaned.removePrefix(prefix)
            }
            if (cleaned in listOf("yes", "yeah", "yep")) cleaned = ""
            val stripped = VoiceIntentMatcher.stripWakeWord(cleaned)
            if (cleaned.isEmpty() || (stripped.heard && stripped.rest.isEmpty())) return
            awaitingUntil = 0L
            val audio = (wakeAudio ?: FloatArray(0)) + samples
            wakeAudio = null
            resolve(engine, audio, cleaned)
            return
        }
        val stripped = VoiceIntentMatcher.stripWakeWord(text)
        if (!stripped.heard && !keyword) return
        val rest = if (stripped.heard) stripped.rest else VoiceIntentMatcher.dropLeadingWords(text, settings.commands)
        wake()
        if (rest.isEmpty()) {
            wakeAudio = samples
            awaitingUntil = System.currentTimeMillis() + AWAIT_COMMAND_MS
            return
        }
        resolve(engine, samples, rest)
    }

    private fun resolve(
        engine: SherpaVoiceEngine,
        audio: FloatArray,
        text: String,
    ) {
        try {
            onEvent(VoiceProcessorEvent.Thinking(text))
            val print = settings.voiceprint
            if (settings.speakerCheck && print.isNotEmpty()) {
                val embedding = engine.embedding(audio)
                if (embedding.size != print.size || cosine(embedding, print) < settings.threshold) {
                    onEvent(VoiceProcessorEvent.Rejected)
                    return
                }
            }
            onEvent(if (text.isEmpty()) VoiceProcessorEvent.Empty else VoiceProcessorEvent.Resolved(text))
        } finally {
            awake = false
        }
    }

    companion object {
        private const val HISTORY_SAMPLES = SherpaVoiceEngine.SAMPLE_RATE * 14
        private const val LEAD_IN_SAMPLES = (SherpaVoiceEngine.SAMPLE_RATE * 3) / 10
        private const val AWAIT_COMMAND_MS = 6_000L
        private const val DITHER = 0.0001f

        fun cosine(
            a: FloatArray,
            b: FloatArray,
        ): Double {
            var sum = 0.0
            for (index in 0 until minOf(a.size, b.size)) {
                sum += a[index] * b[index]
            }
            return sum
        }
    }
}
