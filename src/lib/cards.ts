/**
 * Card metadata access — the layer-2 naming/metadata pack.
 *
 * src/data/cards.json is generated from the community wiki's Lua data modules
 * (see src/data/cards-report.md for the regeneration recipe); 100% of the ids
 * observed in the reference corpus match. Ids missing here (future patches)
 * degrade gracefully: consumers must treat undefined as "unknown", never skip
 * the card silently in denominators without saying so.
 */
import cardsJson from '../data/cards.json';

export type CardType = 'attack' | 'skill' | 'power' | 'curse' | 'quest' | 'status';
export type CardRarity = 'starter' | 'common' | 'uncommon' | 'rare' | 'special';

export interface CardInfo {
  name: string;
  character: string; // IRONCLAD | SILENT | DEFECT | NECROBINDER | REGENT | COLORLESS
  type: CardType;
  rarity: CardRarity;
  /** energy cost; -1 = X-cost; null = unplayable */
  cost: number | null;
}

const CARDS = cardsJson as Record<string, CardInfo>;

export function cardInfo(id: string): CardInfo | undefined {
  return CARDS[id];
}

export function cardType(id: string): CardType | undefined {
  return CARDS[id]?.type;
}

/** Display name: wiki name when we have it, otherwise the prettified id. */
export function cardLabel(id: string): string {
  return CARDS[id]?.name ?? id.replace(/^CARD\./, '').toLowerCase().split('_').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/**
 * Text color for a listed card — the character's banner color (the color of
 * the card), with curses on the loss red. CSS variables so it follows tokens.
 */
export function cardColor(id: string): string {
  const info = CARDS[id];
  if (!info) return 'var(--muted)';
  if (info.type === 'curse') return 'var(--loss)';
  switch (info.character) {
    case 'IRONCLAD':
      return 'var(--c-ironclad)';
    case 'SILENT':
      return 'var(--c-silent)';
    case 'DEFECT':
      return 'var(--c-defect)';
    case 'NECROBINDER':
      return 'var(--c-necro)';
    case 'REGENT':
      return 'var(--c-regent)';
    default:
      return 'var(--muted)';
  }
}

/** Share of ids in the list that have metadata — surface this when filtering by type. */
export function metadataCoverage(ids: string[]): number {
  if (ids.length === 0) return 1;
  return ids.filter((id) => CARDS[id]).length / ids.length;
}
