package com.realmadhoney.musix.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.em
import com.realmadhoney.musix.R

val Sora =
    FontFamily(
        Font(R.font.sora, FontWeight.Normal),
        Font(R.font.sora, FontWeight.SemiBold),
        Font(R.font.sora, FontWeight.Bold),
    )

val Manrope =
    FontFamily(
        Font(R.font.manrope, FontWeight.Normal),
        Font(R.font.manrope, FontWeight.Medium),
        Font(R.font.manrope, FontWeight.SemiBold),
        Font(R.font.manrope, FontWeight.Bold),
    )

@Immutable
data class MusixColors(
    val bg: Color,
    val surface: Color,
    val surface2: Color,
    val surfaceHover: Color,
    val border: Color,
    val text: Color,
    val textMuted: Color,
    val accent: Color,
    val accentSoft: Color,
    val onAccent: Color,
    val success: Color,
    val warning: Color,
    val danger: Color,
    val skeleton: Color,
)

val DarkColors =
    MusixColors(
        bg = DesignTokens.Dark.bg,
        surface = DesignTokens.Dark.surface,
        surface2 = DesignTokens.Dark.surface2,
        surfaceHover = DesignTokens.Dark.surfaceHover,
        border = DesignTokens.Dark.border,
        text = DesignTokens.Dark.text,
        textMuted = DesignTokens.Dark.textMuted,
        accent = DesignTokens.Dark.accent,
        accentSoft = DesignTokens.Dark.accentSoft,
        onAccent = DesignTokens.Dark.onAccent,
        success = DesignTokens.Dark.success,
        warning = DesignTokens.Dark.warning,
        danger = DesignTokens.Dark.danger,
        skeleton = DesignTokens.Dark.skeleton,
    )

val LightColors =
    MusixColors(
        bg = DesignTokens.Light.bg,
        surface = DesignTokens.Light.surface,
        surface2 = DesignTokens.Light.surface2,
        surfaceHover = DesignTokens.Light.surfaceHover,
        border = DesignTokens.Light.border,
        text = DesignTokens.Light.text,
        textMuted = DesignTokens.Light.textMuted,
        accent = DesignTokens.Light.accent,
        accentSoft = DesignTokens.Light.accentSoft,
        onAccent = DesignTokens.Light.onAccent,
        success = DesignTokens.Light.success,
        warning = DesignTokens.Light.warning,
        danger = DesignTokens.Light.danger,
        skeleton = DesignTokens.Light.skeleton,
    )

val LocalMusixColors = staticCompositionLocalOf { DarkColors }

private fun style(
    family: FontFamily,
    weight: FontWeight,
    size: TextUnit,
    lineHeight: Float,
): TextStyle = TextStyle(fontFamily = family, fontWeight = weight, fontSize = size, lineHeight = lineHeight.em)

val MusixTypography =
    Typography(
        displaySmall = style(Sora, FontWeight.Bold, DesignTokens.Text30, DesignTokens.LINE_HEIGHT_HEADING),
        headlineMedium = style(Sora, FontWeight.Bold, DesignTokens.Text24, DesignTokens.LINE_HEIGHT_HEADING),
        headlineSmall = style(Sora, FontWeight.SemiBold, DesignTokens.Text20, DesignTokens.LINE_HEIGHT_HEADING),
        titleLarge = style(Sora, FontWeight.SemiBold, DesignTokens.Text20, DesignTokens.LINE_HEIGHT_HEADING),
        titleMedium = style(Sora, FontWeight.SemiBold, DesignTokens.Text18, DesignTokens.LINE_HEIGHT_HEADING),
        titleSmall = style(Manrope, FontWeight.SemiBold, DesignTokens.Text16, DesignTokens.LINE_HEIGHT_BODY),
        bodyLarge = style(Manrope, FontWeight.Normal, DesignTokens.Text16, DesignTokens.LINE_HEIGHT_BODY),
        bodyMedium = style(Manrope, FontWeight.Normal, DesignTokens.Text14, DesignTokens.LINE_HEIGHT_BODY),
        bodySmall = style(Manrope, FontWeight.Normal, DesignTokens.Text14, DesignTokens.LINE_HEIGHT_BODY),
        labelLarge = style(Manrope, FontWeight.SemiBold, DesignTokens.Text16, DesignTokens.LINE_HEIGHT_BODY),
        labelMedium = style(Manrope, FontWeight.SemiBold, DesignTokens.Text14, DesignTokens.LINE_HEIGHT_BODY),
        labelSmall = style(Manrope, FontWeight.Medium, DesignTokens.Text14, DesignTokens.LINE_HEIGHT_BODY),
    )

private fun scheme(
    colors: MusixColors,
    dark: Boolean,
): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = colors.accent,
        onPrimary = colors.onAccent,
        primaryContainer = colors.accentSoft,
        onPrimaryContainer = colors.text,
        secondary = colors.accent,
        onSecondary = colors.onAccent,
        background = colors.bg,
        onBackground = colors.text,
        surface = colors.surface,
        onSurface = colors.text,
        surfaceVariant = colors.surface2,
        onSurfaceVariant = colors.textMuted,
        surfaceContainer = colors.surface,
        surfaceContainerHigh = colors.surface2,
        surfaceContainerHighest = colors.surfaceHover,
        surfaceContainerLow = colors.surface,
        surfaceContainerLowest = colors.bg,
        outline = colors.border,
        outlineVariant = colors.border,
        error = colors.danger,
        onError = colors.onAccent,
    )
}

@Composable
fun MusixTheme(
    dark: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit,
) {
    val colors = if (dark) DarkColors else LightColors
    androidx.compose.runtime.CompositionLocalProvider(LocalMusixColors provides colors) {
        MaterialTheme(
            colorScheme = scheme(colors, dark),
            typography = MusixTypography,
            shapes =
                Shapes(
                    small = RoundedCornerShape(DesignTokens.RadiusControl),
                    medium = RoundedCornerShape(DesignTokens.RadiusCard),
                    large = RoundedCornerShape(DesignTokens.RadiusCard),
                ),
            content = content,
        )
    }
}

object Musix {
    val colors: MusixColors
        @Composable get() = LocalMusixColors.current
}
