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
import { ASCENSION_CAP, climbSummary, latestVictory, wallLine } from '../src/lib/climb';
import { eliteAppetite, eventTax, goldAtDeath, restDiscipline } from '../src/lib/leaks/observations';
import { beltAtLastFight, potionHoarding } from '../src/lib/leaks/potions';
import { act1Bar, deckAdditions, deckBloatLeak } from '../src/lib/leaks/deckBloat';
import { bossEntries, upgradeTempoLeak } from '../src/lib/leaks/upgradeTempo';
import { fightPacing, medianHallwayTurns } from '../src/lib/leaks/fightPacing';
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

/** Registered detector counts — the tier split detectLeaks guarantees. */
const LEAK_DETECTORS = 7;
const OBSERVATION_DETECTORS = 5;

describe('gating (applicable=false below thresholds)', () => {
  it('every detector declines politely on the 5-completed-run fixture corpus', () => {
    const results = detectLeaks(fixtures);
    expect(results).toHaveLength(LEAK_DETECTORS + OBSERVATION_DETECTORS);
    for (const r of results) {
      expect(r.applicable).toBe(false);
      expect(r.body.length).toBeGreaterThan(0);
      expect(r.receiptLines).toHaveLength(0);
      expect(r.expectedWinsLost).toBe(0);
    }
    expect(results.slice(0, LEAK_DETECTORS).every((r) => r.tier === 'leak')).toBe(true);
    expect(results.slice(LEAK_DETECTORS).every((r) => r.tier === 'observation')).toBe(true);
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

  it('counts only the rich shops where real gold was spent on something else', () => {
    // The act-stepped bar (100/150/200) and the 75-gold spend test cut the
    // denominator to shops where the removal was plainly affordable: a visit
    // where the player held gold but barely spent is never an accusation.
    expect(leak.receiptLines[1]).toBe('rich shop visits where 75+ gold was spent, none on removal: 49/70 (70%)');
    expect(leak.runReceipts).toHaveLength(5);
    for (const r of leak.runReceipts) {
      expect(r.label).toMatch(/spent \d+ gold at the shop, none on removal$/);
    }
  });

  it('never counts a light-spend visit against the player', () => {
    // Same gold walked in with (entry gold is preserved), but almost none of
    // it spent and nothing removed: the removal may not have been on offer or
    // affordable, so these visits stay in the denominator and out of the count.
    const browsed = (r: NormalizedRun) => {
      for (const node of r.nodes) {
        if (!node.rooms.some((x) => x.roomType === 'shop')) continue;
        node.stats.gold += node.stats.goldSpent - 10;
        node.stats.goldSpent = 10;
        node.stats.cardsRemoved = [];
      }
    };
    const res = removalDisciplineLeak([...clones(win1779, 10, browsed), ...clones(loss1785, 10, browsed)]);
    expect(res.receiptLines[1]).toBe('rich shop visits where 75+ gold was spent, none on removal: 0/50 (0%)');
    expect(res.runReceipts).toHaveLength(0);
  });

  it('names its confounder and prescribes the spend-first drill', () => {
    expect(leak.confoundNote).toContain('act-2+');
    expect(leak.confoundNote).toContain('not counted against you');
    expect(leak.drill?.body).toContain('75+ gold');
  });
});

describe('the climb (per-character walls; replaces the retired ascension-pacing detector)', () => {
  const leaks = detectLeaks(corpusMain);
  const climb = climbSummary(corpusMain, leaks);
  const walls = Object.fromEntries(climb.walls.map((w) => [w.character, w]));

  it('gives each character a wall: the next unbeaten level, never below current play', () => {
    // Silent: 7 A6 wins → frontier 6, wall A7, untried.
    expect(walls['CHARACTER.SILENT']).toMatchObject({ frontier: 6, target: 7, attempts: 0 });
    // Defect: frontier is A0 but current play is A6 — the wall must NOT point down to A1.
    expect(walls['CHARACTER.DEFECT']).toMatchObject({ frontier: 0, target: 6, attempts: 14 });
    // Winless Ironclad playing A1: the wall is the level being played, not A0.
    expect(walls['CHARACTER.IRONCLAD']).toMatchObject({ frontier: null, target: 1, attempts: 2 });
  });

  it('never points a wall below any level the character has played (never-settle invariant)', () => {
    for (const wall of climb.walls) {
      const characterRuns = corpusMain.filter((r) => !r.abandoned && r.player.character === wall.character);
      const highestPlayed = Math.max(...characterRuns.map((r) => r.ascension));
      expect(wall.target).toBeGreaterThanOrEqual(highestPlayed);
      if (!wall.summited) expect(wall.target).toBe(Math.max((wall.frontier ?? -1) + 1, highestPlayed));
    }
  });

  it('one low-level detour run cannot drag the wall down', () => {
    // 5 winless A8 attempts, then a casual A1 run as the most recent — the
    // wall must stay A8, not follow the detour.
    const highAttempts = clones(loss1774, 5, (r) => {
      r.ascension = 8;
    });
    const detour = clones(loss1774, 1)[0]; // stays A1, latest startTime
    detour.startTime = Math.max(...highAttempts.map((r) => r.startTime)) + 999_999;
    const c = climbSummary([...highAttempts, detour], []);
    expect(c.walls[0]).toMatchObject({ character: 'CHARACTER.IRONCLAD', target: 8, attempts: 5 });
  });

  it('data above the cap raises the effective cap instead of breaking the wall', () => {
    // A game patch can raise the ascension ceiling before our constant moves.
    const aboveCap = clones(loss1785, 3, (r) => {
      r.ascension = ASCENSION_CAP + 2;
    });
    const c = climbSummary(aboveCap, []);
    expect(c.walls[0]).toMatchObject({ target: ASCENSION_CAP + 2, summited: false, attempts: 3 });
    const withWin = [
      ...aboveCap,
      ...clones(win1776, 1, (r) => {
        r.ascension = ASCENSION_CAP + 2;
      }),
    ];
    const summit = climbSummary(withWin, []).walls.find((w) => w.character === 'CHARACTER.DEFECT')!;
    expect(summit.summited).toBe(true);
    expect(summit.capRecord).toEqual({ wins: 1, runs: 4 });
  });

  it('zero-floor losses count as attempts but never claim an act of death', () => {
    const ghost = clones(loss1774, 1, (r) => {
      r.actsEntered = 0;
    });
    const c = climbSummary(ghost, []);
    expect(c.walls[0].attempts).toBe(1);
    expect(c.walls[0].deathsByAct).toEqual([0, 0, 0]);
    expect(wallLine(c.walls[0])).not.toContain('act');
  });

  it('marks the most recently played character as the active wall', () => {
    expect(climb.active?.character).toBe('CHARACTER.DEFECT'); // loss clones carry the latest startTimes
  });

  it('diagnoses where wall attempts die and who kills them', () => {
    const defect = walls['CHARACTER.DEFECT'];
    expect(defect.deathsByAct).toEqual([0, 14, 0]); // loss1785 dies in act 2
    expect(defect.topKiller).toEqual({ encounter: 'ENCOUNTER.THE_INSATIABLE_BOSS', deaths: 14 });
    expect(defect.deepestAct).toBe(2);
    expect(wallLine(defect)).toContain('every one has died in act 2');
    expect(wallLine(walls['CHARACTER.SILENT'])).toBe('Fresh ground — no attempts yet.');
  });

  it('switches to consistency framing only at the cap, and never invents a level above it', () => {
    const capped = clones(win1779, 3, (r) => {
      r.ascension = ASCENSION_CAP;
    });
    const c = climbSummary(capped, []);
    const wall = c.walls[0];
    expect(wall).toMatchObject({ summited: true, target: ASCENSION_CAP, frontier: ASCENSION_CAP });
    expect(wall.capRecord).toEqual({ wins: 3, runs: 3 });
    expect(wallLine(wall)).toContain('consistency');
    expect(wallLine(wall)).not.toContain(`A${ASCENSION_CAP + 1}`);
  });

  it('pairs the climb with the top applicable leak as the lever', () => {
    const topLeak = leaks.find((l) => l.tier === 'leak' && l.applicable && !l.healthy);
    expect(climb.leverTitle).toBe(topLeak?.title);
  });

  it('handles a winless corpus without inventing a frontier — the wall stays at current play', () => {
    const winless = corpusMain.filter((r) => !r.abandoned && !r.win);
    const c = climbSummary(winless, detectLeaks(winless));
    const defect = c.walls.find((w) => w.character === 'CHARACTER.DEFECT')!;
    expect(defect.frontier).toBeNull();
    expect(defect.target).toBe(6); // still coaching the level being played, never A0
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

  it('elite-appetite conditions the advice on whether the deck could kill them', () => {
    // Three extra attacks drafted before the floor-6 elite puts these runs on
    // the ready side of the same bar damage-drafting uses.
    const armed = (r: NormalizedRun) => {
      r.nodes[1].stats.cardsGained.push(
        { id: 'CARD.CLAW', upgradeLevel: 0 },
        { id: 'CARD.BEAM_CELL', upgradeLevel: 0 },
        { id: 'CARD.STRIKE_DEFECT', upgradeLevel: 0 },
      );
    };
    const obs = eliteAppetite([...clones(win1776, 10, armed), ...clones(loss1785, 10)]);
    expect(obs.receiptLines[1]).toBe(
      'first act-1 elite met with 3+ attacks drafted: 100% win rate across 10 runs vs 0% across 10 runs that met it lighter',
    );
    expect(obs.body).toContain('It is the deck that decides');
  });

  it('gold-at-death reports a clean bill of health when the median is modest', () => {
    // deaths: 14×53 gold + 2×463 gold → median 53
    const obs = goldAtDeath(corpusMain);
    expect(obs.applicable).toBe(true);
    expect(obs.healthy).toBe(true); // ran and passed — must not read as "locked"
    expect(obs.body).toContain('53');
  });

  it('gold-at-death judges each death against its own act’s shop money', () => {
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
      "deaths carrying the act's shop money unspent (100/150/200 by act): 16/30 (53%)",
    ]);
    expect(obs.runReceipts[0].label).toMatch(/died in act 1 carrying 463 gold$/);
    // the 53-gold act-2 deaths sit under the act-2 bar and are not counted
    expect(obs.runReceipts.every((r) => r.runId.startsWith('1774194024'))).toBe(true);
  });
});

describe('event-tax names the offenders', () => {
  it('itemizes act-1 event damage by the event that charged it', () => {
    const corpus = [...clones(loss1774, 10), ...clones(win1776, 10)];
    const obs = eventTax(corpus);
    expect(obs.applicable).toBe(true);
    expect(obs.receiptLines[2]).toBe(
      'worst offenders in act-1 deaths: Dense Vegetation 110 HP over 10 runs, Whispering Hollow 90 HP over 10 runs',
    );
    expect(obs.body).toContain('Dense Vegetation');
    expect(obs.runReceipts[0].label).toContain('(worst: Dense Vegetation, 11)');
  });
});

describe('potion-hoarding (promoted to a leak)', () => {
  /** Die at the act-2 boss with a full belt and nothing thrown. */
  const hoardingDeath = (r: NormalizedRun) => {
    r.player.potions = ['POTION.FIRE_POTION', 'POTION.BLOCK_POTION'];
    r.nodes[32].stats.potionsUsed = [];
  };

  it('reads the belt entering the last fight exactly (end belt, that node reversed)', () => {
    expect(beltAtLastFight(loss1778)).toBe(3); // died holding 3, none thrown
    expect(beltAtLastFight(loss1785)).toBe(2); // ended empty, threw 2 at the boss
    expect(beltAtLastFight(win1779)).toBe(2); // ended holding 1, threw 1 at the boss
    expect(beltAtLastFight(loss1774)).toBe(0);
  });

  it('credits a player who spends them: no gap, no hoarding deaths, no card', () => {
    const res = potionHoarding(corpusMain);
    expect(res.applicable).toBe(true);
    expect(res.healthy).toBe(true);
    expect(res.tier).toBe('leak');
    expect(res.receiptLines).toEqual([
      'elite/boss fights that got a potion: 63/98 in wins (64%) vs 42/72 in losses (58%)',
      'elite/boss deaths that entered the killing fight holding 2+ potions and threw none: 0/16',
    ]);
  });

  it('never counts a hallway death in the denominator of an elite/boss statistic', () => {
    // loss1778 died to Cultists in a monster room holding 3 potions, none
    // thrown. It is NOT an elite/boss death, so it belongs on neither side of
    // that fraction — a player who remembers it must not be able to read the
    // line as "you had 6 such deaths and I counted 0 of them".
    expect(beltAtLastFight(loss1778)).toBe(3);
    expect(loss1778.nodes[loss1778.nodes.length - 1].stats.potionsUsed).toHaveLength(0);
    const corpus = [
      ...clones(win1779, 7),
      ...clones(win1776, 7),
      ...clones(loss1785, 10, hoardingDeath),
      ...clones(loss1778, 6),
    ];
    const res = potionHoarding(corpus);
    // 16 deaths in the corpus, but only the 10 boss deaths are judged here.
    expect(corpus.filter((r) => !r.win && !r.abandoned)).toHaveLength(16);
    expect(res.receiptLines[1]).toBe(
      'elite/boss deaths that entered the killing fight holding 2+ potions and threw none: 10/10',
    );
  });

  it('fires on deaths that arrived at the boss with a full belt', () => {
    const corpus = [
      ...clones(win1779, 7),
      ...clones(win1776, 7),
      ...clones(loss1785, 14, hoardingDeath),
      ...clones(loss1774, 2),
    ];
    const res = potionHoarding(corpus);
    expect(res.healthy).toBeFalsy();
    expect(res.receiptLines).toEqual([
      'elite/boss fights that got a potion: 63/98 in wins (64%) vs 28/72 in losses (39%)',
      // all 16 deaths here ARE elite/boss deaths (14 at the boss, 2 to an elite)
      'elite/boss deaths that entered the killing fight holding 2+ potions and threw none: 14/16',
    ]);
    expect(res.dumbbell).toEqual({
      label: 'Elite/boss fights that got a potion',
      winValue: 64.3,
      lossValue: 38.9,
      format: 'pct',
      sampleLabel: '98 fights in wins vs 72 in losses',
    });
    expect(res.runReceipts).toHaveLength(5);
    expect(res.runReceipts[0].label).toContain('died to The Insatiable holding 2 potions, none thrown');
    expect(res.runReceipts[0].enemyIds).toEqual(['ENCOUNTER.THE_INSATIABLE_BOSS']);
    expect(res.confoundNote).toBeTruthy();
    expect(res.drill?.title).toBe('Throw them at the boss');
    // 16 of 30 runs leave most hard fights unarmed × the measured win-rate gap
    expect(res.expectedWinsLost).toBeCloseTo(32, 1);
  });
});

describe('deck-bloat', () => {
  const leak = deckBloatLeak(corpusMain);

  it('counts unique deck additions, never double-counting a pick logged as a gain', () => {
    // cardsGained is a superset of the picks; id + floor-added collapses them.
    expect(deckAdditions(win1779, 1)).toBe(6);
    expect(deckAdditions(win1776, 1)).toBe(9);
    expect(deckAdditions(loss1785, 1)).toBe(12);
    // 6 starters left in the final deck + 22 additions = the 28-card deck
    expect(deckAdditions(win1776, 3) + win1776.player.deck.filter((c) => c.floorAdded === 1).length).toBe(
      win1776.player.deck.length,
    );
  });

  it('compares act-1 additions across act-matched runs only', () => {
    expect(leak.applicable).toBe(true);
    expect(leak.receiptLines).toEqual([
      'cards added by the end of act 1 (act-2+ runs only): 7.5 across 14 wins vs 12 across 14 losses',
      'act-1 drafts over the 8-card bar: 21/28 (75%)',
    ]);
    expect(leak.dumbbell).toEqual({
      label: 'Cards added by the end of act 1',
      winValue: 7.5,
      lossValue: 12,
      format: 'count',
      sampleLabel: '14 wins vs 14 act-2+ losses',
    });
    // the act-1 death never entered the comparison
    expect(leak.runReceipts.every((r) => r.runId.startsWith('1785858459'))).toBe(true);
    expect(leak.drill?.body).toContain('skip');
  });

  it('coaches the skip and ranks on the measured win-rate gap', () => {
    // 75% of act-2+ runs are over the bar × (100% lean win rate − 33% bloated)
    expect(leak.expectedWinsLost).toBeCloseTo(30, 1);
    expect(leak.strength).toBe('moderate');
    expect(leak.confoundNote).toContain('cleared act 1');
  });

  it('stays quiet when losing decks are no fatter than winning ones', () => {
    const res = deckBloatLeak([...clones(loss1785, 15, (r) => (r.win = true)), ...clones(win1776, 15, (r) => (r.win = false))]);
    expect(res.applicable).toBe(true);
    expect(res.healthy).toBe(true);
  });
});

describe('upgrade-tempo', () => {
  const leak = upgradeTempoLeak(corpusMain);

  it('banks upgrades in visit order and marks entries below the act bar', () => {
    expect(bossEntries(win1779).map((e) => [e.act, e.banked, e.short])).toEqual([
      [1, 4, false],
      [2, 6, false],
      [3, 8, true], // 8 banked, act-3 bar is 9
    ]);
    expect(bossEntries(loss1785).map((e) => [e.act, e.banked, e.short, e.died])).toEqual([
      [1, 1, true, false],
      [2, 2, true, true],
    ]);
    expect(bossEntries(loss1774)).toHaveLength(0);
  });

  it('compares boss-fight death rates either side of the bar', () => {
    expect(leak.applicable).toBe(true);
    expect(leak.receiptLines).toEqual([
      'boss fights entered under the upgrade bar: 14 deaths / 56 fights (25%)',
      'boss fights entered at or above it: 0 deaths / 14 fights (0%)',
      'upgrades banked at the boss door: 2.6 avg when short vs 5 avg when stocked',
    ]);
    expect(leak.dumbbell?.winLabel).toBe('at the bar'); // not a win/loss cohort
    expect(leak.dumbbell?.lossLabel).toBe('under the bar');
    expect(leak.ratioBadge).toBeUndefined(); // only 14 fights on the stocked side
    expect(leak.runReceipts[0].label).toContain('met The Insatiable with 2 upgrades banked, needed 6');
    expect(leak.expectedWinsLost).toBeCloseTo(28, 1); // 56/30 short entries × 25pp × moderate
  });

  it('credits a player who always arrives stocked', () => {
    const smithed = clones(win1779, 20, (r) => {
      r.nodes[1].stats.cardsUpgraded = ['CARD.A', 'CARD.B', 'CARD.C', 'CARD.D', 'CARD.E'];
      r.nodes[2].stats.cardsUpgraded = ['CARD.F', 'CARD.G', 'CARD.H', 'CARD.I'];
    });
    const res = upgradeTempoLeak(smithed);
    expect(res.applicable).toBe(true);
    expect(res.healthy).toBe(true);
  });
});

describe('fight-pacing', () => {
  const obs = fightPacing(corpusMain);

  it('reads turnsTaken from act-1/2 hallway fights only', () => {
    expect(medianHallwayTurns(win1776)).toBe(3);
    expect(medianHallwayTurns(loss1774)).toBe(5);
    expect(obs.tier).toBe('observation');
    expect(obs.applicable).toBe(true);
    expect(obs.receiptLines).toEqual([
      'median turns per act-1/2 hallway fight: 4 across 140 fights in wins vs 4 across 116 in losses',
      'hallway fights running over 4 turns: 10% in wins vs 28% in losses',
    ]);
    expect(obs.dumbbell).toEqual({
      label: 'Hallway fights over 4 turns',
      winValue: 10,
      lossValue: 27.6,
      format: 'pct',
      sampleLabel: '140 fights in wins vs 116 in losses',
    });
    expect(obs.runReceipts[0].label).toMatch(/\d+ turns to clear .+ on floor \d+$/);
    expect(obs.runReceipts[0].enemyIds?.length).toBe(1);
  });

  it('says nothing when both sides close fights at the same pace', () => {
    const brisk = clones(loss1785, 15, (r) => {
      for (const node of r.nodes) for (const room of node.rooms) if (room.turnsTaken > 0) room.turnsTaken = 3;
    });
    const res = fightPacing([...brisk, ...clones(win1776, 15)]);
    expect(res.applicable).toBe(true);
    expect(res.healthy).toBe(true);
  });
});

describe('rest-discipline (heals judged against the path actually walked)', () => {
  it('never counts a heal taken right before an elite or a boss', () => {
    const obs = restDiscipline(corpusMain);
    expect(obs.applicable).toBe(true);
    expect(obs.healthy).toBe(true); // every above-half heal in this corpus preceded real danger
    expect(obs.receiptLines).toEqual([
      'heals taken above 50% HP with no elite or boss in the next 3 nodes: 0/105 (0%)',
      'heals above 50% HP that were followed by an elite or boss (correct, not counted): 21',
    ]);
  });

  it('still flags heals taken healthy into a quiet stretch', () => {
    // Enter the floor-12 and floor-40 campfires at full HP; both are followed
    // by hallways, treasure and shops — nothing that justifies the heal.
    const looseHeals = (r: NormalizedRun) => {
      r.nodes[10].stats.hp = r.nodes[10].stats.maxHp;
      r.nodes[38].stats.hp = r.nodes[38].stats.maxHp;
    };
    const obs = restDiscipline([...clones(win1776, 15, looseHeals), ...clones(loss1785, 5)]);
    expect(obs.healthy).toBeFalsy();
    expect(obs.receiptLines[0]).toBe(
      'heals taken above 50% HP with no elite or boss in the next 3 nodes: 30/90 (33%)',
    );
    expect(obs.runReceipts).toHaveLength(5);
    expect(obs.runReceipts[0].label).toContain('nothing bigger than a hallway for 3 nodes');
  });
});

describe('detectLeaks ordering', () => {
  it('returns leaks ranked by expectedWinsLost, observations after', () => {
    const results = detectLeaks(corpusMain);
    expect(results).toHaveLength(LEAK_DETECTORS + OBSERVATION_DETECTORS);
    expect(results.slice(0, LEAK_DETECTORS).every((r) => r.tier === 'leak')).toBe(true);
    expect(results.slice(LEAK_DETECTORS).every((r) => r.tier === 'observation')).toBe(true);
    // within a tier: applicable first, then descending rank
    for (const tier of ['leak', 'observation'] as const) {
      const inTier = results.filter((r) => r.tier === tier);
      expect(inTier.map((r) => Number(r.applicable))).toEqual(
        [...inTier.map((r) => Number(r.applicable))].sort((a, b) => b - a),
      );
      const scores = inTier.filter((r) => r.applicable).map((r) => r.expectedWinsLost);
      expect(scores).toEqual([...scores].sort((a, b) => b - a));
    }
    expect(results[0].id).toBe('deck-bloat'); // the biggest measured gap in this corpus
  });

  it('carries the nemesis card as a leak, ranked in the same currency as the rest', () => {
    const results = detectLeaks(corpusMain);
    const nemesis = results.find((r) => r.id === 'nemesis')!;
    expect(nemesis.tier).toBe('leak');
    expect(nemesis.applicable).toBe(true);
    expect(nemesis.title).toBe('The Insatiable is ending your runs');
    // 21 meetings / 30 runs × (14/21 − 2/475) × moderate — same per-fight units
    // as boss-entry and upgrade-tempo, so cross-detector ranking still means
    // something. Below deck-bloat's 30 on this corpus, hence the order below.
    expect(nemesis.expectedWinsLost).toBeCloseTo(27.8, 1);
  });

  it('gives every registered detector a distinct id', () => {
    const ids = detectLeaks(corpusMain).map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

// ---------- the drill bar is the player's own number ----------

describe('deck-bloat drill bar', () => {
  it('never asks for a leaner act 1 than the decks this player wins with', () => {
    // Genre default is 8; this corpus wins at 9.4, so holding them to 8 would
    // be a bar their own victories disprove.
    expect(act1Bar(9.4, 11.3)).toBe(9);
    expect(act1Bar(5.2, 9.0)).toBe(8); // lean player keeps the genre default
  });

  it('tracks a heavy drafter up to their own winning average', () => {
    expect(act1Bar(14.0, 14.4)).toBe(14);
    expect(act1Bar(20.0, 21.0)).toBe(20);
  });

  it('quotes one number across the card, the receipt, and the drill', () => {
    const leak = deckBloatLeak(corpusMain);
    expect(leak.applicable).toBe(true);
    const bar = leak.drillBar!;
    expect(bar).toBeGreaterThanOrEqual(8);
    expect(leak.drill?.body).toContain(`at most ${bar} cards`);
    expect(leak.receiptLines[1]).toContain(`over the ${bar}-card bar`);
  });
});

// ---------- the victory opener ----------

describe('latestVictory', () => {
  it('is silent when the latest completed run lost', () => {
    // corpusMain's most recent run is a loss clone
    const latest = corpusMain.filter((r) => !r.abandoned).sort((a, b) => b.startTime - a.startTime)[0];
    if (latest.win) {
      expect(latestVictory(corpusMain)).toBeDefined();
    } else {
      expect(latestVictory(corpusMain)).toBeUndefined();
    }
  });

  it('celebrates a new frontier and points the wall up, never down', () => {
    const runs = [...clones(loss1785, 5), ...clones(win1779, 1)];
    const newest = runs[runs.length - 1];
    newest.startTime = Math.max(...runs.map((r) => r.startTime)) + 9999;
    newest.ascension = 6;
    const v = latestVictory(runs)!;
    expect(v).toBeDefined();
    expect(v.character).toBe(newest.player.character);
    expect(v.ascension).toBe(6);
    expect(v.newFrontier).toBe(true); // no prior win above A6 for Silent here
    expect(v.nextTarget).toBe(7); // up, always up
  });

  it('a repeat win below the frontier holds the level instead of re-crowning it', () => {
    const prior = clones(win1779, 1)[0];
    prior.ascension = 8;
    const again = clones(win1779, 1)[0];
    again.ascension = 5;
    again.startTime = 9_999_999_999; // newest of everything, including the loss clones
    const v = latestVictory([prior, again, ...clones(loss1785, 3)])!;
    expect(v.newFrontier).toBe(false);
    expect(v.nextTarget).toBe(6);
  });

  it('a win at the cap has nothing above it to take', () => {
    const capped = clones(win1779, 1)[0];
    capped.ascension = ASCENSION_CAP;
    capped.startTime = 9_999_999_999;
    const v = latestVictory([capped, ...clones(loss1785, 3)])!;
    expect(v.nextTarget).toBeUndefined();
  });

  it('an abandoned latest run neither congratulates nor mourns', () => {
    const ghost = clones(abandoned, 1)[0];
    ghost.startTime = 9_999_999_999;
    const runs = [...clones(win1779, 2), ghost];
    // the latest COMPLETED run decides; the abandoned one is invisible
    const v = latestVictory(runs);
    expect(v).toBeDefined();
  });
});
