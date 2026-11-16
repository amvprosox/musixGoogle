import Foundation

public struct OfflineSession: Sendable {
    private static let maxHistory = 500

    public private(set) var ids: [String]
    public private(set) var shuffle: Bool
    private var order: [String]
    private var position: Int
    private var history: [String] = []

    public init(queue: [String], startId: String, shuffle: Bool) {
        var generator = SystemRandomNumberGenerator()
        self.init(queue: queue, startId: startId, shuffle: shuffle, using: &generator)
    }

    public init<G: RandomNumberGenerator>(queue: [String], startId: String, shuffle: Bool, using generator: inout G) {
        var deduped = Self.dedupe(queue)
        if !deduped.contains(startId) {
            deduped.insert(startId, at: 0)
        }
        ids = deduped
        self.shuffle = shuffle
        order = shuffle
            ? [startId] + deduped.filter { $0 != startId }.shuffled(using: &generator)
            : deduped
        position = max(0, order.firstIndex(of: startId) ?? 0)
    }

    public var current: String? {
        order.indices.contains(position) ? order[position] : nil
    }

    public var lastPlayed: String? {
        history.last
    }

    public var upcoming: [String] {
        position + 1 < order.count ? Array(order[(position + 1)...]) : []
    }

    public mutating func next(repeatAll: Bool) -> String? {
        var generator = SystemRandomNumberGenerator()
        return next(repeatAll: repeatAll, using: &generator)
    }

    public mutating func next<G: RandomNumberGenerator>(repeatAll: Bool, using generator: inout G) -> String? {
        guard let cur = current else {
            return nil
        }
        if position + 1 < order.count {
            pushHistory(cur)
            position += 1
            return current
        }
        guard repeatAll else {
            return nil
        }
        pushHistory(cur)
        if shuffle {
            var rest = ids.shuffled(using: &generator)
            if rest.count > 1, rest.first == cur {
                rest.append(rest.removeFirst())
            }
            order = rest
        } else {
            order = ids
        }
        position = 0
        return current
    }

    public mutating func previous(repeatAll: Bool) -> String? {
        while let id = history.popLast() {
            if let idx = order.firstIndex(of: id) {
                position = idx
                return id
            }
        }
        if position > 0 {
            position -= 1
            return current
        }
        if repeatAll, order.count > 1 {
            position = order.count - 1
            return current
        }
        return nil
    }

    public mutating func setShuffle(_ on: Bool) {
        var generator = SystemRandomNumberGenerator()
        setShuffle(on, using: &generator)
    }

    public mutating func setShuffle<G: RandomNumberGenerator>(_ on: Bool, using generator: inout G) {
        guard on != shuffle else {
            return
        }
        shuffle = on
        guard let cur = current else {
            order = on ? ids.shuffled(using: &generator) : ids
            position = 0
            return
        }
        order = on ? [cur] + ids.filter { $0 != cur }.shuffled(using: &generator) : ids
        position = max(0, order.firstIndex(of: cur) ?? 0)
    }

    @discardableResult
    public mutating func jumpTo(_ id: String) -> Bool {
        let cur = current
        if id == cur {
            return true
        }
        guard ids.contains(id) else {
            return false
        }
        if let cur {
            pushHistory(cur)
        }
        let idx = order.firstIndex(of: id)
        if shuffle, let idx {
            order.remove(at: idx)
            let insertAt = min(position + 1, order.count)
            order.insert(id, at: insertAt)
            position = insertAt
        } else {
            position = max(0, idx ?? 0)
        }
        return true
    }

    public mutating func syncQueue(_ newIds: [String]) {
        var generator = SystemRandomNumberGenerator()
        syncQueue(newIds, using: &generator)
    }

    public mutating func syncQueue<G: RandomNumberGenerator>(_ newIds: [String], using generator: inout G) {
        let next = Self.dedupe(newIds)
        let keep = Set(next)
        let cur = current
        ids = next
        history.removeAll { !keep.contains($0) }
        guard shuffle else {
            order = next
            if let cur, let idx = order.firstIndex(of: cur) {
                position = idx
            } else {
                position = min(position, max(0, order.count - 1))
            }
            return
        }
        let existing = Set(order)
        let kept = order.filter { keep.contains($0) }
        let added = next.filter { !existing.contains($0) }
        if let cur, let curIdx = kept.firstIndex(of: cur) {
            let head = Array(kept[...curIdx])
            let rest = Array(kept[(curIdx + 1)...]) + added
            order = head + rest.shuffled(using: &generator)
            position = curIdx
        } else {
            order = (kept + added).shuffled(using: &generator)
            position = min(position, max(0, order.count - 1))
        }
    }

    private mutating func pushHistory(_ id: String) {
        history.append(id)
        if history.count > Self.maxHistory {
            history.removeFirst(history.count - Self.maxHistory)
        }
    }

    private static func dedupe(_ values: [String]) -> [String] {
        var seen = Set<String>()
        return values.filter { !$0.isEmpty && seen.insert($0).inserted }
    }
}
