/**
 * ID → display-name formatting. Layer 1 of the naming strategy:
 * a deterministic prettifier that always works, with a small curated
 * override table for names whose prettified form reads wrong.
 * (Layer 2 — the full metadata pack with type/rarity/cost — comes later.)
 */

const OVERRIDES: Record<string, string> = {
  'ENCOUNTER.THE_KIN_BOSS': 'The Kin',
  'ENCOUNTER.THE_INSATIABLE_BOSS': 'The Insatiable',
  'ENCOUNTER.KNOWLEDGE_DEMON_BOSS': 'Knowledge Demon',
  'ENCOUNTER.KAISER_CRAB_BOSS': 'Kaiser Crab',
  'ENCOUNTER.TEST_SUBJECT_BOSS': 'Test Subject',
  'ENCOUNTER.DOORMAKER_BOSS': 'Doormaker',
  'ENCOUNTER.LAGAVULIN_MATRIARCH_BOSS': 'Lagavulin Matriarch',
  'ACT.OVERGROWTH': 'Overgrowth',
  'ACT.UNDERDOCKS': 'Underdocks',
  'ACT.HIVE': 'Hive',
  'ACT.GLORY': 'Glory',
};

const SUFFIXES = /_(WEAK|NORMAL|ELITE|BOSS|EVENT_ENCOUNTER)$/;

/** "CARD.SWORD_BOOMERANG" → "Sword Boomerang" */
export function displayName(id: string | undefined): string {
  if (!id) return '';
  if (OVERRIDES[id]) return OVERRIDES[id];
  const bare = id.includes('.') ? id.slice(id.indexOf('.') + 1) : id;
  const trimmed = id.startsWith('ENCOUNTER.') ? bare.replace(SUFFIXES, '') : bare;
  return trimmed
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** "CHARACTER.IRONCLAD" → "Ironclad" */
export const characterName = displayName;

/** Encounter tier from its id suffix. */
export function encounterTier(id: string): 'weak' | 'normal' | 'elite' | 'boss' | 'event' | 'other' {
  if (/_BOSS$/.test(id)) return 'boss';
  if (/_ELITE$/.test(id)) return 'elite';
  if (/_WEAK$/.test(id)) return 'weak';
  if (/_NORMAL$/.test(id)) return 'normal';
  if (/_EVENT_ENCOUNTER$/.test(id)) return 'event';
  return 'other';
}

/** Character accent colors — colorblind-validated against the dark surface. */
export const CHARACTER_COLORS: Record<string, string> = {
  'CHARACTER.IRONCLAD': '#CC5A4E',
  'CHARACTER.DEFECT': '#4592E6',
  'CHARACTER.REGENT': '#B5892A',
  'CHARACTER.NECROBINDER': '#C060C0',
  'CHARACTER.SILENT': '#4E9E47',
};

export function characterColor(id: string): string {
  return CHARACTER_COLORS[id] ?? '#9C8D74';
}

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
export function shortDate(unixSeconds: number): string {
  return dateFmt.format(new Date(unixSeconds * 1000));
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

export const fmtInt = new Intl.NumberFormat(undefined).format;
