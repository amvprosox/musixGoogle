package com.realmadhoney.musix.engine

import android.annotation.SuppressLint
import android.graphics.Bitmap
import android.util.Log
import android.webkit.ConsoleMessage
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import java.io.ByteArrayInputStream

@SuppressLint("MissingOnRenderProcessGone")
internal class EngineClient(
    private val engine: WebEngine,
) : WebViewClient() {
    override fun shouldInterceptRequest(
        view: WebView,
        request: WebResourceRequest,
    ): WebResourceResponse? {
        engine.localContent(request)?.let { return it }
        if (request.isForMainFrame) {
            return null
        }
        return if (engine.shouldBlock(request.url)) blockedResponse() else null
    }

    override fun shouldOverrideUrlLoading(
        view: WebView,
        request: WebResourceRequest,
    ): Boolean {
        if (!request.isForMainFrame) {
            return false
        }
        val url = request.url
        val scheme = url.scheme?.lowercase()
        if (scheme != "https") {
            if (scheme == "http" || scheme == "intent" || scheme == "market") {
                engine.onExternalLink(url.toString())
            }
            return true
        }
        if (engine.isAllowedNavigation(url.host)) {
            if (engine.switchAgent(view, url.host)) {
                view.loadUrl(url.toString())
                return true
            }
            return false
        }
        engine.onExternalLink(url.toString())
        return true
    }

    override fun onPageStarted(
        view: WebView,
        url: String?,
        favicon: Bitmap?,
    ) {
        engine.onPageStarted(url)
    }

    override fun onReceivedError(
        view: WebView,
        request: WebResourceRequest,
        error: WebResourceError,
    ) {
        if (!request.isForMainFrame) {
            return
        }
        val offline =
            error.errorCode == ERROR_HOST_LOOKUP ||
                error.errorCode == ERROR_CONNECT ||
                error.errorCode == ERROR_TIMEOUT ||
                error.errorCode == ERROR_IO
        engine.onMainFrameError(offline, error.description?.toString() ?: "error ${error.errorCode}")
    }

    override fun onReceivedHttpError(
        view: WebView,
        request: WebResourceRequest,
        errorResponse: WebResourceResponse,
    ) {
        if (request.isForMainFrame && errorResponse.statusCode >= 500) {
            engine.onMainFrameError(false, "HTTP ${errorResponse.statusCode}")
        }
    }

    override fun onRenderProcessGone(
        view: WebView,
        detail: RenderProcessGoneDetail,
    ): Boolean {
        engine.onRendererGone(detail.didCrash())
        return true
    }

    private fun blockedResponse(): WebResourceResponse =
        WebResourceResponse(
            "text/plain",
            "utf-8",
            403,
            "Blocked",
            mapOf("Cache-Control" to "no-store"),
            ByteArrayInputStream(ByteArray(0)),
        )
}

internal class EngineChromeClient : WebChromeClient() {
    override fun onConsoleMessage(message: ConsoleMessage): Boolean {
        if (message.messageLevel() == ConsoleMessage.MessageLevel.ERROR) {
            Log.d(TAG, "${message.sourceId()}:${message.lineNumber()} ${message.message()}")
        }
        return true
    }

    override fun onJsAlert(
        view: WebView,
        url: String?,
        message: String?,
        result: JsResult,
    ): Boolean {
        result.confirm()
        return true
    }

    override fun onJsConfirm(
        view: WebView,
        url: String?,
        message: String?,
        result: JsResult,
    ): Boolean {
        result.cancel()
        return true
    }

    override fun onJsPrompt(
        view: WebView,
        url: String?,
        message: String?,
        defaultValue: String?,
        result: JsPromptResult,
    ): Boolean {
        result.cancel()
        return true
    }

    private companion object {
        const val TAG = "MusixPage"
    }
}

object UserAgents {
    private val CHROME = Regex("Chrome/([0-9.]+)")
    private val ACCOUNT_HOSTS = listOf(Regex("^accounts\\.google\\.[a-z]{2,3}(\\.[a-z]{2})?$"), Regex("^accounts\\.youtube\\.com$"))

    fun isAccountsHost(host: String?): Boolean {
        val normalized = host?.lowercase() ?: return false
        return ACCOUNT_HOSTS.any { it.matches(normalized) }
    }

    fun desktop(webViewAgent: String): String {
        val version = CHROME.find(webViewAgent)?.groupValues?.getOrNull(1) ?: "131.0.0.0"
        val major = version.substringBefore('.')
        return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/$major.0.0.0 Safari/537.36"
    }
}
