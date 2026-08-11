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
import { deathNode, entryGold, hasRoom } from '../normalize';
import type { LeakResult, NormalizedRun } from '../types';
import { healthyResult, mean1, median, mostRecent, notYetApplicable, pctLabel, rankScore, runTag } from './helpers';

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
    ? `In runs you win, you fight ${winAvg} act-1 elites on average; in losses that reached act 2, ${lossAvg}. Your winning runs lean into elites early — the relics and card quality they pay out seem to be part of how your wins get built. Worth noticing, not forcing: this is a pattern in your history, not a law.`
    : `In runs you win, you fight ${winAvg} act-1 elites on average; in losses that reached act 2, ${lossAvg}. Your losses actually fight act-1 elites at least as often as your wins do — so if you have been forcing early elites out of principle, your own history says you have room to pick those fights more selectively.`;

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

  const runReceipts = mostRecent(holding, (r) => r.startTime, 5).map((r) => ({
    runId: r.id,
    label: `${runTag(r)} · died to ${displayName(r.killedByEncounter ?? r.killedByEvent)} holding ${r.player.potions.length} ${r.player.potions.length === 1 ? 'potion' : 'potions'}`,
  }));

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
