import Foundation

public enum SignInHosts {
    public static func isAccountsHost(_ host: String?) -> Bool {
        guard let host = host?.lowercased() else {
            return false
        }
        if host == "accounts.youtube.com" {
            return true
        }
        let parts = host.split(separator: ".")
        guard parts.count >= 3, parts[0] == "accounts", parts[1] == "google" else {
            return false
        }
        let suffix = parts.dropFirst(2)
        return suffix.count <= 2 && suffix.allSatisfy { $0.count >= 2 && $0.count <= 3 && $0.allSatisfy(\.isLetter) }
    }

    public static func mobileSafari(systemVersion: String, isPad: Bool) -> String {
        let parts = systemVersion.split(separator: ".").compactMap { Int($0) }
        let major = parts.first ?? 18
        let minor = parts.count > 1 ? parts[1] : 0
        let osToken: String
        if major >= 26 {
            osToken = "18_6"
        } else {
            osToken = parts.map(String.init).joined(separator: "_")
        }
        let device = isPad ? "iPad; CPU OS \(osToken) like Mac OS X" : "iPhone; CPU iPhone OS \(osToken) like Mac OS X"
        return "Mozilla/5.0 (\(device)) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/\(major).\(minor) Mobile/15E148 Safari/604.1"
    }
}
