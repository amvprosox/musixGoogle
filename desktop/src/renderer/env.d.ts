import type { OverlayApi, ShellApi } from '../shared/channels';

declare global {
  interface Window {
    musix?: ShellApi;
    musixOverlay?: OverlayApi;
  }
}

export {};
