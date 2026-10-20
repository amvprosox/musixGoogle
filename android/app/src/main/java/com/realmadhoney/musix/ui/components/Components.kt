package com.realmadhoney.musix.ui.components

import android.net.Uri
import androidx.annotation.DrawableRes
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.SubcomposeAsyncImage
import com.realmadhoney.musix.R
import com.realmadhoney.musix.ui.theme.DesignTokens
import com.realmadhoney.musix.ui.theme.Musix

@Composable
fun MusixIcon(
    @DrawableRes icon: Int,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    tint: Color = Musix.colors.text,
    size: Dp = 24.dp,
) {
    Icon(
        painter = painterResource(icon),
        contentDescription = contentDescription,
        tint = tint,
        modifier = modifier.size(size),
    )
}

@Composable
fun IconAction(
    @DrawableRes icon: Int,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    enabled: Boolean = true,
    active: Boolean = false,
    size: Dp = 48.dp,
    iconSize: Dp = 24.dp,
) {
    val colors = Musix.colors
    val tint =
        when {
            !enabled -> colors.textMuted.copy(alpha = 0.5f)
            active -> colors.accent
            else -> colors.text
        }
    Box(
        modifier =
            modifier
                .size(size)
                .clip(CircleShape)
                .clickable(enabled = enabled, role = Role.Button, onClickLabel = label, onClick = onClick)
                .semantics { contentDescription = label },
        contentAlignment = Alignment.Center,
    ) {
        MusixIcon(icon, null, tint = tint, size = iconSize)
    }
}

@Composable
fun Artwork(
    uri: Uri?,
    size: Dp,
    modifier: Modifier = Modifier,
    @DrawableRes fallback: Int = R.drawable.ic_music,
    corner: Dp = DesignTokens.RadiusControl,
) {
    val colors = Musix.colors
    val shape = RoundedCornerShape(corner)
    val placeholder: @Composable () -> Unit = {
        Box(
            modifier = Modifier.fillMaxSize().background(colors.surface2),
            contentAlignment = Alignment.Center,
        ) {
            MusixIcon(fallback, null, tint = colors.textMuted, size = (size.value * 0.4f).dp)
        }
    }
    Box(modifier = modifier.size(size).clip(shape).border(1.dp, colors.border, shape)) {
        if (uri == null || uri.scheme == "android.resource") {
            placeholder()
        } else {
            SubcomposeAsyncImage(
                model = uri,
                contentDescription = null,
                contentScale = ContentScale.Crop,
                modifier = Modifier.fillMaxSize(),
                loading = { placeholder() },
                error = { placeholder() },
            )
        }
    }
}

@Composable
fun EntryRow(
    title: String,
    subtitle: String,
    artwork: Uri?,
    browsable: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    @DrawableRes fallback: Int = R.drawable.ic_music,
) {
    val colors = Musix.colors
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .clickable(role = Role.Button, onClick = onClick)
                .padding(horizontal = DesignTokens.Space16, vertical = DesignTokens.Space8),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Artwork(artwork, 56.dp, fallback = fallback)
        Spacer(Modifier.width(DesignTokens.Space12))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.titleSmall,
                color = colors.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
            if (subtitle.isNotEmpty()) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        if (browsable) {
            MusixIcon(
                R.drawable.ic_forward,
                null,
                tint = colors.textMuted,
                modifier = Modifier.padding(start = DesignTokens.Space8),
                size = 20.dp,
            )
        }
    }
}

@Composable
fun SectionHeader(
    text: String,
    modifier: Modifier = Modifier,
) {
    Text(
        text = text,
        style = MaterialTheme.typography.titleMedium,
        color = Musix.colors.text,
        modifier =
            modifier
                .fillMaxWidth()
                .padding(start = DesignTokens.Space16, end = DesignTokens.Space16, top = DesignTokens.Space24, bottom = DesignTokens.Space8)
                .semantics { heading() },
    )
}

@Composable
fun StateMessage(
    @DrawableRes icon: Int,
    title: String,
    body: String?,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val colors = Musix.colors
    Column(
        modifier = modifier.fillMaxWidth().padding(DesignTokens.Space32),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        MusixIcon(icon, null, tint = colors.textMuted, size = 40.dp)
        Spacer(Modifier.height(DesignTokens.Space16))
        Text(title, style = MaterialTheme.typography.titleMedium, color = colors.text, textAlign = TextAlign.Center)
        if (!body.isNullOrBlank()) {
            Spacer(Modifier.height(DesignTokens.Space8))
            Text(body, style = MaterialTheme.typography.bodyMedium, color = colors.textMuted, textAlign = TextAlign.Center)
        }
        if (actionLabel != null && onAction != null) {
            Spacer(Modifier.height(DesignTokens.Space24))
            PrimaryButton(actionLabel, onAction)
        }
    }
}

@Composable
fun PrimaryButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    @DrawableRes icon: Int? = null,
    enabled: Boolean = true,
) {
    val colors = Musix.colors
    Row(
        modifier =
            modifier
                .height(48.dp)
                .clip(RoundedCornerShape(24.dp))
                .background(if (enabled) colors.accent else colors.surface2)
                .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
                .padding(horizontal = DesignTokens.Space24),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) {
            MusixIcon(icon, null, tint = if (enabled) colors.onAccent else colors.textMuted, size = 20.dp)
            Spacer(Modifier.width(DesignTokens.Space8))
        }
        Text(label, style = MaterialTheme.typography.labelLarge, color = if (enabled) colors.onAccent else colors.textMuted)
    }
}

@Composable
fun SecondaryButton(
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    @DrawableRes icon: Int? = null,
    danger: Boolean = false,
) {
    val colors = Musix.colors
    val content = if (danger) colors.danger else colors.text
    Row(
        modifier =
            modifier
                .height(48.dp)
                .clip(RoundedCornerShape(24.dp))
                .border(1.dp, colors.border, RoundedCornerShape(24.dp))
                .clickable(role = Role.Button, onClick = onClick)
                .padding(horizontal = DesignTokens.Space24),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.Center,
    ) {
        if (icon != null) {
            MusixIcon(icon, null, tint = content, size = 20.dp)
            Spacer(Modifier.width(DesignTokens.Space8))
        }
        Text(label, style = MaterialTheme.typography.labelLarge, color = content)
    }
}

@Composable
fun Banner(
    @DrawableRes icon: Int,
    text: String,
    modifier: Modifier = Modifier,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null,
) {
    val colors = Musix.colors
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .padding(horizontal = DesignTokens.Space16, vertical = DesignTokens.Space8)
                .clip(RoundedCornerShape(DesignTokens.RadiusCard))
                .background(colors.surface2)
                .padding(horizontal = DesignTokens.Space16, vertical = DesignTokens.Space12),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MusixIcon(icon, null, tint = colors.warning, size = 20.dp)
        Spacer(Modifier.width(DesignTokens.Space12))
        Text(text, style = MaterialTheme.typography.bodyMedium, color = colors.text, modifier = Modifier.weight(1f))
        if (actionLabel != null && onAction != null) {
            Text(
                text = actionLabel,
                style = MaterialTheme.typography.labelLarge,
                color = colors.accent,
                modifier =
                    Modifier
                        .clip(RoundedCornerShape(DesignTokens.RadiusControl))
                        .clickable(role = Role.Button, onClick = onAction)
                        .padding(DesignTokens.Space8),
            )
        }
    }
}

@Composable
fun LoadingState(
    label: String,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier.fillMaxWidth().padding(DesignTokens.Space32),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        CircularProgressIndicator(color = Musix.colors.accent, modifier = Modifier.size(32.dp))
        Spacer(Modifier.height(DesignTokens.Space12))
        Text(label, style = MaterialTheme.typography.bodyMedium, color = Musix.colors.textMuted)
    }
}

@Composable
fun SkeletonRows(
    count: Int,
    modifier: Modifier = Modifier,
) {
    val colors = Musix.colors
    Column(modifier = modifier.fillMaxWidth()) {
        repeat(count) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = DesignTokens.Space16, vertical = DesignTokens.Space8),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Box(Modifier.size(56.dp).clip(RoundedCornerShape(DesignTokens.RadiusControl)).background(colors.skeleton))
                Spacer(Modifier.width(DesignTokens.Space12))
                Column(Modifier.weight(1f)) {
                    Box(
                        Modifier
                            .fillMaxWidth(0.6f)
                            .height(16.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(colors.skeleton),
                    )
                    Spacer(Modifier.height(DesignTokens.Space8))
                    Box(
                        Modifier
                            .fillMaxWidth(0.4f)
                            .height(14.dp)
                            .clip(RoundedCornerShape(4.dp))
                            .background(colors.skeleton),
                    )
                }
            }
        }
    }
}

fun formatTime(ms: Long): String {
    val totalSeconds = (ms / 1000).coerceAtLeast(0)
    val hours = totalSeconds / 3600
    val minutes = (totalSeconds % 3600) / 60
    val seconds = totalSeconds % 60
    return if (hours > 0) "%d:%02d:%02d".format(hours, minutes, seconds) else "%d:%02d".format(minutes, seconds)
}
