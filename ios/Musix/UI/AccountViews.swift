import MusixCore
import SwiftUI

struct SearchView: View {
    let library: LibraryService
    let player: PlayerController
    let onSignIn: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""
    @State private var submitted = ""
    @State private var showPlayer = false

    var body: some View {
        NavigationStack {
            Group {
                if submitted.isEmpty {
                    StateMessage(icon: "search", title: "Search YouTube Music", detail: "Find songs, albums, playlists, and artists.")
                        .frame(maxHeight: .infinity)
                } else {
                    BrowseView(
                        mediaId: MediaIds.search(submitted),
                        library: library,
                        player: player,
                        emptyTitle: "No results for \u{201C}\(submitted)\u{201D}",
                        onSignIn: onSignIn
                    )
                    .id(submitted)
                }
            }
            .background(Palette.bg)
            .navigationTitle("Search")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: LibraryEntry.self) { entry in
                FolderView(entry: entry, library: library, player: player, onSignIn: onSignIn)
            }
            .searchable(text: $text, placement: .navigationBarDrawer(displayMode: .always), prompt: "Songs, albums, artists")
            .onSubmit(of: .search) {
                let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    submitted = String(trimmed.prefix(200))
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Close") { dismiss() }
                }
            }
        }
        .safeAreaInset(edge: .bottom) {
            MiniPlayer(player: player, downloads: AppModel.shared.downloads) { showPlayer = true }
        }
        .sheet(isPresented: $showPlayer) {
            NowPlayingView(player: player, downloads: AppModel.shared.downloads, lyrics: AppModel.shared.lyrics)
        }
    }
}

struct SignInView: View {
    @ObservedObject var engine: WebEngine
    @State private var opened = false

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if engine.account == .signedIn {
                    Banner(icon: "user", text: "You're signed in")
                        .padding(.vertical, DesignTokens.space8)
                } else {
                    Text("Sign in with your Google account on the page below. Your session stays on this device.")
                        .font(.body(DesignTokens.text14))
                        .foregroundStyle(Palette.textMuted)
                        .padding(.horizontal, DesignTokens.space16)
                        .padding(.vertical, DesignTokens.space8)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                EngineHost(engine: engine, role: .signIn)
            }
            .background(Palette.bg.ignoresSafeArea())
            .navigationTitle("Sign in")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Back") {
                        if engine.canGoBack {
                            engine.goBack()
                        } else {
                            close()
                        }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { close() }
                }
            }
            .onAppear {
                if !opened, engine.account != .signedIn {
                    opened = true
                    engine.openSignIn()
                }
            }
        }
    }

    private func close() {
        if engine.currentURL?.host != WebEngine.allowedHost {
            engine.openHome()
        }
        engine.presentation = .background
    }
}

struct SettingsView: View {
    @ObservedObject var engine: WebEngine
    @ObservedObject var settings: AppSettings
    let library: LibraryService
    let onSignIn: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openURL) private var openURL
    @ObservedObject private var updates = UpdateChecker.shared
    @State private var notice: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    HStack(spacing: DesignTokens.space12) {
                        Icon(name: "user", size: 24).foregroundStyle(Palette.textMuted)
                        Text(accountText)
                            .font(.body(DesignTokens.text16))
                            .foregroundStyle(Palette.text)
                    }
                    if engine.account == .signedIn {
                        Button(role: .destructive) {
                            Task {
                                await engine.signOut()
                                await AppModel.shared.clearCaches()
                                settings.resume = nil
                                notice = "Signed out"
                            }
                        } label: {
                            Text("Sign out").font(.body(DesignTokens.text16, weight: .semibold))
                        }
                    } else {
                        Button {
                            onSignIn()
                        } label: {
                            Text("Sign in").font(.body(DesignTokens.text16, weight: .semibold))
                        }
                    }
                } header: {
                    Text("Account").font(.body(DesignTokens.text14, weight: .semibold))
                }
                Section {
                    ForEach(ThemePalette.allCases) { palette in
                        Button {
                            settings.theme = palette
                        } label: {
                            HStack(spacing: DesignTokens.space12) {
                                RoundedRectangle(cornerRadius: DesignTokens.radiusControl)
                                    .fill(Color(uiColor: UIColor(rgb: palette.values.bg)))
                                    .frame(width: 28, height: 28)
                                    .overlay(
                                        Circle()
                                            .fill(Color(uiColor: UIColor(rgb: palette.values.accent)))
                                            .frame(width: 10, height: 10)
                                    )
                                    .overlay(
                                        RoundedRectangle(cornerRadius: DesignTokens.radiusControl)
                                            .stroke(Color(uiColor: UIColor(rgb: palette.values.border)), lineWidth: 1)
                                    )
                                Text(palette.label)
                                    .font(.body(DesignTokens.text16))
                                    .foregroundStyle(settings.theme == palette ? Palette.accent : Palette.text)
                                Spacer(minLength: DesignTokens.space8)
                                if settings.theme == palette {
                                    Icon(name: "check", size: 20).foregroundStyle(Palette.accent)
                                }
                            }
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(settings.theme == palette ? [.isSelected] : [])
                    }
                } header: {
                    Text("Appearance").font(.body(DesignTokens.text14, weight: .semibold))
                }
                Section {
                    NavigationLink {
                        VoiceSettingsView(voice: AppModel.shared.voice)
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Voice assistant").font(.body(DesignTokens.text16))
                            Text("Say \"Veru\" to control Musix with your voice")
                                .font(.body(DesignTokens.text14))
                                .foregroundStyle(Palette.textMuted)
                        }
                    }
                } header: {
                    Text("Voice").font(.body(DesignTokens.text14, weight: .semibold))
                }
                Section {
                    Toggle(isOn: $settings.adSkip) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Skip ads automatically").font(.body(DesignTokens.text16))
                            Text("Mutes and fast-forwards ads the blocker cannot stop.")
                                .font(.body(DesignTokens.text14))
                                .foregroundStyle(Palette.textMuted)
                        }
                    }
                    .tint(Palette.accent)
                    Text("\(engine.blockedRules) ad and tracking rules active")
                        .font(.body(DesignTokens.text14))
                        .foregroundStyle(Palette.textMuted)
                } header: {
                    Text("Playback").font(.body(DesignTokens.text14, weight: .semibold))
                }
                Section {
                    Button {
                        Task {
                            await AppModel.shared.clearCaches()
                            notice = "Cache cleared"
                        }
                    } label: {
                        Text("Clear cache").font(.body(DesignTokens.text16, weight: .semibold))
                    }
                    Text("Removes saved pages and artwork. Your sign-in is kept.")
                        .font(.body(DesignTokens.text14))
                        .foregroundStyle(Palette.textMuted)
                } header: {
                    Text("Storage").font(.body(DesignTokens.text14, weight: .semibold))
                }
                Section {
                    NavigationLink {
                        PlaybackLogView(log: PlaybackLog.shared)
                    } label: {
                        Text("Playback log").font(.body(DesignTokens.text16, weight: .semibold))
                    }
                    Text("Shows every play, pause and stall with its cause. Copy it to report a problem.")
                        .font(.body(DesignTokens.text14))
                        .foregroundStyle(Palette.textMuted)
                } header: {
                    Text("Troubleshooting").font(.body(DesignTokens.text14, weight: .semibold))
                }
                Section {
                    Text(updates.status)
                        .font(.body(DesignTokens.text14))
                        .foregroundStyle(Palette.textMuted)
                    Button("Check for updates") {
                        Task { await updates.check(manual: true) }
                    }
                    if updates.available != nil {
                        Button("Download") {
                            openURL(UpdateChecker.releaseURL)
                        }
                    }
                } header: {
                    Text("Updates").font(.body(DesignTokens.text14, weight: .semibold))
                }
                Section {
                    Text("Musix \(Self.version)").font(.body(DesignTokens.text16))
                    Text("Musix is free and open source. It is not affiliated with Google or YouTube. Built with love by amvprosox.")
                        .font(.body(DesignTokens.text14))
                        .foregroundStyle(Palette.textMuted)
                } header: {
                    Text("About").font(.body(DesignTokens.text14, weight: .semibold))
                }
            }
            .scrollContentBackground(.hidden)
            .background(Palette.bg)
            .id(settings.theme)
            .navigationTitle("Settings")
            .preferredColorScheme(settings.theme.isDark ? .dark : .light)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .alert("Musix", isPresented: Binding(get: { notice != nil }, set: { if !$0 { notice = nil } })) {
                Button("OK", role: .cancel) { notice = nil }
            } message: {
                Text(notice ?? "")
            }
        }
    }

    private var accountText: String {
        switch engine.account {
        case .signedIn: return "Signed in to YouTube Music"
        case .signedOut: return "Not signed in. You can still listen, and signing in adds your library, playlists, and likes."
        case .unknown: return "Checking your account"
        }
    }

    private static var version: String {
        (Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String) ?? ""
    }
}

/// Checks the latest GitHub release for a newer iPhone build: when the app opens and
/// every few hours while online. Sideloaded apps cannot install updates themselves, so
/// Download opens the release page to install the new .ipa from a computer.
@MainActor
final class UpdateChecker: ObservableObject {
    static let shared = UpdateChecker()
    static let releaseURL = URL(string: "https://github.com/amvprosox/musixGoogle/releases/latest")!
    private static let latestFile = URL(string: "https://github.com/amvprosox/musixGoogle/releases/latest/download/latest.json")!

    @Published private(set) var available: String?
    @Published private(set) var status = "Musix checks for updates when it opens and every few hours."
    @Published var showPrompt = false
    private var lastCheck: Date?

    func check(manual: Bool) async {
        lastCheck = Date()
        if manual {
            status = "Checking for updates..."
        }
        do {
            let (data, response) = try await URLSession.shared.data(from: Self.latestFile)
            guard (response as? HTTPURLResponse)?.statusCode == 200,
                  let json = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                throw URLError(.badServerResponse)
            }
            let version = json["version"] as? String ?? ""
            let latestBuild = json["iosBuild"] as? Int ?? 0
            let currentBuild = Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") ?? 0
            if latestBuild > currentBuild {
                available = version
                status = "Musix \(version) (build \(latestBuild)) is available. Install the new .ipa with Impactor from your computer."
                if !manual {
                    showPrompt = true
                }
            } else {
                available = nil
                status = "You have the latest Musix (\(version.isEmpty ? "build \(currentBuild)" : version))."
            }
        } catch {
            if manual {
                status = "Could not check for updates. Check your connection."
            }
        }
    }

    func autoCheck() async {
        if let lastCheck, Date().timeIntervalSince(lastCheck) < 6 * 3600 {
            return
        }
        await check(manual: false)
    }
}
