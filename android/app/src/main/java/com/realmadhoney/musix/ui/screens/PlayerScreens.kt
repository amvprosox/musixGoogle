package com.realmadhoney.musix.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.media3.common.Player
import com.realmadhoney.musix.R
import com.realmadhoney.musix.core.bridge.FlatItem
import com.realmadhoney.musix.ui.NowPlaying
import com.realmadhoney.musix.ui.SaveTargets
import com.realmadhoney.musix.ui.components.Artwork
import com.realmadhoney.musix.ui.components.EntryRow
import com.realmadhoney.musix.ui.components.IconAction
import com.realmadhoney.musix.ui.components.MusixIcon
import com.realmadhoney.musix.ui.components.SecondaryButton
import com.realmadhoney.musix.ui.components.SkeletonRows
import com.realmadhoney.musix.ui.components.StateMessage
import com.realmadhoney.musix.ui.components.formatTime
import com.realmadhoney.musix.ui.theme.DesignTokens
import com.realmadhoney.musix.ui.theme.Musix

interface PlayerActions {
    fun togglePlay()

    fun next()

    fun previous()

    fun seekTo(positionMs: Long)

    fun toggleLike()

    fun toggleShuffle()

    fun cycleRepeat()

    fun retry()

    fun saveToPlaylist()
}

@Composable
fun MiniPlayer(
    state: NowPlaying,
    actions: PlayerActions,
    onOpen: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Musix.colors
    val openLabel = stringResource(R.string.action_open_player)
    val playLabel = stringResource(if (state.isPlaying) R.string.action_pause else R.string.action_play)
    Column(modifier = modifier.fillMaxWidth().background(colors.surface)) {
        val progress = if (state.durationMs > 0) (state.positionMs.toFloat() / state.durationMs).coerceIn(0f, 1f) else 0f
        Box(Modifier.fillMaxWidth().height(2.dp).background(colors.surface2)) {
            Box(Modifier.fillMaxWidth(progress).height(2.dp).background(colors.accent))
        }
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .height(DesignTokens.MiniPlayerHeight + 8.dp)
                    .clickable(enabled = state.hasTrack, role = Role.Button, onClickLabel = openLabel, onClick = onOpen)
                    .padding(horizontal = DesignTokens.Space12),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Artwork(if (state.hasTrack) state.artworkUri else null, 48.dp, corner = DesignTokens.RadiusCard)
            Spacer(Modifier.width(DesignTokens.Space12))
            Column(Modifier.weight(1f)) {
                Text(
                    if (state.hasTrack) {
                        state.title.ifEmpty {
                            stringResource(
                                R.string.playing_ad,
                            )
                        }
                    } else {
                        stringResource(R.string.nothing_playing)
                    },
                    style = MaterialTheme.typography.titleSmall,
                    color = colors.text,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Text(
                    if (state.hasTrack) state.artist else stringResource(R.string.mini_idle_body),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textMuted,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
            Box(
                modifier =
                    Modifier
                        .size(48.dp)
                        .clip(CircleShape)
                        .clickable(enabled = state.hasTrack, role = Role.Button, onClickLabel = playLabel, onClick = actions::togglePlay)
                        .semantics { contentDescription = playLabel },
                contentAlignment = Alignment.Center,
            ) {
                Box(
                    modifier =
                        Modifier
                            .size(44.dp)
                            .clip(CircleShape)
                            .background(if (state.hasTrack) colors.accent else colors.accent.copy(alpha = 0.6f)),
                    contentAlignment = Alignment.Center,
                ) {
                    MusixIcon(
                        if (state.isPlaying) R.drawable.ic_pause_filled else R.drawable.ic_play_filled,
                        null,
                        tint = colors.onAccent,
                        size = 20.dp,
                    )
                }
            }
            IconAction(
                R.drawable.ic_skip_forward,
                stringResource(R.string.action_next),
                actions::next,
                enabled = state.hasTrack && state.canSkip,
            )
        }
    }
}

@Composable
fun NowPlayingScreen(
    state: NowPlaying,
    actions: PlayerActions,
    onClose: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Musix.colors
    Column(modifier = modifier.fillMaxSize().background(colors.bg)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = DesignTokens.Space4, vertical = DesignTokens.Space8),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(R.drawable.ic_collapse, stringResource(R.string.action_collapse_player), onClose)
        }
        if (!state.hasTrack) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                StateMessage(
                    R.drawable.ic_music,
                    stringResource(R.string.nothing_playing),
                    state.error ?: stringResource(R.string.nothing_playing_body),
                    actionLabel = if (state.error != null) stringResource(R.string.action_retry) else null,
                    onAction = if (state.error != null) actions::retry else null,
                )
            }
            return
        }
        BoxWithConstraints(
            Modifier.fillMaxWidth().weight(1f).padding(horizontal = DesignTokens.Space24),
            contentAlignment = Alignment.Center,
        ) {
            val side = minOf(maxWidth, maxHeight, 420.dp)
            Artwork(state.artworkUri, side, corner = DesignTokens.RadiusCard)
        }
        Column(Modifier.fillMaxWidth().padding(horizontal = DesignTokens.Space24)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(
                        state.title.ifEmpty { stringResource(R.string.playing_ad) },
                        style = MaterialTheme.typography.headlineSmall,
                        color = colors.text,
                        maxLines = 2,
                        overflow = TextOverflow.Ellipsis,
                    )
                    val subtitle = listOf(state.artist, state.album).filter { it.isNotEmpty() }.joinToString(" • ")
                    if (subtitle.isNotEmpty()) {
                        Text(
                            subtitle,
                            style = MaterialTheme.typography.bodyLarge,
                            color = colors.textMuted,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                    }
                }
                IconAction(
                    R.drawable.ic_queue,
                    stringResource(R.string.action_save_to_playlist),
                    actions::saveToPlaylist,
                    enabled = state.canSeek,
                )
                IconAction(
                    if (state.liked) R.drawable.ic_heart_filled else R.drawable.ic_heart,
                    stringResource(if (state.liked) R.string.action_unlike else R.string.action_like),
                    actions::toggleLike,
                    active = state.liked,
                    enabled = state.canSeek,
                )
            }
            Spacer(Modifier.height(DesignTokens.Space16))
            SeekBar(state, actions)
            Spacer(Modifier.height(DesignTokens.Space8))
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconAction(
                    R.drawable.ic_shuffle,
                    stringResource(if (state.shuffle) R.string.action_shuffle_on else R.string.action_shuffle_off),
                    actions::toggleShuffle,
                    active = state.shuffle,
                    enabled = state.canSeek,
                )
                IconAction(
                    R.drawable.ic_skip_back,
                    stringResource(R.string.action_previous),
                    actions::previous,
                    enabled = state.canSkip,
                    iconSize = 28.dp,
                )
                val playLabel = stringResource(if (state.isPlaying) R.string.action_pause else R.string.action_play)
                Box(
                    modifier =
                        Modifier
                            .size(72.dp)
                            .clip(CircleShape)
                            .background(colors.accent)
                            .clickable(role = Role.Button, onClick = actions::togglePlay)
                            .semantics { contentDescription = playLabel },
                    contentAlignment = Alignment.Center,
                ) {
                    MusixIcon(
                        if (state.isPlaying) R.drawable.ic_pause_filled else R.drawable.ic_play_filled,
                        null,
                        tint = colors.onAccent,
                        size = 32.dp,
                    )
                }
                IconAction(
                    R.drawable.ic_skip_forward,
                    stringResource(R.string.action_next),
                    actions::next,
                    enabled = state.canSkip,
                    iconSize = 28.dp,
                )
                val repeatLabel =
                    stringResource(
                        when (state.repeatMode) {
                            Player.REPEAT_MODE_ALL -> R.string.action_repeat_all
                            Player.REPEAT_MODE_ONE -> R.string.action_repeat_one
                            else -> R.string.action_repeat_off
                        },
                    )
                IconAction(
                    if (state.repeatMode == Player.REPEAT_MODE_ONE) R.drawable.ic_repeat_one else R.drawable.ic_repeat,
                    repeatLabel,
                    actions::cycleRepeat,
                    active = state.repeatMode != Player.REPEAT_MODE_OFF,
                    enabled = state.canSeek,
                )
            }
            Spacer(Modifier.height(DesignTokens.Space32))
        }
    }
}

@Composable
private fun SeekBar(
    state: NowPlaying,
    actions: PlayerActions,
) {
    val colors = Musix.colors
    var dragging by remember { mutableStateOf<Float?>(null) }
    val duration = state.durationMs.coerceAtLeast(1L)
    val fraction = dragging ?: (state.positionMs.toFloat() / duration).coerceIn(0f, 1f)
    val shownPosition = if (dragging != null) (fraction * duration).toLong() else state.positionMs
    Slider(
        value = fraction,
        onValueChange = { dragging = it },
        onValueChangeFinished = {
            val target = dragging
            dragging = null
            if (target != null) {
                actions.seekTo((target * duration).toLong())
            }
        },
        enabled = state.canSeek && state.durationMs > 0,
        colors =
            SliderDefaults.colors(
                thumbColor = colors.accent,
                activeTrackColor = colors.accent,
                inactiveTrackColor = colors.border,
            ),
        modifier =
            Modifier
                .fillMaxWidth()
                .semantics { stateDescription = "${formatTime(shownPosition)} of ${formatTime(state.durationMs)}" },
    )
    Row(Modifier.fillMaxWidth()) {
        Text(
            formatTime(shownPosition),
            style = MaterialTheme.typography.bodyMedium,
            color = colors.textMuted,
            modifier = Modifier.weight(1f),
        )
        Text(
            if (state.durationMs > 0) formatTime(state.durationMs) else "",
            style = MaterialTheme.typography.bodyMedium,
            color = colors.textMuted,
            textAlign = TextAlign.End,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
fun SaveToPlaylistDialog(
    targets: SaveTargets,
    onPick: (String, FlatItem) -> Unit,
    onRetry: () -> Unit,
    onDismiss: () -> Unit,
) {
    val colors = Musix.colors
    Dialog(onDismissRequest = onDismiss) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .heightIn(max = 520.dp)
                    .clip(RoundedCornerShape(DesignTokens.RadiusCard))
                    .background(colors.surface)
                    .padding(vertical = DesignTokens.Space16),
        ) {
            Text(
                stringResource(R.string.action_save_to_playlist),
                style = MaterialTheme.typography.titleLarge,
                color = colors.text,
                modifier = Modifier.padding(horizontal = DesignTokens.Space16, vertical = DesignTokens.Space8),
            )
            when (targets) {
                SaveTargets.Loading -> {
                    SkeletonRows(4)
                }

                is SaveTargets.Failed -> {
                    StateMessage(
                        R.drawable.ic_alert,
                        stringResource(R.string.save_failed),
                        targets.message,
                        actionLabel = stringResource(R.string.action_retry),
                        onAction = onRetry,
                    )
                }

                is SaveTargets.Loaded -> {
                    if (targets.items.isEmpty()) {
                        StateMessage(R.drawable.ic_list_music, stringResource(R.string.save_none), stringResource(R.string.save_none_body))
                    } else {
                        LazyColumn {
                            items(targets.items, key = { it.id }) { item ->
                                EntryRow(
                                    title = item.title,
                                    subtitle = item.subtitle,
                                    artwork = null,
                                    browsable = false,
                                    onClick = { onPick(targets.videoId, item) },
                                    fallback = R.drawable.ic_list_music,
                                )
                            }
                        }
                    }
                }
            }
            Row(Modifier.fillMaxWidth().padding(horizontal = DesignTokens.Space16), horizontalArrangement = Arrangement.End) {
                SecondaryButton(stringResource(R.string.action_cancel), onDismiss)
            }
        }
    }
}
