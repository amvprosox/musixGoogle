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
}

private struct ResolvedAudioStream: Sendable {
    let url: String
    let contentLength: Int64?
    let durationSec: Double?
    let userAgent: String
}

@MainActor
final class DownloadController: ObservableObject {
    @Published private(set) var items: [DownloadItem] = []

    private let engine: WebEngine
    private let downloadsDir: URL
    private let indexFile: URL
    private var activeTasks: [String: Task<Void, Never>] = [:]

    private static let chunkBytes: Int64 = 512 * 1024
    private static let clients: [InnertubeClientSpec] = [
        InnertubeClientSpec(
            name: "ANDROID_VR",
            version: "1.60.19",
            id: "28",
            userAgent: "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip",
            osName: "Android",
            osVersion: "12L",
            deviceMake: "Oculus",
            deviceModel: "Quest 3",
            androidSdkVersion: 32
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
            androidSdkVersion: nil
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
            androidSdkVersion: 34
        ),
    ]

    init(engine: WebEngine) {
        self.engine = engine
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? FileManager.default.temporaryDirectory
        let dir = base.appendingPathComponent("Musix", isDirectory: true).appendingPathComponent("downloads", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        self.downloadsDir = dir
        self.indexFile = dir.appendingPathComponent("downloads.json")
        loadIndex()
    }

    func item(for videoId: String) -> DownloadItem? {
        items.first { $0.videoId == videoId }
    }

    func audioURL(for videoId: String) -> URL? {
        guard BridgeCodec.isValidVideoId(videoId) else {
            return nil
        }
        let file = downloadsDir.appendingPathComponent("\(videoId).mp3")
        guard let attrs = try? FileManager.default.attributesOfItem(atPath: file.path),
              let size = attrs[.size] as? NSNumber,
              size.int64Value > 0 else {
            return nil
        }
        return file
    }

    func artworkAddress(for item: DownloadItem) -> String {
        let file = downloadsDir.appendingPathComponent("\(item.videoId).jpg")
        if let attrs = try? FileManager.default.attributesOfItem(atPath: file.path),
           let size = attrs[.size] as? NSNumber,
           size.int64Value > 0 {
            return file.absoluteString
        }
        return item.artworkUrl
    }

    func startDownload(_ request: DownloadTrackRequest) {
        let videoId = request.videoId.trimmingCharacters(in: .whitespacesAndNewlines)
        let title = request.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard BridgeCodec.isValidVideoId(videoId), !title.isEmpty else {
            return
        }
        if let existing = item(for: videoId) {
            if existing.status == .completed, audioURL(for: videoId) != nil {
                return
            }
            if (existing.status == .downloading || existing.status == .queued), activeTasks[videoId] != nil {
                return
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
            status: .downloading,
            progress: 0.02,
            error: nil,
            createdAt: item(for: videoId)?.createdAt ?? now,
            completedAt: nil,
            fileSizeBytes: nil
        )
        upsert(entry)
        let dir = downloadsDir
        let task = Task { [weak self] in
            guard let self else {
                return
            }
            await self.runDownload(entry: entry, downloadsDir: dir)
        }
        activeTasks[videoId] = task
    }

    func deleteDownload(_ videoId: String) {
        guard BridgeCodec.isValidVideoId(videoId) else {
            return
        }
        activeTasks[videoId]?.cancel()
        activeTasks.removeValue(forKey: videoId)
        items.removeAll { $0.videoId == videoId }
        saveIndex()
        let mp3 = downloadsDir.appendingPathComponent("\(videoId).mp3")
        let part = downloadsDir.appendingPathComponent("\(videoId).mp3.part")
        let jpg = downloadsDir.appendingPathComponent("\(videoId).jpg")
        try? FileManager.default.removeItem(at: mp3)
        try? FileManager.default.removeItem(at: part)
        try? FileManager.default.removeItem(at: jpg)
    }

    private func runDownload(entry: DownloadItem, downloadsDir: URL) async {
        let videoId = entry.videoId
        let partFile = downloadsDir.appendingPathComponent("\(videoId).mp3.part")
        let finalFile = downloadsDir.appendingPathComponent("\(videoId).mp3")
        let thumbFile = downloadsDir.appendingPathComponent("\(videoId).jpg")
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
            var visitorData = await engine.visitorData()
            if visitorData == nil {
                visitorData = await Self.fetchWebVisitorData()
            }
            let resolved = try await Self.resolveStream(videoId: videoId, visitorData: visitorData)
            if let dur = resolved.durationSec, dur > 0 {
                updateItem(videoId: videoId) { item in
                    if item.durationSec <= 0 {
                        item.durationSec = dur
                    }
                }
            }
            let candidates = Self.buildCandidateStreamUrls(resolved.url)
            var downloaded = false
            var lastError: Error?
            for candidate in candidates {
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
                    break
                } catch {
                    lastError = error
                    try? FileManager.default.removeItem(at: partFile)
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
            updateItem(videoId: videoId) { item in
                item.status = .completed
                item.progress = 1
                item.error = nil
                item.completedAt = Date().timeIntervalSince1970 * 1000
                item.fileSizeBytes = size
            }
        } catch {
            try? FileManager.default.removeItem(at: partFile)
            guard !Task.isCancelled else {
                return
            }
            let message = error.localizedDescription.isEmpty ? "Download failed" : error.localizedDescription
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
        guard let data = try? Data(contentsOf: indexFile),
              let decoded = try? JSONDecoder().decode([DownloadItem].self, from: data) else {
            items = []
            return
        }
        var loaded: [DownloadItem] = []
        var seen = Set<String>()
        for var entry in decoded {
            guard BridgeCodec.isValidVideoId(entry.videoId), !entry.title.isEmpty, seen.insert(entry.videoId).inserted else {
                continue
            }
            if entry.status == .completed {
                if let url = audioURL(for: entry.videoId),
                   let attrs = try? FileManager.default.attributesOfItem(atPath: url.path),
                   let size = attrs[.size] as? NSNumber,
                   size.int64Value > 0 {
                    entry.progress = 1
                    entry.fileSizeBytes = size.int64Value
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
            loaded.append(entry)
        }
        loaded.sort { $0.createdAt > $1.createdAt }
        items = loaded
        saveIndex()
    }

    private func saveIndex() {
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

    nonisolated private static func fetchWebVisitorData() async -> String? {
        guard let url = URL(string: "https://music.youtube.com/") else {
            return nil
        }
        var request = URLRequest(url: url)
        request.timeoutInterval = 10
        request.setValue(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
            forHTTPHeaderField: "User-Agent"
        )
        request.setValue("en-US,en;q=0.9", forHTTPHeaderField: "Accept-Language")
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  let html = String(data: data, encoding: .utf8) else {
                return nil
            }
            guard let regex = try? NSRegularExpression(pattern: "\"VISITOR_DATA\"\\s*:\\s*\"([^\"]+)\""),
                  let match = regex.firstMatch(in: html, range: NSRange(html.startIndex..., in: html)),
                  let range = Range(match.range(at: 1), in: html) else {
                return nil
            }
            let token = String(html[range])
            return token.isEmpty ? nil : token
        } catch {
            return nil
        }
    }

    nonisolated private static func resolveStream(videoId: String, visitorData: String?) async throws -> ResolvedAudioStream {
        var lastReason = "Unable to resolve audio stream"
        for client in clients {
            do {
                if let stream = try await requestPlayer(videoId: videoId, client: client, visitorData: visitorData) {
                    return stream
                }
            } catch {
                lastReason = error.localizedDescription
            }
        }
        throw NSError(domain: "MusixDownload", code: 1, userInfo: [NSLocalizedDescriptionKey: lastReason])
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
        let bodyObj: [String: Any] = [
            "videoId": videoId,
            "racyCheckOk": true,
            "contentCheckOk": true,
            "context": ["client": clientObj],
        ]
        let payload = try JSONSerialization.data(withJSONObject: bodyObj)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.httpBody = payload
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(client.userAgent, forHTTPHeaderField: "User-Agent")
        request.setValue(client.id, forHTTPHeaderField: "X-YouTube-Client-Name")
        request.setValue(client.version, forHTTPHeaderField: "X-YouTube-Client-Version")
        if let visitorData, !visitorData.isEmpty {
            request.setValue(visitorData, forHTTPHeaderField: "X-Goog-Visitor-Id")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
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
            userAgent: client.userAgent
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
