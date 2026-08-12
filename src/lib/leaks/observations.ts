/**
 * Tier-'observation' detectors — patterns worth knowing about, ranked below
 * the leaks. All gate on >= 15 completed runs (plus their own denominators).
 *
 *  - elite-appetite:  act-1 elites fought per run, wins vs losses, among runs
 *                     that reached act 2 (same confound guard as removals).
 *  - potion-hoarding: deaths while still holding potions, and the share of
 *                     death fights where no potion was used.
 *  - gold-at-death:   median gold carried into the death fight; only flagged
 *                     when that median exceeds 150.
 */
import { displayName } from '../idFormat';
import { deathNode, entryGold, entryHpPct, hasRoom } from '../normalize';
import type { EvidenceStrength, LeakResult, NormalizedRun } from '../types';
import { healthyResult, mean1, median, mostRecent, n1, notYetApplicable, pctLabel, rankScore, runTag } from './helpers';

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

  const body = winsLean
    ? `Wins average ${n1(winAvg)} act-1 elites; act-2+ losses average ${n1(lossAvg)}. Gannon's math says 3 act-1 elites ≈ +3 relics, +1 rare card, ~+100 gold — the runs you win are collecting that; the runs you lose are starving for it by act 2.`
    : `In runs you win, you fight ${n1(winAvg)} act-1 elites on average; in losses that reached act 2, ${n1(lossAvg)}. Your losses actually fight act-1 elites at least as often as your wins do — so if you have been forcing early elites out of principle, your own history says you have room to pick those fights more selectively.`;

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
    ],
    runReceipts,
    confoundNote:
      'Strong starts make elite fights safer, so healthy runs take more of them — elites are partly a marker of a run already going well.',
    strength: 'weak',
    expectedWinsLost: rankScore(1, Math.abs(winAvg - lossAvg) / 5, 'weak'),
    applicable: true,
  };
}

// ---------- potion-hoarding ----------

export function potionHoarding(completed: NormalizedRun[]): LeakResult {
  const ID = 'potion-hoarding';
  const TITLE = 'Potions saved for a day that never came';
  if (completed.length < MIN_COMPLETED) {
    return notYetApplicable(
      ID,
      'observation',
      TITLE,
      `This observation checks whether potions are dying in your belt. It needs at least 15 finished runs (you have ${completed.length}).`,
    );
  }
  const deaths = completed.filter((r) => deathNode(r) !== undefined);
  if (deaths.length === 0) {
    return healthyResult(
      ID,
      'observation',
      TITLE,
      'No deaths in your history yet — nothing for this check to examine. May it stay that way.',
    );
  }

  const holding = deaths.filter((r) => r.player.potions.length > 0);
  const deathFights = deaths.filter((r) => {
    const node = deathNode(r)!;
    return hasRoom(node, 'monster') || hasRoom(node, 'elite') || hasRoom(node, 'boss');
  });
  const noPotionThrown = deathFights.filter((r) => deathNode(r)!.stats.potionsUsed.length === 0);
  const quietRate = deathFights.length ? noPotionThrown.length / deathFights.length : 0;

  const body =
    holding.length > 0
      ? `${holding.length} of your ${deaths.length} deaths ended with potions still in your belt, and in ${noPotionThrown.length} of ${deathFights.length} death fights (${pctLabel(quietRate)}) no potion was used at all. A potion spent on an ordinary fight is HP saved; a potion held for a perfect moment that never arrives is just a museum piece. When a fight starts going sideways, that is the moment.`
      : `None of your ${deaths.length} deaths ended with potions in your belt — you spend them, which is exactly right. In ${noPotionThrown.length} of ${deathFights.length} death fights no potion was thrown, usually because the belt was already empty. Nothing to fix here; carry on.`;

  const runReceipts = mostRecent(holding, (r) => r.startTime, 5).map((r) => {
    const killer = displayName(r.killedByEncounter ?? r.killedByEvent);
    return {
      runId: r.id,
      label: `${runTag(r)} · died ${killer ? `to ${killer} ` : ''}holding ${r.player.potions.length} ${r.player.potions.length === 1 ? 'potion' : 'potions'}`,
    };
  });

  return {
    id: ID,
    tier: 'observation',
    title: TITLE,
    body,
    receiptLines: [
      `deaths with unused potions still held: ${holding.length}/${deaths.length}`,
      `death fights where no potion was used: ${noPotionThrown.length}/${deathFights.length} (${pctLabel(quietRate)})`,
    ],
    runReceipts,
    strength: 'weak',
    expectedWinsLost: rankScore(holding.length / completed.length, 0.1, 'weak'),
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

  const withGold = deaths.map((r) => ({ run: r, gold: Math.max(0, Math.round(entryGold(deathNode(r)!))) }));
  const med = median(withGold.map((d) => d.gold));
  if (med <= 150) {
    return healthyResult(
      ID,
      'observation',
      TITLE,
      `You convert gold into power before it matters — the median gold carried into your death fights is ${med}, and this check only flags a pattern when that median climbs past 150. Nothing to fix.`,
      [`median gold entering the death fight: ${med}`],
    );
  }

  const rich = withGold.filter((d) => d.gold > 150);
  const runReceipts = mostRecent(rich, (d) => d.run.startTime, 5).map((d) => ({
    runId: d.run.id,
    label: `${runTag(d.run)} · died carrying ${d.gold} gold`,
  }));

  return {
    id: ID,
    tier: 'observation',
    title: TITLE,
    body: `Half of your deaths happen while carrying ${med} gold or more — money that could have been potions, relics, or removals before the fight that ended things. In runs you win, gold tends to flow through the shop and into the deck. Unspent gold at death is the quietest kind of leak: it never loses a fight on camera, it just never shows up to one.`,
    receiptLines: [
      `median gold entering the death fight: ${med}`,
      `deaths carrying more than 150 gold: ${rich.length}/${deaths.length}`,
    ],
    runReceipts,
    strength: 'weak',
    expectedWinsLost: rankScore(rich.length / completed.length, 0.1, 'weak'),
    applicable: true,
  };
}

// ---------- event-tax ----------
// Competitor-analysis import (Aug 2026): event damage as a share of act-1
// damage, comparing runs that died in act 1 against runs that cleared it.
// Pure-event nodes only — "?" nodes that resolved into fights count as combat.

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
  const runReceipts = mostRecent(offenders, (r) => r.startTime, 5).map((r) => {
    const s = act1DamageSplit(r);
    return {
      runId: r.id,
      label: `${runTag(r)} · events took ${s.event} of ${s.total} act-1 damage`,
    };
  });

  return {
    id: ID,
    tier: 'observation',
    title: TITLE,
    body: `In runs that die in act 1, question-mark events take ${pctLabel(deathShare)} of your damage — vs ${pctLabel(clearShare)} in runs that clear the act. The Spire's curiosities are pricing you.`,
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
    ],
    runReceipts,
    confoundNote: 'Correlation — a struggling run may also gamble on events out of need.',
    strength: gapPp >= 10 ? 'moderate' : 'weak',
    expectedWinsLost: rankScore(act1Deaths.length / completed.length, gapPp / 100, gapPp >= 10 ? 'moderate' : 'weak'),
    applicable: true,
  };
}

// ---------- rest-discipline ----------
// Pro consensus (Gannon: don't rest above ~50% HP; Baalorlord: smith > heal):
// a HEAL taken while still healthy is a free upgrade you declined.

export function restDiscipline(completed: NormalizedRun[]): LeakResult {
  const ID = 'rest-discipline';
  const TITLE = 'Healing while healthy';
  if (completed.length < MIN_COMPLETED) {
    return notYetApplicable(
      ID,
      'observation',
      TITLE,
      `Checks how often you spend campfires on heals while still above half HP. Unlocks at 15 finished runs (you have ${completed.length}).`,
    );
  }

  interface Heal {
    run: NormalizedRun;
    floor: number;
    entryPct: number;
  }
  const heals: Heal[] = [];
  for (const run of completed) {
    run.nodes.forEach((node, i) => {
      if (!node.stats.restChoices.includes('HEAL')) return;
      const entry = entryHpPct(run, i);
      if (entry !== undefined) heals.push({ run, floor: node.floor, entryPct: entry });
    });
  }
  if (heals.length < 10) {
    return notYetApplicable(ID, 'observation', TITLE, 'Needs at least 10 recorded campfire heals to judge a pattern.');
  }

  const healthyHeals = heals.filter((h) => h.entryPct > 0.5);
  const share = healthyHeals.length / heals.length;
  if (share < 0.2) {
    return healthyResult(
      ID,
      'observation',
      TITLE,
      `Only ${pctLabel(share)} of your ${heals.length} heals happened above half HP — you smith when you're safe, exactly as the pros teach.`,
    );
  }

  const runReceipts = mostRecent(healthyHeals, (h) => h.run.startTime + h.floor / 1000, 5).map((h) => ({
    runId: h.run.id,
    label: `${runTag(h.run)} · healed at ${Math.round(h.entryPct * 100)}% HP, floor ${h.floor}`,
  }));

  const strength: EvidenceStrength = share >= 0.35 && heals.length >= 25 ? 'moderate' : 'weak';
  return {
    id: ID,
    tier: 'observation',
    title: TITLE,
    body: `${pctLabel(share)} of your campfire heals happen while you're still above half HP. Gannon's rule: above ~50%, smith — the upgrade fights for you all run; the healing evaporates at the next act's door.`,
    receiptLines: [
      `heals taken above 50% HP: ${healthyHeals.length}/${heals.length} (${pctLabel(share)})`,
    ],
    runReceipts,
    confoundNote: 'A heal before a known elite or boss can be right even at 60% — judgment beats rules at the margins.',
    strength,
    expectedWinsLost: rankScore(share, 0.1, strength),
    applicable: true,
  };
}
