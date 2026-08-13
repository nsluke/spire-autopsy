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

/** Group encounters use plural names; the sprite is filed under the monster's singular id. */
const ALIASES: Record<string, string> = {
  BOWLBUGS: 'BOWLBUG_ROCK',
  CORPSE_SLUGS: 'CORPSE_SLUG',
  EXOSKELETONS: 'EXOSKELETON',
  MYTES: 'MYTE',
  NIBBITS: 'NIBBIT',
  SCROLLS_OF_BITING: 'SCROLL_OF_BITING',
  TOADPOLES: 'TOADPOLE',
  TWO_TAILED_RATS: 'TWO_TAILED_RAT',
};

/** Art path for an ENCOUNTER.* or MONSTER.* id (undefined for non-entity ids). */
export function monsterArt(id: string | undefined): string | undefined {
  if (!id) return undefined;
  let base: string | undefined;
  if (id.startsWith('ENCOUNTER.')) base = id.slice('ENCOUNTER.'.length).replace(ENCOUNTER_SUFFIX, '');
  else if (id.startsWith('MONSTER.')) base = id.slice('MONSTER.'.length);
  if (!base) return undefined;
  return `art/monsters/${ALIASES[base] ?? base}.png`;
}

/** Art path for a CARD.* id. Missing files are hidden by <ArtImg>. */
export function cardArt(id: string | undefined): string | undefined {
  if (!id?.startsWith('CARD.')) return undefined;
  return `art/cards/${id.slice('CARD.'.length)}.webp`;
}

/** Art path for a CHARACTER.* id. */
export function characterArt(id: string | undefined): string | undefined {
  if (!id?.startsWith('CHARACTER.')) return undefined;
  return `art/characters/${id.slice('CHARACTER.'.length)}.png`;
}
