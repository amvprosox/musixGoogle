import Foundation

public enum DecodeResult: Equatable, Sendable {
    case accepted(BridgeEvent)
    case rejected(String)
}

public enum BridgeCodec {
    public static let maxMessageCharacters = 4_000_000
    static let maxText = 2000
    static let maxId = 512
    static let maxURL = 4096
    static let maxToken = 8192
    static let maxItems = 2000
    static let maxSections = 200
    static let maxRequestId = 64
    static let maxLyricLines = 1000

    public static func decodeEvent(_ raw: String) -> DecodeResult {
        guard raw.utf16.count <= maxMessageCharacters else {
            return .rejected("message too large")
        }
        guard let data = raw.data(using: .utf8) else {
            return .rejected("message is not UTF-8")
        }
        let event: BridgeEvent
        do {
            event = try JSONDecoder().decode(BridgeEvent.self, from: data)
        } catch {
            return .rejected("malformed message: \(error)")
        }
        if let problem = problem(with: event) {
            return .rejected(problem)
        }
        return .accepted(event)
    }

    public static func encode(_ command: BridgeCommand, requestId: String) throws -> String {
        if let problem = problem(with: command, requestId: requestId) {
            throw BridgeEncodeError.invalid(problem)
        }
        let data = try JSONEncoder().encode(CommandEnvelope(requestId: requestId, command: command))
        guard let text = String(data: data, encoding: .utf8) else {
            throw BridgeEncodeError.invalid("could not encode the command")
        }
        return text
    }

    public static func isValidVideoId(_ value: String) -> Bool {
        matches(value, minimum: 6, maximum: 20)
    }

    public static func isValidPlaylistId(_ value: String) -> Bool {
        matches(value, minimum: 2, maximum: 128)
    }

    public static func problem(with command: BridgeCommand, requestId: String) -> String? {
        if let problem = requestIdProblem(requestId) {
            return problem
        }
        switch command {
        case let .seekTo(seconds):
            return seconds.isFinite && seconds >= 0 ? nil : "invalid seek position"
        case let .setVolume(volume):
            return unit(volume) ? nil : "invalid volume"
        case let .duck(level):
            return unit(level) ? nil : "invalid duck level"
        case let .playVideoId(videoId, playlistId):
            if let playlistId, !isValidPlaylistId(playlistId) {
                return "invalid playlist id"
            }
            if videoId.isEmpty {
                return playlistId == nil ? "a video or playlist id is required" : nil
            }
            return isValidVideoId(videoId) ? nil : "invalid video id"
        case let .playQueueIndex(index):
            return index >= 0 && index < maxItems ? nil : "invalid queue index"
        case let .browse(nodeId):
            return !nodeId.isEmpty && nodeId.count <= maxToken ? nil : "invalid node"
        case let .search(query, _):
            let trimmed = query.trimmingCharacters(in: .whitespacesAndNewlines)
            return !trimmed.isEmpty && query.count <= 500 ? nil : "invalid query"
        case let .loadContinuation(token, _, nodeId):
            return !token.isEmpty && token.count <= maxToken && nodeId.count <= maxToken ? nil : "invalid continuation"
        case let .playlistTargets(videoId):
            return isValidVideoId(videoId) ? nil : "invalid video id"
        case let .addToPlaylist(videoId, playlistId):
            return isValidVideoId(videoId) && isValidPlaylistId(playlistId) ? nil : "invalid playlist target"
        case let .savePlaylist(playlistId, _):
            return isValidPlaylistId(playlistId) ? nil : "invalid playlist id"
        case let .lyrics(videoId, title, artist, album, durationSec):
            let valid = isValidVideoId(videoId)
                && !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                && title.count <= maxText
                && artist.count <= maxText
                && album.count <= maxText
                && nonNegative(durationSec)
            return valid ? nil : "invalid lyrics request"
        case let .suggest(query):
            return query.count <= 500 ? nil : "query too long"
        case .play, .pause, .togglePlay, .next, .previous, .toggleMute, .toggleLike, .toggleDislike, .setShuffle, .setRepeat, .configure:
            return nil
        }
    }

    public static func problem(with event: BridgeEvent) -> String? {
        switch event {
        case let .ready(_, clientVersion):
            return clientVersion.count <= 64 ? nil : "client version too long"
        case let .state(state):
            return stateProblem(state)
        case let .queue(items):
            return queueProblem(items)
        case let .browseResult(requestId, page):
            return requestIdProblem(requestId) ?? pageProblem(page)
        case let .searchResult(requestId, query, page):
            return firstProblem([requestIdProblem(requestId), check(query.count <= 500, "query too long"), pageProblem(page)])
        case let .signedIn(avatarUrl):
            return urlProblem(avatarUrl, field: "avatarUrl")
        case .signedOut, .adStart, .adEnd:
            return nil
        case let .ack(requestId):
            return requestIdProblem(requestId)
        case let .lyricsResult(requestId, lyrics):
            return requestIdProblem(requestId) ?? lyrics.flatMap { lyricsProblem($0) }
        case let .suggestResult(requestId, suggestions):
            return requestIdProblem(requestId) ?? suggestionsProblem(suggestions)
        case let .error(_, message, requestId):
            if message.count > maxText {
                return "error message too long"
            }
            return requestId.flatMap { requestIdProblem($0) }
        }
    }

    private static func matches(_ value: String, minimum: Int, maximum: Int) -> Bool {
        guard value.count >= minimum, value.count <= maximum else {
            return false
        }
        return value.unicodeScalars.allSatisfy { scalar in
            switch scalar {
            case "a"..."z", "A"..."Z", "0"..."9", "_", "-": return true
            default: return false
            }
        }
    }

    private static func unit(_ value: Double) -> Bool {
        value.isFinite && value >= 0 && value <= 1
    }

    private static func nonNegative(_ value: Double) -> Bool {
        value.isFinite && value >= 0
    }

    private static func requestIdProblem(_ value: String) -> String? {
        !value.isEmpty && value.count <= maxRequestId ? nil : "invalid request id"
    }

    private static func textProblem(_ value: String, _ max: Int, _ field: String) -> String? {
        value.count <= max ? nil : "\(field) too long"
    }

    private static func urlProblem(_ value: String, field: String) -> String? {
        if value.count > maxURL {
            return "\(field) too long"
        }
        return value.isEmpty || value.hasPrefix("https://") ? nil : "\(field) must be https"
    }

    private static func firstProblem(_ problems: [String?]) -> String? {
        problems.lazy.compactMap { $0 }.first
    }

    private static func check(_ condition: Bool, _ message: String) -> String? {
        condition ? nil : message
    }

    private static func lyricsProblem(_ lyrics: Lyrics) -> String? {
        firstProblem([
            check(lyrics.videoId.count <= maxId, "lyrics video id too long"),
            check(lyrics.source.count <= 200, "lyrics source too long"),
            check(lyrics.lines.count <= maxLyricLines, "too many lyric lines"),
            check(lyrics.lines.allSatisfy { nonNegative($0.timeMs) && $0.text.count <= maxText }, "invalid lyric line"),
        ])
    }

    private static func suggestionsProblem(_ suggestions: SearchSuggestions) -> String? {
        firstProblem([
            check(suggestions.query.count <= 500, "query too long"),
            check(suggestions.queries.count <= 50 && suggestions.queries.allSatisfy { $0.count <= 500 }, "invalid suggestions"),
            check(suggestions.items.count <= 50, "too many suggested items"),
        ] + suggestions.items.map { itemProblem($0) })
    }

    private static func stateProblem(_ state: BridgeState) -> String? {
        let problems: [String?] = [
            textProblem(state.videoId, maxId, "videoId"),
            textProblem(state.playlistId, maxId, "playlistId"),
            textProblem(state.title, maxText, "title"),
            textProblem(state.artist, maxText, "artist"),
            textProblem(state.album, maxText, "album"),
            urlProblem(state.artworkUrl, field: "artworkUrl"),
            check(nonNegative(state.durationSec), "invalid duration"),
            check(nonNegative(state.positionSec), "invalid position"),
            check(nonNegative(state.bufferedSec), "invalid buffered position"),
            check(unit(state.volume), "invalid volume"),
        ]
        return firstProblem(problems)
    }

    private static func queueProblem(_ items: [QueueEntry]) -> String? {
        if items.count > maxItems {
            return "queue too long"
        }
        for entry in items {
            let problems: [String?] = [
                check(entry.index >= 0, "invalid queue index"),
                textProblem(entry.videoId, maxId, "videoId"),
                textProblem(entry.title, maxText, "title"),
                textProblem(entry.artist, maxText, "artist"),
                textProblem(entry.artworkUrl, maxURL, "artworkUrl"),
                check(nonNegative(entry.durationSec), "invalid duration"),
            ]
            if let problem = firstProblem(problems) {
                return problem
            }
        }
        return nil
    }

    private static func optionalText(_ value: String?, _ max: Int, _ field: String) -> String? {
        guard let value else { return nil }
        return textProblem(value, max, field)
    }

    private static func itemProblem(_ item: FlatItem) -> String? {
        let duration: String? = item.durationSec.map { nonNegative($0) } == false ? "invalid duration" : nil
        let problems: [String?] = [
            check(!item.id.isEmpty && item.id.count <= maxToken, "invalid item id"),
            textProblem(item.title, maxText, "title"),
            textProblem(item.subtitle, maxText, "subtitle"),
            textProblem(item.artworkUrl, maxURL, "artworkUrl"),
            optionalText(item.videoId, maxId, "videoId"),
            optionalText(item.playlistId, maxId, "playlistId"),
            optionalText(item.browseId, maxToken, "browseId"),
            optionalText(item.continuation, maxToken, "continuation"),
            duration,
        ]
        return firstProblem(problems)
    }

    private static func pageProblem(_ page: BrowsePage) -> String? {
        let header: [String?] = [
            textProblem(page.nodeId, maxToken, "nodeId"),
            textProblem(page.title, maxText, "title"),
            optionalText(page.continuation, maxToken, "continuation"),
            check(page.sections.count <= maxSections, "too many sections"),
            check(page.items.count <= maxItems, "too many items"),
        ]
        if let problem = firstProblem(header) {
            return problem
        }
        for section in page.sections {
            let problems: [String?] = [
                textProblem(section.id, maxToken, "section id"),
                textProblem(section.title, maxText, "section title"),
                optionalText(section.browseId, maxToken, "section browseId"),
                check(section.items.count <= maxItems, "too many section items"),
            ]
            if let problem = firstProblem(problems) ?? section.items.lazy.compactMap({ itemProblem($0) }).first {
                return problem
            }
        }
        return page.items.lazy.compactMap { itemProblem($0) }.first
    }
}

public enum BridgeEncodeError: Error, Equatable {
    case invalid(String)
}
