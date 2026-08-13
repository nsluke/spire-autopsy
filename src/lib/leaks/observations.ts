/**
 * Tier-'observation' detectors — patterns worth knowing about, ranked below
 * the leaks. All gate on >= 15 completed runs (plus their own denominators).
 *
 *  - elite-appetite:  act-1 elites fought per run, wins vs losses, among runs
 *                     that reached act 2 (same confound guard as removals).
 *  - gold-at-death:   median gold carried into the death fight; only flagged
 *                     when that median exceeds 150.
 *  - event-tax:       event damage as a share of act-1 damage taken.
 *  - rest-discipline: heals taken while healthy AND with nothing dangerous on
 *                     the path actually walked next.
 *
 * potion-hoarding used to live here; it was promoted to a tier-'leak'
 * detector in ./potions.ts (Aug 2026).
 */
import { displayName } from '../idFormat';
import { deathNode, entryGold, entryHpPct, hasRoom } from '../normalize';
import type { EvidenceStrength, LeakResult, NormalizedRun } from '../types';
import { ATTACK_TARGET, draftProfile } from './damageDrafting';
import { healthyResult, mean1, median, mostRecent, n1, notYetApplicable, pctLabel, rankScore, runTag, winRate } from './helpers';
import { richShopGold } from './removals';

const MIN_COMPLETED = 15;

// ---------- elite-appetite ----------

function act1Elites(run: NormalizedRun): number {
  let count = 0;
  for (const node of run.nodes) {
    if (node.act !== 1) continue;
    count += node.rooms.filter((r) => r.roomType === 'elite').length;
  }
  return count;
}

export function eliteAppetite(completed: NormalizedRun[]): LeakResult {
  const ID = 'elite-appetite';
  const TITLE = 'Act-1 elite appetite';
  if (completed.length < MIN_COMPLETED) {
    return notYetApplicable(
      ID,
      'observation',
      TITLE,
      `This observation compares how many act-1 elites you fight in wins versus losses. It needs at least 15 finished runs (you have ${completed.length}) — it will appear as your history grows.`,
    );
  }
  const reachedAct2 = completed.filter((r) => r.actsEntered >= 2);
  const wins = reachedAct2.filter((r) => r.win);
  const losses = reachedAct2.filter((r) => !r.win);
  if (wins.length === 0 || losses.length === 0) {
    return notYetApplicable(
      ID,
      'observation',
      TITLE,
      'Comparing elite habits needs at least one win and one loss that reached act 2 — a few more finished runs will unlock this observation.',
    );
  }

  const winAvg = mean1(wins.map(act1Elites));
  const lossAvg = mean1(losses.map(act1Elites));
  const winsLean = winAvg > lossAvg;

  // Conditioned on deck power (Aug 2026): "fight more elites" is only advice
  // if the deck can kill them, so the runs that fought an act-1 elite are
  // split by the same attack count damage-drafting measures, and the two
  // cohorts' win rates are reported instead of one undifferentiated average.
  const withProfile = reachedAct2
    .map((run) => ({ run, profile: draftProfile(run) }))
    .filter((p): p is { run: NormalizedRun; profile: NonNullable<ReturnType<typeof draftProfile>> } => !!p.profile);
  const ready = withProfile.filter((p) => p.profile.attacksBeforeElite >= ATTACK_TARGET);
  const light = withProfile.filter((p) => p.profile.attacksBeforeElite < ATTACK_TARGET);
  const powerLine =
    ready.length >= 5 && light.length >= 5
      ? `first act-1 elite met with ${ATTACK_TARGET}+ attacks drafted: ${pctLabel(winRate(ready.map((p) => p.run)))} win rate across ${ready.length} runs vs ${pctLabel(winRate(light.map((p) => p.run)))} across ${light.length} runs that met it lighter`
      : undefined;

  const base = winsLean
    ? `Wins average ${n1(winAvg)} act-1 elites; act-2+ losses average ${n1(lossAvg)}. Gannon's math says 3 act-1 elites ≈ +3 relics, +1 rare card, ~+100 gold — the runs you win are collecting that; the runs you lose are starving for it by act 2.`
    : `In runs you win, you fight ${n1(winAvg)} act-1 elites on average; in losses that reached act 2, ${n1(lossAvg)}. Your losses actually fight act-1 elites at least as often as your wins do — so if you have been forcing early elites out of principle, your own history says you have room to pick those fights more selectively.`;
  const body = powerLine
    ? `${base} It is the deck that decides: meeting the first elite with ${ATTACK_TARGET}+ attacks drafted, you win ${pctLabel(winRate(ready.map((p) => p.run)))} of the time; meeting it lighter, ${pctLabel(winRate(light.map((p) => p.run)))}.`
    : base;

  // Receipts: the recent act-2+ losses that sit on the "wrong" side of the pattern.
  const offenders = winsLean
    ? losses.filter((r) => act1Elites(r) === 0)
    : losses.filter((r) => act1Elites(r) >= 2);
  const runReceipts = mostRecent(offenders, (r) => r.startTime, 5).map((r) => ({
    runId: r.id,
    label: `${runTag(r)} · ${act1Elites(r)} act-1 ${act1Elites(r) === 1 ? 'elite' : 'elites'}, run lost`,
  }));

  return {
    id: ID,
    tier: 'observation',
    title: TITLE,
    body,
    dumbbell: {
      label: 'Act-1 elites fought',
      winValue: winAvg,
      lossValue: lossAvg,
      format: 'count',
      sampleLabel: `${wins.length} wins vs ${losses.length} act-2+ losses`,
    },
    receiptLines: [
      `act-1 elites per run: ${winAvg} across ${wins.length} wins vs ${lossAvg} across ${losses.length} act-2+ losses`,
      ...(powerLine ? [powerLine] : []),
    ],
    runReceipts,
    confoundNote:
      'Strong starts make elite fights safer, so healthy runs take more of them — elites are partly a marker of a run already going well. The deck-power split conditions on attacks drafted before the FIRST elite, not the deck you took into the third one.',
    strength: 'weak',
    expectedWinsLost: rankScore(1, Math.abs(winAvg - lossAvg) / 5, 'weak'),
    applicable: true,
  };
}

// ---------- gold-at-death ----------

export function goldAtDeath(completed: NormalizedRun[]): LeakResult {
  const ID = 'gold-at-death';
  const TITLE = 'Gold that never became power';
  if (completed.length < MIN_COMPLETED) {
    return notYetApplicable(
      ID,
      'observation',
      TITLE,
      `This observation checks how much gold you carry into the fights that kill you. It needs at least 15 finished runs (you have ${completed.length}).`,
    );
  }
  const deaths = completed.filter((r) => deathNode(r) !== undefined);
  if (deaths.length === 0) {
    return healthyResult(
      ID,
      'observation',
      TITLE,
      'No deaths in your history yet — nothing for this check to examine.',
    );
  }

  // The bar is the act's shop money (removals.richShopGold: 100/150/200), not
  // a flat 150 — 150 gold in act 3 is pocket change, in act 1 it is a relic
  // and a potion you chose not to own. Each death is judged against the act it
  // died in.
  const withGold = deaths.map((r) => {
    const node = deathNode(r)!;
    return {
      run: r,
      gold: Math.max(0, Math.round(entryGold(node))),
      act: node.act,
      bar: richShopGold(node.act),
    };
  });
  const med = median(withGold.map((d) => d.gold));
  const rich = withGold.filter((d) => d.gold >= d.bar);
  const richShare = rich.length / deaths.length;
  const receiptLines = [
    `median gold entering the death fight: ${med}`,
    `deaths carrying the act's shop money unspent (${richShopGold(1)}/${richShopGold(2)}/${richShopGold(3)} by act): ${rich.length}/${deaths.length} (${pctLabel(richShare)})`,
  ];
  if (richShare < 0.33) {
    return healthyResult(
      ID,
      'observation',
      TITLE,
      `You convert gold into power before it matters — the median gold carried into your death fights is ${med}, and only ${rich.length} of ${deaths.length} deaths held the act's shop money unspent. Nothing to fix.`,
      receiptLines,
    );
  }

  const runReceipts = mostRecent(rich, (d) => d.run.startTime, 5).map((d) => ({
    runId: d.run.id,
    label: `${runTag(d.run)} · died in act ${d.act} carrying ${d.gold} gold`,
  }));

  return {
    id: ID,
    tier: 'observation',
    title: TITLE,
    body: `${pctLabel(richShare)} of your deaths happen while carrying the act's shop money unspent — the median death fight is entered with ${med} gold. Money that could have been potions, relics, or removals before the fight that ended things. Unspent gold never loses a fight on camera; it just never shows up to one.`,
    receiptLines,
    runReceipts,
    confoundNote: `The bar scales with the act (${richShopGold(1)}/${richShopGold(2)}/${richShopGold(3)}) because prices do. A run can also die between the shop it was saving for and the fight it never survived.`,
    strength: 'weak',
    expectedWinsLost: rankScore(rich.length / completed.length, 0.1, 'weak'),
    applicable: true,
  };
}

// ---------- event-tax ----------
// Competitor-analysis import (Aug 2026): event damage as a share of act-1
// damage, comparing runs that died in act 1 against runs that cleared it.
// Pure-event nodes only — "?" nodes that resolved into fights count as combat.
//
// The events are NAMED (Aug 2026): every pure-event room carries its EVENT.*
// model id, so the damage can be attributed to the room that charged it —
// "events cost you 22%" is a statistic, "Dense Vegetation took 154 HP across
// 14 act-1 deaths" is a receipt. Nodes with several event rooms attribute to
// the first with an id; the node's damage is not split, so a stacked node
// credits its whole bill to that event.

function act1DamageSplit(run: NormalizedRun): { event: number; total: number } {
  let event = 0;
  let total = 0;
  for (const node of run.nodes) {
    if (node.act !== 1) continue;
    const dmg = node.stats.damageTaken;
    if (dmg <= 0) continue;
    total += dmg;
    const isPureEvent =
      node.rooms.some((r) => r.roomType === 'event') && !node.rooms.some((r) => r.monsterIds.length > 0);
    if (isPureEvent) event += dmg;
  }
  return { event, total };
}

/** Act-1 pure-event damage attributed to the event that charged it. */
function act1EventDamage(run: NormalizedRun): { id: string; damage: number }[] {
  const out: { id: string; damage: number }[] = [];
  for (const node of run.nodes) {
    if (node.act !== 1 || node.stats.damageTaken <= 0) continue;
    if (node.rooms.some((r) => r.monsterIds.length > 0)) continue;
    const room = node.rooms.find((r) => r.roomType === 'event' && r.modelId);
    if (room?.modelId) out.push({ id: room.modelId, damage: node.stats.damageTaken });
  }
  return out;
}

/** Events ranked by total act-1 damage across the given runs. */
function worstEvents(runs: NormalizedRun[]): { id: string; damage: number; runs: number }[] {
  const totals = new Map<string, { damage: number; runs: number }>();
  for (const run of runs) {
    const seen = new Set<string>();
    for (const hit of act1EventDamage(run)) {
      const row = totals.get(hit.id) ?? { damage: 0, runs: 0 };
      row.damage += hit.damage;
      if (!seen.has(hit.id)) {
        row.runs += 1;
        seen.add(hit.id);
      }
      totals.set(hit.id, row);
    }
  }
  return [...totals.entries()]
    .map(([id, row]) => ({ id, ...row }))
    .sort((a, b) => b.damage - a.damage);
}

export function eventTax(completed: NormalizedRun[]): LeakResult {
  const ID = 'event-tax';
  const TITLE = 'The event tax';
  if (completed.length < MIN_COMPLETED) {
    return notYetApplicable(
      ID,
      'observation',
      TITLE,
      `This observation checks whether question-mark events are bleeding you in act 1. It unlocks at 15 finished runs (you have ${completed.length}).`,
    );
  }
  const act1Deaths = completed.filter((r) => !r.win && r.actsEntered === 1);
  const cleared = completed.filter((r) => r.actsEntered >= 2);
  if (act1Deaths.length < 5 || cleared.length < 5) {
    return notYetApplicable(
      ID,
      'observation',
      TITLE,
      'Needs at least 5 act-1 deaths and 5 runs that cleared act 1 to compare event damage fairly.',
    );
  }

  const shareOf = (runs: NormalizedRun[]): number => {
    const shares = runs
      .map(act1DamageSplit)
      .filter((s) => s.total > 0)
      .map((s) => s.event / s.total);
    return shares.length ? shares.reduce((a, b) => a + b, 0) / shares.length : 0;
  };
  const deathShare = shareOf(act1Deaths);
  const clearShare = shareOf(cleared);
  const gapPp = (deathShare - clearShare) * 100;

  if (gapPp < 5) {
    return healthyResult(
      ID,
      'observation',
      TITLE,
      `Events cost you ${pctLabel(deathShare)} of act-1 damage in act-1 deaths vs ${pctLabel(clearShare)} when you clear the act — no meaningful event tax.`,
    );
  }

  const offenders = completed.filter((r) => {
    if (r.win || r.actsEntered !== 1) return false;
    const s = act1DamageSplit(r);
    return s.total > 0 && s.event / s.total > clearShare;
  });
  const worst = worstEvents(act1Deaths);
  const runReceipts = mostRecent(offenders, (r) => r.startTime, 5).map((r) => {
    const s = act1DamageSplit(r);
    const biggest = act1EventDamage(r).sort((a, b) => b.damage - a.damage)[0];
    const named = biggest ? ` (worst: ${displayName(biggest.id)}, ${biggest.damage})` : '';
    return {
      runId: r.id,
      label: `${runTag(r)} · events took ${s.event} of ${s.total} act-1 damage${named}`,
    };
  });
  const worstLine = worst
    .slice(0, 3)
    .map((e) => `${displayName(e.id)} ${e.damage} HP over ${e.runs} ${e.runs === 1 ? 'run' : 'runs'}`)
    .join(', ');

  return {
    id: ID,
    tier: 'observation',
    title: TITLE,
    body: `In runs that die in act 1, question-mark events take ${pctLabel(deathShare)} of your damage — vs ${pctLabel(clearShare)} in runs that clear the act.${worst.length ? ` The bill is itemized: ${displayName(worst[0].id)} alone has taken ${worst[0].damage} HP across ${worst[0].runs} of those ${act1Deaths.length} runs.` : ''}`,
    dumbbell: {
      label: 'Event share of act-1 damage taken',
      winValue: +(clearShare * 100).toFixed(1),
      lossValue: +(deathShare * 100).toFixed(1),
      format: 'pct',
      sampleLabel: `${act1Deaths.length} act-1 deaths vs ${cleared.length} clears`,
      winLabel: 'cleared act 1',
      lossLabel: 'died in act 1',
    },
    receiptLines: [
      `act-1 deaths (${act1Deaths.length} runs): events average ${pctLabel(deathShare)} of act-1 damage taken`,
      `act-1 clears (${cleared.length} runs): ${pctLabel(clearShare)}`,
      ...(worstLine ? [`worst offenders in act-1 deaths: ${worstLine}`] : []),
    ],
    runReceipts,
    confoundNote:
      'Correlation — a struggling run may also gamble on events out of need. Damage is attributed to the event room it was recorded at, so a node holding two events bills the first.',
    strength: gapPp >= 10 ? 'moderate' : 'weak',
    expectedWinsLost: rankScore(act1Deaths.length / completed.length, gapPp / 100, gapPp >= 10 ? 'moderate' : 'weak'),
    applicable: true,
  };
}

// ---------- rest-discipline ----------
// Pro consensus (Gannon: don't rest above ~50% HP; Baalorlord: smith > heal):
// a HEAL taken while still healthy is a free upgrade you declined — EXCEPT
// before an elite or a boss, where topping up is the correct play.
//
// This used to flag every above-50% heal and apologize for it in a confound
// note. The path the player actually walked is in the data, so the exception
// is now measured instead of excused: from each rest node we look ahead over
// the next few visited nodes, and a heal with an elite or boss in that window
// is not counted against anyone. Only heals taken healthy AND into a quiet
// stretch remain.

/** Visited nodes to look ahead from a campfire — an elite/boss this soon justifies the heal. */
const DANGER_LOOKAHEAD = 3;

/** True when the player's own next few nodes held an elite or a boss. */
function dangerAhead(run: NormalizedRun, index: number): boolean {
  const end = Math.min(run.nodes.length - 1, index + DANGER_LOOKAHEAD);
  for (let i = index + 1; i <= end; i += 1) {
    if (hasRoom(run.nodes[i], 'elite') || hasRoom(run.nodes[i], 'boss')) return true;
  }
  return false;
}

export function restDiscipline(completed: NormalizedRun[]): LeakResult {
  const ID = 'rest-discipline';
  const TITLE = 'Healing while healthy';
  if (completed.length < MIN_COMPLETED) {
    return notYetApplicable(
      ID,
      'observation',
      TITLE,
      `Checks how often you spend campfires on heals while healthy with nothing dangerous ahead. Unlocks at 15 finished runs (you have ${completed.length}).`,
    );
  }

  interface Heal {
    run: NormalizedRun;
    floor: number;
    entryPct: number;
    danger: boolean;
  }
  const heals: Heal[] = [];
  for (const run of completed) {
    run.nodes.forEach((node, i) => {
      if (!node.stats.restChoices.includes('HEAL')) return;
      const entry = entryHpPct(run, i);
      if (entry !== undefined) heals.push({ run, floor: node.floor, entryPct: entry, danger: dangerAhead(run, i) });
    });
  }
  if (heals.length < 10) {
    return notYetApplicable(ID, 'observation', TITLE, 'Needs at least 10 recorded campfire heals to judge a pattern.');
  }

  const healthyHeals = heals.filter((h) => h.entryPct > 0.5);
  const beforeDanger = healthyHeals.filter((h) => h.danger);
  const loose = healthyHeals.filter((h) => !h.danger);
  const share = loose.length / heals.length;
  const receiptLines = [
    `heals taken above 50% HP with no elite or boss in the next ${DANGER_LOOKAHEAD} nodes: ${loose.length}/${heals.length} (${pctLabel(share)})`,
    `heals above 50% HP that were followed by an elite or boss (correct, not counted): ${beforeDanger.length}`,
  ];
  if (share < 0.2) {
    return healthyResult(
      ID,
      'observation',
      TITLE,
      `Only ${pctLabel(share)} of your ${heals.length} campfire heals were taken healthy with a quiet path ahead — the other above-half heals came right before an elite or a boss, which is the right call. You smith when you're safe.`,
      receiptLines,
    );
  }

  const runReceipts = mostRecent(loose, (h) => h.run.startTime + h.floor / 1000, 5).map((h) => ({
    runId: h.run.id,
    label: `${runTag(h.run)} · healed at ${Math.round(h.entryPct * 100)}% HP on floor ${h.floor}, nothing bigger than a hallway for ${DANGER_LOOKAHEAD} nodes`,
  }));

  const strength: EvidenceStrength = share >= 0.35 && heals.length >= 25 ? 'moderate' : 'weak';
  return {
    id: ID,
    tier: 'observation',
    title: TITLE,
    body: `${pctLabel(share)} of your campfire heals were taken above half HP with no elite or boss in the ${DANGER_LOOKAHEAD} nodes you walked next — ${beforeDanger.length} other healthy heals came before real danger and are not counted. Gannon's rule holds for the rest: above ~50% with a quiet path, smith. The upgrade fights for you all run; the healing evaporates at the next act's door.`,
    receiptLines,
    runReceipts,
    confoundNote:
      'The look-ahead sees the path you took, not the map you saw — a heal that dodged a visible elite reads as loose here. Rest sites you never reached are invisible either way.',
    strength,
    expectedWinsLost: rankScore(share, 0.1, strength),
    applicable: true,
  };
}
