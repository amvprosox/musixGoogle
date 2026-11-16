package com.realmadhoney.musix.ui.screens

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateMapOf
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
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import com.realmadhoney.musix.R
import com.realmadhoney.musix.core.voice.VoiceAction
import com.realmadhoney.musix.core.voice.VoiceCommand
import com.realmadhoney.musix.ui.components.IconAction
import com.realmadhoney.musix.ui.components.MusixIcon
import com.realmadhoney.musix.ui.components.PrimaryButton
import com.realmadhoney.musix.ui.components.SecondaryButton
import com.realmadhoney.musix.ui.theme.DesignTokens
import com.realmadhoney.musix.ui.theme.Musix
import com.realmadhoney.musix.voice.VoiceController
import com.realmadhoney.musix.voice.VoiceState
import com.realmadhoney.musix.voice.VoiceStore
import com.realmadhoney.musix.voice.VoiceUiState
import java.util.Locale

@Composable
private fun ScreenHeader(
    title: String,
    onBack: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().padding(horizontal = DesignTokens.Space4, vertical = DesignTokens.Space8),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconAction(R.drawable.ic_back, stringResource(R.string.action_back), onBack)
        Text(
            title,
            style = MaterialTheme.typography.titleLarge,
            color = Musix.colors.text,
            modifier = Modifier.padding(horizontal = DesignTokens.Space8).semantics { heading() },
        )
    }
}

@Composable
private fun SwitchRow(
    title: String,
    body: String?,
    checked: Boolean,
    onChange: (Boolean) -> Unit,
) {
    val colors = Musix.colors
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(DesignTokens.RadiusControl))
                .clickable(role = Role.Switch) { onChange(!checked) }
                .padding(vertical = DesignTokens.Space8),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(title, style = MaterialTheme.typography.bodyLarge, color = colors.text)
            if (body != null) {
                Text(body, style = MaterialTheme.typography.bodyMedium, color = colors.textMuted)
            }
        }
        Spacer(Modifier.width(DesignTokens.Space12))
        Switch(
            checked = checked,
            onCheckedChange = null,
            colors = SwitchDefaults.colors(checkedTrackColor = colors.accent, checkedThumbColor = colors.onAccent),
        )
    }
}

@Composable
private fun Muted(text: String) {
    Text(text, style = MaterialTheme.typography.bodyMedium, color = Musix.colors.textMuted)
}

@Composable
private fun RadioRow(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    val colors = Musix.colors
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(DesignTokens.RadiusControl))
                .clickable(role = Role.RadioButton, onClick = onClick)
                .padding(vertical = DesignTokens.Space8),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            label,
            style = MaterialTheme.typography.bodyLarge,
            color = if (selected) colors.accent else colors.text,
            modifier = Modifier.weight(1f),
        )
        if (selected) {
            MusixIcon(R.drawable.ic_check, null, tint = colors.accent)
        }
    }
}

@Composable
fun VoiceSettingsScreen(
    state: VoiceUiState,
    voice: VoiceController,
    onBack: () -> Unit,
    onEditCommands: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Musix.colors
    var keyText by remember { mutableStateOf("") }
    var threshold by remember(state.threshold) { mutableFloatStateOf(state.threshold.toFloat()) }
    var sensitivity by remember(state.sensitivity) { mutableFloatStateOf(state.sensitivity.toFloat()) }
    val permission =
        rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
            voice.onPermissionResult(result[Manifest.permission.RECORD_AUDIO] == true)
        }
    val askPermission = {
        val wanted =
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS)
            } else {
                arrayOf(Manifest.permission.RECORD_AUDIO)
            }
        permission.launch(wanted)
    }
    Column(modifier = modifier.fillMaxSize().background(colors.bg)) {
        ScreenHeader("Voice assistant", onBack)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = DesignTokens.Space32)) {
            SettingsSection("Voice") {
                SwitchRow(
                    title = "Voice assistant",
                    body = "Say \"prosox\" to control Musix hands free. Works offline.",
                    checked = state.enabled,
                    onChange = { enabled ->
                        voice.setEnabled(enabled)
                        if (enabled && !voice.hasPermission) askPermission()
                    },
                )
                Spacer(Modifier.height(DesignTokens.Space8))
                Text(state.stateText, style = MaterialTheme.typography.bodyLarge, color = colors.text)
                val downloading = state.state as? VoiceState.Downloading
                if (downloading != null) {
                    Spacer(Modifier.height(DesignTokens.Space8))
                    LinearProgressIndicator(
                        progress = { downloading.progress },
                        modifier = Modifier.fillMaxWidth(),
                        color = colors.accent,
                        trackColor = colors.surface2,
                    )
                }
                if (state.enabled && !state.packInstalled && !state.busy) {
                    Spacer(Modifier.height(DesignTokens.Space12))
                    PrimaryButton("Download voice pack (56 MB)", { voice.downloadPack() }, icon = R.drawable.ic_download)
                }
                if (state.enabled && state.state == VoiceState.NeedsPermission) {
                    Spacer(Modifier.height(DesignTokens.Space12))
                    PrimaryButton("Allow microphone", askPermission, icon = R.drawable.ic_mic)
                }
                if (state.heard.isNotEmpty()) {
                    Spacer(Modifier.height(DesignTokens.Space8))
                    Muted("Last heard: \"${state.heard}\"")
                }
                if (state.notice.isNotEmpty()) {
                    Spacer(Modifier.height(DesignTokens.Space8))
                    Muted(state.notice)
                }
            }
            if (state.enabled) {
                SettingsSection("Microphone") {
                    RadioRow("Automatic", state.microphone == VoiceStore.AUTO_MICROPHONE) {
                        voice.setMicrophone(VoiceStore.AUTO_MICROPHONE)
                    }
                    state.inputs.forEach { input ->
                        RadioRow(input.name, state.microphone == input.id) { voice.setMicrophone(input.id) }
                    }
                    if (state.activeInput.isNotEmpty()) {
                        Spacer(Modifier.height(DesignTokens.Space8))
                        Muted("Listening with: ${state.activeInput}")
                    }
                    Spacer(Modifier.height(DesignTokens.Space8))
                    Muted(
                        "Automatic uses a wired headset when one is plugged in, otherwise the phone microphone, so Bluetooth music keeps full quality.",
                    )
                }
                SettingsSection("Your voice") {
                    SwitchRow("Only my voice", null, state.speakerCheck) { voice.setSpeakerCheck(it) }
                    Spacer(Modifier.height(DesignTokens.Space8))
                    PrimaryButton(
                        if (state.hasVoiceprint) "Teach Musix my voice again" else "Teach Musix my voice",
                        { voice.enroll() },
                        icon = R.drawable.ic_mic,
                        enabled = !state.busy,
                    )
                    if (state.hasVoiceprint) {
                        Spacer(Modifier.height(DesignTokens.Space8))
                        SecondaryButton("Test my voice", { if (!state.busy) voice.testVoice() })
                        Spacer(Modifier.height(DesignTokens.Space8))
                        SecondaryButton("Forget my voice", { voice.forgetVoice() }, icon = R.drawable.ic_trash, danger = true)
                    }
                    if (state.enrollPrompt.isNotEmpty()) {
                        Spacer(Modifier.height(DesignTokens.Space12))
                        Text(state.enrollPrompt, style = MaterialTheme.typography.titleMedium, color = colors.accent)
                    }
                    Spacer(Modifier.height(DesignTokens.Space12))
                    Text(
                        "Voice match threshold ${"%.2f".format(Locale.US, threshold)}",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.text,
                    )
                    Slider(
                        value = threshold,
                        onValueChange = { threshold = it },
                        onValueChangeFinished = { voice.setThreshold(Math.round(threshold * 100) / 100.0) },
                        valueRange = 0.1f..0.9f,
                        colors = SliderDefaults.colors(thumbColor = colors.accent, activeTrackColor = colors.accent),
                    )
                    Text(
                        "Wake word sensitivity ${(sensitivity * 100).toInt()}%",
                        style = MaterialTheme.typography.bodyMedium,
                        color = colors.text,
                    )
                    Slider(
                        value = sensitivity,
                        onValueChange = { sensitivity = it },
                        onValueChangeFinished = {
                            voice.setSensitivity(Math.round(sensitivity * 20) / 20.0)
                            voice.reloadEngine()
                        },
                        valueRange = 0f..1f,
                        colors = SliderDefaults.colors(thumbColor = colors.accent, activeTrackColor = colors.accent),
                    )
                    Muted(
                        if (state.hasVoiceprint) {
                            "Musix ignores \"prosox\" from voices that do not match yours."
                        } else {
                            "Musix does not know your voice yet, so it answers anyone."
                        },
                    )
                }
                SettingsSection("Commands") {
                    Muted("Change the phrases Musix listens for after \"prosox\".")
                    Spacer(Modifier.height(DesignTokens.Space12))
                    SecondaryButton("Edit voice commands", onEditCommands, icon = R.drawable.ic_list_music)
                }
                SettingsSection("AI") {
                    SwitchRow("Free AI for other requests", null, state.aiEnabled) { voice.setAiEnabled(it) }
                    Spacer(Modifier.height(DesignTokens.Space8))
                    OutlinedTextField(
                        value = keyText,
                        onValueChange = { keyText = it.take(200) },
                        label = { Text("OpenRouter API key") },
                        singleLine = true,
                        visualTransformation = PasswordVisualTransformation(),
                        keyboardOptions =
                            KeyboardOptions(
                                capitalization = KeyboardCapitalization.None,
                                autoCorrectEnabled = false,
                                keyboardType = KeyboardType.Password,
                            ),
                        colors =
                            OutlinedTextFieldDefaults.colors(
                                focusedTextColor = colors.text,
                                unfocusedTextColor = colors.text,
                                focusedBorderColor = colors.accent,
                                unfocusedBorderColor = colors.border,
                                focusedLabelColor = colors.accent,
                                unfocusedLabelColor = colors.textMuted,
                                cursorColor = colors.accent,
                            ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                    Spacer(Modifier.height(DesignTokens.Space8))
                    PrimaryButton(
                        "Save key",
                        {
                            voice.setAiKey(keyText)
                            keyText = ""
                        },
                        enabled = keyText.isNotBlank(),
                    )
                    if (state.hasAiKey) {
                        Spacer(Modifier.height(DesignTokens.Space8))
                        SecondaryButton("Remove key", { voice.setAiKey(null) }, icon = R.drawable.ic_trash, danger = true)
                    }
                    Spacer(Modifier.height(DesignTokens.Space8))
                    Muted(
                        if (state.hasAiKey) {
                            "Key saved encrypted on this phone. Only free \":free\" models are ever called, so it never costs money. " +
                                "Used online only, for requests the built-in commands do not understand."
                        } else {
                            "Paste a key from openrouter.ai/keys. Set its credit limit to 0 there for extra safety."
                        },
                    )
                }
            }
        }
    }
}

@Composable
fun VoiceCommandsScreen(
    commands: List<VoiceCommand>,
    onSave: (List<VoiceCommand>) -> Unit,
    onReset: () -> Unit,
    onBack: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val colors = Musix.colors
    val drafts = remember(commands) { mutableStateMapOf<VoiceAction, String>() }
    Column(modifier = modifier.fillMaxSize().background(colors.bg)) {
        ScreenHeader("Voice commands", onBack)
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(bottom = DesignTokens.Space32)) {
            SettingsSection("How it works") {
                Muted(
                    "Say \"prosox\" and then one of these phrases. Separate phrases with commas. Use {query} for a song, playlist, or theme name.",
                )
                Spacer(Modifier.height(DesignTokens.Space12))
                PrimaryButton(
                    "Save commands",
                    {
                        val edited =
                            commands.map { command ->
                                val draft = drafts[command.action] ?: return@map command
                                VoiceCommand(command.action, draft.split(',').map { it.trim() }.filter { it.isNotEmpty() })
                            }
                        onSave(edited)
                        drafts.clear()
                    },
                    enabled = drafts.isNotEmpty(),
                )
                Spacer(Modifier.height(DesignTokens.Space8))
                SecondaryButton(
                    "Reset to defaults",
                    {
                        onReset()
                        drafts.clear()
                    },
                    danger = true,
                )
            }
            commands.forEach { command ->
                SettingsSection(command.action.label) {
                    OutlinedTextField(
                        value = drafts[command.action] ?: command.phrases.joinToString(", "),
                        onValueChange = { drafts[command.action] = it.take(MAX_DRAFT) },
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.None, autoCorrectEnabled = false),
                        colors =
                            OutlinedTextFieldDefaults.colors(
                                focusedTextColor = colors.text,
                                unfocusedTextColor = colors.text,
                                focusedBorderColor = colors.accent,
                                unfocusedBorderColor = colors.border,
                                cursorColor = colors.accent,
                            ),
                        modifier = Modifier.fillMaxWidth(),
                    )
                }
            }
        }
    }
}

private const val MAX_DRAFT = 1000
