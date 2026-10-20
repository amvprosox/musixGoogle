import type { ShellApi } from '../shared/channels';

export function getShellApi(): ShellApi | null {
  const api = window.musix;
  if (
    !api ||
    typeof api.invoke !== 'function' ||
    typeof api.send !== 'function' ||
    typeof api.on !== 'function'
  ) {
    return null;
  }
  return api;
}
