import { errorMessage } from '../../shared/guards';
import { VOICE_LANGUAGES, VOICE_ACTION_LABELS, type VoiceCommand } from '../../shared/voice-intent';
import type { AppContext } from '../context';
import { h, hydrate, icon, setText } from '../dom';
import { isAvoidedMic, type VoiceController } from '../voice';

const ENROLL_PHRASES = [
  'Veru, play my favorite songs.',
  'Veru, what is playing right now?',
  'I like listening to music in the morning.',
  'Veru, turn on shuffle and play something new.',
  'The weather is nice and the coffee is warm.',
];

function row(
  label: string,
  description: string,
  control: HTMLElement | null,
  extra: HTMLElement | null = null,
): HTMLElement {
  return h('div', { className: 'setting-row' }, [
    h('div', { className: 'setting-text' }, [
      h('span', { className: 'setting-label', text: label }),
      h('span', { className: 'setting-desc', text: description }),
      extra,
    ]),
    control,
  ]);
}

function switchButton(label: string, onToggle: (next: boolean) => void): HTMLButtonElement {
  const button = h(
    'button',
    {
      className: 'switch',
      attrs: { type: 'button', role: 'switch', 'aria-checked': 'false', 'aria-label': label },
      on: {
        click: () => {
          onToggle(button.getAttribute('aria-checked') !== 'true');
        },
      },
    },
    [h('span', { className: 'switch-track' }, [h('span', { className: 'switch-thumb' })])],
  );
  return button;
}

function setChecked(button: HTMLButtonElement, value: boolean): void {
  button.setAttribute('aria-checked', value ? 'true' : 'false');
}

export function voiceCard(ctx: AppContext, voice: VoiceController): HTMLElement {
  const { toasts } = ctx;
  const fail = (title: string) => (error: unknown) => {
    toasts.show({ variant: 'error', title, message: errorMessage(error) });
  };

  const statusText = h('p', { className: 'setting-desc voice-status', attrs: { 'aria-live': 'polite' } });
  const heardText = h('p', { className: 'setting-desc voice-heard' });
  const enabledSwitch = switchButton('Voice assistant', (next) => {
    voice.update({ enabled: next }).catch(fail('Voice setting not saved'));
  });
  const downloadButton = h('button', { className: 'btn btn-primary', attrs: { type: 'button' } }, [
    icon('download'),
    h('span', { text: 'Download voice pack (56 MB)' }),
  ]);
  downloadButton.addEventListener('click', () => {
    downloadButton.disabled = true;
    voice
      .downloadPack()
      .catch(fail('Voice pack not installed'))
      .finally(() => {
        downloadButton.disabled = false;
      });
  });

  const micSelect = h('select', { className: 'voice-select', attrs: { 'aria-label': 'Microphone' } });
  micSelect.addEventListener('change', () => {
    voice.update({ mic: micSelect.value }).catch(fail('Microphone not saved'));
  });
  const languageSelect = h(
    'select',
    { className: 'voice-select', attrs: { 'aria-label': 'Voice language' } },
    VOICE_LANGUAGES.map(([code, name]) => h('option', { attrs: { value: code }, text: name })),
  );
  languageSelect.addEventListener('change', () => {
    voice.update({ language: languageSelect.value }).catch(fail('Language not saved'));
  });
  const qualitySelect = h(
    'select',
    { className: 'voice-select', attrs: { 'aria-label': 'Recognition quality' } },
    [
      h('option', { attrs: { value: 'standard' }, text: 'Standard (fast)' }),
      h('option', { attrs: { value: 'high' }, text: 'High accuracy' }),
    ],
  );
  qualitySelect.addEventListener('change', () => {
    const quality = qualitySelect.value === 'high' ? 'high' : 'standard';
    voice.update({ quality }).catch(fail('Quality not saved'));
  });
  const boostRange = h('input', {
    className: 'voice-range',
    attrs: { type: 'range', min: '1', max: '12', step: '0.5', 'aria-label': 'Mic boost' },
  });
  const boostValue = h('span', { className: 'setting-desc' });
  boostRange.addEventListener('change', () => {
    voice.update({ micBoost: Number(boostRange.value) }).catch(fail('Mic boost not saved'));
  });
  boostRange.addEventListener('input', () => {
    setText(boostValue, `Up to ${Number(boostRange.value).toFixed(1)}x louder`);
  });
  const noiseSwitch = switchButton('Noise reduction', (next) => {
    voice.update({ noiseReduction: next }).catch(fail('Noise reduction not saved'));
  });
  const micActive = h('span', { className: 'setting-desc voice-note' });
  let renderedDevicesFor = '';
  const meterBars = Array.from({ length: 24 }, () => h('span', { className: 'voice-meter-bar' }));
  const meter = h('div', { className: 'voice-meter', attrs: { 'aria-hidden': 'true' } }, meterBars);
  const meterHistory = meterBars.map(() => 0);
  voice.onLevel((level) => {
    meterHistory.shift();
    meterHistory.push(level);
    meterBars.forEach((bar, index) => {
      const value = meterHistory[index] ?? 0;
      bar.style.transform = `scaleY(${Math.max(0.06, Math.min(1, value * 2.2)).toFixed(3)})`;
    });
  });

  const speakerSwitch = switchButton('Only my voice', (next) => {
    voice.update({ speakerCheck: next }).catch(fail('Voice setting not saved'));
  });
  const enrollPrompt = h('p', { className: 'voice-prompt', attrs: { 'aria-live': 'assertive' } });
  const enrollButton = h('button', { className: 'btn', attrs: { type: 'button' } }, [
    icon('user'),
    h('span', { text: 'Teach Musix my voice' }),
  ]);
  const testButton = h('button', { className: 'btn', attrs: { type: 'button' } }, [
    icon('circle-check'),
    h('span', { text: 'Test my voice' }),
  ]);
  const forgetButton = h('button', { className: 'btn btn-danger', attrs: { type: 'button' } }, [
    icon('trash-2'),
    h('span', { text: 'Forget my voice' }),
  ]);
  const threshold = h('input', {
    className: 'voice-range',
    attrs: { type: 'range', min: '0.1', max: '0.9', step: '0.01', 'aria-label': 'Voice match threshold' },
  });
  const thresholdValue = h('span', { className: 'setting-desc' });
  threshold.addEventListener('change', () => {
    voice.update({ speakerThreshold: Number(threshold.value) }).catch(fail('Threshold not saved'));
  });
  const sensitivity = h('input', {
    className: 'voice-range',
    attrs: { type: 'range', min: '0', max: '1', step: '0.05', 'aria-label': 'Wake word sensitivity' },
  });
  sensitivity.addEventListener('change', () => {
    voice.update({ sensitivity: Number(sensitivity.value) }).catch(fail('Sensitivity not saved'));
  });

  enrollButton.addEventListener('click', () => {
    enrollButton.disabled = true;
    const run = async (): Promise<void> => {
      const clips: Float32Array[] = [];
      for (const [index, phrase] of ENROLL_PHRASES.entries()) {
        setText(enrollPrompt, `Say (${index + 1}/${ENROLL_PHRASES.length}): "${phrase}"`);
        clips.push(await voice.record(3.5));
      }
      setText(enrollPrompt, 'Saving your voice...');
      const result = await ctx.api.invoke('voice:enroll', clips);
      setText(enrollPrompt, result.message);
      const { config } = await ctx.api.invoke('voice:get', null);
      voice.config = config;
      render();
    };
    run()
      .catch((error: unknown) => {
        setText(enrollPrompt, errorMessage(error));
      })
      .finally(() => {
        enrollButton.disabled = false;
      });
  });
  testButton.addEventListener('click', () => {
    testButton.disabled = true;
    const run = async (): Promise<void> => {
      setText(enrollPrompt, 'Say anything for 3 seconds...');
      const clip = await voice.record(3);
      const score = await ctx.api.invoke('voice:test', clip);
      const limit = voice.config?.speakerThreshold ?? 0.45;
      setText(
        enrollPrompt,
        score === null
          ? 'Teach Musix your voice first.'
          : `Match score ${score.toFixed(2)} (needs ${limit.toFixed(2)}): ${score >= limit ? 'that is you' : 'not a match'}.`,
      );
    };
    run()
      .catch((error: unknown) => {
        setText(enrollPrompt, errorMessage(error));
      })
      .finally(() => {
        testButton.disabled = false;
      });
  });
  forgetButton.addEventListener('click', () => {
    voice.forgetVoice().catch(fail('Could not forget voice'));
  });

  const aiSwitch = switchButton('Free AI for other requests', (next) => {
    voice.update({ aiEnabled: next }).catch(fail('AI setting not saved'));
  });
  const keyInput = h('input', {
    className: 'voice-input',
    attrs: {
      type: 'password',
      placeholder: 'OpenRouter API key',
      autocomplete: 'off',
      spellcheck: 'false',
      'aria-label': 'OpenRouter API key',
    },
  });
  const saveKey = h('button', { className: 'btn', attrs: { type: 'button' } }, [
    icon('check'),
    h('span', { text: 'Save key' }),
  ]);
  const removeKey = h('button', { className: 'btn btn-danger', attrs: { type: 'button' } }, [
    icon('trash-2'),
    h('span', { text: 'Remove key' }),
  ]);
  const keyStatus = h('p', { className: 'setting-desc' });
  const learnedNote = h('p', { className: 'setting-desc voice-note' });
  const connectButton = h('button', { className: 'btn btn-primary', attrs: { type: 'button' } }, [
    icon('log-in'),
    h('span', { text: 'Connect OpenRouter' }),
  ]);
  const connectRow = h('div', { className: 'voice-key-row' }, [connectButton]);
  const keyRow = h('div', { className: 'voice-key-row' }, [keyInput, saveKey]);
  const removeRow = h('div', { className: 'voice-key-row' }, [removeKey]);
  connectButton.addEventListener('click', () => {
    connectButton.disabled = true;
    toasts.show({
      variant: 'info',
      title: 'Connect OpenRouter',
      message: 'Your browser opened OpenRouter. Press Authorize there, then come back to Musix.',
    });
    voice
      .connectAi()
      .then(() => {
        toasts.show({
          variant: 'success',
          title: 'OpenRouter connected',
          message: 'Only free models will be used.',
        });
      })
      .catch(fail('OpenRouter not connected'))
      .finally(() => {
        connectButton.disabled = false;
      });
  });
  saveKey.addEventListener('click', () => {
    const value = keyInput.value.trim();
    if (value === '') {
      return;
    }
    voice
      .setAiKey(value)
      .then(() => {
        keyInput.value = '';
        toasts.show({ variant: 'success', title: 'AI key saved', message: 'Only free models will be used.' });
      })
      .catch(fail('Key not saved'));
  });
  removeKey.addEventListener('click', () => {
    voice.setAiKey(null).catch(fail('Key not removed'));
  });

  const commandsList = h('div', { className: 'voice-commands' });
  const commandInputs = new Map<string, HTMLInputElement>();
  const saveCommands = h('button', { className: 'btn btn-primary', attrs: { type: 'button' } }, [
    icon('check'),
    h('span', { text: 'Save commands' }),
  ]);
  const resetCommands = h('button', { className: 'btn', attrs: { type: 'button' } }, [
    icon('rotate-cw'),
    h('span', { text: 'Reset to defaults' }),
  ]);
  saveCommands.addEventListener('click', () => {
    const commands: VoiceCommand[] = (voice.config?.commands ?? []).map((command) => ({
      action: command.action,
      phrases: (commandInputs.get(command.action)?.value ?? '')
        .split(',')
        .map((phrase) => phrase.trim())
        .filter((phrase) => phrase !== ''),
    }));
    voice
      .update({ commands })
      .then(() => {
        toasts.show({
          variant: 'success',
          title: 'Voice commands saved',
          message: `${commands.length} actions`,
        });
      })
      .catch(fail('Commands not saved'));
  });
  resetCommands.addEventListener('click', () => {
    voice.update({ commands: [] }).catch(fail('Commands not reset'));
  });

  const renderCommands = (): void => {
    const commands = voice.config?.commands ?? [];
    commandInputs.clear();
    commandsList.replaceChildren(
      ...commands.map((command) => {
        const input = h('input', {
          className: 'voice-input',
          attrs: {
            type: 'text',
            spellcheck: 'false',
            'aria-label': `${VOICE_ACTION_LABELS[command.action]} phrases`,
          },
        });
        input.value = command.phrases.join(', ');
        commandInputs.set(command.action, input);
        return h('label', { className: 'voice-command' }, [
          h('span', { className: 'setting-label', text: VOICE_ACTION_LABELS[command.action] }),
          input,
        ]);
      }),
    );
  };

  const details = h('div', { className: 'voice-details' }, [
    row(
      'Microphone',
      'Like Siri on a Mac, Musix listens with your computer or wired microphone. Bluetooth earbud mics are not used because they switch your earbuds to call mode.',
      micSelect,
      micActive,
    ),
    row('Noise reduction', 'Cleans background noise so Musix hears you from across the room.', noiseSwitch),
    row(
      'Mic boost',
      'Makes quiet voices louder before Musix listens. Raise it if Musix misses what you say.',
      boostRange,
      boostValue,
    ),
    h('div', { className: 'voice-meter-row' }, [
      h('span', { className: 'setting-desc', text: 'Live input' }),
      meter,
    ]),
    row(
      'Recognition quality',
      'High accuracy understands names and other languages better, and takes about a second. It downloads a 231 MB speech model once.',
      qualitySelect,
    ),
    row(
      'Voice language',
      'The language you speak to Musix. Mixed English, like Taglish, works too. Other languages download a 94 MB speech model once.',
      languageSelect,
    ),
    row('Only my voice', 'Ignore "Veru" from anyone whose voice does not match yours.', speakerSwitch),
    h('div', { className: 'voice-actions' }, [
      h('div', { className: 'button-row' }, [enrollButton, testButton, forgetButton]),
      enrollPrompt,
    ]),
    row(
      'Voice match threshold',
      'Higher is stricter. Teach Musix your voice to set it automatically.',
      threshold,
      thresholdValue,
    ),
    row(
      'Wake word sensitivity',
      'Raise it if "Veru" is missed, lower it if it wakes by mistake.',
      sensitivity,
    ),
    row(
      'Free AI for other requests',
      'Understands requests the built-in commands do not. Online only.',
      aiSwitch,
    ),
    keyStatus,
    learnedNote,
    connectRow,
    keyRow,
    removeRow,
    h('h4', { className: 'voice-subtitle', text: 'Voice commands' }),
    h('p', {
      className: 'setting-desc',
      text: 'Say "Veru" and then one of these phrases. Separate phrases with commas. Use {query} for a song, playlist, or theme name.',
    }),
    commandsList,
    h('div', { className: 'button-row' }, [saveCommands, resetCommands]),
  ]);

  let renderedCommandsFor = '';
  const render = (): void => {
    const config = voice.config;
    const status = voice.status;
    setChecked(enabledSwitch, config?.enabled ?? false);
    downloadButton.hidden = !config?.enabled || config.packInstalled || status.state === 'downloading';
    const progress = status.state === 'downloading' ? ` ${Math.round(status.progress * 100)}%` : '';
    setText(statusText, config?.enabled ? `${status.message || 'Ready'}${progress}` : 'Off');
    setText(heardText, status.heard !== '' ? `Last heard: "${status.heard}"` : '');
    details.hidden = !config?.enabled;
    const wanted = config?.mic ?? 'default';
    const deviceSignature = JSON.stringify(voice.devices);
    if (deviceSignature !== renderedDevicesFor) {
      renderedDevicesFor = deviceSignature;
      micSelect.replaceChildren(
        h('option', { attrs: { value: 'default' }, text: 'Automatic' }),
        ...voice.devices
          .filter((device) => device.id !== 'default' && !isAvoidedMic(device.label))
          .map((device) => h('option', { attrs: { value: device.id }, text: device.label })),
      );
    }
    const selected = voice.devices.some((device) => device.id === wanted && !isAvoidedMic(device.label))
      ? wanted
      : 'default';
    if (micSelect.value !== selected && document.activeElement !== micSelect) {
      micSelect.value = selected;
    }
    setText(micActive, voice.activeMic !== '' ? `Listening with: ${voice.activeMic}` : '');
    setChecked(speakerSwitch, config?.speakerCheck ?? true);
    threshold.value = String(config?.speakerThreshold ?? 0.45);
    setText(
      thresholdValue,
      config?.hasVoiceprint
        ? `Threshold ${config.speakerThreshold.toFixed(2)}`
        : 'Musix does not know your voice yet, so it answers anyone.',
    );
    forgetButton.hidden = !config?.hasVoiceprint;
    testButton.hidden = !config?.hasVoiceprint;
    sensitivity.value = String(config?.sensitivity ?? 0.5);
    setChecked(aiSwitch, config?.aiEnabled ?? true);
    const learned = config?.learnedCount ?? 0;
    setText(
      learnedNote,
      learned > 0
        ? `Musix has learned ${learned} ${learned === 1 ? 'phrase' : 'phrases'} from you, so ${learned === 1 ? 'it works' : 'they work'} instantly without AI.`
        : '',
    );
    setChecked(noiseSwitch, config?.noiseReduction ?? true);
    if (document.activeElement !== qualitySelect) {
      qualitySelect.value = config?.quality ?? 'standard';
    }
    if (document.activeElement !== boostRange) {
      boostRange.value = String(config?.micBoost ?? 6);
      setText(boostValue, `Up to ${(config?.micBoost ?? 6).toFixed(1)}x louder`);
    }
    if (document.activeElement !== languageSelect) {
      languageSelect.value = config?.language ?? 'en';
    }
    const connected = config?.hasAiKey ?? false;
    connectRow.hidden = connected;
    keyRow.hidden = connected;
    removeRow.hidden = !connected || (config?.builtinAi ?? false);
    setText(
      keyStatus,
      config?.builtinAi
        ? 'Free AI is built in and ready. Only free ":free" models are ever called, so it never costs money.'
        : config?.hasAiKey
          ? 'Connected to your OpenRouter account. Only free ":free" models are ever called, so it never costs money.'
          : 'Press Connect OpenRouter and Authorize in your browser. Or paste a key from openrouter.ai/keys.',
    );
    const signature = JSON.stringify(config?.commands ?? []);
    if (signature !== renderedCommandsFor) {
      renderedCommandsFor = signature;
      renderCommands();
    }
  };

  voice.subscribe(render);
  render();

  const section = h(
    'section',
    { className: 'card span-2', attrs: { id: 'settings-voice', 'aria-labelledby': 'settings-voice-title' } },
    [
      h('div', { className: 'card-header' }, [
        h('span', { className: 'card-header-icon', attrs: { 'aria-hidden': 'true' } }, [icon('volume-2')]),
        h('h3', { className: 'card-title', attrs: { id: 'settings-voice-title' }, text: 'Voice assistant' }),
      ]),
      h('div', { className: 'card-body' }, [
        row('Voice assistant', 'Say "Veru" to control Musix hands free. Works offline.', enabledSwitch),
        statusText,
        heardText,
        h('div', { className: 'button-row' }, [downloadButton]),
        details,
      ]),
    ],
  );
  hydrate(section);
  return section;
}
