/**
 * Fetch STS2 enemy fight data from slaythespire.wiki.gg into
 * src/data/enemies.json — HP, ascension HP, and the full intent table for
 * every monster, elite, and boss.
 *
 * Source: Module:Enemies/StS2 data/* (one submodule per act, plus Elites,
 * Bosses, Events). These are Lua tables with NESTED intent tables, so entries
 * are carved by brace matching rather than a flat regex.
 *
 * Wiki markup is folded to plain text: {{BD2|Weak}} and {{KW2|Block}} become
 * the keyword, {{M|Torch Head Amalgam}} the monster name, and the ascension
 * template {{Asc|9|4|2}} ("at ascension 9 this becomes 4, game 2") becomes
 * "4 at A9+" so a reader sees both numbers.
 *
 *   node scripts/fetch-enemy-data.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'src/data/enemies.json');
const API = 'https://slaythespire.wiki.gg/api.php';
const UA = 'SpireAutopsy/0.1 (fan tool; enemy-data fetch; https://github.com/nsluke/spire-autopsy)';

const MODULES = [
  ['Module:Enemies/StS2 data/Overgrowth', 1],
  ['Module:Enemies/StS2 data/Underdocks', 2],
  ['Module:Enemies/StS2 data/Hive', 2],
  ['Module:Enemies/StS2 data/Glory', 3],
  ['Module:Enemies/StS2 data/Elites', 0],
  ['Module:Enemies/StS2 data/Bosses', 0],
  ['Module:Enemies/StS2 data/Events', 0],
];

async function wiki(params) {
  const url = new URL(API);
  url.search = new URLSearchParams({ format: 'json', ...params }).toString();
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

function toSnake(name) {
  return name
    .toUpperCase()
    .replace(/['’]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_|_$/g, '');
}

/** Fold wiki markup to plain text. Order matters: Asc before generic braces. */
function clean(s) {
  if (!s) return '';
  return (
    s
      // {{Asc|9|4|2}} — "becomes 4 at ascension 9" (trailing 2 = the game)
      .replace(/\{\{Asc\|(\d+)\|([^|}]+)(?:\|\d+)?\}\}/g, '$2 at A$1+')
      // keyword / buff-debuff / monster / game-link templates keep their label
      .replace(/\{\{(?:BD2|KW2?|R2|C2|M)\|([^}|]+)(?:\|[^}]*)?\}\}/g, '$1')
      .replace(/\{\{2\|([^}|]+)(?:\|([^}|]+))?\}\}/g, (_m, a, b) => b || a)
      .replace(/\{\{[^{}]*\}\}/g, '')
      .replace(/\[\[File:[^\]]*\]\]/gi, '')
      .replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/'{2,}/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/\s+([.,;:])/g, '$1')
      .replace(/\(\s*\)/g, '')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Body of the balanced { … } starting at `open`, plus the index after it. */
function matchBraces(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return { body: src.slice(open + 1, i), end: i + 1 };
    }
  }
  return { body: '', end: src.length };
}

function field(body, name) {
  // top level only: skip anything nested inside a deeper { … }
  const re = new RegExp(`(^|[\\s,{])${name}\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"`);
  const m = body.match(re);
  return m ? m[2].replace(/\\"/g, '"') : '';
}

function parseIntents(body) {
  const at = body.indexOf('Intents');
  if (at === -1) return [];
  const open = body.indexOf('{', at);
  if (open === -1) return [];
  const { body: list } = matchBraces(body, open);
  const intents = [];
  let i = 0;
  while (i < list.length) {
    const start = list.indexOf('{', i);
    if (start === -1) break;
    const { body: one, end } = matchBraces(list, start);
    const name = clean(field(one, 'Name'));
    const text = clean(field(one, 'Text'));
    if (name || text) intents.push({ name, text });
    i = end;
  }
  return intents;
}

/** Top-level ["Name"] = { … } entries of a Lua data module. */
function parseModule(wt) {
  const out = [];
  const re = /\["((?:\\.|[^"\\])+)"\]\s*=\s*\{/g;
  let m;
  while ((m = re.exec(wt))) {
    const open = wt.indexOf('{', m.index + m[0].length - 1);
    const { body, end } = matchBraces(wt, open);
    // Only top-level entries: anything starting before the previous entry
    // ended is a nested table (an intent, a party list) and is skipped.
    if (out.length && m.index < out[out.length - 1].end) continue;
    out.push({ name: m[1].replace(/\\"/g, '"'), body, end });
    re.lastIndex = end;
  }
  return out;
}

const enemies = {};
let intentCount = 0;

for (const [module, act] of MODULES) {
  const data = await wiki({ action: 'parse', page: module, prop: 'wikitext' });
  const wt = data.parse.wikitext['*'];
  const entries = parseModule(wt);
  console.log(`${module}: ${entries.length} entries`);
  for (const e of entries) {
    const id = toSnake(e.name);
    const type = field(e.body, 'Type');
    const baseHp = field(e.body, 'BaseHP');
    const ascHp = field(e.body, 'AscHP');
    const intents = parseIntents(e.body);
    const startsWith = clean(field(e.body, 'StartsWith'));
    const party = clean(field(e.body, 'InPartyWith')).replace(/^Overgrowth|^Underdocks|^Hive|^Glory/, '').trim();
    if (!type && !baseHp && intents.length === 0) continue;
    if (enemies[id]) {
      console.warn(`duplicate ${id} — keeping the first`);
      continue;
    }
    intentCount += intents.length;
    enemies[id] = {
      name: e.name,
      ...(type ? { type } : {}),
      ...(baseHp ? { hp: baseHp } : {}),
      ...(ascHp && ascHp !== baseHp ? { ascHp } : {}),
      ...(act ? { act } : {}),
      ...(startsWith ? { startsWith } : {}),
      ...(party ? { party } : {}),
      ...(intents.length ? { intents } : {}),
    };
  }
}

const ordered = Object.fromEntries(Object.keys(enemies).sort().map((k) => [k, enemies[k]]));
writeFileSync(OUT, `${JSON.stringify(ordered, null, 2)}\n`);
console.log(`wrote ${Object.keys(ordered).length} enemies (${intentCount} intents) to src/data/enemies.json`);
