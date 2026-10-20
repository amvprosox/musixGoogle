import type { ParsedLists } from './filters';
import { encodeHosts } from './hosts';

export const WEBKIT_RULE_LIMIT = 150000;

export function hostToUrlFilter(host: string): string {
  return `^[^:]+://+([a-z0-9.-]+\\.)?${host.replace(/[.]/g, '\\.')}[/:]`;
}

export function pathToUrlFilter(host: string, path: string): string {
  const escapedPath = path.replace(/[.?+()[\]\\$^{}|]/g, (char) => `\\${char}`);
  return `^[^:]+://+([a-z0-9.-]+\\.)?${host.replace(/[.]/g, '\\.')}${escapedPath}`;
}

export interface WebkitRule {
  trigger: { 'url-filter': string; 'load-type'?: string[] };
  action: { type: 'block' };
}

export function buildWebkitRules(lists: ParsedLists): WebkitRule[] {
  const rules: WebkitRule[] = [];
  for (const rule of lists.urlRules) {
    rules.push({
      trigger: { 'url-filter': pathToUrlFilter(rule.host, rule.path) },
      action: { type: 'block' },
    });
  }
  const hosts = [...lists.blockedHosts].sort();
  for (const host of hosts) {
    if (rules.length >= WEBKIT_RULE_LIMIT) {
      break;
    }
    rules.push({ trigger: { 'url-filter': hostToUrlFilter(host) }, action: { type: 'block' } });
  }
  return rules;
}

export function buildCosmeticCss(selectors: Iterable<string>): string {
  const unique = [...new Set(selectors)].filter(
    (selector) => !selector.includes('{') && !selector.includes('}'),
  );
  const chunks: string[] = [];
  for (let i = 0; i < unique.length; i += 200) {
    chunks.push(`${unique.slice(i, i + 200).join(',\n')} {\n  display: none !important;\n}`);
  }
  return `${chunks.join('\n\n')}\n`;
}

export function buildUrlRules(lists: ParsedLists): string {
  return `${lists.urlRules.map((rule) => `${rule.host}\t${rule.path}`).join('\n')}\n`;
}

export function buildHostsBin(lists: ParsedLists): Uint8Array {
  return encodeHosts(lists.blockedHosts);
}
