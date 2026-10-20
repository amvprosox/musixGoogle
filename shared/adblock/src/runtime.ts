import type { ScriptletCall } from './filters';

type Bag = Record<string, unknown>;

function isObject(value: unknown): value is Bag {
  return typeof value === 'object' && value !== null;
}

export function pruneAt(target: unknown, segments: readonly string[], index = 0): void {
  if (!isObject(target) || index >= segments.length) {
    return;
  }
  const segment = segments[index] ?? '';
  const isLast = index === segments.length - 1;
  if (segment === '[]' || segment === '[-]') {
    if (Array.isArray(target)) {
      for (const entry of target) {
        pruneAt(entry, segments, index + 1);
      }
    }
    return;
  }
  if (segment === '*') {
    for (const key of Object.keys(target)) {
      if (isLast) {
        Reflect.deleteProperty(target, key);
      } else {
        pruneAt(target[key], segments, index + 1);
      }
    }
    return;
  }
  if (!(segment in target)) {
    return;
  }
  if (isLast) {
    Reflect.deleteProperty(target, segment);
    return;
  }
  pruneAt(target[segment], segments, index + 1);
}

export function hasPath(target: unknown, segments: readonly string[], index = 0): boolean {
  if (index >= segments.length) {
    return true;
  }
  if (!isObject(target)) {
    return false;
  }
  const segment = segments[index] ?? '';
  if (segment === '[]' || segment === '[-]') {
    return Array.isArray(target) && target.some((entry) => hasPath(entry, segments, index + 1));
  }
  if (segment === '*') {
    return Object.keys(target).some((key) => hasPath(target[key], segments, index + 1));
  }
  return segment in target && hasPath(target[segment], segments, index + 1);
}

function splitPaths(raw: string): string[][] {
  return raw
    .split(/\s+/)
    .map((path) => path.trim())
    .filter((path) => path !== '')
    .map((path) =>
      path
        .replace(/\[\]/g, '.[]')
        .replace(/^\./, '')
        .split('.')
        .filter((part) => part !== ''),
    );
}

export function pruneObject(target: unknown, prunePaths: string, needlePaths: string): boolean {
  const prune = splitPaths(prunePaths);
  const needles = splitPaths(needlePaths);
  if (prune.length === 0 || !isObject(target)) {
    return false;
  }
  if (needles.length > 0 && !needles.every((needle) => hasPath(target, needle))) {
    return false;
  }
  for (const path of prune) {
    pruneAt(target, path);
  }
  return true;
}

export function constantValue(raw: string): { ok: boolean; value: unknown } {
  switch (raw) {
    case 'undefined':
      return { ok: true, value: undefined };
    case 'null':
      return { ok: true, value: null };
    case 'true':
      return { ok: true, value: true };
    case 'false':
      return { ok: true, value: false };
    case '':
    case "''":
    case 'emptyStr':
      return { ok: true, value: '' };
    case 'noopFunc':
      return { ok: true, value: () => undefined };
    case 'trueFunc':
      return { ok: true, value: () => true };
    case 'falseFunc':
      return { ok: true, value: () => false };
    case 'emptyArr':
    case '[]':
      return { ok: true, value: [] };
    case 'emptyObj':
    case '{}':
      return { ok: true, value: {} };
    default: {
      if (/^-?\d+(\.\d+)?$/.test(raw)) {
        const value = Number(raw);
        return { ok: Math.abs(value) <= 32767, value };
      }
      return { ok: false, value: undefined };
    }
  }
}

function trapChain(owner: Bag, chain: readonly string[], onLeaf: (owner: Bag, prop: string) => void): void {
  const [prop, ...rest] = chain;
  if (prop === undefined) {
    return;
  }
  if (rest.length === 0) {
    onLeaf(owner, prop);
    return;
  }
  let current: unknown = owner[prop];
  if (isObject(current)) {
    trapChain(current, rest, onLeaf);
  }
  try {
    Object.defineProperty(owner, prop, {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (value: unknown) => {
        current = value;
        if (isObject(value)) {
          trapChain(value, rest, onLeaf);
        }
      },
    });
  } catch {
    return;
  }
}

export function setConstant(root: Bag, chainText: string, rawValue: string): boolean {
  const { ok, value } = constantValue(rawValue);
  const chain = chainText.split('.').filter((part) => part !== '');
  if (!ok || chain.length === 0) {
    return false;
  }
  trapChain(root, chain, (owner, prop) => {
    try {
      Object.defineProperty(owner, prop, {
        configurable: true,
        enumerable: true,
        get: () => value,
        set: () => undefined,
      });
    } catch {
      return;
    }
  });
  return true;
}

export function abortOnProperty(root: Bag, chainText: string, mode: 'read' | 'write'): boolean {
  const chain = chainText.split('.').filter((part) => part !== '');
  if (chain.length === 0) {
    return false;
  }
  const error = (): never => {
    throw new ReferenceError(`${chainText} is not available`);
  };
  trapChain(root, chain, (owner, prop) => {
    let stored: unknown = owner[prop];
    try {
      Object.defineProperty(owner, prop, {
        configurable: true,
        get: mode === 'read' ? error : () => stored,
        set:
          mode === 'write'
            ? error
            : (value: unknown) => {
                stored = value;
              },
      });
    } catch {
      return;
    }
  });
  return true;
}

export function runScriptlets(win: Window, calls: readonly ScriptletCall[]): number {
  const root = win as unknown as Bag;
  const jsonPrune: { prune: string; needle: string }[] = [];
  const fetchPrune: { prune: string; needle: string }[] = [];
  const xhrPrune: { prune: string; needle: string }[] = [];
  let applied = 0;
  for (const call of calls) {
    const [first = '', second = ''] = call.args;
    switch (call.name) {
      case 'json-prune':
        jsonPrune.push({ prune: first, needle: second });
        applied += 1;
        break;
      case 'json-prune-fetch-response':
        fetchPrune.push({ prune: first, needle: second });
        applied += 1;
        break;
      case 'json-prune-xhr-response':
        xhrPrune.push({ prune: first, needle: second });
        applied += 1;
        break;
      case 'set-constant':
        if (setConstant(root, first, second)) {
          applied += 1;
        }
        break;
      case 'abort-on-property-read':
        if (abortOnProperty(root, first, 'read')) {
          applied += 1;
        }
        break;
      case 'abort-on-property-write':
        if (abortOnProperty(root, first, 'write')) {
          applied += 1;
        }
        break;
      default:
        break;
    }
  }
  const applyAll = (value: unknown, rules: readonly { prune: string; needle: string }[]): void => {
    for (const rule of rules) {
      pruneObject(value, rule.prune, rule.needle);
    }
  };
  const winJson = (root.JSON ?? JSON) as JSON;
  if (jsonPrune.length > 0) {
    const nativeParse = winJson.parse.bind(winJson);
    winJson.parse = ((text: string, reviver?: (this: unknown, key: string, value: unknown) => unknown) => {
      const value: unknown = nativeParse(text, reviver);
      applyAll(value, jsonPrune);
      return value;
    }) as typeof JSON.parse;
  }
  const responseCtor = root.Response as { prototype: Response } | undefined;
  if (fetchPrune.length > 0 && responseCtor) {
    const nativeJson = Reflect.get(responseCtor.prototype, 'json') as (this: Response) => Promise<unknown>;
    responseCtor.prototype.json = async function json(this: Response): Promise<unknown> {
      const value: unknown = await nativeJson.call(this);
      applyAll(value, fetchPrune);
      return value;
    };
  }
  const xhrCtor = root.XMLHttpRequest as { prototype: XMLHttpRequest } | undefined;
  if (xhrPrune.length > 0 && xhrCtor) {
    const descriptor = Object.getOwnPropertyDescriptor(xhrCtor.prototype, 'responseText');
    const getter: unknown = descriptor ? Reflect.get(descriptor, 'get') : undefined;
    const nativeGetter =
      typeof getter === 'function' ? (getter as (this: XMLHttpRequest) => string) : undefined;
    if (descriptor && nativeGetter) {
      Object.defineProperty(xhrCtor.prototype, 'responseText', {
        ...descriptor,
        get(this: XMLHttpRequest): string {
          const text = nativeGetter.call(this);
          if (this.readyState !== 4 || text === '' || (text[0] !== '{' && text[0] !== '[')) {
            return text;
          }
          try {
            const value: unknown = JSON.parse(text);
            applyAll(value, xhrPrune);
            return JSON.stringify(value);
          } catch {
            return text;
          }
        },
      });
    }
  }
  return applied;
}
