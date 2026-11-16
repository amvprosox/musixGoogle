import Foundation
import XCTest
@testable import MusixCore

private struct SeededGenerator: RandomNumberGenerator {
    var state: UInt64

    mutating func next() -> UInt64 {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return state
    }
}

final class OfflineSessionTests: XCTestCase {
    private let ids = ["a", "b", "c", "d", "e", "f"]

    func testListOrderStopsAtEndWithoutRepeat() {
        var session = OfflineSession(queue: ids, startId: "d", shuffle: false)
        XCTAssertEqual(session.next(repeatAll: false), "e")
        XCTAssertEqual(session.next(repeatAll: false), "f")
        XCTAssertNil(session.next(repeatAll: false))
        XCTAssertEqual(session.next(repeatAll: true), "a")
    }

    func testPreviousFollowsWhatActuallyPlayed() {
        var session = OfflineSession(queue: ids, startId: "a", shuffle: false)
        _ = session.next(repeatAll: false)
        session.jumpTo("e")
        XCTAssertEqual(session.previous(repeatAll: false), "b")
        XCTAssertEqual(session.previous(repeatAll: false), "a")
        XCTAssertNil(session.previous(repeatAll: false))
    }

    func testShufflePlaysEverySongOnce() {
        var generator = SeededGenerator(state: 3)
        var session = OfflineSession(queue: ids, startId: "c", shuffle: true, using: &generator)
        var played = [session.current]
        for _ in 1..<ids.count {
            played.append(session.next(repeatAll: false))
        }
        XCTAssertEqual(played.first, "c")
        XCTAssertEqual(played.compactMap { $0 }.sorted(), ids)
        XCTAssertNil(session.next(repeatAll: false))
    }

    func testShufflePreviousReversesPlayOrder() {
        var generator = SeededGenerator(state: 11)
        var session = OfflineSession(queue: ids, startId: "a", shuffle: true, using: &generator)
        var played = [session.current ?? ""]
        for _ in 0..<4 {
            played.append(session.next(repeatAll: false) ?? "")
        }
        XCTAssertEqual(session.previous(repeatAll: false), played[3])
        XCTAssertEqual(session.previous(repeatAll: false), played[2])
        XCTAssertEqual(session.next(repeatAll: false), played[3])
        XCTAssertEqual(session.next(repeatAll: false), played[4])
    }

    func testTurningShuffleOffContinuesInListOrder() {
        var generator = SeededGenerator(state: 5)
        var session = OfflineSession(queue: ids, startId: "a", shuffle: true, using: &generator)
        _ = session.next(repeatAll: false)
        let cur = session.current ?? ""
        session.setShuffle(false)
        XCTAssertEqual(session.current, cur)
        let idx = ids.firstIndex(of: cur) ?? 0
        XCTAssertEqual(session.next(repeatAll: false), idx + 1 < ids.count ? ids[idx + 1] : nil)
    }

    func testSyncKeepsCurrentAndAddsNewDownloads() {
        var generator = SeededGenerator(state: 2)
        var session = OfflineSession(queue: ids, startId: "a", shuffle: true, using: &generator)
        _ = session.next(repeatAll: false)
        let cur = session.current
        session.syncQueue(ids.filter { $0 != "f" } + ["g"], using: &generator)
        XCTAssertEqual(session.current, cur)
        XCTAssertFalse(session.upcoming.contains("f"))
        XCTAssertTrue(session.upcoming.contains("g"))
    }
}
