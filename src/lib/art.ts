/**
 * Game-art path resolution. Files in public/art/ are named by bare entity id
 * (KNOWLEDGE_DEMON.png); encounter ids drop their tier suffix to find the
 * underlying enemy sprite. Coverage is partial by nature (new game patches add
 * enemies), so consumers render through <ArtImg>, which removes itself when a
 * file 404s — missing art degrades to the text-only layout, never a broken img.
 *
 * All art © Mega Crit, used under their fan-content policy (see
 * public/art/ATTRIBUTION.md). Sourced from slaythespire.wiki.gg.
 */

const ENCOUNTER_SUFFIX = /_(WEAK|NORMAL|ELITE|BOSS|EVENT_ENCOUNTER)$/;

/** Art path for an ENCOUNTER.* or MONSTER.* id (undefined for non-entity ids). */
export function monsterArt(id: string | undefined): string | undefined {
  if (!id) return undefined;
  if (id.startsWith('ENCOUNTER.')) {
    return `art/monsters/${id.slice('ENCOUNTER.'.length).replace(ENCOUNTER_SUFFIX, '')}.png`;
  }
  if (id.startsWith('MONSTER.')) {
    return `art/monsters/${id.slice('MONSTER.'.length)}.png`;
  }
  return undefined;
}

/** Art path for a CHARACTER.* id. */
export function characterArt(id: string | undefined): string | undefined {
  if (!id?.startsWith('CHARACTER.')) return undefined;
  return `art/characters/${id.slice('CHARACTER.'.length)}.png`;
}
