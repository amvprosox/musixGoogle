package com.realmadhoney.musix.core.adblock

import java.nio.ByteBuffer
import java.nio.ByteOrder

class HostSet private constructor(
    private val hashes: LongArray,
) {
    val size: Int get() = hashes.size

    fun containsExact(host: String): Boolean = search(fnv1a64(host.lowercase().trimEnd('.')))

    fun matches(host: String): Boolean {
        val normalized = host.lowercase().trimEnd('.')
        if (normalized.isEmpty() || normalized.length > MAX_HOST_LENGTH) {
            return false
        }
        var candidate = normalized
        while (true) {
            if (search(fnv1a64(candidate))) {
                return true
            }
            val dot = candidate.indexOf('.')
            if (dot < 0 || dot == candidate.length - 1) {
                return false
            }
            candidate = candidate.substring(dot + 1)
            if (!candidate.contains('.')) {
                return false
            }
        }
    }

    private fun search(hash: Long): Boolean {
        var low = 0
        var high = hashes.size - 1
        while (low <= high) {
            val mid = (low + high) ushr 1
            val cmp = java.lang.Long.compareUnsigned(hashes[mid], hash)
            when {
                cmp < 0 -> low = mid + 1
                cmp > 0 -> high = mid - 1
                else -> return true
            }
        }
        return false
    }

    companion object {
        const val MAGIC = 0x4d584842
        const val FORMAT_VERSION = 1
        private const val HEADER_BYTES = 12
        private const val MAX_HOSTS = 2_000_000
        private const val MAX_HOST_LENGTH = 253
        private const val FNV_OFFSET = -0x340d631b7bdddcdbL
        private const val FNV_PRIME = 0x100000001b3L

        val EMPTY = HostSet(LongArray(0))

        fun fnv1a64(value: String): Long {
            var hash = FNV_OFFSET
            for (byte in value.toByteArray(Charsets.UTF_8)) {
                hash = hash xor (byte.toLong() and 0xff)
                hash *= FNV_PRIME
            }
            return hash
        }

        fun parse(bytes: ByteArray): HostSet {
            require(bytes.size >= HEADER_BYTES) { "hosts.bin is too short" }
            val buffer = ByteBuffer.wrap(bytes).order(ByteOrder.BIG_ENDIAN)
            val magic = buffer.int
            require(magic == MAGIC) { "hosts.bin has the wrong magic number" }
            val version = buffer.int
            require(version == FORMAT_VERSION) { "hosts.bin version $version is not supported" }
            val count = buffer.int
            require(count in 0..MAX_HOSTS) { "hosts.bin declares $count hosts" }
            require(bytes.size.toLong() == HEADER_BYTES + count.toLong() * 8) { "hosts.bin length does not match its count" }
            val hashes = LongArray(count) { buffer.long }
            for (index in 1 until hashes.size) {
                require(java.lang.Long.compareUnsigned(hashes[index - 1], hashes[index]) < 0) { "hosts.bin is not sorted" }
            }
            return HostSet(hashes)
        }
    }
}
