import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { OPENROUTER_BASE } from '../shared/ai-intent';

const CONNECT_TIMEOUT_MS = 5 * 60_000;
const EXCHANGE_TIMEOUT_MS = 15_000;
const AUTH_URL = 'https://openrouter.ai/auth';

function base64url(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface PkcePair {
  verifier: string;
  challenge: string;
  state: string;
}

export function createPkce(): PkcePair {
  const verifier = base64url(randomBytes(32));
  return {
    verifier,
    challenge: base64url(createHash('sha256').update(verifier).digest()),
    state: base64url(randomBytes(16)),
  };
}

export function authUrl(pkce: PkcePair, callbackUrl: string, label: string): string {
  const params = new URLSearchParams({
    callback_url: callbackUrl,
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    key_label: label,
    state: pkce.state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(code: string, verifier: string): Promise<string> {
  const response = await fetch(`${OPENROUTER_BASE}/auth/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, code_verifier: verifier, code_challenge_method: 'S256' }),
    signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`OpenRouter did not accept the sign-in (HTTP ${response.status})`);
  }
  const body = (await response.json()) as { key?: unknown };
  if (typeof body.key !== 'string' || body.key.trim() === '' || body.key.length > 400) {
    throw new Error('OpenRouter returned no key');
  }
  return body.key.trim();
}

function page(title: string, message: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#121212;color:#f2f2f2;font:16px system-ui,sans-serif}main{max-width:420px;padding:24px;text-align:center}h1{font-size:22px}</style></head><body><main><h1>${title}</h1><p>${message}</p></main></body></html>`;
}

export interface ConnectOptions {
  openExternal: (url: string) => Promise<void>;
  label: string;
}

export function connectOpenRouter(options: ConnectOptions): Promise<string> {
  const pkce = createPkce();
  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const servers: http.Server[] = [];
    const finish = (error: Error | null, key?: string): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      setTimeout(() => {
        for (const server of servers) {
          server.close();
          server.closeAllConnections();
        }
      }, 1000);
      if (error) {
        reject(error);
      } else if (key) {
        resolve(key);
      }
    };
    const timer = setTimeout(() => {
      finish(new Error('OpenRouter sign-in timed out. Try again.'));
    }, CONNECT_TIMEOUT_MS);
    const handler = (request: http.IncomingMessage, response: http.ServerResponse): void => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const send = (status: number, title: string, message: string): void => {
        response.writeHead(status, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        response.end(page(title, message));
      };
      if (request.method !== 'GET' || url.pathname !== '/callback') {
        send(404, 'Not found', 'This page belongs to Musix.');
        return;
      }
      const code = url.searchParams.get('code') ?? '';
      const state = url.searchParams.get('state');
      if (settled || code === '' || code.length > 2000 || (state !== null && state !== pkce.state)) {
        send(400, 'Connection failed', 'Go back to Musix and press Connect OpenRouter again.');
        if (!settled && state !== null && state !== pkce.state) {
          finish(new Error('OpenRouter sign-in did not match. Try again.'));
        }
        return;
      }
      exchangeCode(code, pkce.verifier)
        .then((key) => {
          send(200, 'Musix is connected', 'You can close this tab and go back to Musix.');
          finish(null, key);
        })
        .catch((error: unknown) => {
          send(502, 'Connection failed', 'Go back to Musix and press Connect OpenRouter again.');
          finish(error instanceof Error ? error : new Error('OpenRouter sign-in failed'));
        });
    };
    const primary = http.createServer(handler);
    servers.push(primary);
    primary.on('error', (error) => {
      finish(error);
    });
    primary.listen(0, '127.0.0.1', () => {
      const { port } = primary.address() as AddressInfo;
      const secondary = http.createServer(handler);
      secondary.on('error', () => undefined);
      secondary.listen(port, '::1');
      servers.push(secondary);
      const callback = `http://localhost:${port}/callback`;
      options.openExternal(authUrl(pkce, callback, options.label)).catch((error: unknown) => {
        finish(error instanceof Error ? error : new Error('Could not open the browser'));
      });
    });
  });
}
