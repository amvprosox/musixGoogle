package com.realmadhoney.musix.voice

import android.util.Log
import com.k2fsa.sherpa.onnx.FeatureConfig
import com.k2fsa.sherpa.onnx.KeywordSpotter
import com.k2fsa.sherpa.onnx.KeywordSpotterConfig
import com.k2fsa.sherpa.onnx.OfflineModelConfig
import com.k2fsa.sherpa.onnx.OfflineRecognizer
import com.k2fsa.sherpa.onnx.OfflineRecognizerConfig
import com.k2fsa.sherpa.onnx.OfflineTransducerModelConfig
import com.k2fsa.sherpa.onnx.OnlineModelConfig
import com.k2fsa.sherpa.onnx.OnlineStream
import com.k2fsa.sherpa.onnx.OnlineTransducerModelConfig
import com.k2fsa.sherpa.onnx.SileroVadModelConfig
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractor
import com.k2fsa.sherpa.onnx.SpeakerEmbeddingExtractorConfig
import com.k2fsa.sherpa.onnx.Vad
import com.k2fsa.sherpa.onnx.VadModelConfig
import java.io.File
import kotlin.math.sqrt

class VoiceSegment(
    val start: Long,
    val samples: FloatArray,
)

class SherpaVoiceEngine private constructor(
    private val spotter: KeywordSpotter,
    private val spotterStream: OnlineStream,
    private val vad: Vad,
    private val recognizer: OfflineRecognizer,
    private val extractor: SpeakerEmbeddingExtractor,
) {
    fun spotKeyword(samples: FloatArray): Boolean {
        var found = false
        spotterStream.acceptWaveform(samples, SAMPLE_RATE)
        while (spotter.isReady(spotterStream)) {
            spotter.decode(spotterStream)
            if (spotter.getResult(spotterStream).keyword.isNotEmpty()) {
                found = true
                spotter.reset(spotterStream)
            }
        }
        return found
    }

    fun feedVad(window: FloatArray): List<VoiceSegment> {
        vad.acceptWaveform(window)
        val segments = ArrayList<VoiceSegment>()
        while (!vad.empty()) {
            val segment = vad.front()
            if (segment.samples.isNotEmpty()) {
                segments += VoiceSegment(segment.start, segment.samples)
            }
            vad.pop()
        }
        return segments
    }

    val isSpeaking: Boolean get() = vad.isSpeechDetected()

    fun transcribe(samples: FloatArray): String {
        if (samples.size < SAMPLE_RATE / 5) return ""
        val stream = recognizer.createStream()
        return try {
            stream.acceptWaveform(samples, SAMPLE_RATE)
            recognizer.decode(stream)
            recognizer.getResult(stream).text.trim()
        } finally {
            stream.release()
        }
    }

    fun embedding(samples: FloatArray): FloatArray {
        if (samples.isEmpty()) return FloatArray(0)
        val stream = extractor.createStream()
        return try {
            stream.acceptWaveform(samples, SAMPLE_RATE)
            stream.inputFinished()
            if (!extractor.isReady(stream)) return FloatArray(0)
            val raw = extractor.compute(stream)
            val norm = sqrt(raw.fold(0f) { sum, value -> sum + value * value })
            if (norm > 0f) FloatArray(raw.size) { raw[it] / norm } else raw
        } finally {
            stream.release()
        }
    }

    fun release() {
        spotterStream.release()
        spotter.release()
        vad.release()
        recognizer.release()
        extractor.release()
    }

    companion object {
        const val SAMPLE_RATE = 16_000
        const val VAD_WINDOW = 512
        private const val FEATURE_DIM = 80
        private const val TAG = "MusixVoice"

        val REQUIRED =
            listOf(
                "kws/encoder.int8.onnx",
                "kws/decoder.int8.onnx",
                "kws/joiner.int8.onnx",
                "kws/tokens.txt",
                "kws/keywords.txt",
                "vad/silero_vad.onnx",
                "asr/encoder.int8.onnx",
                "asr/decoder.int8.onnx",
                "asr/joiner.int8.onnx",
                "asr/tokens.txt",
                "speaker/campplus_en.onnx",
            )

        private val WAKE_KEYWORDS =
            listOf(
                "▁ VER U @VERU",
                "▁ VE ▁RU @VERU",
                "▁BE RU @VERU",
                "▁BE ▁RU @VERU",
                "▁ VE Y RU @VERU",
                "▁ VE Y ▁RU @VERU",
                "▁BI RO @VERU",
                "▁BI ▁RO @VERU",
                "▁BE RO @VERU",
                "▁BE ▁RO @VERU",
                "▁ VER O @VERU",
                "▁BE R RU @VERU",
                "▁BI RU @VERU",
                "▁VA Y RU @VERU",
                "▁BA Y RU @VERU",
            )

        private fun wakeKeywordsFile(pack: File): String {
            val file = File(pack, "kws/keywords-veru.txt")
            val text = WAKE_KEYWORDS.joinToString("\n") + "\n"
            try {
                if (!file.isFile || file.readText() != text) file.writeText(text)
            } catch (error: java.io.IOException) {
                Log.w(TAG, "Could not write the wake word file", error)
            }
            return file.absolutePath
        }

        fun isInstalled(pack: File): Boolean = REQUIRED.all { File(pack, it).isFile }

        fun create(
            pack: File,
            sensitivity: Double,
        ): SherpaVoiceEngine? {
            if (!isInstalled(pack)) return null
            val path = { relative: String -> File(pack, relative).absolutePath }
            val feature = FeatureConfig(sampleRate = SAMPLE_RATE, featureDim = FEATURE_DIM)
            val kwsConfig =
                KeywordSpotterConfig(
                    featConfig = feature,
                    modelConfig =
                        OnlineModelConfig(
                            transducer =
                                OnlineTransducerModelConfig(
                                    encoder = path("kws/encoder.int8.onnx"),
                                    decoder = path("kws/decoder.int8.onnx"),
                                    joiner = path("kws/joiner.int8.onnx"),
                                ),
                            tokens = path("kws/tokens.txt"),
                            numThreads = 1,
                            provider = "cpu",
                        ),
                    maxActivePaths = 4,
                    keywordsFile = wakeKeywordsFile(pack),
                    keywordsScore = (1.0 + sensitivity).toFloat(),
                    keywordsThreshold = (0.3 - sensitivity * 0.2).toFloat(),
                    numTrailingBlanks = 1,
                )
            val vadConfig =
                VadModelConfig(
                    sileroVadModelConfig =
                        SileroVadModelConfig(
                            model = path("vad/silero_vad.onnx"),
                            threshold = 0.5f,
                            minSilenceDuration = 0.3f,
                            minSpeechDuration = 0.15f,
                            windowSize = VAD_WINDOW,
                            maxSpeechDuration = 8f,
                        ),
                    sampleRate = SAMPLE_RATE,
                    numThreads = 1,
                    provider = "cpu",
                )
            val asrConfig =
                OfflineRecognizerConfig(
                    featConfig = feature,
                    modelConfig =
                        OfflineModelConfig(
                            transducer =
                                OfflineTransducerModelConfig(
                                    encoder = path("asr/encoder.int8.onnx"),
                                    decoder = path("asr/decoder.int8.onnx"),
                                    joiner = path("asr/joiner.int8.onnx"),
                                ),
                            tokens = path("asr/tokens.txt"),
                            numThreads = 2,
                            provider = "cpu",
                        ),
                    decodingMethod = "greedy_search",
                    maxActivePaths = 4,
                )
            val speakerConfig =
                SpeakerEmbeddingExtractorConfig(
                    model = path("speaker/campplus_en.onnx"),
                    numThreads = 1,
                    provider = "cpu",
                )
            return try {
                val spotter = KeywordSpotter(null, kwsConfig)
                SherpaVoiceEngine(
                    spotter = spotter,
                    spotterStream = spotter.createStream(),
                    vad = Vad(null, vadConfig),
                    recognizer = OfflineRecognizer(null, asrConfig),
                    extractor = SpeakerEmbeddingExtractor(null, speakerConfig),
                )
            } catch (error: LinkageError) {
                Log.w(TAG, "Voice engine library failed to load", error)
                null
            } catch (error: IllegalArgumentException) {
                Log.w(TAG, "Voice engine models failed to load", error)
                null
            }
        }
    }
}
