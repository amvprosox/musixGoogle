import Foundation

public enum CommandResult: Equatable, Sendable {
    case acknowledged
    case page(BrowsePage)
    case failed(code: BridgeErrorCode, message: String)
    case timedOut
    case notReady
}

public enum CommandLane: Hashable, Sendable {
    case player, data
}

public actor CommandQueue {
    public typealias Transport = @Sendable (String) async -> Bool

    private let transport: Transport
    private let timeout: Duration
    private let readyTimeout: Duration
    private var ready = false
    private var generation: UInt64 = 0
    private var counter: UInt64 = 0
    private var pending: [String: CheckedContinuation<CommandResult, Never>] = [:]
    private var awaiting: Set<String> = []
    private var early: [String: CommandResult] = [:]
    private var readyWaiters: [UInt64: CheckedContinuation<Bool, Never>] = [:]
    private var waiterCounter: UInt64 = 0
    private var tails: [CommandLane: Task<Void, Never>] = [:]

    public init(timeout: Duration = .seconds(5), readyTimeout: Duration = .seconds(20), transport: @escaping Transport) {
        self.transport = transport
        self.timeout = timeout
        self.readyTimeout = readyTimeout
    }

    public var isReady: Bool { ready }

    public var pendingCount: Int { pending.count }

    public func markReady() {
        ready = true
        let waiters = readyWaiters
        readyWaiters.removeAll()
        for waiter in waiters.values {
            waiter.resume(returning: true)
        }
    }

    public func markNotReady() {
        ready = false
        generation &+= 1
        let waiting = pending
        pending.removeAll()
        awaiting.removeAll()
        early.removeAll()
        for continuation in waiting.values {
            continuation.resume(returning: .notReady)
        }
    }

    public func send(_ command: BridgeCommand) async -> CommandResult {
        let lane = command.lane
        let previous = tails[lane]
        let task = Task { () -> CommandResult in
            await previous?.value
            return await self.dispatch(command)
        }
        tails[lane] = Task { _ = await task.value }
        return await task.value
    }

    @discardableResult
    public func handle(_ event: BridgeEvent) -> Bool {
        switch event {
        case let .ack(requestId):
            return complete(requestId, .acknowledged)
        case let .browseResult(requestId, page):
            return complete(requestId, .page(page))
        case let .searchResult(requestId, _, page):
            return complete(requestId, .page(page))
        case let .error(code, message, requestId):
            guard let requestId else {
                return false
            }
            return complete(requestId, .failed(code: code, message: message))
        default:
            return false
        }
    }

    private func dispatch(_ command: BridgeCommand) async -> CommandResult {
        guard await waitForReady() else {
            return .notReady
        }
        let startedGeneration = generation
        counter &+= 1
        let requestId = "i\(counter)"
        let payload: String
        do {
            payload = try BridgeCodec.encode(command, requestId: requestId)
        } catch let BridgeEncodeError.invalid(message) {
            return .failed(code: .invalidCommand, message: message)
        } catch {
            return .failed(code: .invalidCommand, message: "The command could not be encoded")
        }
        guard generation == startedGeneration else {
            return .notReady
        }
        awaiting.insert(requestId)
        let delivered = await transport(payload)
        guard delivered, generation == startedGeneration else {
            awaiting.remove(requestId)
            early.removeValue(forKey: requestId)
            return .notReady
        }
        if let result = early.removeValue(forKey: requestId) {
            awaiting.remove(requestId)
            return result
        }
        let limit = timeout
        return await withCheckedContinuation { continuation in
            pending[requestId] = continuation
            Task {
                try? await Task.sleep(for: limit)
                self.complete(requestId, .timedOut)
            }
        }
    }

    private func waitForReady() async -> Bool {
        if ready {
            return true
        }
        waiterCounter &+= 1
        let id = waiterCounter
        let limit = readyTimeout
        return await withCheckedContinuation { continuation in
            readyWaiters[id] = continuation
            Task {
                try? await Task.sleep(for: limit)
                self.expireWaiter(id)
            }
        }
    }

    private func expireWaiter(_ id: UInt64) {
        if let waiter = readyWaiters.removeValue(forKey: id) {
            waiter.resume(returning: false)
        }
    }

    @discardableResult
    private func complete(_ requestId: String, _ result: CommandResult) -> Bool {
        if let continuation = pending.removeValue(forKey: requestId) {
            awaiting.remove(requestId)
            continuation.resume(returning: result)
            return true
        }
        if awaiting.contains(requestId), result != .timedOut, early[requestId] == nil {
            early[requestId] = result
            return true
        }
        return false
    }
}
