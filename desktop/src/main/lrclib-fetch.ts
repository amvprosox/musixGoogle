/**
 * LRCLIB rate-limits by IP. Fetching lyrics for many downloads at once used to hit
 * "Too many requests", which was logged as "No lyrics found". This client spaces requests
 * out and waits and retries when LRCLIB says it is busy.
 */

const MIN_GAP_MS = 450;
const RETRY_WAITS_MS = [4_000, 10_000, 20_000];

export class LyricsBusyError extends Error {
  constructor() {
    super('The lyrics service is busy.');
    this.name = 'LyricsBusyError';
  }
}

let nextSlot = 0;

async function waitForSlot(): Promise<void> {
  const now = Date.now();
  const at = Math.max(now, nextSlot);
  nextSlot = at + MIN_GAP_MS;
  if (at > now) {
    await new Promise((resolve) => setTimeout(resolve, at - now));
  }
}

function retryAfterMs(header: string | null, fallback: number): number {
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(60_000, seconds * 1000) : fallback;
}

export async function fetchLrclibJson(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt += 1) {
    await waitForSlot();
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Musix (https://github.com/amvprosox/musixGoogle)',
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 404) {
      return null;
    }
    if (response.status === 429 || response.status === 503) {
      const wait = RETRY_WAITS_MS[attempt];
      if (wait === undefined) {
        throw new LyricsBusyError();
      }
      const delay = retryAfterMs(response.headers.get('retry-after'), wait);
      nextSlot = Math.max(nextSlot, Date.now() + delay);
      continue;
    }
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return (await response.json()) as unknown;
  }
}
