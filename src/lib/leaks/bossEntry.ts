/**
 * Detector 1 — boss-entry-hp (tier 'leak').
 *
 * Over completed runs, every node containing a boss room is a boss fight.
 * Entry HP = entryHpPct at that node (the previous node's post-state).
 * "Low" entry = under 60%. A fight is a death when its node is the run's
 * death node. We compare death rates for low vs healthy entries.
 *
 * Gate: needs >= 20 completed runs, plus at least one fight on each side of
 * the 60% line to have anything to compare. When no boss fight has ended a
 * run, or low entries die no more often than healthy ones, it returns a
 * healthy (nothing-to-fix) result instead of claiming a leak.
 */
import { displayName } from '../idFormat';
import { deathNode, entryHpPct, hasRoom } from '../normalize';
import type { EvidenceStrength, LeakResult, NormalizedRun } from '../types';
import { LOW_BOSS_ENTRY, healthyResult, mostRecent, notYetApplicable, pctLabel, rankScore, runTag } from './helpers';

const ID = 'boss-entry-hp';
const TITLE = 'Walking into bosses below 60%';

interface BossFight {
  run: NormalizedRun;
  entry: number; // 0..1 fraction
  died: boolean;
  bossId?: string;
}

export function bossEntryLeak(completed: NormalizedRun[]): LeakResult {
  if (completed.length < 20) {
    return notYetApplicable(
      ID,
      'leak',
      TITLE,
      `This check compares how boss fights go when you arrive healthy versus hurt — it needs at least 20 finished runs to say anything fair, and you have ${completed.length}. Keep importing (or playing); it unlocks on its own.`,
    );
  }

  const fights: BossFight[] = [];
  for (const run of completed) {
    const death = deathNode(run);
    run.nodes.forEach((node, index) => {
      if (!hasRoom(node, 'boss')) return;
      const entry = entryHpPct(run, index);
      if (entry === undefined) return;
      fights.push({
        run,
        entry,
        died: node === death,
        bossId: node.rooms.find((r) => r.roomType === 'boss')?.modelId,
      });
    });
  }

  const low = fights.filter((f) => f.entry < LOW_BOSS_ENTRY);
  const healthy = fights.filter((f) => f.entry >= LOW_BOSS_ENTRY);
  if (low.length === 0 || healthy.length === 0) {
    return notYetApplicable(
      ID,
      'leak',
      TITLE,
      'To compare boss fights entered healthy versus hurt, your history needs fights on both sides of the 60% HP line. So far it only has one side — a few more runs will fill in the picture.',
    );
  }

  const lowDeaths = low.filter((f) => f.died).length;
  const healthyDeaths = healthy.filter((f) => f.died).length;
  const lowRate = lowDeaths / low.length;
  const healthyRate = healthyDeaths / healthy.length;

  const rateLines = [
    `boss fights entered under 60% HP: ${lowDeaths} deaths / ${low.length} fights (${pctLabel(lowRate)})`,
    `boss fights entered at 60%+ HP: ${healthyDeaths} deaths / ${healthy.length} fights (${pctLabel(healthyRate)})`,
  ];

  // Not a leak unless boss fights are actually ending runs, and doing it more
  // often on the low-entry side. Otherwise this is a clean bill of health, not
  // a headline card claiming wins are being lost.
  if (lowDeaths + healthyDeaths === 0) {
    return healthyResult(
      ID,
      'leak',
      TITLE,
      `Across ${fights.length} boss fights in your completed runs, none has ended a run — including the ${low.length} entered below 60% HP. Nothing to fix here; arriving healthy is still the habit that keeps it that way.`,
      rateLines,
    );
  }
  if (lowRate <= healthyRate) {
    return healthyResult(
      ID,
      'leak',
      TITLE,
      `Your history doesn't show low-HP boss entries costing you fights: entries below 60% HP died ${lowDeaths} time${lowDeaths === 1 ? '' : 's'} in ${low.length} fights (${pctLabel(lowRate)}), no worse than the ${pctLabel(healthyRate)} rate when you arrived at 60% or better. Nothing to fix here.`,
      rateLines,
    );
  }

  const bigSamples = low.length >= 20 && healthy.length >= 20;
  const bothSolid = low.length >= 10 && healthy.length >= 10;

  const ratioBadge =
    bigSamples && healthyRate > 0 && lowRate > healthyRate
      ? `${(lowRate / healthyRate).toFixed(1)}× deadlier`
      : undefined;

  let strength: EvidenceStrength = 'weak';
  if (lowRate > healthyRate) {
    if (bigSamples) strength = 'strong';
    else if (bothSolid) strength = 'moderate';
  }

  const body = bothSolid
    ? `Enter a boss under 60% HP and it ends your run ${pctLabel(lowRate)} of the time — arrive healthy and that drops to ${pctLabel(healthyRate)}. The fight is half-decided at the door.`
    : `${low.length} boss ${low.length === 1 ? 'fight' : 'fights'} entered below 60% HP so far (${lowDeaths} ${lowDeaths === 1 ? 'death' : 'deaths'}). Small sample — a nudge, not a verdict.`;

  const lowEntryDeaths = low.filter((f) => f.died);
  const runReceipts = mostRecent(lowEntryDeaths, (f) => f.run.startTime, 5).map((f) => ({
    runId: f.run.id,
    label: `${runTag(f.run)} · entered ${displayName(f.bossId)} at ${pctLabel(f.entry)}`,
  }));

  return {
    id: ID,
    tier: 'leak',
    title: TITLE,
    body,
    ratioBadge,
    dumbbell: {
      label: 'Boss-fight death rate',
      winValue: +(healthyRate * 100).toFixed(1),
      lossValue: +(lowRate * 100).toFixed(1),
      format: 'pct',
      sampleLabel: `${fights.length} boss fights`,
      // These are entry-HP cohorts, NOT win/loss cohorts — label them as such.
      winLabel: 'entered 60%+',
      lossLabel: 'entered <60%',
    },
    receiptLines: rateLines,
    runReceipts,
    confoundNote: 'Arriving low is partly a symptom of an already-struggling run — read this as a routing signal.',
    drill: {
      title: 'Arrive at 60%+',
      body: 'Next 5 runs: route the last stretch of each act to reach the boss above 60% — rest site, potion, or the quieter path.',
    },
    strength,
    expectedWinsLost: rankScore(low.length / completed.length, lowRate - healthyRate, strength),
    applicable: true,
  };
}
