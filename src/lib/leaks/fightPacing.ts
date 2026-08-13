/**
 * Detector — fight-pacing (tier 'observation').
 *
 * room.turnsTaken is recorded on every combat room and, until now, nothing in
 * the engine read it. It is the closest thing the log has to a damage meter:
 * a hallway fight that runs long is a deck without frontload, and the extra
 * turns are paid for in HP that the next elite collects.
 *
 * Scope is deliberately narrow — act-1 and act-2 HALLWAY fights (monster
 * rooms, elites and bosses excluded). Hallway monsters are the closest thing
 * to a fixed yardstick the game offers; elites and bosses have their own
 * health pools and phases, and act 3 is a different bestiary. Rooms logging 0
 * turns (unfought, or an older schema) are dropped from the denominator.
 *
 * It stays an observation: turn count is an outcome of the whole deck, not a
 * decision you make at a node, so it reads as a symptom that points at
 * drafting rather than as a habit to break on its own.
 */
import { displayName } from '../idFormat';
import type { EvidenceStrength, LeakResult, NormalizedRun } from '../types';
import {
  SYNTHETIC_DELTA_CAP,
  healthyResult,
  median,
  mostRecent,
  notYetApplicable,
  pctLabel,
  rankScore,
  runTag,
  winRate,
} from './helpers';

const ID = 'fight-pacing';
const TITLE = 'Hallway fights that run long';
const MIN_COMPLETED = 15;

/** A hallway fight taking more turns than this is "slow" — the drill's bar too. */
export const TURN_TARGET = 4;

interface Hallway {
  run: NormalizedRun;
  floor: number;
  turns: number;
  encounterId?: string;
}

/** Act-1/act-2 hallway fights with a recorded turn count. */
export function hallwayFights(run: NormalizedRun): Hallway[] {
  const out: Hallway[] = [];
  for (const node of run.nodes) {
    if (node.act > 2) break;
    for (const room of node.rooms) {
      if (room.roomType !== 'monster' || room.turnsTaken <= 0) continue;
      out.push({ run, floor: node.floor, turns: room.turnsTaken, encounterId: room.modelId });
    }
  }
  return out;
}

/** Median turns across a run's act-1/2 hallway fights; undefined = none recorded. */
export function medianHallwayTurns(run: NormalizedRun): number | undefined {
  const fights = hallwayFights(run);
  return fights.length ? median(fights.map((f) => f.turns)) : undefined;
}

export function fightPacing(completed: NormalizedRun[]): LeakResult {
  if (completed.length < MIN_COMPLETED) {
    return notYetApplicable(
      ID,
      'observation',
      TITLE,
      `This observation reads the turn counts of your act-1 and act-2 hallway fights, wins versus losses. It unlocks at 15 finished runs (you have ${completed.length}).`,
    );
  }

  const winFights = completed.filter((r) => r.win).flatMap(hallwayFights);
  const lossFights = completed.filter((r) => !r.win).flatMap(hallwayFights);
  if (winFights.length < 20 || lossFights.length < 20) {
    return notYetApplicable(
      ID,
      'observation',
      TITLE,
      'Comparing pace needs at least 20 recorded hallway fights on each side of the win/loss line.',
    );
  }

  const winMedian = median(winFights.map((f) => f.turns));
  const lossMedian = median(lossFights.map((f) => f.turns));
  const winSlow = winFights.filter((f) => f.turns > TURN_TARGET).length / winFights.length;
  const lossSlow = lossFights.filter((f) => f.turns > TURN_TARGET).length / lossFights.length;
  const gapPp = (lossSlow - winSlow) * 100;

  const rateLines = [
    `median turns per act-1/2 hallway fight: ${winMedian} across ${winFights.length} fights in wins vs ${lossMedian} across ${lossFights.length} in losses`,
    `hallway fights running over ${TURN_TARGET} turns: ${pctLabel(winSlow)} in wins vs ${pctLabel(lossSlow)} in losses`,
  ];

  if (gapPp < 5 && lossMedian <= winMedian) {
    return healthyResult(
      ID,
      'observation',
      TITLE,
      `Your hallway fights close at the same pace whether you win or lose — median ${lossMedian} turns in losses against ${winMedian} in wins. The deck has frontload; look elsewhere.`,
      rateLines,
    );
  }

  // Per-run frequency for the ranking: the average share of a run's hallway
  // fights that run long. The rateDelta below is a per-run win-rate gap, so
  // pairing it with a per-fight count would multiply the same evidence twice.
  const runShares = completed
    .map((r) => hallwayFights(r))
    .filter((f) => f.length > 0)
    .map((f) => f.filter((x) => x.turns > TURN_TARGET).length / f.length);
  const slowFreq = runShares.length ? runShares.reduce((a, b) => a + b, 0) / runShares.length : 0;

  const slowRuns = completed.filter((r) => (medianHallwayTurns(r) ?? 0) > TURN_TARGET);
  const briskRuns = completed.filter((r) => {
    const m = medianHallwayTurns(r);
    return m !== undefined && m <= TURN_TARGET;
  });
  const rateDelta =
    slowRuns.length >= 5 && briskRuns.length >= 5
      ? Math.max(0, winRate(briskRuns) - winRate(slowRuns))
      : Math.min(SYNTHETIC_DELTA_CAP, Math.max(gapPp / 100, 0.05));

  const slowLossFights = lossFights.filter((f) => f.turns > TURN_TARGET);
  const runReceipts = mostRecent(slowLossFights, (f) => f.run.startTime + f.floor / 1000, 5).map((f) => ({
    runId: f.run.id,
    label: `${runTag(f.run)} · ${f.turns} turns to clear ${displayName(f.encounterId) || 'a hallway fight'} on floor ${f.floor}`,
    enemyIds: f.encounterId ? [f.encounterId] : undefined,
  }));

  const strength: EvidenceStrength = gapPp >= 15 && winFights.length >= 50 && lossFights.length >= 50 ? 'moderate' : 'weak';

  return {
    id: ID,
    tier: 'observation',
    title: TITLE,
    body: `In runs you lose, ${pctLabel(lossSlow)} of act-1 and act-2 hallway fights run past ${TURN_TARGET} turns; in runs you win, ${pctLabel(winSlow)}. Median ${lossMedian} turns against ${winMedian}. Every extra turn in a hallway is chip damage you hand to the elite waiting two floors up — this is a drafting signal, not a piloting one.`,
    dumbbell: {
      label: `Hallway fights over ${TURN_TARGET} turns`,
      winValue: +(winSlow * 100).toFixed(1),
      lossValue: +(lossSlow * 100).toFixed(1),
      format: 'pct',
      sampleLabel: `${winFights.length} fights in wins vs ${lossFights.length} in losses`,
    },
    receiptLines: rateLines,
    runReceipts,
    confoundNote:
      'Slow fights are as much a symptom as a cause — a run that lost its tempo early fights everything the hard way. Ascension scaling also adds enemy HP, so mixed-ascension history stretches both sides.',
    drill: {
      title: 'Close the hallway',
      body: `Next 5 runs: keep the median act-1/2 hallway fight at ${TURN_TARGET} turns or under. When a reward offers damage that ends fights a turn sooner, take it.`,
    },
    strength,
    expectedWinsLost: rankScore(slowFreq, rateDelta, strength),
    applicable: true,
  };
}
