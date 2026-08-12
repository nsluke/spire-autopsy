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

/** Share of ids in the list that have metadata — surface this when filtering by type. */
export function metadataCoverage(ids: string[]): number {
  if (ids.length === 0) return 1;
  return ids.filter((id) => CARDS[id]).length / ids.length;
}
