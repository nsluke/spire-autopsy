/**
 * Fetch STS2 card portraits from slaythespire.wiki.gg into public/art/cards/.
 *
 * Wiki files are `StS2 {Character}-{Name}.png` (unupgraded only). We match on
 * character + alphanumeric name, download a 220px thumb so the hover preview
 * stays small, convert to WebP, and name the local file after the CARD.* id suffix.
 *
 *   node scripts/fetch-card-art.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'public/art/cards');
const MANIFEST = resolve(ROOT, 'public/art/manifest.json');
const CARDS = JSON.parse(readFileSync(resolve(ROOT, 'src/data/cards.json'), 'utf8'));
const API = 'https://slaythespire.wiki.gg/api.php';
const UA = 'SpireAutopsy/0.1 (fan tool; card-art fetch; https://github.com/nsluke/spire-autopsy)';
const THUMB = 220;

function nameKey(s) {
  return s.replace(/[^a-z0-9]/gi, '').toLowerCase();
}

async function wiki(params) {
  const url = new URL(API);
  url.search = new URLSearchParams({ format: 'json', ...params }).toString();
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return res.json();
}

async function listCardFiles() {
  const files = [];
  let cmcontinue;
  do {
    const data = await wiki({
      action: 'query',
      list: 'categorymembers',
      cmtitle: 'Category:StS2_Card_Images',
      cmtype: 'file',
      cmlimit: '500',
      ...(cmcontinue ? { cmcontinue } : {}),
    });
    for (const m of data.query.categorymembers) files.push(m.title);
    cmcontinue = data.continue?.cmcontinue;
  } while (cmcontinue);
  return files;
}

function parseWikiTitle(title) {
  // "File:StS2 Silent-Backflip.png"
  const raw = title.replace(/^File:/, '');
  if (!raw.startsWith('StS2 ') || raw.startsWith('StS2 Beta-')) return null;
  if (!raw.endsWith('.png') || raw.endsWith('Plus.png')) return null;
  const rest = raw.slice('StS2 '.length, -'.png'.length);
  const dash = rest.indexOf('-');
  if (dash < 0) return null;
  return { title, character: rest.slice(0, dash).toUpperCase(), key: nameKey(rest.slice(dash + 1)) };
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
    for (const page of Object.values(data.query.pages)) {
      const info = page.imageinfo?.[0];
      if (info?.thumburl) out.set(page.title, info.thumburl);
      else if (info?.url) out.set(page.title, info.url);
    }
  }
  return out;
}

async function download(url, dest) {
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const tmp = dest.replace(/\.webp$/, '.png');
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()));
  execFileSync('magick', [tmp, '-strip', '-quality', '80', dest]);
  unlinkSync(tmp);
}

mkdirSync(OUT, { recursive: true });

const parsed = (await listCardFiles()).map(parseWikiTitle).filter(Boolean);
const byKey = new Map();
for (const f of parsed) {
  const k = `${f.character}|${f.key}`;
  if (!byKey.has(k)) byKey.set(k, f);
}

const wanted = [];
const missing = [];
for (const [id, info] of Object.entries(CARDS)) {
  const suffix = id.slice('CARD.'.length);
  const dest = resolve(OUT, `${suffix}.webp`);
  const hit =
    byKey.get(`${info.character}|${nameKey(info.name)}`) ??
    byKey.get(`${info.character}|${nameKey(suffix)}`) ??
    (info.character === 'COLORLESS' || info.type === 'curse' || info.type === 'quest'
      ? ['CURSE', 'QUEST', 'TOKEN', 'EVENT', 'STATUS', 'COLORLESS']
          .map((ch) => byKey.get(`${ch}|${nameKey(info.name)}`) ?? byKey.get(`${ch}|${nameKey(suffix)}`))
          .find(Boolean)
      : undefined);
  if (!hit) {
    missing.push(id);
    continue;
  }
  wanted.push({ id, suffix, dest, title: hit.title, exists: existsSync(dest) });
}

console.log(`matched ${wanted.length}/${Object.keys(CARDS).length} cards; ${missing.length} unmatched`);
if (missing.length) console.log(`unmatched: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? '…' : ''}`);

const need = wanted.filter((w) => !w.exists);
const urls = await thumbUrls([...new Set(need.map((w) => w.title))]);

let ok = 0;
let fail = 0;
const pending = [];
for (const w of need) {
  const url = urls.get(w.title);
  if (!url) {
    fail += 1;
    continue;
  }
  pending.push(
    download(url, w.dest)
      .then(() => {
        ok += 1;
        if (ok % 40 === 0) console.log(`downloaded ${ok}/${need.length}`);
      })
      .catch((e) => {
        fail += 1;
        console.warn(`fail ${w.id}: ${e.message}`);
      }),
  );
  if (pending.length >= 6) {
    await Promise.all(pending.splice(0, pending.length));
  }
}
await Promise.all(pending);

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
manifest.cards = manifest.cards ?? {};
manifest.cardSources = manifest.cardSources ?? {};
for (const w of wanted) {
  if (!existsSync(w.dest)) continue;
  manifest.cards[w.suffix] = `art/cards/${w.suffix}.webp`;
  const src = urls.get(w.title);
  if (src) manifest.cardSources[w.suffix] = src;
}
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote ${ok} new files (${wanted.filter((w) => existsSync(w.dest)).length} on disk), ${fail} failed`);
