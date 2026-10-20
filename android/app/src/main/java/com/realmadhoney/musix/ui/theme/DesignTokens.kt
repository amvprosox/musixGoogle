package com.realmadhoney.musix.ui.theme

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

object DesignTokens {
    const val FONT_HEADING = "Sora"
    const val FONT_BODY = "Manrope"
    const val LINE_HEIGHT_BODY = 1.5f
    const val LINE_HEIGHT_HEADING = 1.25f
    const val MOTION_HOVER_MS = 150
    const val MOTION_DRAWER_MS = 200
    const val MOTION_SCROLLBAR_IN_MS = 150
    const val MOTION_SCROLLBAR_OUT_MS = 800

    val Text14 = 14.sp
    val Text16 = 16.sp
    val Text18 = 18.sp
    val Text20 = 20.sp
    val Text24 = 24.sp
    val Text30 = 30.sp
    val Text36 = 36.sp
    val Space4 = 4.dp
    val Space8 = 8.dp
    val Space12 = 12.dp
    val Space16 = 16.dp
    val Space24 = 24.dp
    val Space32 = 32.dp
    val Space48 = 48.dp
    val RadiusControl = 8.dp
    val RadiusCard = 12.dp
    val ControlHeight = 40.dp
    val IconButton = 40.dp
    val MiniPlayerHeight = 64.dp
    val BottomNavHeight = 64.dp
    val ScrollbarSize = 10.dp

    object Dark {
        val bg = Color(0xFF0F1420)
        val surface = Color(0xFF161C2A)
        val surface2 = Color(0xFF1C2333)
        val surfaceHover = Color(0xFF242C3F)
        val border = Color(0xFF2A3247)
        val text = Color(0xFFE8EBF3)
        val textMuted = Color(0xFFA3ABBF)
        val accent = Color(0xFF8B90FF)
        val accentHover = Color(0xFFA2A6FF)
        val accentSoft = Color(0xFF23284A)
        val onAccent = Color(0xFF0B0F1D)
        val success = Color(0xFF4ADE80)
        val warning = Color(0xFFFBBF24)
        val danger = Color(0xFFF87171)
        val focusRing = Color(0xFFA2A6FF)
        val skeleton = Color(0xFF222A3C)
        val scrollbarThumb = Color(0xFF3A4560)
        val scrollbarThumbHover = Color(0xFF56627F)
    }

    object Light {
        val bg = Color(0xFFF5F6FA)
        val surface = Color(0xFFFFFFFF)
        val surface2 = Color(0xFFF0F2F8)
        val surfaceHover = Color(0xFFE7EAF3)
        val border = Color(0xFFDDE1EB)
        val text = Color(0xFF111727)
        val textMuted = Color(0xFF525C74)
        val accent = Color(0xFF4F46E5)
        val accentHover = Color(0xFF4338CA)
        val accentSoft = Color(0xFFEBE9FE)
        val onAccent = Color(0xFFFFFFFF)
        val success = Color(0xFF15803D)
        val warning = Color(0xFFA15C07)
        val danger = Color(0xFFC81E1E)
        val focusRing = Color(0xFF4F46E5)
        val skeleton = Color(0xFFE6E9F1)
        val scrollbarThumb = Color(0xFFC3C9D6)
        val scrollbarThumbHover = Color(0xFF9AA3B8)
    }
}
