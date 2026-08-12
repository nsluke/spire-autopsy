# cards.json generation report

Generated: 2026-08-11

## Match rate

**517 / 517 corpus card IDs matched (100%).** Zero unmatched IDs.

- Corpus: every distinct `CARD.*` ID found in the 232 `*.run` files (backups excluded) in
  `~/Library/Application Support/SlayTheSpire2/steam/76561197965805643/profile1/saves/history`
  (decks, card_choices, cards_gained/removed, etc.).
- Wiki source contained 607 STS2 card entries; the 90 not present in the corpus (statuses,
  upgraded token variants, unseen cards) are intentionally omitted from `cards.json`.

## Entry counts (matched IDs)

| Character | Count | | Type | Count | | Rarity | Count |
|---|---|---|---|---|---|---|---|
| COLORLESS | 91 | | skill | 218 | | uncommon | 210 |
| SILENT | 88 | | attack | 182 | | rare | 150 |
| IRONCLAD | 86 | | power | 102 | | common | 100 |
| DEFECT | 85 | | curse | 12 | | special | 38 |
| NECROBINDER | 85 | | quest | 3 | | starter | 19 |
| REGENT | 82 | | | | | | |

Costs: 9 X-cost cards (stored as `-1`), 14 unplayable cards (curses/quest items, stored as `null`).

## Sources

Data comes from slaythespire.wiki.gg's Lua data modules (the canonical source that renders the
per-character card list pages and `Slay the Spire 2:Cards List`), fetched raw via
`index.php?action=raw`:

- https://slaythespire.wiki.gg/wiki/Module:Cards/StS2_data/Ironclad
- https://slaythespire.wiki.gg/wiki/Module:Cards/StS2_data/Silent
- https://slaythespire.wiki.gg/wiki/Module:Cards/StS2_data/Defect
- https://slaythespire.wiki.gg/wiki/Module:Cards/StS2_data/Necrobinder
- https://slaythespire.wiki.gg/wiki/Module:Cards/StS2_data/Regent
- https://slaythespire.wiki.gg/wiki/Module:Cards/StS2_data/Colorless (also holds Curses, Statuses, Quest cards)

Note: the wiki's Cargo `Cards` table (`api.php?action=cargoquery`) covers only ~68 STS2 cards —
do not use it; the Lua modules are complete.

## Method (for regeneration after game patches)

1. Collect corpus IDs: regex `CARD\.[A-Z0-9_]+` over all `*.run` files (ignore `*.backup`).
2. Download the six Lua modules above with
   `curl -A "<descriptive UA>" "https://slaythespire.wiki.gg/index.php?title=Module:Cards/StS2 data/<Char>&action=raw"`
   (throttle ~5s between requests; the wiki rate-limits default user agents).
3. Parse entries of the form `["Name"] = { Cost = …, Color = "…", Type = "…", Rarity = "…" }`
   (brace-balanced block scan + `key = value` field regex).
4. Match: normalize wiki name to UPPER_SNAKE — uppercase, strip apostrophes/periods, any other
   non-alphanumeric run becomes `_` — and compare with the ID suffix after `CARD.`.
   Character-suffixed starters match directly because the wiki disambiguates them the same way
   ("Strike (Silent)" → `STRIKE_SILENT`).
5. Field mapping:
   - `name`: wiki name with a trailing ` (CharacterName)` disambiguator stripped.
   - `character`: wiki `Color` uppercased (COLORLESS covers curses/statuses/quest cards).
   - `type`: lowercased (`attack`/`skill`/`power`/`curse`/`status`/`quest`).
   - `rarity`: `Basic` → `starter`; `Common`/`Uncommon`/`Rare` kept; everything else
     (Ancient, Event, Token, Quest, Curse, Status) → `special`.
   - `cost`: wiki integer; `-1` = X-cost (kept as `-1`); `-2` = unplayable → `null`.

## Manual overrides / caveats

- `CARD.SCARE` → **Sidestep**: the card was renamed in-game; the wiki page
  `Slay the Spire 2:Scare` is a `#REDIRECT` to `Slay the Spire 2:Sidestep`. This is the only
  hand-mapped ID; if a future patch renames cards, check wiki redirects for new unmatched IDs.
- Wiki rarities beyond the classic five (Ancient, Event, Token, Quest) are collapsed into
  `special`; the original distinction is recoverable from the modules if ever needed.
- Card `Text` in the modules uses `[base|upgraded]` bracket notation and `$Keyword` markup;
  not captured here.
- Status cards (Burn, Dazed, Wound, …) exist in the wiki data but never appear in run-history
  files (they are not persisted in the master deck), so none are in `cards.json`.
