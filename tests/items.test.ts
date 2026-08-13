import { describe, expect, it } from 'vitest';
import { itemMeta, potionInfo, potionLabel, rarityColor, relicArt, relicInfo, relicLabel } from '../src/lib/items';

describe('relic catalog', () => {
  it('looks up wiki relics by game id, keeping wiki punctuation in names', () => {
    expect(relicLabel('RELIC.PAELS_FLESH')).toBe("Pael's Flesh");
    expect(relicInfo('RELIC.PAELS_FLESH')?.rarity).toBe('Ancient');
    expect(relicArt('RELIC.PAELS_FLESH')).toBe('art/relics/PAELS_FLESH.webp');
  });

  it('covers returning STS1 relics missing from the Cargo tables', () => {
    expect(relicInfo('RELIC.VAJRA')?.blurb).toMatch(/Strength/);
    expect(relicInfo('RELIC.ORICHALCUM')?.blurb).toMatch(/Block/i);
    expect(relicArt('RELIC.VAJRA')).toBe('art/relics/VAJRA.webp');
  });

  it('folds icon placeholders in rules text into words', () => {
    // Happy Flower's wiki text is "Every 3 turns, gain @CE."
    expect(relicInfo('RELIC.HAPPY_FLOWER')?.blurb).toBe('Every 3 turns, gain 1 Energy.');
  });

  it('matches through a leading THE_ in either direction', () => {
    // "The Boot" on the wiki; run files may carry RELIC.BOOT.
    expect(relicInfo('RELIC.BOOT')?.name ?? relicInfo('RELIC.THE_BOOT')?.name).toMatch(/Boot/);
  });

  it('does not invent info for unknown ids, and never crosses kinds', () => {
    expect(relicInfo('RELIC.NOT_A_REAL_RELIC')).toBeUndefined();
    expect(relicInfo('POTION.BLOOD_POTION')).toBeUndefined();
    expect(relicLabel('RELIC.NOT_A_REAL_RELIC')).toBe('Not A Real Relic');
  });
});

describe('potion catalog', () => {
  it('looks up potions with rules text and rarity', () => {
    expect(potionLabel('POTION.BLOOD_POTION')).toBe('Blood Potion');
    expect(potionInfo('POTION.BLOOD_POTION')?.blurb).toMatch(/heal/i);
    expect(potionInfo('POTION.ENERGY_POTION')?.blurb).toBe('Gain 2 Energy.');
  });

  it('degrades to a prettified label for unknown potions', () => {
    expect(potionInfo('POTION.MYSTERY_BREW_9000')).toBeUndefined();
    expect(potionLabel('POTION.MYSTERY_BREW_9000')).toBe('Mystery Brew 9000');
  });
});

describe('rarity presentation', () => {
  it('colors rarities case-insensitively (cards.json is lowercase, items are capitalized)', () => {
    expect(rarityColor('Rare')).toBe(rarityColor('rare'));
    expect(rarityColor('Rare')).not.toBe(rarityColor('Common'));
    expect(rarityColor(undefined)).toBe('var(--ink2)');
  });

  it('builds the tooltip meta line the way the game reads it', () => {
    expect(itemMeta({ name: 'X', blurb: 'y', rarity: 'Rare' }, 'relic')).toBe('Rare Relic');
    expect(itemMeta({ name: 'X', blurb: 'y', rarity: 'Starter', character: 'Ironclad' }, 'relic')).toBe(
      'Starter Relic · Ironclad',
    );
    expect(itemMeta({ name: 'X', blurb: 'y', rarity: 'Common', character: 'Any' }, 'potion')).toBe('Common Potion');
  });
});
