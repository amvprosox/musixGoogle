import Foundation
import SherpaOnnxC

final class SherpaVoiceEngine {
    static let sampleRate = 16_000
    static let vadWindow = 512
    static let wakeKeywords = [
        "▁PRO SE C S @PROSECS",
        "▁PRO ▁SE C S @PROSECS",
        "▁PRO ▁SE X @PROSECS",
        "▁PRO SE X @PROSECS",
        "▁PRO ▁SE K S @PROSECS",
        "▁PRO SE K S @PROSECS",
        "▁PRO ▁SE CK S @PROSECS",
        "▁PRO S I X @PROSECS",
        "▁PRO ▁SIX @PROSECS",
        "▁PRO CH I X @PROSECS",
        "▁PRO ▁CHI X @PROSECS",
        "▁PRO CH E K S @PROSECS",
        "▁PRO ▁C HE K S @PROSECS",
        "▁PRO ▁C HE CK S @PROSECS",
    ]

    private var strings: [UnsafeMutablePointer<CChar>] = []
    private let spotter: OpaquePointer
    private let spotterStream: OpaquePointer
    private let vad: OpaquePointer
    private let recognizer: OpaquePointer
    private let extractor: OpaquePointer

    init?(packDirectory: URL, sensitivity: Double) {
        let path = { (relative: String) in packDirectory.appendingPathComponent(relative).path }
        let required = [
            "kws/encoder.int8.onnx", "kws/decoder.int8.onnx", "kws/joiner.int8.onnx", "kws/tokens.txt", "kws/keywords.txt",
            "vad/silero_vad.onnx", "asr/encoder.int8.onnx", "asr/decoder.int8.onnx", "asr/joiner.int8.onnx", "asr/tokens.txt",
            "speaker/campplus_en.onnx",
        ]
        guard required.allSatisfy({ FileManager.default.fileExists(atPath: path($0)) }) else {
            return nil
        }
        var owned: [UnsafeMutablePointer<CChar>] = []
        let c = { (value: String) -> UnsafePointer<CChar>? in
            guard let pointer = strdup(value) else {
                return nil
            }
            owned.append(pointer)
            return UnsafePointer(pointer)
        }

        var kws = SherpaOnnxKeywordSpotterConfig()
        kws.feat_config.sample_rate = Int32(Self.sampleRate)
        kws.feat_config.feature_dim = 80
        kws.model_config.transducer.encoder = c(path("kws/encoder.int8.onnx"))
        kws.model_config.transducer.decoder = c(path("kws/decoder.int8.onnx"))
        kws.model_config.transducer.joiner = c(path("kws/joiner.int8.onnx"))
        kws.model_config.tokens = c(path("kws/tokens.txt"))
        kws.model_config.num_threads = 1
        kws.model_config.provider = c("cpu")
        kws.max_active_paths = 4
        kws.num_trailing_blanks = 1
        kws.keywords_score = Float(1 + sensitivity)
        kws.keywords_threshold = Float(0.3 - sensitivity * 0.2)
        let wakeFile = path("kws/keywords-prosecs.txt")
        let wakeText = Self.wakeKeywords.joined(separator: "\n") + "\n"
        if (try? String(contentsOfFile: wakeFile, encoding: .utf8)) != wakeText {
            try? wakeText.write(toFile: wakeFile, atomically: true, encoding: .utf8)
        }
        kws.keywords_file = c(wakeFile)

        var vadConfig = SherpaOnnxVadModelConfig()
        vadConfig.silero_vad.model = c(path("vad/silero_vad.onnx"))
        vadConfig.silero_vad.threshold = 0.5
        vadConfig.silero_vad.min_silence_duration = 0.3
        vadConfig.silero_vad.min_speech_duration = 0.15
        vadConfig.silero_vad.window_size = Int32(Self.vadWindow)
        vadConfig.silero_vad.max_speech_duration = 8
        vadConfig.sample_rate = Int32(Self.sampleRate)
        vadConfig.num_threads = 1
        vadConfig.provider = c("cpu")

        var asr = SherpaOnnxOfflineRecognizerConfig()
        asr.feat_config.sample_rate = Int32(Self.sampleRate)
        asr.feat_config.feature_dim = 80
        asr.model_config.transducer.encoder = c(path("asr/encoder.int8.onnx"))
        asr.model_config.transducer.decoder = c(path("asr/decoder.int8.onnx"))
        asr.model_config.transducer.joiner = c(path("asr/joiner.int8.onnx"))
        asr.model_config.tokens = c(path("asr/tokens.txt"))
        asr.model_config.num_threads = 2
        asr.model_config.provider = c("cpu")
        asr.decoding_method = c("greedy_search")
        asr.max_active_paths = 4

        var speaker = SherpaOnnxSpeakerEmbeddingExtractorConfig()
        speaker.model = c(path("speaker/campplus_en.onnx"))
        speaker.num_threads = 1
        speaker.provider = c("cpu")

        guard let spotter = SherpaOnnxCreateKeywordSpotter(&kws),
              let stream = SherpaOnnxCreateKeywordStream(spotter),
              let vad = SherpaOnnxCreateVoiceActivityDetector(&vadConfig, 12),
              let recognizer = SherpaOnnxCreateOfflineRecognizer(&asr),
              let extractor = SherpaOnnxCreateSpeakerEmbeddingExtractor(&speaker) else {
            owned.forEach { free($0) }
            return nil
        }
        self.spotter = spotter
        self.spotterStream = stream
        self.vad = vad
        self.recognizer = recognizer
        self.extractor = extractor
        self.strings = owned
    }

    deinit {
        SherpaOnnxDestroyOnlineStream(spotterStream)
        SherpaOnnxDestroyKeywordSpotter(spotter)
        SherpaOnnxDestroyVoiceActivityDetector(vad)
        SherpaOnnxDestroyOfflineRecognizer(recognizer)
        SherpaOnnxDestroySpeakerEmbeddingExtractor(extractor)
        strings.forEach { free($0) }
    }

    func spotKeyword(_ samples: [Float]) -> Bool {
        var found = false
        SherpaOnnxOnlineStreamAcceptWaveform(spotterStream, Int32(Self.sampleRate), samples, Int32(samples.count))
        while SherpaOnnxIsKeywordStreamReady(spotter, spotterStream) == 1 {
            SherpaOnnxDecodeKeywordStream(spotter, spotterStream)
            if let result = SherpaOnnxGetKeywordResult(spotter, spotterStream) {
                if let keyword = result.pointee.keyword, keyword.pointee != 0 {
                    found = true
                }
                SherpaOnnxDestroyKeywordResult(result)
            }
            if found {
                SherpaOnnxResetKeywordStream(spotter, spotterStream)
            }
        }
        return found
    }

    func feedVad(_ window: [Float]) -> [(start: Int, samples: [Float])] {
        SherpaOnnxVoiceActivityDetectorAcceptWaveform(vad, window, Int32(window.count))
        var segments: [(start: Int, samples: [Float])] = []
        while SherpaOnnxVoiceActivityDetectorEmpty(vad) == 0 {
            if let segment = SherpaOnnxVoiceActivityDetectorFront(vad) {
                let count = Int(segment.pointee.n)
                if let base = segment.pointee.samples, count > 0 {
                    segments.append((Int(segment.pointee.start), Array(UnsafeBufferPointer(start: base, count: count))))
                }
                SherpaOnnxDestroySpeechSegment(segment)
            }
            SherpaOnnxVoiceActivityDetectorPop(vad)
        }
        return segments
    }

    var isSpeaking: Bool {
        SherpaOnnxVoiceActivityDetectorDetected(vad) == 1
    }

    func transcribe(_ samples: [Float]) -> String {
        guard samples.count >= Self.sampleRate / 5, let stream = SherpaOnnxCreateOfflineStream(recognizer) else {
            return ""
        }
        defer {
            SherpaOnnxDestroyOfflineStream(stream)
        }
        SherpaOnnxAcceptWaveformOffline(stream, Int32(Self.sampleRate), samples, Int32(samples.count))
        SherpaOnnxDecodeOfflineStream(recognizer, stream)
        guard let result = SherpaOnnxGetOfflineStreamResult(stream) else {
            return ""
        }
        defer {
            SherpaOnnxDestroyOfflineRecognizerResult(result)
        }
        guard let text = result.pointee.text else {
            return ""
        }
        return String(cString: text).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    func embedding(_ samples: [Float]) -> [Float] {
        guard let stream = SherpaOnnxSpeakerEmbeddingExtractorCreateStream(extractor) else {
            return []
        }
        defer {
            SherpaOnnxDestroyOnlineStream(stream)
        }
        SherpaOnnxOnlineStreamAcceptWaveform(stream, Int32(Self.sampleRate), samples, Int32(samples.count))
        SherpaOnnxOnlineStreamInputFinished(stream)
        guard SherpaOnnxSpeakerEmbeddingExtractorIsReady(extractor, stream) == 1,
              let pointer = SherpaOnnxSpeakerEmbeddingExtractorComputeEmbedding(extractor, stream) else {
            return []
        }
        defer {
            SherpaOnnxSpeakerEmbeddingExtractorDestroyEmbedding(pointer)
        }
        let dim = Int(SherpaOnnxSpeakerEmbeddingExtractorDim(extractor))
        let raw = Array(UnsafeBufferPointer(start: pointer, count: dim))
        let norm = sqrt(raw.reduce(0) { $0 + $1 * $1 })
        return norm > 0 ? raw.map { $0 / norm } : raw
    }
}
