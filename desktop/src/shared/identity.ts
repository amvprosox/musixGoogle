const FIREFOX_BASE_VERSION = 128;
const FIREFOX_BASE_RELEASE = Date.UTC(2024, 6, 9);
const RELEASE_CYCLE_MS = 28 * 24 * 60 * 60 * 1000;
const ACCOUNT_HOSTS = [/^accounts\.google\.[a-z]{2,3}(\.[a-z]{2})?$/, /^accounts\.youtube\.com$/];

export function firefoxVersionFor(now: Date): number {
  const elapsed = now.getTime() - FIREFOX_BASE_RELEASE;
  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    return FIREFOX_BASE_VERSION;
  }
  return FIREFOX_BASE_VERSION + Math.max(0, Math.floor(elapsed / RELEASE_CYCLE_MS) - 1);
}

export function firefoxUserAgent(now: Date): string {
  const version = firefoxVersionFor(now);
  return `Mozilla/5.0 (X11; Linux x86_64; rv:${version}.0) Gecko/20100101 Firefox/${version}.0`;
}

export function isGoogleAccountsUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && ACCOUNT_HOSTS.some((pattern) => pattern.test(parsed.hostname));
}

export function accountRequestHeaders(
  headers: Readonly<Record<string, string>>,
  userAgent: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower.startsWith('sec-ch-ua') || lower === 'user-agent') {
      continue;
    }
    out[name] = value;
  }
  out['User-Agent'] = userAgent;
  return out;
}
