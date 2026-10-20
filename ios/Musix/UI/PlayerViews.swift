import MusixCore
import SwiftUI

struct MiniPlayer: View {
    @ObservedObject var player: PlayerController
    let onOpen: () -> Void

    var body: some View {
        if let current = player.timeline.current {
            VStack(spacing: 0) {
                GeometryReader { proxy in
                    let duration = current.durationSec ?? 0
                    let fraction = duration > 0 ? min(1, max(0, player.positionSec / duration)) : 0
                    ZStack(alignment: .leading) {
                        Rectangle().fill(Palette.border)
                        Rectangle().fill(Palette.accent).frame(width: proxy.size.width * fraction)
                    }
                }
                .frame(height: 2)
                HStack(spacing: DesignTokens.space12) {
                    Button(action: onOpen) {
                        HStack(spacing: DesignTokens.space12) {
                            ArtworkView(address: current.artworkUrl, size: 44)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(current.title)
                                    .font(.body(DesignTokens.text16, weight: .semibold))
                                    .foregroundStyle(Palette.text)
                                    .lineLimit(1)
                                if !current.artist.isEmpty {
                                    Text(current.artist)
                                        .font(.body(DesignTokens.text14))
                                        .foregroundStyle(Palette.textMuted)
                                        .lineLimit(1)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open player, \(current.title)")
                    IconButton(icon: player.state.isPlaying ? "pause_filled" : "play_filled", label: player.state.isPlaying ? "Pause" : "Play") {
                        player.togglePlay()
                    }
                    IconButton(icon: "skip_forward", label: "Next track", enabled: player.availability.next) {
                        player.next()
                    }
                }
                .padding(.horizontal, DesignTokens.space12)
                .frame(height: DesignTokens.miniPlayerHeight)
            }
            .background(Palette.surface)
        }
    }
}

struct NowPlayingView: View {
    @ObservedObject var player: PlayerController
    @Environment(\.dismiss) private var dismiss
    @State private var dragging: Double?

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                IconButton(icon: "collapse", label: "Close player") { dismiss() }
                Spacer()
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
    }

    private func content(_ current: TrackSpec) -> some View {
        let available = player.availability
        let duration = current.durationSec ?? 0
        return VStack(spacing: DesignTokens.space16) {
            GeometryReader { proxy in
                let side = min(proxy.size.width, proxy.size.height, 420)
                ArtworkView(address: current.artworkUrl, size: side, corner: DesignTokens.radiusCard)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
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
