package com.realmadhoney.musix.ui.screens

import android.widget.FrameLayout
import androidx.activity.compose.BackHandler
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.viewinterop.AndroidView
import com.realmadhoney.musix.R
import com.realmadhoney.musix.engine.AccountState
import com.realmadhoney.musix.engine.WebEngine
import com.realmadhoney.musix.ui.components.Banner
import com.realmadhoney.musix.ui.components.IconAction
import com.realmadhoney.musix.ui.components.MusixIcon
import com.realmadhoney.musix.ui.components.PrimaryButton
import com.realmadhoney.musix.ui.components.SecondaryButton
import com.realmadhoney.musix.ui.components.StateMessage
import com.realmadhoney.musix.ui.theme.DesignTokens
import com.realmadhoney.musix.ui.theme.Musix

@Composable
fun SignInScreen(
    engine: WebEngine?,
    account: AccountState,
    drivingRestricted: Boolean,
    onDone: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Musix.colors
    var opened by remember { mutableStateOf(false) }
    BackHandler {
        if (engine != null && engine.canGoBack() && !drivingRestricted) engine.goBack() else onDone()
    }
    Column(modifier = modifier.fillMaxSize().background(colors.bg)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = DesignTokens.Space4, vertical = DesignTokens.Space8),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconAction(R.drawable.ic_back, stringResource(R.string.action_back), onDone)
            Text(
                stringResource(R.string.signin_title),
                style = MaterialTheme.typography.titleLarge,
                color = colors.text,
                modifier = Modifier.weight(1f).padding(horizontal = DesignTokens.Space8).semantics { heading() },
            )
            if (account is AccountState.SignedIn) {
                PrimaryButton(stringResource(R.string.action_done), onDone, modifier = Modifier.padding(end = DesignTokens.Space8))
            }
        }
        when {
            drivingRestricted -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    StateMessage(R.drawable.ic_car, stringResource(R.string.signin_driving), null)
                }
            }

            engine == null -> {
                Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    StateMessage(R.drawable.ic_refresh, stringResource(R.string.signin_unavailable), null)
                }
            }

            else -> {
                if (account is AccountState.SignedIn) {
                    Banner(R.drawable.ic_user, stringResource(R.string.signin_done))
                } else {
                    Text(
                        stringResource(R.string.signin_body),
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.textMuted,
                        modifier = Modifier.padding(horizontal = DesignTokens.Space16, vertical = DesignTokens.Space8),
                    )
                }
                LaunchedEffect(engine) {
                    if (!opened && account !is AccountState.SignedIn) {
                        opened = true
                        engine.openSignIn()
                    }
                }
                val host = remember { arrayOfNulls<FrameLayout>(1) }
                AndroidView(
                    factory = { context ->
                        FrameLayout(context).also { container ->
                            host[0] = container
                            engine.attachTo(container)
                        }
                    },
                    modifier = Modifier.fillMaxWidth().weight(1f),
                )
                DisposableEffect(engine) {
                    onDispose {
                        host[0]?.let { engine.detachFrom(it) }
                        host[0] = null
                        val url = engine.currentUrl.orEmpty()
                        if (!url.startsWith("https://music.youtube.com")) {
                            engine.openHome()
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun SettingsScreen(
    account: AccountState,
    adSkip: Boolean,
    blockedRequests: Long,
    versionName: String,
    onBack: (() -> Unit)?,
    onSignIn: () -> Unit,
    onSignOut: () -> Unit,
    onAdSkip: (Boolean) -> Unit,
    onClearCache: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Musix.colors
    Column(modifier = modifier.fillMaxSize().background(colors.bg)) {
        Row(
            modifier = Modifier.fillMaxWidth().padding(horizontal = DesignTokens.Space4, vertical = DesignTokens.Space8),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                IconAction(R.drawable.ic_back, stringResource(R.string.action_back), onBack)
            } else {
                Spacer(Modifier.width(DesignTokens.Space12))
            }
            Text(
                stringResource(R.string.settings_title),
                style = MaterialTheme.typography.titleLarge,
                color = colors.text,
                modifier = Modifier.padding(horizontal = DesignTokens.Space8).semantics { heading() },
            )
        }
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = DesignTokens.Space32)) {
            SettingsSection(stringResource(R.string.settings_account)) {
                val accountText =
                    when (account) {
                        is AccountState.SignedIn -> stringResource(R.string.settings_signed_in)
                        AccountState.SignedOut -> stringResource(R.string.settings_signed_out)
                        AccountState.Unknown -> stringResource(R.string.settings_signed_unknown)
                    }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    MusixIcon(R.drawable.ic_user, null, tint = colors.textMuted)
                    Spacer(Modifier.width(DesignTokens.Space12))
                    Text(accountText, style = MaterialTheme.typography.bodyLarge, color = colors.text, modifier = Modifier.weight(1f))
                }
                Spacer(Modifier.height(DesignTokens.Space16))
                if (account is AccountState.SignedIn) {
                    SecondaryButton(stringResource(R.string.action_sign_out), onSignOut, icon = R.drawable.ic_log_out, danger = true)
                } else {
                    PrimaryButton(stringResource(R.string.action_sign_in), onSignIn, icon = R.drawable.ic_log_in)
                }
            }
            SettingsSection(stringResource(R.string.settings_playback)) {
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clip(RoundedCornerShape(DesignTokens.RadiusControl))
                            .clickable(role = Role.Switch) { onAdSkip(!adSkip) }
                            .padding(vertical = DesignTokens.Space8),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(Modifier.weight(1f)) {
                        Text(stringResource(R.string.settings_ad_skip), style = MaterialTheme.typography.bodyLarge, color = colors.text)
                        Text(
                            stringResource(R.string.settings_ad_skip_body),
                            style = MaterialTheme.typography.bodyMedium,
                            color = colors.textMuted,
                        )
                    }
                    Spacer(Modifier.width(DesignTokens.Space12))
                    Switch(
                        checked = adSkip,
                        onCheckedChange = null,
                        colors = SwitchDefaults.colors(checkedTrackColor = colors.accent, checkedThumbColor = colors.onAccent),
                    )
                }
                Spacer(Modifier.height(DesignTokens.Space8))
                Text(
                    stringResource(R.string.settings_blocked, blockedRequests.coerceAtMost(Int.MAX_VALUE.toLong()).toInt()),
                    style = MaterialTheme.typography.bodyMedium,
                    color = colors.textMuted,
                )
            }
            SettingsSection(stringResource(R.string.settings_storage)) {
                Text(stringResource(R.string.settings_cache_body), style = MaterialTheme.typography.bodyMedium, color = colors.textMuted)
                Spacer(Modifier.height(DesignTokens.Space12))
                SecondaryButton(stringResource(R.string.action_clear_cache), onClearCache, icon = R.drawable.ic_trash)
            }
            SettingsSection(stringResource(R.string.settings_about)) {
                Text(
                    stringResource(R.string.settings_version, versionName),
                    style = MaterialTheme.typography.bodyLarge,
                    color = colors.text,
                )
                Spacer(Modifier.height(DesignTokens.Space8))
                Text(stringResource(R.string.settings_disclaimer), style = MaterialTheme.typography.bodyMedium, color = colors.textMuted)
            }
        }
    }
}

@Composable
private fun SettingsSection(
    title: String,
    content: @Composable () -> Unit,
) {
    val colors = Musix.colors
    Column(
        Modifier
            .fillMaxWidth()
            .padding(horizontal = DesignTokens.Space16, vertical = DesignTokens.Space8)
            .clip(RoundedCornerShape(DesignTokens.RadiusCard))
            .background(colors.surface)
            .padding(DesignTokens.Space16),
    ) {
        Text(
            title,
            style = MaterialTheme.typography.titleMedium,
            color = colors.text,
            modifier = Modifier.semantics { heading() },
        )
        Spacer(Modifier.height(DesignTokens.Space12))
        content()
    }
}
