import { DEFAULT_COSMETIC, DEFAULT_SCRIPTLETS } from './default-rules';
import { parseLists, type ScriptletCall } from './filters';
import { buildCosmeticCss, buildHostsBin, buildUrlRules, buildWebkitRules, type WebkitRule } from './outputs';

export interface BuildResult {
  hostsBin: Uint8Array;
  urlRules: string;
  cosmeticCss: string;
  scriptlets: ScriptletCall[];
  webkitRules: WebkitRule[];
  counts: { hosts: number; urlRules: number; cosmetic: number; scriptlets: number; webkitRules: number };
}

export function buildAll(texts: readonly string[]): BuildResult {
  const lists = parseLists(texts);
  const scriptlets = [...DEFAULT_SCRIPTLETS, ...lists.scriptlets];
  const cosmetic = [...DEFAULT_COSMETIC, ...lists.cosmetic];
  const webkitRules = buildWebkitRules(lists);
  return {
    hostsBin: buildHostsBin(lists),
    urlRules: buildUrlRules(lists),
    cosmeticCss: buildCosmeticCss(cosmetic),
    scriptlets,
    webkitRules,
    counts: {
      hosts: lists.blockedHosts.size,
      urlRules: lists.urlRules.length,
      cosmetic: new Set(cosmetic).size,
      scriptlets: scriptlets.length,
      webkitRules: webkitRules.length,
    },
  };
}
