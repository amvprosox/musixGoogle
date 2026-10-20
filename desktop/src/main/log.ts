import { errorMessage } from '../shared/guards';

export function logInfo(scope: string, message: string): void {
  console.info(`[${scope}] ${message}`);
}

export function logWarn(scope: string, message: string, error?: unknown): void {
  if (error === undefined) {
    console.warn(`[${scope}] warning: ${message}`);
    return;
  }
  console.warn(`[${scope}] warning: ${message}: ${errorMessage(error)}`);
}

export function logError(scope: string, message: string, error?: unknown): void {
  if (error === undefined) {
    console.error(`[${scope}] error: ${message}`);
    return;
  }
  console.error(`[${scope}] error: ${message}: ${errorMessage(error)}`);
}
