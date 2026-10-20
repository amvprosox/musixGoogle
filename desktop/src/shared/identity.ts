const ACCOUNT_HOSTS = [/^accounts\.google\.[a-z]{2,3}(\.[a-z]{2})?$/, /^accounts\.youtube\.com$/];

export function isGoogleAccountsUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && ACCOUNT_HOSTS.some((pattern) => pattern.test(parsed.hostname));
}

export function nativeUserAgent(electronDefault: string): string {
  return electronDefault.trim();
}

export function accountRequestHeaders(
  headers: Readonly<Record<string, string>>,
  userAgent: string,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    if (name.toLowerCase() !== 'user-agent') {
      out[name] = value;
    }
  }
  out['User-Agent'] = userAgent;
  return out;
}
