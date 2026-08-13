/**
 * Detector 2 — removal-discipline (tier 'leak').
 *
 * Three angles on the same habit:
 *  (a) act-1 removals per run, wins vs losses — RESTRICTED to runs that
 *      entered act 2+, which kills the "died early, never got to remove"
 *      confounder;
 *  (b) rich shop visits SHOPPED PAST the removal — entered with the act's
 *      removal money AND 75+ gold spent on other things while removing
 *      nothing. The data has no removal-offer or removal-price field, so a
 *      light-spend visit (gold held but barely spent) is never counted: the
 *      player may simply not have been able to afford the service, and a
 *      receipts coach doesn't guess accusations;
 *  (c) STRICT starter Strikes/Defends remaining in the final deck,
 *      wins vs act-2+ losses.
 *
 * Gate: needs >= 20 completed runs and at least one win + one loss that
 * reached act 2.
 */
import type { EvidenceStrength, LeakResult, NodeVisit, NormalizedRun } from '../types';
import { entryGold, hasRoom } from '../normalize';
import { SYNTHETIC_DELTA_CAP, mean1, mostRecent, n1, notYetApplicable, pctLabel, rankScore, runTag, winRate } from './helpers';

const ID = 'removal-discipline';
const TITLE = 'Starter cards overstay their welcome';

/**
 * Strict starter cards: STRIKE/DEFEND immediately after "CARD.", optionally
 * followed by a character suffix. Verified against fixture decks:
 * CARD.STRIKE_SILENT / CARD.DEFEND_DEFECT match; CARD.POMMEL_STRIKE and
 * CARD.FOCUSED_STRIKE do not (STRIKE is a suffix of a longer word there).
 */
export const STARTER_CARD_RE = /^CARD\.(STRIKE|DEFEND)(_[A-Z_]+)?$/;

/**
 * "Rich" entry gold, stepped by act to track scaled removal pricing —
 * a flat 100 reads act-3 pocket change as removal money.
 */
export function richShopGold(act: number): number {
  return act >= 3 ? 200 : act === 2 ? 150 : 100;
}

/** Spending this much while removing nothing = shopped past the removal, not priced out. */
export const REAL_SPEND = 75;

function act1Removals(run: NormalizedRun): number {
  return run.nodes.filter((n) => n.act === 1).reduce((sum, n) => sum + n.stats.cardsRemoved.length, 0);
}

function startersInFinalDeck(run: NormalizedRun): number {
  return run.player.deck.filter((c) => STARTER_CARD_RE.test(c.id)).length;
}

/** True when this shop visit spent real money and removed nothing. */
function shoppedPast(node: NodeVisit): boolean {
  return node.stats.cardsRemoved.length === 0 && node.stats.goldSpent >= REAL_SPEND;
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

  // (b) rich shop visits across ALL completed runs; a "skip" needs 75+ gold
  // spent on other things — see the header for why light spends don't count.
  const richShops: { run: NormalizedRun; node: NodeVisit }[] = [];
  for (const run of completed) {
    for (const node of run.nodes) {
      if (!hasRoom(node, 'shop')) continue;
      if (entryGold(node) >= richShopGold(node.act)) richShops.push({ run, node });
    }
  }
  const skipped = richShops.filter((s) => shoppedPast(s.node));
  const skipRate = richShops.length ? skipped.length / richShops.length : 0;

  // (c) strict starter cards remaining at run end.
  const winStarters = mean1(wins.map(startersInFinalDeck));
  const lossStarters = mean1(losses.map(startersInFinalDeck));

  // Gap that the strength read uses: extra starters kept in losses plus
  // act-1 removals missing in losses (both in "cards", ~10 cards ≈ full delta).
  const gap = Math.max(0, lossStarters - winStarters) + Math.max(0, winAct1 - lossAct1);
  const bothSolid = wins.length >= 10 && losses.length >= 10;
  let strength: EvidenceStrength = 'weak';
  if (gap >= 3 && bothSolid) strength = 'strong';
  else if (gap >= 1 && bothSolid) strength = 'moderate';

  const winsLabel = `${wins.length} ${wins.length === 1 ? 'win' : 'wins'}`;
  const lossesLabel = `${losses.length} act-2+ ${losses.length === 1 ? 'loss' : 'losses'}`;

  const body = bothSolid
    ? `Your winning decks carry ${n1(winStarters)} starter cards into act 2; your losing decks carry ${n1(lossStarters)}. And at ${pctLabel(skipRate)} of rich shop visits you spent real gold — none of it on the removal.`
    : `Wins carry ${n1(winStarters)} starters into act 2 vs ${n1(lossStarters)} in losses, and ${skipped.length} of ${richShops.length} rich shops got real gold with no removal. Small win-side sample — hold it loosely.`;

  const runReceipts = mostRecent(skipped, (s) => s.run.startTime + s.node.floor / 1000, 5).map((s) => ({
    runId: s.run.id,
    label: `${runTag(s.run)} · spent ${s.node.stats.goldSpent} gold at the shop, none on removal`,
  }));

  // Ranking delta: MEASURED win-rate gap between runs that shopped past a
  // removal and runs that never did, when both cohorts are real; otherwise the
  // synthetic gap/10, capped so it can't outrank measured gaps elsewhere.
  const offenders = completed.filter((r) => r.nodes.some((n) => hasRoom(n, 'shop') && entryGold(n) >= richShopGold(n.act) && shoppedPast(n)));
  const clean = completed.filter((r) => !offenders.includes(r));
  const rateDelta =
    offenders.length >= 5 && clean.length >= 5
      ? Math.max(0, winRate(clean) - winRate(offenders))
      : Math.min(SYNTHETIC_DELTA_CAP, gap / 10);

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
      `rich shop visits where ${REAL_SPEND}+ gold was spent, none on removal: ${skipped.length}/${richShops.length} (${pctLabel(skipRate)})`,
      `starter Strikes+Defends in final deck: ${winStarters} avg in wins vs ${lossStarters} avg in act-2+ losses`,
    ],
    runReceipts,
    confoundNote:
      'Only act-2+ runs are compared — act-1 deaths never get the chance to remove much. Shops where you held gold but spent little are not counted against you: the removal may not have been affordable.',
    drill: {
      title: 'Buy the removal',
      body: `For your next 5 runs: any shop where you spend ${REAL_SPEND}+ gold, the removal comes first.`,
    },
    strength,
    expectedWinsLost: rankScore(skipped.length / completed.length, rateDelta, strength),
    applicable: true,
  };
}
