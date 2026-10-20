package com.realmadhoney.musix.core.adblock

import com.google.common.truth.Truth.assertThat
import org.junit.Assert.assertThrows
import org.junit.Test
import java.io.File
import java.nio.ByteBuffer

class HostSetTest {
    private fun encode(hosts: List<String>): ByteArray {
        val hashes = hosts.map { HostSet.fnv1a64(it) }.distinct().sortedWith { a, b -> java.lang.Long.compareUnsigned(a, b) }
        val buffer = ByteBuffer.allocate(12 + hashes.size * 8)
        buffer.putInt(HostSet.MAGIC)
        buffer.putInt(HostSet.FORMAT_VERSION)
        buffer.putInt(hashes.size)
        hashes.forEach { buffer.putLong(it) }
        return buffer.array()
    }

    @Test
    fun matchesTheSharedFnvVectors() {
        assertThat(java.lang.Long.toHexString(HostSet.fnv1a64(""))).isEqualTo("cbf29ce484222325")
        assertThat(java.lang.Long.toHexString(HostSet.fnv1a64("a"))).isEqualTo("af63dc4c8601ec8c")
        assertThat(java.lang.Long.toHexString(HostSet.fnv1a64("foobar"))).isEqualTo("85944171f73967e8")
    }

    @Test
    fun matchesHostsAndTheirSubdomains() {
        val set = HostSet.parse(encode(listOf("ads.example.com", "tracker.net")))
        assertThat(set.size).isEqualTo(2)
        assertThat(set.matches("ads.example.com")).isTrue()
        assertThat(set.matches("x.y.ads.example.com")).isTrue()
        assertThat(set.matches("ADS.Example.com.")).isTrue()
        assertThat(set.matches("cdn.tracker.net")).isTrue()
        assertThat(set.matches("example.com")).isFalse()
        assertThat(set.matches("notads.example.com")).isFalse()
        assertThat(set.matches("")).isFalse()
        assertThat(set.matches("com")).isFalse()
        assertThat(set.containsExact("tracker.net")).isTrue()
    }

    @Test
    fun rejectsCorruptFiles() {
        val good = encode(listOf("a.com", "b.com"))
        assertThrows(IllegalArgumentException::class.java) { HostSet.parse(ByteArray(4)) }
        assertThrows(IllegalArgumentException::class.java) { HostSet.parse(good.copyOf(good.size - 1)) }
        val badMagic = good.copyOf().also { it[0] = 0 }
        assertThrows(IllegalArgumentException::class.java) { HostSet.parse(badMagic) }
        val unsorted = good.copyOf()
        for (i in 0 until 8) {
            val t = unsorted[12 + i]
            unsorted[12 + i] = unsorted[20 + i]
            unsorted[20 + i] = t
        }
        assertThrows(IllegalArgumentException::class.java) { HostSet.parse(unsorted) }
    }

    @Test
    fun loadsTheShippedBlocklist() {
        val file = File(System.getProperty("musix.hostsBin").orEmpty())
        val set = HostSet.parse(file.readBytes())
        assertThat(set.size).isGreaterThan(50_000)
        assertThat(set.matches("ade.googlesyndication.com")).isTrue()
        assertThat(set.matches("x.ade.googlesyndication.com")).isTrue()
        assertThat(set.matches("music.youtube.com")).isFalse()
        assertThat(set.matches("googlevideo.com")).isFalse()
        assertThat(set.matches("i.ytimg.com")).isFalse()
        assertThat(set.matches("accounts.google.com")).isFalse()
    }
}
