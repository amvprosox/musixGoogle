package com.realmadhoney.musix.engine

import android.content.Context
import android.view.View
import android.webkit.WebView

class MusixWebView(
    context: Context,
) : WebView(context) {
    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(View.VISIBLE)
    }
}
