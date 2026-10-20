import Foundation
import MusixCore
import UIKit

struct EnginePageSource: PageSource {
    let queue: CommandQueue

    func browse(_ nodeId: String) async -> PageLoad {
        Self.map(await queue.send(.browse(nodeId: nodeId)))
    }

    func search(_ query: String) async -> PageLoad {
        Self.map(await queue.send(.search(query: query, filter: .all)))
    }

    func more(_ nodeId: String, token: String, kind: ContinuationKind) async -> PageLoad {
        Self.map(await queue.send(.loadContinuation(token: token, kind: kind, nodeId: nodeId)))
    }

    static func map(_ result: CommandResult) -> PageLoad {
        switch result {
        case let .page(page):
            return .loaded(page)
        case .notReady:
            return .failed(.notReady)
        case .timedOut:
            return .failed(.timedOut)
        case .acknowledged:
            return .failed(.error("The page returned no results"))
        case let .failed(code, message):
            switch code {
            case .notSignedIn: return .failed(.signedOut)
            case .network: return .failed(.offline)
            case .notReady: return .failed(.notReady)
            default: return .failed(.error(message))
            }
        }
    }
}

enum LibraryLoad: Equatable {
    case items([LibraryEntry], stale: Bool)
    case failed(LoadFailure)
    case notFound
}

extension LoadFailure {
    var message: String {
        switch self {
        case .signedOut: return "Sign in to YouTube Music in Musix to see your library."
        case .offline: return "You're offline. Connect to the internet to browse YouTube Music."
        case .timedOut: return "YouTube Music took too long to respond. Try again."
        case .notReady: return "YouTube Music is still loading. Try again in a moment."
        case let .error(message): return message
        }
    }
}

@MainActor
final class LibraryService: ObservableObject {
    static let pageSize = 50
    let pager: BrowsePager
    private let settings: AppSettings

    init(queue: CommandQueue, settings: AppSettings) {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        let cache = TtlCache<NodeSnapshot>(ttl: 600, disk: JSONFileStore(directory: caches.appendingPathComponent("browse")))
        self.pager = BrowsePager(source: EnginePageSource(queue: queue), cache: cache)
        self.settings = settings
    }

    func children(of mediaId: String, page: Int) async -> LibraryLoad {
        guard let ref = MediaIds.parse(mediaId) else {
            return .notFound
        }
        switch ref {
        case .root:
            return page == 0 ? .items(LibraryEntries.rootTabs(), stale: false) : .items([], stale: false)
        case let .tab(tab):
            if tab == .library {
                return page == 0 ? .items(LibraryEntries.libraryFolders(), stale: false) : .items([], stale: false)
            }
            guard let nodeId = tab.nodeId else {
                return .notFound
            }
            return Self.convert(await pager.children(nodeId, page: page, pageSize: Self.pageSize))
        case let .folder(folder):
            return Self.convert(await pager.children(folder.nodeId, page: page, pageSize: Self.pageSize))
        case let .node(nodeId, playlistId):
            return Self.convert(await pager.children(nodeId, page: page, pageSize: Self.pageSize, contextPlaylistId: playlistId))
        case let .search(query):
            return await search(query, page: page)
        case .track:
            return .notFound
        }
    }

    func search(_ query: String, page: Int) async -> LibraryLoad {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else {
            return .items([], stale: false)
        }
        return Self.convert(await pager.search(String(trimmed.prefix(200)), page: page, pageSize: Self.pageSize))
    }

    func firstPlayable(matching query: String) async -> LibraryEntry? {
        let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty {
            if case let .items(entries, _) = await children(of: MediaIds.tab(.home), page: 0) {
                return Self.firstPlayable(entries)
            }
            return nil
        }
        if case let .items(entries, _) = await search(trimmed, page: 0) {
            return Self.firstPlayable(entries)
        }
        return nil
    }

    func clear() async {
        await pager.clear()
    }

    private static func firstPlayable(_ entries: [LibraryEntry]) -> LibraryEntry? {
        entries.first { $0.playable && $0.kind == .song } ?? entries.first { $0.playable }
    }

    private static func convert(_ result: ChildrenResult) -> LibraryLoad {
        switch result {
        case let .loaded(_, entries, stale):
            return .items(entries, stale: stale)
        case let .failed(failure):
            return .failed(failure)
        }
    }
}

actor ArtworkLoader {
    static let shared = ArtworkLoader()
    private static let allowedSuffixes = ["ytimg.com", "googleusercontent.com", "ggpht.com"]
    private static let maxBytes = 4 * 1024 * 1024
    private let memory = NSCache<NSString, NSData>()
    private let directory: URL
    private let session: URLSession

    init() {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first ?? FileManager.default.temporaryDirectory
        directory = caches.appendingPathComponent("artwork")
        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 10
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        session = URLSession(configuration: configuration)
        memory.countLimit = 200
    }

    static func isAllowed(_ address: String) -> Bool {
        guard address.count <= 4096, let url = URL(string: address), url.scheme == "https", let host = url.host?.lowercased() else {
            return false
        }
        return allowedSuffixes.contains { host == $0 || host.hasSuffix(".\($0)") }
    }

    func data(for address: String) async -> Data? {
        guard Self.isAllowed(address), let url = URL(string: address) else {
            return nil
        }
        let key = address as NSString
        if let cached = memory.object(forKey: key) {
            return cached as Data
        }
        let file = directory.appendingPathComponent(JSONFileStoreName.hash(address) + ".img")
        if let stored = try? Data(contentsOf: file), !stored.isEmpty {
            memory.setObject(stored as NSData, forKey: key)
            return stored
        }
        do {
            let (data, response) = try await session.data(from: url)
            guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode),
                  let finalHost = http.url?.host, Self.isAllowed("https://\(finalHost)/"),
                  !data.isEmpty, data.count <= Self.maxBytes, UIImage(data: data) != nil else {
                return nil
            }
            memory.setObject(data as NSData, forKey: key)
            try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try? data.write(to: file, options: .atomic)
            return data
        } catch {
            return nil
        }
    }

    func clear() {
        memory.removeAllObjects()
        try? FileManager.default.removeItem(at: directory)
    }
}

enum JSONFileStoreName {
    static func hash(_ key: String) -> String {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in key.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x100_0000_01b3
        }
        return String(hash, radix: 16)
    }
}
