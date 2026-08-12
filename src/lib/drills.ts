/**
 * Drills — the actionable half of a leak.
 *
 * A drill is a machine-verifiable in-game behavior ("reach every act boss
 * above 60% HP") accepted for a fixed number of runs. On every re-sync the
 * runs recorded after acceptance are auto-graded by the leak's compliance
 * predicate — no self-reporting. One drill is active at a time: a coach that
 * assigns five drills assigns none.
 *
 * Grading semantics:
 *  - only completed (non-abandoned) runs started after acceptance count;
 *  - 'na' runs (the behavior never came up — e.g. no boss fight reached)
 *    don't consume drill slots;
 *  - the drill completes when pass+fail reaches targetRuns.
 */
import { completedRuns, deathNode, entryGold, entryHpPct } from './normalize';
import { displayName, shortDate, characterName } from './idFormat';
import { draftProfile } from './leaks/damageDrafting';
import type { NormalizedRun } from './types';

export type DrillVerdict = 'pass' | 'fail' | 'na';

export interface DrillDef {
  leakId: string;
  title: string;
  assignment: string;
  targetRuns: number;
  grade(run: NormalizedRun): { verdict: DrillVerdict; note?: string };
}

/** Persisted shape (IndexedDB meta key 'activeDrill'). */
export interface ActiveDrill {
  leakId: string;
  acceptedAt: number; // unix ms
  targetRuns: number;
}

export interface GradedRun {
  runId: string;
  startTime: number;
  label: string; // "Aug 12 · Defect A7"
  verdict: DrillVerdict;
  note?: string;
}

export interface DrillProgress {
  drill: ActiveDrill;
  def: DrillDef;
  graded: GradedRun[]; // chronological, na included
  passes: number;
  fails: number;
  complete: boolean;
}

const LOW = 0.6;
const RICH = 100;

export const DRILLS: Record<string, DrillDef> = {
  'boss-entry-hp': {
    leakId: 'boss-entry-hp',
    title: 'Arrive at 60%+',
    assignment: 'Reach every act boss above 60% HP — rest site, potion, or the quieter path.',
    targetRuns: 5,
    grade(run) {
      let bossFights = 0;
      let worst: { name: string; pct: number } | undefined;
      run.nodes.forEach((node, i) => {
        const boss = node.rooms.find((r) => r.roomType === 'boss');
        if (!boss) return;
        const entry = entryHpPct(run, i);
        if (entry === undefined) return;
        bossFights++;
        if (entry < LOW && (!worst || entry < worst.pct)) {
          worst = { name: displayName(boss.modelId ?? ''), pct: entry };
        }
      });
      if (bossFights === 0) return { verdict: 'na', note: 'no boss reached' };
      return worst
        ? { verdict: 'fail', note: `entered ${worst.name || 'a boss'} at ${Math.round(worst.pct * 100)}%` }
        : { verdict: 'pass', note: `all ${bossFights} boss ${bossFights === 1 ? 'entry' : 'entries'} healthy` };
    },
  },
  'damage-drafting': {
    leakId: 'damage-drafting',
    title: 'Damage first',
    assignment: 'Add at least 2 attack cards before your first elite fight.',
    targetRuns: 5,
    grade(run) {
      const profile = draftProfile(run);
      if (!profile) return { verdict: 'na', note: 'no act-1 elite fought' };
      return profile.attacksBeforeElite >= 2
        ? { verdict: 'pass', note: `${profile.attacksBeforeElite} attacks before the first elite` }
        : { verdict: 'fail', note: `only ${profile.attacksBeforeElite} attack${profile.attacksBeforeElite === 1 ? '' : 's'} before the floor-${profile.firstEliteFloor} elite` };
    },
  },
  'removal-discipline': {
    leakId: 'removal-discipline',
    title: 'Buy the removal',
    assignment: 'Whenever a shop offers removal and you hold 100+ gold, buy it before anything else.',
    targetRuns: 5,
    grade(run) {
      let rich = 0;
      let skippedGold: number | undefined;
      for (const node of run.nodes) {
        if (!node.rooms.some((r) => r.roomType === 'shop')) continue;
        const gold = entryGold(node);
        if (gold < RICH) continue;
        rich++;
        if (node.stats.cardsRemoved.length === 0 && skippedGold === undefined) skippedGold = gold;
      }
      if (rich === 0) return { verdict: 'na', note: 'no rich shop visited' };
      return skippedGold !== undefined
        ? { verdict: 'fail', note: `left a shop holding ${skippedGold} gold, no removal` }
        : { verdict: 'pass', note: `removed at all ${rich} rich ${rich === 1 ? 'shop' : 'shops'}` };
    },
  },
};

export function computeDrillProgress(drill: ActiveDrill, runs: NormalizedRun[]): DrillProgress | undefined {
  const def = DRILLS[drill.leakId];
  if (!def) return undefined; // drill for a detector that no longer exists
  const eligible = completedRuns(runs)
    .filter((r) => r.startTime * 1000 >= drill.acceptedAt)
    .sort((a, b) => a.startTime - b.startTime);

  const graded: GradedRun[] = [];
  let passes = 0;
  let fails = 0;
  for (const run of eligible) {
    if (passes + fails >= drill.targetRuns) break;
    const { verdict, note } = def.grade(run);
    if (verdict === 'pass') passes++;
    if (verdict === 'fail') fails++;
    graded.push({
      runId: run.id,
      startTime: run.startTime,
      label: `${shortDate(run.startTime)} · ${characterName(run.player.character)} A${run.ascension}`,
      verdict,
      note,
    });
  }
  return { drill, def, graded, passes, fails, complete: passes + fails >= drill.targetRuns };
}

/**
 * Per-run behavior-rate series for a leak (0..1, chronological), smoothed with
 * a trailing window — the leak card's trend sparkline. Returns undefined when
 * the leak has no rate function or too little history to say anything.
 */
export function behaviorTrend(
  leakId: string,
  runs: NormalizedRun[],
  window = 10,
): { startTime: number; rate: number }[] | undefined {
  const rateOf = RATE_FNS[leakId];
  if (!rateOf) return undefined;
  const chrono = completedRuns(runs).sort((a, b) => a.startTime - b.startTime);
  const perRun: { startTime: number; rate: number }[] = [];
  for (const run of chrono) {
    const r = rateOf(run);
    if (r !== undefined) perRun.push({ startTime: run.startTime, rate: r });
  }
  if (perRun.length < window) return undefined;
  return perRun.map((p, i) => {
    const slice = perRun.slice(Math.max(0, i - window + 1), i + 1);
    return { startTime: p.startTime, rate: slice.reduce((a, s) => a + s.rate, 0) / slice.length };
  });
}

/** Rate of the leak behavior within one run; undefined = didn't come up. */
const RATE_FNS: Record<string, (run: NormalizedRun) => number | undefined> = {
  'boss-entry-hp': (run) => {
    let fights = 0;
    let low = 0;
    run.nodes.forEach((node, i) => {
      if (!node.rooms.some((r) => r.roomType === 'boss')) return;
      const entry = entryHpPct(run, i);
      if (entry === undefined) return;
      fights++;
      if (entry < LOW) low++;
    });
    return fights ? low / fights : undefined;
  },
  'removal-discipline': (run) => {
    let rich = 0;
    let skipped = 0;
    for (const node of run.nodes) {
      if (!node.rooms.some((r) => r.roomType === 'shop')) continue;
      if (entryGold(node) < RICH) continue;
      rich++;
      if (node.stats.cardsRemoved.length === 0) skipped++;
    }
    return rich ? skipped / rich : undefined;
  },
  'damage-drafting': (run) => {
    const profile = draftProfile(run);
    if (!profile) return undefined;
    return profile.attacksBeforeElite < 2 ? 1 : 0;
  },
  // observations can trend too — potions still held at death
  'potion-hoarding': (run) => {
    const death = deathNode(run);
    if (!death) return undefined;
    return run.player.potions.length > 0 ? 1 : 0;
  },
};
