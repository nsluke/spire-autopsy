/**
 * Detector 3 — ascension-pacing (tier 'leak').
 *
 * Per-ascension-level win rates (levels with n < 10 are shown but marked as
 * too small to judge), a rolling view of the last 30 runs, and a hedged
 * recommendation: the highest level with n >= 10 and a win rate >= 25%
 * (or, if none clears 25%, the best-rate level with n >= 10).
 *
 * Gate: needs >= 30 completed runs, and at least one level with n >= 10.
 */
import type { EvidenceStrength, LeakResult, NormalizedRun } from '../types';
import { mean1, mostRecent, notYetApplicable, pctLabel, rankScore, runTag } from './helpers';

const ID = 'ascension-pacing';
const TITLE = 'Climbing faster than the wins come';

interface LevelStats {
  level: number;
  n: number;
  wins: number;
  rate: number; // 0..1
}

export function ascensionPacingLeak(completed: NormalizedRun[]): LeakResult {
  if (completed.length < 30) {
    return notYetApplicable(
      ID,
      'leak',
      TITLE,
      `Pacing advice needs a longer view — at least 30 finished runs — so it never tells you to climb or hold based on a lucky week. You have ${completed.length}; it unlocks on its own from here.`,
    );
  }

  const byLevel = new Map<number, NormalizedRun[]>();
  for (const run of completed) {
    const list = byLevel.get(run.ascension) ?? [];
    list.push(run);
    byLevel.set(run.ascension, list);
  }
  const levels: LevelStats[] = [...byLevel.entries()]
    .map(([level, runs]) => {
      const wins = runs.filter((r) => r.win).length;
      return { level, n: runs.length, wins, rate: wins / runs.length };
    })
    .sort((a, b) => a.level - b.level);

  const judged = levels.filter((l) => l.n >= 10);
  if (judged.length === 0) {
    return notYetApplicable(
      ID,
      'leak',
      TITLE,
      'Your runs are spread thinly across ascension levels — no single level has the 10 runs this check needs to judge a win rate. A focused block at one level will unlock it.',
    );
  }

  const cleared = judged.filter((l) => l.rate >= 0.25);
  const hedged = cleared.length === 0;
  const rec = hedged
    ? judged.reduce((best, l) => (l.rate > best.rate ? l : best))
    : cleared.reduce((best, l) => (l.level > best.level ? l : best));

  const chrono = [...completed].sort((a, b) => a.startTime - b.startTime);
  const last30 = chrono.slice(-30);
  const rollingWins = last30.filter((r) => r.win).length;
  const rollingRate = rollingWins / last30.length;
  const rollingAsc = mean1(last30.map((r) => r.ascension));

  const above = completed.filter((r) => r.ascension > rec.level);
  const aboveWins = above.filter((r) => r.win).length;
  const aboveRate = above.length ? aboveWins / above.length : 0;
  const aboveFrac30 = last30.filter((r) => r.ascension > rec.level).length / last30.length;

  const strength: EvidenceStrength = hedged ? 'weak' : 'moderate';

  const body = hedged
    ? `Your last 30 runs average A${rollingAsc} with ${rollingWins} wins (${pctLabel(rollingRate)}). None of your well-practiced levels clears a 25% win rate yet — your strongest is A${rec.level} at ${rec.wins}/${rec.n}. That is not a wall, just a signal: a short, deliberate block at A${rec.level} might be the fastest way to turn grinding into climbing. This is a pattern in your history, not a rule.`
    : `Your last 30 runs average A${rollingAsc} with ${rollingWins} wins (${pctLabel(rollingRate)}). The highest level where your wins look steady is A${rec.level} — ${rec.wins}/${rec.n} there (${pctLabel(rec.rate)}). There is nothing wrong with pushing higher, and streaks come and go, but when you play above A${rec.level} your record so far is ${aboveWins}/${above.length}. A stretch of runs at A${rec.level} might rebuild momentum before the next push.`;

  const receiptLines = levels.map((l) =>
    l.n >= 10
      ? `A${l.level}: ${l.wins}/${l.n} wins (${pctLabel(l.rate)})`
      : `A${l.level}: ${l.wins}/${l.n} — sample too small to judge`,
  );
  receiptLines.push(`last 30 runs: ${rollingWins}/${last30.length} wins (${pctLabel(rollingRate)}), average level A${rollingAsc}`);

  const recentLossesAbove = completed.filter((r) => !r.win && r.ascension > rec.level);
  const runReceipts = mostRecent(recentLossesAbove, (r) => r.startTime, 5).map((r) => ({
    runId: r.id,
    label: `${runTag(r)} · loss above the A${rec.level} band`,
  }));

  return {
    id: ID,
    tier: 'leak',
    title: TITLE,
    body,
    receiptLines,
    runReceipts,
    confoundNote:
      'Win rate falls with ascension for everyone — playing above your steadiest level is how growth happens. This is about pacing the climb, not stopping it.',
    drill: {
      title: `Settle at A${rec.level}`,
      body: `Play your next 5 runs at A${rec.level} and treat them as form practice — the goal is clean decisions, not the climb.`,
    },
    strength,
    expectedWinsLost: rankScore(aboveFrac30, rec.rate - aboveRate, strength),
    applicable: true,
  };
}
