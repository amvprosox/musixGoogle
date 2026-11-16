import Compression
import Foundation

public enum ZipReaderError: Error, Equatable {
    case notZip
    case unsupported(String)
    case corrupt(String)
}

public enum ZipReader {
    public static func entries(in data: Data) throws -> [(name: String, contents: Data)] {
        let bytes = [UInt8](data)
        guard bytes.count >= 22 else {
            throw ZipReaderError.notZip
        }
        var eocd = -1
        var index = bytes.count - 22
        let lowest = max(0, bytes.count - 22 - 65_535)
        while index >= lowest {
            if bytes[index] == 0x50, bytes[index + 1] == 0x4B, bytes[index + 2] == 0x05, bytes[index + 3] == 0x06 {
                eocd = index
                break
            }
            index -= 1
        }
        guard eocd >= 0 else {
            throw ZipReaderError.notZip
        }
        let count = Int(read16(bytes, eocd + 10))
        var offset = Int(read32(bytes, eocd + 16))
        var result: [(name: String, contents: Data)] = []
        for _ in 0..<count {
            guard offset + 46 <= bytes.count, read32(bytes, offset) == 0x0201_4B50 else {
                throw ZipReaderError.corrupt("central directory")
            }
            let method = read16(bytes, offset + 10)
            let compressedSize = Int(read32(bytes, offset + 20))
            let size = Int(read32(bytes, offset + 24))
            let nameLength = Int(read16(bytes, offset + 28))
            let extraLength = Int(read16(bytes, offset + 30))
            let commentLength = Int(read16(bytes, offset + 32))
            let localOffset = Int(read32(bytes, offset + 42))
            guard offset + 46 + nameLength <= bytes.count,
                  let name = String(bytes: bytes[(offset + 46)..<(offset + 46 + nameLength)], encoding: .utf8) else {
                throw ZipReaderError.corrupt("name")
            }
            offset += 46 + nameLength + extraLength + commentLength
            if name.hasSuffix("/") {
                continue
            }
            guard localOffset + 30 <= bytes.count, read32(bytes, localOffset) == 0x0403_4B50 else {
                throw ZipReaderError.corrupt("local header")
            }
            let localName = Int(read16(bytes, localOffset + 26))
            let localExtra = Int(read16(bytes, localOffset + 28))
            let start = localOffset + 30 + localName + localExtra
            guard start + compressedSize <= bytes.count else {
                throw ZipReaderError.corrupt("data")
            }
            let compressed = Array(bytes[start..<(start + compressedSize)])
            switch method {
            case 0:
                result.append((name, Data(compressed)))
            case 8:
                result.append((name, try inflate(compressed, size: size)))
            default:
                throw ZipReaderError.unsupported("method \(method)")
            }
        }
        return result
    }

    public static func extract(_ data: Data, to directory: URL, stripPrefix: String = "") throws {
        let manager = FileManager.default
        for entry in try entries(in: data) {
            var relative = entry.name
            if !stripPrefix.isEmpty, relative.hasPrefix(stripPrefix) {
                relative = String(relative.dropFirst(stripPrefix.count))
            }
            guard !relative.isEmpty, !relative.contains(".."), !relative.hasPrefix("/") else {
                continue
            }
            let target = directory.appendingPathComponent(relative)
            try manager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
            try entry.contents.write(to: target, options: .atomic)
        }
    }

    static func inflate(_ input: [UInt8], size: Int) throws -> Data {
        if size == 0 {
            return Data()
        }
        var output = [UInt8](repeating: 0, count: size)
        let written = input.withUnsafeBufferPointer { source in
            output.withUnsafeMutableBufferPointer { destination in
                compression_decode_buffer(
                    destination.baseAddress!,
                    size,
                    source.baseAddress!,
                    input.count,
                    nil,
                    COMPRESSION_ZLIB
                )
            }
        }
        guard written == size else {
            throw ZipReaderError.corrupt("inflate")
        }
        return Data(output)
    }

    static func read16(_ bytes: [UInt8], _ at: Int) -> UInt16 {
        UInt16(bytes[at]) | UInt16(bytes[at + 1]) << 8
    }

    static func read32(_ bytes: [UInt8], _ at: Int) -> UInt32 {
        UInt32(bytes[at]) | UInt32(bytes[at + 1]) << 8 | UInt32(bytes[at + 2]) << 16 | UInt32(bytes[at + 3]) << 24
    }
}
