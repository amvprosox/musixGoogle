import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  isProtectedHost,
  NEVER_BLOCK,
  parseFilterLine,
  parseLists,
  splitScriptletArgs,
  type ParsedLists,
} from '../src/filters';
import { encodeHosts, fnv1a64, HostSet } from '../src/hosts';
import { buildCosmeticCss, buildWebkitRules, hostToUrlFilter, pathToUrlFilter } from '../src/outputs';
import { buildAll } from '../src/pipeline';
import { abortOnProperty, constantValue, pruneObject, runScriptlets, setConstant } from '../src/runtime';

function empty(): ParsedLists {
  return {
    blockedHosts: new Set(),
    allowedHosts: new Set(),
    urlRules: [],
    cosmetic: new Set(),
    scriptlets: [],
  };
}

const SAMPLE = `
! comment
[Adblock Plus 2.0]
||doubleclick.net^
||ads.example.com^$third-party
||tracker.example.org^$script,image
||scoped.example.net^$domain=foo.com
||redirected.example.net^$redirect=noopjs
@@||allowed.example.com^
||allowed.example.com^
||youtube.com/pagead/
||youtube.com^
||googlevideo.com^
/banner-ads/*
youtube.com##ytd-ad-slot-renderer
music.youtube.com##.ytmusic-promo
example.com##.not-for-us
youtube.com##.thing:has-text(Ad)
youtube.com##+js(json-prune, playerResponse.adPlacements adPlacements)
youtube.com##+js(set, ytInitialPlayerResponse.playerAds, undefined)
youtube.com##+js(trusted-replace-xhr-response, a, b)
example.com##+js(json-prune, x)
`;

describe('filter list parsing', () => {
  const lists = parseLists([SAMPLE]);

  it('collects host-level network rules with allowed options', () => {
    expect([...lists.blockedHosts].sort()).toEqual([
      'ads.example.com',
      'doubleclick.net',
      'tracker.example.org',
    ]);
  });

  it('honours exceptions and never blocks YouTube infrastructure', () => {
    expect(lists.blockedHosts.has('allowed.example.com')).toBe(false);
    expect(lists.blockedHosts.has('youtube.com')).toBe(false);
    expect(lists.blockedHosts.has('googlevideo.com')).toBe(false);
    expect(NEVER_BLOCK.every((host) => isProtectedHost(host))).toBe(true);
  });

  it('keeps YouTube path rules', () => {
    expect(lists.urlRules).toEqual([{ host: 'youtube.com', path: '/pagead/' }]);
  });

  it('keeps cosmetic rules for YouTube only and skips procedural selectors', () => {
    expect([...lists.cosmetic].sort()).toEqual(['.ytmusic-promo', 'ytd-ad-slot-renderer']);
  });

  it('keeps supported YouTube scriptlets only', () => {
    expect(lists.scriptlets).toEqual([
      { name: 'json-prune', args: ['playerResponse.adPlacements adPlacements'] },
      { name: 'set-constant', args: ['ytInitialPlayerResponse.playerAds', 'undefined'] },
    ]);
  });

  it('splits scriptlet arguments with escapes and quotes', () => {
    expect(splitScriptletArgs('a, b\\, c, "d e"')).toEqual(['a', 'b, c', 'd e']);
  });

  it('ignores invalid lines', () => {
    const lists2 = empty();
    for (const line of ['||not a host^', '||-bad-.com^', '||x^', '@@', '||', '##']) {
      parseFilterLine(line, lists2);
    }
    expect(lists2.blockedHosts.size).toBe(0);
  });
});

describe('hosts.bin', () => {
  it('uses FNV-1a 64 with the reference vectors', () => {
    expect(fnv1a64('').toString(16)).toBe('cbf29ce484222325');
    expect(fnv1a64('a').toString(16)).toBe('af63dc4c8601ec8c');
    expect(fnv1a64('foobar').toString(16)).toBe('85944171f73967e8');
    expect(fnv1a64('DoubleClick.NET')).toBe(fnv1a64('doubleclick.net'));
  });

  it('round-trips and matches parent domains', () => {
    const set = new HostSet(encodeHosts(['doubleclick.net', 'ads.example.com']));
    expect(set.size).toBe(2);
    expect(set.matches('doubleclick.net')).toBe(true);
    expect(set.matches('stats.g.doubleclick.net')).toBe(true);
    expect(set.matches('example.com')).toBe(false);
    expect(set.matches('x.ads.example.com')).toBe(true);
    expect(set.matches('music.youtube.com')).toBe(false);
  });

  it('rejects corrupt files', () => {
    expect(() => new HostSet(new Uint8Array([1, 2, 3]))).toThrow();
    const bytes = encodeHosts(['a.com']);
    expect(() => new HostSet(bytes.slice(0, bytes.length - 1))).toThrow();
  });
});

describe('WebKit content rules', () => {
  it('produces regexes WebKit accepts', () => {
    const rules = buildWebkitRules(parseLists([SAMPLE]));
    expect(rules.length).toBe(4);
    for (const rule of rules) {
      const filter = rule.trigger['url-filter'];
      expect(filter.includes('|')).toBe(false);
      expect(filter.includes('{')).toBe(false);
      expect(() => new RegExp(filter)).not.toThrow();
      expect(rule.action.type).toBe('block');
    }
  });

  it('matches the intended URLs', () => {
    const host = new RegExp(hostToUrlFilter('doubleclick.net'));
    expect(host.test('https://doubleclick.net/x')).toBe(true);
    expect(host.test('https://stats.g.doubleclick.net/x')).toBe(true);
    expect(host.test('https://notdoubleclick.net/x')).toBe(false);
    expect(host.test('https://doubleclick.network/x')).toBe(false);
    const pathRule = new RegExp(pathToUrlFilter('youtube.com', '/pagead/'));
    expect(pathRule.test('https://www.youtube.com/pagead/conversion')).toBe(true);
    expect(pathRule.test('https://music.youtube.com/watch?v=1')).toBe(false);
  });
});

describe('cosmetic CSS', () => {
  it('hides each selector and drops unsafe ones', () => {
    const css = buildCosmeticCss(['a', '.b', 'c{}', 'a']);
    expect(css).toContain('a,\n.b {\n  display: none !important;\n}');
    expect(css).not.toContain('c{}');
  });
});

describe('scriptlet runtime', () => {
  it('prunes nested ad payloads only when needles match', () => {
    const data = {
      playerResponse: { adPlacements: [1], streamingData: {} },
      list: [{ playerResponse: { adSlots: [2] } }],
    };
    expect(pruneObject(data, 'playerResponse.adPlacements [].playerResponse.adSlots', '')).toBe(true);
    expect(data.playerResponse).toEqual({ streamingData: {} });
    const arrayData = [{ playerResponse: { adSlots: [2], keep: 1 } }];
    pruneObject(arrayData, '[].playerResponse.adSlots', '');
    expect(arrayData[0]?.playerResponse).toEqual({ keep: 1 });
    const guarded = { adPlacements: [1] };
    expect(pruneObject(guarded, 'adPlacements', 'missing.key')).toBe(false);
    expect(guarded.adPlacements).toEqual([1]);
  });

  it('patches JSON.parse, fetch responses, and XHR text', async () => {
    const fakeWindow = {
      JSON: { parse: JSON.parse, stringify: JSON.stringify },
      Response: class extends Response {},
    } as unknown as Window & { JSON: JSON; Response: typeof Response };
    const applied = runScriptlets(fakeWindow, [
      { name: 'json-prune', args: ['adPlacements playerAds', ''] },
      { name: 'json-prune-fetch-response', args: ['adSlots', ''] },
    ]);
    expect(applied).toBe(2);
    expect(fakeWindow.JSON.parse('{"adPlacements":[1],"playerAds":[2],"keep":true}')).toEqual({ keep: true });
    const response = new fakeWindow.Response('{"adSlots":[1],"keep":1}');
    expect(await response.json()).toEqual({ keep: 1 });
  });

  it('defines constants along chains, including future objects', () => {
    const root: Record<string, unknown> = {};
    expect(setConstant(root, 'ytInitialPlayerResponse.playerAds', 'undefined')).toBe(true);
    root.ytInitialPlayerResponse = { playerAds: [1], other: 2 };
    const response = root.ytInitialPlayerResponse as Record<string, unknown>;
    expect(response.playerAds).toBeUndefined();
    expect(response.other).toBe(2);
    expect(setConstant(root, 'flag', 'true')).toBe(true);
    root.flag = false;
    expect(root.flag).toBe(true);
    expect(setConstant(root, 'x', 'someString')).toBe(false);
    expect(constantValue('42')).toEqual({ ok: true, value: 42 });
    expect(constantValue('99999').ok).toBe(false);
  });

  it('aborts on property access', () => {
    const root: Record<string, unknown> = {};
    abortOnProperty(root, 'adsbygoogle', 'read');
    expect(() => root.adsbygoogle).toThrow(ReferenceError);
    abortOnProperty(root, 'trackerInit', 'write');
    expect(() => {
      root.trackerInit = 1;
    }).toThrow(ReferenceError);
  });
});

describe('build pipeline', () => {
  it('builds every output from list text', () => {
    const result = buildAll([SAMPLE]);
    expect(result.counts.hosts).toBe(3);
    expect(new HostSet(result.hostsBin).matches('doubleclick.net')).toBe(true);
    expect(result.cosmeticCss).toContain('ytmusic-mealbar-promo-renderer');
    expect(result.scriptlets.some((call) => call.args[0]?.includes('adPlacements'))).toBe(true);
    expect(result.webkitRules.length).toBe(4);
  });

  const dist = path.resolve(import.meta.dirname, '..', 'dist');
  it.runIf(existsSync(path.join(dist, 'hosts.bin')))('produces usable artifacts from the real lists', () => {
    const set = new HostSet(new Uint8Array(readFileSync(path.join(dist, 'hosts.bin'))));
    expect(set.size).toBeGreaterThan(10000);
    expect(set.matches('googleads.g.doubleclick.net')).toBe(true);
    expect(set.matches('pagead2.googlesyndication.com')).toBe(true);
    expect(set.matches('www.google-analytics.com')).toBe(true);
    for (const host of NEVER_BLOCK) {
      expect(set.matches(host), host).toBe(false);
    }
    const rules = JSON.parse(readFileSync(path.join(dist, 'content-rules.json'), 'utf8')) as unknown[];
    expect(rules.length).toBeGreaterThan(10000);
    expect(rules.length).toBeLessThanOrEqual(150000);
    const manifest = JSON.parse(readFileSync(path.join(dist, 'manifest.json'), 'utf8')) as {
      version: number;
    };
    expect(manifest.version).toBe(1);
  });
});

describe('exception scope', () => {
  it('ignores site-scoped exceptions when building the global host set', () => {
    const lists = parseLists([
      '||doubleclick.net^',
      '@@||doubleclick.net^$domain=example.com',
      '@@||ads.example.com^$document',
      '||ads.example.com^',
    ]);
    expect(lists.blockedHosts.has('doubleclick.net')).toBe(true);
    expect(lists.blockedHosts.has('ads.example.com')).toBe(true);
  });
});
