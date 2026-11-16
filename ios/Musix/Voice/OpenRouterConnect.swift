import AuthenticationServices
import CryptoKit
import Foundation
import MusixCore
import Network
import UIKit

private func randomToken(_ count: Int) -> String {
    var generator = SystemRandomNumberGenerator()
    let bytes = (0..<count).map { _ in UInt8.random(in: 0...255, using: &generator) }
    return base64url(Data(bytes))
}

private func base64url(_ data: Data) -> String {
    data.base64EncodedString()
        .replacingOccurrences(of: "+", with: "-")
        .replacingOccurrences(of: "/", with: "_")
        .replacingOccurrences(of: "=", with: "")
}

private final class ConnectionBox: @unchecked Sendable {
    let connection: NWConnection

    init(_ connection: NWConnection) {
        self.connection = connection
    }
}

private final class ListenerBox: @unchecked Sendable {
    let listener: NWListener

    init(_ listener: NWListener) {
        self.listener = listener
    }
}

private final class LoopbackCallbackServer: @unchecked Sendable {
    private let queue = DispatchQueue(label: "com.realmadhoney.musix.openrouter-callback")
    private let state: String
    private let onCode: @Sendable (String) -> Void
    private var listener: NWListener?
    private var startContinuation: CheckedContinuation<UInt16, Error>?
    private var handled = false

    init(state: String, onCode: @escaping @Sendable (String) -> Void) {
        self.state = state
        self.onCode = onCode
    }

    func start() async throws -> UInt16 {
        let parameters = NWParameters.tcp
        parameters.requiredInterfaceType = .loopback
        parameters.acceptLocalOnly = true
        let box = ListenerBox(try NWListener(using: parameters))
        return try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<UInt16, Error>) in
            queue.async {
                let created = box.listener
                self.listener = created
                self.startContinuation = continuation
                created.stateUpdateHandler = { state in
                    self.listenerChanged(state)
                }
                created.newConnectionHandler = { connection in
                    self.accept(ConnectionBox(connection))
                }
                created.start(queue: self.queue)
            }
        }
    }

    func stop() {
        queue.async {
            self.listener?.cancel()
            self.listener = nil
            self.startContinuation?.resume(throwing: OpenRouterConnect.Failure.failed)
            self.startContinuation = nil
        }
    }

    private func listenerChanged(_ state: NWListener.State) {
        switch state {
        case .ready:
            if let port = listener?.port?.rawValue {
                startContinuation?.resume(returning: port)
            } else {
                startContinuation?.resume(throwing: OpenRouterConnect.Failure.failed)
            }
            startContinuation = nil
        case .failed, .cancelled:
            startContinuation?.resume(throwing: OpenRouterConnect.Failure.failed)
            startContinuation = nil
        default:
            break
        }
    }

    private func accept(_ box: ConnectionBox) {
        box.connection.start(queue: queue)
        box.connection.receive(minimumIncompleteLength: 1, maximumLength: 16_384) { data, _, _, _ in
            let request = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
            let code = self.code(from: request)
            let title = code == nil ? "Connection failed" : "Musix is connected"
            let message = code == nil ? "Go back to Musix and try again." : "You can go back to Musix now."
            let page = "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><title>\(title)</title></head><body style=\"margin:0;min-height:100vh;display:grid;place-items:center;background:#121212;color:#f2f2f2;font:17px -apple-system,sans-serif\"><main style=\"padding:24px;text-align:center\"><h1>\(title)</h1><p>\(message)</p></main></body></html>"
            let body = Data(page.utf8)
            let head = "HTTP/1.1 \(code == nil ? "400 Bad Request" : "200 OK")\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: \(body.count)\r\nCache-Control: no-store\r\nConnection: close\r\n\r\n"
            box.connection.send(content: Data(head.utf8) + body, completion: .contentProcessed { _ in
                box.connection.cancel()
            })
            if let code, !self.handled {
                self.handled = true
                self.onCode(code)
            }
        }
    }

    private func code(from request: String) -> String? {
        guard let line = request.split(separator: "\r\n", maxSplits: 1).first else {
            return nil
        }
        let parts = line.split(separator: " ")
        guard parts.count >= 2, parts[0] == "GET",
              let components = URLComponents(string: "http://localhost\(parts[1])"),
              components.path == "/callback" else {
            return nil
        }
        let items = components.queryItems ?? []
        let returnedState = items.first { $0.name == "state" }?.value
        guard returnedState == nil || returnedState == state,
              let code = items.first(where: { $0.name == "code" })?.value,
              !code.isEmpty, code.count <= 2000 else {
            return nil
        }
        return code
    }
}

@MainActor
final class OpenRouterConnect: NSObject, ASWebAuthenticationPresentationContextProviding {
    enum Failure: Error {
        case cancelled
        case failed
    }

    private let verifier = randomToken(32)
    private let state = randomToken(16)
    private var session: ASWebAuthenticationSession?
    private var continuation: CheckedContinuation<String, Error>?

    func connect() async throws -> String {
        let server = LoopbackCallbackServer(state: state) { [weak self] code in
            Task { @MainActor in
                self?.finish(.success(code))
            }
        }
        defer {
            server.stop()
        }
        let port = try await server.start()
        let challenge = base64url(Data(SHA256.hash(data: Data(verifier.utf8))))
        var components = URLComponents(string: "https://openrouter.ai/auth")
        components?.queryItems = [
            URLQueryItem(name: "callback_url", value: "http://localhost:\(port)/callback"),
            URLQueryItem(name: "code_challenge", value: challenge),
            URLQueryItem(name: "code_challenge_method", value: "S256"),
            URLQueryItem(name: "key_label", value: "Musix iPhone"),
            URLQueryItem(name: "state", value: state),
        ]
        guard let url = components?.url else {
            throw Failure.failed
        }
        let code: String = try await withCheckedThrowingContinuation { continuation in
            self.continuation = continuation
            let session = ASWebAuthenticationSession(url: url, callbackURLScheme: nil) { [weak self] _, _ in
                Task { @MainActor in
                    self?.finish(.failure(Failure.cancelled))
                }
            }
            session.presentationContextProvider = self
            session.prefersEphemeralWebBrowserSession = false
            self.session = session
            if !session.start() {
                finish(.failure(Failure.failed))
            }
        }
        return try await exchange(code)
    }

    private func finish(_ result: Result<String, Error>) {
        guard let continuation else {
            return
        }
        self.continuation = nil
        session?.cancel()
        session = nil
        continuation.resume(with: result)
    }

    private func exchange(_ code: String) async throws -> String {
        guard let url = URL(string: "\(AiIntentParser.base)/auth/keys") else {
            throw Failure.failed
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: [
            "code": code,
            "code_verifier": verifier,
            "code_challenge_method": "S256",
        ])
        let (data, response) = try await URLSession.shared.data(for: request)
        guard (response as? HTTPURLResponse)?.statusCode == 200,
              let root = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let key = (root["key"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !key.isEmpty, key.count <= 400 else {
            throw Failure.failed
        }
        return key
    }

    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        if let window = scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? scenes.first?.windows.first {
            return window
        }
        guard let scene = scenes.first else {
            preconditionFailure("Musix has no window to show OpenRouter in")
        }
        return UIWindow(windowScene: scene)
    }
}
