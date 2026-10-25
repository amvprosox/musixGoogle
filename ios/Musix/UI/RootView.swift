import MusixCore
import SwiftUI

enum ShellTab: CaseIterable {
    case home
    case explore
    case search
    case library
    case settings

    var title: String {
        switch self {
        case .home: return "Home"
        case .explore: return "Explore"
        case .search: return "Search"
        case .library: return "Library"
        case .settings: return "Settings"
        }
    }

    var icon: String {
        switch self {
        case .home: return "home"
        case .explore: return "compass"
        case .search: return "search"
        case .library: return "library"
        case .settings: return "settings"
        }
    }

    var route: WebEngine.Route? {
        switch self {
        case .home: return .home
        case .explore: return .explore
        case .library: return .library
        case .search, .settings: return nil
        }
    }
}

struct RootView: View {
    @ObservedObject var engine: WebEngine
    @ObservedObject var player: PlayerController
    let library: LibraryService
    @ObservedObject var settings: AppSettings
    let lyrics: LyricsController
    @ObservedObject var suggester: SearchSuggester

    @State private var tab: ShellTab = .home
    @State private var showPlayer = false
    @State private var showSettings = false
    @State private var query = ""
    @FocusState private var searchFocused: Bool
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: 0) {
            topBar
            EngineStatusBanner(engine: engine)
            ZStack {
                EngineHost(engine: engine, role: .background)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(Color.black)
                if showSuggestions {
                    SearchSuggestionsList(
                        suggestions: suggester.suggestions,
                        onSearch: { text in
                            query = text
                            runSearch()
                        },
                        onFill: { text in
                            query = text + " "
                            searchFocused = true
                        },
                        onItem: open
                    )
                }
            }
            Rectangle().fill(Palette.border).frame(height: 1)
            MiniPlayer(player: player) { showPlayer = true }
            Rectangle().fill(Palette.border).frame(height: 1)
            tabBar
        }
        .background(Palette.surface.ignoresSafeArea())
        .preferredColorScheme(.dark)
        .tint(Palette.accent)
        .sheet(isPresented: $showPlayer) {
            NowPlayingView(player: player, lyrics: lyrics)
        }
        .sheet(isPresented: $showSettings) {
            SettingsView(engine: engine, settings: settings, library: library, onSignIn: signIn)
        }
        .fullScreenCover(isPresented: signInBinding) {
            SignInView(engine: engine)
        }
        .alert("Musix", isPresented: messageBinding) {
            Button("OK", role: .cancel) { player.message = nil }
        } message: {
            Text(player.message ?? "")
        }
        .onReceive(engine.externalLinks) { url in
            openURL(url)
        }
        .onChange(of: settings.adSkip) { enabled in
            Task { await player.send(.configure(adSkip: enabled)) }
        }
        .onChange(of: query) { text in
            suggester.update(text)
        }
    }

    private var showSuggestions: Bool {
        tab == .search && searchFocused && !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !suggester.suggestions.isEmpty
    }

    private func open(_ item: FlatItem) {
        searchFocused = false
        if item.playable, let videoId = item.videoId {
            player.play(mediaId: MediaIds.track(videoId, playlistId: item.playlistId))
        } else if let browseId = item.browseId {
            Task { await engine.openBrowse(browseId) }
        } else {
            query = item.title
            runSearch()
        }
    }

    private var topBar: some View {
        HStack(spacing: DesignTokens.space4) {
            if tab == .search {
                HStack(spacing: DesignTokens.space8) {
                    Icon(name: "search", size: 20).foregroundStyle(Palette.textMuted)
                    TextField("Search songs, albums, artists", text: $query)
                        .font(.body(DesignTokens.text16))
                        .foregroundStyle(Palette.text)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.search)
                        .focused($searchFocused)
                        .onSubmit(runSearch)
                    if !query.isEmpty {
                        IconButton(icon: "close", label: "Clear search", size: 20) {
                            query = ""
                            searchFocused = true
                        }
                    }
                }
                .padding(.leading, DesignTokens.space12)
                .frame(height: DesignTokens.controlHeight + 4)
                .background(Palette.surface2, in: RoundedRectangle(cornerRadius: DesignTokens.radiusCard))
                .overlay(RoundedRectangle(cornerRadius: DesignTokens.radiusCard).stroke(Palette.border, lineWidth: 1))
                .padding(.horizontal, DesignTokens.space12)
            } else {
                if engine.canNavigateBack {
                    IconButton(icon: "back", label: "Back") { engine.goBack() }
                } else {
                    Image("Logo")
                        .resizable()
                        .scaledToFit()
                        .frame(width: 32, height: 32)
                        .padding(.leading, DesignTokens.space16)
                        .padding(.trailing, DesignTokens.space8)
                        .accessibilityHidden(true)
                }
                Text("Musix")
                    .font(.heading(DesignTokens.text20, weight: .bold))
                    .foregroundStyle(Palette.text)
                Spacer(minLength: DesignTokens.space8)
                IconButton(icon: "search", label: "Search") { select(.search) }
                if engine.account == .signedIn {
                    IconButton(icon: "user", label: "Account") { showSettings = true }
                } else {
                    Button(action: signIn) {
                        HStack(spacing: DesignTokens.space8) {
                            Icon(name: "log_in", size: 18)
                            Text("Sign in").font(.body(DesignTokens.text14, weight: .semibold))
                        }
                        .foregroundStyle(Palette.text)
                        .padding(.horizontal, DesignTokens.space12)
                        .frame(height: DesignTokens.controlHeight)
                        .overlay(RoundedRectangle(cornerRadius: DesignTokens.radiusControl).stroke(Palette.border, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .padding(.trailing, DesignTokens.space8)
                }
            }
        }
        .frame(height: 60)
        .background(Palette.surface)
        .overlay(alignment: .bottom) {
            Rectangle().fill(Palette.border).frame(height: 1)
        }
    }

    private var tabBar: some View {
        HStack(spacing: 0) {
            ForEach(ShellTab.allCases, id: \.self) { item in
                Button {
                    select(item)
                } label: {
                    VStack(spacing: DesignTokens.space4) {
                        Icon(name: item.icon, size: 22)
                        Text(item.title)
                            .font(.body(DesignTokens.text14, weight: tab == item ? .semibold : .medium))
                            .lineLimit(1)
                    }
                    .foregroundStyle(tab == item ? Palette.accent : Palette.textMuted)
                    .frame(maxWidth: .infinity, minHeight: 56)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(item.title)
                .accessibilityAddTraits(tab == item ? .isSelected : [])
            }
        }
        .padding(.top, DesignTokens.space4)
        .background(Palette.surface)
    }

    private func select(_ item: ShellTab) {
        switch item {
        case .settings:
            showSettings = true
        case .search:
            tab = .search
            searchFocused = true
        case .home, .explore, .library:
            searchFocused = false
            tab = item
            if let route = item.route {
                Task { await engine.navigate(route) }
            }
        }
    }

    private func runSearch() {
        let text = query
        searchFocused = false
        Task { await engine.search(text) }
    }

    private var signInBinding: Binding<Bool> {
        Binding(
            get: { engine.presentation == .signIn },
            set: { visible in
                if !visible {
                    engine.presentation = .background
                }
            }
        )
    }

    private var messageBinding: Binding<Bool> {
        Binding(
            get: { player.message != nil },
            set: { visible in
                if !visible {
                    player.message = nil
                }
            }
        )
    }

    private func signIn() {
        showSettings = false
        engine.presentation = .signIn
    }
}

struct EngineStatusBanner: View {
    @ObservedObject var engine: WebEngine

    var body: some View {
        switch engine.status {
        case let .offline(text):
            Banner(icon: "wifi_off", text: text, actionTitle: "Try again") { engine.reload() }
                .padding(.vertical, DesignTokens.space8)
        case let .failed(text):
            Banner(icon: "alert", text: text, actionTitle: "Try again") { engine.reload() }
                .padding(.vertical, DesignTokens.space8)
        case .recovering:
            Banner(icon: "refresh", text: "Restarting the player")
                .padding(.vertical, DesignTokens.space8)
        case .starting, .loading:
            Banner(icon: "refresh", text: "Starting YouTube Music")
                .padding(.vertical, DesignTokens.space8)
        case .ready:
            EmptyView()
        }
    }
}

struct EngineHost: UIViewRepresentable {
    enum Role {
        case background
        case signIn
    }

    @ObservedObject var engine: WebEngine
    let role: Role

    func makeUIView(context: Context) -> UIView {
        let holder = UIView()
        holder.backgroundColor = .clear
        holder.clipsToBounds = true
        return holder
    }

    func updateUIView(_ holder: UIView, context: Context) {
        let wanted: WebEngine.Presentation = role == .background ? .background : .signIn
        let container = engine.container
        if engine.presentation == wanted {
            if container.superview !== holder {
                container.removeFromSuperview()
                container.frame = holder.bounds
                container.autoresizingMask = [.flexibleWidth, .flexibleHeight]
                holder.addSubview(container)
            }
        } else if container.superview === holder {
            container.removeFromSuperview()
        }
    }

    static func dismantleUIView(_ holder: UIView, coordinator: ()) {
        for subview in holder.subviews {
            subview.removeFromSuperview()
        }
    }
}
