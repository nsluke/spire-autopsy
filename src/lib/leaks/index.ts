/**
 * Leak engine entry point.
 *
 * detectLeaks runs every detector over the completed (non-abandoned) runs and
 * returns them UI-ready: tier-'leak' results first, then observations; within
 * each tier, applicable results sorted by expectedWinsLost (the ranking
 * heuristic documented in ./helpers.ts) descending, with not-yet-applicable
 * placeholders — which carry friendly "what unlocks this" bodies — at the end.
 */
import { completedRuns } from '../normalize';
import type { LeakResult, NormalizedRun } from '../types';
import { ascensionPacingLeak } from './ascensionPacing';
import { bossEntryLeak } from './bossEntry';
import { eliteAppetite, goldAtDeath, potionHoarding } from './observations';
import { removalDisciplineLeak } from './removals';

function byRank(a: LeakResult, b: LeakResult): number {
  return Number(b.applicable) - Number(a.applicable) || b.expectedWinsLost - a.expectedWinsLost;
}

export function detectLeaks(runs: NormalizedRun[]): LeakResult[] {
  const completed = completedRuns(runs);
  const leaks = [bossEntryLeak(completed), removalDisciplineLeak(completed), ascensionPacingLeak(completed)].sort(
    byRank,
  );
  const observations = [eliteAppetite(completed), potionHoarding(completed), goldAtDeath(completed)].sort(byRank);
  return [...leaks, ...observations];
}
