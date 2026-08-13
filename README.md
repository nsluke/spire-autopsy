# ✝ Spire Autopsy

**Your deaths have a paper trail.** A zero-backend coach for Slay the Spire 2:
drop in your local run history and get a diagnosis — the habits costing you
runs, with receipts, and a drill to fix each one. Plus lifetime stats and a
floor-by-floor autopsy of every death.

**Run files never leave this browser.** They are parsed locally, stored in
IndexedDB, and never uploaded. It works in airplane mode. The one optional
exception is an anonymous snapshot you can send with an explicit click — counts
and detector outcomes, not your `.run` files.

## Where your runs live

Slay the Spire 2 writes every finished run to disk as plain JSON:

| OS | Path |
| --- | --- |
| macOS | `~/Library/Application Support/SlayTheSpire2/steam/<steam-id>/profile1/saves/history` |
| Windows | `%USERPROFILE%\AppData\Local\SlayTheSpire2\steam\<steam-id>\profile1\saves\history` *(early access — verify)* |
| Linux / Steam Deck | via Proton: `.../compatdata/<appid>/pfx/drive_c/users/steamuser/AppData/Local/SlayTheSpire2/...` *(early access — verify)* |

Drag the `history` folder onto the page (or use the folder picker; Chromium
browsers can remember the folder for one-click re-sync).

## What it detects (v0.1)

Every claim ships with its receipts — exact sample sizes, the rule that fired,
and links to the specific runs. Detectors gate themselves below minimum sample
sizes rather than emitting noise, and win/loss comparisons are phrased as
correlation, never causation.

- **Boss-entry HP** — how often you walk into bosses hurt, and what it costs you
- **Removal discipline** — starter cards overstaying, rich shop visits without removals
- **Ascension pacing** — climbing faster than your win rate supports
- Observations: elite appetite, potion hoarding, gold dying unspent

## Development

```bash
npm install
npm run dev        # local dev server
npm test           # unit tests (fixtures are real runs)
npm run typecheck
npm run build      # static bundle in dist/
```

Optional full-corpus validation against your own history (compares the
production parser to independently audited reference numbers):

```bash
STS2_HISTORY="$HOME/Library/Application Support/SlayTheSpire2/steam/<id>/profile1/saves/history" npx vitest run tests/corpus-validation.test.ts
```

### Architecture notes

- **Tolerant parser** (`src/lib/schema.ts`, `normalize.ts`): one Zod schema
  handles run-file schema v8 and v9 (v8 is a strict subset). Every list field
  is optional (the game omits empty lists), unknown fields never fail a parse.
  Known traps encoded: co-op runs join `player_stats` by `player_id`; "?" map
  nodes can contain multiple rooms (event → fight); HP/gold per node are
  post-node values, so entry HP is reconstructed from the previous node.
- **Raw-first storage** (`src/lib/db.ts`): original file text is the source of
  truth in IndexedDB; parser upgrades re-derive summaries retroactively —
  users never re-upload.
- **No damage-dealt stats by design**: the game does not record damage dealt
  (verified across schema v8/v9). Fight length (`turns_taken`) is the offense
  proxy; anything the data can't support, the UI says so.
- Sample data (`public/demo/`) and test fixtures are real, solo-only runs
  (co-op files are excluded — they contain other players' Steam ids). Bundled
  demo runs are also omitted from anonymous snapshots so they cannot pollute
  the drop-off.

## Anonymous snapshot (opt-in)

Nothing is sent on import, and nothing is sent because a toggle was left on.
The dashboard (and the import page once you have data) offers **Share
anonymously**. That click POSTs a JSON snapshot of:

- corpus counts (runs / wins / losses, character mix, schema and build versions)
- which coach checks fired (ids and scores — not receipts, not copy)
- climb walls (character + target + attempt counts)

It never includes run files, seeds, Steam ids, filenames, decks, floor-by-floor
HP, dates, or timestamps. Extra keys a modified client might attach are stripped
again on the server (`sanitizeContribution`).

Until a drop-off URL is configured, Share stays disabled and **Copy JSON** still
works.

**Drop-off** is a small Cloudflare Worker (or Pages Function at
`/api/contribute`) in `contribute-ingest/`. It stores allowlisted JSON in D1
and does not persist IP or User-Agent.

```bash
npx wrangler d1 create spire-autopsy-contribute
# paste the database_id into contribute-ingest/wrangler.toml
npx wrangler d1 execute spire-autopsy-contribute --file=contribute-ingest/schema.sql
npx wrangler deploy --config contribute-ingest/wrangler.toml
```

Then set `VITE_CONTRIBUTE_URL` to that worker URL (repo secret
`VITE_CONTRIBUTE_URL` for the GitHub Pages build). The CSP `connect-src` list
gains that origin at build time — the only extra network permission — and the
app still only POSTs after Share.

Cloudflare Pages can keep `connect-src 'self'` by setting
`VITE_CONTRIBUTE_SAME_ORIGIN=true` and binding D1 to the Pages Function.

## Deploying

The site is a static bundle — any static host works.

**GitHub Pages** (zero config): push to `main`; `.github/workflows/pages.yml`
runs tests, builds, and deploys. One-time setup in the repo settings:
*Settings → Pages → Source: GitHub Actions*. Hash routing and relative asset
paths mean project pages (`user.github.io/repo/`) work as-is. The privacy CSP
is injected as a `<meta>` tag at build time since Pages can't set headers.

**Cloudflare Pages**: build command `npm run build`, output `dist` — picks up
the header CSP from `dist/_headers` (written at build time). Bind D1 as `DB`
if you are using the same-origin `/api/contribute` Function.

## Privacy, verifiably

- Default CSP is `connect-src 'self'` (see `public/_headers` / the build-time
  `<meta>` tag). The browser cannot contact any other origin unless this build
  set `VITE_CONTRIBUTE_URL`, in which case that one origin is added.
- Run files are never uploaded. The opt-in snapshot is aggregates only; sending
  it is a click, never an import side-effect.
- No analytics, no cookies, no accounts.
- Open source — audit the parser and `src/lib/contributeSnapshot.ts` yourself.

Not affiliated with Mega Crit. Card/relic/encounter names appearing in the UI
are derived from the ids in your own save files; no game assets are included.
