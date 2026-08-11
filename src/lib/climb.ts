/**
 * The Climb — ascension progress framing.
 *
 * Deliberately NOT a leak detector: the point of ascension is to always be
 * pushing the next level, so the coach never suggests playing lower. Instead
 * this summarizes the frontier (highest level beaten), the record at the next
 * target, and which detected leak is the biggest lever for taking it.
 */
import { completedRuns } from './normalize';
import type { LeakResult, NormalizedRun } from './types';

export interface ClimbSummary {
  /** highest ascension with at least one win; null before the first win */
  frontier: number | null;
  /** the next level to take: frontier + 1 (or 0 pre-first-win) */
  target: number;
  targetAttempts: number;
  /** attempts at any level above the frontier (the whole unclaimed range) */
  aboveFrontierAttempts: number;
  /** closest call at the target: max acts entered in a target-level attempt */
  bestTargetActs: number;
  /** how many of the last 10 completed runs were at/above the target */
  recentPushShare: number;
  /** title of the top applicable leak — the lever the coach pairs with the climb */
  leverTitle?: string;
}

export function climbSummary(runs: NormalizedRun[], leaks: LeakResult[]): ClimbSummary {
  const completed = completedRuns(runs);
  const wins = completed.filter((r) => r.win);
  const frontier = wins.length ? Math.max(...wins.map((r) => r.ascension)) : null;
  const target = frontier === null ? 0 : frontier + 1;

  const atTarget = completed.filter((r) => r.ascension === target);
  const above = frontier === null ? [] : completed.filter((r) => r.ascension > frontier);
  const last10 = [...completed].sort((a, b) => a.startTime - b.startTime).slice(-10);

  const lever = leaks.find((l) => l.tier === 'leak' && l.applicable && !l.healthy);

  return {
    frontier,
    target,
    targetAttempts: atTarget.length,
    aboveFrontierAttempts: above.length,
    bestTargetActs: Math.max(0, ...atTarget.map((r) => r.actsEntered)),
    recentPushShare: last10.length ? last10.filter((r) => r.ascension >= target).length / last10.length : 0,
    leverTitle: lever?.title,
  };
}
