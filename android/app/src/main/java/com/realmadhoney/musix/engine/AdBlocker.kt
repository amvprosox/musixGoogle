package com.realmadhoney.musix.engine

import android.content.res.AssetManager
import android.net.Uri
import android.util.Log
import com.realmadhoney.musix.core.adblock.HostSet
import com.realmadhoney.musix.core.adblock.UrlRules
import java.io.IOException
import java.util.concurrent.atomic.AtomicLong

class AdBlocker(
    private val hosts: HostSet,
    private val rules: UrlRules,
) {
    private val blocked = AtomicLong(0)

    val blockedCount: Long get() = blocked.get()

    val ruleCount: Int get() = hosts.size + rules.size

    fun shouldBlock(uri: Uri): Boolean {
        val host = uri.host ?: return false
        if (host.isEmpty()) {
            return false
        }
        val path = (uri.encodedPath ?: "/") + (uri.encodedQuery?.let { "?$it" } ?: "")
        val block = hosts.matches(host) || rules.matches(host, path)
        if (block) {
            blocked.incrementAndGet()
        }
        return block
    }

    companion object {
        private const val TAG = "MusixAdBlocker"
        const val HOSTS_ASSET = "adblock/hosts.bin"
        const val RULES_ASSET = "adblock/url-rules.txt"

        val DISABLED = AdBlocker(HostSet.EMPTY, UrlRules.EMPTY)

        fun load(assets: AssetManager): AdBlocker {
            val hosts =
                try {
                    assets.open(HOSTS_ASSET).use { HostSet.parse(it.readBytes()) }
                } catch (error: IOException) {
                    Log.e(TAG, "Could not read the host blocklist", error)
                    HostSet.EMPTY
                } catch (error: IllegalArgumentException) {
                    Log.e(TAG, "The host blocklist is corrupt", error)
                    HostSet.EMPTY
                }
            val rules =
                try {
                    assets.open(RULES_ASSET).use { UrlRules.parse(it.readBytes().toString(Charsets.UTF_8)) }
                } catch (error: IOException) {
                    Log.e(TAG, "Could not read the URL rules", error)
                    UrlRules.EMPTY
                }
            return AdBlocker(hosts, rules)
        }
    }
}
