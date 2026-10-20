import MusixCore
import SwiftUI

@MainActor
final class BrowseModel: ObservableObject {
    @Published private(set) var entries: [LibraryEntry] = []
    @Published private(set) var loading = false
    @Published private(set) var failure: LoadFailure?
    @Published private(set) var done = false
    @Published private(set) var started = false

    let mediaId: String
    private let library: LibraryService
    private var page = 0

    init(mediaId: String, library: LibraryService) {
        self.mediaId = mediaId
        self.library = library
    }

    func start() {
        guard !started else {
            return
        }
        loadNext()
    }

    func loadMore() {
        guard !loading, !done, failure == nil else {
            return
        }
        loadNext()
    }

    func retry() {
        entries = []
        page = 0
        done = false
        failure = nil
        started = false
        loadNext()
    }

    private func loadNext() {
        started = true
        loading = true
        failure = nil
        let requested = page
        Task {
            let result = await library.children(of: mediaId, page: requested)
            loading = false
            switch result {
            case let .items(items, _):
                var seen = Set(entries.map(\.mediaId))
                let fresh = items.filter { seen.insert($0.mediaId).inserted }
                entries.append(contentsOf: fresh)
                page = requested + 1
                done = items.count < LibraryService.pageSize || fresh.isEmpty
            case let .failed(reason):
                failure = reason
            case .notFound:
                done = true
            }
        }
    }
}

struct BrowseView: View {
    @StateObject private var model: BrowseModel
    let player: PlayerController
    var emptyTitle = "Nothing here yet"
    let onSignIn: () -> Void

    init(mediaId: String, library: LibraryService, player: PlayerController, emptyTitle: String = "Nothing here yet", onSignIn: @escaping () -> Void) {
        _model = StateObject(wrappedValue: BrowseModel(mediaId: mediaId, library: library))
        self.player = player
        self.emptyTitle = emptyTitle
        self.onSignIn = onSignIn
    }

    var body: some View {
        content
            .background(Palette.bg)
            .onAppear { model.start() }
    }

    @ViewBuilder
    private var content: some View {
        if model.entries.isEmpty {
            if let failure = model.failure {
                failureView(failure)
            } else if model.done {
                StateMessage(icon: "music", title: emptyTitle, detail: nil)
                    .frame(maxHeight: .infinity)
            } else {
                SkeletonList()
            }
        } else {
            list
        }
    }

    private var list: some View {
        List {
            ForEach(Array(model.entries.enumerated()), id: \.element.mediaId) { index, entry in
                let previousGroup = index > 0 ? model.entries[index - 1].groupTitle : nil
                if let group = entry.groupTitle, group != previousGroup {
                    Text(group)
                        .font(.heading(DesignTokens.text18))
                        .foregroundStyle(Palette.text)
                        .padding(.top, DesignTokens.space16)
                        .listRowSeparator(.hidden)
                        .listRowBackground(Palette.bg)
                        .accessibilityAddTraits(.isHeader)
                }
                row(entry)
                    .listRowBackground(Palette.bg)
                    .onAppear {
                        if index >= model.entries.count - 10 {
                            model.loadMore()
                        }
                    }
            }
            if model.loading {
                HStack {
                    Spacer()
                    ProgressView().tint(Palette.accent)
                    Spacer()
                }
                .listRowBackground(Palette.bg)
            }
            if let failure = model.failure {
                Banner(icon: "alert", text: failure.message, actionTitle: "Try again") { model.retry() }
                    .listRowBackground(Palette.bg)
                    .listRowInsets(EdgeInsets())
            }
        }
        .listStyle(.plain)
        .scrollContentBackground(.hidden)
        .refreshable { model.retry() }
    }

    @ViewBuilder
    private func row(_ entry: LibraryEntry) -> some View {
        if entry.browsable {
            NavigationLink(value: entry) {
                EntryRow(entry: entry)
            }
        } else {
            Button {
                player.play(mediaId: entry.mediaId)
            } label: {
                EntryRow(entry: entry)
            }
            .buttonStyle(.plain)
        }
    }

    @ViewBuilder
    private func failureView(_ failure: LoadFailure) -> some View {
        switch failure {
        case .signedOut:
            StateMessage(icon: "user", title: "Sign in to see your library", detail: failure.message, actionTitle: "Sign in", action: onSignIn)
                .frame(maxHeight: .infinity)
        case .offline:
            StateMessage(icon: "wifi_off", title: "You're offline", detail: failure.message, actionTitle: "Try again") { model.retry() }
                .frame(maxHeight: .infinity)
        default:
            StateMessage(icon: "alert", title: "Something went wrong", detail: failure.message, actionTitle: "Try again") { model.retry() }
                .frame(maxHeight: .infinity)
        }
    }
}

struct EntryRow: View {
    let entry: LibraryEntry

    private var fallback: String {
        switch entry.kind {
        case .album: return "album"
        case .artist: return "artist"
        case .playlist: return "list_music"
        case .tab, .folder, .category: return "library"
        case .song, .video: return "music"
        }
    }

    var body: some View {
        HStack(spacing: DesignTokens.space12) {
            ArtworkView(address: entry.artworkUrl, size: 56, fallback: fallback, corner: entry.kind == .artist ? 28 : DesignTokens.radiusControl)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title)
                    .font(.body(DesignTokens.text16, weight: .semibold))
                    .foregroundStyle(Palette.text)
                    .lineLimit(1)
                if !entry.subtitle.isEmpty {
                    Text(entry.subtitle)
                        .font(.body(DesignTokens.text14))
                        .foregroundStyle(Palette.textMuted)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, DesignTokens.space4)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

struct SkeletonList: View {
    var body: some View {
        VStack(spacing: DesignTokens.space16) {
            ForEach(0..<8, id: \.self) { _ in
                HStack(spacing: DesignTokens.space12) {
                    RoundedRectangle(cornerRadius: DesignTokens.radiusControl).fill(Palette.skeleton).frame(width: 56, height: 56)
                    VStack(alignment: .leading, spacing: DesignTokens.space8) {
                        RoundedRectangle(cornerRadius: 4).fill(Palette.skeleton).frame(width: 180, height: 16)
                        RoundedRectangle(cornerRadius: 4).fill(Palette.skeleton).frame(width: 120, height: 14)
                    }
                    Spacer()
                }
            }
            Spacer()
        }
        .padding(DesignTokens.space16)
        .accessibilityLabel("Loading")
    }
}

struct FolderView: View {
    let entry: LibraryEntry
    let library: LibraryService
    let player: PlayerController
    let onSignIn: () -> Void

    var body: some View {
        BrowseView(mediaId: entry.mediaId, library: library, player: player, onSignIn: onSignIn)
            .navigationTitle(entry.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if entry.playable {
                    ToolbarItem(placement: .primaryAction) {
                        Button {
                            player.play(mediaId: entry.mediaId)
                        } label: {
                            Label("Play all", image: "play_filled")
                        }
                    }
                }
            }
    }
}
