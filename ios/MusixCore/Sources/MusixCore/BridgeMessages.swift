import Foundation

public enum BridgeEvent: Equatable, Sendable {
    case ready(platform: BridgePlatform, clientVersion: String)
    case state(BridgeState)
    case queue([QueueEntry])
    case browseResult(requestId: String, page: BrowsePage)
    case searchResult(requestId: String, query: String, page: BrowsePage)
    case signedIn(avatarUrl: String)
    case signedOut
    case adStart
    case adEnd
    case ack(requestId: String)
    case lyricsResult(requestId: String, lyrics: Lyrics?)
    case suggestResult(requestId: String, suggestions: SearchSuggestions)
    case error(code: BridgeErrorCode, message: String, requestId: String?)
}

extension BridgeEvent: Decodable {
    private enum Keys: String, CodingKey {
        case v, type, platform, clientVersion, state, items, requestId, page, query, avatarUrl, code, message, lyrics, suggestions
    }

    public init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: Keys.self)
        let version = try container.decode(Int.self, forKey: .v)
        guard version == bridgeVersion else {
            throw BridgeDecodeError.unsupportedVersion(version)
        }
        let type = try container.decode(String.self, forKey: .type)
        switch type {
        case "ready":
            self = .ready(
                platform: try container.decode(BridgePlatform.self, forKey: .platform),
                clientVersion: try container.decode(String.self, forKey: .clientVersion)
            )
        case "state":
            self = .state(try container.decode(BridgeState.self, forKey: .state))
        case "queue":
            self = .queue(try container.decode([QueueEntry].self, forKey: .items))
        case "browseResult":
            self = .browseResult(
                requestId: try container.decode(String.self, forKey: .requestId),
                page: try container.decode(BrowsePage.self, forKey: .page)
            )
        case "searchResult":
            self = .searchResult(
                requestId: try container.decode(String.self, forKey: .requestId),
                query: try container.decode(String.self, forKey: .query),
                page: try container.decode(BrowsePage.self, forKey: .page)
            )
        case "signedIn":
            self = .signedIn(avatarUrl: try container.decode(String.self, forKey: .avatarUrl))
        case "signedOut":
            self = .signedOut
        case "adStart":
            self = .adStart
        case "adEnd":
            self = .adEnd
        case "ack":
            self = .ack(requestId: try container.decode(String.self, forKey: .requestId))
        case "lyricsResult":
            guard container.contains(.lyrics) else {
                throw BridgeDecodeError.missingField("lyrics")
            }
            self = .lyricsResult(
                requestId: try container.decode(String.self, forKey: .requestId),
                lyrics: try container.decode(Lyrics?.self, forKey: .lyrics)
            )
        case "suggestResult":
            self = .suggestResult(
                requestId: try container.decode(String.self, forKey: .requestId),
                suggestions: try container.decode(SearchSuggestions.self, forKey: .suggestions)
            )
        case "error":
            guard container.contains(.requestId) else {
                throw BridgeDecodeError.missingField("requestId")
            }
            self = .error(
                code: try container.decode(BridgeErrorCode.self, forKey: .code),
                message: try container.decode(String.self, forKey: .message),
                requestId: try container.decode(String?.self, forKey: .requestId)
            )
        default:
            throw BridgeDecodeError.unknownType(type)
        }
    }
}

public enum BridgeDecodeError: Error, Equatable {
    case unsupportedVersion(Int)
    case unknownType(String)
    case missingField(String)
}

public enum BridgeCommand: Equatable, Sendable {
    case play
    case pause
    case togglePlay
    case next
    case previous
    case seekTo(seconds: Double)
    case setVolume(Double)
    case toggleMute
    case toggleLike
    case toggleDislike
    case setShuffle(Bool)
    case setRepeat(RepeatMode)
    case playVideoId(videoId: String, playlistId: String?)
    case playQueueIndex(Int)
    case browse(nodeId: String)
    case search(query: String, filter: SearchFilter)
    case loadContinuation(token: String, kind: ContinuationKind, nodeId: String)
    case configure(adSkip: Bool)
    case duck(level: Double)
    case playlistTargets(videoId: String)
    case addToPlaylist(videoId: String, playlistId: String)
    case savePlaylist(playlistId: String, save: Bool)
    case lyrics(videoId: String, title: String, artist: String, album: String, durationSec: Double)
    case suggest(query: String)

    public var typeName: String {
        switch self {
        case .play: return "play"
        case .pause: return "pause"
        case .togglePlay: return "togglePlay"
        case .next: return "next"
        case .previous: return "previous"
        case .seekTo: return "seekTo"
        case .setVolume: return "setVolume"
        case .toggleMute: return "toggleMute"
        case .toggleLike: return "toggleLike"
        case .toggleDislike: return "toggleDislike"
        case .setShuffle: return "setShuffle"
        case .setRepeat: return "setRepeat"
        case .playVideoId: return "playVideoId"
        case .playQueueIndex: return "playQueueIndex"
        case .browse: return "browse"
        case .search: return "search"
        case .loadContinuation: return "loadContinuation"
        case .configure: return "configure"
        case .duck: return "duck"
        case .playlistTargets: return "playlistTargets"
        case .addToPlaylist: return "addToPlaylist"
        case .savePlaylist: return "savePlaylist"
        case .lyrics: return "lyrics"
        case .suggest: return "suggest"
        }
    }

    public var lane: CommandLane {
        switch self {
        case .browse, .search, .loadContinuation, .playlistTargets, .addToPlaylist, .savePlaylist, .lyrics, .suggest: return .data
        default: return .player
        }
    }
}

public struct CommandEnvelope: Encodable, Sendable {
    public let requestId: String
    public let command: BridgeCommand

    private enum Keys: String, CodingKey {
        case v, type, requestId, seconds, volume, enabled, mode, videoId, playlistId, index, nodeId, query, filter, token, kind, adSkip, level, save
        case title, artist, album, durationSec
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: Keys.self)
        try container.encode(bridgeVersion, forKey: .v)
        try container.encode(command.typeName, forKey: .type)
        try container.encode(requestId, forKey: .requestId)
        switch command {
        case .play, .pause, .togglePlay, .next, .previous, .toggleMute, .toggleLike, .toggleDislike:
            break
        case let .seekTo(seconds):
            try container.encode(seconds, forKey: .seconds)
        case let .setVolume(volume):
            try container.encode(volume, forKey: .volume)
        case let .setShuffle(enabled):
            try container.encode(enabled, forKey: .enabled)
        case let .setRepeat(mode):
            try container.encode(mode, forKey: .mode)
        case let .playVideoId(videoId, playlistId):
            try container.encode(videoId, forKey: .videoId)
            if let playlistId {
                try container.encode(playlistId, forKey: .playlistId)
            } else {
                try container.encodeNil(forKey: .playlistId)
            }
        case let .playQueueIndex(index):
            try container.encode(index, forKey: .index)
        case let .browse(nodeId):
            try container.encode(nodeId, forKey: .nodeId)
        case let .search(query, filter):
            try container.encode(query, forKey: .query)
            try container.encode(filter, forKey: .filter)
        case let .loadContinuation(token, kind, nodeId):
            try container.encode(token, forKey: .token)
            try container.encode(kind, forKey: .kind)
            try container.encode(nodeId, forKey: .nodeId)
        case let .configure(adSkip):
            try container.encode(adSkip, forKey: .adSkip)
        case let .duck(level):
            try container.encode(level, forKey: .level)
        case let .playlistTargets(videoId):
            try container.encode(videoId, forKey: .videoId)
        case let .addToPlaylist(videoId, playlistId):
            try container.encode(videoId, forKey: .videoId)
            try container.encode(playlistId, forKey: .playlistId)
        case let .savePlaylist(playlistId, save):
            try container.encode(playlistId, forKey: .playlistId)
            try container.encode(save, forKey: .save)
        case let .lyrics(videoId, title, artist, album, durationSec):
            try container.encode(videoId, forKey: .videoId)
            try container.encode(title, forKey: .title)
            try container.encode(artist, forKey: .artist)
            try container.encode(album, forKey: .album)
            try container.encode(durationSec, forKey: .durationSec)
        case let .suggest(query):
            try container.encode(query, forKey: .query)
        }
    }
}
