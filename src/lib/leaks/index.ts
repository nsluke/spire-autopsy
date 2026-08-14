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
import { bossEntryLeak } from './bossEntry';
import { damageDraftingLeak } from './damageDrafting';
import { deckBloatLeak } from './deckBloat';
import { fightPacing } from './fightPacing';
import { nemesisLeak } from './nemesis';
import { eliteAppetite, eventTax, goldAtDeath, restDiscipline } from './observations';
import { potionHoarding } from './potions';
import { removalDisciplineLeak } from './removals';
import { upgradeTempoLeak } from './upgradeTempo';

// Note: ascension pacing is deliberately NOT a detector. Telling a climber to
// settle at a lower level misreads the game — the next ascension is always the
// goal. Ascension context lives in lib/climb.ts as progress framing instead.

function byRank(a: LeakResult, b: LeakResult): number {
  return Number(b.applicable) - Number(a.applicable) || b.expectedWinsLost - a.expectedWinsLost;
}

export function detectLeaks(runs: NormalizedRun[]): LeakResult[] {
  const completed = completedRuns(runs);
  const leaks = [
    nemesisLeak(completed),
    bossEntryLeak(completed),
    removalDisciplineLeak(completed),
    damageDraftingLeak(completed),
    potionHoarding(completed),
    deckBloatLeak(completed),
    upgradeTempoLeak(completed),
  ].sort(byRank);
  const observations = [
    eliteAppetite(completed),
    goldAtDeath(completed),
    eventTax(completed),
    restDiscipline(completed),
    fightPacing(completed),
  ].sort(byRank);
  return [...leaks, ...observations];
}
