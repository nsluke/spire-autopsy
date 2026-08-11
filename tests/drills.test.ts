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

describe('removal drill grading', () => {
  it('fails a run that leaves any rich shop without a removal', () => {
    const { verdict, note } = DRILLS['removal-discipline'].grade(lossDefect);
    expect(verdict).toBe('fail');
    expect(note).toContain('gold');
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
