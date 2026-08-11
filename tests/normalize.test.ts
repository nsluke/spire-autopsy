/**
 * normalize.test.ts — asserts the normalize pipeline against the real
 * fixture .run files (facts verified by hand against the raw JSON).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  completedRuns,
  deathNode,
  entryGold,
  entryHpPct,
  hasRoom,
  normalizeRun,
  runIdFromFileName,
} from '../src/lib/normalize';
import type { NormalizedRun } from '../src/lib/types';

function loadFixture(name: string): NormalizedRun {
  const path = fileURLToPath(new URL(`./fixtures/${name}.run`, import.meta.url));
  return normalizeRun(JSON.parse(readFileSync(path, 'utf8')), `${name}.run`);
}

const FIXTURE_NAMES = ['1774194024', '1776190046', '1778212793', '1778528032', '1779248265', '1785858459'];

describe('runIdFromFileName', () => {
  it('strips .run and .run.backup extensions', () => {
    expect(runIdFromFileName('1785858459.run')).toBe('1785858459');
    expect(runIdFromFileName('1785858459.run.backup')).toBe('1785858459');
  });
});

describe('fixture 1785858459 (Defect A6 loss to The Insatiable)', () => {
  const run = loadFixture('1785858459');

  it('normalizes the run header', () => {
    expect(run.id).toBe('1785858459');
    expect(run.player.character).toBe('CHARACTER.DEFECT');
    expect(run.ascension).toBe(6);
    expect(run.win).toBe(false);
    expect(run.abandoned).toBe(false);
    expect(run.killedByEncounter).toBe('ENCOUNTER.THE_INSATIABLE_BOSS');
  });

  it('walks 33 nodes across 2 acts with global 1-based floors', () => {
    expect(run.nodes).toHaveLength(33);
    expect(run.actsEntered).toBe(2);
    expect(run.nodes[0].floor).toBe(1);
    expect(run.nodes[32].floor).toBe(33);
    expect(run.nodes[32].act).toBe(2);
  });

  it('records node stats as post-node state', () => {
    const final = run.nodes[32].stats;
    expect(final.hp).toBe(0);
    expect(final.maxHp).toBe(92);
    // floor 12: the biggest non-death damage spike
    expect(run.nodes[11].floor).toBe(12);
    expect(run.nodes[11].stats.damageTaken).toBe(47);
  });

  it('derives entry HP from the previous node post-state', () => {
    // entered the death fight at 52/92 ≈ 56.5%
    expect(entryHpPct(run, 32)).toBeCloseTo(52 / 92, 5);
    // node 1 has no meaningful entry HP
    expect(entryHpPct(run, 0)).toBeUndefined();
  });

  it('finds the death node with its boss room', () => {
    const death = deathNode(run);
    expect(death).toBeDefined();
    expect(death!.floor).toBe(33);
    expect(hasRoom(death!, 'boss')).toBe(true);
    expect(entryGold(death!)).toBe(53);
  });

  it('sees the act-1 boss fight (The Kin) as a boss node too', () => {
    expect(hasRoom(run.nodes[16], 'boss')).toBe(true);
    expect(entryHpPct(run, 16)).toBeCloseTo(0.48, 2);
  });
});

describe('fixture 1776190046 (Defect win)', () => {
  const run = loadFixture('1776190046');

  it('normalizes a 3-act win', () => {
    expect(run.win).toBe(true);
    expect(run.actsEntered).toBe(3);
    expect(run.nodes).toHaveLength(48);
    expect(deathNode(run)).toBeUndefined();
  });

  it('reconstructs shop entry gold from the node deltas', () => {
    const shop = run.nodes[14]; // floor 15
    expect(hasRoom(shop, 'shop')).toBe(true);
    expect(entryGold(shop)).toBe(327);
    expect(shop.stats.cardsRemoved).toHaveLength(1);
  });
});

describe('fixture 1774194024 (Ironclad A1 elite death)', () => {
  const run = loadFixture('1774194024');

  it('handles an act-1 elite death', () => {
    expect(run.killedByEncounter).toBe('ENCOUNTER.PHROG_PARASITE_ELITE');
    expect(run.actsEntered).toBe(1);
    const death = deathNode(run);
    expect(death!.floor).toBe(6);
    expect(hasRoom(death!, 'elite')).toBe(true);
    expect(entryHpPct(run, 5)).toBeCloseTo(0.75, 5);
  });
});

describe('co-op stats join', () => {
  const statsRow = (playerId: number | string, hp: number, gold: number) => ({
    player_id: playerId,
    current_hp: hp,
    max_hp: 80,
    current_gold: gold,
    damage_taken: 5,
    hp_healed: 0,
  });

  it('never attributes a partner-only stats row to the primary player', () => {
    const coop = {
      schema_version: 9,
      start_time: 1_770_000_000,
      win: false,
      players: [
        { id: '101', character: 'CHARACTER.IRONCLAD' },
        { id: 202, character: 'CHARACTER.SILENT' },
      ],
      map_point_history: [
        [
          // node 1: only the partner's row present → primary must get emptyStats
          { map_point_type: 'monster', player_stats: [statsRow(202, 33, 999)] },
          // node 2: primary row present, but keyed by NUMBER while players[0].id is a string
          { map_point_type: 'monster', player_stats: [statsRow(101, 60, 100), statsRow(202, 33, 999)] },
        ],
      ],
    };
    const run = normalizeRun(coop, '1770000000.run');
    expect(run.coop).toBe(true);
    expect(run.nodes[0].stats.hp).toBe(0);
    expect(run.nodes[0].stats.gold).toBe(0);
    expect(run.nodes[1].stats.hp).toBe(60);
    expect(run.nodes[1].stats.gold).toBe(100);
  });

  it('solo files still fall back to the only stats row when ids do not match', () => {
    const solo = {
      schema_version: 9,
      start_time: 1_770_000_000,
      win: false,
      players: [{ id: 1, character: 'CHARACTER.IRONCLAD' }],
      map_point_history: [[{ map_point_type: 'monster', player_stats: [statsRow(99, 40, 10)] }]],
    };
    const run = normalizeRun(solo, '1770000001.run');
    expect(run.nodes[0].stats.hp).toBe(40);
    expect(run.nodes[0].stats.gold).toBe(10);
  });
});

describe('abandoned runs', () => {
  const run = loadFixture('1778528032');

  it('marks the run abandoned and yields no death node', () => {
    expect(run.abandoned).toBe(true);
    expect(deathNode(run)).toBeUndefined();
  });

  it('completedRuns excludes abandoned runs', () => {
    const all = FIXTURE_NAMES.map(loadFixture);
    const completed = completedRuns(all);
    expect(all).toHaveLength(6);
    expect(completed).toHaveLength(5);
    expect(completed.some((r) => r.id === '1778528032')).toBe(false);
  });
});
