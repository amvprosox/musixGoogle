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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.net.toUri
import com.realmadhoney.musix.R
import com.realmadhoney.musix.core.bridge.FlatItem
import com.realmadhoney.musix.core.bridge.ItemType
import com.realmadhoney.musix.core.bridge.SearchSuggestions
import com.realmadhoney.musix.engine.WebEngine
import com.realmadhoney.musix.engine.WebRoute
import com.realmadhoney.musix.ui.components.EntryRow
import com.realmadhoney.musix.ui.components.IconAction
import com.realmadhoney.musix.ui.components.MusixIcon
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
                artwork = item.artworkUrl.takeIf { it.isNotEmpty() }?.toUri(),
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
