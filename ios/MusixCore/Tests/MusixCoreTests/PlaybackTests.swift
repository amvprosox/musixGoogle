import Foundation
import XCTest
@testable import MusixCore

final class PlaybackModelTests: XCTestCase {
    private let playing = BridgeState(
        videoId: "bbbbbbbbbbb",
        playlistId: "RDAMVMbbbbbbbbbbb",
        title: "Second",
        artist: "Artist B",
        album: "Album B",
        artworkUrl: "https://lh3.googleusercontent.com/b",
        durationSec: 200,
        positionSec: 12,
        bufferedSec: 40,
        isPlaying: true
    )

    private let queue = [
        QueueEntry(index: 2, videoId: "ccccccccccc", title: "Third", artist: "Artist C", artworkUrl: "https://i.ytimg.com/c", durationSec: 100, isCurrent: false),
        QueueEntry(index: 0, videoId: "aaaaaaaaaaa", title: "First", artist: "Artist A", artworkUrl: "https://i.ytimg.com/a", durationSec: 150, isCurrent: false),
        QueueEntry(index: 1, videoId: "bbbbbbbbbbb", title: "Second", artist: "Artist B", artworkUrl: "https://i.ytimg.com/b", durationSec: 200, isCurrent: true),
    ]

    func testBuildsTheTimelineInQueueOrder() throws {
        let timeline = PlaybackModel.timeline(state: playing, queue: queue)
        XCTAssertEqual(timeline.tracks.map(\.title), ["First", "Second", "Third"])
        XCTAssertEqual(timeline.currentIndex, 1)
        let current = try XCTUnwrap(timeline.current)
        XCTAssertEqual(current.album, "Album B")
        XCTAssertEqual(current.artworkUrl, "https://lh3.googleusercontent.com/b")
        XCTAssertEqual(MediaIds.parse(current.mediaId), .track(videoId: "bbbbbbbbbbb", playlistId: "RDAMVMbbbbbbbbbbb"))
        XCTAssertTrue(timeline.hasNext)
        XCTAssertTrue(timeline.hasPrevious)
        XCTAssertEqual(Set(timeline.tracks.map(\.uid)).count, 3)
    }

    func testFallsBackToTheCurrentTrack() {
        var other = playing
        other.videoId = "zzzzzzzzzzz"
        let detached = PlaybackModel.timeline(state: other, queue: queue.map { var entry = $0; entry.isCurrent = false; return entry })
        XCTAssertEqual(detached.tracks.count, 1)
        XCTAssertEqual(detached.current?.videoId, "zzzzzzzzzzz")
        XCTAssertEqual(PlaybackModel.timeline(state: playing, queue: []).tracks.count, 1)
        XCTAssertEqual(PlaybackModel.timeline(state: .empty, queue: []), .empty)
    }

    func testShowsAdsAsLoading() throws {
        var ad = playing
        ad.isAd = true
        ad.title = "Buy things"
        let timeline = PlaybackModel.timeline(state: ad, queue: queue)
        let current = try XCTUnwrap(timeline.current)
        XCTAssertEqual(current.title, PlaybackModel.loadingTitle)
        XCTAssertEqual(current.artist, "")
        XCTAssertEqual(current.artworkUrl, "")
        XCTAssertTrue(current.isAd)
        XCTAssertEqual(PlaybackModel.position(ad), 0)
        let info = try XCTUnwrap(PlaybackModel.nowPlaying(state: ad, timeline: timeline))
        XCTAssertEqual(info.rate, 0)
        XCTAssertTrue(info.isLiveLike)
        let availability = PlaybackModel.availability(state: ad, timeline: timeline, signedIn: true)
        XCTAssertTrue(availability.playPause)
        XCTAssertFalse(availability.next)
        XCTAssertFalse(availability.seek)
    }

    func testNowPlayingAndRemoteAvailability() throws {
        let timeline = PlaybackModel.timeline(state: playing, queue: queue)
        let info = try XCTUnwrap(PlaybackModel.nowPlaying(state: playing, timeline: timeline))
        XCTAssertEqual(info.title, "Second")
        XCTAssertEqual(info.durationSec, 200)
        XCTAssertEqual(info.elapsedSec, 12)
        XCTAssertEqual(info.rate, 1)
        XCTAssertEqual(info.queueIndex, 1)
        XCTAssertEqual(info.queueCount, 3)
        XCTAssertNil(PlaybackModel.nowPlaying(state: .empty, timeline: .empty))
        let signedOut = PlaybackModel.availability(state: playing, timeline: timeline, signedIn: false)
        XCTAssertFalse(signedOut.like)
        XCTAssertTrue(signedOut.seek)
    }

    func testPreviousRestartsAfterThreeSeconds() {
        XCTAssertEqual(PlaybackModel.previousAction(positionSec: 3.01), .seekWithinTrack(seconds: 0))
        XCTAssertEqual(PlaybackModel.previousAction(positionSec: 3), .previousTrack)
        XCTAssertEqual(PlaybackModel.previousAction(positionSec: 0), .previousTrack)
    }

    func testRepeatCycles() {
        XCTAssertEqual(RepeatMode.none.next, .all)
        XCTAssertEqual(RepeatMode.all.next, .one)
        XCTAssertEqual(RepeatMode.one.next, .none)
    }
}

final class InterruptionPolicyTests: XCTestCase {
    func testResumesOnlyWhenPlayingAndAllowed() {
        var policy = InterruptionPolicy()
        XCTAssertEqual(policy.began(wasPlaying: true), .pause)
        XCTAssertEqual(policy.ended(shouldResume: true), .resume)
        XCTAssertEqual(policy.began(wasPlaying: true), .pause)
        XCTAssertEqual(policy.ended(shouldResume: false), .nothing)
        XCTAssertEqual(policy.began(wasPlaying: false), .nothing)
        XCTAssertEqual(policy.ended(shouldResume: true), .nothing)
    }

    func testUserPauseAndRouteLossCancelTheResume() {
        var policy = InterruptionPolicy()
        _ = policy.began(wasPlaying: true)
        policy.userPaused()
        XCTAssertEqual(policy.ended(shouldResume: true), .nothing)
        _ = policy.began(wasPlaying: true)
        XCTAssertEqual(policy.routeLost(wasPlaying: false), .nothing)
        XCTAssertEqual(policy.ended(shouldResume: true), .nothing)
        XCTAssertEqual(policy.routeLost(wasPlaying: true), .pause)
    }
}

final class ResumeSnapshotTests: XCTestCase {
    private let state = BridgeState(
        videoId: "lYBUbBu4W08",
        playlistId: "RDAMVMlYBUbBu4W08",
        title: "Never Gonna Give You Up",
        artist: "Rick Astley",
        durationSec: 213,
        positionSec: 61.25
    )

    func testRoundTrips() throws {
        let snapshot = try XCTUnwrap(ResumeSnapshot.from(state, now: Date(timeIntervalSince1970: 42)))
        let restored = ResumeSnapshot.decode(snapshot.encoded())
        XCTAssertEqual(restored, snapshot)
        XCTAssertEqual(restored?.playlistId, "RDAMVMlYBUbBu4W08")
    }

    func testSkipsAdsInvalidIdsAndRestartsNearlyFinishedTracks() {
        var ad = state
        ad.isAd = true
        XCTAssertNil(ResumeSnapshot.from(ad, now: Date()))
        XCTAssertNil(ResumeSnapshot.from(.empty, now: Date()))
        var bad = state
        bad.videoId = "bad id"
        XCTAssertNil(ResumeSnapshot.from(bad, now: Date()))
        var ending = state
        ending.positionSec = 210
        XCTAssertEqual(ResumeSnapshot.from(ending, now: Date())?.positionSec, 0)
        XCTAssertNil(ResumeSnapshot.decode(Data("{".utf8)))
        XCTAssertNil(ResumeSnapshot.decode(nil))
    }
}
