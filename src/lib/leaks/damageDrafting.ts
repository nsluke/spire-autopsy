/**
 * Detector — act-1 damage drafting (tier 'leak').
 *
 * Pro consensus (Caleb Gannon "Why You Lose in STS2"; Jorbs' Five Principles;
 * Baalorlord; STS2Guides): act 1 wants raw damage first. Gannon's benchmark is
 * enough damage for ~100 in 3 turns before the first elite, and early
 * powers/scaling picks "act like a curse". We can't see damage dealt, so the
 * honest proxy is HOW MANY ATTACK CARDS entered your deck before your first
 * act-1 elite fight (card types via the bundled metadata pack).
 *
 * "Entered your deck" counts BOTH picked card rewards (cardChoices) and cards
 * gained from shops/events (cardsGained) — an attack bought in an act-1 shop
 * is real damage the player drafted, and a receipt claiming "0 attacks" that
 * the player can falsify from memory is lethal for a receipts coach.
 *
 * cardsGained is in fact a SUPERSET of the picks: in all six reference runs
 * every picked reward is also logged as a gain at the same node (the gain
 * carries no floor_added_to_deck, the pick carries the node's floor). The
 * union is therefore deduped by id + floor added, which collapses those pairs
 * to one card and also absorbs the log's re-add entries (a card bouncing back
 * into the deck is logged as a gain carrying its ORIGINAL floor).
 *
 * Cohorts: wins vs losses among completed runs that fought at least one act-1
 * elite (runs that never reached an elite can't be judged on pre-elite
 * drafting). Also tracked: power/scaling picks inside your first 3 picks.
 */
import { cardType, metadataCoverage } from '../cards';
import type { CardRef, EvidenceStrength, LeakResult, NormalizedRun } from '../types';
import { SYNTHETIC_DELTA_CAP, healthyResult, mean1, mostRecent, n1, notYetApplicable, pctLabel, rankScore, runTag, winRate } from './helpers';

const ID = 'damage-drafting';
const TITLE = 'Act 1 wants damage first';
const MIN_COMPLETED = 20;
/**
 * The bar. Was 2, which counting only picked rewards made nearly automatic;
 * with shop/event gains now counted too, 3 is the honest translation of
 * Gannon's "~100 damage in 3 turns" benchmark.
 */
export const ATTACK_TARGET = 3;

interface DraftProfile {
  run: NormalizedRun;
  attacksBeforeElite: number;
  firstEliteFloor: number;
  earlyPowerPicks: number; // powers among the first 3 picks of the run
}

/** Attack cards that entered the deck (picks + shop/event gains) before the first act-1 elite. */
export function draftProfile(run: NormalizedRun): DraftProfile | undefined {
  const firstElite = run.nodes.find((n) => n.act === 1 && n.rooms.some((r) => r.roomType === 'elite'));
  if (!firstElite) return undefined;
  let attacks = 0;
  let picks = 0;
  let earlyPowers = 0;
  const counted = new Set<string>();
  const countAttack = (card: CardRef, floor: number) => {
    if (cardType(card.id) !== 'attack') return;
    const key = `${card.id}|${card.floorAdded ?? floor}`;
    if (counted.has(key)) return;
    counted.add(key);
    attacks += 1;
  };
  for (const node of run.nodes) {
    if (node.act !== 1) break;
    for (const choice of node.stats.cardChoices) {
      if (!choice.wasPicked) continue;
      picks += 1;
      if (picks <= 3 && cardType(choice.card.id) === 'power') earlyPowers += 1;
      if (node.floor < firstElite.floor) countAttack(choice.card, node.floor);
    }
    if (node.floor < firstElite.floor) {
      for (const gained of node.stats.cardsGained) countAttack(gained, node.floor);
    }
  }
  return { run, attacksBeforeElite: attacks, firstEliteFloor: firstElite.floor, earlyPowerPicks: earlyPowers };
}

export function damageDraftingLeak(completed: NormalizedRun[]): LeakResult {
  if (completed.length < MIN_COMPLETED) {
    return notYetApplicable(
      ID,
      'leak',
      TITLE,
      `Checks whether you draft enough damage before your first act-1 elite — the pros' top act-1 rule. Unlocks at ${MIN_COMPLETED} finished runs (you have ${completed.length}).`,
    );
  }

  const profiles = completed
    .map(draftProfile)
    .filter((p): p is DraftProfile => p !== undefined);
  const wins = profiles.filter((p) => p.run.win);
  const losses = profiles.filter((p) => !p.run.win);
  if (wins.length < 3 || losses.length < 3) {
    return notYetApplicable(
      ID,
      'leak',
      TITLE,
      'Needs a few wins and losses that each fought an act-1 elite before it can compare your pre-elite drafting.',
    );
  }

  // Metadata coverage guard: if the card DB doesn't know enough of the picked
  // ids (future game patch), say so instead of quietly undercounting attacks.
  const allPickedIds = completed.flatMap((r) =>
    r.nodes.flatMap((n) => n.stats.cardChoices.filter((c) => c.wasPicked).map((c) => c.card.id)),
  );
  const coverage = metadataCoverage(allPickedIds);

  const winAvg = mean1(wins.map((p) => p.attacksBeforeElite));
  const lossAvg = mean1(losses.map((p) => p.attacksBeforeElite));
  const lowLossShare = losses.filter((p) => p.attacksBeforeElite < ATTACK_TARGET).length / losses.length;
  const earlyPowerShare =
    profiles.filter((p) => p.earlyPowerPicks > 0).length / profiles.length;

  if (lossAvg >= ATTACK_TARGET) {
    return healthyResult(
      ID,
      'leak',
      TITLE,
      `You add ${n1(lossAvg)} attacks before your first elite even in losses (wins: ${n1(winAvg)}) — your act-1 damage drafting matches what the pros teach.`,
    );
  }
  if (lossAvg >= winAvg) {
    // No differential — but low absolute numbers aren't an endorsement.
    return healthyResult(
      ID,
      'leak',
      TITLE,
      `Your losses draft as much early damage as your wins (${n1(lossAvg)} vs ${n1(winAvg)} attacks before the first elite) — this isn't what separates them. The pros' bar is ${ATTACK_TARGET}, if you want a default to draft toward.`,
    );
  }

  const strength: EvidenceStrength = winAvg - lossAvg >= 1 && wins.length >= 8 ? 'moderate' : 'weak';

  const offenders = losses.filter((p) => p.attacksBeforeElite < ATTACK_TARGET);
  const runReceipts = mostRecent(offenders, (p) => p.run.startTime, 5).map((p) => ({
    runId: p.run.id,
    label: `${runTag(p.run)} · ${p.attacksBeforeElite} ${p.attacksBeforeElite === 1 ? 'attack' : 'attacks'} added before the floor-${p.firstEliteFloor} elite${p.earlyPowerPicks > 0 ? ', a power in the first 3 picks' : ''}`,
  }));

  // Ranking delta: MEASURED win-rate gap between on-target and light drafts
  // when both cohorts are real; otherwise the synthetic (winAvg−lossAvg)/4,
  // capped so it can't outrank measured gaps elsewhere.
  const onTarget = profiles.filter((p) => p.attacksBeforeElite >= ATTACK_TARGET);
  const light = profiles.filter((p) => p.attacksBeforeElite < ATTACK_TARGET);
  const rateDelta =
    onTarget.length >= 5 && light.length >= 5
      ? Math.max(0, winRate(onTarget.map((p) => p.run)) - winRate(light.map((p) => p.run)))
      : Math.min(SYNTHETIC_DELTA_CAP, (winAvg - lossAvg) / 4);

  return {
    id: ID,
    tier: 'leak',
    title: TITLE,
    body: `Your winning runs add ${n1(winAvg)} attacks before the first elite; your losses add ${n1(lossAvg)}. Gannon's act-1 rule: raw damage first — enough for ~100 in 3 turns — and early powers play like curses.`,
    dumbbell: {
      label: 'Attacks added before the first act-1 elite',
      winValue: winAvg,
      lossValue: lossAvg,
      format: 'count',
      sampleLabel: `${wins.length} wins vs ${losses.length} losses with an act-1 elite`,
    },
    receiptLines: [
      `losses adding under ${ATTACK_TARGET} attacks pre-elite: ${pctLabel(lowLossShare)}`,
      `runs picking a power inside their first 3 picks: ${pctLabel(earlyPowerShare)}`,
      ...(coverage < 0.95 ? [`card metadata coverage: ${pctLabel(coverage)} of picked cards (game patch ahead of our card pack)`] : []),
    ],
    runReceipts,
    confoundNote:
      'Card offers are random — some runs are never offered good attacks. This measures the tendency, not any single draft.',
    drill: {
      title: 'Damage first',
      body: `Next 5 runs: add at least ${ATTACK_TARGET} attack cards before your first elite fight — rewards, shops, and events all count.`,
    },
    strength,
    expectedWinsLost: rankScore(lowLossShare, rateDelta, strength),
    applicable: true,
  };
}
