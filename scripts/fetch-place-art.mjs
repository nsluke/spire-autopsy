/**
 * Fetch STS2 map icons and event illustrations from slaythespire.wiki.gg
 * into public/art/map/ and public/art/events/, and write src/data/events.json.
 *
 * Event copy comes from Module:Events/StS2 data (Description, else Flavor).
 * Ancients (Neow, Pael, Orobas, Tanx, Nonupeipe) are not in that module.
 *
 *   node scripts/fetch-place-art.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MAP_OUT = resolve(ROOT, 'public/art/map');
const EVENT_OUT = resolve(ROOT, 'public/art/events');
const EVENTS_JSON = resolve(ROOT, 'src/data/events.json');
const MANIFEST = resolve(ROOT, 'public/art/manifest.json');
const API = 'https://slaythespire.wiki.gg/api.php';
const UA = 'SpireAutopsy/0.1 (fan tool; place-art fetch; https://github.com/nsluke/spire-autopsy)';
const THUMB = 220;

const MAP_FILES = {
  MONSTER: 'File:StS2 Map-Monster.png',
  ELITE: 'File:StS2 Map-Elite.png',
  BOSS: 'File:StS2 Map-Boss.png',
  EVENT: 'File:StS2 Map-Event.png',
  REST: 'File:StS2 Map-RestSite.png',
  SHOP: 'File:StS2 Map-Merchant.png',
  TREASURE: 'File:StS2 Map-Treasure.png',
};

const ANCIENTS = [
  {
    id: 'EVENT.NEOW',
    name: 'Neow',
    blurb:
      'Neow’s gift at the start of a run. Pick one of three boons — relics, transforms, max HP, or a curse trade. Ancients also heal missing HP.',
    file: 'File:StS2 Map-Neow.png',
  },
  {
    id: 'EVENT.PAEL',
    name: 'Pael',
    blurb: 'Pael, an Act 2 Ancient. Offers three relics (one from each pool) and typically strips starter cards from your deck.',
    file: 'File:StS2 Map-Pael.png',
  },
  {
    id: 'EVENT.OROBAS',
    name: 'Orobas',
    blurb: 'Orobas, an Act 2 Ancient. Offers one relic from each of his pools.',
    file: 'File:StS2 Map-Orobas.png',
  },
  {
    id: 'EVENT.TANX',
    name: 'Tanx',
    blurb: 'Tanx, an Act 3 Ancient. Offers a random selection of three relics.',
    file: 'File:StS2 Map-Tanx.png',
  },
  {
    id: 'EVENT.NONUPEIPE',
    name: 'Nonupeipe',
    blurb: 'Nonupeipe, an Act 3 Ancient. Offers a random selection of three relics.',
    file: 'File:StS2 Map-Nonupeipe.png',
  },
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

function cleanWiki(s) {
  return s
    .replace(/\{\{R2\|([^}|]+).*?\}\}/g, '$1')
    .replace(/\{\{C2\|([^}|]+).*?\}\}/g, '$1')
    .replace(/\{\{KW2?\|([^}|]+).*?\}\}/g, '$1')
    .replace(/\{\{[^}]+\}\}/g, '')
    .replace(/'+/g, '')
    .replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, '$1')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clip(s, n = 220) {
  if (s.length <= n) return s;
  return `${s.slice(0, n).replace(/\s+\S*$/, '')}…`;
}

function blurbOf(description, flavor) {
  const d = cleanWiki(description);
  if (d) return clip(d);
  const f = cleanWiki(flavor);
  if (!f) return 'An unknown event on the map.';
  const first = f.split(/(?<=\.)\s/)[0] ?? f;
  return clip(first);
}

function parseLuaEvents(wt) {
  const events = [];
  const re = /\["([^"]+)"\]\s*=\s*\{([\s\S]*?)\n\t\},/g;
  let m;
  while ((m = re.exec(wt))) {
    const body = m[2];
    const field = (name) => {
      const fm = body.match(new RegExp(`${name}\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"`));
      return fm ? fm[1].replace(/\\"/g, '"') : '';
    };
    events.push({
      wikiName: m[1],
      name: field('Name') || m[1],
      description: field('Description'),
      flavor: field('Flavor'),
      image: field('Image'),
    });
  }
  return events;
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
      if (page.missing != null || page.invalid != null) continue;
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
          if (ok % 20 === 0) console.log(`downloaded ${ok}/${need.length}`);
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

mkdirSync(MAP_OUT, { recursive: true });
mkdirSync(EVENT_OUT, { recursive: true });

const lua = await wiki({ action: 'parse', page: 'Module:Events/StS2 data', prop: 'wikitext' });
const parsed = parseLuaEvents(lua.parse.wikitext['*']);
console.log(`parsed ${parsed.length} wiki events`);

const eventFileCandidates = parsed.flatMap((e) => {
  if (!e.image) return [];
  const titles = [`File:${e.image}`];
  const spaced = `File:${e.image.replace(/_/g, ' ')}`;
  if (spaced !== titles[0]) titles.push(spaced);
  return titles;
});
const ancientFiles = ANCIENTS.map((a) => a.file);
const mapFiles = Object.values(MAP_FILES);
const urls = await thumbUrls([...new Set([...eventFileCandidates, ...ancientFiles, ...mapFiles])]);

function pickUrl(titles) {
  for (const t of titles) {
    if (urls.has(t)) return { title: t, url: urls.get(t) };
  }
  return undefined;
}

const eventsJson = {};
const eventJobs = [];

for (const e of parsed) {
  const snake = toSnake(e.name);
  const id = `EVENT.${snake}`;
  const dest = resolve(EVENT_OUT, `${snake}.webp`);
  const hit = e.image ? pickUrl([`File:${e.image}`, `File:${e.image.replace(/_/g, ' ')}`]) : undefined;
  eventsJson[id] = {
    name: e.name,
    blurb: blurbOf(e.description, e.flavor),
    ...(hit ? { art: `art/events/${snake}.webp` } : {}),
  };
  if (hit) {
    eventJobs.push({ id, dest, url: hit.url, title: hit.title, exists: existsSync(dest) });
  } else {
    console.warn(`no image for ${id} (${e.image || 'empty'})`);
  }
}

for (const a of ANCIENTS) {
  const snake = a.id.slice('EVENT.'.length);
  const dest = resolve(EVENT_OUT, `${snake}.webp`);
  const hit = pickUrl([a.file]);
  eventsJson[a.id] = {
    name: a.name,
    blurb: a.blurb,
    ...(hit ? { art: `art/events/${snake}.webp` } : {}),
  };
  if (hit) eventJobs.push({ id: a.id, dest, url: hit.url, title: hit.title, exists: existsSync(dest) });
  else console.warn(`no image for ${a.id}`);
}

const mapJobs = [];
for (const [kind, file] of Object.entries(MAP_FILES)) {
  const dest = resolve(MAP_OUT, `${kind}.webp`);
  const hit = pickUrl([file]);
  if (!hit) {
    console.warn(`no map icon ${kind}`);
    continue;
  }
  mapJobs.push({ id: `MAP.${kind}`, dest, url: hit.url, title: hit.title, exists: existsSync(dest) });
}

const eventDl = await fetchAll(eventJobs);
const mapDl = await fetchAll(mapJobs);
console.log(`events: ${eventDl.ok} new / ${eventJobs.filter((j) => existsSync(j.dest)).length} on disk, ${eventDl.fail} failed`);
console.log(`map:    ${mapDl.ok} new / ${mapJobs.filter((j) => existsSync(j.dest)).length} on disk, ${mapDl.fail} failed`);

for (const [id, info] of Object.entries(eventsJson)) {
  if (!info.art) continue;
  const dest = resolve(ROOT, 'public', info.art);
  if (!existsSync(dest)) delete info.art;
}

writeFileSync(EVENTS_JSON, `${JSON.stringify(eventsJson, null, 2)}\n`);
console.log(`wrote ${Object.keys(eventsJson).length} events to src/data/events.json`);

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
manifest.map = {};
manifest.mapSources = {};
for (const j of mapJobs) {
  if (!existsSync(j.dest)) continue;
  const kind = j.id.slice('MAP.'.length);
  manifest.map[kind] = `art/map/${kind}.webp`;
  manifest.mapSources[kind] = j.url;
}
manifest.events = {};
manifest.eventSources = {};
for (const j of eventJobs) {
  if (!existsSync(j.dest)) continue;
  const snake = j.id.slice('EVENT.'.length);
  manifest.events[snake] = `art/events/${snake}.webp`;
  manifest.eventSources[snake] = j.url;
}
writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
