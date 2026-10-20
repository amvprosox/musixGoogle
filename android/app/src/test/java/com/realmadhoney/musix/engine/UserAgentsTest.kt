package com.realmadhoney.musix.engine

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class UserAgentsTest {
    @Test
    fun recognisesGoogleAccountHostsOnly() {
        assertThat(UserAgents.isAccountsHost("accounts.google.com")).isTrue()
        assertThat(UserAgents.isAccountsHost("ACCOUNTS.GOOGLE.CO.UK")).isTrue()
        assertThat(UserAgents.isAccountsHost("accounts.youtube.com")).isTrue()
        assertThat(UserAgents.isAccountsHost("music.youtube.com")).isFalse()
        assertThat(UserAgents.isAccountsHost("accounts.google.com.evil.example")).isFalse()
        assertThat(UserAgents.isAccountsHost(null)).isFalse()
    }

    @Test
    fun buildsADesktopChromeAgentFromTheWebViewVersion() {
        val webView =
            "Mozilla/5.0 (Linux; Android 15; Pixel 9; wv) AppleWebKit/537.36 (KHTML, like Gecko) " +
                "Version/4.0 Chrome/141.0.7390.55 Mobile Safari/537.36"
        assertThat(UserAgents.desktop(webView))
            .isEqualTo("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36")
    }
}
