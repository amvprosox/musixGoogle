package com.realmadhoney.musix.core.offline

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import kotlin.random.Random

class OfflineSessionTest {
    private val ids = listOf("a", "b", "c", "d", "e", "f")

    @Test
    fun playsForwardAndStopsAtTheEndWithoutRepeat() {
        val session = OfflineSession(ids, "d", shuffle = false)
        assertThat(session.next(false)).isEqualTo("e")
        assertThat(session.next(false)).isEqualTo("f")
        assertThat(session.next(false)).isNull()
        assertThat(session.next(true)).isEqualTo("a")
    }

    @Test
    fun previousFollowsWhatActuallyPlayed() {
        val session = OfflineSession(ids, "a", shuffle = false)
        session.next(false)
        session.jumpTo("e")
        assertThat(session.previous(false)).isEqualTo("b")
        assertThat(session.previous(false)).isEqualTo("a")
        assertThat(session.previous(false)).isNull()
    }

    @Test
    fun shufflePlaysEverySongOnce() {
        val session = OfflineSession(ids, "c", shuffle = true, random = Random(3))
        val played = mutableListOf(session.current)
        repeat(ids.size - 1) { played.add(session.next(false)) }
        assertThat(played.first()).isEqualTo("c")
        assertThat(played.filterNotNull().sorted()).isEqualTo(ids)
        assertThat(session.next(false)).isNull()
    }

    @Test
    fun shufflePreviousReturnsTheSongsInReverseOrder() {
        val session = OfflineSession(ids, "a", shuffle = true, random = Random(11))
        val played = mutableListOf(session.current!!)
        repeat(4) { played.add(session.next(false)!!) }
        assertThat(session.previous(false)).isEqualTo(played[3])
        assertThat(session.previous(false)).isEqualTo(played[2])
        assertThat(session.next(false)).isEqualTo(played[3])
        assertThat(session.next(false)).isEqualTo(played[4])
    }

    @Test
    fun turningShuffleOffContinuesInListOrder() {
        val session = OfflineSession(ids, "a", shuffle = true, random = Random(5))
        session.next(false)
        val cur = session.current!!
        session.setShuffle(false)
        assertThat(session.current).isEqualTo(cur)
        assertThat(session.next(false)).isEqualTo(ids.getOrNull(ids.indexOf(cur) + 1))
    }

    @Test
    fun syncsWhenDownloadsChange() {
        val session = OfflineSession(ids, "a", shuffle = true, random = Random(2))
        session.next(false)
        val cur = session.current
        session.syncQueue(ids.filter { it != "f" } + "g")
        assertThat(session.current).isEqualTo(cur)
        assertThat(session.upcoming).doesNotContain("f")
        assertThat(session.upcoming).contains("g")
    }
}
