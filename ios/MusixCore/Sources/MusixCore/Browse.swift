import Foundation

public enum RootTab: String, CaseIterable, Codable, Sendable {
    case home, library, playlists, recent

    public var title: String {
        switch self {
        case .home: return "Home"
        case .library: return "Library"
        case .playlists: return "Playlists"
        case .recent: return "Recent"
        }
    }

    public var nodeId: String? {
        switch self {
        case .home: return "home"
        case .library: return nil
        case .playlists: return "playlists"
        case .recent: return "recent"
        }
    }
}

public enum LibraryFolder: String, CaseIterable, Codable, Sendable {
    case liked, albums, artists

    public var title: String {
        switch self {
        case .liked: return "Liked songs"
        case .albums: return "Albums"
        case .artists: return "Artists"
        }
    }

    public var nodeId: String {
        switch self {
        case .liked: return "library-liked"
        case .albums: return "library-albums"
        case .artists: return "library-artists"
        }
    }
}

public enum MediaRef: Equatable, Sendable {
    case root
    case tab(RootTab)
    case folder(LibraryFolder)
    case node(nodeId: String, playlistId: String?)
    case track(videoId: String, playlistId: String?)
    case search(query: String)
}

public enum MediaIds {
    public static let root = "root"
    private static let maxLength = 16_384
    private static let allowed: CharacterSet = {
        var set = CharacterSet.alphanumerics
        set.insert(charactersIn: "-_.~")
        return set
    }()

    public static func tab(_ tab: RootTab) -> String { "tab/\(tab.rawValue)" }

    public static func folder(_ folder: LibraryFolder) -> String { "folder/\(folder.rawValue)" }

    public static func node(_ nodeId: String, playlistId: String? = nil) -> String {
        "node/\(encode(nodeId))/\(encode(playlistId ?? ""))"
    }

    public static func track(_ videoId: String, playlistId: String? = nil) -> String {
        "track/\(encode(videoId))/\(encode(playlistId ?? ""))"
    }

    public static func search(_ query: String) -> String { "search/\(encode(query))" }

    public static func parse(_ mediaId: String) -> MediaRef? {
        guard !mediaId.isEmpty, mediaId.count <= maxLength else {
            return nil
        }
        if mediaId == root {
            return .root
        }
        let parts = mediaId.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        guard let kind = parts.first else {
            return nil
        }
        switch kind {
        case "tab":
            guard parts.count == 2, let tab = RootTab(rawValue: parts[1]) else { return nil }
            return .tab(tab)
        case "folder":
            guard parts.count == 2, let folder = LibraryFolder(rawValue: parts[1]) else { return nil }
            return .folder(folder)
        case "node":
            guard parts.count == 3, let nodeId = decode(parts[1]), let playlistId = decode(parts[2]), !nodeId.isEmpty else { return nil }
            return .node(nodeId: nodeId, playlistId: playlistId.isEmpty ? nil : playlistId)
        case "track":
            guard parts.count == 3, let videoId = decode(parts[1]), let playlistId = decode(parts[2]), !videoId.isEmpty else { return nil }
            return .track(videoId: videoId, playlistId: playlistId.isEmpty ? nil : playlistId)
        case "search":
            guard parts.count == 2, let query = decode(parts[1]),
                  !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return nil }
            return .search(query: query)
        default:
            return nil
        }
    }

    private static func encode(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: allowed) ?? ""
    }

    private static func decode(_ value: String) -> String? {
        value.removingPercentEncoding
    }
}

public enum EntryKind: String, Codable, Sendable {
    case tab, folder, song, video, album, playlist, artist, category
}

public struct LibraryEntry: Codable, Equatable, Hashable, Sendable {
    public var mediaId: String
    public var title: String
    public var subtitle: String
    public var artworkUrl: String
    public var browsable: Bool
    public var playable: Bool
    public var kind: EntryKind
    public var groupTitle: String?
    public var durationSec: Double?

    public init(mediaId: String, title: String, subtitle: String, artworkUrl: String, browsable: Bool, playable: Bool, kind: EntryKind, groupTitle: String?, durationSec: Double?) {
        self.mediaId = mediaId
        self.title = title
        self.subtitle = subtitle
        self.artworkUrl = artworkUrl
        self.browsable = browsable
        self.playable = playable
        self.kind = kind
        self.groupTitle = groupTitle
        self.durationSec = durationSec
    }
}

public enum LibraryEntries {
    public static func rootTabs() -> [LibraryEntry] {
        RootTab.allCases.map { tab in
            LibraryEntry(mediaId: MediaIds.tab(tab), title: tab.title, subtitle: "", artworkUrl: "", browsable: true, playable: false, kind: .tab, groupTitle: nil, durationSec: nil)
        }
    }

    public static func libraryFolders() -> [LibraryEntry] {
        LibraryFolder.allCases.map { folder in
            LibraryEntry(mediaId: MediaIds.folder(folder), title: folder.title, subtitle: "", artworkUrl: "", browsable: true, playable: false, kind: .folder, groupTitle: nil, durationSec: nil)
        }
    }

    public static func entry(from item: FlatItem, group: String?, contextPlaylistId: String?) -> LibraryEntry? {
        let title = item.title.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !title.isEmpty else {
            return nil
        }
        let videoId = item.videoId.flatMap { $0.isEmpty ? nil : $0 }
        let playlistId = item.playlistId.flatMap { $0.isEmpty ? nil : $0 }
        let browseId = item.browseId.flatMap { $0.isEmpty ? nil : $0 }
        let trackLike = item.type == .song || item.type == .video
        if trackLike, let videoId, item.playable {
            return LibraryEntry(
                mediaId: MediaIds.track(videoId, playlistId: playlistId ?? contextPlaylistId),
                title: title, subtitle: item.subtitle, artworkUrl: item.artworkUrl,
                browsable: false, playable: true, kind: item.type == .song ? .song : .video,
                groupTitle: group, durationSec: item.durationSec
            )
        }
        if let browseId, item.browsable {
            let kind: EntryKind
            switch item.type {
            case .album: kind = .album
            case .playlist: kind = .playlist
            case .artist: kind = .artist
            default: kind = .category
            }
            let playableCollection = (kind == .album || kind == .playlist) && playlistId != nil
            return LibraryEntry(
                mediaId: MediaIds.node(browseId, playlistId: playableCollection ? playlistId : nil),
                title: title, subtitle: item.subtitle, artworkUrl: item.artworkUrl,
                browsable: true, playable: playableCollection, kind: kind,
                groupTitle: group, durationSec: nil
            )
        }
        if let videoId, item.playable {
            return LibraryEntry(
                mediaId: MediaIds.track(videoId, playlistId: playlistId ?? contextPlaylistId),
                title: title, subtitle: item.subtitle, artworkUrl: item.artworkUrl,
                browsable: false, playable: true, kind: .song, groupTitle: group, durationSec: item.durationSec
            )
        }
        if let playlistId, item.playable {
            return LibraryEntry(
                mediaId: MediaIds.node(playlistId, playlistId: playlistId),
                title: title, subtitle: item.subtitle, artworkUrl: item.artworkUrl,
                browsable: false, playable: true, kind: .playlist, groupTitle: group, durationSec: nil
            )
        }
        return nil
    }
}
