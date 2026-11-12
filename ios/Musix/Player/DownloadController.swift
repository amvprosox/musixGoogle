import Foundation
import MusixCore
import UIKit

enum DownloadStatus: String, Codable, Sendable {
    case queued
    case downloading
    case completed
    case failed
}

struct DownloadItem: Codable, Equatable, Identifiable, Sendable {
    var videoId: String
    var title: String
    var artist: String
    var album: String
    var durationSec: Double
    var artworkUrl: String
    var status: DownloadStatus
    var progress: Double
    var error: String?
    var createdAt: Double
    var completedAt: Double?
    var fileSizeBytes: Int64?

    var id: String { videoId }
}

struct DownloadTrackRequest: Equatable, Sendable {
    var videoId: String
    var title: String
    var artist: String
    var album: String
    var durationSec: Double
    var artworkUrl: String
}

struct DetectedLibrary: Identifiable, Equatable, Sendable {
    var id: String
    var title: String
    var subtitle: String
    var artworkUrl: String
    var tracks: [DownloadTrackRequest]
}

private struct InnertubeClientSpec: Sendable {
    let name: String
    let version: String
    let id: String
    let userAgent: String
    let osName: String
    let osVersion: String
    let deviceMake: String?
    let deviceModel: String?
    let androidSdkVersion: Int?
    let html5Pref: Bool
}

private struct ResolvedAudioStream: Sendable {
    let url: String
    let contentLength: Int64?
    let durationSec: Double?
    let userAgent: String
    let clientName: String
}

@MainActor
final class DownloadController: ObservableObject {
    @Published private(set) var items: [DownloadItem] = []
    @Published private(set) var logs: [String] = []
    @Published private(set) var libraries: [DetectedLibrary] = []
    @Published private(set) var detectingLibraries = false
    @Published private(set) var notice: String?

    private let engine: WebEngine
    private let downloadsDir: URL
    private let musicDir: URL
    private let thumbnailsDir: URL
    private let miscDir: URL
    private let indexFile: URL
    private let logFile: URL
    private var activeTasks: [String: Task<Void, Never>] = [:]
    private var runningCount = 0
    private var slotWaiters: [CheckedContinuation<Void, Never>] = []
    private var cachedVisitorData: String?
    private var librariesLoadedOnce = false
    private var librariesAccount: WebEngine.Account?
    private var noticeTask: Task<Void, Never>?
    private var indexSavePending = false
    private var logSavePending = false
    private var sanitizeCache: [String: String] = [:]
    private let logFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyy-MM-dd HH:mm:ss"
        return formatter
    }()

    private static let maxConcurrent = 3
    private static let maxLogLines = 500
    nonisolated private static let chunkBytes: Int64 = 512 * 1024
    nonisolated private static let clients: [InnertubeClientSpec] = [
        InnertubeClientSpec(
            name: "VISIONOS",
            version: "1.02",
            id: "101",
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15",
            osName: "visionOS",
            osVersion: "26.5.23O471",
            deviceMake: "Apple",
            deviceModel: "RealityDevice17,1",
            androidSdkVersion: nil,
            html5Pref: true
        ),
        InnertubeClientSpec(
            name: "ANDROID_VR",
            version: "1.60.19",
            id: "28",
            userAgent: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
            osName: "Android",
            osVersion: "12L",
            deviceMake: "Oculus",
            deviceModel: "Quest 3",
            androidSdkVersion: 32,
            html5Pref: false
        ),
        InnertubeClientSpec(
            name: "IOS",
            version: "20.10.4",
            id: "5",
            userAgent: "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_3_2 like Mac OS X;)",
            osName: "iPhone",
            osVersion: "18.3.2.22D82",
            deviceMake: "Apple",
            deviceModel: "iPhone16,2",
            androidSdkVersion: nil,
            html5Pref: false
        ),
        InnertubeClientSpec(
            name: "ANDROID",
            version: "20.10.38",
            id: "3",
            userAgent: "com.google.android.youtube/20.10.38 (Linux; U; Android 14) gzip",
            osName: "Android",
            osVersion: "14",
            deviceMake: nil,
            deviceModel: nil,
            androidSdkVersion: 34,
            html5Pref: false
        ),
    ]

    init(engine: WebEngine) {
        self.engine = engine
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent("Musix", isDirectory: true).appendingPathComponent("downloads", isDirectory: true)
        let music = dir.appendingPathComponent("music", isDirectory: true)
        let thumbs = dir.appendingPathComponent("thumbnails", isDirectory: true)
        let misc = dir.appendingPathComponent("misc", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: music, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: thumbs, withIntermediateDirectories: true)
        try? FileManager.default.createDirectory(at: misc, withIntermediateDirectories: true)
        self.downloadsDir = dir
        self.musicDir = music
        self.thumbnailsDir = thumbs
        self.miscDir = misc
        self.indexFile = misc.appendingPathComponent("downloads.json")
        self.logFile = misc.appendingPathComponent("downloads.log")
        loadLogs()
        loadIndex()
    }

    private func loadLogs() {
        guard let data = try? Data(contentsOf: logFile), let text = String(data: data, encoding: .utf8) else {
            logs = []
            return
        }
        logs = Array(text.split(separator: "\n").map(String.init).filter { !$0.isEmpty }.suffix(Self.maxLogLines))
    }

    func appendLog(_ message: String) {
        logs.append("[\(logFormatter.string(from: Date()))] \(message)")
        if logs.count > Self.maxLogLines {
            logs.removeFirst(logs.count - Self.maxLogLines)
        }
        PlaybackLog.shared.add("Download: \(message)")
        guard !logSavePending else {
            return
        }
        logSavePending = true
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            self?.flushLogs()
        }
    }

    private func flushLogs() {
        logSavePending = false
        let text = logs.isEmpty ? "" : logs.joined(separator: "\n") + "\n"
        try? text.data(using: .utf8)?.write(to: logFile, options: .atomic)
    }

    func clearLogs() {
        logs = []
        flushLogs()
    }

    var logsText: String {
        logs.joined(separator: "\n")
    }

    func postNotice(_ text: String) {
        notice = text
        noticeTask?.cancel()
        noticeTask = Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            guard !Task.isCancelled else {
                return
            }
            self?.notice = nil
        }
    }

    private func acquireSlot() async {
        if runningCount < Self.maxConcurrent {
            runningCount += 1
            return
        }
        await withCheckedContinuation { continuation in
            slotWaiters.append(continuation)
        }
    }

    private func releaseSlot() {
        if slotWaiters.isEmpty {
            runningCount = max(0, runningCount - 1)
        } else {
            slotWaiters.removeFirst().resume()
        }
    }

    func isDownloadedOrActive(_ videoId: String) -> Bool {
        guard let existing = item(for: videoId) else {
            return false
        }
        if existing.status == .completed, audioURL(for: videoId) != nil {
            return true
        }
        return (existing.status == .downloading || existing.status == .queued) && activeTasks[videoId] != nil
    }

    func item(for videoId: String) -> DownloadItem? {
        items.first { $0.videoId == videoId }
    }

    private func sanitizeTitle(_ title: String, fallback: String) -> String {
        let key = "\(fallback)\u{0}\(title)"
        if let cached = sanitizeCache[key] {
            return cached
        }
        let result = computeSanitizedTitle(title, fallback: fallback)
        if sanitizeCache.count > 5000 {
            sanitizeCache.removeAll()
        }
        sanitizeCache[key] = result
        return result
    }

    private func computeSanitizedTitle(_ title: String, fallback: String) -> String {
        let invalid = CharacterSet(charactersIn: "<>:\"/\\|?*").union(.controlCharacters)
        let cleaned = title.components(separatedBy: invalid).joined(separator: " ")
            .replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
            .trimmingCharacters(in: CharacterSet(charactersIn: " ."))
        let clipped = String(cleaned.prefix(120)).trimmingCharacters(in: CharacterSet(charactersIn: " ."))
        return clipped.isEmpty ? fallback : clipped
    }

    private func fileStem(for entry: DownloadItem) -> String {
        let base = sanitizeTitle(entry.title, fallback: entry.videoId)
        let collision = items.contains {
            $0.videoId != entry.videoId &&
                sanitizeTitle($0.title, fallback: $0.videoId).caseInsensitiveCompare(base) == .orderedSame
        }
        return collision ? "\(base) (\(entry.videoId))" : base
    }

    func audioURL(for videoId: String) -> URL? {
        guard BridgeCodec.isValidVideoId(videoId) else {
            return nil
        }
        var candidates: [URL] = []
        if let existing = item(for: videoId) {
            let stem = fileStem(for: existing)
            let base = sanitizeTitle(existing.title, fallback: videoId)
            candidates.append(musicDir.appendingPathComponent("\(stem).mp3"))
            candidates.append(musicDir.appendingPathComponent("\(base).mp3"))
        }
        candidates.append(musicDir.appendingPathComponent("\(videoId).mp3"))
        candidates.append(downloadsDir.appendingPathComponent("\(videoId).mp3"))
        for file in candidates {
            if let attrs = try? FileManager.default.attributesOfItem(atPath: file.path),
               let size = attrs[.size] as? NSNumber,
               size.int64Value > 0 {
                return file
            }
        }
        return nil
    }

    func artworkAddress(for item: DownloadItem) -> String {
        let stem = fileStem(for: item)
        let base = sanitizeTitle(item.title, fallback: item.videoId)
        let candidates = [
            thumbnailsDir.appendingPathComponent("\(stem).jpg"),
            thumbnailsDir.appendingPathComponent("\(base).jpg"),
            thumbnailsDir.appendingPathComponent("\(item.videoId).jpg"),
            downloadsDir.appendingPathComponent("\(item.videoId).jpg"),
        ]
        for file in candidates {
            if let attrs = try? FileManager.default.attributesOfItem(atPath: file.path),
               let size = attrs[.size] as? NSNumber,
               size.int64Value > 0 {
                return file.absoluteString
            }
        }
        return item.artworkUrl
    }

    private func writeDescriptionFile(for entry: DownloadItem, stem: String) {
        let lines = [
            "Title: \(entry.title)",
            "Artist: \(entry.artist)",
            "Album: \(entry.album)",
            "Video ID: \(entry.videoId)",
            "Duration: \(Int(entry.durationSec.rounded()))s",
            "Source: https://music.youtube.com/watch?v=\(entry.videoId)",
        ].joined(separator: "\n") + "\n"
        let descFile = miscDir.appendingPathComponent("\(stem).txt")
        try? lines.data(using: .utf8)?.write(to: descFile, options: .atomic)
    }

    @discardableResult
    func startDownload(_ request: DownloadTrackRequest, quiet: Bool = false) -> Bool {
        let videoId = request.videoId.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = request.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard BridgeCodec.isValidVideoId(videoId), !title.isEmpty else {
            return false
        }
        if let existing = item(for: videoId) {
            if existing.status == .completed, audioURL(for: videoId) != nil {
                appendLog("Skip \(title) (\(videoId)): already downloaded")
                if !quiet {
                    postNotice("Already downloaded")
                }
                return false
            }
            if (existing.status == .downloading || existing.status == .queued), activeTasks[videoId] != nil {
                appendLog("Skip \(title) (\(videoId)): already downloading")
                return false
            }
        }
        let now = Date().timeIntervalSince1970 * 1000
        let entry = DownloadItem(
            videoId: videoId,
            title: String(title.prefix(300)),
            artist: String(request.artist.trimmingCharacters(in: .whitespacesAndNewlines).prefix(300)),
            album: String(request.album.trimmingCharacters(in: .whitespacesAndNewlines).prefix(300)),
            durationSec: request.durationSec.isFinite && request.durationSec >= 0 ? request.durationSec : 0,
            artworkUrl: request.artworkUrl.trimmingCharacters(in: .whitespacesAndNewlines),
            status: .queued,
            progress: 0,
            error: nil,
            createdAt: item(for: videoId)?.createdAt ?? now,
            completedAt: nil,
            fileSizeBytes: nil
        )
        upsert(entry)
        let stem = fileStem(for: entry)
        writeDescriptionFile(for: entry, stem: stem)
        appendLog("Queued download: \(entry.title) (\(videoId))")
        let task = Task { [weak self] in
            guard let self else {
                return
            }
            await self.acquireSlot()
            defer {
                self.releaseSlot()
            }
            guard !Task.isCancelled else {
                return
            }
            self.updateItem(videoId: videoId) { item in
                item.status = .downloading
                item.progress = max(item.progress, 0.02)
            }
            await self.runDownload(entry: entry, stem: stem)
        }
        activeTasks[videoId] = task
        return true
    }

    @discardableResult
    func downloadBatch(title: String, tracks: [DownloadTrackRequest]) -> (started: Int, skipped: Int, alreadyDownloaded: Bool) {
        var seen = Set<String>()
        var started = 0
        var skipped = 0
        for track in tracks {
            guard BridgeCodec.isValidVideoId(track.videoId), !track.title.isEmpty, seen.insert(track.videoId).inserted else {
                continue
            }
            if isDownloadedOrActive(track.videoId) {
                skipped += 1
                appendLog("Batch [\(title)]: skipping already downloaded \(track.title) (\(track.videoId))")
                continue
            }
            if startDownload(track, quiet: true) {
                started += 1
            }
        }
        let allDone = started == 0 && skipped > 0
        if allDone {
            appendLog("Batch [\(title)]: all \(skipped) songs already downloaded")
            postNotice("Already downloaded")
        } else if started > 0 {
            appendLog("Batch [\(title)]: queued \(started) songs, skipped \(skipped) already downloaded")
            let note = skipped > 0 ? " (skipped \(skipped) already downloaded)" : ""
            postNotice("Downloading \(started) songs from \(title)\(note)")
        }
        return (started, skipped, allDone)
    }

    func detectLibraries(force: Bool = false) async {
        if detectingLibraries || (librariesLoadedOnce && !force && librariesAccount == engine.account) {
            return
        }
        detectingLibraries = true
        librariesAccount = engine.account
        defer {
            detectingLibraries = false
        }
        let queue = engine.commandQueue
        func browse(_ nodeId: String) async -> BrowsePage? {
            if case let .page(page) = await queue.send(.browse(nodeId: nodeId)) {
                return page
            }
            return nil
        }
        var found: [DetectedLibrary] = []
        if let page = await browse("library-liked") {
            let tracks = Self.extractTracks(page.items + page.sections.flatMap(\.items))
            if !tracks.isEmpty {
                found.append(DetectedLibrary(id: "library-liked", title: "Liked Music", subtitle: "\(tracks.count) songs", artworkUrl: tracks[0].artworkUrl, tracks: tracks))
            }
        }
        if let page = await browse("recent") {
            let tracks = Self.extractTracks(page.items + page.sections.flatMap(\.items))
            if !tracks.isEmpty {
                found.append(DetectedLibrary(id: "recent", title: "Recently Played", subtitle: "\(tracks.count) songs", artworkUrl: tracks[0].artworkUrl, tracks: tracks))
            }
        }
        for (node, label, limit) in [("playlists", "Playlist", 10), ("library-albums", "Album", 8)] {
            guard let page = await browse(node) else {
                continue
            }
            var seen = Set<String>()
            let collections = (page.items + page.sections.flatMap(\.items)).filter { item in
                guard let browseId = item.browseId, !browseId.isEmpty, browseId != "VLLM", browseId != "LM" else {
                    return false
                }
                return seen.insert(browseId).inserted
            }
            for collection in collections.prefix(limit) {
                guard let browseId = collection.browseId, let sub = await browse(browseId) else {
                    continue
                }
                let tracks = Self.extractTracks(sub.items + sub.sections.flatMap(\.items))
                guard !tracks.isEmpty else {
                    continue
                }
                found.append(
                    DetectedLibrary(
                        id: browseId,
                        title: collection.title.isEmpty ? sub.title : collection.title,
                        subtitle: "\(label) \u{2022} \(tracks.count) songs",
                        artworkUrl: collection.artworkUrl.isEmpty ? tracks[0].artworkUrl : collection.artworkUrl,
                        tracks: tracks
                    )
                )
            }
        }
        if found.isEmpty, let home = await browse("home") {
            for section in home.sections {
                let tracks = Self.extractTracks(section.items)
                if !tracks.isEmpty {
                    found.append(
                        DetectedLibrary(
                            id: "home-\(section.id)",
                            title: section.title.isEmpty ? "Home Shelf" : section.title,
                            subtitle: "\(tracks.count) songs",
                            artworkUrl: tracks[0].artworkUrl,
                            tracks: tracks
                        )
                    )
                }
            }
        }
        libraries = found
        librariesLoadedOnce = !found.isEmpty
        appendLog("Auto-detected \(found.count) libraries")
    }

    private static func extractTracks(_ items: [FlatItem]) -> [DownloadTrackRequest] {
        var seen = Set<String>()
        var result: [DownloadTrackRequest] = []
        for item in items {
            guard let videoId = item.videoId, BridgeCodec.isValidVideoId(videoId), !item.title.isEmpty, seen.insert(videoId).inserted else {
                continue
            }
            let parts = item.subtitle.components(separatedBy: " \u{2022} ").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            result.append(
                DownloadTrackRequest(
                    videoId: videoId,
                    title: item.title,
                    artist: parts.first ?? "",
                    album: parts.count > 1 ? parts[1] : "",
                    durationSec: max(0, item.durationSec ?? 0),
                    artworkUrl: item.artworkUrl
                )
            )
        }
        return result
    }

    func deleteDownload(_ videoId: String) {
        guard BridgeCodec.isValidVideoId(videoId) else {
            return
        }
        activeTasks[videoId]?.cancel()
        activeTasks.removeValue(forKey: videoId)
        let existing = item(for: videoId)
        let stem = existing.map { fileStem(for: $0) }
        let base = existing.map { sanitizeTitle($0.title, fallback: videoId) }
        items.removeAll { $0.videoId == videoId }
        saveIndex()
        var targets: [URL] = [
            miscDir.appendingPathComponent("\(videoId).mp3.part"),
            downloadsDir.appendingPathComponent("\(videoId).mp3.part"),
            musicDir.appendingPathComponent("\(videoId).mp3"),
            downloadsDir.appendingPathComponent("\(videoId).mp3"),
            thumbnailsDir.appendingPathComponent("\(videoId).jpg"),
            downloadsDir.appendingPathComponent("\(videoId).jpg"),
        ]
        if let stem {
            targets.append(musicDir.appendingPathComponent("\(stem).mp3"))
            targets.append(thumbnailsDir.appendingPathComponent("\(stem).jpg"))
            targets.append(miscDir.appendingPathComponent("\(stem).txt"))
        }
        if let base {
            targets.append(musicDir.appendingPathComponent("\(base).mp3"))
            targets.append(thumbnailsDir.appendingPathComponent("\(base).jpg"))
            targets.append(miscDir.appendingPathComponent("\(base).txt"))
        }
        for target in targets {
            try? FileManager.default.removeItem(at: target)
        }
    }

    private func runDownload(entry: DownloadItem, stem: String) async {
        let videoId = entry.videoId
        let partFile = miscDir.appendingPathComponent("\(videoId).mp3.part")
        let finalFile = musicDir.appendingPathComponent("\(stem).mp3")
        let thumbFile = thumbnailsDir.appendingPathComponent("\(stem).jpg")
        defer {
            activeTasks.removeValue(forKey: videoId)
        }
        do {
            try? FileManager.default.removeItem(at: partFile)
            await Self.downloadThumbnail(urlString: entry.artworkUrl, target: thumbFile)
            guard !Task.isCancelled else {
                return
            }
            updateItem(videoId: videoId) { item in
                item.progress = max(item.progress, 0.08)
            }
            var visitorData = cachedVisitorData
            if visitorData == nil {
                visitorData = await Self.fetchAnonymousVisitorData()
                if let token = visitorData {
                    cachedVisitorData = token
                    appendLog("Resolved anonymous visitorData (\(token.prefix(14))...)")
                }
            }
            if visitorData == nil {
                visitorData = await engine.visitorData()
                appendLog("Falling back to signed-in visitorData")
            }
            let resolution = await Self.resolveStreams(videoId: videoId, visitorData: visitorData)
            for note in resolution.notes {
                appendLog(note)
            }
            guard !resolution.streams.isEmpty else {
                throw NSError(domain: "MusixDownload", code: 1, userInfo: [NSLocalizedDescriptionKey: resolution.notes.last ?? "Unable to resolve audio stream"])
            }
            if let dur = resolution.streams.compactMap(\.durationSec).first, dur > 0 {
                updateItem(videoId: videoId) { item in
                    if item.durationSec <= 0 {
                        item.durationSec = dur
                    }
                }
            }
            var downloaded = false
            var lastError: Error?
            streamLoop: for resolved in resolution.streams {
                for candidate in Self.buildCandidateStreamUrls(resolved.url) {
                    guard !Task.isCancelled else {
                        try? FileManager.default.removeItem(at: partFile)
                        return
                    }
                    do {
                        try await Self.downloadAudioStream(
                            streamUrl: candidate,
                            userAgent: resolved.userAgent,
                            knownLength: resolved.contentLength,
                            target: partFile
                        ) { [weak self] ratio in
                            Task { @MainActor in
                                self?.updateItem(videoId: videoId) { item in
                                    let scaled = min(0.98, max(item.progress, 0.1 + ratio * 0.88))
                                    if scaled - item.progress >= 0.02 || ratio >= 0.99 {
                                        item.progress = scaled
                                    }
                                }
                            }
                        }
                        downloaded = true
                        appendLog("Stream \(resolved.clientName) succeeded for \(videoId)")
                        break streamLoop
                    } catch {
                        lastError = error
                        appendLog("Stream \(resolved.clientName) failed for \(videoId): \(error.localizedDescription)")
                        try? FileManager.default.removeItem(at: partFile)
                    }
                }
            }
            if !downloaded {
                throw lastError ?? NSError(domain: "MusixDownload", code: 2, userInfo: [NSLocalizedDescriptionKey: "Audio stream download failed"])
            }
            guard !Task.isCancelled else {
                try? FileManager.default.removeItem(at: partFile)
                return
            }
            let attrs = try FileManager.default.attributesOfItem(atPath: partFile.path)
            let size = (attrs[.size] as? NSNumber)?.int64Value ?? 0
            guard size > 0 else {
                throw NSError(domain: "MusixDownload", code: 3, userInfo: [NSLocalizedDescriptionKey: "Downloaded audio file is empty"])
            }
            try? FileManager.default.removeItem(at: finalFile)
            try FileManager.default.moveItem(at: partFile, to: finalFile)
            if let current = item(for: videoId) {
                writeDescriptionFile(for: current, stem: stem)
            }
            updateItem(videoId: videoId) { item in
                item.status = .completed
                item.progress = 1
                item.error = nil
                item.completedAt = Date().timeIntervalSince1970 * 1000
                item.fileSizeBytes = size
            }
            appendLog("Completed download for \(videoId) -> music/\(stem).mp3 (\(size) bytes)")
        } catch {
            try? FileManager.default.removeItem(at: partFile)
            guard !Task.isCancelled else {
                appendLog("Cancelled download for \(videoId)")
                return
            }
            let message = error.localizedDescription.isEmpty ? "Download failed" : error.localizedDescription
            appendLog("ERROR (\(videoId) - \(entry.title)): \(message)")
            updateItem(videoId: videoId) { item in
                item.status = .failed
                item.progress = 0
                item.error = String(message.prefix(240))
            }
        }
    }

    private func upsert(_ item: DownloadItem) {
        if let index = items.firstIndex(where: { $0.videoId == item.videoId }) {
            items[index] = item
        } else {
            items.insert(item, at: 0)
        }
        items.sort { $0.createdAt > $1.createdAt }
        saveIndex()
    }

    private func updateItem(videoId: String, mutate: (inout DownloadItem) -> Void) {
        guard let index = items.firstIndex(where: { $0.videoId == videoId }) else {
            return
        }
        var current = items[index]
        let before = current
        mutate(&current)
        guard current != before else {
            return
        }
        items[index] = current
        saveIndex()
    }

    private func loadIndex() {
        let legacyIndex = downloadsDir.appendingPathComponent("downloads.json")
        if !FileManager.default.fileExists(atPath: indexFile.path),
           FileManager.default.fileExists(atPath: legacyIndex.path) {
            try? FileManager.default.moveItem(at: legacyIndex, to: indexFile)
        }
        guard let data = try? Data(contentsOf: indexFile),
              let decoded = try? JSONDecoder().decode([DownloadItem].self, from: data) else {
            items = []
            return
        }
        var loaded: [DownloadItem] = []
        var seen = Set<String>()
        for entry in decoded {
            guard BridgeCodec.isValidVideoId(entry.videoId), !entry.title.isEmpty, seen.insert(entry.videoId).inserted else {
                continue
            }
            loaded.append(entry)
        }
        items = loaded
        var validated: [DownloadItem] = []
        for var entry in loaded {
            let stem = fileStem(for: entry)
            let legacyMp3 = downloadsDir.appendingPathComponent("\(entry.videoId).mp3")
            let targetMp3 = musicDir.appendingPathComponent("\(stem).mp3")
            if !FileManager.default.fileExists(atPath: targetMp3.path),
               FileManager.default.fileExists(atPath: legacyMp3.path) {
                try? FileManager.default.moveItem(at: legacyMp3, to: targetMp3)
            }
            let legacyJpg = downloadsDir.appendingPathComponent("\(entry.videoId).jpg")
            let targetJpg = thumbnailsDir.appendingPathComponent("\(stem).jpg")
            if !FileManager.default.fileExists(atPath: targetJpg.path),
               FileManager.default.fileExists(atPath: legacyJpg.path) {
                try? FileManager.default.moveItem(at: legacyJpg, to: targetJpg)
            }
            if entry.status == .completed {
                if let url = audioURL(for: entry.videoId),
                   let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
                   let size = attrs[.size] as? NSNumber,
                   size.int64Value > 0 {
                    entry.progress = 1
                    entry.fileSizeBytes = size.int64Value
                    writeDescriptionFile(for: entry, stem: stem)
                } else {
                    entry.status = .failed
                    entry.progress = 0
                    entry.error = "Downloaded file missing"
                }
            } else if entry.status == .downloading || entry.status == .queued {
                entry.status = .failed
                entry.progress = 0
                entry.error = "Download interrupted"
            }
            validated.append(entry)
        }
        validated.sort { $0.createdAt > $1.createdAt }
        items = validated
        saveIndex()
    }

    private func saveIndex() {
        guard !indexSavePending else {
            return
        }
        indexSavePending = true
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 500_000_000)
            self?.flushIndex()
        }
    }

    private func flushIndex() {
        indexSavePending = false
        guard let data = try? JSONEncoder().encode(items) else {
            return
        }
        try? data.write(to: indexFile, options: .atomic)
    }

    nonisolated private static func downloadThumbnail(urlString: String, target: URL) async {
        guard ArtworkLoader.isAllowed(urlString), let url = URL(string: urlString) else {
            return
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 15
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  (200..<300).contains(http.statusCode),
                  !data.isEmpty,
                  data.count <= 5 * 1024 * 1024,
                  UIImage(data: data) != nil else {
                return
            }
            try? data.write(to: target, options: .atomic)
        } catch {
            return
        }
    }

    nonisolated private static func fetchAnonymousVisitorData() async -> String? {
        let userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15"
        let attempts: [(String, String)] = [
            ("https://www.youtube.com/sw.js_data", "\"(Cgt[A-Za-z0-9_%-]+)\""),
            ("https://www.youtube.com/", "\"VISITOR_DATA\"\\s*:\\s*\"([^\"]+)\""),
        ]
        let session = URLSession(configuration: .ephemeral)
        for (address, pattern) in attempts {
            guard let url = URL(string: address) else {
                continue
            }
            var request = URLRequest(url: url)
            request.timeoutInterval = 10
            request.httpShouldHandleCookies = false
            request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
            request.setValue("en-US,en;q=0.9", forHTTPHeaderField: "Accept-Language")
            guard let result = try? await session.data(for: request),
                  let http = result.1 as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  let text = String(data: result.0, encoding: .utf8),
                  let regex = try? NSRegularExpression(pattern: pattern),
                  let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
                  let range = Range(match.range(at: 1), in: text) else {
                continue
            }
            let token = String(text[range])
            if !token.isEmpty {
                return token
            }
        }
        return nil
    }

    nonisolated private static func resolveStreams(videoId: String, visitorData: String?) async -> (streams: [ResolvedAudioStream], notes: [String]) {
        var streams: [ResolvedAudioStream] = []
        var notes: [String] = []
        for client in clients {
            do {
                if let stream = try await requestPlayer(videoId: videoId, client: client, visitorData: visitorData) {
                    streams.append(stream)
                    notes.append("Resolved stream via \(client.name) (len=\(stream.contentLength.map(String.init) ?? "?")) for \(videoId)")
                } else {
                    notes.append("Innertube \(client.name) returned no audio formats for \(videoId)")
                }
            } catch {
                notes.append("Innertube \(client.name) failed for \(videoId): \(error.localizedDescription)")
            }
        }
        return (streams, notes)
    }

    nonisolated private static func requestPlayer(
        videoId: String,
        client: InnertubeClientSpec,
        visitorData: String?
    ) async throws -> ResolvedAudioStream? {
        guard let url = URL(string: "https://www.youtube.com/youtubei/v1/player?prettyPrint=false") else {
            return nil
        }
        var clientObj: [String: Any] = [
            "clientName": client.name,
            "clientVersion": client.version,
            "osName": client.osName,
            "osVersion": client.osVersion,
            "hl": "en",
            "gl": "US",
        ]
        if let make = client.deviceMake {
            clientObj["deviceMake"] = make
        }
        if let model = client.deviceModel {
            clientObj["deviceModel"] = model
        }
        if let sdk = client.androidSdkVersion {
            clientObj["androidSdkVersion"] = sdk
        }
        if let visitorData, !visitorData.isEmpty {
            clientObj["visitorData"] = visitorData
        }
        var bodyObj: [String: Any] = [
            "videoId": videoId,
            "racyCheckOk": true,
            "contentCheckOk": true,
            "context": ["client": clientObj],
        ]
        if client.html5Pref {
            bodyObj["playbackContext"] = ["contentPlaybackContext": ["html5Preference": "HTML5_PREF_WANTS"]]
        }
        let payload = try JSONSerialization.data(withJSONObject: bodyObj)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.httpBody = payload
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(client.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue(client.id, forHTTPHeaderField: "X-YouTube-Client-Name")
        request.setValue(client.version, forHTTPHeaderField: "X-YouTube-Client-Version")
        request.setValue("https://www.youtube.com", forHTTPHeaderField: "Origin")
        request.httpShouldHandleCookies = false
        if let visitorData, !visitorData.isEmpty {
            request.setValue(visitorData, forHTTPHeaderField: "X-Goog-Visitor-Id")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else {
            return nil
        }
        guard (200..<300).contains(http.statusCode) else {
            throw NSError(domain: "MusixDownload", code: http.statusCode, userInfo: [NSLocalizedDescriptionKey: "Player HTTP \(http.statusCode)"])
        }
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        if let statusObj = root["playabilityStatus"] as? [String: Any],
           let status = statusObj["status"] as? String,
           status != "OK" {
            let reason = (statusObj["reason"] as? String) ?? status
            throw NSError(domain: "MusixDownload", code: 4, userInfo: [NSLocalizedDescriptionKey: reason])
        }
        guard let streamingData = root["streamingData"] as? [String: Any] else {
            return nil
        }
        let adaptive = (streamingData["adaptiveFormats"] as? [[String: Any]]) ?? []
        let regular = (streamingData["formats"] as? [[String: Any]]) ?? []
        let allFormats = adaptive + regular
        var candidates: [(url: String, contentLength: Int64?, score: Int)] = []
        for format in allFormats {
            guard let streamUrl = format["url"] as? String, !streamUrl.isEmpty else {
                continue
            }
            let mime = (format["mimeType"] as? String) ?? ""
            guard mime.hasPrefix("audio/") else {
                continue
            }
            let itag = (format["itag"] as? Int) ?? 0
            let bitrate = (format["averageBitrate"] as? Int) ?? (format["bitrate"] as? Int) ?? 0
            let clenStr = format["contentLength"] as? String
            let clen = clenStr.flatMap { Int64($0) }
            let isMp4 = mime.hasPrefix("audio/mp4")
            let isMpeg = mime.hasPrefix("audio/mpeg")
            guard isMp4 || isMpeg else {
                continue
            }
            var score = bitrate / 1000 + 500
            if itag == 140 {
                score += 1000
            } else if itag == 139 {
                score += 600
            }
            candidates.append((streamUrl, clen, score))
        }
        candidates.sort { $0.score > $1.score }
        guard let best = candidates.first else {
            return nil
        }
        var durationSec: Double?
        if let details = root["videoDetails"] as? [String: Any],
           let lenStr = details["lengthSeconds"] as? String,
           let len = Double(lenStr),
           len > 0 {
            durationSec = len
        }
        return ResolvedAudioStream(
            url: best.url,
            contentLength: best.contentLength,
            durationSec: durationSec,
            userAgent: client.userAgent,
            clientName: client.name
        )
    }

    nonisolated private static func buildCandidateStreamUrls(_ primaryUrl: String) -> [String] {
        var result = [primaryUrl]
        guard let components = URLComponents(string: primaryUrl),
              let host = components.host,
              host.hasSuffix(".googlevideo.com"),
              let mn = components.queryItems?.first(where: { $0.name == "mn" })?.value else {
            return result
        }
        let hosts = mn.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        guard hosts.count > 1 else {
            return result
        }
        for index in 1..<hosts.count {
            let altHost = "rr\(index + 1)---\(hosts[index]).googlevideo.com"
            var copy = components
            copy.host = altHost
            if let alt = copy.url?.absoluteString, !result.contains(alt) {
                result.append(alt)
            }
        }
        return result
    }

    nonisolated private static func downloadAudioStream(
        streamUrl: String,
        userAgent: String,
        knownLength: Int64?,
        target: URL,
        onProgress: @Sendable @escaping (Double) -> Void
    ) async throws {
        FileManager.default.createFile(atPath: target.path, contents: nil)
        let handle = try FileHandle(forWritingTo: target)
        defer {
            try? handle.close()
        }
        var totalBytes: Int64 = knownLength ?? 0
        var downloaded: Int64 = 0
        while true {
            try Task.checkCancellation()
            guard let url = URL(string: streamUrl) else {
                throw NSError(domain: "MusixDownload", code: 5, userInfo: [NSLocalizedDescriptionKey: "Invalid stream URL"])
            }
            var request = URLRequest(url: url)
            request.timeoutInterval = 20
            request.setValue(userAgent, forHTTPHeaderField: "User-Agent")
            let endByte: Int64 = totalBytes > 0
                ? min(downloaded + chunkBytes - 1, totalBytes - 1)
                : downloaded + chunkBytes - 1
            request.setValue("bytes=\(downloaded)-\(endByte)", forHTTPHeaderField: "Range")
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse,
                  http.statusCode == 200 || http.statusCode == 206 else {
                let code = (response as? HTTPURLResponse)?.statusCode ?? 0
                throw NSError(domain: "MusixDownload", code: code, userInfo: [NSLocalizedDescriptionKey: "Stream HTTP \(code)"])
            }
            if totalBytes <= 0 {
                if let rangeHeader = http.value(forHTTPHeaderField: "Content-Range"),
                   let slash = rangeHeader.lastIndex(of: "/"),
                   let total = Int64(rangeHeader[rangeHeader.index(after: slash)...].trimmingCharacters(in: .whitespaces)),
                   total > 0 {
                    totalBytes = total
                } else if http.expectedContentLength > 0 {
                    totalBytes = downloaded + http.expectedContentLength
                }
            }
            guard !data.isEmpty else {
                break
            }
            try handle.write(contentsOf: data)
            downloaded += Int64(data.count)
            if totalBytes > 0 {
                onProgress(min(1, Double(downloaded) / Double(totalBytes)))
            }
            if http.statusCode == 200 || (totalBytes > 0 && downloaded >= totalBytes) {
                break
            }
        }
        guard downloaded > 0 else {
            throw NSError(domain: "MusixDownload", code: 6, userInfo: [NSLocalizedDescriptionKey: "Zero bytes received"])
        }
    }
}
