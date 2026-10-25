export type InnertubeEndpoint =
  | 'browse'
  | 'search'
  | 'next'
  | 'playlist/get_add_to_playlist'
  | 'browse/edit_playlist'
  | 'like/like'
  | 'like/removelike'
  | 'music/get_search_suggestions';

export interface PageConfig {
  context: unknown;
  clientName: string;
  clientVersion: string;
  visitorData: string;
  loggedIn: boolean;
}

interface YtcfgLike {
  get(key: string): unknown;
}

function ytcfgOf(win: Window): YtcfgLike | null {
  const candidate = (win as unknown as { ytcfg?: unknown }).ytcfg;
  if (typeof candidate !== 'object' || candidate === null) {
    return null;
  }
  const getter = (candidate as { get?: unknown }).get;
  if (typeof getter !== 'function') {
    return null;
  }
  return { get: (key: string) => (getter as (k: string) => unknown).call(candidate, key) };
}

export function readPageConfig(win: Window): PageConfig | null {
  const ytcfg = ytcfgOf(win);
  if (!ytcfg) {
    return null;
  }
  const context = ytcfg.get('INNERTUBE_CONTEXT');
  if (typeof context !== 'object' || context === null) {
    return null;
  }
  const clientName = ytcfg.get('INNERTUBE_CONTEXT_CLIENT_NAME');
  const clientVersion = ytcfg.get('INNERTUBE_CLIENT_VERSION');
  const visitorData = ytcfg.get('VISITOR_DATA');
  return {
    context,
    clientName: typeof clientName === 'number' || typeof clientName === 'string' ? String(clientName) : '67',
    clientVersion: typeof clientVersion === 'string' ? clientVersion : '',
    visitorData: typeof visitorData === 'string' ? visitorData : '',
    loggedIn: ytcfg.get('LOGGED_IN') === true,
  };
}

export function cookieValue(cookie: string, name: string): string | null {
  for (const part of cookie.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) {
      continue;
    }
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return null;
}

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

export async function sapisidHash(
  sapisid: string,
  origin: string,
  timestampSec: number,
  subtle: SubtleCrypto,
): Promise<string> {
  const input = new TextEncoder().encode(`${timestampSec} ${sapisid} ${origin}`);
  const digest = await subtle.digest('SHA-1', input);
  return `SAPISIDHASH ${timestampSec}_${hex(digest)}`;
}

export class InnertubeError extends Error {
  constructor(
    readonly kind: 'network' | 'http' | 'parse' | 'not_ready',
    message: string,
    readonly status = 0,
  ) {
    super(message);
  }
}

export interface InnertubeDeps {
  fetch: typeof fetch;
  config: PageConfig;
  cookie: string;
  origin: string;
  subtle: SubtleCrypto;
  now: () => number;
}

export async function innertube(
  endpoint: InnertubeEndpoint,
  body: Record<string, unknown>,
  deps: InnertubeDeps,
): Promise<unknown> {
  const headers: Record<string, string> = {
    'content-type': 'application/json',
    'x-youtube-client-name': deps.config.clientName,
    'x-youtube-client-version': deps.config.clientVersion,
    'x-origin': deps.origin,
  };
  if (deps.config.visitorData !== '') {
    headers['x-goog-visitor-id'] = deps.config.visitorData;
  }
  const sapisid = cookieValue(deps.cookie, 'SAPISID') ?? cookieValue(deps.cookie, '__Secure-3PAPISID');
  if (sapisid) {
    headers.authorization = await sapisidHash(
      sapisid,
      deps.origin,
      Math.floor(deps.now() / 1000),
      deps.subtle,
    );
    headers['x-goog-authuser'] = '0';
  }
  let response: Response;
  try {
    response = await deps.fetch(`${deps.origin}/youtubei/v1/${endpoint}?prettyPrint=false`, {
      method: 'POST',
      credentials: 'include',
      headers,
      body: JSON.stringify({ context: deps.config.context, ...body }),
    });
  } catch (error) {
    throw new InnertubeError('network', error instanceof Error ? error.message : 'Network request failed');
  }
  if (!response.ok) {
    throw new InnertubeError('http', `Request failed with status ${response.status}`, response.status);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new InnertubeError('parse', 'Response was not valid JSON');
  }
}
