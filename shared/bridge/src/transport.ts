import type { Platform } from './contract';

interface ElectronBridgeLike {
  send(json: string): void;
}

interface AndroidBridgeLike {
  receive(json: string): void;
}

interface WebkitLike {
  messageHandlers?: { ytm?: { postMessage(message: string): void } };
}

export interface Transport {
  platform: Platform;
  send(json: string): void;
}

export function detectTransport(win: Window): Transport {
  const anyWin = win as unknown as {
    electronBridge?: ElectronBridgeLike;
    AndroidBridge?: AndroidBridgeLike;
    webkit?: WebkitLike;
  };
  const electron = anyWin.electronBridge;
  if (electron && typeof electron.send === 'function') {
    return {
      platform: 'electron',
      send: (json) => {
        electron.send(json);
      },
    };
  }
  const android = anyWin.AndroidBridge;
  if (android && typeof android.receive === 'function') {
    return {
      platform: 'android',
      send: (json) => {
        android.receive(json);
      },
    };
  }
  const handler = anyWin.webkit?.messageHandlers?.ytm;
  if (handler && typeof handler.postMessage === 'function') {
    return {
      platform: 'ios',
      send: (json) => {
        handler.postMessage(json);
      },
    };
  }
  return { platform: 'none', send: () => undefined };
}
