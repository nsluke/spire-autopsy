# ✝ Spire Autopsy

**Your deaths have a paper trail.** A zero-backend coach for Slay the Spire 2:
drop in your local run history and get a diagnosis — the habits costing you
runs, with receipts, and a drill to fix each one. Plus lifetime stats and a
floor-by-floor autopsy of every death.

**Nothing uploads. Ever.** This is a static site: your run files are parsed in
your browser, stored in your browser (IndexedDB), and never leave your machine.
It works in airplane mode.

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
  (co-op files are excluded — they contain other players' Steam ids).

## Privacy, verifiably

- Deployed with a strict `Content-Security-Policy` (see `public/_headers`):
  the browser is not permitted to contact any other origin.
- No analytics, no cookies, no accounts.
- Open source — audit the parser yourself.

Not affiliated with Mega Crit. Card/relic/encounter names appearing in the UI
are derived from the ids in your own save files; no game assets are included.
