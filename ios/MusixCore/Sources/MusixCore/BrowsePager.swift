import Foundation

public enum LoadFailure: Equatable, Sendable {
    case signedOut
    case offline
    case timedOut
    case notReady
    case error(String)
}

public enum PageLoad: Equatable, Sendable {
    case loaded(BrowsePage)
    case failed(LoadFailure)
}

public protocol PageSource: Sendable {
    func browse(_ nodeId: String) async -> PageLoad
    func search(_ query: String) async -> PageLoad
    func more(_ nodeId: String, token: String, kind: ContinuationKind) async -> PageLoad
}

public struct NodeSnapshot: Codable, Equatable, Sendable {
    public var nodeId: String
    public var title: String
    public var entries: [LibraryEntry]
    public var continuation: String?
}

public enum ChildrenResult: Equatable, Sendable {
    case loaded(title: String, entries: [LibraryEntry], stale: Bool)
    case failed(LoadFailure)
}

public actor BrowsePager {
    public static let maxPageSize = 50
    private static let maxContinuations = 20
    private static let searchPrefix = "search:all:"

    private let source: PageSource
    private let cache: TtlCache<NodeSnapshot>

    public init(source: PageSource, cache: TtlCache<NodeSnapshot>) {
        self.source = source
        self.cache = cache
    }

    public static func searchNodeId(_ query: String) -> String {
        searchPrefix + query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    public func children(_ nodeId: String, page: Int, pageSize: Int, contextPlaylistId: String? = nil) async -> ChildrenResult {
        let safePage = max(0, page)
        let size = min(max(1, pageSize), Self.maxPageSize)
        let needed = (safePage + 1) * size
        var snapshot: NodeSnapshot
        if let fresh = cache.fresh(nodeId) {
            snapshot = fresh
        } else {
            switch await loadFirst(nodeId) {
            case let .loaded(page):
                snapshot = makeSnapshot(nodeId, page: page, contextPlaylistId: contextPlaylistId)
                cache.put(nodeId, snapshot)
            case let .failed(failure):
                if failure != .signedOut, let stale = cache.any(nodeId) {
                    return .loaded(title: stale.title, entries: slice(stale.entries, page: safePage, size: size), stale: true)
                }
                return .failed(failure)
            }
        }
        var guardCount = 0
        while snapshot.entries.count < needed, guardCount < Self.maxContinuations, let token = snapshot.continuation {
            guardCount += 1
            switch await source.more(nodeId, token: token, kind: Self.kind(for: nodeId)) {
            case let .loaded(more):
                var seen = Set(snapshot.entries.map(\.mediaId))
                let extra = entries(of: more, contextPlaylistId: contextPlaylistId).filter { seen.insert($0.mediaId).inserted }
                snapshot.entries.append(contentsOf: extra)
                snapshot.continuation = more.continuation == token ? nil : more.continuation
                cache.put(nodeId, snapshot)
            case let .failed(failure):
                if snapshot.entries.count <= safePage * size {
                    return .failed(failure)
                }
                return .loaded(title: snapshot.title, entries: slice(snapshot.entries, page: safePage, size: size), stale: false)
            }
        }
        return .loaded(title: snapshot.title, entries: slice(snapshot.entries, page: safePage, size: size), stale: false)
    }

    public func search(_ query: String, page: Int, pageSize: Int) async -> ChildrenResult {
        await children(Self.searchNodeId(query), page: page, pageSize: pageSize)
    }

    public func find(_ mediaId: String) -> LibraryEntry? {
        for snapshot in cache.values() {
            if let entry = snapshot.entries.first(where: { $0.mediaId == mediaId }) {
                return entry
            }
        }
        return nil
    }

    public func clear() {
        cache.clear()
    }

    static func kind(for nodeId: String) -> ContinuationKind {
        nodeId.hasPrefix("search:") ? .search : .browse
    }

    private func loadFirst(_ nodeId: String) async -> PageLoad {
        if nodeId.hasPrefix(Self.searchPrefix) {
            return await source.search(String(nodeId.dropFirst(Self.searchPrefix.count)))
        }
        return await source.browse(nodeId)
    }

    private func makeSnapshot(_ nodeId: String, page: BrowsePage, contextPlaylistId: String?) -> NodeSnapshot {
        var seen = Set<String>()
        let unique = entries(of: page, contextPlaylistId: contextPlaylistId).filter { seen.insert($0.mediaId).inserted }
        return NodeSnapshot(nodeId: nodeId, title: page.title, entries: unique, continuation: page.continuation)
    }

    private func entries(of page: BrowsePage, contextPlaylistId: String?) -> [LibraryEntry] {
        let fromSections = page.sections.flatMap { section -> [LibraryEntry] in
            let group = section.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : section.title
            return section.items.compactMap { LibraryEntries.entry(from: $0, group: group, contextPlaylistId: contextPlaylistId) }
        }
        let loose = page.items.compactMap { LibraryEntries.entry(from: $0, group: nil, contextPlaylistId: contextPlaylistId) }
        return fromSections + loose
    }

    private func slice(_ entries: [LibraryEntry], page: Int, size: Int) -> [LibraryEntry] {
        let from = page * size
        guard from < entries.count else {
            return []
        }
        return Array(entries[from..<min(entries.count, from + size)])
    }
}
