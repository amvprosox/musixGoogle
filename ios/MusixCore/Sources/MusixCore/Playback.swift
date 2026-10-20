import Foundation

public struct TrackSpec: Equatable, Sendable {
    public var uid: String
    public var mediaId: String
    public var videoId: String
    public var title: String
    public var artist: String
    public var album: String
    public var artworkUrl: String
    public var durationSec: Double?
    public var isAd: Bool
}

public struct TimelineSpec: Equatable, Sendable {
    public var tracks: [TrackSpec]
    public var currentIndex: Int

    public static let empty = TimelineSpec(tracks: [], currentIndex: 0)

    public var current: TrackSpec? {
        tracks.indices.contains(currentIndex) ? tracks[currentIndex] : nil
    }

    public var hasPrevious: Bool { currentIndex > 0 }

    public var hasNext: Bool { currentIndex + 1 < tracks.count }
}

public enum SeekAction: Equatable, Sendable {
    case seekWithinTrack(seconds: Double)
    case nextTrack
    case previousTrack
}

public struct NowPlayingInfo: Equatable, Sendable {
    public var title: String
    public var artist: String
    public var album: String
    public var artworkUrl: String
    public var durationSec: Double?
    public var elapsedSec: Double
    public var rate: Double
    public var isLiveLike: Bool
    public var queueIndex: Int
    public var queueCount: Int
}

public struct RemoteAvailability: Equatable, Sendable {
    public var playPause: Bool
    public var next: Bool
    public var previous: Bool
    public var seek: Bool
    public var like: Bool
    public var shuffle: Bool
    public var repeatMode: Bool
}

public enum PlaybackModel {
    public static let loadingTitle = "Loading"
    public static let previousRestartThreshold: Double = 3

    public static func timeline(state: BridgeState, queue: [QueueEntry]) -> TimelineSpec {
        let playlistId = state.playlistId.isEmpty ? nil : state.playlistId
        let ordered = queue.sorted { $0.index < $1.index }
        guard !ordered.isEmpty else {
            guard state.hasTrack else {
                return .empty
            }
            return TimelineSpec(tracks: [fromState(state, uid: "s0-\(state.videoId)", playlistId: playlistId)], currentIndex: 0)
        }
        var currentIndex = ordered.firstIndex { $0.isCurrent }
        if currentIndex == nil, !state.videoId.isEmpty {
            currentIndex = ordered.firstIndex { $0.videoId == state.videoId }
        }
        guard let resolved = currentIndex ?? (state.hasTrack ? nil : 0) else {
            return TimelineSpec(tracks: [fromState(state, uid: "s0-\(state.videoId)", playlistId: playlistId)], currentIndex: 0)
        }
        let tracks = ordered.enumerated().map { position, entry -> TrackSpec in
            let base = TrackSpec(
                uid: "q\(position)-\(entry.videoId)",
                mediaId: MediaIds.track(entry.videoId.isEmpty ? "unknown" : entry.videoId, playlistId: playlistId),
                videoId: entry.videoId,
                title: entry.title,
                artist: entry.artist,
                album: "",
                artworkUrl: entry.artworkUrl,
                durationSec: entry.durationSec > 0 ? entry.durationSec : nil,
                isAd: false
            )
            if position == resolved, state.hasTrack, state.videoId == entry.videoId || state.isAd {
                return merge(base, state)
            }
            return base
        }
        return TimelineSpec(tracks: tracks, currentIndex: resolved)
    }

    public static func position(_ state: BridgeState) -> Double {
        state.isAd ? 0 : max(0, state.positionSec)
    }

    public static func previousAction(positionSec: Double) -> SeekAction {
        positionSec > previousRestartThreshold ? .seekWithinTrack(seconds: 0) : .previousTrack
    }

    public static func nowPlaying(state: BridgeState, timeline: TimelineSpec) -> NowPlayingInfo? {
        guard let current = timeline.current else {
            return nil
        }
        let moving = state.isPlaying && !state.isBuffering && !state.isAd
        return NowPlayingInfo(
            title: current.title,
            artist: current.artist,
            album: current.album,
            artworkUrl: current.artworkUrl,
            durationSec: current.durationSec,
            elapsedSec: position(state),
            rate: moving ? 1 : 0,
            isLiveLike: current.isAd,
            queueIndex: timeline.currentIndex,
            queueCount: timeline.tracks.count
        )
    }

    public static func availability(state: BridgeState, timeline: TimelineSpec, signedIn: Bool) -> RemoteAvailability {
        let active = timeline.current != nil && !state.isAd
        return RemoteAvailability(
            playPause: timeline.current != nil,
            next: active,
            previous: active,
            seek: active && (timeline.current?.durationSec ?? 0) > 0,
            like: active && signedIn,
            shuffle: active,
            repeatMode: active
        )
    }

    private static func fromState(_ state: BridgeState, uid: String, playlistId: String?) -> TrackSpec {
        merge(
            TrackSpec(
                uid: uid,
                mediaId: MediaIds.track(state.videoId.isEmpty ? "unknown" : state.videoId, playlistId: playlistId),
                videoId: state.videoId,
                title: state.title,
                artist: state.artist,
                album: state.album,
                artworkUrl: state.artworkUrl,
                durationSec: nil,
                isAd: false
            ),
            state
        )
    }

    private static func merge(_ base: TrackSpec, _ state: BridgeState) -> TrackSpec {
        var track = base
        if state.isAd {
            track.title = loadingTitle
            track.artist = ""
            track.album = ""
            track.artworkUrl = ""
            track.durationSec = nil
            track.isAd = true
            return track
        }
        if !state.title.isEmpty { track.title = state.title }
        if !state.artist.isEmpty { track.artist = state.artist }
        track.album = state.album
        if !state.artworkUrl.isEmpty { track.artworkUrl = state.artworkUrl }
        if state.durationSec > 0 { track.durationSec = state.durationSec }
        return track
    }
}

public enum InterruptionAction: Equatable, Sendable {
    case pause
    case resume
    case nothing
}

public struct InterruptionPolicy: Sendable {
    public private(set) var resumeAfterInterruption = false

    public init() {}

    public mutating func began(wasPlaying: Bool) -> InterruptionAction {
        resumeAfterInterruption = wasPlaying
        return wasPlaying ? .pause : .nothing
    }

    public mutating func ended(shouldResume: Bool) -> InterruptionAction {
        defer { resumeAfterInterruption = false }
        return resumeAfterInterruption && shouldResume ? .resume : .nothing
    }

    public mutating func userPaused() {
        resumeAfterInterruption = false
    }

    public mutating func routeLost(wasPlaying: Bool) -> InterruptionAction {
        resumeAfterInterruption = false
        return wasPlaying ? .pause : .nothing
    }
}

public struct ResumeSnapshot: Codable, Equatable, Sendable {
    public var videoId: String
    public var playlistId: String?
    public var title: String
    public var artist: String
    public var album: String
    public var artworkUrl: String
    public var positionSec: Double
    public var durationSec: Double
    public var savedAt: Date

    private static let endMargin: Double = 5

    public static func from(_ state: BridgeState, now: Date) -> ResumeSnapshot? {
        guard !state.isAd, BridgeCodec.isValidVideoId(state.videoId),
              !state.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        let nearEnd = state.durationSec > 0 && state.positionSec >= state.durationSec - endMargin
        return ResumeSnapshot(
            videoId: state.videoId,
            playlistId: BridgeCodec.isValidPlaylistId(state.playlistId) ? state.playlistId : nil,
            title: state.title,
            artist: state.artist,
            album: state.album,
            artworkUrl: state.artworkUrl,
            positionSec: nearEnd ? 0 : max(0, state.positionSec),
            durationSec: state.durationSec,
            savedAt: now
        )
    }

    public static func decode(_ data: Data?) -> ResumeSnapshot? {
        guard let data, let snapshot = try? JSONDecoder().decode(ResumeSnapshot.self, from: data),
              BridgeCodec.isValidVideoId(snapshot.videoId), snapshot.positionSec.isFinite else {
            return nil
        }
        return snapshot
    }

    public func encoded() -> Data? {
        try? JSONEncoder().encode(self)
    }
}
