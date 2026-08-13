/**
 * Dashboard aggregations added on top of the audited computeStats totals.
 * Existing fields must not change; new fields are counted from fixtures.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeRun } from '../src/lib/normalize';
import { computeStats } from '../src/lib/stats';
import type { NormalizedRun } from '../src/lib/types';

function loadFixture(name: string): NormalizedRun {
  const path = fileURLToPath(new URL(`./fixtures/${name}.run`, import.meta.url));
  return normalizeRun(JSON.parse(readFileSync(path, 'utf8')), `${name}.run`);
}

const win1779 = loadFixture('1779248265');
const win1776 = loadFixture('1776190046');
const loss1785 = loadFixture('1785858459');
const loss1774 = loadFixture('1774194024');
const abandoned = loadFixture('1778528032');
const fixtures = [win1779, win1776, loss1785, loss1774, abandoned];

describe('computeStats dashboard extras', () => {
  const stats = computeStats(fixtures);

  it('counts shops, removals, upgrades, and rest choices from the same node walk', () => {
    let shops = 0,
      removed = 0,
      upgraded = 0,
      smith = 0,
      heal = 0;
    for (const run of fixtures) {
      for (const node of run.nodes) {
        shops += node.rooms.filter((r) => r.roomType === 'shop').length;
        removed += node.stats.cardsRemoved.length;
        upgraded += node.stats.cardsUpgraded.filter(Boolean).length;
        smith += node.stats.restChoices.filter((c) => c === 'SMITH').length;
        heal += node.stats.restChoices.filter((c) => c === 'HEAL').length;
      }
    }
    expect(stats.shopVisits).toBe(shops);
    expect(stats.cardsRemoved).toBe(removed);
    expect(stats.cardsUpgraded).toBe(upgraded);
    expect(stats.restChoices.find((r) => r.choice === 'SMITH')?.count ?? 0).toBe(smith);
    expect(stats.restChoices.find((r) => r.choice === 'HEAL')?.count ?? 0).toBe(heal);
    expect(stats.shopVisits).toBeGreaterThan(0);
  });

  it('lists non-starter top picks and an ascension record covering every run', () => {
    expect(stats.topPicks.length).toBeGreaterThan(0);
    expect(stats.topPicks.every((p) => !/^CARD\.(STRIKE|DEFEND)(_[A-Z_]+)?$/.test(p.id))).toBe(true);
    const ascRuns = stats.byAscension.reduce((a, r) => a + r.runs, 0);
    expect(ascRuns).toBe(fixtures.length);
    expect(stats.byAscension.map((a) => a.ascension)).toEqual(
      [...stats.byAscension.map((a) => a.ascension)].sort((x, y) => x - y),
    );
  });

  it('does not change the audited headline totals on this fixture set', () => {
    expect(stats.totalRuns).toBe(5);
    expect(stats.wins).toBe(2);
    expect(stats.abandoned).toBe(1);
    expect(stats.eliteFights).toBe(
      fixtures.reduce((n, r) => n + r.nodes.reduce((a, node) => a + node.rooms.filter((x) => x.roomType === 'elite').length, 0), 0),
    );
  });
});
