import Foundation

public struct Stamped<Value: Codable & Sendable>: Codable, Sendable {
    public var key: String
    public var storedAt: Date
    public var value: Value
}

public protocol DiskStore<Value>: Sendable {
    associatedtype Value: Codable & Sendable
    func read(_ key: String) -> Stamped<Value>?
    func write(_ entry: Stamped<Value>)
    func delete(_ key: String)
    func clear()
}

public final class TtlCache<Value: Codable & Sendable>: @unchecked Sendable {
    private let ttl: TimeInterval
    private let maxEntries: Int
    private let clock: @Sendable () -> Date
    private let disk: (any DiskStore<Value>)?
    private let lock = NSLock()
    private var memory: [String: Stamped<Value>] = [:]
    private var order: [String] = []

    public init(ttl: TimeInterval, maxEntries: Int = 64, disk: (any DiskStore<Value>)? = nil, clock: @escaping @Sendable () -> Date = { Date() }) {
        self.ttl = ttl
        self.maxEntries = maxEntries
        self.disk = disk
        self.clock = clock
    }

    public func fresh(_ key: String) -> Value? {
        guard let entry = lookup(key) else {
            return nil
        }
        return clock().timeIntervalSince(entry.storedAt) <= ttl ? entry.value : nil
    }

    public func any(_ key: String) -> Value? {
        lookup(key)?.value
    }

    public func put(_ key: String, _ value: Value) {
        let entry = Stamped(key: key, storedAt: clock(), value: value)
        lock.withLock {
            store(entry)
        }
        disk?.write(entry)
    }

    public func values() -> [Value] {
        lock.withLock { order.compactMap { memory[$0]?.value } }
    }

    public func invalidate(_ key: String) {
        lock.withLock {
            memory.removeValue(forKey: key)
            order.removeAll { $0 == key }
        }
        disk?.delete(key)
    }

    public func clear() {
        lock.withLock {
            memory.removeAll()
            order.removeAll()
        }
        disk?.clear()
    }

    private func lookup(_ key: String) -> Stamped<Value>? {
        if let hit = lock.withLock({ () -> Stamped<Value>? in
            guard let hit = memory[key] else { return nil }
            touch(key)
            return hit
        }) {
            return hit
        }
        guard let stored = disk?.read(key), stored.key == key else {
            return nil
        }
        lock.withLock {
            store(stored)
        }
        return stored
    }

    private func store(_ entry: Stamped<Value>) {
        memory[entry.key] = entry
        touch(entry.key)
        while order.count > maxEntries, let eldest = order.first {
            order.removeFirst()
            memory.removeValue(forKey: eldest)
        }
    }

    private func touch(_ key: String) {
        order.removeAll { $0 == key }
        order.append(key)
    }
}

public final class JSONFileStore<Value: Codable & Sendable>: DiskStore, @unchecked Sendable {
    private let directory: URL
    private let maxFiles: Int
    private let fileManager = FileManager.default
    private let lock = NSLock()

    public init(directory: URL, maxFiles: Int = 200) {
        self.directory = directory
        self.maxFiles = maxFiles
    }

    public func read(_ key: String) -> Stamped<Value>? {
        lock.withLock {
            guard let data = try? Data(contentsOf: fileURL(key)) else {
                return nil
            }
            guard let entry = try? JSONDecoder().decode(Stamped<Value>.self, from: data) else {
                try? fileManager.removeItem(at: fileURL(key))
                return nil
            }
            return entry
        }
    }

    public func write(_ entry: Stamped<Value>) {
        lock.withLock {
            do {
                try fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
                let data = try JSONEncoder().encode(entry)
                try data.write(to: fileURL(entry.key), options: .atomic)
                prune()
            } catch {
                return
            }
        }
    }

    public func delete(_ key: String) {
        lock.withLock {
            try? fileManager.removeItem(at: fileURL(key))
        }
    }

    public func clear() {
        lock.withLock {
            guard let files = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else {
                return
            }
            for file in files {
                try? fileManager.removeItem(at: file)
            }
        }
    }

    private func prune() {
        guard let files = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: [.contentModificationDateKey]),
              files.count > maxFiles else {
            return
        }
        let dated = files.map { file -> (URL, Date) in
            let date = (try? file.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? .distantPast
            return (file, date)
        }
        for (file, _) in dated.sorted(by: { $0.1 < $1.1 }).prefix(files.count - maxFiles) {
            try? fileManager.removeItem(at: file)
        }
    }

    private func fileURL(_ key: String) -> URL {
        directory.appendingPathComponent(Self.hash(key) + ".json")
    }

    static func hash(_ key: String) -> String {
        var hash: UInt64 = 0xcbf2_9ce4_8422_2325
        for byte in key.utf8 {
            hash ^= UInt64(byte)
            hash = hash &* 0x100_0000_01b3
        }
        return String(hash, radix: 16)
    }
}
