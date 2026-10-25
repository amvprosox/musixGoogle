import MusixCore
import SwiftUI

struct LyricsPanel: View {
    @ObservedObject var lyrics: LyricsController
    @ObservedObject var player: PlayerController

    private static let leadMs = 150.0

    var body: some View {
        switch lyrics.load {
        case .idle, .loading:
            Text("Finding lyrics…")
                .font(.body(DesignTokens.text16))
                .foregroundStyle(Palette.textMuted)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case .missing:
            StateMessage(icon: "lyrics", title: "No lyrics for this song", detail: "Lyrics aren’t available for this track yet.")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case let .failed(message):
            StateMessage(icon: "wifi_off", title: "Lyrics couldn’t load", detail: message, actionTitle: "Try again") {
                lyrics.retry()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        case let .found(value):
            if value.instrumental || value.lines.isEmpty {
                StateMessage(icon: "music", title: "Instrumental", detail: "This track has no lyrics.")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if value.synced {
                TimelineView(.animation(minimumInterval: 0.05, paused: !player.state.isPlaying)) { context in
                    LyricLinesView(
                        lyrics: value,
                        active: value.activeIndex(positionMs: player.livePositionSec(at: context.date) * 1000 + Self.leadMs),
                        onSeek: { seconds in player.seek(to: seconds) }
                    )
                }
            } else {
                LyricLinesView(lyrics: value, active: nil, onSeek: { _ in })
            }
        }
    }
}

struct LyricLinesView: View {
    let lyrics: Lyrics
    let active: Int?
    let onSeek: (Double) -> Void

    @State private var touchedAt = Date.distantPast

    private static let anchor = UnitPoint(x: 0.5, y: 0.33)
    private static let holdAfterScroll: TimeInterval = 3.5

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(showsIndicators: false) {
                LazyVStack(alignment: .leading, spacing: DesignTokens.space12) {
                    ForEach(Array(lyrics.lines.enumerated()), id: \.offset) { index, line in
                        Text(line.text.isEmpty ? " " : line.text)
                            .font(.heading(DesignTokens.text24, weight: lyrics.synced ? .bold : .semibold))
                            .foregroundStyle(color(for: index))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                            .onTapGesture {
                                guard lyrics.synced else {
                                    return
                                }
                                touchedAt = .distantPast
                                onSeek(line.timeMs / 1000)
                            }
                            .accessibilityAddTraits(lyrics.synced ? .isButton : [])
                            .accessibilityHint(lyrics.synced ? "Plays from this line" : "")
                            .id(index)
                    }
                    VStack(alignment: .leading, spacing: DesignTokens.space4) {
                        if !lyrics.synced {
                            Text("These lyrics aren’t time-synced for this version.")
                        }
                        Text("Lyrics from \(lyrics.source)")
                    }
                    .font(.body(DesignTokens.text14))
                    .foregroundStyle(Palette.textMuted)
                    .padding(.top, DesignTokens.space24)
                }
                .padding(.vertical, DesignTokens.space32)
                .animation(.easeOut(duration: 0.18), value: active)
            }
            .simultaneousGesture(
                DragGesture(minimumDistance: 4).onChanged { _ in
                    touchedAt = Date()
                }
            )
            .onAppear {
                if let active {
                    proxy.scrollTo(active, anchor: Self.anchor)
                }
            }
            .onChange(of: active) { index in
                guard let index, Date().timeIntervalSince(touchedAt) > Self.holdAfterScroll else {
                    return
                }
                withAnimation(.easeInOut(duration: 0.35)) {
                    proxy.scrollTo(index, anchor: Self.anchor)
                }
            }
        }
    }

    private func color(for index: Int) -> Color {
        guard lyrics.synced, let active else {
            return lyrics.synced ? Palette.textMuted : Palette.text
        }
        if index == active {
            return Palette.text
        }
        return index < active ? Palette.textMuted.opacity(0.55) : Palette.textMuted
    }
}

struct SearchSuggestionsList: View {
    let suggestions: SearchSuggestions
    let onSearch: (String) -> Void
    let onFill: (String) -> Void
    let onItem: (FlatItem) -> Void

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                ForEach(suggestions.queries, id: \.self) { text in
                    HStack(spacing: DesignTokens.space16) {
                        Button {
                            onSearch(text)
                        } label: {
                            HStack(spacing: DesignTokens.space16) {
                                Icon(name: "search", size: 20).foregroundStyle(Palette.textMuted)
                                highlighted(text)
                                    .font(.body(DesignTokens.text16))
                                    .lineLimit(1)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }
                            .frame(minHeight: 52)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Search for \(text)")
                        IconButton(icon: "fill_query", label: "Edit search: \(text)", size: 20) {
                            onFill(text)
                        }
                    }
                    .padding(.leading, DesignTokens.space16)
                }
                if !suggestions.queries.isEmpty, !suggestions.items.isEmpty {
                    Rectangle().fill(Palette.border).frame(height: 1).padding(.vertical, DesignTokens.space8)
                }
                ForEach(suggestions.items, id: \.id) { item in
                    Button {
                        onItem(item)
                    } label: {
                        HStack(spacing: DesignTokens.space12) {
                            ArtworkView(address: item.artworkUrl, size: 48, corner: item.type == .artist ? 24 : DesignTokens.radiusControl)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(item.title)
                                    .font(.body(DesignTokens.text16, weight: .semibold))
                                    .foregroundStyle(Palette.text)
                                    .lineLimit(1)
                                if !item.subtitle.isEmpty {
                                    Text(item.subtitle)
                                        .font(.body(DesignTokens.text14))
                                        .foregroundStyle(Palette.textMuted)
                                        .lineLimit(1)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(.horizontal, DesignTokens.space16)
                        .frame(minHeight: 64)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel([item.title, item.subtitle].filter { !$0.isEmpty }.joined(separator: ", "))
                }
            }
        }
        .scrollDismissesKeyboard(.immediately)
        .background(Palette.bg)
    }

    private func highlighted(_ text: String) -> Text {
        let typed = suggestions.query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !typed.isEmpty, text.lowercased().hasPrefix(typed.lowercased()), typed.count <= text.count else {
            return Text(text).foregroundColor(Palette.text)
        }
        let split = text.index(text.startIndex, offsetBy: typed.count)
        return Text(text[..<split]).foregroundColor(Palette.textMuted)
            + Text(text[split...]).foregroundColor(Palette.text).fontWeight(.semibold)
    }
}
