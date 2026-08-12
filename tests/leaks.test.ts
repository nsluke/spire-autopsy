/**
 * leaks.test.ts — detector correctness.
 *
 * The 6 fixture runs alone sit below every detector threshold, so the tests
 * build larger corpora by cloning fixtures in memory (fresh id + startTime,
 * optionally perturbed). All expected numbers below are hand-derived from the
 * fixture facts:
 *   win  1779248265  Silent A6 win,  boss entries 94%/74%/99%, 3 rich shops (2 skipped), 2 act-1 elites, 9 starters, 0 act-1 removals
 *   win  1776190046  Defect A0 win,  boss entries 63%/76%/100%, 3 rich shops (1 skipped), 1 act-1 elite, 4 starters, 2 act-1 removals
 *   loss 1785858459  Defect A6 loss, boss entries 48%/57% (death at 57%), 4 rich shops (3 skipped), 2 act-1 elites, 4 starters, 2 act-1 removals, 53 gold at death
 *   loss 1774194024  Ironclad A1 elite death, 463 gold at death, no boss fights
 *   loss 1778212793  Necrobinder A3 death holding 3 potions, none used in the death fight
 *   1778528032       abandoned at Neow
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeRun } from '../src/lib/normalize';
import { detectLeaks } from '../src/lib/leaks';
import { bossEntryLeak } from '../src/lib/leaks/bossEntry';
import { removalDisciplineLeak, STARTER_CARD_RE } from '../src/lib/leaks/removals';
import { climbSummary } from '../src/lib/climb';
import { eliteAppetite, goldAtDeath, potionHoarding } from '../src/lib/leaks/observations';
import type { NormalizedRun } from '../src/lib/types';

function loadFixture(name: string): NormalizedRun {
  const path = fileURLToPath(new URL(`./fixtures/${name}.run`, import.meta.url));
  return normalizeRun(JSON.parse(readFileSync(path, 'utf8')), `${name}.run`);
}

const win1779 = loadFixture('1779248265');
const win1776 = loadFixture('1776190046');
const loss1785 = loadFixture('1785858459');
const loss1774 = loadFixture('1774194024');
const loss1778 = loadFixture('1778212793');
const abandoned = loadFixture('1778528032');
const fixtures = [win1779, win1776, loss1785, loss1774, loss1778, abandoned];

let cloneCounter = 0;
function clones(run: NormalizedRun, n: number, mutate?: (r: NormalizedRun) => void): NormalizedRun[] {
  return Array.from({ length: n }, () => {
    cloneCounter += 1;
    const copy = JSON.parse(JSON.stringify(run)) as NormalizedRun;
    copy.id = `${run.id}-c${cloneCounter}`;
    copy.startTime = run.startTime + cloneCounter * 3600;
    mutate?.(copy);
    return copy;
  });
}

/** Raise the pre-death node's HP so the death fight is entered at 80/92 ≈ 87% (healthy). */
const healthyDeathEntry = (r: NormalizedRun) => {
  r.nodes[31].stats.hp = 80;
};

/**
 * 30 completed runs:
 *   7× Silent A6 win, 7× Defect A0 win,
 *   10× Defect A6 loss (death entered low), 4× same loss but death entered healthy,
 *   2× Ironclad A1 loss.
 * Boss fights: low = 10×2 + 4×1 = 24 (10 deaths), healthy = 14×3 + 4×1 = 46 (4 deaths).
 */
const corpusMain = [
  ...clones(win1779, 7),
  ...clones(win1776, 7),
  ...clones(loss1785, 10),
  ...clones(loss1785, 4, healthyDeathEntry),
  ...clones(loss1774, 2),
];

describe('gating (applicable=false below thresholds)', () => {
  it('every detector declines politely on the 5-completed-run fixture corpus', () => {
    const results = detectLeaks(fixtures);
    expect(results).toHaveLength(8); // 3 leak detectors + 5 observations (ascension retired to climb.ts)
    for (const r of results) {
      expect(r.applicable).toBe(false);
      expect(r.body.length).toBeGreaterThan(0);
      expect(r.receiptLines).toHaveLength(0);
      expect(r.expectedWinsLost).toBe(0);
    }
    expect(results.slice(0, 3).every((r) => r.tier === 'leak')).toBe(true);
    expect(results.slice(3).every((r) => r.tier === 'observation')).toBe(true);
  });

  it('boss-entry-hp needs 20 completed runs', () => {
    const nineteen = [...clones(win1779, 10), ...clones(loss1785, 9)];
    expect(bossEntryLeak(nineteen).applicable).toBe(false);
    expect(bossEntryLeak([...nineteen, ...clones(loss1785, 1)]).applicable).toBe(true);
  });

  it('abandoned runs never count toward thresholds or numbers', () => {
    const withAbandoned = [...corpusMain, ...clones(abandoned, 40)];
    const base = detectLeaks(corpusMain).find((l) => l.id === 'boss-entry-hp')!;
    const padded = detectLeaks(withAbandoned).find((l) => l.id === 'boss-entry-hp')!;
    expect(padded.receiptLines).toEqual(base.receiptLines);
    expect(padded.dumbbell).toEqual(base.dumbbell);
  });
});

describe('boss-entry-hp', () => {
  const leak = bossEntryLeak(corpusMain);

  it('computes low vs healthy death rates with exact denominators', () => {
    expect(leak.applicable).toBe(true);
    expect(leak.receiptLines).toEqual([
      'boss fights entered under 60% HP: 10 deaths / 24 fights (42%)',
      'boss fights entered at 60%+ HP: 4 deaths / 46 fights (9%)',
    ]);
    expect(leak.dumbbell).toEqual({
      label: 'Boss-fight death rate',
      winValue: 8.7,
      lossValue: 41.7,
      format: 'pct',
      sampleLabel: '70 boss fights',
      // entry-HP cohorts, not win/loss cohorts — the chart must say so
      winLabel: 'entered 60%+',
      lossLabel: 'entered <60%',
    });
  });

  it('shows the ratio badge only with 20+ fights on both sides', () => {
    expect(leak.ratioBadge).toBe('4.8× deadlier');
    // 10 low fights only → no badge even though the leak may fire
    const small = [...clones(win1779, 15), ...clones(loss1785, 5)];
    const smallLeak = bossEntryLeak(small);
    expect(smallLeak.ratioBadge).toBeUndefined();
  });

  it('receipts the 5 most recent low-entry deaths with names and entry %', () => {
    expect(leak.runReceipts).toHaveLength(5);
    for (const r of leak.runReceipts) {
      expect(r.label).toContain('· Defect A6 · entered The Insatiable at 57%');
      expect(r.runId).toContain('1785858459-c');
    }
    // most recent first
    const times = leak.runReceipts.map((r) => Number(r.runId.split('-c')[1]));
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('reports a clean bill of health when no boss fight has ended a run', () => {
    // 20 completed runs, entries on both sides of 60%, zero boss deaths.
    const allWins = [
      ...clones(win1779, 10),
      ...clones(loss1785, 10, (r) => {
        r.win = true;
      }),
    ];
    const res = bossEntryLeak(allWins);
    expect(res.applicable).toBe(true);
    expect(res.healthy).toBe(true);
    expect(res.expectedWinsLost).toBe(0);
  });

  it('reports healthy when low entries die no more often than healthy ones', () => {
    // all 10 boss deaths happen on the HEALTHY-entry side; low entries survive.
    const corpus = [...clones(win1779, 10), ...clones(loss1785, 10, healthyDeathEntry)];
    const res = bossEntryLeak(corpus);
    expect(res.applicable).toBe(true);
    expect(res.healthy).toBe(true);
  });

  it('ranks by the documented heuristic and carries strength + confound note', () => {
    // freq 24/30 × delta (10/24 − 4/46) × strong(1) × 100
    expect(leak.expectedWinsLost).toBeCloseTo(26.38, 2);
    expect(leak.strength).toBe('strong');
    expect(leak.confoundNote).toBeTruthy();
    expect(leak.drill?.title).toBeTruthy();
  });
});

describe('removal-discipline', () => {
  const leak = removalDisciplineLeak(corpusMain);

  it('uses a strict starter-card pattern (verified against fixture decks)', () => {
    expect(STARTER_CARD_RE.test('CARD.STRIKE_SILENT')).toBe(true);
    expect(STARTER_CARD_RE.test('CARD.STRIKE_DEFECT')).toBe(true);
    expect(STARTER_CARD_RE.test('CARD.DEFEND_IRONCLAD')).toBe(true);
    expect(STARTER_CARD_RE.test('CARD.STRIKE')).toBe(true);
    expect(STARTER_CARD_RE.test('CARD.POMMEL_STRIKE')).toBe(false);
    expect(STARTER_CARD_RE.test('CARD.FOCUSED_STRIKE')).toBe(false);
    expect(STARTER_CARD_RE.test('CARD.DEFENDER')).toBe(false);
  });

  it('compares act-1 removals and starters over act-2+ runs only', () => {
    expect(leak.applicable).toBe(true);
    expect(leak.receiptLines[0]).toBe(
      'act-1 removals per run (act-2+ runs only): 1 across 14 wins vs 2 across 14 losses',
    );
    expect(leak.dumbbell).toEqual({
      label: 'Starter cards left in final deck',
      winValue: 6.5,
      lossValue: 4,
      format: 'count',
      sampleLabel: '14 wins vs 14 act-2+ losses',
    });
  });

  it('counts rich shop visits left without a removal', () => {
    // per clone: loss1785 4 rich shops / 3 skipped ×14; wins 3 rich each, 2 and 1 skipped ×7
    expect(leak.receiptLines[1]).toBe('rich shop visits (entered with 100+ gold) with no removal: 63/98 (64%)');
    expect(leak.runReceipts).toHaveLength(5);
    for (const r of leak.runReceipts) {
      expect(r.label).toMatch(/left a shop holding \d+ gold, no removal$/);
    }
  });

  it('names its confounder and prescribes the shop drill', () => {
    expect(leak.confoundNote).toContain('act-2+');
    expect(leak.drill?.body).toContain('under 100 gold');
  });
});

describe('the climb (replaces the retired ascension-pacing detector)', () => {
  const leaks = detectLeaks(corpusMain);
  const climb = climbSummary(corpusMain, leaks);
  const completed = corpusMain.filter((r) => !r.abandoned);
  const winAscs = completed.filter((r) => r.win).map((r) => r.ascension);

  it('frames the frontier as the highest ascension beaten, target one above', () => {
    expect(climb.frontier).toBe(Math.max(...winAscs));
    expect(climb.target).toBe(climb.frontier! + 1);
    expect(climb.targetAttempts).toBe(completed.filter((r) => r.ascension === climb.target).length);
    expect(climb.aboveFrontierAttempts).toBeGreaterThanOrEqual(climb.targetAttempts);
    expect(climb.recentPushShare).toBeGreaterThanOrEqual(0);
    expect(climb.recentPushShare).toBeLessThanOrEqual(1);
  });

  it('pairs the climb with the top applicable leak as the lever', () => {
    const topLeak = leaks.find((l) => l.tier === 'leak' && l.applicable && !l.healthy);
    expect(climb.leverTitle).toBe(topLeak?.title);
  });

  it('handles a winless corpus without inventing a frontier', () => {
    const winless = completed.filter((r) => !r.win);
    const c = climbSummary(winless, detectLeaks(winless));
    expect(c.frontier).toBeNull();
    expect(c.target).toBe(0);
  });

  it('never appears among leak detectors (climbing is a goal, not a mistake)', () => {
    expect(leaks.some((l) => l.id === 'ascension-pacing')).toBe(false);
  });
});

describe('observations', () => {
  it('elite-appetite compares act-1 elites among act-2+ runs', () => {
    const obs = eliteAppetite(corpusMain);
    expect(obs.applicable).toBe(true);
    expect(obs.tier).toBe('observation');
    expect(obs.dumbbell).toEqual({
      label: 'Act-1 elites fought',
      winValue: 1.5,
      lossValue: 2,
      format: 'count',
      sampleLabel: '14 wins vs 14 act-2+ losses',
    });
  });

  it('potion-hoarding counts deaths holding potions and quiet death fights', () => {
    const corpus = [...corpusMain, ...clones(loss1778, 5)];
    const obs = potionHoarding(corpus);
    expect(obs.applicable).toBe(true);
    expect(obs.receiptLines).toEqual([
      'deaths with unused potions still held: 5/21',
      'death fights where no potion was used: 7/21 (33%)',
    ]);
    expect(obs.runReceipts.length).toBeGreaterThan(0);
    expect(obs.runReceipts[0].label).toContain('died to Cultists holding 3 potions');
  });

  it('gold-at-death reports a clean bill of health when the median is modest', () => {
    // deaths: 14×53 gold + 2×463 gold → median 53
    const obs = goldAtDeath(corpusMain);
    expect(obs.applicable).toBe(true);
    expect(obs.healthy).toBe(true); // ran and passed — must not read as "locked"
    expect(obs.body).toContain('53');
  });

  it('gold-at-death fires when the median exceeds 150', () => {
    const corpus = [
      ...clones(win1779, 7),
      ...clones(win1776, 7),
      ...clones(loss1785, 10),
      ...clones(loss1785, 4, healthyDeathEntry),
      ...clones(loss1774, 16), // deaths at 463 gold now dominate: median of 14×53 + 16×463 = 463
    ];
    const obs = goldAtDeath(corpus);
    expect(obs.applicable).toBe(true);
    expect(obs.receiptLines).toEqual([
      'median gold entering the death fight: 463',
      'deaths carrying more than 150 gold: 16/30',
    ]);
    expect(obs.runReceipts[0].label).toMatch(/died carrying 463 gold$/);
  });
});

describe('detectLeaks ordering', () => {
  it('returns leaks ranked by expectedWinsLost, observations after', () => {
    const results = detectLeaks(corpusMain);
    expect(results).toHaveLength(8); // 3 leak detectors + 5 observations (ascension retired to climb.ts)
    expect(results.slice(0, 3).map((r) => r.tier)).toEqual(['leak', 'leak', 'leak']);
    expect(results.slice(3).every((r) => r.tier === 'observation')).toBe(true);
    expect(results[0].id).toBe('boss-entry-hp');
    expect(results[0].expectedWinsLost).toBeGreaterThanOrEqual(results[1].expectedWinsLost);
  });
});
