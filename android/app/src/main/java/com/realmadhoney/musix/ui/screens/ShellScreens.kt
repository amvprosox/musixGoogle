package com.realmadhoney.musix.ui.screens

import android.widget.FrameLayout
import androidx.annotation.DrawableRes
import androidx.annotation.StringRes
import androidx.compose.foundation.Image
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import com.realmadhoney.musix.R
import com.realmadhoney.musix.core.bridge.FlatItem
import com.realmadhoney.musix.core.bridge.ItemType
import com.realmadhoney.musix.core.bridge.SearchSuggestions
import com.realmadhoney.musix.download.DetectedLibrary
import com.realmadhoney.musix.download.DownloadItem
import com.realmadhoney.musix.download.DownloadStatus
import com.realmadhoney.musix.engine.WebEngine
import com.realmadhoney.musix.engine.WebRoute
import com.realmadhoney.musix.ui.components.Artwork
import com.realmadhoney.musix.ui.components.EntryRow
import com.realmadhoney.musix.ui.components.IconAction
import com.realmadhoney.musix.ui.components.MusixIcon
import com.realmadhoney.musix.ui.components.StateMessage
import com.realmadhoney.musix.ui.components.formatTime
import com.realmadhoney.musix.ui.theme.DesignTokens
import com.realmadhoney.musix.ui.theme.Musix

enum class ShellTab(
    @StringRes val label: Int,
    @DrawableRes val icon: Int,
    val route: WebRoute?,
) {
    Home(R.string.tab_home, R.drawable.ic_home, WebRoute.Home),
    Explore(R.string.tab_explore, R.drawable.ic_compass, WebRoute.Explore),
    Search(R.string.action_search, R.drawable.ic_search, null),
    Library(R.string.tab_library, R.drawable.ic_library, WebRoute.Library),
    Downloads(R.string.tab_downloads, R.drawable.ic_download, null),
    Settings(R.string.action_settings, R.drawable.ic_settings, null),
}

@Composable
fun ShellTopBar(
    searching: Boolean,
    query: String,
    canGoBack: Boolean,
    signedIn: Boolean,
    onQueryChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onBack: () -> Unit,
    onSearch: () -> Unit,
    onAccount: () -> Unit,
    onSignIn: () -> Unit,
) {
    val colors = Musix.colors
    Column(Modifier.fillMaxWidth().background(colors.surface)) {
        Row(
            modifier = Modifier.fillMaxWidth().height(60.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (searching) {
                SearchField(query, onQueryChange, onSubmit)
            } else {
                if (canGoBack) {
                    IconAction(R.drawable.ic_back, stringResource(R.string.action_back), onBack)
                } else {
                    Spacer(Modifier.width(DesignTokens.Space16))
                    Image(
                        painter = painterResource(R.drawable.musix_logo),
                        contentDescription = null,
                        modifier = Modifier.size(32.dp),
                    )
                    Spacer(Modifier.width(DesignTokens.Space12))
                }
                Text(
                    stringResource(R.string.app_name),
                    style = MaterialTheme.typography.titleLarge.copy(fontWeight = FontWeight.Bold),
                    color = colors.text,
                    modifier = Modifier.weight(1f),
                )
                IconAction(R.drawable.ic_search, stringResource(R.string.action_search), onSearch)
                if (signedIn) {
                    IconAction(R.drawable.ic_user, stringResource(R.string.action_account), onAccount)
                } else {
                    val shape = RoundedCornerShape(DesignTokens.RadiusControl)
                    Row(
                        modifier =
                            Modifier
                                .padding(end = DesignTokens.Space12)
                                .heightIn(min = DesignTokens.ControlHeight)
                                .border(1.dp, colors.border, shape)
                                .clickable(role = Role.Button, onClick = onSignIn)
                                .padding(horizontal = DesignTokens.Space12),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(DesignTokens.Space8),
                    ) {
                        MusixIcon(R.drawable.ic_log_in, null, size = 18.dp)
                        Text(
                            stringResource(R.string.action_sign_in),
                            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
                            color = colors.text,
                        )
                    }
                }
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.border))
    }
}

@Composable
private fun SearchField(
    query: String,
    onQueryChange: (String) -> Unit,
    onSubmit: () -> Unit,
) {
    val colors = Musix.colors
    val focus = remember { FocusRequester() }
    val focusManager = LocalFocusManager.current
    val shape = RoundedCornerShape(DesignTokens.RadiusCard)
    LaunchedEffect(Unit) { focus.requestFocus() }
    Row(
        modifier =
            Modifier
                .padding(horizontal = DesignTokens.Space12)
                .fillMaxWidth()
                .height(DesignTokens.ControlHeight + 4.dp)
                .background(colors.surface2, shape)
                .border(1.dp, colors.border, shape)
                .padding(start = DesignTokens.Space12),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MusixIcon(R.drawable.ic_search, null, tint = colors.textMuted, size = 20.dp)
        Spacer(Modifier.width(DesignTokens.Space8))
        Box(Modifier.weight(1f)) {
            if (query.isEmpty()) {
                Text(
                    stringResource(R.string.search_hint),
                    style = MaterialTheme.typography.bodyLarge,
                    color = colors.textMuted,
                    maxLines = 1,
                )
            }
            BasicTextField(
                value = query,
                onValueChange = onQueryChange,
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = colors.text),
                cursorBrush = SolidColor(colors.accent),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions =
                    KeyboardActions(onSearch = {
                        focusManager.clearFocus()
                        onSubmit()
                    }),
                modifier = Modifier.fillMaxWidth().focusRequester(focus),
            )
        }
        if (query.isNotEmpty()) {
            IconAction(R.drawable.ic_close, stringResource(R.string.action_clear_search), { onQueryChange("") }, iconSize = 20.dp)
        }
    }
}

@Composable
fun WebContent(
    engine: WebEngine,
    modifier: Modifier = Modifier,
) {
    val host = remember { arrayOfNulls<FrameLayout>(1) }
    AndroidView(
        factory = { context ->
            FrameLayout(context).also { container ->
                container.setBackgroundColor(android.graphics.Color.BLACK)
                host[0] = container
                engine.attachTo(container)
            }
        },
        update = { container -> engine.attachTo(container) },
        modifier = modifier.fillMaxSize().background(Color.Black),
    )
    DisposableEffect(engine) {
        onDispose {
            host[0]?.let { engine.detachFrom(it) }
            host[0] = null
        }
    }
}

@Composable
fun ShellTabBar(
    selected: ShellTab,
    onSelect: (ShellTab) -> Unit,
) {
    val colors = Musix.colors
    Column(Modifier.fillMaxWidth().background(colors.surface)) {
        Box(Modifier.fillMaxWidth().height(1.dp).background(colors.border))
        Row(Modifier.fillMaxWidth().padding(top = DesignTokens.Space4)) {
            ShellTab.entries.forEach { tab ->
                val active = tab == selected
                val tint = if (active) colors.accent else colors.textMuted
                Column(
                    modifier =
                        Modifier
                            .weight(1f)
                            .heightIn(min = 56.dp)
                            .semantics { this.selected = active }
                            .clickable(role = Role.Tab) { onSelect(tab) },
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    MusixIcon(tab.icon, null, tint = tint, size = 22.dp)
                    Spacer(Modifier.height(DesignTokens.Space4))
                    Text(
                        stringResource(tab.label),
                        style =
                            MaterialTheme.typography.bodyMedium.copy(
                                fontWeight = if (active) FontWeight.SemiBold else FontWeight.Medium,
                            ),
                        color = tint,
                        maxLines = 1,
                        overflow = TextOverflow.Clip,
                    )
                }
            }
        }
    }
}

@Composable
fun SearchSuggestionsPanel(
    suggestions: SearchSuggestions,
    onSearch: (String) -> Unit,
    onFill: (String) -> Unit,
    onItem: (FlatItem) -> Unit,
    artworkFor: (String) -> android.net.Uri?,
    modifier: Modifier = Modifier,
) {
    val colors = Musix.colors
    val focusManager = LocalFocusManager.current
    LazyColumn(modifier = modifier.fillMaxSize().background(colors.bg)) {
        items(suggestions.queries, key = { "q:$it" }) { text ->
            val searchLabel = stringResource(R.string.suggest_search, text)
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 52.dp)
                        .clickable(role = Role.Button, onClickLabel = searchLabel) {
                            focusManager.clearFocus()
                            onSearch(text)
                        }.padding(start = DesignTokens.Space16),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                MusixIcon(R.drawable.ic_search, null, tint = colors.textMuted, size = 20.dp)
                Spacer(Modifier.width(DesignTokens.Space16))
                Text(
                    highlighted(text, suggestions.query, colors.text, colors.textMuted),
                    style = MaterialTheme.typography.bodyLarge,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                    modifier = Modifier.weight(1f),
                )
                IconAction(R.drawable.ic_fill_query, stringResource(R.string.suggest_fill, text), { onFill(text) }, iconSize = 20.dp)
            }
        }
        if (suggestions.queries.isNotEmpty() && suggestions.items.isNotEmpty()) {
            item(key = "divider") {
                Box(
                    Modifier
                        .padding(vertical = DesignTokens.Space8)
                        .fillMaxWidth()
                        .height(1.dp)
                        .background(colors.border),
                )
            }
        }
        items(suggestions.items, key = { "i:${it.id}" }) { item ->
            EntryRow(
                title = item.title,
                subtitle = item.subtitle,
                artwork = item.artworkUrl.takeIf { it.isNotEmpty() }?.let(artworkFor),
                browsable = item.browsable && !item.playable,
                onClick = {
                    focusManager.clearFocus()
                    onItem(item)
                },
                fallback =
                    when (item.type) {
                        ItemType.ARTIST -> R.drawable.ic_artist
                        ItemType.ALBUM -> R.drawable.ic_album
                        ItemType.PLAYLIST -> R.drawable.ic_list_music
                        else -> R.drawable.ic_music
                    },
            )
        }
    }
}

private fun highlighted(
    text: String,
    typed: String,
    strong: Color,
    soft: Color,
): AnnotatedString =
    buildAnnotatedString {
        val prefix = typed.trim()
        if (prefix.isNotEmpty() && text.startsWith(prefix, ignoreCase = true)) {
            withStyle(SpanStyle(color = soft)) { append(text.substring(0, prefix.length)) }
            withStyle(SpanStyle(color = strong, fontWeight = FontWeight.SemiBold)) { append(text.substring(prefix.length)) }
        } else {
            withStyle(SpanStyle(color = strong)) { append(text) }
        }
    }

@Composable
private fun DownloadPill(
    text: String,
    @DrawableRes icon: Int,
    onClick: () -> Unit,
    enabled: Boolean = true,
    highlighted: Boolean = false,
) {
    val colors = Musix.colors
    val shape = RoundedCornerShape(DesignTokens.RadiusControl)
    val tint = if (highlighted) colors.accent else colors.text
    Row(
        modifier =
            Modifier
                .heightIn(min = 36.dp)
                .border(1.dp, if (highlighted) colors.accent else colors.border, shape)
                .clickable(enabled = enabled, role = Role.Button, onClick = onClick)
                .padding(horizontal = DesignTokens.Space12),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(DesignTokens.Space8),
    ) {
        MusixIcon(icon, null, tint = tint, size = 16.dp)
        Text(
            text,
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.SemiBold),
            color = tint,
            maxLines = 1,
        )
    }
}

@Composable
private fun DownloadsSearchField(
    query: String,
    onQueryChange: (String) -> Unit,
) {
    val colors = Musix.colors
    val focusManager = LocalFocusManager.current
    val shape = RoundedCornerShape(DesignTokens.RadiusCard)
    Row(
        modifier =
            Modifier
                .padding(horizontal = DesignTokens.Space16, vertical = DesignTokens.Space8)
                .fillMaxWidth()
                .height(DesignTokens.ControlHeight + 4.dp)
                .background(colors.surface2, shape)
                .border(1.dp, colors.border, shape)
                .padding(start = DesignTokens.Space12),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        MusixIcon(R.drawable.ic_search, null, tint = colors.textMuted, size = 20.dp)
        Spacer(Modifier.width(DesignTokens.Space8))
        Box(Modifier.weight(1f)) {
            if (query.isEmpty()) {
                Text(
                    "Search downloads and libraries...",
                    style = MaterialTheme.typography.bodyLarge,
                    color = colors.textMuted,
                    maxLines = 1,
                )
            }
            BasicTextField(
                value = query,
                onValueChange = onQueryChange,
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = colors.text),
                cursorBrush = SolidColor(colors.accent),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                keyboardActions = KeyboardActions(onSearch = { focusManager.clearFocus() }),
                modifier = Modifier.fillMaxWidth(),
            )
        }
        if (query.isNotEmpty()) {
            IconAction(R.drawable.ic_close, stringResource(R.string.action_clear_search), { onQueryChange("") }, iconSize = 20.dp)
        }
    }
}

@Composable
private fun SectionHeader(text: String) {
    Text(
        text,
        style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
        color = Musix.colors.text,
        modifier = Modifier.padding(horizontal = DesignTokens.Space16, vertical = DesignTokens.Space8),
    )
}

@Composable
fun DownloadsScreen(
    items: List<DownloadItem>,
    currentVideoId: String,
    isPlaying: Boolean,
    libraries: List<DetectedLibrary>,
    librariesLoading: Boolean,
    logs: List<String>,
    artworkFor: (String) -> android.net.Uri?,
    onPlay: (DownloadItem) -> Unit,
    onRetry: (DownloadItem) -> Unit,
    onDelete: (String) -> Unit,
    onRefreshLibraries: () -> Unit,
    onDownloadLibrary: (DetectedLibrary) -> Unit,
    onDownloadAllLibraries: () -> Unit,
    onClearLogs: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Musix.colors
    val clipboard = LocalClipboardManager.current
    var query by rememberSaveable { mutableStateOf("") }
    var logsOpen by rememberSaveable { mutableStateOf(false) }
    val needle = query.trim().lowercase()
    val completedIds = items.filter { it.status == DownloadStatus.COMPLETED }.mapTo(HashSet()) { it.videoId }
    val filteredLibs =
        if (needle.isEmpty()) {
            libraries
        } else {
            libraries.filter { lib ->
                lib.title.lowercase().contains(needle) ||
                    lib.subtitle.lowercase().contains(needle) ||
                    lib.tracks.any {
                        it.title.lowercase().contains(needle) ||
                            it.artist.lowercase().contains(needle) ||
                            it.album.lowercase().contains(needle)
                    }
            }
        }
    val filteredItems =
        if (needle.isEmpty()) {
            items
        } else {
            items.filter {
                it.title.lowercase().contains(needle) ||
                    it.artist.lowercase().contains(needle) ||
                    it.album.lowercase().contains(needle)
            }
        }
    LazyColumn(modifier = modifier.fillMaxSize().background(colors.bg)) {
        item(key = "search") {
            DownloadsSearchField(query) { query = it.take(200) }
        }
        item(key = "toolbar") {
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = DesignTokens.Space16, vertical = DesignTokens.Space4),
                horizontalArrangement = Arrangement.spacedBy(DesignTokens.Space8),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                DownloadPill(if (logsOpen) "Hide Logs" else "Logs", R.drawable.ic_lyrics, { logsOpen = !logsOpen }, highlighted = logsOpen)
                DownloadPill("Refresh", R.drawable.ic_refresh, onRefreshLibraries, enabled = !librariesLoading)
                if (libraries.isNotEmpty()) {
                    DownloadPill("Download All", R.drawable.ic_download, onDownloadAllLibraries)
                }
            }
        }
        if (logsOpen) {
            item(key = "logs") {
                val shape = RoundedCornerShape(DesignTokens.RadiusCard)
                Column(
                    modifier =
                        Modifier
                            .padding(horizontal = DesignTokens.Space16, vertical = DesignTokens.Space8)
                            .fillMaxWidth()
                            .background(colors.surface, shape)
                            .border(1.dp, colors.border, shape)
                            .padding(DesignTokens.Space12),
                    verticalArrangement = Arrangement.spacedBy(DesignTokens.Space8),
                ) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(DesignTokens.Space8)) {
                        Text(
                            "Download Logs",
                            style = MaterialTheme.typography.titleSmall.copy(fontWeight = FontWeight.Bold),
                            color = colors.text,
                            modifier = Modifier.weight(1f),
                        )
                        DownloadPill("Copy", R.drawable.ic_check, { clipboard.setText(AnnotatedString(logs.joinToString("\n"))) })
                        DownloadPill("Clear", R.drawable.ic_trash, onClearLogs)
                    }
                    Text(
                        text = if (logs.isEmpty()) "No download logs yet." else logs.takeLast(150).joinToString("\n"),
                        style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace),
                        color = colors.textMuted,
                        modifier = Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState()),
                    )
                }
            }
        }
        item(key = "libs-header") {
            SectionHeader(if (librariesLoading && libraries.isEmpty()) "Libraries (detecting...)" else "Libraries")
        }
        if (filteredLibs.isEmpty()) {
            item(key = "libs-empty") {
                Text(
                    text =
                        when {
                            librariesLoading -> "Detecting your YouTube Music libraries..."
                            needle.isNotEmpty() -> "No libraries match your search."
                            else -> "No libraries detected yet. Sign in and tap Refresh."
                        },
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textMuted,
                    modifier = Modifier.padding(horizontal = DesignTokens.Space16, vertical = DesignTokens.Space8),
                )
            }
        }
        items(filteredLibs, key = { "lib:${it.id}" }) { lib ->
            val done = lib.tracks.count { it.videoId in completedIds }
            val total = lib.tracks.size
            val remaining = total - done
            Row(
                modifier = Modifier.fillMaxWidth().padding(horizontal = DesignTokens.Space16, vertical = DesignTokens.Space8),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Artwork(lib.artworkUrl.takeIf { it.isNotEmpty() }?.let(artworkFor), 56.dp, fallback = R.drawable.ic_list_music)
                Spacer(Modifier.width(DesignTokens.Space12))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        lib.title,
                        style = MaterialTheme.typography.titleSmall,
                        color = colors.text,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        "$done/$total downloaded",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.textMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Spacer(Modifier.width(DesignTokens.Space8))
                val allDone = total > 0 && remaining == 0
                val label =
                    when {
                        allDone -> "Already Downloaded"
                        done > 0 -> "Download ($remaining left)"
                        else -> "Download All"
                    }
                DownloadPill(
                    label,
                    if (allDone) R.drawable.ic_check else R.drawable.ic_download,
                    { onDownloadLibrary(lib) },
                    highlighted = allDone,
                )
            }
        }
        item(key = "tracks-header") {
            SectionHeader(
                if (needle.isEmpty()) "Downloaded Tracks (${items.size})" else "Downloaded Tracks (${filteredItems.size}/${items.size})",
            )
        }
        if (filteredItems.isEmpty()) {
            item(key = "tracks-empty") {
                Box(Modifier.fillMaxWidth().padding(vertical = DesignTokens.Space24), contentAlignment = Alignment.Center) {
                    StateMessage(
                        icon = R.drawable.ic_download,
                        title = if (needle.isEmpty()) stringResource(R.string.downloads_empty) else "No matching downloads",
                        body = if (needle.isEmpty()) stringResource(R.string.downloads_empty_body) else "Try a different search term.",
                    )
                }
            }
        }
        items(filteredItems, key = { it.videoId }) { item ->
            val active = item.videoId == currentVideoId
            val playingThis = active && isPlaying
            val description =
                listOf(item.artist, item.album)
                    .filter { it.isNotBlank() }
                    .joinToString(" • ")
                    .ifEmpty { "Offline MP3" }
            val pct = (item.progress * 100).toInt()
            val statusText =
                when (item.status) {
                    DownloadStatus.DOWNLOADING -> if (item.progress <= 0f) "Queued..." else "Downloading MP3 • $pct%"
                    DownloadStatus.FAILED -> item.error ?: "Download failed"
                    DownloadStatus.COMPLETED -> "MP3 • ${formatTime(item.durationSec * 1000L)}"
                }
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clickable(
                            enabled = item.status == DownloadStatus.COMPLETED,
                            role = Role.Button,
                            onClick = { onPlay(item) },
                        ).padding(horizontal = DesignTokens.Space16, vertical = DesignTokens.Space12),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Artwork(item.artworkUri(), 56.dp)
                Spacer(Modifier.width(DesignTokens.Space12))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = item.title,
                        style = MaterialTheme.typography.titleSmall,
                        color = if (active) colors.accent else colors.text,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = description,
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.textMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                    Text(
                        text = statusText,
                        style = MaterialTheme.typography.bodySmall,
                        color = if (item.status == DownloadStatus.FAILED) colors.danger else colors.textMuted,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                when (item.status) {
                    DownloadStatus.COMPLETED -> {
                        IconAction(
                            icon = if (playingThis) R.drawable.ic_pause_filled else R.drawable.ic_play_filled,
                            label = stringResource(if (playingThis) R.string.action_pause else R.string.action_play),
                            onClick = { onPlay(item) },
                            active = active,
                        )
                    }

                    DownloadStatus.FAILED -> {
                        IconAction(
                            icon = R.drawable.ic_refresh,
                            label = stringResource(R.string.action_retry),
                            onClick = { onRetry(item) },
                        )
                    }

                    DownloadStatus.DOWNLOADING -> {}
                }
                IconAction(
                    icon = R.drawable.ic_trash,
                    label = stringResource(R.string.action_delete_download),
                    onClick = { onDelete(item.videoId) },
                )
            }
        }
    }
}
