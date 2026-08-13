/**
 * Detector — upgrade-tempo (tier 'leak').
 *
 * Thesis (Baalorlord's campfire rule, and the reason SMITH is the default):
 * an upgrade is permanent and compounds over every remaining fight; a heal
 * evaporates at the next act's door. The question a campfire asks is not "am I
 * hurt" but "will this upgrade be in my deck for 20 more fights".
 *
 * The measurable version is TEMPO: how many upgrades are banked when you walk
 * into a boss. node.stats.cardsUpgraded is recorded at every node (campfire
 * smiths, relics, event upgrades all land there), so the banked count at any
 * boss floor is exact. Cohorts are boss FIGHTS, not runs, and the outcome is
 * whether that fight ended the run — the same honest denominator boss-entry-hp
 * uses.
 *
 * The bar is stepped per act: roughly three campfires per act, smithed rather
 * than slept in, is 3 upgrades by the act-1 boss, 6 by act 2, 9 by act 3.
 * Confounders: a run flush with relics or an upgrade event beats the bar for
 * free, and a struggling run is forced to heal — see confoundNote.
 */
import { displayName } from '../idFormat';
import { deathNode, hasRoom } from '../normalize';
import type { EvidenceStrength, LeakResult, NormalizedRun } from '../types';
import { healthyResult, mean1, mostRecent, n1, notYetApplicable, pctLabel, rankScore, runTag } from './helpers';

const ID = 'upgrade-tempo';
const TITLE = 'Arriving at the boss unupgraded';
const MIN_COMPLETED = 20;

/** Upgrades a boss entry should carry per act cleared — ~3 campfires an act, smithed. */
export const UPGRADES_PER_ACT = 3;

/** The bar for the boss of a given act. */
export function upgradeTarget(act: number): number {
  return UPGRADES_PER_ACT * act;
}

interface BossEntry {
  run: NormalizedRun;
  act: number;
  banked: number;
  short: boolean; // banked below the act's bar
  died: boolean;
  bossId?: string;
}

/** Every boss fight in the run, with the upgrades banked before walking in. */
export function bossEntries(run: NormalizedRun): BossEntry[] {
  const death = deathNode(run);
  const entries: BossEntry[] = [];
  let banked = 0;
  for (const node of run.nodes) {
    if (hasRoom(node, 'boss')) {
      entries.push({
        run,
        act: node.act,
        banked,
        short: banked < upgradeTarget(node.act),
        died: node === death,
        bossId: node.rooms.find((r) => r.roomType === 'boss')?.modelId,
      });
    }
    banked += node.stats.cardsUpgraded.filter(Boolean).length;
  }
  return entries;
}

export function upgradeTempoLeak(completed: NormalizedRun[]): LeakResult {
  if (completed.length < MIN_COMPLETED) {
    return notYetApplicable(
      ID,
      'leak',
      TITLE,
      `This check counts the upgrades you have banked when you walk into a boss, and compares how those fights end. It needs at least 20 finished runs and you have ${completed.length}.`,
    );
  }

  const entries = completed.flatMap(bossEntries);
  const short = entries.filter((e) => e.short);
  const stocked = entries.filter((e) => !e.short);
  if (short.length === 0 && entries.length >= 20) {
    return healthyResult(
      ID,
      'leak',
      TITLE,
      `All ${entries.length} boss fights in your history were entered with the act's upgrades already banked (${UPGRADES_PER_ACT} per act cleared). The campfires are being spent right.`,
      [`boss fights entered at or above the upgrade bar: ${entries.length}/${entries.length}`],
    );
  }
  if (short.length === 0 || stocked.length === 0) {
    return notYetApplicable(
      ID,
      'leak',
      TITLE,
      `Comparing upgrade tempo needs boss fights on both sides of the bar (${UPGRADES_PER_ACT} upgrades per act cleared). So far your history only has one side.`,
    );
  }

  const shortDeaths = short.filter((e) => e.died).length;
  const stockedDeaths = stocked.filter((e) => e.died).length;
  const shortRate = shortDeaths / short.length;
  const stockedRate = stockedDeaths / stocked.length;
  const rateLines = [
    `boss fights entered under the upgrade bar: ${shortDeaths} deaths / ${short.length} fights (${pctLabel(shortRate)})`,
    `boss fights entered at or above it: ${stockedDeaths} deaths / ${stocked.length} fights (${pctLabel(stockedRate)})`,
    `upgrades banked at the boss door: ${mean1(short.map((e) => e.banked))} avg when short vs ${mean1(stocked.map((e) => e.banked))} avg when stocked`,
  ];

  if (shortDeaths + stockedDeaths === 0) {
    return healthyResult(
      ID,
      'leak',
      TITLE,
      `Across ${entries.length} boss fights, none has ended a run — including the ${short.length} entered with fewer than ${UPGRADES_PER_ACT} upgrades per act banked. Nothing to fix.`,
      rateLines,
    );
  }
  if (shortRate <= stockedRate) {
    return healthyResult(
      ID,
      'leak',
      TITLE,
      `Walking into a boss light on upgrades has not been costing you fights: ${shortDeaths} deaths in ${short.length} such fights (${pctLabel(shortRate)}), no worse than the ${pctLabel(stockedRate)} when you arrived stocked. Nothing to fix.`,
      rateLines,
    );
  }

  const bothSolid = short.length >= 20 && stocked.length >= 20;
  const strength: EvidenceStrength = bothSolid ? 'strong' : short.length >= 10 && stocked.length >= 10 ? 'moderate' : 'weak';
  const ratioBadge = bothSolid && stockedRate > 0 ? `${(shortRate / stockedRate).toFixed(1)}× deadlier` : undefined;

  const runReceipts = mostRecent(
    short.filter((e) => e.died),
    (e) => e.run.startTime,
    5,
  ).map((e) => ({
    runId: e.run.id,
    label: `${runTag(e.run)} · met ${displayName(e.bossId) || 'the act boss'} with ${e.banked} ${e.banked === 1 ? 'upgrade' : 'upgrades'} banked, needed ${upgradeTarget(e.act)}`,
    enemyIds: e.bossId ? [e.bossId] : undefined,
  }));

  return {
    id: ID,
    tier: 'leak',
    title: TITLE,
    body: `Boss fights entered under ${UPGRADES_PER_ACT} banked upgrades per act end the run ${pctLabel(shortRate)} of the time; entered at the bar, ${pctLabel(stockedRate)}. You carry ${n1(mean1(short.map((e) => e.banked)))} upgrades into the short ones. The heal buys you this fight, the smith buys you the rest of the run.`,
    ratioBadge,
    dumbbell: {
      label: 'Boss-fight death rate',
      winValue: +(stockedRate * 100).toFixed(1),
      lossValue: +(shortRate * 100).toFixed(1),
      format: 'pct',
      sampleLabel: `${entries.length} boss fights`,
      // Upgrade-bar cohorts, not win/loss cohorts.
      winLabel: 'at the bar',
      lossLabel: 'under the bar',
    },
    receiptLines: rateLines,
    runReceipts,
    confoundNote:
      'Relics and events hand out upgrades too, so a lucky run clears the bar without a single smith — and a run taking damage is forced to heal. Read this as campfire policy, not a per-fight verdict.',
    drill: {
      title: 'Smith it',
      body: `Next 5 runs: reach each act boss with ${UPGRADES_PER_ACT} upgrades per act banked. Above half HP, the campfire is a forge.`,
    },
    strength,
    expectedWinsLost: rankScore(short.length / completed.length, shortRate - stockedRate, strength),
    applicable: true,
  };
}
