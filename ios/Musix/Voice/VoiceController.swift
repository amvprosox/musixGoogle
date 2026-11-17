import AVFoundation
import Combine
import CryptoKit
import Foundation
import MusixCore
import Security
import UIKit

private final class ConverterFeed: @unchecked Sendable {
    let buffer: AVAudioPCMBuffer
    var consumed = false

    init(_ buffer: AVAudioPCMBuffer) {
        self.buffer = buffer
    }
}

enum ShellRequest: Equatable {
    case tab(ShellTab)
    case settings
    case player(Bool)
    case search(String)
}

struct MicrophoneOption: Identifiable, Equatable {
    var id: String
    var name: String
}

private enum VoiceKeychain {
    private static let service = "com.realmadhoney.musix.openrouter"

    static var builtin: String {
        guard let encoded = Bundle.main.object(forInfoDictionaryKey: "MusixBuiltinAI") as? String,
              let bytes = Data(base64Encoded: encoded), !bytes.isEmpty else {
            return ""
        }
        let mask = Array("musix-voice".utf8)
        let mixed = bytes.enumerated().map { $0.element ^ mask[$0.offset % mask.count] }
        return String(decoding: mixed, as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    static func readOwn() -> String {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data,
              let text = String(data: data, encoding: .utf8) else {
            return ""
        }
        return text
    }

    static func read() -> String {
        let own = readOwn()
        return own.isEmpty ? builtin : own
    }

    static func write(_ value: String) {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
        ]
        SecItemDelete(base as CFDictionary)
        guard !value.isEmpty, let data = value.data(using: .utf8) else {
            return
        }
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }
}

private final class PackDownloader: NSObject, URLSessionDownloadDelegate, @unchecked Sendable {
    private let progress: @Sendable (Double) -> Void
    private var continuation: CheckedContinuation<URL, Error>?
    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)

    init(progress: @escaping @Sendable (Double) -> Void) {
        self.progress = progress
    }

    func download(_ url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            session.downloadTask(with: url).resume()
        }
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didWriteData bytesWritten: Int64, totalBytesWritten: Int64, totalBytesExpectedToWrite: Int64) {
        let total = totalBytesExpectedToWrite > 0 ? totalBytesExpectedToWrite : 55_653_713
        progress(min(0.99, Double(totalBytesWritten) / Double(total)))
    }

    func urlSession(_ session: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        let target = FileManager.default.temporaryDirectory.appendingPathComponent("musix-voice-\(UUID().uuidString).zip")
        do {
            try FileManager.default.moveItem(at: location, to: target)
            continuation?.resume(returning: target)
        } catch {
            continuation?.resume(throwing: error)
        }
        continuation = nil
        session.finishTasksAndInvalidate()
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            continuation?.resume(throwing: error)
            continuation = nil
            session.finishTasksAndInvalidate()
        }
    }
}

@MainActor
final class VoiceController: ObservableObject {
    enum State: Equatable {
        case off
        case needsPack
        case downloading(Double)
        case loading
        case listening
        case awake
        case thinking
        case error(String)
    }

    static let packName = "musix-voice-pack-1"
    static let packURL = URL(string: "https://github.com/amvprosox/musixGoogle/releases/download/voice-pack-1/musix-voice-pack-1.zip")
    static let packSHA256 = "617b4b97ee0bb45d7f9ca4c82ef8eccfc58e74d2e77313986c4ce78a1f7d7792"

    @Published private(set) var state: State = .off
    @Published private(set) var levels: [Double] = Array(repeating: 0, count: VoiceController.levelCount)
    nonisolated static let levelCount = 28
    private var lastLevelAt = Date.distantPast
    @Published private(set) var heard = ""
    @Published private(set) var notice = ""
    @Published private(set) var inputs: [MicrophoneOption] = []
    @Published private(set) var activeInput = ""
    @Published private(set) var hasVoiceprint = false
    @Published private(set) var hasAiKey = false
    @Published private(set) var builtinAi = false
    @Published private(set) var freeModelCount = 0
    @Published private(set) var enrollPrompt = ""
    @Published private(set) var busy = false

    @Published var enabled: Bool {
        didSet {
            guard oldValue != enabled else {
                return
            }
            defaults.set(enabled, forKey: Keys.enabled)
            applyEnabled()
        }
    }

    @Published var microphone: String {
        didSet {
            defaults.set(microphone, forKey: Keys.microphone)
            applyPreferredInput()
        }
    }

    @Published var commands: [VoiceCommand] {
        didSet {
            if let data = try? JSONEncoder().encode(commands) {
                defaults.set(data, forKey: Keys.commands)
            }
            pushSettings()
        }
    }

    @Published var speakerCheck: Bool {
        didSet {
            defaults.set(speakerCheck, forKey: Keys.speakerCheck)
            pushSettings()
        }
    }

    @Published var speakerThreshold: Double {
        didSet {
            defaults.set(speakerThreshold, forKey: Keys.threshold)
            pushSettings()
        }
    }

    @Published var sensitivity: Double {
        didSet {
            defaults.set(sensitivity, forKey: Keys.sensitivity)
        }
    }

    @Published var aiEnabled: Bool {
        didSet {
            defaults.set(aiEnabled, forKey: Keys.aiEnabled)
        }
    }

    let shellRequests = PassthroughSubject<ShellRequest, Never>()

    private enum Keys {
        static let enabled = "musix.voice.enabled"
        static let offByDefaultApplied = "musix.voice.offByDefault.108"
        static let microphone = "musix.voice.microphone"
        static let commands = "musix.voice.commands"
        static let speakerCheck = "musix.voice.speakerCheck"
        static let threshold = "musix.voice.threshold"
        static let sensitivity = "musix.voice.sensitivity"
        static let voiceprint = "musix.voice.voiceprint"
        static let aiEnabled = "musix.voice.aiEnabled"
    }

    private let defaults = UserDefaults.standard
    private let player: PlayerController
    private let engine: WebEngine
    private let downloads: DownloadController
    private let library: LibraryService
    private let settings: AppSettings
    private let audioEngine = AVAudioEngine()
    private var converter: AVAudioConverter?
    private var capturing = false
    private var recording: [Float]?
    private var processor: VoiceProcessor?
    private var voiceprint: [Float]
    private var freeModels: [FreeModel] = []
    private var modelsFetchedAt = Date.distantPast
    private var lastGoodModel: String?
    private var modelCooldowns: [String: Date] = [:]
    @Published private(set) var connecting = false
    private var yesPlayer: AVAudioPlayer?
    private let speech = AVSpeechSynthesizer()
    private var observers: [NSObjectProtocol] = []

    init(player: PlayerController, engine: WebEngine, downloads: DownloadController, library: LibraryService, settings: AppSettings) {
        self.player = player
        self.engine = engine
        self.downloads = downloads
        self.library = library
        self.settings = settings
        // Voice control starts off after this update (once); it stays however the user sets it.
        if !defaults.bool(forKey: Keys.offByDefaultApplied) {
            defaults.set(false, forKey: Keys.enabled)
            defaults.set(true, forKey: Keys.offByDefaultApplied)
        }
        enabled = defaults.bool(forKey: Keys.enabled)
        microphone = defaults.string(forKey: Keys.microphone) ?? "auto"
        if let data = defaults.data(forKey: Keys.commands), let saved = try? JSONDecoder().decode([VoiceCommand].self, from: data) {
            commands = VoiceIntentMatcher.sanitize(saved)
        } else {
            commands = VoiceIntentMatcher.defaultCommands
        }
        speakerCheck = (defaults.object(forKey: Keys.speakerCheck) as? Bool) ?? true
        speakerThreshold = (defaults.object(forKey: Keys.threshold) as? Double) ?? 0.45
        sensitivity = (defaults.object(forKey: Keys.sensitivity) as? Double) ?? 0.5
        aiEnabled = (defaults.object(forKey: Keys.aiEnabled) as? Bool) ?? true
        voiceprint = (defaults.array(forKey: Keys.voiceprint) as? [Double])?.map { Float($0) } ?? []
        hasVoiceprint = !voiceprint.isEmpty
        hasAiKey = !VoiceKeychain.read().isEmpty
        builtinAi = VoiceKeychain.readOwn().isEmpty && !VoiceKeychain.builtin.isEmpty
        let center = NotificationCenter.default
        observers.append(center.addObserver(forName: AVAudioSession.routeChangeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                self?.routeChanged()
            }
        })
        observers.append(center.addObserver(forName: AVAudioSession.mediaServicesWereResetNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in
                self?.restartCapture()
            }
        })
        refreshInputs()
        applyEnabled()
    }

    var packDirectory: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("Musix/voice/\(Self.packName)", isDirectory: true)
    }

    var packInstalled: Bool {
        ["manifest.json", "kws/encoder.int8.onnx", "asr/encoder.int8.onnx", "speaker/campplus_en.onnx", "vad/silero_vad.onnx"]
            .allSatisfy { FileManager.default.fileExists(atPath: packDirectory.appendingPathComponent($0).path) }
    }

    var stateText: String {
        switch state {
        case .off: return "Off"
        case .needsPack: return "Download the voice pack to start listening."
        case let .downloading(progress): return "Downloading voice pack \(Int(progress * 100))%"
        case .loading: return "Starting the voice engine"
        case .listening: return "Listening for \"Veru\""
        case .awake: return "Yes?"
        case .thinking: return "Thinking"
        case let .error(text): return text
        }
    }

    private func applyEnabled() {
        guard enabled else {
            stopCapture()
            processor?.unload()
            processor = nil
            player.voiceCaptureEnabled = false
            state = .off
            return
        }
        guard packInstalled else {
            state = .needsPack
            return
        }
        if processor == nil {
            loadEngine()
        }
    }

    private func makeProcessor() -> VoiceProcessor {
        VoiceProcessor { [weak self] event in
            Task { @MainActor in
                self?.handle(event)
            }
        }
    }

    private func loadEngine() {
        state = .loading
        let next = makeProcessor()
        processor = next
        pushSettings()
        next.load(pack: packDirectory, sensitivity: sensitivity) { [weak self] ok in
            Task { @MainActor in
                guard let self, self.processor === next else {
                    return
                }
                if ok {
                    self.requestPermissionAndStart()
                } else {
                    self.state = .error("The voice pack could not be loaded. Download it again.")
                }
            }
        }
    }

    private func pushSettings() {
        processor?.update(
            VoiceProcessorSettings(commands: commands, speakerCheck: speakerCheck, threshold: speakerThreshold, voiceprint: voiceprint)
        )
    }

    func reloadEngine() {
        processor?.unload()
        processor = nil
        stopCapture()
        applyEnabled()
    }

    func downloadPack() {
        guard !busy, let url = Self.packURL else {
            return
        }
        busy = true
        state = .downloading(0)
        let target = packDirectory
        let expected = Self.packSHA256
        let name = Self.packName
        Task {
            defer {
                busy = false
            }
            do {
                let downloader = PackDownloader { progress in
                    Task { @MainActor [weak self] in
                        if case .downloading = self?.state {
                            self?.state = .downloading(progress)
                        }
                    }
                }
                let file = try await downloader.download(url)
                try await Task.detached(priority: .userInitiated) {
                    let data = try Data(contentsOf: file)
                    try? FileManager.default.removeItem(at: file)
                    let digest = SHA256.hash(data: data).map { String(format: "%02x", $0) }.joined()
                    guard digest == expected else {
                        throw ZipReaderError.corrupt("checksum")
                    }
                    let staging = target.deletingLastPathComponent().appendingPathComponent("\(name).partial", isDirectory: true)
                    try? FileManager.default.removeItem(at: staging)
                    try FileManager.default.createDirectory(at: staging, withIntermediateDirectories: true)
                    try ZipReader.extract(data, to: staging, stripPrefix: "\(name)/")
                    try? FileManager.default.removeItem(at: target)
                    try FileManager.default.moveItem(at: staging, to: target)
                }.value
                state = .loading
                applyEnabled()
            } catch {
                state = .error("Voice pack download failed. Check your connection and try again.")
            }
        }
    }

    private func requestPermissionAndStart() {
        AVAudioSession.sharedInstance().requestRecordPermission { [weak self] granted in
            Task { @MainActor in
                guard let self else {
                    return
                }
                if granted {
                    self.startCapture()
                } else {
                    self.state = .error("Allow microphone access for Musix in Settings to use the voice assistant.")
                }
            }
        }
    }

    private func refreshInputs() {
        let session = AVAudioSession.sharedInstance()
        inputs = (session.availableInputs ?? []).map { MicrophoneOption(id: $0.uid, name: $0.portName) }
        activeInput = session.currentRoute.inputs.first?.portName ?? ""
    }

    private func applyPreferredInput() {
        let session = AVAudioSession.sharedInstance()
        let available = session.availableInputs ?? []
        var preferred: AVAudioSessionPortDescription?
        if microphone != "auto" {
            preferred = available.first { $0.uid == microphone }
        }
        if preferred == nil {
            let outputs = session.currentRoute.outputs.map(\.portType)
            let bluetoothMusic = outputs.contains(.bluetoothA2DP) || outputs.contains(.bluetoothLE)
            if bluetoothMusic {
                preferred = available.first { $0.portType == .builtInMic }
            }
        }
        try? session.setPreferredInput(preferred)
        refreshInputs()
    }

    private func routeChanged() {
        let before = Set(inputs.map(\.id))
        refreshInputs()
        if let added = inputs.first(where: { !before.contains($0.id) }), !before.isEmpty {
            notice = "Microphone connected: \(added.name)"
        }
        if capturing {
            restartCapture()
        }
    }

    private func restartCapture() {
        guard enabled, processor != nil else {
            return
        }
        stopCapture()
        startCapture()
    }

    private func startCapture() {
        guard !capturing else {
            return
        }
        player.voiceCaptureEnabled = true
        let session = AVAudioSession.sharedInstance()
        do {
            try session.setActive(true)
        } catch {
            state = .error("The microphone is busy in another app.")
            return
        }
        applyPreferredInput()
        let input = audioEngine.inputNode
        let format = input.outputFormat(forBus: 0)
        guard format.sampleRate > 0, format.channelCount > 0,
              let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: Double(SherpaVoiceEngine.sampleRate), channels: 1, interleaved: false),
              let converter = AVAudioConverter(from: format, to: target) else {
            state = .error("No microphone is available.")
            return
        }
        self.converter = converter
        input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
            guard let samples = Self.convert(buffer, with: converter, to: target) else {
                return
            }
            Task { @MainActor in
                self?.received(samples)
            }
        }
        do {
            audioEngine.prepare()
            try audioEngine.start()
            capturing = true
            state = .listening
            PlaybackLog.shared.add("Voice assistant listening with \(activeInput)")
        } catch {
            input.removeTap(onBus: 0)
            state = .error("The microphone could not start.")
        }
    }

    private nonisolated static func convert(_ buffer: AVAudioPCMBuffer, with converter: AVAudioConverter, to format: AVAudioFormat) -> [Float]? {
        let ratio = format.sampleRate / buffer.format.sampleRate
        let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 64)
        guard let output = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: capacity) else {
            return nil
        }
        let feed = ConverterFeed(buffer)
        var error: NSError?
        converter.convert(to: output, error: &error) { _, status in
            if feed.consumed {
                status.pointee = .noDataNow
                return nil
            }
            feed.consumed = true
            status.pointee = .haveData
            return feed.buffer
        }
        guard error == nil, let channel = output.floatChannelData?[0], output.frameLength > 0 else {
            return nil
        }
        return Array(UnsafeBufferPointer(start: channel, count: Int(output.frameLength)))
    }

    private func stopCapture() {
        guard capturing else {
            return
        }
        audioEngine.inputNode.removeTap(onBus: 0)
        audioEngine.stop()
        capturing = false
    }

    private func received(_ samples: [Float]) {
        if state == .awake || state == .thinking, !samples.isEmpty {
            let now = Date()
            if now.timeIntervalSince(lastLevelAt) >= 0.05 {
                lastLevelAt = now
                let energy = samples.reduce(Float(0)) { $0 + $1 * $1 } / Float(samples.count)
                levels = Array(levels.dropFirst()) + [Double(min(1, sqrt(energy) * 4))]
            }
        } else if levels.contains(where: { $0 > 0 }) {
            levels = Array(repeating: 0, count: Self.levelCount)
        }
        if recording != nil {
            recording?.append(contentsOf: samples)
            return
        }
        processor?.accept(samples)
    }

    private func handle(_ event: VoiceProcessorEvent) {
        switch event {
        case .wake:
            state = .awake
            player.duck(true)
            playYes()
        case let .thinking(text):
            state = .thinking
            heard = text
        case .rejected:
            finish()
            notice = "That did not sound like your voice."
        case .empty:
            finish()
            notice = "I did not hear a command."
        case let .resolved(text, _):
            Task {
                await resolve(text)
                finish()
            }
        }
    }

    private func finish() {
        player.duck(false)
        if capturing {
            state = .listening
        }
    }

    private func playYes() {
        if yesPlayer == nil, let url = Bundle.main.url(forResource: "yes", withExtension: "wav") {
            yesPlayer = try? AVAudioPlayer(contentsOf: url)
            yesPlayer?.prepareToPlay()
        }
        yesPlayer?.currentTime = 0
        yesPlayer?.play()
    }

    private func say(_ text: String) {
        guard !text.isEmpty else {
            return
        }
        let utterance = AVSpeechUtterance(string: text)
        let voices = AVSpeechSynthesisVoice.speechVoices().filter { $0.language.hasPrefix("en") }
        utterance.voice = voices.first { ["Aaron", "Arthur", "Fred", "Daniel", "Gordon", "Oliver"].contains($0.name) } ?? AVSpeechSynthesisVoice(language: "en-US")
        utterance.pitchMultiplier = 0.85
        speech.stopSpeaking(at: .immediate)
        speech.speak(utterance)
    }

    private func resolve(_ text: String) async {
        if let local = VoiceIntentMatcher.match(text, commands: commands) {
            await execute(VoiceCommandEvent(action: local.action, query: local.query, reply: "", transcript: text, source: .local))
            return
        }
        if VoiceIntentMatcher.isOutOfScope(text) {
            notice = VoiceIntentMatcher.outOfScopeReply
            say(VoiceIntentMatcher.outOfScopeReply)
            return
        }
        if let ai = await askAi(text), let action = ai.action {
            await execute(VoiceCommandEvent(action: action, query: ai.query, reply: ai.reply, transcript: text, source: .ai))
            return
        }
        notice = "Sorry, I did not understand \"\(text)\"."
        say("Sorry, I did not catch that.")
    }

    private func loadFreeModels(key: String) async -> [FreeModel] {
        if !freeModels.isEmpty, Date().timeIntervalSince(modelsFetchedAt) < 6 * 3600 {
            return freeModels
        }
        guard let url = URL(string: AiIntentParser.freeModelsURL) else {
            return []
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 9
        request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              (response as? HTTPURLResponse)?.statusCode == 200 else {
            return []
        }
        freeModels = AiIntentParser.freeModels(from: data)
        freeModelCount = freeModels.count
        modelsFetchedAt = Date()
        return freeModels
    }

    private func askAi(_ text: String) async -> AiIntent? {
        let key = VoiceKeychain.read()
        guard aiEnabled, !key.isEmpty, engine.status == .ready, let url = URL(string: "\(AiIntentParser.base)/chat/completions") else {
            return nil
        }
        let offline = player.isOfflinePlaying
        let deadline = Date().addingTimeInterval(AiIntentParser.budgetSeconds)
        let models = AiIntentParser.order(await loadFreeModels(key: key), lastGood: lastGoodModel, cooldowns: modelCooldowns, now: Date())
        for model in models {
            guard Date() < deadline, let body = AiIntentParser.requestBody(model: model.id, text: text, offline: offline) else {
                break
            }
            var request = URLRequest(url: url)
            request.httpMethod = "POST"
            request.timeoutInterval = min(9, max(1, deadline.timeIntervalSinceNow))
            request.setValue("Bearer \(key)", forHTTPHeaderField: "Authorization")
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("Musix", forHTTPHeaderField: "X-Title")
            request.httpBody = body
            var status: Int?
            if let (data, response) = try? await URLSession.shared.data(for: request),
               let code = (response as? HTTPURLResponse)?.statusCode {
                status = code
                if code == 200, let parsed = AiIntentParser.parse(AiIntentParser.chatContent(data)) {
                    lastGoodModel = model.id
                    modelCooldowns[model.id] = nil
                    return parsed
                }
                if AiIntentParser.shouldStop(status: code) {
                    notice = "OpenRouter refused the key. Connect OpenRouter again."
                    return nil
                }
            }
            modelCooldowns[model.id] = Date().addingTimeInterval(AiIntentParser.cooldown(status: status))
            if lastGoodModel == model.id {
                lastGoodModel = nil
            }
        }
        return nil
    }

    func setAiKey(_ key: String?) {
        VoiceKeychain.write((key ?? "").trimmingCharacters(in: .whitespacesAndNewlines))
        hasAiKey = !VoiceKeychain.read().isEmpty
        builtinAi = VoiceKeychain.readOwn().isEmpty && !VoiceKeychain.builtin.isEmpty
        freeModels = []
        freeModelCount = 0
        lastGoodModel = nil
        modelCooldowns = [:]
    }

    func connectAi() async {
        guard !connecting else {
            return
        }
        connecting = true
        defer {
            connecting = false
        }
        do {
            let key = try await OpenRouterConnect().connect()
            setAiKey(key)
            notice = "OpenRouter connected. Only free models will be used."
        } catch OpenRouterConnect.Failure.cancelled {
            notice = ""
        } catch {
            notice = "OpenRouter was not connected. Try again."
        }
    }

    func resetCommands() {
        commands = VoiceIntentMatcher.defaultCommands
    }

    func forgetVoice() {
        voiceprint = []
        defaults.removeObject(forKey: Keys.voiceprint)
        hasVoiceprint = false
        pushSettings()
    }

    private func record(seconds: Double) async -> [Float] {
        if !capturing {
            startCapture()
        }
        recording = []
        try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000))
        let clip = recording ?? []
        recording = nil
        return clip
    }

    private func embedding(_ samples: [Float]) async -> [Float] {
        guard let processor else {
            return []
        }
        return await withCheckedContinuation { continuation in
            processor.embedding(samples) { result in
                continuation.resume(returning: result)
            }
        }
    }

    func enroll() async {
        guard !busy, processor != nil else {
            enrollPrompt = "Turn on the voice assistant first."
            return
        }
        busy = true
        defer {
            busy = false
        }
        let phrases = [
            "Veru, play my favorite songs.",
            "Veru, what is playing right now?",
            "I like listening to music in the morning.",
            "Veru, turn on shuffle and play something new.",
            "The weather is nice and the coffee is warm.",
        ]
        var embeddings: [[Float]] = []
        for (index, phrase) in phrases.enumerated() {
            enrollPrompt = "Say (\(index + 1)/\(phrases.count)): \"\(phrase)\""
            let clip = await record(seconds: 3.5)
            let vector = await embedding(clip)
            if !vector.isEmpty {
                embeddings.append(vector)
            }
        }
        guard embeddings.count >= 3, let dim = embeddings.first?.count else {
            enrollPrompt = "Could not hear enough. Try again somewhere quieter."
            return
        }
        var mean = [Float](repeating: 0, count: dim)
        for vector in embeddings {
            for index in 0..<dim {
                mean[index] += vector[index] / Float(embeddings.count)
            }
        }
        let norm = sqrt(mean.reduce(0) { $0 + $1 * $1 })
        mean = norm > 0 ? mean.map { $0 / norm } : mean
        let lowest = embeddings.map { vector in zip(vector, mean).reduce(Float(0)) { $0 + $1.0 * $1.1 } }.min() ?? 0.6
        voiceprint = mean
        defaults.set(mean.map { Double($0) }, forKey: Keys.voiceprint)
        hasVoiceprint = true
        speakerCheck = true
        speakerThreshold = min(0.7, max(0.25, (Double(lowest) - 0.15).rounded(toPlaces: 2)))
        pushSettings()
        enrollPrompt = "Voice saved. Match threshold set to \(String(format: "%.2f", speakerThreshold))."
    }

    func testVoice() async {
        guard !busy, !voiceprint.isEmpty else {
            enrollPrompt = "Teach Musix your voice first."
            return
        }
        busy = true
        defer {
            busy = false
        }
        enrollPrompt = "Say anything for 3 seconds..."
        let vector = await embedding(await record(seconds: 3))
        guard vector.count == voiceprint.count else {
            enrollPrompt = "Could not hear you. Try again."
            return
        }
        let score = Double(zip(vector, voiceprint).reduce(Float(0)) { $0 + $1.0 * $1.1 })
        enrollPrompt = "Match score \(String(format: "%.2f", score)) (needs \(String(format: "%.2f", speakerThreshold))): \(score >= speakerThreshold ? "that is you" : "not a match")."
    }

    private func bestMatch<T>(_ query: String, in items: [T], text: (T) -> [String]) -> T? {
        let needle = VoiceIntentMatcher.normalize(query)
        guard !needle.isEmpty else {
            return nil
        }
        var best: T?
        var bestScore = 0.0
        for item in items {
            for raw in text(item) {
                let hay = VoiceIntentMatcher.normalize(raw)
                guard !hay.isEmpty else {
                    continue
                }
                let contains = hay.contains(needle) || needle.contains(hay) ? 0.9 : 0
                let score = max(contains, VoiceIntentMatcher.similarity(needle, hay))
                if score > bestScore {
                    bestScore = score
                    best = item
                }
            }
        }
        return bestScore >= 0.55 ? best : nil
    }

    private func palette(for query: String) -> ThemePalette? {
        let text = VoiceIntentMatcher.normalize(query)
        let table: [(ThemePalette, [String])] = [
            (.graphite, ["graphite", "grey", "gray", "dark grey", "dark gray"]),
            (.slate, ["slate", "slate grey", "slate gray", "light grey", "light gray"]),
            (.amoled, ["amoled", "black", "pure black", "oled"]),
            (.light, ["light", "white", "bright", "day"]),
            (.dark, ["midnight", "dark", "blue", "navy", "night"]),
        ]
        var best: ThemePalette?
        var bestScore = 0.0
        for (palette, words) in table {
            for word in words {
                let score = text.contains(word) ? 1 : VoiceIntentMatcher.similarity(text, word)
                if score > bestScore {
                    bestScore = score
                    best = palette
                }
            }
        }
        return bestScore >= 0.6 ? best : nil
    }

    private func execute(_ command: VoiceCommandEvent) async {
        guard let action = command.action else {
            return
        }
        notice = command.transcript
        if !command.reply.isEmpty {
            say(command.reply)
        }
        let state = player.state
        let completed = downloads.items.filter { $0.status == .completed }
        switch action {
        case .pause:
            player.pause()
        case .resume:
            player.play()
        case .next:
            player.next()
        case .previous:
            player.previous()
        case .shuffleOn:
            player.setShuffle(true)
        case .shuffleOff:
            player.setShuffle(false)
        case .`repeat`:
            player.setRepeat(.all)
        case .repeatOne:
            player.setRepeat(.one)
        case .repeatOff:
            player.setRepeat(.none)
        case .like:
            if !player.isLiked {
                player.toggleLike()
            }
        case .dislike:
            player.dislike()
        case .volumeUp:
            player.adjustVolume(by: 0.15)
        case .volumeDown:
            player.adjustVolume(by: -0.15)
        case .mute:
            player.setMuted(true)
        case .unmute:
            player.setMuted(false)
        case .seekForward:
            player.seek(to: player.positionSec + 10)
        case .seekBack:
            player.seek(to: max(0, player.positionSec - 10))
        case .restart:
            player.seek(to: 0)
        case .whatsPlaying:
            if let current = player.timeline.current {
                let line = current.artist.isEmpty ? current.title : "\(current.title) by \(current.artist)"
                notice = "Now playing: \(line)"
                say("This is \(line)")
            } else {
                say("Nothing is playing right now.")
            }
        case .showLyrics:
            defaults.set(true, forKey: "musix.showLyrics")
            shellRequests.send(.player(true))
        case .hideLyrics:
            defaults.set(false, forKey: "musix.showLyrics")
        case .downloadSong:
            if let current = player.timeline.current, !current.isAd {
                downloads.startDownload(
                    DownloadTrackRequest(
                        videoId: current.videoId,
                        title: current.title,
                        artist: current.artist,
                        album: current.album,
                        durationSec: current.durationSec ?? state.durationSec,
                        artworkUrl: current.artworkUrl
                    )
                )
            }
        case .setTheme:
            if let palette = palette(for: command.query) {
                settings.theme = palette
            } else {
                notice = "I do not know the \"\(command.query)\" theme."
            }
        case .search:
            shellRequests.send(.search(command.query))
        case .play:
            if engine.status == .ready, !player.isOfflinePlaying, let entry = await library.firstPlayable(matching: command.query) {
                player.play(mediaId: entry.mediaId)
                notice = "Playing \(entry.title)"
                return
            }
            if let match = bestMatch(command.query, in: completed, text: { [$0.title, "\($0.title) \($0.artist)", $0.artist] }) {
                player.playOffline(item: match, downloads: downloads)
                notice = "Playing offline: \(match.title)"
            } else {
                notice = "I could not find \"\(command.query)\"."
                say("I could not find that.")
            }
        case .playDownloads:
            if let first = completed.first {
                player.playOffline(item: first, downloads: downloads)
            } else {
                say("You have no downloads yet.")
            }
        case .playDownloadedPlaylist:
            let byId = Dictionary(completed.map { ($0.videoId, $0) }, uniquingKeysWith: { first, _ in first })
            if let library = bestMatch(command.query, in: downloads.savedLibraries, text: { [$0.title] }) {
                let scope = library.videoIds.filter { byId[$0] != nil }
                if let first = scope.first.flatMap({ byId[$0] }) {
                    player.playOffline(item: first, downloads: downloads, scope: scope)
                    notice = "Playing offline: \(library.title)"
                    return
                }
            }
            notice = "No downloaded playlist matches \"\(command.query)\"."
            say("I could not find that playlist in your downloads.")
        case .openHome:
            shellRequests.send(.tab(.home))
        case .openExplore:
            shellRequests.send(.tab(.explore))
        case .openLibrary:
            shellRequests.send(.tab(.library))
        case .openLiked:
            shellRequests.send(.tab(.library))
            await engine.openBrowse("VLLM")
        case .openPlaylists:
            shellRequests.send(.tab(.library))
            await engine.openBrowse("FEmusic_liked_playlists")
        case .openDownloads:
            shellRequests.send(.tab(.downloads))
        case .openSettings:
            shellRequests.send(.settings)
        case .openQueue:
            shellRequests.send(.player(true))
        case .openSearch:
            shellRequests.send(.tab(.search))
        }
    }
}

private extension Double {
    func rounded(toPlaces places: Int) -> Double {
        let factor = pow(10, Double(places))
        return (self * factor).rounded() / factor
    }
}
