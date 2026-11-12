import MusixCore
import SwiftUI

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
            .frame(height: DesignTokens.miniPlayerHeight + 8)
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
        let available = player.availability
        let duration = current.durationSec ?? 0
        let canDownload = !current.isAd && BridgeCodec.isValidVideoId(current.videoId)
        let entry = canDownload ? downloads.item(for: current.videoId) : nil
        let isDone = entry?.status == .completed
        let isBusy = entry?.status == .downloading || entry?.status == .queued
        return VStack(spacing: DesignTokens.space16) {
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
                        .frame(width: 72, height: 72)
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
        .padding(.horizontal, DesignTokens.space24)
        .padding(.bottom, DesignTokens.space32)
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

    var body: some View {
        Group {
            if downloads.items.isEmpty {
                StateMessage(
                    icon: "download",
                    title: "No downloads yet",
                    detail: "Tap the download icon on any playing song to save its MP3, thumbnail, and description for offline playback."
                )
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: DesignTokens.space8) {
                        HStack(spacing: DesignTokens.space12) {
                            Text("Downloads")
                                .font(.heading(DesignTokens.text24, weight: .bold))
                                .foregroundStyle(Palette.text)
                            let completedCount = downloads.items.filter { $0.status == .completed }.count
                            Text("\(completedCount) \(completedCount == 1 ? "track" : "tracks")")
                                .font(.body(DesignTokens.text14, weight: .medium))
                                .foregroundStyle(Palette.textMuted)
                                .padding(.horizontal, DesignTokens.space12)
                                .padding(.vertical, DesignTokens.space4)
                                .background(Palette.surface2, in: Capsule())
                        }
                        .padding(.bottom, DesignTokens.space8)
                        ForEach(downloads.items) { item in
                            row(item)
                        }
                    }
                    .padding(DesignTokens.space16)
                }
            }
        }
        .background(Palette.bg)
    }

    private func row(_ item: DownloadItem) -> some View {
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
                        player.playOffline(item: item, downloads: downloads)
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
                    player.playOffline(item: item, downloads: downloads)
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
