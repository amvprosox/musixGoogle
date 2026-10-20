import MusixCore
import SwiftUI

struct RootView: View {
    @ObservedObject var engine: WebEngine
    @ObservedObject var player: PlayerController
    let library: LibraryService
    @ObservedObject var settings: AppSettings

    @State private var tab: RootTab = .home
    @State private var showPlayer = false
    @State private var showSettings = false
    @State private var showSearch = false
    @Environment(\.openURL) private var openURL

    var body: some View {
        ZStack {
            EngineHost(engine: engine, role: .background)
                .frame(width: 1, height: 1)
                .opacity(0.01)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            TabView(selection: $tab) {
                ForEach(RootTab.allCases, id: \.self) { tab in
                    NavigationStack {
                        VStack(spacing: 0) {
                            EngineStatusBanner(engine: engine)
                            BrowseView(mediaId: MediaIds.tab(tab), library: library, player: player, onSignIn: signIn)
                        }
                        .navigationTitle(tab.title)
                        .navigationDestination(for: LibraryEntry.self) { entry in
                            FolderView(entry: entry, library: library, player: player, onSignIn: signIn)
                        }
                        .toolbar {
                            ToolbarItem(placement: .navigationBarTrailing) {
                                IconButton(icon: "search", label: "Search") { showSearch = true }
                            }
                            ToolbarItem(placement: .navigationBarTrailing) {
                                IconButton(icon: "settings", label: "Settings") { showSettings = true }
                            }
                        }
                        .safeAreaInset(edge: .bottom) {
                            MiniPlayer(player: player) { showPlayer = true }
                        }
                    }
                    .tabItem { Label(tab.title, image: Self.icon(for: tab)) }
                    .tag(tab)
                }
            }
            .tint(Palette.accent)
        }
        .background(Palette.bg.ignoresSafeArea())
        .sheet(isPresented: $showPlayer) {
            NowPlayingView(player: player)
        }
        .sheet(isPresented: $showSearch) {
            SearchView(library: library, player: player, onSignIn: signIn)
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
        showSearch = false
        engine.presentation = .signIn
    }

    private static func icon(for tab: RootTab) -> String {
        switch tab {
        case .home: return "home"
        case .library: return "library"
        case .playlists: return "list_music"
        case .recent: return "history"
        }
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
