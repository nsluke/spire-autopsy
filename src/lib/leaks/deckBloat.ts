/**
 * Detector — deck-bloat (tier 'leak').
 *
 * Thesis: the deck that draws its win condition is the one that stayed small.
 * Every card added past the plan is a card that dilutes the draw, and the
 * lever is SKIPPING — removals cost gold and campfires, skipping costs
 * nothing. So this measures additions, not deck size, and coaches the skip.
 *
 * Counting rule (verified against all six reference runs): node.stats.
 * cardsGained is the complete additions ledger — every picked card reward also
 * appears there in the same node — so additions are the UNION of picks and
 * gains, deduped by id + the floor the card entered the deck. That dedupe also
 * absorbs the log's re-add entries (a card returning to the deck is logged as
 * a gain carrying its ORIGINAL floor_added_to_deck), so a Trash to Treasure
 * bouncing back is never counted as a second card. Cross-check on 1776190046:
 * 6 starters left in the final deck + 22 unique additions = its 28-card deck.
 *
 * Cohorts are ACT-MATCHED: act-1 additions are compared only across runs that
 * actually reached act 2, act-2 additions only across runs that reached act 3.
 * A run that died on floor 4 never got the chance to bloat.
 */
import type { EvidenceStrength, LeakResult, NormalizedRun } from '../types';
import {
  SYNTHETIC_DELTA_CAP,
  healthyResult,
  mean1,
  mostRecent,
  n1,
  notYetApplicable,
  pctLabel,
  rankScore,
  runTag,
  winRate,
} from './helpers';

const ID = 'deck-bloat';
const TITLE = 'The deck outgrows the plan';
const MIN_COMPLETED = 20;

/**
 * Cards you can add in act 1 and still have a deck that draws: 10 starters
 * plus 8 is an 18-card deck at the act-2 door, which sees its best card about
 * every other shuffle. Above that the plan starts waiting on the draw.
 *
 * This is the DEFAULT bar only. A player whose own wins run fatter than 8 gets
 * their own winning average instead (see act1Bar) — a drill tighter than the
 * decks you actually win with is a number the coach cannot defend, and the
 * whole engine lives on evidence a player cannot disprove from memory.
 */
export const ACT1_ADD_TARGET = 8;

/**
 * The act-1 bar this player is held to: the looser of the genre default and
 * their own winning average, floored. Never above the losing average — at that
 * point the drill would ask for nothing.
 */
export function act1Bar(winAvg: number, lossAvg: number): number {
  const own = Math.floor(winAvg);
  return Math.min(Math.max(ACT1_ADD_TARGET, own), Math.max(ACT1_ADD_TARGET, Math.ceil(lossAvg) - 1));
}

/** Unique cards that entered the deck up to and including `throughAct`. */
export function deckAdditions(run: NormalizedRun, throughAct: number): number {
  const seen = new Set<string>();
  for (const node of run.nodes) {
    if (node.act > throughAct) break;
    for (const choice of node.stats.cardChoices) {
      if (choice.wasPicked) seen.add(`${choice.card.id}|${choice.card.floorAdded ?? node.floor}`);
    }
    for (const gained of node.stats.cardsGained) seen.add(`${gained.id}|${gained.floorAdded ?? node.floor}`);
  }
  return seen.size;
}

export function deckBloatLeak(completed: NormalizedRun[]): LeakResult {
  if (completed.length < MIN_COMPLETED) {
    return notYetApplicable(
      ID,
      'leak',
      TITLE,
      `This check compares how many cards you add by the end of each act in wins versus act-matched losses. It needs at least 20 finished runs and you have ${completed.length}.`,
    );
  }

  const reachedAct2 = completed.filter((r) => r.actsEntered >= 2);
  const wins = reachedAct2.filter((r) => r.win);
  const losses = reachedAct2.filter((r) => !r.win);
  if (wins.length < 3 || losses.length < 3) {
    return notYetApplicable(
      ID,
      'leak',
      TITLE,
      'Comparing act-1 drafting needs at least 3 wins and 3 losses that cleared act 1 — otherwise the comparison is between different games.',
    );
  }

  const winAct1 = mean1(wins.map((r) => deckAdditions(r, 1)));
  const lossAct1 = mean1(losses.map((r) => deckAdditions(r, 1)));

  // Act-2 line: only runs that reached act 3 (same act-matching logic).
  const reachedAct3 = completed.filter((r) => r.actsEntered >= 3);
  const winsA3 = reachedAct3.filter((r) => r.win);
  const lossesA3 = reachedAct3.filter((r) => !r.win);
  const act2Line =
    winsA3.length >= 3 && lossesA3.length >= 3
      ? `cards added by the end of act 2 (act-3 runs only): ${mean1(winsA3.map((r) => deckAdditions(r, 2)))} across ${winsA3.length} wins vs ${mean1(lossesA3.map((r) => deckAdditions(r, 2)))} across ${lossesA3.length} losses`
      : undefined;

  const bar = act1Bar(winAct1, lossAct1);
  const bloated = reachedAct2.filter((r) => deckAdditions(r, 1) > bar);
  const lean = reachedAct2.filter((r) => deckAdditions(r, 1) <= bar);
  const bloatShare = reachedAct2.length ? bloated.length / reachedAct2.length : 0;

  const rateLines = [
    `cards added by the end of act 1 (act-2+ runs only): ${winAct1} across ${wins.length} wins vs ${lossAct1} across ${losses.length} losses`,
    `act-1 drafts over the ${bar}-card bar: ${bloated.length}/${reachedAct2.length} (${pctLabel(bloatShare)})`,
    ...(act2Line ? [act2Line] : []),
  ];

  if (lossAct1 <= winAct1) {
    return healthyResult(
      ID,
      'leak',
      TITLE,
      `Your losing decks are no fatter than your winning ones — ${n1(lossAct1)} cards added by the act-2 door against ${n1(winAct1)} in wins. Whatever is costing you runs, it is not the size of the draft.`,
      rateLines,
    );
  }

  // Ranking delta: MEASURED win-rate gap between lean and bloated act-1
  // drafts, both cohorts real; otherwise the synthetic card gap / 10, capped.
  const rateDelta =
    lean.length >= 5 && bloated.length >= 5
      ? Math.max(0, winRate(lean) - winRate(bloated))
      : Math.min(SYNTHETIC_DELTA_CAP, (lossAct1 - winAct1) / 10);

  const strength: EvidenceStrength =
    wins.length >= 10 && losses.length >= 10 && lossAct1 - winAct1 >= 2
      ? 'moderate'
      : 'weak';

  const runReceipts = mostRecent(
    losses.filter((r) => deckAdditions(r, 1) > bar),
    (r) => r.startTime,
    5,
  ).map((r) => ({
    runId: r.id,
    label: `${runTag(r)} · ${deckAdditions(r, 1)} cards added in act 1, ${r.player.deck.length}-card deck at the end`,
  }));

  return {
    id: ID,
    tier: 'leak',
    title: TITLE,
    body: `By the act-2 door your losses carry ${n1(lossAct1)} added cards; your wins, ${n1(winAct1)}. The fix is the skip, not the removal — a card you never took costs no gold and no campfire, and every card you do take is one more shuffle between you and the card you actually want.`,
    dumbbell: {
      label: 'Cards added by the end of act 1',
      winValue: winAct1,
      lossValue: lossAct1,
      format: 'count',
      sampleLabel: `${wins.length} wins vs ${losses.length} act-2+ losses`,
    },
    receiptLines: rateLines,
    runReceipts,
    confoundNote:
      'Longer runs see more rewards, so act-1 counts are compared only across runs that cleared act 1. Curses and event cards land in this count too — they are additions you did not choose.',
    drill: {
      title: 'Skip the filler',
      body: `Next 5 runs: at most ${bar} cards added in act 1 — what your own wins carry. If a reward does not beat a card already in the deck, take the skip.`,
    },
    strength,
    expectedWinsLost: rankScore(bloatShare, rateDelta, strength),
    applicable: true,
    drillBar: bar,
  };
}
