import type { ScriptletCall } from './filters';
import { runScriptlets } from './runtime';

declare const SCRIPTLET_CALLS: ScriptletCall[];

if (/(^|\.)youtube\.com$/.test(window.location.hostname)) {
  runScriptlets(window, SCRIPTLET_CALLS);
}
