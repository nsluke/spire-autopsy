/**
 * drills.test.ts — drill grading + trend series.
 *
 * Fixture facts used (hand-derived, same corpus as leaks.test.ts):
 *   win  1779248265  Silent A6:  boss entries 94%/74%/99% → boss drill PASS; 3 rich shops, 2 without removal → removal drill FAIL
 *   loss 1785858459  Defect A6:  boss entries 48%/57%     → boss drill FAIL (worst 48%); 4 rich shops, 3 skipped → removal FAIL
 *   loss 1774194024  Ironclad A1: died to an act-1 elite, no boss fights → boss drill NA
 *   1778528032       abandoned → never graded
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { computeDrillProgress, behaviorTrend, DRILLS, type ActiveDrill } from '../src/lib/drills';
import { detectLeaks } from '../src/lib/leaks';
import { normalizeRun } from '../src/lib/normalize';
import type { NormalizedRun } from '../src/lib/types';

function loadFixture(name: string): NormalizedRun {
  const path = fileURLToPath(new URL(`./fixtures/${name}.run`, import.meta.url));
  return normalizeRun(JSON.parse(readFileSync(path, 'utf8')), `${name}.run`);
}

const winSilent = loadFixture('1779248265');
const lossDefect = loadFixture('1785858459');
const lossElite = loadFixture('1774194024');
const abandoned = loadFixture('1778528032');

let counter = 0;
function at(run: NormalizedRun, startTime: number): NormalizedRun {
  counter += 1;
  const copy = JSON.parse(JSON.stringify(run)) as NormalizedRun;
  copy.id = `${run.id}-t${counter}`;
  copy.startTime = startTime;
  return copy;
}

/** A deep copy of a fixture with one edit applied — never mutates the fixture. */
function mutate(run: NormalizedRun, edit: (r: NormalizedRun) => void): NormalizedRun {
  const copy = JSON.parse(JSON.stringify(run)) as NormalizedRun;
  edit(copy);
  return copy;
}

const T0 = 1_800_000_000; // drill accepted at this moment (seconds); ms in ActiveDrill
const drill = (leakId: string): ActiveDrill => ({ leakId, acceptedAt: T0 * 1000, targetRuns: 5 });

describe('boss-entry drill grading', () => {
  it('passes healthy-entry runs, fails low-entry runs with the worst entry named', () => {
    const { verdict: passV, note: passNote } = DRILLS['boss-entry-hp'].grade(winSilent);
    expect(passV).toBe('pass');
    expect(passNote).toContain('3 boss entries');
    const { verdict: failV, note: failNote } = DRILLS['boss-entry-hp'].grade(lossDefect);
    expect(failV).toBe('fail');
    expect(failNote).toContain('48%'); // worst of 48/57
    expect(failNote).toContain('The Kin');
  });

  it('marks runs that never reach a boss as not-applicable', () => {
    expect(DRILLS['boss-entry-hp'].grade(lossElite).verdict).toBe('na');
  });
});

describe('removal drill grading (mirrors removals.ts exactly)', () => {
  it('fails a run that spent real gold at a rich shop and removed nothing', () => {
    const { verdict, note } = DRILLS['removal-discipline'].grade(lossDefect);
    expect(verdict).toBe('fail');
    expect(note).toBe('spent 121 gold at a shop, none of it on the removal');
  });

  it('does not fail a visit where the removal may not have been affordable', () => {
    // Same gold walked in with, almost none of it spent: no evidence either
    // way, so the run consumes no drill slot instead of being graded a miss.
    const browsed = mutate(lossDefect, (r) => {
      for (const node of r.nodes) {
        if (!node.rooms.some((x) => x.roomType === 'shop')) continue;
        node.stats.gold += node.stats.goldSpent - 10;
        node.stats.goldSpent = 10;
        node.stats.cardsRemoved = [];
      }
    });
    expect(DRILLS['removal-discipline'].grade(browsed)).toEqual({
      verdict: 'na',
      note: 'no shop where the removal was clearly affordable',
    });
  });

  it('passes a run that bought the removal at every shop it spent at', () => {
    const disciplined = mutate(lossDefect, (r) => {
      for (const node of r.nodes) {
        if (!node.rooms.some((x) => x.roomType === 'shop')) continue;
        node.stats.cardsRemoved = [{ id: 'CARD.STRIKE_DEFECT', upgradeLevel: 0 }];
      }
    });
    const { verdict, note } = DRILLS['removal-discipline'].grade(disciplined);
    expect(verdict).toBe('pass');
    expect(note).toContain('removed a card at all 3 shops');
  });
});

describe('the other drills grade the same predicate their detector reports', () => {
  it('damage-drafting uses the shared 3-attack bar', () => {
    expect(DRILLS['damage-drafting'].assignment).toContain('3 attack cards');
    // "added" must stay in the note — the count excludes starter Strikes, and
    // a bare "0 attacks" is a claim the player can disprove from memory.
    expect(DRILLS['damage-drafting'].grade(lossDefect)).toEqual({
      verdict: 'fail',
      note: 'only 0 attacks added before the floor-9 elite, wanted 3',
    });
    expect(DRILLS['damage-drafting'].grade(lossElite).verdict).toBe('fail'); // fought an act-1 elite
  });

  it('potion-hoarding grades the one fight whose belt is known exactly', () => {
    // Defect A6 threw 2 potions at the boss that killed it — compliant.
    expect(DRILLS['potion-hoarding'].grade(lossDefect)).toEqual({
      verdict: 'pass',
      note: 'threw 2 potions in the last fight',
    });
    const hoarded = mutate(lossDefect, (r) => {
      r.player.potions = ['POTION.FIRE_POTION', 'POTION.BLOCK_POTION'];
      r.nodes[32].stats.potionsUsed = [];
    });
    expect(DRILLS['potion-hoarding'].grade(hoarded)).toEqual({
      verdict: 'fail',
      note: 'entered the last fight holding 2 potions, threw none',
    });
    // an empty belt is not a miss
    expect(DRILLS['potion-hoarding'].grade(lossElite).verdict).toBe('na');
  });

  it('potion-hoarding never charges a miss against a run the player won', () => {
    // Same unthrown belt as the failing case above — but the run was won, and
    // a drill that argues with the scoreboard is a drill players stop trusting.
    const wonHoarding = mutate(lossDefect, (r) => {
      r.win = true;
      r.player.potions = ['POTION.FIRE_POTION', 'POTION.BLOCK_POTION'];
      r.nodes[32].stats.potionsUsed = [];
    });
    expect(DRILLS['potion-hoarding'].grade(wonHoarding)).toEqual({
      verdict: 'pass',
      note: 'won it holding 2 — the belt cost you nothing here',
    });
  });

  it('deck-bloat grades act-1 additions and skips act-1 deaths', () => {
    expect(DRILLS['deck-bloat'].grade(lossDefect)).toEqual({
      verdict: 'fail',
      note: '12 cards added in act 1, bar is 8',
    });
    expect(DRILLS['deck-bloat'].grade(winSilent)).toEqual({ verdict: 'pass', note: '6 cards added in act 1' });
    expect(DRILLS['deck-bloat'].grade(lossElite)).toEqual({ verdict: 'na', note: 'the run ended inside act 1' });
  });

  it('deck-bloat grades against the bar the card quoted, not the genre default', () => {
    // A heavier drafter is held to their own winning average (12 here): the
    // same 12-card act 1 that fails at the default bar must pass at theirs.
    expect(DRILLS['deck-bloat'].grade(lossDefect, 12)).toEqual({ verdict: 'pass', note: '12 cards added in act 1' });
    expect(DRILLS['deck-bloat'].grade(lossDefect, 11)).toEqual({
      verdict: 'fail',
      note: '12 cards added in act 1, bar is 11',
    });
  });

  it('upgrade-tempo grades every boss door against the act bar', () => {
    expect(DRILLS['upgrade-tempo'].grade(lossDefect)).toEqual({
      verdict: 'fail',
      note: 'met the act-1 boss with 1 upgrade banked, wanted 3',
    });
    expect(DRILLS['upgrade-tempo'].grade(lossElite).verdict).toBe('na');
  });

  it('fight-pacing grades the median hallway fight', () => {
    expect(DRILLS['fight-pacing'].grade(winSilent)).toEqual({
      verdict: 'pass',
      note: 'median 4 turns across 8 hallway fights',
    });
    const slow = mutate(winSilent, (r) => {
      for (const node of r.nodes) for (const room of node.rooms) if (room.turnsTaken > 0) room.turnsTaken = 7;
    });
    expect(DRILLS['fight-pacing'].grade(slow)).toEqual({
      verdict: 'fail',
      note: 'median 7 turns across 8 hallway fights, bar is 4',
    });
    expect(DRILLS['fight-pacing'].grade(lossElite).verdict).toBe('na');
  });

  it('every drill is registered against a detector the engine actually emits', () => {
    const ids = new Set(detectLeaks([winSilent, lossDefect, lossElite]).map((l) => l.id));
    for (const id of Object.keys(DRILLS)) expect(ids.has(id)).toBe(true);
  });
});

describe('computeDrillProgress', () => {
  it('grades only completed runs started after acceptance, na runs use no slots', () => {
    const runs = [
      at(winSilent, T0 - 5000), // before acceptance — ignored
      at(lossDefect, T0 + 100), // fail
      at(lossElite, T0 + 200), // na — no slot consumed
      at(winSilent, T0 + 300), // pass
      at(abandoned, T0 + 400), // abandoned — ignored
    ];
    const p = computeDrillProgress(drill('boss-entry-hp'), runs)!;
    expect(p.graded.map((g) => g.verdict)).toEqual(['fail', 'na', 'pass']);
    expect(p.passes).toBe(1);
    expect(p.fails).toBe(1);
    expect(p.complete).toBe(false);
  });

  it('completes at targetRuns graded (na excluded) and stops grading beyond it', () => {
    const runs = [
      ...Array.from({ length: 4 }, (_, i) => at(winSilent, T0 + 100 + i)),
      at(lossDefect, T0 + 200),
      at(lossDefect, T0 + 300), // beyond target — not graded
    ];
    const p = computeDrillProgress(drill('boss-entry-hp'), runs)!;
    expect(p.complete).toBe(true);
    expect(p.passes + p.fails).toBe(5);
    expect(p.graded).toHaveLength(5);
  });

  it('returns undefined for a drill whose detector no longer exists', () => {
    expect(computeDrillProgress(drill('retired-detector'), [at(winSilent, T0 + 1)])).toBeUndefined();
  });
});

describe('behaviorTrend', () => {
  it('produces a rolling rate series once the window is reached', () => {
    const runs = [
      ...Array.from({ length: 6 }, (_, i) => at(lossDefect, T0 + i * 100)), // rate 1 each (both entries low? 48/57 → low fights 2/2)
      ...Array.from({ length: 6 }, (_, i) => at(winSilent, T0 + 1000 + i * 100)), // rate 0 each
    ];
    const trend = behaviorTrend('boss-entry-hp', runs, 4)!;
    expect(trend.length).toBe(12);
    // early window: all low entries → rate 1; late window: all healthy → rate 0
    expect(trend[3].rate).toBe(1);
    expect(trend[trend.length - 1].rate).toBe(0);
    // chronological
    const times = trend.map((t) => t.startTime);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
  });

  it('returns undefined below the window and for unknown leaks', () => {
    expect(behaviorTrend('boss-entry-hp', [at(winSilent, T0)], 10)).toBeUndefined();
    expect(behaviorTrend('nope', [at(winSilent, T0)])).toBeUndefined();
  });
});
