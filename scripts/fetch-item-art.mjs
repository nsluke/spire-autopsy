/**
 * Fetch STS2 relic and potion icons from slaythespire.wiki.gg into
 * public/art/relics/ and public/art/potions/, and write
 * src/data/relics.json + src/data/potions.json.
 *
 * Data comes from Module:Relics/StS2 data and Module:Potions/StS2 data —
 * the complete Lua datasets (the Cargo tables miss returning STS1 relics).
 * Icon placeholders in descriptions (@ST strength, @CE/@NE energy, @G gold)
 * are folded into words; $Keyword markers drop their sigil.
 *
 *   node scripts/fetch-item-art.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = resolve(ROOT, 'public/art/manifest.json');
const API = 'https://slaythespire.wiki.gg/api.php';
const UA = 'SpireAutopsy/0.1 (fan tool; item-art fetch; https://github.com/nsluke/spire-autopsy)';
const THUMB = 200;

const KINDS = {
  relic: {
    module: 'Module:Relics/StS2 data',
    out: resolve(ROOT, 'public/art/relics'),
    json: resolve(ROOT, 'src/data/relics.json'),
    prefix: 'RELIC.',
    artDir: 'art/relics',
  },
  potion: {
    module: 'Module:Potions/StS2 data',
    out: resolve(ROOT, 'public/art/potions'),
    json: resolve(ROOT, 'src/data/potions.json'),
    prefix: 'POTION.',
    artDir: 'art/potions',
  },
};

/** The wiki uses this filler on unreleased flavor text — not worth shipping. */
const FLAVOR_FILLER = /will be revealed in the future/i;

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

/** Fold @icon runs into words: "@ST@ST@ST" → "3 Strength", "gain @CE." → "gain 1 Energy." */
const ICON_WORD = { ST: 'Strength', CE: 'Energy', NE: 'Energy', G: 'Gold' };

function cleanText(s) {
  let out = s;
  out = out.replace(/(?:@([A-Z]+)\s*)+/g, (run, _last) => {
    const tokens = run.match(/@[A-Z]+/g) ?? [];
    const word = ICON_WORD[tokens[0].slice(1)] ?? tokens[0].slice(1);
    const n = tokens.length;
    return n > 1 ? `${n} ${word} ` : `${word === 'Gold' ? word : `1 ${word}`} `;
  });
  return out
    .replace(/\$([A-Za-z])/g, '$1')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseLuaEntries(wt) {
  const entries = [];
  const re = /\["((?:\\.|[^"\\])+)"\]\s*=\s*\{([\s\S]*?)\n\s*\},?/g;
  let m;
  while ((m = re.exec(wt))) {
    const body = m[2];
    const field = (name) => {
      const fm = body.match(new RegExp(`${name}\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"`));
      return fm ? fm[1].replace(/\\"/g, '"') : '';
    };
    entries.push({
      name: m[1].replace(/\\"/g, '"'),
      image: field('Image'),
      description: field('Description') || field('Text'),
      character: field('Character'),
      rarity: field('Rarity'),
      flavor: field('Flavor'),
    });
  }
  return entries;
}

async function thumbUrls(titles) {
  const out = new Map();
  for (let i = 0; i < titles.length; i += 40) {
    const batch = titles.slice(i, i + 40);
    const data = await wiki({
      action: 'query',
      titles: batch.join('|'),
      prop: 'imageinfo',
      iiprop: 'url',
      iiurlwidth: String(THUMB),
    });
    const normalized = data.query.normalized ?? [];
    const denorm = new Map(normalized.map((n) => [n.to, n.from]));
    for (const page of Object.values(data.query.pages)) {
      if (page.missing != null || page.invalid != null) continue;
      const info = page.imageinfo?.[0];
      const url = info?.thumburl ?? info?.url;
      if (!url) continue;
      out.set(page.title, url);
      const from = denorm.get(page.title);
      if (from) out.set(from, url);
    }
  }
  return out;
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const tmp = dest.replace(/\.webp$/, '.png');
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  execFileSync('magick', [tmp, '-strip', '-quality', '85', dest]);
  unlinkSync(tmp);
}

async function fetchAll(jobs) {
  let ok = 0;
  let fail = 0;
  const pending = [];
  const need = jobs.filter((j) => !j.exists);
  for (const job of need) {
    pending.push(
      download(job.url, job.dest)
        .then(() => {
          ok += 1;
          if (ok % 25 === 0) console.log(`downloaded ${ok}/${need.length}`);
        })
        .catch((e) => {
          fail += 1;
          console.warn(`fail ${job.id}: ${e.message}`);
        }),
    );
    if (pending.length >= 6) await Promise.all(pending.splice(0, pending.length));
  }
  await Promise.all(pending);
  return { ok, fail, need: need.length };
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

for (const [kind, cfg] of Object.entries(KINDS)) {
  mkdirSync(cfg.out, { recursive: true });
  const lua = await wiki({ action: 'parse', page: cfg.module, prop: 'wikitext' });
  const parsed = parseLuaEntries(lua.parse.wikitext['*']);
  console.log(`${kind}: parsed ${parsed.length} wiki entries`);

  // Plain names before punctuated ones, so "Anchor" claims RELIC.ANCHOR
  // ahead of the joke relic "Anchor???".
  parsed.sort((a, b) => a.name.length - b.name.length || a.name.localeCompare(b.name));

  const fileCandidates = parsed.flatMap((e) => {
    if (!e.image) return [];
    const titles = [`File:${e.image}`];
    const spaced = `File:${e.image.replace(/_/g, ' ')}`;
    if (spaced !== titles[0]) titles.push(spaced);
    return titles;
  });
  const urls = await thumbUrls([...new Set(fileCandidates)]);
  const pickUrl = (titles) => {
    for (const t of titles) if (urls.has(t)) return urls.get(t);
    return undefined;
  };

  const json = {};
  const jobs = [];
  for (const e of parsed) {
    const snake = toSnake(e.name);
    const id = `${cfg.prefix}${snake}`;
    if (json[id]) {
      console.warn(`${kind}: id collision ${id} — keeping "${json[id].name}", skipping "${e.name}"`);
      continue;
    }
    const blurb = cleanText(e.description);
    if (!blurb) {
      console.warn(`${kind}: no description for ${id}`);
      continue;
    }
    const dest = resolve(cfg.out, `${snake}.webp`);
    const url = e.image ? pickUrl([`File:${e.image}`, `File:${e.image.replace(/_/g, ' ')}`]) : undefined;
    const flavor = FLAVOR_FILLER.test(e.flavor) ? '' : cleanText(e.flavor);
    json[id] = {
      name: e.name,
      blurb,
      ...(e.rarity ? { rarity: e.rarity } : {}),
      ...(e.character ? { character: e.character } : {}),
      ...(flavor ? { flavor } : {}),
      ...(url ? { art: `${cfg.artDir}/${snake}.webp` } : {}),
    };
    if (url) jobs.push({ id, dest, url, exists: existsSync(dest) });
    else console.warn(`${kind}: no image for ${id} (${e.image || 'empty'})`);
  }

  const dl = await fetchAll(jobs);
  console.log(`${kind}: ${dl.ok} new / ${jobs.filter((j) => existsSync(j.dest)).length} on disk, ${dl.fail} failed`);

  for (const info of Object.values(json)) {
    if (info.art && !existsSync(resolve(ROOT, 'public', info.art))) delete info.art;
  }

  // Keys sorted for stable diffs.
  const ordered = Object.fromEntries(Object.keys(json).sort().map((k) => [k, json[k]]));
  writeFileSync(cfg.json, `${JSON.stringify(ordered, null, 2)}\n`);
  console.log(`${kind}: wrote ${Object.keys(ordered).length} entries to ${cfg.json.replace(`${ROOT}/`, '')}`);

  const plural = `${kind}s`;
  manifest[plural] = {};
  manifest[`${kind}Sources`] = {};
  for (const j of jobs) {
    if (!existsSync(j.dest)) continue;
    const snake = j.id.slice(cfg.prefix.length);
    manifest[plural][snake] = `${cfg.artDir}/${snake}.webp`;
    manifest[`${kind}Sources`][snake] = j.url;
  }
}

writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log('manifest updated');
