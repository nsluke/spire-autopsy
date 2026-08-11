/**
 * buildAutopsy — the per-run post-mortem.
 *
 * Turns one NormalizedRun into an AutopsyReport: an HP trajectory, the
 * moments that decided the run, a Warm Coach narrative assembled from
 * computed numbers, and links to the aggregate leaks this run exhibits.
 *
 * Moment definitions:
 *  - spike:              node with the highest damageTaken, excluding the
 *                        death node (that hit belongs to the death moment).
 *  - point-of-no-return: losses only — the LAST node with hpPct > 50, i.e.
 *                        after it HP never again exceeded half; only when it
 *                        exists and is not the death node itself.
 *  - boss-entry:         losses only — entry HP into the death fight, when
 *                        the death node holds a boss or elite room.
 *  - death:              the killer, via killedByEncounter / killedByEvent.
 *  - clutch:             wins only — the lowest HP the run survived.
 *  - heal:               every rest site where HEAL was chosen.
 */
import { characterName, displayName } from './idFormat';
import { completedRuns, deathNode, entryHpPct } from './normalize';
import type {
  AutopsyMoment,
  AutopsyReport,
  LeakResult,
  NodeVisit,
  NormalizedRun,
  RoomType,
  RoomVisit,
} from './types';

const LOW_ENTRY = 0.6;

/** Most significant room of a node, for labeling: boss > elite > monster > event. */
const ROOM_SIGNIFICANCE: RoomType[] = ['boss', 'elite', 'monster', 'event'];

function primaryRoom(node: NodeVisit): RoomVisit | undefined {
  for (const type of ROOM_SIGNIFICANCE) {
    const room = node.rooms.find((r) => r.roomType === type);
    if (room) return room;
  }
  return undefined;
}

function roomLabel(node: NodeVisit): string | undefined {
  const room = primaryRoom(node);
  return room?.modelId ? displayName(room.modelId) : undefined;
}

function hpPctOf(node: NodeVisit): number {
  return node.stats.maxHp > 0 ? (node.stats.hp / node.stats.maxHp) * 100 : 0;
}

function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function buildAutopsy(run: NormalizedRun, allRuns: NormalizedRun[], leaks: LeakResult[]): AutopsyReport {
  const death = deathNode(run); // defined only for non-abandoned losses
  const lastIndex = run.nodes.length - 1;
  const killerId = run.killedByEncounter ?? run.killedByEvent;
  const killer = killerId ? displayName(killerId) : undefined;

  // ---------- trajectory ----------
  const trajectory = run.nodes.map((node) => ({
    floor: node.floor,
    act: node.act,
    hpPct: +hpPctOf(node).toFixed(1),
    hp: node.stats.hp,
    maxHp: node.stats.maxHp,
    mapPointType: node.mapPointType,
    roomLabel: roomLabel(node),
    restChoice: node.stats.restChoices[0],
    damageTaken: node.stats.damageTaken,
  }));

  // ---------- moments ----------
  const moments: AutopsyMoment[] = [];

  // heal markers
  for (const node of run.nodes) {
    if (!node.stats.restChoices.includes('HEAL')) continue;
    moments.push({
      floor: node.floor,
      kind: 'heal',
      label: `Rested — back to ${node.stats.hp}/${node.stats.maxHp} HP`,
    });
  }

  // spike: max damageTaken, excluding the death node
  let spikeNode: NodeVisit | undefined;
  for (const node of run.nodes) {
    if (death && node === death) continue;
    if (node.stats.damageTaken <= 0) continue;
    if (!spikeNode || node.stats.damageTaken > spikeNode.stats.damageTaken) spikeNode = node;
  }
  if (spikeNode) {
    moments.push({
      floor: spikeNode.floor,
      kind: 'spike',
      label: `Hardest hit: ${spikeNode.stats.damageTaken} damage`,
      detail: `${roomLabel(spikeNode) ?? 'This floor'} took ${spikeNode.stats.damageTaken} HP — the biggest single-floor loss of the run outside the end.`,
    });
  }

  if (death) {
    // point-of-no-return: last node with hpPct > 50, when it isn't the death node
    let pnr: NodeVisit | undefined;
    for (const node of run.nodes) {
      if (hpPctOf(node) > 50) pnr = node;
    }
    if (pnr && pnr !== death) {
      moments.push({
        floor: pnr.floor,
        kind: 'point-of-no-return',
        label: 'Point of no return',
        detail: `After floor ${pnr.floor}, HP never climbed above half again.`,
      });
    }

    // boss-entry: entry HP into the death fight when it was a boss/elite room
    const deathIsBig = death.rooms.some((r) => r.roomType === 'boss' || r.roomType === 'elite');
    const deathEntry = entryHpPct(run, lastIndex);
    if (deathIsBig && deathEntry !== undefined) {
      moments.push({
        floor: death.floor,
        kind: 'boss-entry',
        label: `Entered ${killer ?? 'the final fight'} at ${Math.round(deathEntry * 100)}%`,
        detail: `${death.stats.hp === 0 ? 'The fight that ended the run began' : 'The final fight began'} at ${Math.round(deathEntry * 100)}% HP.`,
      });
    }

    moments.push({
      floor: death.floor,
      kind: 'death',
      label: killer ? `Fell to ${killer}` : 'The run ended here',
      detail: `Floor ${death.floor}, act ${death.act} — ${death.stats.damageTaken} damage taken in the final fight.`,
    });
  }

  if (run.win) {
    let clutch: NodeVisit | undefined;
    for (const node of run.nodes) {
      if (!clutch || hpPctOf(node) < hpPctOf(clutch)) clutch = node;
    }
    if (clutch) {
      moments.push({
        floor: clutch.floor,
        kind: 'clutch',
        label: `Clutch: survived at ${clutch.stats.hp}/${clutch.stats.maxHp} HP (${Math.round(hpPctOf(clutch))}%)`,
      });
    }
  }

  const kindOrder: Record<AutopsyMoment['kind'], number> = {
    heal: 0,
    spike: 1,
    clutch: 2,
    'point-of-no-return': 3,
    'boss-entry': 4,
    death: 5,
  };
  moments.sort((a, b) => a.floor - b.floor || kindOrder[a.kind] - kindOrder[b.kind]);

  // ---------- linked leaks ----------
  // Healthy results ran but found no pattern — a run can't "exhibit" them.
  const applicableIds = new Set(leaks.filter((l) => l.applicable && !l.healthy).map((l) => l.id));
  const linkedLeakIds: string[] = [];
  if (death && applicableIds.has('boss-entry-hp')) {
    const entry = entryHpPct(run, lastIndex);
    const big = death.rooms.some((r) => r.roomType === 'boss' || r.roomType === 'elite');
    if (big && entry !== undefined && entry < LOW_ENTRY) linkedLeakIds.push('boss-entry-hp');
  }
  const totalRemoved = run.nodes.reduce((sum, n) => sum + n.stats.cardsRemoved.length, 0);
  if (totalRemoved === 0 && applicableIds.has('removal-discipline')) linkedLeakIds.push('removal-discipline');
  if (death && run.player.potions.length > 0 && applicableIds.has('potion-hoarding'))
    linkedLeakIds.push('potion-hoarding');

  // ---------- narrative ----------
  const narrative = buildNarrative(run, allRuns, { death, spikeNode, moments, killer, linkedLeakIds, leaks });

  return {
    runId: run.id,
    character: run.player.character,
    ascension: run.ascension,
    win: run.win,
    killedBy: killer,
    floors: run.nodes.length,
    durationMinutes: Math.round(run.runTimeSeconds / 60),
    seed: run.seed,
    actNames: run.acts.map(displayName),
    trajectory,
    moments,
    narrative,
    linkedLeakIds,
  };
}

interface NarrativeParts {
  death?: NodeVisit;
  spikeNode?: NodeVisit;
  moments: AutopsyMoment[];
  killer?: string;
  linkedLeakIds: string[];
  leaks: LeakResult[];
}

function buildNarrative(run: NormalizedRun, allRuns: NormalizedRun[], parts: NarrativeParts): string[] {
  const { death, spikeNode, moments, killer, linkedLeakIds, leaks } = parts;
  const who = `${characterName(run.player.character)} at Ascension ${run.ascension}`;
  const paragraphs: string[] = [];

  // Depth context from the rest of the history (uses every completed run except this one).
  const others = completedRuns(allRuns).filter((r) => r.id !== run.id);
  const medianFloors = Math.round(medianOf(others.map((r) => r.nodes.length)));
  const depthNote =
    others.length >= 5 && medianFloors > 0
      ? run.nodes.length > medianFloors
        ? ` — deeper than your typical run (${medianFloors} floors)`
        : run.nodes.length < medianFloors
          ? ` — shorter than your typical run (${medianFloors} floors)`
          : ` — right at your typical depth (${medianFloors} floors)`
      : '';

  if (run.win) {
    const finalNode = run.nodes[run.nodes.length - 1]; // undefined when the file recorded no floor history
    if (!finalNode) {
      paragraphs.push(
        `A win with ${who}. The file recorded no floor-by-floor history for this run, so there is no trajectory to read — but a win is a win.`,
      );
      return paragraphs;
    }
    const clutch = moments.find((m) => m.kind === 'clutch');
    paragraphs.push(
      `A win with ${who}: ${run.nodes.length} floors${depthNote}, ending at ${finalNode.stats.hp}/${finalNode.stats.maxHp} HP. ${clutch ? `The run's tightest moment came on floor ${clutch.floor} — ${clutch.label.toLowerCase()} — and you found the way through.` : 'A controlled run from start to finish.'}`,
    );
    if (spikeNode) {
      paragraphs.push(
        `The hardest single floor was ${spikeNode.floor}, where ${roomLabel(spikeNode) ?? 'the fight there'} took ${spikeNode.stats.damageTaken} HP. Worth a glance at what made that fight expensive — winning runs like this one are where those reviews are cheapest.`,
      );
    }
    return paragraphs;
  }

  if (!death) {
    // Abandoned run (or a loss whose file recorded no floors) — brief and kind.
    paragraphs.push(
      run.abandoned
        ? `This ${who} run was abandoned after ${run.nodes.length} ${run.nodes.length === 1 ? 'floor' : 'floors'}. No autopsy needed — sometimes the right call is a fresh seed.`
        : `This ${who} run ended, but the file recorded no floor-by-floor history — nothing here to dissect. On to the next one.`,
    );
    return paragraphs;
  }

  // Paragraph 1: the wound.
  const opening = `This ${who} run ended on floor ${death.floor}${killer ? ` against ${killer}` : ''}, after ${run.nodes.length} floors${depthNote}.`;
  if (spikeNode && spikeNode !== death) {
    paragraphs.push(
      `${opening} Floor ${spikeNode.floor} was the wound: ${roomLabel(spikeNode) ?? 'the fight there'} took ${spikeNode.stats.damageTaken} HP in one visit, and the run carried that scar forward.`,
    );
  } else {
    paragraphs.push(`${opening} The damage that decided it arrived all at once, in the final fight itself.`);
  }

  // Paragraph 2: the descent.
  const pnr = moments.find((m) => m.kind === 'point-of-no-return');
  const bossEntry = moments.find((m) => m.kind === 'boss-entry');
  const descent: string[] = [];
  if (pnr) descent.push(`After floor ${pnr.floor}, your HP never got back above half`);
  if (bossEntry) {
    const entry = entryHpPct(run, run.nodes.length - 1);
    descent.push(
      `${pnr ? 'and you' : 'You'} walked into ${killer ?? 'the final fight'} at ${entry !== undefined ? Math.round(entry * 100) : '?'}%`,
    );
  }
  if (descent.length) {
    paragraphs.push(
      `${descent.join(', ')}. The final fight took ${death.stats.damageTaken} more damage than you had answers for. None of this is about play skill in the fight itself — it is about the shape you arrived in.`,
    );
  }

  // Paragraph 3: the way forward.
  const linkedLeak = leaks.find((l) => l.applicable && linkedLeakIds.includes(l.id) && l.drill);
  if (linkedLeak?.drill) {
    paragraphs.push(
      `This run fits a pattern in your wider history — "${linkedLeak.title}". The drill that targets it: ${linkedLeak.drill.body} One loss is one data point; the pattern is the thing worth practicing against.`,
    );
  } else {
    paragraphs.push(
      `One loss is one data point — nothing here says anything about you that a good next run won't overwrite. The habit worth keeping: glance at the floor where the damage arrived, and ask what would have made that floor cheaper.`,
    );
  }

  return paragraphs;
}
