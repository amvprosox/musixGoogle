package com.realmadhoney.musix.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.media3.common.MediaMetadata
import com.realmadhoney.musix.R
import com.realmadhoney.musix.core.browse.MediaIds
import com.realmadhoney.musix.core.browse.RootTab
import com.realmadhoney.musix.engine.EngineStatus
import com.realmadhoney.musix.ui.BrowseEntry
import com.realmadhoney.musix.ui.ListState
import com.realmadhoney.musix.ui.PagedList
import com.realmadhoney.musix.ui.components.Banner
import com.realmadhoney.musix.ui.components.EntryRow
import com.realmadhoney.musix.ui.components.IconAction
import com.realmadhoney.musix.ui.components.LoadingState
import com.realmadhoney.musix.ui.components.PrimaryButton
import com.realmadhoney.musix.ui.components.SectionHeader
import com.realmadhoney.musix.ui.components.SkeletonRows
import com.realmadhoney.musix.ui.components.StateMessage
import com.realmadhoney.musix.ui.theme.DesignTokens
import com.realmadhoney.musix.ui.theme.Musix

@Composable
fun tabLabel(tab: RootTab): String =
    when (tab) {
        RootTab.HOME -> stringResource(R.string.tab_home)
        RootTab.LIBRARY -> stringResource(R.string.tab_library)
        RootTab.PLAYLISTS -> stringResource(R.string.tab_playlists)
        RootTab.RECENT -> stringResource(R.string.tab_recent)
    }

@Composable
fun HomeScreen(
    selected: RootTab,
    engineStatus: EngineStatus?,
    connected: Boolean,
    listFor: (String) -> PagedList,
    onSelectTab: (RootTab) -> Unit,
    onSearch: () -> Unit,
    onSettings: () -> Unit,
    onOpen: (BrowseEntry) -> Unit,
    onSignIn: () -> Unit,
    onRetryEngine: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Musix.colors
    Column(modifier = modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(start = DesignTokens.Space16, end = DesignTokens.Space4, top = DesignTokens.Space8),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                text = stringResource(R.string.app_name),
                style = MaterialTheme.typography.headlineMedium,
                color = colors.text,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            IconAction(R.drawable.ic_search, stringResource(R.string.action_search), onSearch)
            IconAction(R.drawable.ic_settings, stringResource(R.string.action_settings), onSettings)
        }
        EngineBanner(engineStatus, onRetryEngine)
        Row(modifier = Modifier.fillMaxWidth().padding(horizontal = DesignTokens.Space8)) {
            RootTab.entries.forEach { tab ->
                val isSelected = tab == selected
                Column(
                    modifier =
                        Modifier
                            .weight(1f)
                            .clickable(role = Role.Tab) { onSelectTab(tab) }
                            .semantics { this.selected = isSelected }
                            .padding(vertical = DesignTokens.Space12),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    Text(
                        text = tabLabel(tab),
                        style = MaterialTheme.typography.labelLarge,
                        color = if (isSelected) colors.text else colors.textMuted,
                        maxLines = 1,
                    )
                    Spacer(Modifier.height(DesignTokens.Space4))
                    Box(
                        Modifier
                            .width(32.dp)
                            .height(3.dp)
                            .background(if (isSelected) colors.accent else colors.bg),
                    )
                }
            }
        }
        val mediaId = MediaIds.tab(selected)
        BrowseList(
            list = listFor(mediaId),
            connected = connected,
            onOpen = onOpen,
            onSignIn = onSignIn,
            modifier = Modifier.weight(1f),
        )
    }
}

@Composable
fun FolderScreen(
    title: String,
    playable: Boolean,
    connected: Boolean,
    list: PagedList,
    onBack: () -> Unit,
    onPlayAll: () -> Unit,
    onOpen: (BrowseEntry) -> Unit,
    onSignIn: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Musix.colors
    Column(modifier = modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = DesignTokens.Space4, vertical = DesignTokens.Space8),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(R.drawable.ic_back, stringResource(R.string.action_back), onBack)
            Text(
                text = title,
                style = MaterialTheme.typography.titleLarge,
                color = colors.text,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).padding(horizontal = DesignTokens.Space8).semantics { heading() },
            )
        }
        if (playable) {
            PrimaryButton(
                label = stringResource(R.string.action_play_all),
                onClick = onPlayAll,
                icon = R.drawable.ic_play_filled,
                modifier = Modifier.padding(horizontal = DesignTokens.Space16, vertical = DesignTokens.Space8),
            )
        }
        BrowseList(list = list, connected = connected, onOpen = onOpen, onSignIn = onSignIn, modifier = Modifier.weight(1f))
    }
}

@Composable
fun EngineBanner(
    status: EngineStatus?,
    onRetry: () -> Unit,
) {
    when (status) {
        is EngineStatus.Offline -> {
            Banner(
                R.drawable.ic_wifi_off,
                status.message,
                actionLabel = stringResource(R.string.action_retry),
                onAction = onRetry,
            )
        }

        is EngineStatus.Failed -> {
            Banner(
                R.drawable.ic_alert,
                status.message,
                actionLabel = stringResource(R.string.action_retry),
                onAction = onRetry,
            )
        }

        is EngineStatus.Recovering -> {
            Banner(R.drawable.ic_refresh, stringResource(R.string.engine_recovering))
        }

        EngineStatus.Starting, EngineStatus.Loading -> {
            Banner(R.drawable.ic_refresh, stringResource(R.string.engine_starting))
        }

        EngineStatus.Ready, null -> {}
    }
}

fun fallbackIcon(mediaType: Int?): Int =
    when (mediaType) {
        MediaMetadata.MEDIA_TYPE_ALBUM -> R.drawable.ic_album
        MediaMetadata.MEDIA_TYPE_ARTIST -> R.drawable.ic_artist
        MediaMetadata.MEDIA_TYPE_PLAYLIST -> R.drawable.ic_list_music
        MediaMetadata.MEDIA_TYPE_FOLDER_MIXED -> R.drawable.ic_library
        else -> R.drawable.ic_music
    }

@Composable
fun BrowseList(
    list: PagedList,
    connected: Boolean,
    onOpen: (BrowseEntry) -> Unit,
    onSignIn: () -> Unit,
    modifier: Modifier = Modifier,
    emptyTitle: String? = null,
) {
    val state by list.state.collectAsState()
    LaunchedEffect(list, connected) {
        if (connected) {
            list.start()
        }
    }
    BrowseListContent(state, connected, list::loadMore, list::retry, onOpen, onSignIn, modifier, emptyTitle)
}

@Composable
fun BrowseListContent(
    state: ListState,
    connected: Boolean,
    onLoadMore: () -> Unit,
    onRetry: () -> Unit,
    onOpen: (BrowseEntry) -> Unit,
    onSignIn: () -> Unit,
    modifier: Modifier = Modifier,
    emptyTitle: String? = null,
) {
    val error = state.error
    when {
        !connected || (!state.started && state.entries.isEmpty()) -> {
            Column(modifier.fillMaxSize()) { SkeletonRows(8) }
            return
        }

        state.entries.isEmpty() && state.loading -> {
            Column(modifier.fillMaxSize()) { SkeletonRows(8) }
            return
        }

        state.entries.isEmpty() && error != null -> {
            Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                when {
                    error.needsSignIn -> {
                        StateMessage(
                            R.drawable.ic_user,
                            stringResource(R.string.state_signed_out),
                            error.message,
                            actionLabel = stringResource(R.string.action_sign_in),
                            onAction = onSignIn,
                        )
                    }

                    error.offline -> {
                        StateMessage(
                            R.drawable.ic_wifi_off,
                            stringResource(R.string.state_offline),
                            error.message,
                            actionLabel = stringResource(R.string.action_retry),
                            onAction = onRetry,
                        )
                    }

                    else -> {
                        StateMessage(
                            R.drawable.ic_alert,
                            stringResource(R.string.state_error),
                            error.message,
                            actionLabel = stringResource(R.string.action_retry),
                            onAction = onRetry,
                        )
                    }
                }
            }
            return
        }

        state.entries.isEmpty() && state.endReached -> {
            Box(modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                StateMessage(
                    R.drawable.ic_music,
                    emptyTitle ?: stringResource(R.string.browse_empty),
                    if (emptyTitle == null) stringResource(R.string.browse_empty_body) else null,
                )
            }
            return
        }
    }
    val listState = rememberLazyListState()
    val nearEnd by remember {
        derivedStateOf {
            val last =
                listState.layoutInfo.visibleItemsInfo
                    .lastOrNull()
                    ?.index ?: 0
            last >= listState.layoutInfo.totalItemsCount - LOAD_AHEAD
        }
    }
    LaunchedEffect(nearEnd, state.entries.size) {
        if (nearEnd) {
            onLoadMore()
        }
    }
    LazyColumn(state = listState, modifier = modifier.fillMaxSize()) {
        itemsIndexed(state.entries, key = { _, entry -> entry.mediaId }) { index, entry ->
            val previousGroup = state.entries.getOrNull(index - 1)?.group
            val group = entry.group
            if (group != null && group != previousGroup) {
                SectionHeader(group)
            }
            EntryRow(
                title = entry.title,
                subtitle = entry.subtitle,
                artwork = entry.artworkUri,
                browsable = entry.browsable,
                onClick = { onOpen(entry) },
                fallback = fallbackIcon(entry.mediaType),
            )
        }
        if (state.loading) {
            item(key = "loading") { LoadingState(stringResource(R.string.loading_more)) }
        }
        if (error != null) {
            item(key = "error") {
                Banner(
                    R.drawable.ic_alert,
                    error.message,
                    actionLabel = stringResource(R.string.action_retry),
                    onAction = onRetry,
                )
            }
        }
        item(key = "bottom") { Spacer(Modifier.height(DesignTokens.Space24)) }
    }
}

private const val LOAD_AHEAD = 10
