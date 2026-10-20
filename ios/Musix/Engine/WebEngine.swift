import Combine
import Foundation
import MusixCore
import UIKit
import WebKit

@MainActor
final class EngineLink {
    weak var engine: WebEngine?

    func current() -> WebEngine? {
        engine
    }
}

@MainActor
final class WebEngine: NSObject, ObservableObject {
    enum Status: Equatable {
        case starting
        case loading
        case ready
        case recovering(attempt: Int)
        case offline(String)
        case failed(String)
    }

    enum Account: Equatable {
        case unknown
        case signedIn
        case signedOut
    }

    enum Presentation: Equatable {
        case background
        case signIn
    }

    static let homeAddress = "https://music.youtube.com/"
    static let allowedHost = "music.youtube.com"
    static let desktopUserAgent =
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15"
    private static let navigationHosts: Set<String> = [
        "music.youtube.com", "www.youtube.com", "youtube.com", "m.youtube.com",
        "accounts.google.com", "accounts.youtube.com", "consent.youtube.com", "consent.google.com",
        "myaccount.google.com", "www.google.com",
    ]
    private static let maxCrashes = 5
    private static let crashWindow: TimeInterval = 300

    @Published private(set) var status: Status = .starting
    @Published private(set) var state: BridgeState = .empty
    @Published private(set) var queueEntries: [QueueEntry] = []
    @Published private(set) var account: Account = .unknown
    @Published var presentation: Presentation = .background
    @Published private(set) var blockedRules = 0

    let errors = PassthroughSubject<String, Never>()
    let externalLinks = PassthroughSubject<URL, Never>()
    let commandQueue: CommandQueue
    let container = UIView()

    private let link: EngineLink
    private let scripts: InjectedScripts
    private let rules: ContentRules
    private let settings: AppSettings
    private var webView: WKWebView?
    private var crashTimes: [Date] = []
    private var pendingRestore: (ResumeSnapshot, Bool)?
    private var recoveryTask: Task<Void, Never>?
    private var started = false

    init(settings: AppSettings) {
        let link = EngineLink()
        self.link = link
        self.settings = settings
        self.scripts = InjectedScripts.load()
        self.rules = ContentRules()
        self.commandQueue = CommandQueue { json in
            guard let engine = await link.current() else {
                return false
            }
            return await engine.deliver(json)
        }
        super.init()
        link.engine = self
        container.backgroundColor = .black
        container.clipsToBounds = true
    }

    var currentURL: URL? { webView?.url }

    var canGoBack: Bool { webView?.canGoBack ?? false }

    func start() {
        guard !started else {
            return
        }
        started = true
        Task {
            let list = await rules.prepare()
            blockedRules = rules.ruleCount
            createWebView(rules: list)
            load(Self.homeAddress)
        }
    }

    func reload() {
        recoveryTask?.cancel()
        guard let webView else {
            started = false
            start()
            return
        }
        if let url = webView.url, url.host == Self.allowedHost {
            webView.reload()
        } else {
            load(Self.homeAddress)
        }
    }

    func openSignIn() {
        let target = "https://accounts.google.com/ServiceLogin?service=youtube&passive=true&continue="
            + (Self.homeAddress.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? "")
        load(target)
    }

    func openHome() {
        load(Self.homeAddress)
    }

    func goBack() {
        webView?.goBack()
    }

    func signOut() async {
        await commandQueue.markNotReady()
        let store = WKWebsiteDataStore.default()
        await store.removeData(ofTypes: WKWebsiteDataStore.allWebsiteDataTypes(), modifiedSince: .distantPast)
        account = .signedOut
        state = .empty
        queueEntries = []
        load(Self.homeAddress)
    }

    func restore(_ snapshot: ResumeSnapshot, play: Bool) async -> CommandResult {
        let started = await commandQueue.send(.playVideoId(videoId: snapshot.videoId, playlistId: snapshot.playlistId))
        guard started == .acknowledged else {
            return started
        }
        let arrived = await waitForTrack(snapshot.videoId, timeout: 15)
        guard arrived else {
            return .timedOut
        }
        if snapshot.positionSec > 1 {
            let seek = await commandQueue.send(.seekTo(seconds: snapshot.positionSec))
            guard seek == .acknowledged else {
                return seek
            }
        }
        return play ? .acknowledged : await commandQueue.send(.pause)
    }

    func deliver(_ json: String) async -> Bool {
        guard let webView else {
            return false
        }
        let body = "const b = window.__musixBridge; if (!b || typeof b.receive !== 'function') { return false; } b.receive(payload); return true;"
        do {
            let result = try await webView.callAsyncJavaScript(body, arguments: ["payload": json], in: nil, contentWorld: .page)
            return (result as? Bool) ?? false
        } catch {
            return false
        }
    }

    func receive(_ raw: String) {
        switch BridgeCodec.decodeEvent(raw) {
        case let .rejected(reason):
            NSLog("Musix rejected a bridge message: %@", reason)
        case let .accepted(event):
            Task {
                let consumed = await commandQueue.handle(event)
                if !consumed {
                    apply(event)
                }
            }
        }
    }

    private func apply(_ event: BridgeEvent) {
        switch event {
        case .ready:
            onReady()
        case let .state(newState):
            state = newState
            if newState.isSignedIn, account != .signedIn {
                account = .signedIn
            }
        case let .queue(items):
            queueEntries = items
        case .signedIn:
            account = .signedIn
        case .signedOut:
            account = .signedOut
        case let .error(_, message, _):
            errors.send(message)
        case .adStart, .adEnd, .ack, .browseResult, .searchResult:
            break
        }
    }

    private func onReady() {
        status = .ready
        Task {
            await commandQueue.markReady()
            let configure = await commandQueue.send(.configure(adSkip: settings.adSkip))
            if configure != .acknowledged {
                NSLog("Musix could not configure the page")
            }
            if let restoreTarget = pendingRestore {
                pendingRestore = nil
                let result = await restore(restoreTarget.0, play: restoreTarget.1)
                if result != .acknowledged {
                    errors.send("Playback could not be restored after the page restarted.")
                }
            }
        }
    }

    private func waitForTrack(_ videoId: String, timeout: TimeInterval) async -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if state.videoId == videoId, !state.isAd {
                return true
            }
            try? await Task.sleep(for: .milliseconds(200))
        }
        return false
    }

    private func load(_ address: String) {
        guard let webView, let url = URL(string: address) else {
            return
        }
        if !isRecovering {
            status = .loading
        }
        webView.load(URLRequest(url: url))
    }

    private func createWebView(rules list: WKContentRuleList?) {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.websiteDataStore = .default()
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        let controller = configuration.userContentController
        let proxy = ScriptMessageProxy(target: self)
        controller.add(proxy, contentWorld: .page, name: "ytm")
        if !scripts.scriptlets.isEmpty {
            controller.addUserScript(WKUserScript(source: scripts.scriptlets, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        }
        if !scripts.cosmeticCSS.isEmpty {
            controller.addUserScript(WKUserScript(source: scripts.cosmeticInstaller, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        }
        controller.addUserScript(WKUserScript(source: scripts.bridge, injectionTime: .atDocumentStart, forMainFrameOnly: true, in: .page))
        if let list {
            controller.add(list)
        }
        let view = WKWebView(frame: container.bounds, configuration: configuration)
        view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.customUserAgent = Self.desktopUserAgent
        view.navigationDelegate = self
        view.uiDelegate = self
        view.isOpaque = false
        view.backgroundColor = .black
        view.scrollView.contentInsetAdjustmentBehavior = .never
        container.addSubview(view)
        webView = view
    }

    private func destroyWebView() {
        guard let view = webView else {
            return
        }
        webView = nil
        view.stopLoading()
        view.navigationDelegate = nil
        view.uiDelegate = nil
        view.configuration.userContentController.removeAllScriptMessageHandlers()
        view.configuration.userContentController.removeAllUserScripts()
        view.removeFromSuperview()
    }

    private func recoverFromCrash() {
        if let snapshot = ResumeSnapshot.from(state, now: Date()) {
            pendingRestore = (snapshot, state.isPlaying)
        }
        var paused = state
        paused.isPlaying = false
        paused.isBuffering = false
        state = paused
        let now = Date()
        crashTimes = crashTimes.filter { now.timeIntervalSince($0) < Self.crashWindow } + [now]
        Task { await commandQueue.markNotReady() }
        destroyWebView()
        guard crashTimes.count <= Self.maxCrashes else {
            crashTimes.removeAll()
            status = .failed("The YouTube Music page keeps stopping. Tap retry to start it again.")
            return
        }
        let attempt = crashTimes.count
        status = .recovering(attempt: attempt)
        recoveryTask?.cancel()
        recoveryTask = Task {
            let delay = min(30.0, pow(2.0, Double(attempt - 1)))
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled else {
                return
            }
            let list = await rules.prepare()
            createWebView(rules: list)
            load(Self.homeAddress)
        }
    }

    fileprivate func handleProvisionalFailure(_ error: Error) {
        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled {
            return
        }
        Task { await commandQueue.markNotReady() }
        let offlineCodes: Set<Int> = [
            NSURLErrorNotConnectedToInternet, NSURLErrorNetworkConnectionLost, NSURLErrorTimedOut,
            NSURLErrorCannotFindHost, NSURLErrorCannotConnectToHost, NSURLErrorDNSLookupFailed,
        ]
        if nsError.domain == NSURLErrorDomain, offlineCodes.contains(nsError.code) {
            status = .offline("You're offline. Musix will reconnect when the network is back.")
        } else {
            status = .failed("YouTube Music could not be loaded: \(nsError.localizedDescription)")
        }
    }

    fileprivate func isAllowedNavigation(_ url: URL) -> Bool {
        guard url.scheme == "https", let host = url.host?.lowercased() else {
            return false
        }
        return Self.navigationHosts.contains(host)
    }

    fileprivate func pageStarted() {
        Task { await commandQueue.markNotReady() }
        if !isRecovering {
            status = .loading
        }
    }

    private var isRecovering: Bool {
        if case .recovering = status {
            return true
        }
        return false
    }
}

extension WebEngine: WKNavigationDelegate {
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
        guard navigationAction.targetFrame?.isMainFrame ?? true else {
            return .allow
        }
        guard let url = navigationAction.request.url else {
            return .cancel
        }
        if url.scheme == "about" || isAllowedNavigation(url) {
            return .allow
        }
        if url.scheme == "https" || url.scheme == "http" {
            externalLinks.send(url)
        }
        return .cancel
    }

    func webView(_ webView: WKWebView, didStartProvisionalNavigation navigation: WKNavigation?) {
        pageStarted()
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation?, withError error: Error) {
        handleProvisionalFailure(error)
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        recoverFromCrash()
    }
}

extension WebEngine: WKUIDelegate {
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url {
            if isAllowedNavigation(url) {
                webView.load(URLRequest(url: url))
            } else if url.scheme == "https" {
                externalLinks.send(url)
            }
        }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async {
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo) async -> Bool {
        false
    }
}

@MainActor
final class ScriptMessageProxy: NSObject, WKScriptMessageHandler {
    private weak var target: WebEngine?

    init(target: WebEngine) {
        self.target = target
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        let origin = message.frameInfo.securityOrigin
        guard message.frameInfo.isMainFrame,
              origin.protocol == "https",
              origin.host == WebEngine.allowedHost,
              let body = message.body as? String,
              body.utf16.count <= BridgeCodec.maxMessageCharacters else {
            return
        }
        target?.receive(body)
    }
}
