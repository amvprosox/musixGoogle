package com.realmadhoney.musix.engine

import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse

fun interface LocalContent {
    fun respond(request: WebResourceRequest): WebResourceResponse?
}

data class EngineConfig(
    val homeUrl: String = "https://music.youtube.com/",
    val allowedOrigins: Set<String> = setOf("https://music.youtube.com"),
    val navigationHosts: Set<String> = DEFAULT_NAVIGATION_HOSTS,
    val useMessageListener: Boolean = true,
    val desktopUserAgent: Boolean = true,
    val localContent: LocalContent? = null,
) {
    val signInUrl: String
        get() =
            "https://accounts.google.com/ServiceLogin?service=youtube&passive=true&continue=" +
                java.net.URLEncoder.encode(homeUrl, "UTF-8")

    fun isAllowedNavigation(host: String?): Boolean {
        val normalized = host?.lowercase() ?: return false
        return navigationHosts.any { normalized == it } || allowedOrigins.any { originHost(it) == normalized }
    }

    fun isAllowedOrigin(url: String?): Boolean {
        if (url == null) {
            return false
        }
        return allowedOrigins.any { origin -> url == origin || url.startsWith("$origin/") || url.startsWith("$origin?") }
    }

    private fun originHost(origin: String): String =
        origin
            .substringAfter("://")
            .substringBefore('/')
            .substringBefore(':')
            .lowercase()

    companion object {
        val DEFAULT_NAVIGATION_HOSTS: Set<String> =
            setOf(
                "music.youtube.com",
                "www.youtube.com",
                "youtube.com",
                "m.youtube.com",
                "accounts.google.com",
                "accounts.youtube.com",
                "consent.youtube.com",
                "consent.google.com",
                "myaccount.google.com",
                "www.google.com",
            )
    }
}
