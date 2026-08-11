// Trivial post-build smoke check: run `npm run build` first, then `node scripts/smoke.mjs`.
// Verifies dist/ exists and dist/index.html references the built JS and CSS bundles.
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const indexPath = resolve(dist, 'index.html');

function fail(msg) {
  console.error(`SMOKE FAIL: ${msg}`);
  process.exit(1);
}

if (!existsSync(dist)) fail('dist/ does not exist — run `npm run build` first.');
if (!existsSync(indexPath)) fail('dist/index.html is missing.');

const html = readFileSync(indexPath, 'utf8');
const js = html.match(/src="([^"]+\.js)"/);
const css = html.match(/href="([^"]+\.css)"/);
if (!js) fail('index.html references no .js bundle.');
if (!css) fail('index.html references no .css bundle.');

for (const [, href] of [js, css]) {
  const asset = resolve(dist, href.replace(/^\//, ''));
  if (!existsSync(asset)) fail(`referenced asset missing on disk: ${href}`);
}

console.log(`SMOKE OK: dist/index.html references ${js[1]} and ${css[1]}, both present.`);
