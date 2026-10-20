package com.realmadhoney.musix.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import com.realmadhoney.musix.R
import com.realmadhoney.musix.ui.BrowseEntry
import com.realmadhoney.musix.ui.PagedList
import com.realmadhoney.musix.ui.components.IconAction
import com.realmadhoney.musix.ui.components.MusixIcon
import com.realmadhoney.musix.ui.components.StateMessage
import com.realmadhoney.musix.ui.theme.DesignTokens
import com.realmadhoney.musix.ui.theme.Musix

@Composable
fun SearchScreen(
    initialQuery: String,
    connected: Boolean,
    listFor: (String) -> PagedList,
    onQueryChange: (String) -> Unit,
    onBack: () -> Unit,
    onOpen: (BrowseEntry) -> Unit,
    onSignIn: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Musix.colors
    var text by rememberSaveable { mutableStateOf(initialQuery) }
    var submitted by rememberSaveable { mutableStateOf(initialQuery.trim()) }
    val focus = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current
    val hint = stringResource(R.string.search_hint)
    LaunchedEffect(Unit) {
        if (submitted.isEmpty()) {
            focus.requestFocus()
        }
    }
    Column(modifier = modifier.fillMaxSize()) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = DesignTokens.Space4, vertical = DesignTokens.Space8),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(R.drawable.ic_back, stringResource(R.string.action_back), onBack)
            Row(
                modifier =
                    Modifier
                        .weight(1f)
                        .height(48.dp)
                        .background(colors.surface2, RoundedCornerShape(24.dp))
                        .border(1.dp, colors.border, RoundedCornerShape(24.dp))
                        .padding(horizontal = DesignTokens.Space16),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                MusixIcon(R.drawable.ic_search, null, tint = colors.textMuted, size = 20.dp)
                Spacer(Modifier.width(DesignTokens.Space8))
                Box(Modifier.weight(1f)) {
                    if (text.isEmpty()) {
                        Text(hint, style = MaterialTheme.typography.bodyLarge, color = colors.textMuted)
                    }
                    BasicTextField(
                        value = text,
                        onValueChange = {
                            text = it.take(200)
                            onQueryChange(text)
                        },
                        singleLine = true,
                        textStyle = MaterialTheme.typography.bodyLarge.copy(color = colors.text),
                        cursorBrush = SolidColor(colors.accent),
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Search),
                        keyboardActions =
                            KeyboardActions(onSearch = {
                                val trimmed = text.trim()
                                if (trimmed.isNotEmpty()) {
                                    submitted = trimmed
                                    keyboard?.hide()
                                }
                            }),
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .focusRequester(focus)
                                .semantics { contentDescription = hint },
                    )
                }
                if (text.isNotEmpty()) {
                    IconAction(
                        R.drawable.ic_close,
                        stringResource(R.string.action_clear_search),
                        onClick = {
                            text = ""
                            onQueryChange("")
                            focus.requestFocus()
                        },
                        size = 40.dp,
                        iconSize = 20.dp,
                    )
                }
            }
        }
        if (submitted.isEmpty()) {
            Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                StateMessage(R.drawable.ic_search, stringResource(R.string.search_prompt), stringResource(R.string.search_prompt_body))
            }
        } else {
            val list = listFor(submitted)
            BrowseList(
                list = list,
                connected = connected,
                onOpen = onOpen,
                onSignIn = onSignIn,
                modifier = Modifier.weight(1f),
                emptyTitle = stringResource(R.string.search_empty, submitted),
            )
        }
    }
}
