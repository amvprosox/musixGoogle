import MusixCore
import SwiftUI

struct VoiceSettingsView: View {
    @ObservedObject var voice: VoiceController
    @State private var keyText = ""

    var body: some View {
        Form {
            Section {
                Toggle(isOn: $voice.enabled) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Voice assistant").font(.body(DesignTokens.text16))
                        Text("Say \"Prosecs\" to control Musix hands free. Works offline.")
                            .font(.body(DesignTokens.text14))
                            .foregroundStyle(Palette.textMuted)
                    }
                }
                .tint(Palette.accent)
                Text(voice.stateText)
                    .font(.body(DesignTokens.text14, weight: .semibold))
                    .foregroundStyle(Palette.text)
                if case let .downloading(progress) = voice.state {
                    ProgressView(value: progress)
                        .tint(Palette.accent)
                }
                if voice.enabled, !voice.packInstalled, !voice.busy {
                    Button("Download voice pack (56 MB)") {
                        voice.downloadPack()
                    }
                    .font(.body(DesignTokens.text16, weight: .semibold))
                }
                if !voice.heard.isEmpty {
                    Text("Last heard: \"\(voice.heard)\"")
                        .font(.body(DesignTokens.text14))
                        .foregroundStyle(Palette.textMuted)
                }
                if !voice.notice.isEmpty {
                    Text(voice.notice)
                        .font(.body(DesignTokens.text14))
                        .foregroundStyle(Palette.textMuted)
                }
            } header: {
                Text("Voice").font(.body(DesignTokens.text14, weight: .semibold))
            }

            if voice.enabled {
                Section {
                    Picker("Microphone", selection: $voice.microphone) {
                        Text("Automatic").tag("auto")
                        ForEach(voice.inputs) { input in
                            Text(input.name).tag(input.id)
                        }
                    }
                    if !voice.activeInput.isEmpty {
                        Text("Listening with: \(voice.activeInput)")
                            .font(.body(DesignTokens.text14))
                            .foregroundStyle(Palette.textMuted)
                    }
                    Text("With Bluetooth headphones, Automatic uses the iPhone microphone so music keeps full quality.")
                        .font(.body(DesignTokens.text14))
                        .foregroundStyle(Palette.textMuted)
                } header: {
                    Text("Microphone").font(.body(DesignTokens.text14, weight: .semibold))
                }

                Section {
                    Toggle("Only my voice", isOn: $voice.speakerCheck)
                        .tint(Palette.accent)
                    Button(voice.hasVoiceprint ? "Teach Musix my voice again" : "Teach Musix my voice") {
                        Task { await voice.enroll() }
                    }
                    .disabled(voice.busy)
                    if voice.hasVoiceprint {
                        Button("Test my voice") {
                            Task { await voice.testVoice() }
                        }
                        .disabled(voice.busy)
                        Button("Forget my voice", role: .destructive) {
                            voice.forgetVoice()
                        }
                    }
                    if !voice.enrollPrompt.isEmpty {
                        Text(voice.enrollPrompt)
                            .font(.body(DesignTokens.text16, weight: .semibold))
                            .foregroundStyle(Palette.accent)
                    }
                    VStack(alignment: .leading) {
                        Text("Voice match threshold \(String(format: "%.2f", voice.speakerThreshold))")
                            .font(.body(DesignTokens.text14))
                        Slider(value: $voice.speakerThreshold, in: 0.1...0.9, step: 0.01)
                            .tint(Palette.accent)
                    }
                    VStack(alignment: .leading) {
                        Text("Wake word sensitivity \(Int(voice.sensitivity * 100))%")
                            .font(.body(DesignTokens.text14))
                        Slider(value: $voice.sensitivity, in: 0...1, step: 0.05, onEditingChanged: { editing in
                            if !editing {
                                voice.reloadEngine()
                            }
                        })
                        .tint(Palette.accent)
                    }
                } header: {
                    Text("Your voice").font(.body(DesignTokens.text14, weight: .semibold))
                } footer: {
                    Text(voice.hasVoiceprint
                        ? "Musix ignores \"Prosecs\" from voices that do not match yours."
                        : "Musix does not know your voice yet, so it answers anyone.")
                        .font(.body(DesignTokens.text14))
                }

                Section {
                    NavigationLink {
                        VoiceCommandsView(voice: voice)
                    } label: {
                        Text("Edit voice commands").font(.body(DesignTokens.text16))
                    }
                } header: {
                    Text("Commands").font(.body(DesignTokens.text14, weight: .semibold))
                }

                Section {
                    Toggle("Free AI for other requests", isOn: $voice.aiEnabled)
                        .tint(Palette.accent)
                    Button(voice.hasAiKey ? "Reconnect OpenRouter" : "Connect OpenRouter") {
                        Task { await voice.connectAi() }
                    }
                    .font(.body(DesignTokens.text16, weight: .semibold))
                    .disabled(voice.connecting)
                    SecureField("Or paste an OpenRouter API key", text: $keyText)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                    Button("Save key") {
                        voice.setAiKey(keyText)
                        keyText = ""
                    }
                    .disabled(keyText.trimmingCharacters(in: .whitespaces).isEmpty)
                    if voice.hasAiKey, !voice.builtinAi {
                        Button("Remove key", role: .destructive) {
                            voice.setAiKey(nil)
                        }
                    }
                } header: {
                    Text("AI").font(.body(DesignTokens.text14, weight: .semibold))
                } footer: {
                    Text(voice.builtinAi
                        ? "Free AI is built in and ready. Only free \":free\" models are ever called, so it never costs money."
                        : voice.hasAiKey
                        ? "Key saved in the iPhone Keychain. Only free \":free\" models are ever called, so it never costs money. Used online only, for requests the built-in commands do not understand."
                        : "Tap Connect OpenRouter and Authorize. Musix gets its own key and only ever uses free models.")
                        .font(.body(DesignTokens.text14))
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Palette.bg)
        .navigationTitle("Voice assistant")
        .navigationBarTitleDisplayMode(.inline)
    }
}

struct VoiceCommandsView: View {
    @ObservedObject var voice: VoiceController
    @State private var drafts: [VoiceAction: String] = [:]

    var body: some View {
        Form {
            Section {
                Text("Say \"Prosecs\" and then one of these phrases. Separate phrases with commas. Use {query} for a song, playlist, or theme name.")
                    .font(.body(DesignTokens.text14))
                    .foregroundStyle(Palette.textMuted)
            }
            ForEach(voice.commands, id: \.action) { command in
                Section {
                    TextField(
                        "Phrases",
                        text: Binding(
                            get: { drafts[command.action] ?? command.phrases.joined(separator: ", ") },
                            set: { drafts[command.action] = $0 }
                        ),
                        axis: .vertical
                    )
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                } header: {
                    Text(command.action.label).font(.body(DesignTokens.text14, weight: .semibold))
                }
            }
            Section {
                Button("Save commands") {
                    voice.commands = voice.commands.map { command in
                        guard let draft = drafts[command.action] else {
                            return command
                        }
                        let phrases = draft.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
                        return VoiceCommand(action: command.action, phrases: phrases)
                    }
                    voice.commands = VoiceIntentMatcher.sanitize(voice.commands)
                    drafts = [:]
                }
                Button("Reset to defaults", role: .destructive) {
                    voice.resetCommands()
                    drafts = [:]
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(Palette.bg)
        .navigationTitle("Voice commands")
        .navigationBarTitleDisplayMode(.inline)
    }
}
