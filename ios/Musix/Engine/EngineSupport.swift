import Combine
import Foundation
import MusixCore
import WebKit

struct InjectedScripts {
    let bridge: String
    let scriptlets: String
    let cosmeticCSS: String
    let skinCSS: String

    var cosmeticInstaller: String {
        let literal = Self.jsonString(cosmeticCSS)
        return "(function(){var css=\(literal);var id='musix-cosmetic';"
            + "function add(){if(document.getElementById(id)){return;}var root=document.head||document.documentElement;"
            + "if(!root){return;}var style=document.createElement('style');style.id=id;style.textContent=css;root.appendChild(style);}"
            + "add();document.addEventListener('readystatechange',add);document.addEventListener('DOMContentLoaded',add);})();"
    }

    var skinInstaller: String {
        let literal = Self.jsonString(skinCSS)
        return "(function(){if(location.hostname!=='music.youtube.com'){return;}var css=\(literal);var id='musix-skin';"
            + "function viewport(){var head=document.head;if(!head){return;}var meta=document.querySelector('meta[name=viewport]');"
            + "if(!meta){meta=document.createElement('meta');meta.name='viewport';head.appendChild(meta);}"
            + "var wanted='width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover';"
            + "if(meta.content!==wanted){meta.content=wanted;}}"
            + "function add(){viewport();if(document.getElementById(id)){return;}var root=document.head||document.documentElement;"
            + "if(!root){return;}var style=document.createElement('style');style.id=id;style.textContent=css;root.appendChild(style);}"
            + "add();document.addEventListener('readystatechange',add);document.addEventListener('DOMContentLoaded',add);"
            + "new MutationObserver(add).observe(document.documentElement,{childList:true});})();"
    }

    static func navigation(_ endpoint: [String: Any]) -> String {
        guard let data = try? JSONSerialization.data(withJSONObject: endpoint),
              let json = String(data: data, encoding: .utf8) else {
            return "return false;"
        }
        return "const app = document.querySelector('ytmusic-app'); if (!app) { return false; } "
            + "app.dispatchEvent(new CustomEvent('yt-navigate', { bubbles: true, composed: true, detail: { endpoint: \(json) } })); "
            + "window.scrollTo(0, 0); return true;"
    }

    static func load(bundle: Bundle = .main) -> InjectedScripts {
        InjectedScripts(
            bridge: read("ytm-bridge", "js", bundle),
            scriptlets: read("scriptlets", "js", bundle),
            cosmeticCSS: read("cosmetic", "css", bundle),
            skinCSS: read("ytm-skin", "css", bundle)
        )
    }

    static func jsonString(_ value: String) -> String {
        guard let data = try? JSONEncoder().encode(value), let text = String(data: data, encoding: .utf8) else {
            return "\"\""
        }
        return text
    }

    private static func read(_ name: String, _ ext: String, _ bundle: Bundle) -> String {
        guard let url = bundle.url(forResource: name, withExtension: ext),
              let text = try? String(contentsOf: url, encoding: .utf8) else {
            NSLog("Musix is missing the bundled resource %@.%@", name, ext)
            return ""
        }
        return text
    }
}

@MainActor
final class ContentRules {
    private(set) var ruleCount = 0
    private var compiled: WKContentRuleList?
    private var attempted = false

    func prepare() async -> WKContentRuleList? {
        if let compiled {
            return compiled
        }
        if attempted {
            return nil
        }
        attempted = true
        guard let url = Bundle.main.url(forResource: "content-rules", withExtension: "json"),
              let json = try? String(contentsOf: url, encoding: .utf8) else {
            NSLog("Musix has no content blocking rules")
            return nil
        }
        let manifest = Self.manifest()
        ruleCount = manifest.count
        let identifier = "musix-adblock-\(manifest.hash)"
        guard let store = WKContentRuleListStore.default() else {
            return nil
        }
        if let existing = try? await store.contentRuleList(forIdentifier: identifier) {
            compiled = existing
            return existing
        }
        do {
            let list = try await store.compileContentRuleList(forIdentifier: identifier, encodedContentRuleList: json)
            compiled = list
            if let identifiers = await store.availableIdentifiers() {
                for old in identifiers where old != identifier && old.hasPrefix("musix-adblock-") {
                    try? await store.removeContentRuleList(forIdentifier: old)
                }
            }
            return list
        } catch {
            NSLog("Musix could not compile content blocking rules: %@", error.localizedDescription)
            return nil
        }
    }

    private static func manifest() -> (hash: String, count: Int) {
        guard let url = Bundle.main.url(forResource: "manifest", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return ("unknown", 0)
        }
        let files = object["files"] as? [String: Any]
        let hash = (files?["content-rules.json"] as? String).map { String($0.prefix(16)) } ?? "unknown"
        let counts = object["counts"] as? [String: Any]
        let count = (counts?["webkitRules"] as? Int) ?? 0
        return (hash, count)
    }
}

@MainActor
final class AppSettings: ObservableObject {
    private static let adSkipKey = "musix.adSkip"
    private static let resumeKey = "musix.resume"
    private let defaults: UserDefaults

    @Published var adSkip: Bool {
        didSet {
            defaults.set(adSkip, forKey: Self.adSkipKey)
        }
    }

    init(defaults: UserDefaults = .standard) {
        self.defaults = defaults
        self.adSkip = (defaults.object(forKey: Self.adSkipKey) as? Bool) ?? true
    }

    var resume: ResumeSnapshot? {
        get { ResumeSnapshot.decode(defaults.data(forKey: Self.resumeKey)) }
        set {
            if let data = newValue?.encoded() {
                defaults.set(data, forKey: Self.resumeKey)
            } else {
                defaults.removeObject(forKey: Self.resumeKey)
            }
        }
    }
}
