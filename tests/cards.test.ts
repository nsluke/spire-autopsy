import { describe, expect, it } from 'vitest';
import { cardArt, monsterArt } from '../src/lib/art';
import { cardColor, cardLabel } from '../src/lib/cards';

describe('card listing polish', () => {
  it('colors listed cards by character (and curses as loss-red)', () => {
    expect(cardColor('CARD.BACKFLIP')).toBe('var(--c-silent)');
    expect(cardColor('CARD.CHARGE_BATTERY')).toBe('var(--c-defect)');
    expect(cardColor('CARD.STRIKE_IRONCLAD')).toBe('var(--c-ironclad)');
    expect(cardColor('CARD.ASCENDERS_BANE')).toBe('var(--loss)');
    expect(cardColor('CARD.NOT_A_REAL_CARD')).toBe('var(--muted)');
  });

  it('labels from the wiki pack and points art at art/cards/<id>.webp', () => {
    expect(cardLabel('CARD.BACKFLIP')).toBe('Backflip');
    expect(cardLabel('CARD.CHARGE_BATTERY')).toBe('Charge Battery');
    expect(cardArt('CARD.BACKFLIP')).toBe('art/cards/BACKFLIP.webp');
    expect(cardArt('ENCOUNTER.THE_KIN_BOSS')).toBeUndefined();
  });
});

describe('enemy listing polish', () => {
  it('points encounter ids at art/monsters/<base>.png', () => {
    expect(monsterArt('ENCOUNTER.SKULKING_COLONY_NORMAL')).toBe('art/monsters/SKULKING_COLONY.png');
    expect(monsterArt('ENCOUNTER.THE_INSATIABLE_BOSS')).toBe('art/monsters/THE_INSATIABLE.png');
    expect(monsterArt('ENCOUNTER.NIBBITS_WEAK')).toBe('art/monsters/NIBBIT.png');
    expect(monsterArt('CARD.BACKFLIP')).toBeUndefined();
  });
});
