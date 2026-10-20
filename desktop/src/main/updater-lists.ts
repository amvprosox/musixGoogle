import { logWarn } from './log';
import type { AdblockManager } from './adblock';

const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export function startListRefreshSchedule(manager: AdblockManager): () => void {
  const check = (): void => {
    if (!manager.isStale()) {
      return;
    }
    manager.refresh().catch((error: unknown) => {
      logWarn('adblock', 'Scheduled refresh failed', error);
    });
  };
  const timer = setInterval(check, CHECK_INTERVAL_MS);
  return () => {
    clearInterval(timer);
  };
}
