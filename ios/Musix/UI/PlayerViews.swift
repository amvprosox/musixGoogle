import MusixCore
import SwiftUI
import UIKit

struct MiniPlayer: View {
    @ObservedObject var player: PlayerController
    @ObservedObject var downloads: DownloadController
    let onOpen: () -> Void

    var body: some View {
        let current = player.timeline.current
        let duration = current?.durationSec ?? 0
        let fraction = duration > 0 ? min(1, max(0, player.positionSec / duration)) : 0
        let videoId = current?.videoId ?? ""
        let canDownload = current != nil && !(current?.isAd ?? false) && BridgeCodec.isValidVideoId(videoId)
        let entry = canDownload ? downloads.item(for: videoId) : nil
        let isDone = entry?.status == .completed
        let isBusy = entry?.status == .downloading || entry?.status == .queued
        VStack(spacing: 0) {
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Rectangle().fill(Palette.surface2)
                    Rectangle().fill(Palette.accent).frame(width: proxy.size.width * fraction)
                }
            }
            .frame(height: 2)
            HStack(spacing: DesignTokens.space8) {
                Button(action: onOpen) {
                    HStack(spacing: DesignTokens.space12) {
                        ArtworkView(address: current?.artworkUrl ?? "", size: 48, corner: DesignTokens.radiusCard)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(current?.title ?? "Nothing playing")
                                .font(.body(DesignTokens.text16, weight: .semibold))
                                .foregroundStyle(Palette.text)
                                .lineLimit(1)
                            Text(subtitle(current))
                                .font(.body(DesignTokens.text14))
                                .foregroundStyle(Palette.textMuted)
                                .lineLimit(1)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(current == nil)
                .accessibilityLabel(current.map { "Open player, \($0.title)" } ?? "Nothing playing")
                IconButton(
                    icon: isDone ? "check" : "download",
                    label: isDone ? "Downloaded" : (isBusy ? "Downloading MP3" : "Download MP3"),
                    active: isDone || isBusy,
                    enabled: canDownload && !isBusy
                ) {
                    if let current, !isDone, !isBusy {
                        downloads.startDownload(
                            DownloadTrackRequest(
                                videoId: current.videoId,
                                title: current.title,
                                artist: current.artist,
                                album: current.album,
                                durationSec: current.durationSec ?? player.state.durationSec,
                                artworkUrl: current.artworkUrl
                            )
                        )
                    }
                }
                Button {
                    player.togglePlay()
                } label: {
                    Icon(name: player.state.isPlaying ? "pause_filled" : "play_filled", size: 20)
                        .foregroundStyle(Palette.onAccent)
                        .frame(width: 44, height: 44)
                        .background(Palette.accent, in: Circle())
                        .frame(width: 48, height: 48)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(current == nil)
                .opacity(current == nil ? 0.6 : 1)
                .accessibilityLabel(player.state.isPlaying ? "Pause" : "Play")
                IconButton(icon: "skip_forward", label: "Next track", enabled: current != nil && player.availability.next) {
                    player.next()
                }
            }
            .padding(.horizontal, DesignTokens.space12)
            .frame(minHeight: DesignTokens.miniPlayerHeight + 8)
        }
        .background(Palette.surface)
    }

    private func subtitle(_ current: TrackSpec?) -> String {
        guard let current else {
            return "Pick something to play in YouTube Music"
        }
        return current.artist.isEmpty ? " " : current.artist
    }
}

struct NowPlayingView: View {
    @ObservedObject var player: PlayerController
    @ObservedObject var downloads: DownloadController
    @ObservedObject var lyrics: LyricsController
    @Environment(\.dismiss) private var dismiss
    @State private var dragging: Double?
    @State private var showSave = false
    @AppStorage("musix.showLyrics") private var showLyrics = false

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                IconButton(icon: "collapse", label: "Close player") { dismiss() }
                Spacer()
                if showLyrics, player.timeline.current != nil {
                    Text("Lyrics")
                        .font(.heading(DesignTokens.text18))
                        .foregroundStyle(Palette.text)
                }
                Spacer()
                if player.timeline.current != nil {
                    IconButton(icon: "lyrics", label: showLyrics ? "Hide lyrics" : "Show lyrics", active: showLyrics) {
                        showLyrics.toggle()
                    }
                } else {
                    Color.clear.frame(width: 48, height: 48)
                }
            }
            .padding(.horizontal, DesignTokens.space8)
            if let current = player.timeline.current {
                content(current)
            } else {
                StateMessage(icon: "music", title: "Nothing playing", detail: "Pick something from Home or search to start listening.")
                    .frame(maxHeight: .infinity)
            }
        }
        .background(Palette.bg.ignoresSafeArea())
        .sheet(isPresented: $showSave) {
            SaveToPlaylistView(player: player)
        }
    }

    private func content(_ current: TrackSpec) -> some View {
        GeometryReader { proxy in
            let wide = proxy.size.width > proxy.size.height && proxy.size.height < 560
            let narrow = proxy.size.width < 360
            Group {
                if wide {
                    HStack(spacing: DesignTokens.space24) {
                        visual(current)
                            .frame(width: proxy.size.width * 0.42)
                        ScrollView {
                            controls(current, narrow: narrow)
                                .padding(.vertical, DesignTokens.space16)
                        }
                    }
                } else {
                    VStack(spacing: DesignTokens.space16) {
                        visual(current)
                        controls(current, narrow: narrow)
                    }
                }
            }
            .padding(.horizontal, narrow ? DesignTokens.space16 : DesignTokens.space24)
            .padding(.bottom, wide ? DesignTokens.space16 : DesignTokens.space32)
        }
    }

    @ViewBuilder
    private func visual(_ current: TrackSpec) -> some View {
            if showLyrics {
                LyricsPanel(lyrics: lyrics, player: player)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                GeometryReader { proxy in
                    let side = min(proxy.size.width, proxy.size.height, 420)
                    ArtworkView(address: current.artworkUrl, size: side, corner: DesignTokens.radiusCard)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
    }

    private func controls(_ current: TrackSpec, narrow: Bool) -> some View {
        let available = player.availability
        let duration = current.durationSec ?? 0
        let canDownload = !current.isAd && BridgeCodec.isValidVideoId(current.videoId)
        let entry = canDownload ? downloads.item(for: current.videoId) : nil
        let isDone = entry?.status == .completed
        let isBusy = entry?.status == .downloading || entry?.status == .queued
        return VStack(spacing: DesignTokens.space16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: DesignTokens.space4) {
                    Text(current.title)
                        .font(.heading(DesignTokens.text24, weight: .bold))
                        .foregroundStyle(Palette.text)
                        .lineLimit(2)
                    let subtitle = [current.artist, current.album].filter { !$0.isEmpty }.joined(separator: " \u{2022} ")
                    if !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.body(DesignTokens.text16))
                            .foregroundStyle(Palette.textMuted)
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                IconButton(
                    icon: isDone ? "check" : "download",
                    label: isDone ? "Downloaded" : (isBusy ? "Downloading MP3" : "Download MP3"),
                    active: isDone || isBusy,
                    enabled: canDownload && !isBusy
                ) {
                    if !isDone, !isBusy {
                        downloads.startDownload(
                            DownloadTrackRequest(
                                videoId: current.videoId,
                                title: current.title,
                                artist: current.artist,
                                album: current.album,
                                durationSec: current.durationSec ?? player.state.durationSec,
                                artworkUrl: current.artworkUrl
                            )
                        )
                    }
                }
                IconButton(icon: "queue", label: "Save to playlist", enabled: available.like) {
                    showSave = true
                }
                IconButton(
                    icon: player.isLiked ? "heart_filled" : "heart",
                    label: player.isLiked ? "Remove from liked songs" : "Like",
                    active: player.isLiked,
                    enabled: available.like
                ) {
                    player.toggleLike()
                }
            }
            VStack(spacing: DesignTokens.space4) {
                Slider(
                    value: Binding(
                        get: { dragging ?? min(player.positionSec, max(duration, 1)) },
                        set: { dragging = $0 }
                    ),
                    in: 0...max(duration, 1),
                    onEditingChanged: { editing in
                        if !editing, let target = dragging {
                            player.seek(to: target)
                            dragging = nil
                        }
                    }
                )
                .tint(Palette.accent)
                .disabled(!available.seek)
                .accessibilityValue("\(formatTime(dragging ?? player.positionSec)) of \(formatTime(duration))")
                HStack {
                    Text(formatTime(dragging ?? player.positionSec))
                    Spacer()
                    Text(duration > 0 ? formatTime(duration) : "")
                }
                .font(.body(DesignTokens.text14))
                .foregroundStyle(Palette.textMuted)
            }
            HStack {
                IconButton(icon: "shuffle", label: player.state.shuffle ? "Turn shuffle off" : "Turn shuffle on", active: player.state.shuffle, enabled: available.shuffle) {
                    player.toggleShuffle()
                }
                Spacer()
                IconButton(icon: "skip_back", label: "Previous track", size: 28, enabled: available.previous) {
                    player.previous()
                }
                Spacer()
                Button {
                    player.togglePlay()
                } label: {
                    Icon(name: player.state.isPlaying ? "pause_filled" : "play_filled", size: 32)
                        .foregroundStyle(Palette.onAccent)
                        .frame(width: narrow ? 64 : 72, height: narrow ? 64 : 72)
                        .background(Palette.accent, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(player.state.isPlaying ? "Pause" : "Play")
                Spacer()
                IconButton(icon: "skip_forward", label: "Next track", size: 28, enabled: available.next) {
                    player.next()
                }
                Spacer()
                IconButton(
                    icon: player.state.repeatMode == .one ? "repeat_one" : "repeat",
                    label: Self.repeatLabel(player.state.repeatMode),
                    active: player.state.repeatMode != .none,
                    enabled: available.repeatMode
                ) {
                    player.cycleRepeat()
                }
            }
        }
    }

    private static func repeatLabel(_ mode: RepeatMode) -> String {
        switch mode {
        case .none: return "Repeat is off"
        case .all: return "Repeat all"
        case .one: return "Repeat one"
        }
    }
}

struct DownloadsView: View {
    @ObservedObject var downloads: DownloadController
    @ObservedObject var player: PlayerController
    let account: WebEngine.Account
    @State private var query = ""
    @State private var showLogs = false
    @State private var copiedLogs = false
    @State private var selectedLibraryId: String?
    @FocusState private var searchFocused: Bool

    /// Same layout as desktop: playlist tiles first (All Songs + each downloaded playlist);
    /// tapping a tile opens its songs on their own page with a Back button.
    private static let allSongsId = "__all_songs__"

    var body: some View {
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let completedIds = Set(downloads.items.filter { $0.status == .completed }.map(\.videoId))
        let libs = filteredLibraries(needle)
        let selected = downloads.savedLibraries.first { $0.id == selectedLibraryId }
        let inDetail = selectedLibraryId != nil
        let base = selected.map { downloads.savedItems(for: $0) } ?? downloads.items
        let scope = selected.map { _ in base.filter { $0.status == .completed }.map(\.videoId) }
        let tracks = filteredItems(needle, in: base)
        let saved = visibleSaved(needle, completedIds: completedIds)
        ScrollView {
            LazyVStack(alignment: .leading, spacing: DesignTokens.space8) {
                header
                if !inDetail {
                    toolbar
                }
                searchField
                if inDetail {
                    HStack(spacing: DesignTokens.space8) {
                        pill("Back", icon: "back") {
                            selectedLibraryId = nil
                        }
                        let name = selected?.title ?? "All Songs"
                        Text(needle.isEmpty ? "\(name) (\(base.count))" : "\(name) (\(tracks.count)/\(base.count))")
                            .font(.body(DesignTokens.text16, weight: .bold))
                            .foregroundStyle(Palette.text)
                            .lineLimit(1)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.top, DesignTokens.space8)
                    trackList(tracks, scope: scope, needle: needle)
                } else {
                    if showLogs {
                        logsPanel
                    }
                    if let notice = downloads.notice {
                        noticeBanner(notice)
                    }
                    sectionTitle("Downloaded Playlists")
                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: 150, maximum: 220), spacing: DesignTokens.space12)],
                        spacing: DesignTokens.space12
                    ) {
                        if !downloads.items.isEmpty {
                            allSongsTile(completedIds: completedIds)
                        }
                        ForEach(saved) { library in
                            savedTile(library)
                        }
                    }
                    sectionTitle("Auto-Detected Libraries")
                    HStack(spacing: DesignTokens.space8) {
                        pill(downloads.detectingLibraries ? "Detecting..." : "Refresh", icon: "refresh", enabled: !downloads.detectingLibraries) {
                            Task { await downloads.detectLibraries(force: true) }
                        }
                        if !downloads.libraries.isEmpty {
                            pill("Download All Libraries", icon: "download") {
                                downloads.downloadAllLibraries(downloads.libraries)
                            }
                        }
                    }
                    if libs.isEmpty {
                        Text(librariesEmptyText(needle))
                            .font(.body(DesignTokens.text14))
                            .foregroundStyle(Palette.textMuted)
                            .padding(.vertical, DesignTokens.space8)
                    } else {
                        LazyVGrid(
                            columns: [GridItem(.adaptive(minimum: 150, maximum: 220), spacing: DesignTokens.space12)],
                            spacing: DesignTokens.space12
                        ) {
                            ForEach(libs) { lib in
                                libraryTile(lib, completedIds: completedIds)
                            }
                        }
                    }
                    if !needle.isEmpty {
                        sectionTitle("Matching songs (\(tracks.count))")
                        trackList(tracks, scope: nil, needle: needle)
                    }
                }
            }
            .padding(DesignTokens.space16)
            .frame(maxWidth: 760)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Palette.bg)
        .task(id: account) {
            await downloads.detectLibraries()
        }
    }

    @ViewBuilder
    private func trackList(_ tracks: [DownloadItem], scope: [String]?, needle: String) -> some View {
        if tracks.isEmpty {
            StateMessage(
                icon: "download",
                title: needle.isEmpty ? "No downloads yet" : "No matching downloads",
                detail: needle.isEmpty
                    ? "Tap the download icon on any playing song, or download a whole library, to save MP3s for offline playback."
                    : "Try a different search term."
            )
        } else {
            ForEach(tracks) { item in
                row(item, scope: scope)
            }
        }
    }

    private func tile<Artwork: View>(
        title: String,
        subtitle: String,
        artwork: Artwork,
        playable: [DownloadItem],
        scope: [String]?,
        open: @escaping () -> Void
    ) -> some View {
        VStack(spacing: DesignTokens.space8) {
            Button(action: open) {
                VStack(spacing: DesignTokens.space8) {
                    artwork
                        .frame(width: 140, height: 140)
                        .clipShape(RoundedRectangle(cornerRadius: DesignTokens.radiusControl))
                    Text(title)
                        .font(.body(DesignTokens.text16, weight: .semibold))
                        .foregroundStyle(Palette.text)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                    Text(subtitle)
                        .font(.body(DesignTokens.text14))
                        .foregroundStyle(Palette.textMuted)
                        .multilineTextAlignment(.center)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open \(title)")
            HStack(spacing: DesignTokens.space4) {
                IconButton(icon: "play_filled", label: "Play \(title) offline", enabled: !playable.isEmpty) {
                    if let first = playable.first {
                        player.playOffline(item: first, downloads: downloads, scope: scope, shuffle: false)
                    }
                }
                IconButton(icon: "shuffle", label: "Shuffle \(title) offline", enabled: !playable.isEmpty) {
                    if let pick = playable.randomElement() {
                        player.playOffline(item: pick, downloads: downloads, scope: scope, shuffle: true)
                    }
                }
            }
        }
        .padding(DesignTokens.space12)
        .frame(maxWidth: .infinity)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: DesignTokens.radiusCard))
        .overlay(RoundedRectangle(cornerRadius: DesignTokens.radiusCard).stroke(Palette.border, lineWidth: 1))
    }

    private func allSongsTile(completedIds: Set<String>) -> some View {
        let playable = downloads.items.filter { $0.status == .completed }
        let covers = Array(playable.prefix(4))
        let collage = VStack(spacing: 0) {
            ForEach(0 ..< 2, id: \.self) { rowIndex in
                HStack(spacing: 0) {
                    ForEach(0 ..< 2, id: \.self) { column in
                        let index = rowIndex * 2 + column
                        ArtworkView(
                            address: index < covers.count ? downloads.artworkAddress(for: covers[index]) : "",
                            size: 70,
                            corner: 0
                        )
                    }
                }
            }
        }
        return tile(
            title: "All Songs",
            subtitle: "\(completedIds.count) songs downloaded",
            artwork: collage,
            playable: playable,
            scope: nil
        ) {
            selectedLibraryId = Self.allSongsId
        }
    }

    private func savedTile(_ library: SavedLibrary) -> some View {
        let playable = downloads.savedItems(for: library).filter { $0.status == .completed }
        return tile(
            title: library.title,
            subtitle: "\(library.kind) \u{2022} \(playable.count)/\(library.videoIds.count) songs offline",
            artwork: ArtworkView(address: library.artworkUrl, size: 140, corner: 0),
            playable: playable,
            scope: playable.map(\.videoId)
        ) {
            selectedLibraryId = library.id
        }
    }

    private var header: some View {
        let completedCount = downloads.items.filter { $0.status == .completed }.count
        return VStack(alignment: .leading, spacing: DesignTokens.space4) {
            Text("Downloads")
                .font(.heading(DesignTokens.text30, weight: .bold))
                .foregroundStyle(Palette.text)
            Text("\(completedCount) MP3 \(completedCount == 1 ? "track" : "tracks") saved for offline playback.")
                .font(.body(DesignTokens.text14))
                .foregroundStyle(Palette.textMuted)
        }
    }

    private var searchField: some View {
        HStack(spacing: DesignTokens.space8) {
            Icon(name: "search", size: 20).foregroundStyle(Palette.textMuted)
            TextField("Search downloads and libraries", text: $query)
                .font(.body(DesignTokens.text16))
                .foregroundStyle(Palette.text)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($searchFocused)
                .onSubmit { searchFocused = false }
                .onChange(of: query) { value in
                    if value.count > 200 {
                        query = String(value.prefix(200))
                    }
                }
            if !query.isEmpty {
                IconButton(icon: "close", label: "Clear search", size: 20) {
                    query = ""
                }
            }
        }
        .padding(.leading, DesignTokens.space12)
        .frame(minHeight: DesignTokens.controlHeight + 4)
        .background(Palette.surface2, in: RoundedRectangle(cornerRadius: DesignTokens.radiusCard))
        .overlay(RoundedRectangle(cornerRadius: DesignTokens.radiusCard).stroke(Palette.border, lineWidth: 1))
    }

    private var toolbar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: DesignTokens.space8) {
                pill(showLogs ? "Hide Logs" : "Logs", icon: "lyrics", highlighted: showLogs) {
                    showLogs.toggle()
                }
                if downloads.items.contains(where: { $0.status == .completed }) {
                    pill(downloads.fetchingLyrics ? "Getting Lyrics..." : "Get Lyrics", icon: "lyrics", enabled: !downloads.fetchingLyrics) {
                        Task { await downloads.backfillLyrics() }
                    }
                }
            }
        }
    }

    private var logsPanel: some View {
        VStack(alignment: .leading, spacing: DesignTokens.space8) {
            HStack(spacing: DesignTokens.space8) {
                Text("Download Logs")
                    .font(.body(DesignTokens.text16, weight: .bold))
                    .foregroundStyle(Palette.text)
                    .frame(maxWidth: .infinity, alignment: .leading)
                pill(copiedLogs ? "Copied" : "Copy", icon: "check", enabled: !downloads.logs.isEmpty) {
                    UIPasteboard.general.string = downloads.logsText
                    copiedLogs = true
                    Task {
                        try? await Task.sleep(nanoseconds: 1_500_000_000)
                        copiedLogs = false
                    }
                }
                pill("Clear", icon: "trash", enabled: !downloads.logs.isEmpty) {
                    downloads.clearLogs()
                }
            }
            ScrollViewReader { proxy in
                ScrollView {
                    Text(downloads.logs.isEmpty ? "No download logs yet." : downloads.logs.suffix(150).joined(separator: "\n"))
                        .font(.system(size: DesignTokens.text14, design: .monospaced))
                        .foregroundStyle(Palette.textMuted)
                        .textSelection(.enabled)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .id("download-logs-end")
                }
                .frame(maxHeight: 320)
                .onAppear {
                    proxy.scrollTo("download-logs-end", anchor: .bottom)
                }
                .onChange(of: downloads.logs.count) { _ in
                    proxy.scrollTo("download-logs-end", anchor: .bottom)
                }
            }
        }
        .padding(DesignTokens.space12)
        .background(Palette.surface, in: RoundedRectangle(cornerRadius: DesignTokens.radiusCard))
        .overlay(RoundedRectangle(cornerRadius: DesignTokens.radiusCard).stroke(Palette.border, lineWidth: 1))
    }

    private func noticeBanner(_ text: String) -> some View {
        HStack(spacing: DesignTokens.space8) {
            Icon(name: "check", size: 18).foregroundStyle(Palette.accent)
            Text(text)
                .font(.body(DesignTokens.text14, weight: .semibold))
                .foregroundStyle(Palette.text)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(DesignTokens.space12)
        .background(Palette.accentSoft, in: RoundedRectangle(cornerRadius: DesignTokens.radiusCard))
        .overlay(RoundedRectangle(cornerRadius: DesignTokens.radiusCard).stroke(Palette.accent, lineWidth: 1))
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text)
            .font(.body(DesignTokens.text16, weight: .bold))
            .foregroundStyle(Palette.text)
            .padding(.top, DesignTokens.space8)
    }

    private func pill(_ title: String, icon: String, enabled: Bool = true, highlighted: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: DesignTokens.space8) {
                Icon(name: icon, size: 16)
                Text(title)
                    .font(.body(DesignTokens.text14, weight: .semibold))
                    .lineLimit(1)
            }
            .foregroundStyle(enabled ? (highlighted ? Palette.accent : Palette.text) : Palette.textMuted.opacity(0.6))
            .padding(.horizontal, DesignTokens.space12)
            .frame(minHeight: 36)
            .overlay(
                RoundedRectangle(cornerRadius: DesignTokens.radiusControl)
                    .stroke(highlighted ? Palette.accent : Palette.border, lineWidth: 1)
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!enabled)
    }

    /// Library card, same as desktop: big cover, centered title and progress, and a
    /// Download button that turns into an outlined "Downloaded" when every song is saved.
    private func libraryTile(_ lib: DetectedLibrary, completedIds: Set<String>) -> some View {
        let total = lib.tracks.count
        let done = lib.tracks.filter { completedIds.contains($0.videoId) }.count
        let allDone = total > 0 && done == total
        let label = allDone ? "Downloaded" : "Download"
        return VStack(spacing: DesignTokens.space8) {
            ArtworkView(address: lib.artworkUrl, size: 140, corner: DesignTokens.radiusControl)
            Text(lib.title)
                .font(.body(DesignTokens.text16, weight: .semibold))
                .foregroundStyle(Palette.text)
                .multilineTextAlignment(.center)
                .lineLimit(2)
            Text("\(lib.subtitle) \u{2022} \(done)/\(total)")
                .font(.body(DesignTokens.text14))
                .foregroundStyle(Palette.textMuted)
                .lineLimit(1)
            Button {
                downloads.downloadBatch(title: lib.title, tracks: lib.tracks, library: lib)
            } label: {
                HStack(spacing: DesignTokens.space8) {
                    Icon(name: allDone ? "check" : "download", size: 16)
                    Text(label)
                        .font(.body(DesignTokens.text14, weight: .semibold))
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                }
                .foregroundStyle(allDone ? Palette.text : Palette.onAccent)
                .padding(.horizontal, DesignTokens.space12)
                .frame(maxWidth: .infinity, minHeight: 40)
                .background(allDone ? Palette.surface2 : Palette.accent, in: RoundedRectangle(cornerRadius: DesignTokens.radiusControl))
                .overlay(RoundedRectangle(cornerRadius: DesignTokens.radiusControl).stroke(allDone ? Palette.border : Palette.accent, lineWidth: 1))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(allDone ? "\(lib.title) already downloaded" : "Download \(lib.title)")
        }
        .padding(DesignTokens.space12)
        .frame(maxWidth: .infinity)
        .background(allDone ? Palette.surface2 : Palette.surface, in: RoundedRectangle(cornerRadius: DesignTokens.radiusCard))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusCard)
                .stroke(allDone ? Palette.accent.opacity(0.6) : Palette.border, lineWidth: 1)
        )
    }

    private func librariesEmptyText(_ needle: String) -> String {
        if downloads.detectingLibraries {
            return "Detecting your YouTube Music libraries..."
        }
        if !needle.isEmpty {
            return "No libraries match your search."
        }
        return account == .signedIn ? "No libraries detected yet. Tap Refresh." : "No libraries detected yet. Sign in and tap Refresh."
    }

    private func filteredLibraries(_ needle: String) -> [DetectedLibrary] {
        guard !needle.isEmpty else {
            return downloads.libraries
        }
        return downloads.libraries.filter { lib in
            lib.title.lowercased().contains(needle) ||
                lib.subtitle.lowercased().contains(needle) ||
                lib.tracks.contains {
                    $0.title.lowercased().contains(needle) ||
                        $0.artist.lowercased().contains(needle) ||
                        $0.album.lowercased().contains(needle)
                }
        }
    }

    private func visibleSaved(_ needle: String, completedIds: Set<String>) -> [SavedLibrary] {
        downloads.savedLibraries.filter { library in
            guard library.videoIds.contains(where: { completedIds.contains($0) }) else {
                return false
            }
            guard !needle.isEmpty else {
                return true
            }
            if library.title.lowercased().contains(needle) {
                return true
            }
            return downloads.savedItems(for: library).contains {
                $0.title.lowercased().contains(needle) || $0.artist.lowercased().contains(needle)
            }
        }
    }

    private func filteredItems(_ needle: String, in base: [DownloadItem]) -> [DownloadItem] {
        guard !needle.isEmpty else {
            return base
        }
        return base.filter {
            $0.title.lowercased().contains(needle) ||
                $0.artist.lowercased().contains(needle) ||
                $0.album.lowercased().contains(needle)
        }
    }

    private func row(_ item: DownloadItem, scope: [String]?) -> some View {
        let isCurrent = player.state.videoId == item.videoId
        let isPlaying = isCurrent && player.state.isPlaying
        let desc = [item.artist, item.album].filter { !$0.isEmpty }.joined(separator: " \u{2022} ")
        return HStack(spacing: DesignTokens.space12) {
            ArtworkView(address: downloads.artworkAddress(for: item), size: 56, corner: DesignTokens.radiusControl)
            VStack(alignment: .leading, spacing: 2) {
                Text(item.title)
                    .font(.body(DesignTokens.text16, weight: .semibold))
                    .foregroundStyle(isCurrent ? Palette.accent : Palette.text)
                    .lineLimit(1)
                if !desc.isEmpty {
                    Text(desc)
                        .font(.body(DesignTokens.text14))
                        .foregroundStyle(Palette.textMuted)
                        .lineLimit(1)
                }
                Text(metaText(item))
                    .font(.body(DesignTokens.text14))
                    .foregroundStyle(item.status == .failed ? Palette.danger : Palette.textMuted)
                    .lineLimit(1)
                if item.status == .downloading || item.status == .queued {
                    GeometryReader { proxy in
                        ZStack(alignment: .leading) {
                            Capsule().fill(Palette.border)
                            Capsule().fill(Palette.accent)
                                .frame(width: proxy.size.width * min(1, max(0.03, item.progress)))
                        }
                    }
                    .frame(height: 4)
                    .padding(.top, 4)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if item.status == .completed {
                IconButton(
                    icon: isPlaying ? "pause_filled" : "play_filled",
                    label: isPlaying ? "Pause \(item.title)" : "Play \(item.title)",
                    active: isCurrent
                ) {
                    if isCurrent {
                        player.togglePlay()
                    } else {
                        player.playOffline(item: item, downloads: downloads, scope: scope)
                    }
                }
            } else if item.status == .failed {
                IconButton(icon: "refresh", label: "Retry \(item.title)") {
                    downloads.startDownload(
                        DownloadTrackRequest(
                            videoId: item.videoId,
                            title: item.title,
                            artist: item.artist,
                            album: item.album,
                            durationSec: item.durationSec,
                            artworkUrl: item.artworkUrl
                        )
                    )
                }
            } else {
                ProgressView()
                    .tint(Palette.accent)
                    .frame(width: 48, height: 48)
            }
            IconButton(icon: "trash", label: "Remove \(item.title)") {
                player.stopOfflineIfPlaying(videoId: item.videoId)
                downloads.deleteDownload(item.videoId)
            }
        }
        .padding(DesignTokens.space12)
        .background(isCurrent ? Palette.accentSoft : Palette.surface, in: RoundedRectangle(cornerRadius: DesignTokens.radiusCard))
        .overlay(
            RoundedRectangle(cornerRadius: DesignTokens.radiusCard)
                .stroke(isCurrent ? Palette.accent : Palette.border, lineWidth: 1)
        )
        .contentShape(Rectangle())
        .onTapGesture {
            if item.status == .completed {
                if isCurrent {
                    player.togglePlay()
                } else {
                    player.playOffline(item: item, downloads: downloads, scope: scope)
                }
            }
        }
    }

    private func metaText(_ item: DownloadItem) -> String {
        switch item.status {
        case .completed:
            var parts = ["MP3"]
            if item.durationSec > 0 {
                parts.append(formatTime(item.durationSec))
            }
            if let bytes = item.fileSizeBytes, bytes > 0 {
                let mb = Double(bytes) / (1024 * 1024)
                parts.append(String(format: "%.1f MB", mb))
            }
            return parts.joined(separator: " \u{2022} ")
        case .downloading:
            let pct = Int(min(100, max(0, (item.progress * 100).rounded())))
            return "Downloading MP3... \(pct)%"
        case .queued:
            return "Queued..."
        case .failed:
            return item.error ?? "Download failed"
        }
    }
}

struct SaveToPlaylistView: View {
    @ObservedObject var player: PlayerController
    @Environment(\.dismiss) private var dismiss
    @State private var targets: [FlatItem] = []
    @State private var failure: String?
    @State private var loading = true
    @State private var saving: String?

    var body: some View {
        NavigationStack {
            Group {
                if loading {
                    SkeletonList()
                } else if let failure {
                    StateMessage(icon: "alert", title: "Couldn't load your playlists", detail: failure, actionTitle: "Try again") {
                        Task { await load() }
                    }
                    .frame(maxHeight: .infinity)
                } else if targets.isEmpty {
                    StateMessage(icon: "list_music", title: "No playlists yet", detail: "Create a playlist in YouTube Music first.")
                        .frame(maxHeight: .infinity)
                } else {
                    List(targets, id: \.id) { target in
                        Button {
                            save(target)
                        } label: {
                            HStack(spacing: DesignTokens.space12) {
                                Icon(name: "list_music", size: 24).foregroundStyle(Palette.textMuted)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(target.title)
                                        .font(.body(DesignTokens.text16, weight: .semibold))
                                        .foregroundStyle(Palette.text)
                                    if !target.subtitle.isEmpty {
                                        Text(target.subtitle)
                                            .font(.body(DesignTokens.text14))
                                            .foregroundStyle(Palette.textMuted)
                                    }
                                }
                                Spacer()
                                if saving == target.id {
                                    ProgressView().tint(Palette.accent)
                                }
                            }
                            .frame(minHeight: 48)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(saving != nil)
                        .listRowBackground(Palette.bg)
                    }
                    .listStyle(.plain)
                    .scrollContentBackground(.hidden)
                }
            }
            .background(Palette.bg)
            .navigationTitle("Save to playlist")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
            .task { await load() }
        }
    }

    private func load() async {
        loading = true
        failure = nil
        switch await player.playlistTargets() {
        case let .success(items):
            targets = items
        case let .failure(error):
            failure = error.message
        }
        loading = false
    }

    private func save(_ target: FlatItem) {
        guard let playlistId = target.playlistId else {
            return
        }
        saving = target.id
        Task {
            let saved = await player.addCurrent(to: playlistId, title: target.title)
            saving = nil
            if saved {
                dismiss()
            }
        }
    }
}
