import { BRIDGE_VERSION, type BridgeCommand, type BridgeEvent, type BridgeState } from './contract';
import { CommandRunner } from './commands';
import { innertube, InnertubeError, readPageConfig, type InnertubeEndpoint } from './innertube';
import { PlayerObserver } from './player';
import { detectTransport } from './transport';
import { parseBridgeCommand } from './validate';

export interface MusixBridge {
  readonly version: number;
  receive(input: unknown): boolean;
  state(): BridgeState;
  isReady(): boolean;
  dispose(): void;
}

const READY_POLL_MS = 250;

export function installBridge(win: Window, doc: Document): MusixBridge | null {
  const existing = (win as unknown as { __musixBridge?: MusixBridge }).__musixBridge;
  if (existing) {
    return existing;
  }
  if (win.top !== win) {
    return null;
  }
  const emit = (event: BridgeEvent): void => {
    try {
      detectTransport(win).send(JSON.stringify(event));
    } catch {
      return;
    }
  };
  const observer = new PlayerObserver(doc, win, {
    state: (state) => {
      emit({ v: 1, type: 'state', state });
    },
    queue: (items) => {
      emit({ v: 1, type: 'queue', items });
    },
    adStart: () => {
      emit({ v: 1, type: 'adStart' });
    },
    adEnd: () => {
      emit({ v: 1, type: 'adEnd' });
    },
    signedIn: (avatarUrl) => {
      emit({ v: 1, type: 'signedIn', avatarUrl });
    },
    signedOut: () => {
      emit({ v: 1, type: 'signedOut' });
    },
  });
  const request = async (endpoint: InnertubeEndpoint, body: Record<string, unknown>): Promise<unknown> => {
    const config = readPageConfig(win);
    if (!config) {
      throw new InnertubeError('not_ready', 'YouTube Music configuration is not available yet');
    }
    const subtle = (win.crypto as Crypto | undefined)?.subtle;
    if (!subtle) {
      throw new InnertubeError('not_ready', 'Web Crypto is not available');
    }
    return innertube(endpoint, body, {
      fetch: win.fetch.bind(win),
      config,
      cookie: doc.cookie,
      origin: win.location.origin,
      subtle,
      now: () => Date.now(),
    });
  };
  const runner = new CommandRunner({
    doc,
    win,
    observer,
    emit,
    request,
    wait: (ms) =>
      new Promise((resolve) => {
        win.setTimeout(resolve, ms);
      }),
  });
  let ready = false;
  let started = false;
  let disposed = false;
  const pending: BridgeCommand[] = [];
  const runCommand = (command: BridgeCommand): void => {
    runner.run(command).catch(() => undefined);
  };
  const bridge: MusixBridge = {
    version: BRIDGE_VERSION,
    receive(input: unknown): boolean {
      const command = parseBridgeCommand(input);
      if (!command) {
        emit({
          v: 1,
          type: 'error',
          code: 'invalid_command',
          message: 'Command rejected by validation',
          requestId: null,
        });
        return false;
      }
      if (!ready) {
        if (command.type === 'configure' || command.type === 'duck') {
          pending.push(command);
          return true;
        }
        emit({
          v: 1,
          type: 'error',
          code: 'not_ready',
          message: 'Bridge is not ready',
          requestId: command.requestId,
        });
        return false;
      }
      runCommand(command);
      return true;
    },
    state: () => observer.current(),
    isReady: () => ready,
    dispose: () => {
      disposed = true;
      observer.stop();
      Reflect.deleteProperty(win, '__musixBridge');
    },
  };
  Object.defineProperty(win, '__musixBridge', {
    value: bridge,
    configurable: true,
    writable: false,
    enumerable: false,
  });

  const checkReady = (): void => {
    if (disposed) {
      return;
    }
    if (!started && doc.readyState !== 'loading') {
      started = true;
      observer.start();
    }
    if (!ready && started && observer.isReady()) {
      ready = true;
      const config = readPageConfig(win);
      emit({
        v: 1,
        type: 'ready',
        platform: detectTransport(win).platform,
        clientVersion: config ? config.clientVersion : '',
      });
      observer.forceState();
      while (pending.length > 0) {
        const next = pending.shift();
        if (next) {
          runCommand(next);
        }
      }
      return;
    }
    if (!ready) {
      win.setTimeout(checkReady, READY_POLL_MS);
    }
  };
  checkReady();
  return bridge;
}
