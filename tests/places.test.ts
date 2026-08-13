import { describe, expect, it } from 'vitest';
import { eventArt, eventInfo, eventLabel, mapArt, placeBlurb, restBlurb } from '../src/lib/places';

describe('event catalog', () => {
  it('looks up wiki events by game id, including a stripped leading THE_', () => {
    expect(eventLabel('EVENT.SELF_HELP_BOOK')).toBe('Self-Help Book');
    expect(eventInfo('EVENT.SELF_HELP_BOOK')?.blurb).toMatch(/enhance an Attack, Skill, or Power/);
    expect(eventArt('EVENT.SELF_HELP_BOOK')).toBe('art/events/SELF_HELP_BOOK.webp');

    expect(eventLabel('EVENT.ROUND_TEA_PARTY')).toBe('The Round Tea Party');
    expect(eventArt('EVENT.ROUND_TEA_PARTY')).toBe('art/events/THE_ROUND_TEA_PARTY.webp');
    expect(eventLabel('EVENT.LOST_WISP')).toBe('The Lost Wisp');
  });

  it('covers Ancients that the wiki event module omits', () => {
    expect(eventLabel('EVENT.NEOW')).toBe('Neow');
    expect(eventInfo('EVENT.NEOW')?.blurb).toMatch(/three boons/);
    expect(eventArt('EVENT.NEOW')).toBe('art/events/NEOW.webp');
    expect(eventLabel('EVENT.PAEL')).toBe('Pael');
    expect(eventLabel('EVENT.TANX')).toBe('Tanx');
  });

  it('does not invent art paths for unknown events (map icon is the fallback)', () => {
    expect(eventArt('EVENT.NOT_A_REAL_EVENT')).toBeUndefined();
    expect(eventArt('ENCOUNTER.THE_KIN_BOSS')).toBeUndefined();
    expect(placeBlurb('event', 'EVENT.NOT_A_REAL_EVENT')).toMatch(/unknown/i);
  });
});

describe('map-node blurbs', () => {
  it('explains rest, shop, chest, and rest choices', () => {
    expect(mapArt('rest')).toBe('art/map/REST.webp');
    expect(mapArt('shop')).toBe('art/map/SHOP.webp');
    expect(mapArt('treasure')).toBe('art/map/TREASURE.webp');
    expect(placeBlurb('rest')).toMatch(/30%/);
    expect(placeBlurb('shop')).toMatch(/card removal/);
    expect(placeBlurb('treasure')).toMatch(/relic/i);
    expect(restBlurb('HEAL')).toMatch(/30%/);
    expect(restBlurb('SMITH')).toMatch(/Upgrade/);
    expect(restBlurb('HATCH')).toMatch(/Byrdonis Egg/);
  });
});
