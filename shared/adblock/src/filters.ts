export interface ScriptletCall {
  name: string;
  args: string[];
}

export interface ParsedLists {
  blockedHosts: Set<string>;
  allowedHosts: Set<string>;
  urlRules: { host: string; path: string }[];
  cosmetic: Set<string>;
  scriptlets: ScriptletCall[];
}

export const TARGET_DOMAINS = ['youtube.com', 'music.youtube.com', 'www.youtube.com', 'm.youtube.com'];

export const NEVER_BLOCK = [
  'youtube.com',
  'music.youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtubei.googleapis.com',
  'googlevideo.com',
  'ytimg.com',
  'i.ytimg.com',
  'ggpht.com',
  'yt3.ggpht.com',
  'googleusercontent.com',
  'lh3.googleusercontent.com',
  'accounts.google.com',
  'accounts.youtube.com',
  'google.com',
  'www.google.com',
  'gstatic.com',
  'www.gstatic.com',
  'fonts.gstatic.com',
  'consent.youtube.com',
  'consent.google.com',
  'play.google.com',
  'apis.google.com',
];

export const SUPPORTED_SCRIPTLETS: Readonly<Record<string, string>> = {
  'json-prune': 'json-prune',
  'json-prune.js': 'json-prune',
  'json-prune-fetch-response': 'json-prune-fetch-response',
  'json-prune-fetch-response.js': 'json-prune-fetch-response',
  'json-prune-xhr-response': 'json-prune-xhr-response',
  'json-prune-xhr-response.js': 'json-prune-xhr-response',
  'set-constant': 'set-constant',
  'set-constant.js': 'set-constant',
  set: 'set-constant',
  'abort-on-property-read': 'abort-on-property-read',
  'abort-on-property-read.js': 'abort-on-property-read',
  aopr: 'abort-on-property-read',
  'abort-on-property-write': 'abort-on-property-write',
  'abort-on-property-write.js': 'abort-on-property-write',
  aopw: 'abort-on-property-write',
};

const ALLOWED_NETWORK_OPTIONS = new Set([
  'third-party',
  '3p',
  'script',
  'image',
  'xmlhttprequest',
  'xhr',
  'subdocument',
  'frame',
  'important',
  'all',
  'ping',
  'media',
  'object',
  'other',
  'stylesheet',
  'css',
  'font',
  'websocket',
]);

const HOST_PATTERN = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

export function isValidHost(host: string): boolean {
  return host.length <= 253 && HOST_PATTERN.test(host);
}

export function isProtectedHost(host: string): boolean {
  return NEVER_BLOCK.some((protectedHost) => host === protectedHost);
}

function optionsAllowed(options: string): boolean {
  if (options === '') {
    return true;
  }
  return options.split(',').every((option) => {
    const name = option.trim().replace(/^~/, '');
    if (
      name.startsWith('domain=') ||
      name.startsWith('from=') ||
      name.startsWith('denyallow=') ||
      name.startsWith('redirect')
    ) {
      return false;
    }
    return ALLOWED_NETWORK_OPTIONS.has(name);
  });
}

export function splitScriptletArgs(body: string): string[] {
  const args: string[] = [];
  let current = '';
  let escaped = false;
  for (const char of body) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (char === ',') {
      args.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  args.push(current.trim());
  return args.map((arg) => arg.replace(/^(['"])(.*)\1$/, '$2'));
}

function domainsApply(domainList: string): boolean {
  if (domainList === '') {
    return false;
  }
  const domains = domainList.split(',').map((domain) => domain.trim().toLowerCase());
  const positives = domains.filter((domain) => !domain.startsWith('~'));
  return positives.some((domain) => TARGET_DOMAINS.includes(domain) || domain === 'youtube.*');
}

export function parseFilterLine(rawLine: string, lists: ParsedLists): void {
  const line = rawLine.trim();
  if (line === '' || line.startsWith('!') || line.startsWith('[')) {
    return;
  }
  const scriptletMatch = /^([^#]*)##\+js\((.*)\)$/.exec(line);
  if (scriptletMatch) {
    const domains = scriptletMatch[1] ?? '';
    if (!domainsApply(domains)) {
      return;
    }
    const args = splitScriptletArgs(scriptletMatch[2] ?? '');
    const name = SUPPORTED_SCRIPTLETS[args[0] ?? ''];
    if (!name) {
      return;
    }
    lists.scriptlets.push({ name, args: args.slice(1) });
    return;
  }
  const cosmeticMatch = /^([^#]*)##([^+].*)$/.exec(line);
  if (cosmeticMatch) {
    const domains = cosmeticMatch[1] ?? '';
    const selector = (cosmeticMatch[2] ?? '').trim();
    if (
      !domainsApply(domains) ||
      selector === '' ||
      selector.includes(':style(') ||
      selector.includes(':remove(') ||
      selector.includes(':has-text(') ||
      selector.includes(':matches-') ||
      selector.includes(':upward(') ||
      selector.includes(':xpath(') ||
      selector.includes(':-abp-') ||
      selector.startsWith('^')
    ) {
      return;
    }
    lists.cosmetic.add(selector);
    return;
  }
  if (line.includes('#@#') || line.includes('#?#') || line.includes('#$#') || line.includes('##')) {
    return;
  }
  const isException = line.startsWith('@@');
  const rule = isException ? line.slice(2) : line;
  if (!rule.startsWith('||')) {
    return;
  }
  const dollar = rule.indexOf('$');
  const pattern = dollar >= 0 ? rule.slice(2, dollar) : rule.slice(2);
  const options = dollar >= 0 ? rule.slice(dollar + 1) : '';
  if (!optionsAllowed(options)) {
    return;
  }
  const hostEnd = pattern.search(/[\^/*|:]/);
  const host = (hostEnd >= 0 ? pattern.slice(0, hostEnd) : pattern).toLowerCase();
  const rest = hostEnd >= 0 ? pattern.slice(hostEnd) : '';
  if (!isValidHost(host)) {
    return;
  }
  if (rest === '^' || rest === '' || rest === '^|') {
    if (isException) {
      lists.allowedHosts.add(host);
    } else if (!isProtectedHost(host)) {
      lists.blockedHosts.add(host);
    }
    return;
  }
  if (
    !isException &&
    rest.startsWith('/') &&
    !rest.includes('*') &&
    TARGET_DOMAINS.some((domain) => host === domain || host.endsWith(`.${domain}`))
  ) {
    const path = rest.replace(/\^$/, '');
    if (path.length > 1 && path.length < 200) {
      lists.urlRules.push({ host, path });
    }
  }
}

export function parseLists(texts: readonly string[]): ParsedLists {
  const lists: ParsedLists = {
    blockedHosts: new Set(),
    allowedHosts: new Set(),
    urlRules: [],
    cosmetic: new Set(),
    scriptlets: [],
  };
  for (const text of texts) {
    for (const line of text.split(/\r?\n/)) {
      parseFilterLine(line, lists);
    }
  }
  for (const host of lists.allowedHosts) {
    lists.blockedHosts.delete(host);
  }
  const seen = new Set<string>();
  lists.scriptlets = lists.scriptlets.filter((call) => {
    const key = JSON.stringify(call);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
  const uniqueRules = new Map(lists.urlRules.map((rule) => [`${rule.host}${rule.path}`, rule]));
  lists.urlRules = [...uniqueRules.values()];
  return lists;
}
