/**
 * Detector 2 — removal-discipline (tier 'leak').
 *
 * Three angles on the same habit:
 *  (a) act-1 removals per run, wins vs losses — RESTRICTED to runs that
 *      entered act 2+, which kills the "died early, never got to remove"
 *      confounder;
 *  (b) rich shop visits (entered with >= 100 gold) left without removing
 *      a card — count and share of all rich shop visits;
 *  (c) STRICT starter Strikes/Defends remaining in the final deck,
 *      wins vs act-2+ losses.
 *
 * Gate: needs >= 20 completed runs and at least one win + one loss that
 * reached act 2.
 */
import type { EvidenceStrength, LeakResult, NodeVisit, NormalizedRun } from '../types';
import { entryGold, hasRoom } from '../normalize';
import { mean1, mostRecent, notYetApplicable, pctLabel, rankScore, runTag } from './helpers';

const ID = 'removal-discipline';
const TITLE = 'Starter cards overstay their welcome';

/**
 * Strict starter cards: STRIKE/DEFEND immediately after "CARD.", optionally
 * followed by a character suffix. Verified against fixture decks:
 * CARD.STRIKE_SILENT / CARD.DEFEND_DEFECT match; CARD.POMMEL_STRIKE and
 * CARD.FOCUSED_STRIKE do not (STRIKE is a suffix of a longer word there).
 */
export const STARTER_CARD_RE = /^CARD\.(STRIKE|DEFEND)(_[A-Z_]+)?$/;

const RICH_SHOP_GOLD = 100;

function act1Removals(run: NormalizedRun): number {
  return run.nodes.filter((n) => n.act === 1).reduce((sum, n) => sum + n.stats.cardsRemoved.length, 0);
}

function startersInFinalDeck(run: NormalizedRun): number {
  return run.player.deck.filter((c) => STARTER_CARD_RE.test(c.id)).length;
}

export function removalDisciplineLeak(completed: NormalizedRun[]): LeakResult {
  if (completed.length < 20) {
    return notYetApplicable(
      ID,
      'leak',
      TITLE,
      `This check looks at how you thin your deck — act-1 removals, shop habits, and how many starter Strikes and Defends survive to the end. It needs at least 20 finished runs to be fair about it, and you have ${completed.length}. It unlocks as your history grows.`,
    );
  }

  // (a) + (c) corpus: runs that made it to act 2, so early deaths don't skew removal counts.
  const reachedAct2 = completed.filter((r) => r.actsEntered >= 2);
  const wins = reachedAct2.filter((r) => r.win);
  const losses = reachedAct2.filter((r) => !r.win);
  if (wins.length === 0 || losses.length === 0) {
    return notYetApplicable(
      ID,
      'leak',
      TITLE,
      'To compare removal habits between wins and losses, your history needs at least one win and one loss that reached act 2. A few more finished runs will unlock it.',
    );
  }

  const winAct1 = mean1(wins.map(act1Removals));
  const lossAct1 = mean1(losses.map(act1Removals));

  // (b) rich shop visits across ALL completed runs.
  const richShops: { run: NormalizedRun; node: NodeVisit; gold: number }[] = [];
  for (const run of completed) {
    for (const node of run.nodes) {
      if (!hasRoom(node, 'shop')) continue;
      const gold = entryGold(node);
      if (gold >= RICH_SHOP_GOLD) richShops.push({ run, node, gold });
    }
  }
  const skipped = richShops.filter((s) => s.node.stats.cardsRemoved.length === 0);
  const skipRate = richShops.length ? skipped.length / richShops.length : 0;

  // (c) strict starter cards remaining at run end.
  const winStarters = mean1(wins.map(startersInFinalDeck));
  const lossStarters = mean1(losses.map(startersInFinalDeck));

  // Gap that the strength + ranking read: extra starters kept in losses plus
  // act-1 removals missing in losses (both in "cards", ~10 cards ≈ full delta).
  const gap = Math.max(0, lossStarters - winStarters) + Math.max(0, winAct1 - lossAct1);
  const bothSolid = wins.length >= 10 && losses.length >= 10;
  let strength: EvidenceStrength = 'weak';
  if (gap >= 3 && bothSolid) strength = 'strong';
  else if (gap >= 1 && bothSolid) strength = 'moderate';

  const winsLabel = `${wins.length} ${wins.length === 1 ? 'win' : 'wins'}`;
  const lossesLabel = `${losses.length} act-2+ ${losses.length === 1 ? 'loss' : 'losses'}`;

  const body = bothSolid
    ? `Your winning decks carry ${winStarters} starter cards into act 2; your losing decks carry ${lossStarters}. And you left ${pctLabel(skipRate)} of rich shop visits without buying the removal.`
    : `Wins carry ${winStarters} starters into act 2 vs ${lossStarters} in losses, and ${skipped.length} of ${richShops.length} rich shops went removal-less. Small win-side sample — hold it loosely.`;

  const runReceipts = mostRecent(skipped, (s) => s.run.startTime + s.node.floor / 1000, 5).map((s) => ({
    runId: s.run.id,
    label: `${runTag(s.run)} · left a shop holding ${s.gold} gold, no removal`,
  }));

  return {
    id: ID,
    tier: 'leak',
    title: TITLE,
    body,
    dumbbell: {
      label: 'Starter cards left in final deck',
      winValue: winStarters,
      lossValue: lossStarters,
      format: 'count',
      sampleLabel: `${winsLabel} vs ${lossesLabel}`,
    },
    receiptLines: [
      `act-1 removals per run (act-2+ runs only): ${winAct1} across ${wins.length} wins vs ${lossAct1} across ${losses.length} losses`,
      `rich shop visits (entered with 100+ gold) with no removal: ${skipped.length}/${richShops.length} (${pctLabel(skipRate)})`,
      `starter Strikes+Defends in final deck: ${winStarters} avg in wins vs ${lossStarters} avg in act-2+ losses`,
    ],
    runReceipts,
    confoundNote: 'Only act-2+ runs are compared — act-1 deaths never get the chance to remove much.',
    drill: {
      title: 'Buy the removal',
      body: 'For your next 5 runs: whenever a shop offers card removal for under 100 gold, buy it before anything else in the store.',
    },
    strength,
    expectedWinsLost: rankScore(skipped.length / completed.length, Math.min(1, gap / 10), strength),
    applicable: true,
  };
}
