package com.realmadhoney.musix.ui.screens

import android.os.SystemClock
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.realmadhoney.musix.R
import com.realmadhoney.musix.core.bridge.Lyrics
import com.realmadhoney.musix.ui.LyricsState
import com.realmadhoney.musix.ui.components.StateMessage
import com.realmadhoney.musix.ui.theme.DesignTokens
import com.realmadhoney.musix.ui.theme.Musix
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive

private const val LYRIC_LEAD_MS = 150L
private const val POSITION_POLL_MS = 50L
private const val USER_SCROLL_HOLD_MS = 3_500L

@Composable
fun LyricsView(
    state: LyricsState,
    isPlaying: Boolean,
    positionMs: () -> Long,
    onSeek: (Long) -> Unit,
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    when (state) {
        LyricsState.Idle, is LyricsState.Loading -> {
            Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Text(
                    stringResource(R.string.lyrics_loading),
                    style = MaterialTheme.typography.bodyLarge,
                    color = Musix.colors.textMuted,
                )
            }
        }

        is LyricsState.Missing -> {
            Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                StateMessage(R.drawable.ic_lyrics, stringResource(R.string.lyrics_missing), stringResource(R.string.lyrics_missing_body))
            }
        }

        is LyricsState.Failed -> {
            Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                StateMessage(
                    R.drawable.ic_wifi_off,
                    stringResource(R.string.lyrics_failed),
                    state.message,
                    actionLabel = stringResource(R.string.action_retry),
                    onAction = onRetry,
                )
            }
        }

        is LyricsState.Found -> {
            if (state.lyrics.instrumental || state.lyrics.lines.isEmpty()) {
                Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    StateMessage(
                        R.drawable.ic_music,
                        stringResource(R.string.lyrics_instrumental),
                        stringResource(R.string.lyrics_instrumental_body),
                    )
                }
            } else {
                LyricLines(state.lyrics, isPlaying, positionMs, onSeek, modifier)
            }
        }
    }
}

@Composable
private fun LyricLines(
    lyrics: Lyrics,
    isPlaying: Boolean,
    positionMs: () -> Long,
    onSeek: (Long) -> Unit,
    modifier: Modifier,
) {
    val colors = Musix.colors
    val listState = rememberLazyListState()
    var position by remember(lyrics) { mutableLongStateOf(positionMs()) }
    var touchedAt by remember(lyrics) { mutableLongStateOf(0L) }
    val active by remember(lyrics) { derivedStateOf { lyrics.activeIndex((position + LYRIC_LEAD_MS).toDouble()) } }
    LaunchedEffect(lyrics, isPlaying) {
        while (isActive) {
            position = positionMs()
            delay(if (isPlaying) POSITION_POLL_MS else POSITION_POLL_MS * 5)
        }
    }
    LaunchedEffect(lyrics, active) {
        if (!lyrics.synced || active < 0) {
            return@LaunchedEffect
        }
        val held = SystemClock.uptimeMillis() - touchedAt
        if (held < USER_SCROLL_HOLD_MS || listState.isScrollInProgress) {
            return@LaunchedEffect
        }
        val viewport = listState.layoutInfo.viewportSize.height
        listState.animateScrollToItem(active, -(viewport / 3))
    }
    val footer =
        buildList {
            if (!lyrics.synced) {
                add(stringResource(R.string.lyrics_unsynced))
            }
            add(stringResource(R.string.lyrics_source, lyrics.source))
        }
    LazyColumn(
        state = listState,
        contentPadding = PaddingValues(vertical = DesignTokens.Space32),
        modifier =
            modifier
                .fillMaxSize()
                .pointerInput(lyrics) {
                    awaitEachGesture {
                        awaitFirstDown(requireUnconsumed = false)
                        touchedAt = SystemClock.uptimeMillis()
                    }
                },
    ) {
        itemsIndexed(lyrics.lines, key = { index, _ -> index }) { index, line ->
            val target =
                when {
                    !lyrics.synced -> colors.text
                    index == active -> colors.text
                    index < active -> colors.textMuted.copy(alpha = 0.55f)
                    else -> colors.textMuted
                }
            val color by animateColorAsState(target, tween(180), label = "lyric")
            val seekLabel = stringResource(R.string.lyrics_seek)
            Text(
                line.text,
                style =
                    MaterialTheme.typography.headlineSmall.copy(
                        fontWeight = if (lyrics.synced) FontWeight.Bold else FontWeight.SemiBold,
                    ),
                color = color,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clickable(enabled = lyrics.synced, role = Role.Button, onClickLabel = seekLabel) {
                            touchedAt = 0L
                            onSeek(line.timeMs.toLong())
                        }.padding(vertical = if (line.text.isEmpty()) DesignTokens.Space8 else 6.dp),
            )
        }
        items(footer.size) { index ->
            Text(
                footer[index],
                style = MaterialTheme.typography.bodyMedium,
                color = colors.textMuted,
                modifier = Modifier.padding(top = if (index == 0) DesignTokens.Space24 else DesignTokens.Space4),
            )
        }
    }
}
