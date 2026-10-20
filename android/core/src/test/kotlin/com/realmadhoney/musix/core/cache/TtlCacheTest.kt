package com.realmadhoney.musix.core.cache

import com.google.common.truth.Truth.assertThat
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.builtins.serializer
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class TtlCacheTest {
    @get:Rule
    val temp = TemporaryFolder()

    @Test
    fun expiresEntriesAfterTheTtlButKeepsThemForStaleReads() {
        var now = 1_000L
        val cache = TtlCache<String>(ttlMs = 600_000, clock = { now })
        cache.put("a", "one")
        now += 600_000
        assertThat(cache.getFresh("a")).isEqualTo("one")
        now += 1
        assertThat(cache.getFresh("a")).isNull()
        assertThat(cache.getAny("a")).isEqualTo("one")
    }

    @Test
    fun evictsLeastRecentlyUsedEntries() {
        val cache = TtlCache<Int>(ttlMs = 1_000, clock = { 0L }, maxEntries = 2)
        cache.put("a", 1)
        cache.put("b", 2)
        cache.getFresh("a")
        cache.put("c", 3)
        assertThat(cache.getAny("b")).isNull()
        assertThat(cache.getAny("a")).isEqualTo(1)
        assertThat(cache.getAny("c")).isEqualTo(3)
    }

    @Test
    fun persistsToDiskAndSurvivesARestart() {
        var now = 5_000L
        val dir = temp.newFolder("cache")
        val store = JsonFileStore(dir, ListSerializer(String.serializer()))
        val cache = TtlCache(ttlMs = 600_000, clock = { now }, disk = store)
        cache.put("home", listOf("x", "y"))
        val restarted = TtlCache(ttlMs = 600_000, clock = { now }, disk = JsonFileStore(dir, ListSerializer(String.serializer())))
        assertThat(restarted.getFresh("home")).containsExactly("x", "y").inOrder()
        now += 700_000
        assertThat(restarted.getFresh("home")).isNull()
        assertThat(restarted.getAny("home")).containsExactly("x", "y").inOrder()
        restarted.invalidate("home")
        assertThat(TtlCache(600_000, { now }, disk = store).getAny("home")).isNull()
    }

    @Test
    fun discardsCorruptFilesAndReportsTheError() {
        val dir = temp.newFolder("corrupt")
        val errors = mutableListOf<String>()
        val store = JsonFileStore(dir, String.serializer(), onError = { what, _ -> errors += what })
        store.write("k", Stamped("value", 1L))
        val file = dir.listFiles().orEmpty().single()
        file.writeText("{ not json")
        assertThat(store.read("k")).isNull()
        assertThat(errors).isNotEmpty()
        assertThat(file.exists()).isFalse()
    }

    @Test
    fun prunesOldFilesBeyondTheLimit() {
        val dir = temp.newFolder("prune")
        val store = JsonFileStore(dir, String.serializer(), maxFiles = 3)
        repeat(6) { store.write("k$it", Stamped("v$it", it.toLong())) }
        assertThat(dir.listFiles { f -> f.name.endsWith(".json") }.orEmpty().size).isAtMost(3)
    }
}
