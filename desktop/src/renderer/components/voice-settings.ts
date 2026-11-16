import { errorMessage } from '../../shared/guards';
import { VOICE_ACTION_LABELS, type VoiceCommand } from '../../shared/voice-intent';
import type { AppContext } from '../context';
import { h, hydrate, icon, setText } from '../dom';
import type { VoiceController } from '../voice';

const ENROLL_PHRASES = [
  'Prosox, play my favorite songs.',
  'Prosox, what is playing right now?',
  'I like listening to music in the morning.',
  'Prosox, turn on shuffle and play something new.',
  'The weather is nice and the coffee is warm.',
];

function row(label: string, description: string, control: HTMLElement | null): HTMLElement {
  return h('div', { className: 'setting-row' }, [
    h('div', { className: 'setting-text' }, [
      h('span', { className: 'setting-label', text: label }),
      h('span', { className: 'setting-desc', text: description }),
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
  const micActive = h('span', { className: 'setting-desc' });

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
  const connectButton = h('button', { className: 'btn btn-primary', attrs: { type: 'button' } }, [
    icon('log-in'),
    h('span', { text: 'Connect OpenRouter' }),
  ]);
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
    row('Microphone', 'Musix follows the microphone you pick, or the system default.', micSelect),
    micActive,
    row('Only my voice', 'Ignore "prosox" from anyone whose voice does not match yours.', speakerSwitch),
    h('div', { className: 'button-row' }, [enrollButton, testButton, forgetButton]),
    enrollPrompt,
    row(
      'Voice match threshold',
      'Higher is stricter. Teach Musix your voice to set it automatically.',
      threshold,
    ),
    thresholdValue,
    row(
      'Wake word sensitivity',
      'Raise it if "prosox" is missed, lower it if it wakes by mistake.',
      sensitivity,
    ),
    row(
      'Free AI for other requests',
      'Understands requests the built-in commands do not. Online only.',
      aiSwitch,
    ),
    h('div', { className: 'voice-key-row' }, [connectButton]),
    h('div', { className: 'voice-key-row' }, [keyInput, saveKey, removeKey]),
    keyStatus,
    h('h4', { className: 'voice-subtitle', text: 'Voice commands' }),
    h('p', {
      className: 'setting-desc',
      text: 'Say "prosox" and then one of these phrases. Separate phrases with commas. Use {query} for a song, playlist, or theme name.',
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
    micSelect.replaceChildren(
      h('option', { attrs: { value: 'default' }, text: 'System default' }),
      ...voice.devices
        .filter((device) => device.id !== 'default')
        .map((device) => h('option', { attrs: { value: device.id }, text: device.label })),
    );
    micSelect.value = voice.devices.some((device) => device.id === wanted) ? wanted : 'default';
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
    removeKey.hidden = !config?.hasAiKey;
    setText(
      connectButton.querySelector('span'),
      config?.hasAiKey ? 'Reconnect OpenRouter' : 'Connect OpenRouter',
    );
    setText(
      keyStatus,
      config?.hasAiKey
        ? 'Key saved on this computer (encrypted). Only free ":free" models are ever called, so it never costs money.'
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
        row('Voice assistant', 'Say "prosox" to control Musix hands free. Works offline.', enabledSwitch),
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
