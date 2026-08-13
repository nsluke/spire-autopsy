/**
 * Detector — potion-hoarding (tier 'leak'; promoted from observation, Aug 2026).
 *
 * Thesis (Gannon, Baalorlord, and every death screen ever): a potion in the
 * belt when the run ends is a card you never played. Potions are the cheapest
 * insurance in the game and the only resource that expires worthless.
 *
 * What the data CAN say, and nothing more:
 *  - node.stats.potionsUsed is recorded per node, so "this elite/boss fight
 *    got a potion" is exact;
 *  - the belt entering the run's LAST node is exact: player.potions is the
 *    end-of-run belt, and the last node's own gains/uses/discards reverse it.
 *    For a loss that node is the death fight.
 * What it CANNOT say: the belt at any earlier fight. Rebuilding it forward
 * from potion_choices + bought_potions disagrees with the recorded end belt on
 * 3 of the 6 reference runs (slot overflow and event costs are not logged), so
 * this detector never claims to know what you were holding at floor 12.
 *
 * Two independent pieces of evidence, either of which can fire it:
 *  (a) the share of elite/boss fights that got a potion, wins vs losses —
 *      per-fight denominators, so a long run cannot inflate its own share;
 *  (b) HOARDING DEATHS: runs that entered the ELITE OR BOSS fight that killed
 *      them holding 2+ potions and threw none. Both sides of that fraction are
 *      restricted to elite/boss deaths — a player who died in a hallway with a
 *      full belt must not sit in the denominator of a count that excluded him.
 * Confounders: potion offers are random, and a run already winning comfortably
 * never needs the belt — see confoundNote.
 */
import { displayName } from '../idFormat';
import { deathNode, hasRoom } from '../normalize';
import type { EvidenceStrength, LeakResult, NodeVisit, NormalizedRun } from '../types';
import {
  SYNTHETIC_DELTA_CAP,
  healthyResult,
  mostRecent,
  notYetApplicable,
  pctLabel,
  rankScore,
  runTag,
  winRate,
} from './helpers';

const ID = 'potion-hoarding';
const TITLE = 'Potions saved for a day that never came';
const MIN_COMPLETED = 20;

/** A belt this full makes "threw none" a choice rather than an empty pocket. */
export const HELD_BAR = 2;
/** Below this many percentage points, the wins-vs-losses gap is noise. */
const MIN_GAP_PP = 8;
/** Share of deaths that must be hoarding deaths to fire on that evidence alone. */
const HOARD_SHARE = 0.25;

/** Elite and boss nodes — the fights worth spending a potion on. */
export function hardFights(run: NormalizedRun): NodeVisit[] {
  return run.nodes.filter((n) => hasRoom(n, 'elite') || hasRoom(n, 'boss'));
}

/**
 * Potions held ENTERING the run's last node — the one fight where the belt is
 * exactly known (end belt, with that node's own gains and uses reversed).
 */
export function beltAtLastFight(run: NormalizedRun): number {
  const last = run.nodes[run.nodes.length - 1];
  if (!last) return 0;
  const s = last.stats;
  const acquired = s.potionChoices.filter((c) => c.wasPicked).length + s.boughtPotions.length;
  return Math.max(0, run.player.potions.length + s.potionsUsed.length + s.potionsDiscarded.length - acquired);
}

/** True when the run ended in an elite or boss fight — the cohort (b) judges. */
export function diedInHardFight(run: NormalizedRun): boolean {
  const death = deathNode(run);
  return death !== undefined && (hasRoom(death, 'elite') || hasRoom(death, 'boss'));
}

/** A death in an elite/boss fight entered holding 2+ potions, none thrown. */
export function isHoardingDeath(run: NormalizedRun): boolean {
  const death = deathNode(run);
  if (!death) return false;
  if (!hasRoom(death, 'elite') && !hasRoom(death, 'boss')) return false;
  return death.stats.potionsUsed.length === 0 && beltAtLastFight(run) >= HELD_BAR;
}

/** Share of a run's elite/boss fights that got at least one potion; undefined = none fought. */
export function armedShare(run: NormalizedRun): number | undefined {
  const fights = hardFights(run);
  if (!fights.length) return undefined;
  return fights.filter((n) => n.stats.potionsUsed.length > 0).length / fights.length;
}

function tally(runs: NormalizedRun[]): { fights: number; armed: number } {
  let fights = 0;
  let armed = 0;
  for (const run of runs) {
    for (const node of hardFights(run)) {
      fights += 1;
      if (node.stats.potionsUsed.length > 0) armed += 1;
    }
  }
  return { fights, armed };
}

export function potionHoarding(completed: NormalizedRun[]): LeakResult {
  if (completed.length < MIN_COMPLETED) {
    return notYetApplicable(
      ID,
      'leak',
      TITLE,
      `This check compares how often your elite and boss fights get a potion in wins versus losses, and counts the elite and boss deaths that ended with a full belt. It needs at least 20 finished runs and you have ${completed.length}.`,
    );
  }

  const wins = completed.filter((r) => r.win);
  const losses = completed.filter((r) => !r.win);
  const winSide = tally(wins);
  const lossSide = tally(losses);
  if (winSide.fights < 10 || lossSide.fights < 10) {
    return notYetApplicable(
      ID,
      'leak',
      TITLE,
      'Comparing potion habits needs at least 10 elite-or-boss fights on each side of the win/loss line. A few more finished runs will unlock it.',
    );
  }

  const winShare = winSide.armed / winSide.fights;
  const lossShare = lossSide.armed / lossSide.fights;
  const gapPp = (winShare - lossShare) * 100;

  // Numerator and denominator both restricted to elite/boss deaths: a hallway
  // death is not judged by this evidence, so it is not counted against it either.
  const deaths = completed.filter(diedInHardFight);
  const hoardDeaths = deaths.filter(isHoardingDeath);
  const hoardShare = deaths.length ? hoardDeaths.length / deaths.length : 0;

  const rateLines = [
    `elite/boss fights that got a potion: ${winSide.armed}/${winSide.fights} in wins (${pctLabel(winShare)}) vs ${lossSide.armed}/${lossSide.fights} in losses (${pctLabel(lossShare)})`,
    `elite/boss deaths that entered the killing fight holding ${HELD_BAR}+ potions and threw none: ${hoardDeaths.length}/${deaths.length}`,
  ];

  if (gapPp < MIN_GAP_PP && hoardShare < HOARD_SHARE) {
    return healthyResult(
      ID,
      'leak',
      TITLE,
      `You throw potions at the fights that matter: ${pctLabel(lossShare)} of elite and boss fights in losses got one, against ${pctLabel(winShare)} in wins, and only ${hoardDeaths.length} of ${deaths.length} elite or boss deaths ended with a full belt. Nothing to fix.`,
      rateLines,
    );
  }

  // Ranking delta: MEASURED win-rate gap between runs that arm most of their
  // hard fights and runs that don't; the synthetic fallback is capped.
  const armedRuns = completed.filter((r) => {
    const share = armedShare(r);
    return share !== undefined && share >= 0.5;
  });
  const quietRuns = completed.filter((r) => {
    const share = armedShare(r);
    return share !== undefined && share < 0.5;
  });
  const rateDelta =
    armedRuns.length >= 5 && quietRuns.length >= 5
      ? Math.max(0, winRate(armedRuns) - winRate(quietRuns))
      : Math.min(SYNTHETIC_DELTA_CAP, Math.max(gapPp / 100, 0.1));

  // rateDelta is a per-RUN win-rate gap, so the frequency must be per-run too
  // (the share of runs that leave most hard fights unarmed) — pairing it with
  // a per-fight frequency would multiply the same evidence twice.
  const quietRunShare = quietRuns.length / completed.length;
  const bothSolid = winSide.fights >= 25 && lossSide.fights >= 25;
  const strength: EvidenceStrength = bothSolid && gapPp >= MIN_GAP_PP ? 'moderate' : 'weak';

  const body =
    gapPp >= MIN_GAP_PP
      ? `Your wins throw a potion into ${pctLabel(winShare)} of elite and boss fights; your losses, ${pctLabel(lossShare)}. Same belt, different willingness to open it. ${hoardDeaths.length} of your ${deaths.length} elite or boss deaths ended with ${HELD_BAR}+ potions unused in the fight that killed you.`
      : `${hoardDeaths.length} of your ${deaths.length} elite or boss deaths (${pctLabel(hoardShare)}) entered the fight that killed you holding ${HELD_BAR}+ potions and threw none. A potion kept for a perfect moment is a card you never played; the fight that ends the run is the moment.`;

  const runReceipts = mostRecent(hoardDeaths, (r) => r.startTime, 5).map((r) => {
    const killerId = r.killedByEncounter ?? r.killedByEvent;
    const killer = displayName(killerId);
    const held = beltAtLastFight(r);
    return {
      runId: r.id,
      label: `${runTag(r)} · died ${killer ? `to ${killer} ` : ''}holding ${held} ${held === 1 ? 'potion' : 'potions'}, none thrown`,
      enemyIds: killerId ? [killerId] : undefined,
    };
  });

  return {
    id: ID,
    tier: 'leak',
    title: TITLE,
    body,
    dumbbell: {
      label: 'Elite/boss fights that got a potion',
      winValue: +(winShare * 100).toFixed(1),
      lossValue: +(lossShare * 100).toFixed(1),
      format: 'pct',
      sampleLabel: `${winSide.fights} fights in wins vs ${lossSide.fights} in losses`,
    },
    receiptLines: rateLines,
    runReceipts,
    confoundNote:
      'Potion offers are random, and a run already going well needs the belt less — the belt at the final fight is measured exactly, earlier fights are not.',
    drill: {
      title: 'Throw them at the boss',
      body: `Next 5 runs: every elite and boss gets a potion. Reaching the last fight of a run with ${HELD_BAR}+ potions unthrown counts as a miss.`,
    },
    strength,
    expectedWinsLost: rankScore(quietRunShare, rateDelta, strength),
    applicable: true,
  };
}
