import Foundation
import XCTest
@testable import MusixCore

final class MediaIdTests: XCTestCase {
    func testRoundTripsEveryKind() {
        let cases: [(String, MediaRef)] = [
            (MediaIds.root, .root),
            (MediaIds.tab(.recent), .tab(.recent)),
            (MediaIds.folder(.albums), .folder(.albums)),
            (MediaIds.node("FEmusic_moods|params/with=slash", playlistId: "OLAK5uy_x"), .node(nodeId: "FEmusic_moods|params/with=slash", playlistId: "OLAK5uy_x")),
            (MediaIds.node("MPREb_abc"), .node(nodeId: "MPREb_abc", playlistId: nil)),
            (MediaIds.track("lYBUbBu4W08", playlistId: "RDAMVM"), .track(videoId: "lYBUbBu4W08", playlistId: "RDAMVM")),
            (MediaIds.search("daft punk / live"), .search(query: "daft punk / live")),
        ]
        for (id, ref) in cases {
            XCTAssertEqual(MediaIds.parse(id), ref, id)
        }
    }

    func testRejectsGarbage() {
        for id in ["", "tab/unknown", "node", "node/a", "track//", "search/", "search/%20", "what/ever", String(repeating: "x", count: 20_000)] {
            XCTAssertNil(MediaIds.parse(id), id)
        }
    }

    func testRootTabsAndFolders() {
        XCTAssertEqual(LibraryEntries.rootTabs().map(\.title), ["Home", "Library", "Playlists", "Recent"])
        XCTAssertTrue(LibraryEntries.rootTabs().allSatisfy { $0.browsable && !$0.playable })
        XCTAssertEqual(LibraryEntries.libraryFolders().map(\.title), ["Liked songs", "Albums", "Artists"])
    }

    func testMapsRealParserOutput() throws {
        let home = try Contract.page("browseResult-browse-home")
        let entries = home.sections.flatMap { section in
            section.items.compactMap { LibraryEntries.entry(from: $0, group: section.title, contextPlaylistId: nil) }
        }
        let song = try XCTUnwrap(entries.first)
        XCTAssertEqual(song.kind, .song)
        XCTAssertTrue(song.playable)
        XCTAssertEqual(song.groupTitle, "Quick picks")
        guard case .track = MediaIds.parse(song.mediaId) else {
            return XCTFail("expected a track id")
        }
        let playlist = try XCTUnwrap(entries.first { $0.kind == .playlist })
        XCTAssertTrue(playlist.browsable)
        let artist = try Contract.page("browseResult-browse-artist")
        let kinds = Set(artist.sections.flatMap { section in
            section.items.compactMap { LibraryEntries.entry(from: $0, group: section.title, contextPlaylistId: nil)?.kind }
        })
        XCTAssertTrue(kinds.isSuperset(of: [.song, .album]))
    }

    func testSkipsInertItemsAndUsesPlaylistContext() {
        let inert = FlatItem(id: "x", title: "Header", type: .shelf, playable: false, browsable: false)
        XCTAssertNil(LibraryEntries.entry(from: inert, group: nil, contextPlaylistId: nil))
        let song = FlatItem(id: "v", title: "Song", type: .song, playable: true, browsable: false, videoId: "video00001")
        let entry = LibraryEntries.entry(from: song, group: nil, contextPlaylistId: "PLcontext")
        XCTAssertEqual(entry.flatMap { MediaIds.parse($0.mediaId) }, .track(videoId: "video00001", playlistId: "PLcontext"))
    }
}

final class BrowsePagerTests: XCTestCase {
    final class FakeSource: PageSource, @unchecked Sendable {
        private let lock = NSLock()
        private let pages: [String: BrowsePage]
        private let continuations: [String: BrowsePage]
        private var failure: LoadFailure?
        private var log: [String] = []

        init(pages: [String: BrowsePage], continuations: [String: BrowsePage] = [:]) {
            self.pages = pages
            self.continuations = continuations
        }

        var calls: [String] { lock.withLock { log } }

        func fail(_ value: LoadFailure?) {
            lock.withLock { failure = value }
        }

        func browse(_ nodeId: String) async -> PageLoad {
            lock.withLock {
                log.append("browse:\(nodeId)")
                if let failure { return .failed(failure) }
                return pages[nodeId].map { .loaded($0) } ?? .failed(.error("missing \(nodeId)"))
            }
        }

        func search(_ query: String) async -> PageLoad {
            lock.withLock {
                log.append("search:\(query)")
                if let failure { return .failed(failure) }
                return pages["search:\(query)"].map { .loaded($0) } ?? .failed(.error("missing search"))
            }
        }

        func more(_ nodeId: String, token: String, kind: ContinuationKind) async -> PageLoad {
            lock.withLock {
                log.append("more:\(nodeId):\(token):\(kind.rawValue)")
                if let failure { return .failed(failure) }
                return continuations[token].map { .loaded($0) } ?? .failed(.error("missing \(token)"))
            }
        }
    }

    final class Clock: @unchecked Sendable {
        private let lock = NSLock()
        private var value = Date(timeIntervalSince1970: 1_000)

        func now() -> Date { lock.withLock { value } }

        func advance(_ seconds: TimeInterval) {
            lock.withLock { value = value.addingTimeInterval(seconds) }
        }
    }

    private func song(_ n: Int) -> FlatItem {
        FlatItem(id: "v\(n)", title: "Song \(n)", subtitle: "Artist", type: .song, playable: true, browsable: false, videoId: String(format: "video%05d", n), durationSec: 180)
    }

    private func titles(_ result: ChildrenResult) -> [String] {
        if case let .loaded(_, entries, _) = result {
            return entries.map(\.title)
        }
        return []
    }

    func testPagesInFiftiesAndFollowsContinuations() async {
        let first = BrowsePage(nodeId: "VLPL", title: "Big", items: (0..<100).map(song), continuation: "c1")
        let second = BrowsePage(nodeId: "VLPL", title: "", sections: [FlatSection(id: "s", title: "", items: (100..<160).map(song))])
        let source = FakeSource(pages: ["VLPL": first], continuations: ["c1": second])
        let pager = BrowsePager(source: source, cache: TtlCache(ttl: 600))
        let page0 = await pager.children("VLPL", page: 0, pageSize: 200)
        XCTAssertEqual(titles(page0).count, 50)
        let page2 = await pager.children("VLPL", page: 2, pageSize: 50)
        XCTAssertEqual(titles(page2).first, "Song 100")
        let page3 = await pager.children("VLPL", page: 3, pageSize: 50)
        XCTAssertEqual(titles(page3).count, 10)
        let page4 = await pager.children("VLPL", page: 4, pageSize: 50)
        XCTAssertEqual(titles(page4), [])
        XCTAssertEqual(source.calls, ["browse:VLPL", "more:VLPL:c1:browse"])
        let found = await pager.find(MediaIds.track("video00120"))
        XCTAssertEqual(found?.title, "Song 120")
    }

    func testCachesForTenMinutesAndServesStaleWhenOffline() async throws {
        let clock = Clock()
        let source = FakeSource(pages: ["home": try Contract.page("browseResult-browse-home")])
        let pager = BrowsePager(source: source, cache: TtlCache(ttl: 600, clock: { clock.now() }))
        _ = await pager.children("home", page: 0, pageSize: 50)
        clock.advance(599)
        _ = await pager.children("home", page: 0, pageSize: 50)
        XCTAssertEqual(source.calls.filter { $0.hasPrefix("browse") }.count, 1)
        clock.advance(2)
        _ = await pager.children("home", page: 0, pageSize: 50)
        XCTAssertEqual(source.calls.filter { $0.hasPrefix("browse") }.count, 2)
        clock.advance(3600)
        source.fail(.offline)
        let stale = await pager.children("home", page: 0, pageSize: 50)
        guard case let .loaded(_, entries, isStale) = stale else {
            return XCTFail("expected stale results")
        }
        XCTAssertTrue(isStale)
        XCTAssertFalse(entries.isEmpty)
    }

    func testReportsFailuresWithoutCache() async {
        let source = FakeSource(pages: [:])
        let pager = BrowsePager(source: source, cache: TtlCache(ttl: 600))
        source.fail(.signedOut)
        let signedOut = await pager.children("playlists", page: 0, pageSize: 50)
        XCTAssertEqual(signedOut, .failed(.signedOut))
        source.fail(.offline)
        let offline = await pager.children("recent", page: 0, pageSize: 50)
        XCTAssertEqual(offline, .failed(.offline))
    }

    func testSearchUsesSearchContinuationsAndStopsOnRepeats() async {
        let first = BrowsePage(nodeId: "search:all:q", title: "", items: (0..<20).map(song), continuation: "s1")
        let second = BrowsePage(nodeId: "search:all:q", title: "", items: (20..<40).map(song), continuation: "s1")
        let source = FakeSource(pages: ["search:q": first], continuations: ["s1": second])
        let pager = BrowsePager(source: source, cache: TtlCache(ttl: 600))
        let result = await pager.search("q", page: 0, pageSize: 50)
        XCTAssertEqual(titles(result).count, 40)
        XCTAssertEqual(source.calls, ["search:q", "more:search:all:q:s1:search"])
    }

    func testDiskStoreSurvivesRestartAndDropsCorruptFiles() throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("musix-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: directory) }
        let cache = TtlCache<[String]>(ttl: 600, disk: JSONFileStore(directory: directory))
        cache.put("home", ["x", "y"])
        let restarted = TtlCache<[String]>(ttl: 600, disk: JSONFileStore(directory: directory))
        XCTAssertEqual(restarted.fresh("home"), ["x", "y"])
        let file = try XCTUnwrap(FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).first)
        try Data("{ broken".utf8).write(to: file)
        XCTAssertNil(TtlCache<[String]>(ttl: 600, disk: JSONFileStore(directory: directory)).any("home"))
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    func testEvictsLeastRecentlyUsed() {
        let cache = TtlCache<Int>(ttl: 10, maxEntries: 2)
        cache.put("a", 1)
        cache.put("b", 2)
        _ = cache.fresh("a")
        cache.put("c", 3)
        XCTAssertNil(cache.any("b"))
        XCTAssertEqual(cache.any("a"), 1)
        XCTAssertEqual(cache.any("c"), 3)
    }
}
