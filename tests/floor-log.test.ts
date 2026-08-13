import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { floorFacts, floorKind, hpTone } from '../src/lib/floorLog';
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
