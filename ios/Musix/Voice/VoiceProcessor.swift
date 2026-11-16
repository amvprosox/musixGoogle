import Foundation
import MusixCore

struct VoiceCommandEvent: Sendable {
    enum Source: String, Sendable {
        case local
        case ai
        case rejected
        case empty
        case unknown
        case blocked
    }

    var action: VoiceAction?
    var query: String
    var reply: String
    var transcript: String
    var source: Source
}

struct VoiceProcessorSettings: Sendable {
    var commands: [VoiceCommand]
    var speakerCheck: Bool
    var threshold: Double
    var voiceprint: [Float]
}

enum VoiceProcessorEvent: Sendable {
    case wake
    case thinking(String)
    case resolved(text: String, audio: [Float])
    case rejected
    case empty
}

final class VoiceProcessor: @unchecked Sendable {
    private static let historySamples = SherpaVoiceEngine.sampleRate * 14
    private static let leadInSamples = Int(Double(SherpaVoiceEngine.sampleRate) * 0.3)
    private static let awaitCommandSeconds: TimeInterval = 6

    private let queue = DispatchQueue(label: "com.realmadhoney.musix.voice", qos: .userInitiated)
    private let onEvent: @Sendable (VoiceProcessorEvent) -> Void
    private var engine: SherpaVoiceEngine?
    private var settings = VoiceProcessorSettings(commands: VoiceIntentMatcher.defaultCommands, speakerCheck: true, threshold: 0.45, voiceprint: [])
    private var pending: [Float] = []
    private var history = [Float](repeating: 0, count: historySamples)
    private var vadFed = 0
    private var keywordHeard = false
    private var awaitingUntil: Date?
    private var wakeAudio: [Float]?
    private var awake = false

    init(onEvent: @escaping @Sendable (VoiceProcessorEvent) -> Void) {
        self.onEvent = onEvent
    }

    func load(pack: URL, sensitivity: Double, completion: @escaping @Sendable (Bool) -> Void) {
        queue.async { [self] in
            engine = SherpaVoiceEngine(packDirectory: pack, sensitivity: sensitivity)
            completion(engine != nil)
        }
    }

    func unload() {
        queue.async { [self] in
            engine = nil
            pending.removeAll()
            awaitingUntil = nil
            wakeAudio = nil
            awake = false
        }
    }

    func update(_ next: VoiceProcessorSettings) {
        queue.async { [self] in
            settings = next
        }
    }

    func embedding(_ samples: [Float], completion: @escaping @Sendable ([Float]) -> Void) {
        queue.async { [self] in
            completion(engine?.embedding(samples) ?? [])
        }
    }

    func accept(_ samples: [Float]) {
        queue.async { [self] in
            process(samples)
        }
    }

    private func process(_ samples: [Float]) {
        guard let engine, !samples.isEmpty else {
            return
        }
        let dithered = samples.map { $0 + Float.random(in: -0.0001...0.0001) }
        if engine.spotKeyword(dithered) {
            keywordHeard = true
            wake()
        }
        pending.append(contentsOf: dithered)
        while pending.count >= SherpaVoiceEngine.vadWindow {
            let window = Array(pending.prefix(SherpaVoiceEngine.vadWindow))
            pending.removeFirst(SherpaVoiceEngine.vadWindow)
            for (offset, value) in window.enumerated() {
                history[(vadFed + offset) % history.count] = value
            }
            vadFed += window.count
            for segment in engine.feedVad(window) {
                handle(engine: engine, samples: withLeadIn(start: segment.start, samples: segment.samples))
            }
        }
        if let until = awaitingUntil, Date() > until, !engine.isSpeaking {
            awaitingUntil = nil
            wakeAudio = nil
            awake = false
            onEvent(.empty)
        }
    }

    private func withLeadIn(start: Int, samples: [Float]) -> [Float] {
        let from = max(0, start - Self.leadInSamples, vadFed - history.count)
        let lead = max(0, start - from)
        guard lead > 0, start <= vadFed else {
            return samples
        }
        var out = [Float](repeating: 0, count: lead)
        for index in 0..<lead {
            out[index] = history[(from + index) % history.count]
        }
        return out + samples
    }

    private func wake() {
        guard !awake else {
            return
        }
        awake = true
        onEvent(.wake)
    }

    private func handle(engine: SherpaVoiceEngine, samples: [Float]) {
        let keyword = keywordHeard
        keywordHeard = false
        let text = VoiceIntentMatcher.normalize(engine.transcribe(samples))
        if awaitingUntil != nil {
            var cleaned = text
            for prefix in ["yes ", "yeah ", "yep "] where cleaned.hasPrefix(prefix) {
                cleaned = String(cleaned.dropFirst(prefix.count))
            }
            if ["yes", "yeah", "yep"].contains(cleaned) {
                cleaned = ""
            }
            let stripped = VoiceIntentMatcher.stripWakeWord(cleaned)
            if cleaned.isEmpty || (stripped.heard && stripped.rest.isEmpty) {
                return
            }
            awaitingUntil = nil
            let audio = (wakeAudio ?? []) + samples
            wakeAudio = nil
            resolve(engine: engine, audio: audio, text: cleaned)
            return
        }
        let stripped = VoiceIntentMatcher.stripWakeWord(text)
        guard stripped.heard || keyword else {
            return
        }
        let rest = stripped.heard ? stripped.rest : VoiceIntentMatcher.dropLeadingWords(text, commands: settings.commands)
        wake()
        if rest.isEmpty {
            wakeAudio = samples
            awaitingUntil = Date().addingTimeInterval(Self.awaitCommandSeconds)
            return
        }
        resolve(engine: engine, audio: samples, text: rest)
    }

    private func resolve(engine: SherpaVoiceEngine, audio: [Float], text: String) {
        defer {
            awake = false
        }
        onEvent(.thinking(text))
        if settings.speakerCheck, !settings.voiceprint.isEmpty {
            let embedding = engine.embedding(audio)
            let score = zip(embedding, settings.voiceprint).reduce(Float(0)) { $0 + $1.0 * $1.1 }
            if embedding.count != settings.voiceprint.count || Double(score) < settings.threshold {
                onEvent(.rejected)
                return
            }
        }
        if text.isEmpty {
            onEvent(.empty)
            return
        }
        onEvent(.resolved(text: text, audio: audio))
    }
}
