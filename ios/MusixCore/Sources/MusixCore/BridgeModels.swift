import Foundation

public let bridgeVersion = 1

public enum LikeStatus: String, Codable, Sendable {
    case like = "LIKE"
    case dislike = "DISLIKE"
    case indifferent = "INDIFFERENT"
}

public enum RepeatMode: String, Codable, Sendable {
    case none = "NONE"
    case all = "ALL"
    case one = "ONE"

    public var next: RepeatMode {
        switch self {
        case .none: return .all
        case .all: return .one
        case .one: return .none
        }
    }
}

public enum ItemType: String, Codable, Sendable {
    case song, video, album, playlist, artist, shelf
}

public enum SearchFilter: String, Codable, Sendable {
    case all, songs, videos, albums, playlists, artists
}

public enum BridgePlatform: String, Codable, Sendable {
    case electron, android, ios, none
}

public enum BridgeErrorCode: String, Codable, Sendable {
    case notReady = "not_ready"
    case notSignedIn = "not_signed_in"
    case network
    case http
    case parse
    case invalidCommand = "invalid_command"
    case unsupported
    case elementMissing = "element_missing"
}

public enum ContinuationKind: String, Codable, Sendable {
    case browse, search
}

public struct BridgeState: Codable, Equatable, Sendable {
    public var videoId: String
    public var playlistId: String
    public var title: String
    public var artist: String
    public var album: String
    public var artworkUrl: String
    public var durationSec: Double
    public var positionSec: Double
    public var bufferedSec: Double
    public var isPlaying: Bool
    public var isBuffering: Bool
    public var volume: Double
    public var isMuted: Bool
    public var likeStatus: LikeStatus
    public var shuffle: Bool
    public var repeatMode: RepeatMode
    public var isAd: Bool
    public var isSignedIn: Bool

    public init(
        videoId: String = "",
        playlistId: String = "",
        title: String = "",
        artist: String = "",
        album: String = "",
        artworkUrl: String = "",
        durationSec: Double = 0,
        positionSec: Double = 0,
        bufferedSec: Double = 0,
        isPlaying: Bool = false,
        isBuffering: Bool = false,
        volume: Double = 1,
        isMuted: Bool = false,
        likeStatus: LikeStatus = .indifferent,
        shuffle: Bool = false,
        repeatMode: RepeatMode = .none,
        isAd: Bool = false,
        isSignedIn: Bool = false
    ) {
        self.videoId = videoId
        self.playlistId = playlistId
        self.title = title
        self.artist = artist
        self.album = album
        self.artworkUrl = artworkUrl
        self.durationSec = durationSec
        self.positionSec = positionSec
        self.bufferedSec = bufferedSec
        self.isPlaying = isPlaying
        self.isBuffering = isBuffering
        self.volume = volume
        self.isMuted = isMuted
        self.likeStatus = likeStatus
        self.shuffle = shuffle
        self.repeatMode = repeatMode
        self.isAd = isAd
        self.isSignedIn = isSignedIn
    }

    public static let empty = BridgeState()

    public var hasTrack: Bool { !videoId.isEmpty || !title.isEmpty }
}

public struct QueueEntry: Codable, Equatable, Sendable {
    public var index: Int
    public var videoId: String
    public var title: String
    public var artist: String
    public var artworkUrl: String
    public var durationSec: Double
    public var isCurrent: Bool

    public init(index: Int, videoId: String, title: String, artist: String, artworkUrl: String, durationSec: Double, isCurrent: Bool) {
        self.index = index
        self.videoId = videoId
        self.title = title
        self.artist = artist
        self.artworkUrl = artworkUrl
        self.durationSec = durationSec
        self.isCurrent = isCurrent
    }
}

public struct FlatItem: Codable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var subtitle: String
    public var artworkUrl: String
    public var type: ItemType
    public var playable: Bool
    public var browsable: Bool
    public var videoId: String?
    public var playlistId: String?
    public var browseId: String?
    public var durationSec: Double?
    public var continuation: String?

    public init(
        id: String,
        title: String,
        subtitle: String = "",
        artworkUrl: String = "",
        type: ItemType,
        playable: Bool,
        browsable: Bool,
        videoId: String? = nil,
        playlistId: String? = nil,
        browseId: String? = nil,
        durationSec: Double? = nil,
        continuation: String? = nil
    ) {
        self.id = id
        self.title = title
        self.subtitle = subtitle
        self.artworkUrl = artworkUrl
        self.type = type
        self.playable = playable
        self.browsable = browsable
        self.videoId = videoId
        self.playlistId = playlistId
        self.browseId = browseId
        self.durationSec = durationSec
        self.continuation = continuation
    }
}

public struct FlatSection: Codable, Equatable, Sendable {
    public var id: String
    public var title: String
    public var browseId: String?
    public var items: [FlatItem]

    public init(id: String, title: String, browseId: String? = nil, items: [FlatItem]) {
        self.id = id
        self.title = title
        self.browseId = browseId
        self.items = items
    }
}

public struct BrowsePage: Codable, Equatable, Sendable {
    public var nodeId: String
    public var title: String
    public var sections: [FlatSection]
    public var items: [FlatItem]
    public var continuation: String?

    public init(nodeId: String, title: String, sections: [FlatSection] = [], items: [FlatItem] = [], continuation: String? = nil) {
        self.nodeId = nodeId
        self.title = title
        self.sections = sections
        self.items = items
        self.continuation = continuation
    }
}

public struct LyricLine: Codable, Equatable, Sendable {
    public var timeMs: Double
    public var text: String

    public init(timeMs: Double, text: String) {
        self.timeMs = timeMs
        self.text = text
    }
}

public struct Lyrics: Codable, Equatable, Sendable {
    public var videoId: String
    public var source: String
    public var synced: Bool
    public var instrumental: Bool
    public var lines: [LyricLine]

    public init(videoId: String, source: String, synced: Bool, instrumental: Bool, lines: [LyricLine]) {
        self.videoId = videoId
        self.source = source
        self.synced = synced
        self.instrumental = instrumental
        self.lines = lines
    }

    public func activeIndex(positionMs: Double) -> Int? {
        guard synced else {
            return nil
        }
        var low = 0
        var high = lines.count - 1
        var found: Int?
        while low <= high {
            let mid = (low + high) / 2
            if lines[mid].timeMs <= positionMs {
                found = mid
                low = mid + 1
            } else {
                high = mid - 1
            }
        }
        return found
    }
}

public struct SearchSuggestions: Codable, Equatable, Sendable {
    public var query: String
    public var queries: [String]
    public var items: [FlatItem]

    public init(query: String, queries: [String], items: [FlatItem]) {
        self.query = query
        self.queries = queries
        self.items = items
    }

    public static let empty = SearchSuggestions(query: "", queries: [], items: [])

    public var isEmpty: Bool { queries.isEmpty && items.isEmpty }
}
