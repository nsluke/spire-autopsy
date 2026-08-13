/**
 * Ascension climb modifiers — what each level adds. Levels stack: playing
 * A5 means rules 1–5 are all active. Source: Module:Ascension/StS2 data on
 * slaythespire.wiki.gg (see public/art/ATTRIBUTION.md).
 */
export const ASCENSION_RULES: Record<number, string> = {
  1: 'Elites spawn more often.',
  2: 'Ancients only heal 80% of your missing HP.',
  3: 'Enemies and Treasure Chests drop 25% less Gold.',
  4: 'Start each run with 1 less potion slot.',
  5: 'Start each run cursed.',
  6: 'Removing cards from your deck at the Merchant is more expensive.',
  7: 'Rare and Upgraded cards appear less often.',
  8: 'All enemies are harder to kill.',
  9: 'All enemies have deadlier attacks.',
  10: 'Fight two Bosses at the end of Act 3.',
};

export const ASCENSION_MAX = 10;

/** Tooltip copy for a level: the rule it adds, plus the stack reminder. */
export function ascensionBlurb(level: number): string {
  if (level <= 0) return 'The base climb. No ascension modifiers active.';
  const rule = ASCENSION_RULES[Math.min(level, ASCENSION_MAX)];
  if (level === 1) return rule;
  return `${rule} Every rule below it is also active.`;
}

export function ascensionMeta(level: number): string {
  if (level <= 0) return 'Base climb';
  return level >= ASCENSION_MAX ? 'Climb modifier · max level' : 'Climb modifier';
}
