import Foundation
import XCTest
@testable import MusixCore

enum Contract {
    static let directory: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .appendingPathComponent("../../../../shared/bridge/tests/contract")
        .standardizedFileURL

    static func text(_ name: String) throws -> String {
        try String(contentsOf: directory.appendingPathComponent("\(name).json"), encoding: .utf8)
    }

    static func page(_ name: String) throws -> BrowsePage {
        switch BridgeCodec.decodeEvent(try text(name)) {
        case let .accepted(.browseResult(_, page)), let .accepted(.searchResult(_, _, page)):
            return page
        default:
            throw XCTSkip("\(name) is not a page")
        }
    }
}

final class BridgeCodecTests: XCTestCase {
    func testDecodesEveryContractFile() throws {
        let files = try FileManager.default.contentsOfDirectory(at: Contract.directory, includingPropertiesForKeys: nil)
            .filter { $0.pathExtension == "json" }
        XCTAssertGreaterThanOrEqual(files.count, 20)
        for file in files {
            let result = BridgeCodec.decodeEvent(try String(contentsOf: file, encoding: .utf8))
            guard case .accepted = result else {
                XCTFail("\(file.lastPathComponent) was rejected: \(result)")
                continue
            }
        }
    }

    func testDecodesState() throws {
        guard case let .accepted(.state(state)) = BridgeCodec.decodeEvent(try Contract.text("state-playing")) else {
            return XCTFail("state rejected")
        }
        XCTAssertEqual(state.videoId, "lYBUbBu4W08")
        XCTAssertEqual(state.positionSec, 42.5)
        XCTAssertEqual(state.likeStatus, .like)
        XCTAssertEqual(state.repeatMode, .all)
        XCTAssertTrue(state.isSignedIn)
    }

    func testDecodesErrorsWithAndWithoutRequestIds() throws {
        XCTAssertEqual(
            BridgeCodec.decodeEvent(try Contract.text("error-signed-out")),
            .accepted(.error(code: .notSignedIn, message: "Sign in to see this content", requestId: "n4"))
        )
        XCTAssertEqual(
            BridgeCodec.decodeEvent(try Contract.text("error-global")),
            .accepted(.error(code: .network, message: "Offline", requestId: nil))
        )
        if case .accepted = BridgeCodec.decodeEvent(#"{"v":1,"type":"error","code":"network","message":"x"}"#) {
            XCTFail("an error without requestId must be rejected")
        }
    }

    func testToleratesUnknownFields() {
        XCTAssertEqual(BridgeCodec.decodeEvent(#"{"v":1,"type":"ack","requestId":"n1","extra":{"a":1}}"#), .accepted(.ack(requestId: "n1")))
    }

    func testRejectsInvalidMessages() throws {
        let rejected = [
            #"{"v":2,"type":"ack","requestId":"n1"}"#,
            #"{"v":1,"type":"teleport"}"#,
            #"{"v":1,"requestId":"n1"}"#,
            "not json",
            #"{"v":1,"type":"ack"}"#,
            #"{"v":1,"type":"ack","requestId":""}"#,
            #"{"v":1,"type":"ack","requestId":"\#(String(repeating: "x", count: 65))"}"#,
        ]
        for raw in rejected {
            if case .accepted = BridgeCodec.decodeEvent(raw) {
                XCTFail("accepted \(raw)")
            }
        }
        let base = try Contract.text("state-playing")
        let mutations = [
            base.replacingOccurrences(of: "\"durationSec\": 213", with: "\"durationSec\": -1"),
            base.replacingOccurrences(of: "\"volume\": 0.8", with: "\"volume\": 1.5"),
            base.replacingOccurrences(of: "https://lh3", with: "http://lh3"),
            base.replacingOccurrences(of: "\"likeStatus\": \"LIKE\"", with: "\"likeStatus\": \"LOVE\""),
            base.replacingOccurrences(of: "\"isAd\": false,", with: ""),
        ]
        for raw in mutations {
            XCTAssertNotEqual(raw, base)
            if case .accepted = BridgeCodec.decodeEvent(raw) {
                XCTFail("accepted a mutated state")
            }
        }
    }

    func testEncodesCommands() throws {
        let seek = try BridgeCodec.encode(.seekTo(seconds: 12.5), requestId: "n9")
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: Data(seek.utf8)) as? [String: Any])
        XCTAssertEqual(object["v"] as? Int, 1)
        XCTAssertEqual(object["type"] as? String, "seekTo")
        XCTAssertEqual(object["requestId"] as? String, "n9")
        XCTAssertEqual(object["seconds"] as? Double, 12.5)
        let play = try BridgeCodec.encode(.playVideoId(videoId: "lYBUbBu4W08", playlistId: nil), requestId: "n1")
        XCTAssertTrue(play.contains(#""playlistId":null"#))
        XCTAssertTrue(try BridgeCodec.encode(.search(query: "x", filter: .songs), requestId: "n2").contains(#""filter":"songs""#))
        XCTAssertTrue(try BridgeCodec.encode(.setRepeat(.one), requestId: "n3").contains(#""mode":"ONE""#))
        XCTAssertTrue(try BridgeCodec.encode(.loadContinuation(token: "t", kind: .search, nodeId: "s"), requestId: "n4").contains(#""kind":"search""#))
    }

    func testRefusesInvalidCommands() {
        XCTAssertNotNil(BridgeCodec.problem(with: .setVolume(2), requestId: "n1"))
        XCTAssertNotNil(BridgeCodec.problem(with: .seekTo(seconds: .nan), requestId: "n1"))
        XCTAssertNotNil(BridgeCodec.problem(with: .playVideoId(videoId: "<script>", playlistId: nil), requestId: "n1"))
        XCTAssertNotNil(BridgeCodec.problem(with: .playVideoId(videoId: "", playlistId: nil), requestId: "n1"))
        XCTAssertNil(BridgeCodec.problem(with: .playVideoId(videoId: "", playlistId: "OLAK5uy_abc"), requestId: "n1"))
        XCTAssertNotNil(BridgeCodec.problem(with: .playVideoId(videoId: "lYBUbBu4W08", playlistId: "bad list"), requestId: "n1"))
        XCTAssertNotNil(BridgeCodec.problem(with: .search(query: "  ", filter: .all), requestId: "n1"))
        XCTAssertNotNil(BridgeCodec.problem(with: .playQueueIndex(-1), requestId: "n1"))
        XCTAssertNotNil(BridgeCodec.problem(with: .play, requestId: ""))
        XCTAssertThrowsError(try BridgeCodec.encode(.setVolume(3), requestId: "n1"))
    }
}

final class CommandQueueTests: XCTestCase {
    actor Recorder {
        var sent: [String] = []
        var accept = true

        func record(_ json: String) -> Bool {
            sent.append(json)
            return accept
        }

        func refuse() {
            accept = false
        }

        func requestId(at index: Int) -> String? {
            guard sent.indices.contains(index),
                  let object = try? JSONSerialization.jsonObject(with: Data(sent[index].utf8)) as? [String: Any] else {
                return nil
            }
            return object["requestId"] as? String
        }

        var count: Int { sent.count }
    }

    private func waitFor(_ condition: @escaping () async -> Bool) async throws {
        for _ in 0..<200 {
            if await condition() {
                return
            }
            try await Task.sleep(for: .milliseconds(5))
        }
        XCTFail("condition never became true")
    }

    func testWaitsForTheReadyGate() async throws {
        let recorder = Recorder()
        let queue = CommandQueue { await recorder.record($0) }
        let result = Task { await queue.send(.play) }
        try await Task.sleep(for: .milliseconds(30))
        let before = await recorder.count
        XCTAssertEqual(before, 0)
        await queue.markReady()
        try await waitFor { await recorder.count == 1 }
        let idRaw = await recorder.requestId(at: 0)
        let id = try XCTUnwrap(idRaw)
        let handled = await queue.handle(.ack(requestId: id))
        XCTAssertTrue(handled)
        let outcome = await result.value
        XCTAssertEqual(outcome, .acknowledged)
    }

    func testNotReadyAfterTheReadyTimeout() async {
        let queue = CommandQueue(readyTimeout: .milliseconds(50)) { _ in true }
        let outcome = await queue.send(.pause)
        XCTAssertEqual(outcome, .notReady)
    }

    func testTimesOutWithoutAnAck() async {
        let queue = CommandQueue(timeout: .milliseconds(60)) { _ in true }
        await queue.markReady()
        let outcome = await queue.send(.next)
        XCTAssertEqual(outcome, .timedOut)
        let pending = await queue.pendingCount
        XCTAssertEqual(pending, 0)
    }

    func testSerializesWithinALaneButNotAcrossLanes() async throws {
        let recorder = Recorder()
        let queue = CommandQueue { await recorder.record($0) }
        await queue.markReady()
        let first = Task { await queue.send(.play) }
        try await waitFor { await recorder.count == 1 }
        let second = Task { await queue.send(.pause) }
        let browse = Task { await queue.send(.browse(nodeId: "home")) }
        try await waitFor { await recorder.count == 2 }
        try await Task.sleep(for: .milliseconds(30))
        let sentSoFar = await recorder.sent
        XCTAssertEqual(sentSoFar.count, 2)
        XCTAssertTrue(sentSoFar[1].contains(#""type":"browse""#))
        let playIdRaw = await recorder.requestId(at: 0)
        let playId = try XCTUnwrap(playIdRaw)
        await queue.handle(.ack(requestId: playId))
        try await waitFor { await recorder.count == 3 }
        let pauseIdRaw = await recorder.requestId(at: 2)
        let pauseId = try XCTUnwrap(pauseIdRaw)
        await queue.handle(.ack(requestId: pauseId))
        let browseIdRaw = await recorder.requestId(at: 1)
        let browseId = try XCTUnwrap(browseIdRaw)
        let page = BrowsePage(nodeId: "home", title: "Home")
        await queue.handle(.browseResult(requestId: browseId, page: page))
        let outcomes = await [first.value, second.value, browse.value]
        XCTAssertEqual(outcomes, [.acknowledged, .acknowledged, .page(page)])
    }

    func testMapsErrorsAndIgnoresUnscopedEvents() async throws {
        let recorder = Recorder()
        let queue = CommandQueue { await recorder.record($0) }
        await queue.markReady()
        let result = Task { await queue.send(.browse(nodeId: "playlists")) }
        try await waitFor { await recorder.count == 1 }
        let idRaw = await recorder.requestId(at: 0)
        let id = try XCTUnwrap(idRaw)
        let unscoped = await queue.handle(.error(code: .network, message: "x", requestId: nil))
        XCTAssertFalse(unscoped)
        await queue.handle(.error(code: .notSignedIn, message: "Sign in", requestId: id))
        let outcome = await result.value
        XCTAssertEqual(outcome, .failed(code: .notSignedIn, message: "Sign in"))
        let unknown = await queue.handle(.ack(requestId: "missing"))
        XCTAssertFalse(unknown)
    }

    func testFailsPendingCommandsWhenThePageGoesAway() async throws {
        let recorder = Recorder()
        let queue = CommandQueue { await recorder.record($0) }
        await queue.markReady()
        let result = Task { await queue.send(.play) }
        try await waitFor { await recorder.count == 1 }
        await queue.markNotReady()
        let outcome = await result.value
        XCTAssertEqual(outcome, .notReady)
    }

    func testRefusedTransportAndInvalidCommands() async {
        let recorder = Recorder()
        let queue = CommandQueue { await recorder.record($0) }
        await queue.markReady()
        let invalid = await queue.send(.setVolume(4))
        guard case .failed(code: .invalidCommand, _) = invalid else {
            return XCTFail("expected invalid command, got \(invalid)")
        }
        let sent = await recorder.count
        XCTAssertEqual(sent, 0)
        await recorder.refuse()
        let refused = await queue.send(.play)
        XCTAssertEqual(refused, .notReady)
    }
}
