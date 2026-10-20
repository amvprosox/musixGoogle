package com.realmadhoney.musix.core.adblock

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import java.io.File

class UrlRulesTest {
    @Test
    fun matchesHostAndPathPrefixes() {
        val rules = UrlRules.parse("youtube.com\t/pagead/\nyoutube.com\t/api/stats/ads?\nbad line\nexample.com\tnoslash\n")
        assertThat(rules.size).isEqualTo(2)
        assertThat(rules.matches("www.youtube.com", "/pagead/conversion/?x=1")).isTrue()
        assertThat(rules.matches("youtube.com", "/api/stats/ads?ver=2")).isTrue()
        assertThat(rules.matches("music.youtube.com", "/api/stats/ads?ver=2")).isTrue()
        assertThat(rules.matches("music.youtube.com", "/api/stats/adsense")).isFalse()
        assertThat(rules.matches("notyoutube.com", "/pagead/")).isFalse()
        assertThat(rules.matches("music.youtube.com", "/youtubei/v1/browse")).isFalse()
        assertThat(rules.matches("", "/pagead/")).isFalse()
    }

    @Test
    fun parsesTheShippedRules() {
        val file = File(System.getProperty("musix.hostsBin").orEmpty()).resolveSibling("url-rules.txt")
        val rules = UrlRules.parse(file.readText())
        assertThat(rules.size).isAtLeast(1)
        assertThat(rules.matches("music.youtube.com", "/youtubei/v1/player/ad_break?key=x")).isTrue()
        assertThat(rules.matches("music.youtube.com", "/youtubei/v1/player?key=x")).isFalse()
    }
}
