# Art Attribution

All enemy, boss, and character artwork in this directory is © Mega Crit and originates
from **Slay the Spire 2**. Spire Autopsy is an unofficial, non-commercial, fan-made tool
and is not affiliated with or endorsed by Mega Crit. Artwork will be removed immediately
on request from the rights holder.

## Fan content policy

Mega Crit explicitly encourages fan content about their games:

- FAQ ("we encourage you to make content about our games!"): https://www.megacrit.com/faq/
- Full content policy: https://megacrit.com/content-policy/

Key points of the content policy relevant to this project: fan works and content about
the games are encouraged; monetized video content is allowed with credit; selling
merchandise that uses direct game assets is prohibited (this project sells nothing and
is fully non-commercial); no claim of official affiliation may be made (none is made).
No Slay the Spire 2–specific policy exists as of August 2026 — the general Mega Crit
content policy applies to both games.

## Image source

All images were sourced from the community wiki **slaythespire.wiki.gg**
(Slay the Spire 2 namespace), which hosts them as game-asset uploads © Mega Crit.
Per-file original URLs are recorded in `manifest.json` under `"sources"` (enemies/
characters), `"cardSources"` (card portraits), `"eventSources"` (event illustrations
and Ancient portraits), and `"mapSources"` (map-node icons).

Card portraits are 220px-wide thumbs of the unupgraded wiki card image, fetched by
`scripts/fetch-card-art.mjs`, converted to WebP, and shown only as a hover preview
on listed card names.

Relic icons (`art/relics/`) and potion icons (`art/potions/`) are fetched by
`scripts/fetch-item-art.mjs` from `Module:Relics/StS2 data` and
`Module:Potions/StS2 data` on the wiki; per-file original URLs are in
`manifest.json` under `"relicSources"` and `"potionSources"`. Rules text shown
in hover tooltips comes from the same modules.

Map icons (`art/map/`) and event illustrations (`art/events/`) are fetched by
`scripts/fetch-place-art.mjs`. Event hover copy comes from
`Module:Events/StS2 data` on the wiki (Description, else the first sentence of
Flavor). Ancients — Neow, Pael, Orobas, Tanx, Nonupeipe — are not in that module;
their portraits are the wiki map-node images (`File:StS2 Map-Neow.png` and
siblings) with short hand-written blurbs.

Notes on representative sprites for group enemies:
- `THE_KIN.png` uses the Kin Priest sprite (`File:StS2 Kin Priest.png`).
- `KNIGHTS.png` uses the Mysterious Knight sprite (`File:StS2 Mysterious Knight.png`)
  from the Knight Gang encounter.
- `BOWLBUG_ROCK.png` uses the rock-variant Bowlbug sprite (`File:StS2 Bowlbug (Rock).png`).
- `LEAF_SLIME_S.png` / `TWIG_SLIME_S.png` use the small (S) slime sprites.
- `INFESTED_PRISMS.png` / `PHANTASMAL_GARDENERS.png` use the singular enemy sprites.

## Encounter sprite fill (August 2026)

40 additional encounter sprites were added, all sourced from **slaythespire.wiki.gg**
(no game-file extraction was needed). Files are named after the encounter base name;
per-file original URLs are in `manifest.json` under `"sources"`. Representative-sprite
choices for group/event encounters:

- `AXEBOTS.png`, `CHOMPERS.png`, `INKLETS.png` use the singular enemy sprites
  (`File:StS2 Axebot.png`, `File:StS2 Chomper.png`, `File:StS2 Inklet.png`).
- `CULTISTS.png` uses the Damp Cultist sprite (`File:StS2 Damp Cultist.png`).
- `RUBY_RAIDERS.png` uses the Axe Raider sprite (`File:StS2 Axe Raider.png`).
- `THE_LOST_AND_FORGOTTEN.png` uses The Lost sprite (`File:StS2 The Lost.png`).
- `FAKE_MERCHANT.png` uses the fake merchant enemy sprite
  (`File:StS2 The Merchant???.png`).
- `SLIMES.png` uses the medium Leaf Slime sprite (`File:StS2 Leaf Slime (M).png`).
- `CONSTRUCT_MENAGERIE.png` is a copy of the Cubex Construct sprite (the encounter is
  a mixed group of constructs).
- `OVERGROWTH_CRAWLERS.png` is a copy of the Fuzzy Wurm Crawler sprite (the encounter
  mixes Fuzzy Wurm Crawlers and Shrinker Beetles).
- `BATTLEWORN_DUMMY.png`, `HAUNTED_SHIP.png`, `PUNCH_OFF.png`, `DENSE_VEGETATION.png`
  are event-encounter illustrations from their wiki event pages.
