import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { eventChoiceLabel, floorFacts, floorKind, hpTone } from '../src/lib/floorLog';
import { normalizeRun } from '../src/lib/normalize';
import type { NormalizedRun } from '../src/lib/types';

function loadFixture(name: string): NormalizedRun {
  const path = fileURLToPath(new URL(`./fixtures/${name}.run`, import.meta.url));
  return normalizeRun(JSON.parse(readFileSync(path, 'utf8')), `${name}.run`);
}

const loss = loadFixture('1785858459');
const byFloor = new Map(loss.nodes.map((n) => [n.floor, n]));

describe('floorKind', () => {
  it('reads combat, campfire, shop, chest, and event nodes', () => {
    expect(floorKind(byFloor.get(2)!)).toBe('monster');
    expect(floorKind(byFloor.get(9)!)).toBe('elite');
    expect(floorKind(byFloor.get(17)!)).toBe('boss');
    expect(floorKind(byFloor.get(11)!)).toBe('rest');
    expect(floorKind(byFloor.get(8)!)).toBe('shop');
    expect(floorKind(byFloor.get(10)!)).toBe('treasure');
    expect(floorKind(byFloor.get(1)!)).toBe('event');
    expect(floorKind(byFloor.get(20)!)).toBe('event');
  });
});

describe('hpTone', () => {
  it('uses the 60% boss-entry line as the healthy cutoff', () => {
    expect(hpTone(52, 92)).toBe('ember'); // 57%
    expect(hpTone(60, 100)).toBe('win');
    expect(hpTone(0, 92)).toBe('loss');
    expect(hpTone(23, 75)).toBe('loss');
  });
});

describe('floorFacts of 1785858459', () => {
  it('names the Neow opener and the cards it stripped', () => {
    const f = floorFacts(byFloor.get(1)!);
    expect(f.title).toBe('Neow');
    expect(f.kind).toBe('event');
    expect(f.eventId).toBe('EVENT.NEOW');
    expect(f.encounterId).toBeUndefined();
    expect(f.removed).toEqual(expect.arrayContaining(['CARD.STRIKE_DEFECT', 'CARD.DEFEND_DEFECT']));
    expect(f.relics).toContain('RELIC.PRECARIOUS_SHEARS');
  });

  it('records the floor-12 elite spike: 47 damage, Hotfix, Bronze Scales', () => {
    const f = floorFacts(byFloor.get(12)!);
    expect(f.kind).toBe('elite');
    expect(f.title).toBe('Bygone Effigy');
    expect(f.damageTaken).toBe(47);
    expect(f.picked).toEqual(['CARD.HOTFIX']);
    expect(f.skipped).toEqual(expect.arrayContaining(['CARD.SKIM', 'CARD.THUNDER']));
    expect(f.relics).toContain('RELIC.BRONZE_SCALES');
    expect(f.encounterId).toBe('ENCOUNTER.BYGONE_EFFIGY_ELITE');
  });

  it('does not dump a shop skip list, but does keep the purchase', () => {
    const f = floorFacts(byFloor.get(8)!);
    expect(f.kind).toBe('shop');
    expect(f.eventId).toBeUndefined();
    expect(f.skipped).toEqual([]);
    expect(f.gainedExtra).toContain('CARD.COOLHEADED');
    expect(f.goldSpent).toBe(121);
  });

  it('marks campfire smith vs heal', () => {
    expect(floorFacts(byFloor.get(11)!).rest).toBe('SMITH');
    expect(floorFacts(byFloor.get(11)!).upgraded).toContain('CARD.LOOP');
    expect(floorFacts(byFloor.get(16)!).rest).toBe('HEAL');
    expect(floorFacts(byFloor.get(16)!).hpHealed).toBe(22);
  });

  it('keeps duplicate removals (Pael stripped two Strikes and two Defends)', () => {
    const f = floorFacts(byFloor.get(18)!);
    expect(f.removed.filter((id) => id === 'CARD.DEFEND_DEFECT')).toHaveLength(2);
    expect(f.removed.filter((id) => id === 'CARD.STRIKE_DEFECT')).toHaveLength(2);
  });

  it('records the death fight', () => {
    const f = floorFacts(byFloor.get(33)!);
    expect(f.kind).toBe('boss');
    expect(f.title).toBe('The Insatiable');
    expect(f.hp).toBe(0);
    expect(f.damageTaken).toBe(52);
    expect(f.potionsUsed.length).toBeGreaterThan(0);
  });
});

describe('eventChoiceLabel', () => {
  it('prettifies option keys and drops everything else', () => {
    expect(eventChoiceLabel('TABLET_OF_TRUTH.pages.INITIAL.options.SMASH.title')).toBe('Smash');
    expect(eventChoiceLabel('SYMBIOTE.pages.INITIAL.options.KILL_WITH_FIRE.title')).toBe('Kill With Fire');
    // relic-title keys are not event choices — raw loc keys never leak through
    expect(eventChoiceLabel('PRECARIOUS_SHEARS.title')).toBeUndefined();
    expect(eventChoiceLabel('garbage')).toBeUndefined();
  });

  it('surfaces chosen event options as floor facts', () => {
    expect(floorFacts(byFloor.get(6)!).eventChoices).toEqual(['Smash']);
    // floor 1 is Neow with a relic-title key — nothing renderable, nothing shown
    expect(floorFacts(byFloor.get(1)!).eventChoices).toEqual([]);
  });
});

describe('floor facts the choice lists miss', () => {
  it('credits relics granted without a choice record to their floor', () => {
    const node = JSON.parse(JSON.stringify(byFloor.get(25)!)) as typeof loss.nodes[number];
    node.stats.relicChoices = []; // simulate an event grant: no choice recorded
    const facts = floorFacts(node, loss.player.relics);
    expect(facts.relics).toContain('RELIC.STRAWBERRY');
  });

  it('never lists starter relics as floor-1 loot', () => {
    const facts = floorFacts(byFloor.get(1)!, loss.player.relics);
    expect(facts.relics).not.toContain('RELIC.CRACKED_CORE');
  });

  it('shows a combat reward skipped whole', () => {
    const node = JSON.parse(JSON.stringify(byFloor.get(12)!)) as typeof loss.nodes[number];
    for (const c of node.stats.cardChoices) c.wasPicked = false;
    const facts = floorFacts(node);
    expect(facts.skippedAll).toBe(true);
    expect(facts.skipped).toContain('CARD.HOTFIX');
    // while the untouched floor keeps the old small-skip display
    const original = floorFacts(byFloor.get(12)!);
    expect(original.skippedAll).toBe(false);
    expect(original.skipped).toEqual(expect.arrayContaining(['CARD.SKIM', 'CARD.THUNDER']));
  });

  it('reads max-HP drains and gains off the node', () => {
    const node = JSON.parse(JSON.stringify(byFloor.get(7)!)) as typeof loss.nodes[number];
    node.stats.maxHpLost = 8;
    const facts = floorFacts(node);
    expect(facts.maxHpLost).toBe(8);
    expect(floorFacts(byFloor.get(7)!).maxHpLost).toBe(0);
  });
});
