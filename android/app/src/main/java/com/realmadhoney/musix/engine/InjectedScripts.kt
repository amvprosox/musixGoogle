package com.realmadhoney.musix.engine

import android.content.res.AssetManager
import com.realmadhoney.musix.core.bridge.BridgeCodec
import kotlinx.serialization.builtins.serializer
import java.io.IOException

data class InjectedScripts(
    val bridge: String,
    val scriptlets: String,
    val cosmeticCss: String,
) {
    val cosmeticInstaller: String
        get() {
            val css = BridgeCodec.json.encodeToString(String.serializer(), cosmeticCss)
            return "(function(){var css=$css;var id='musix-cosmetic';" +
                "function add(){if(document.getElementById(id)){return;}var root=document.head||document.documentElement;" +
                "if(!root){return;}var style=document.createElement('style');style.id=id;style.textContent=css;root.appendChild(style);}" +
                "add();document.addEventListener('readystatechange',add);document.addEventListener('DOMContentLoaded',add);})();"
        }

    fun messageShim(listenerName: String): String =
        "(function(){var target=window['$listenerName'];if(!target||typeof target.postMessage!=='function'){return;}" +
            "Object.defineProperty(window,'AndroidBridge',{configurable:false,enumerable:false,writable:false," +
            "value:Object.freeze({receive:function(json){target.postMessage(String(json));}})});})();"

    companion object {
        const val BRIDGE_ASSET = "web/ytm-bridge.js"
        const val SCRIPTLETS_ASSET = "adblock/scriptlets.js"
        const val COSMETIC_ASSET = "adblock/cosmetic.css"

        fun load(assets: AssetManager): InjectedScripts {
            fun read(path: String): String = assets.open(path).use { it.readBytes().toString(Charsets.UTF_8) }
            val bridge = read(BRIDGE_ASSET)
            if (bridge.isBlank()) {
                throw IOException("The bridge script is empty")
            }
            val scriptlets =
                try {
                    read(SCRIPTLETS_ASSET)
                } catch (error: IOException) {
                    ""
                }
            val css =
                try {
                    read(COSMETIC_ASSET)
                } catch (error: IOException) {
                    ""
                }
            return InjectedScripts(bridge, scriptlets, css)
        }
    }
}
