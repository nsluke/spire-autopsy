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
  NarrativeBeat,
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

function buildNarrative(run: NormalizedRun, allRuns: NormalizedRun[], parts: NarrativeParts): NarrativeBeat[] {
  const { death, spikeNode, moments, killer, linkedLeakIds, leaks } = parts;
  const who = `${characterName(run.player.character)} at A${run.ascension}`;
  const beats: NarrativeBeat[] = [];

  // Depth context from the rest of the history (every completed run except this one).
  const others = completedRuns(allRuns).filter((r) => r.id !== run.id);
  const medianFloors = Math.round(medianOf(others.map((r) => r.nodes.length)));
  const depthNote =
    others.length >= 5 && medianFloors > 0 && run.nodes.length > medianFloors
      ? ` — deeper than your median run (${medianFloors})`
      : '';

  if (run.win) {
    const finalNode = run.nodes[run.nodes.length - 1]; // undefined when the file recorded no floor history
    if (!finalNode) {
      beats.push({ text: `A win with ${who}. No floor history in the file — but a win is a win.`, floors: [] });
      return beats;
    }
    const clutch = moments.find((m) => m.kind === 'clutch');
    beats.push({
      text: `A win with ${who}: ${run.nodes.length} floors, out at ${finalNode.stats.hp}/${finalNode.stats.maxHp} HP.`,
      floors: [finalNode.floor],
    });
    if (clutch) {
      beats.push({
        text: `Tightest squeeze: floor ${clutch.floor} — ${clutch.label.toLowerCase()}.`,
        floors: [clutch.floor],
      });
    }
    if (spikeNode) {
      beats.push({
        text: `Most expensive floor: ${spikeNode.floor} — ${roomLabel(spikeNode) ?? 'that fight'} took ${spikeNode.stats.damageTaken} HP.`,
        floors: [spikeNode.floor],
      });
    }
    return beats;
  }

  if (!death) {
    beats.push({
      text: run.abandoned
        ? `Abandoned after ${run.nodes.length} ${run.nodes.length === 1 ? 'floor' : 'floors'}. Sometimes the right call is a fresh seed.`
        : `This ${who} run ended with no floor history recorded — nothing to dissect.`,
      floors: [],
    });
    return beats;
  }

  // The wound.
  if (spikeNode && spikeNode !== death) {
    beats.push({
      text: `Floor ${spikeNode.floor} was the wound: ${roomLabel(spikeNode) ?? 'the fight'} took ${spikeNode.stats.damageTaken} HP${depthNote}.`,
      floors: [spikeNode.floor],
    });
  }

  // The descent.
  const pnr = moments.find((m) => m.kind === 'point-of-no-return');
  if (pnr) {
    beats.push({
      text: `After floor ${pnr.floor}, HP never crossed half again.`,
      floors: [pnr.floor, death.floor],
    });
  }

  // The kill.
  const bossEntry = moments.find((m) => m.kind === 'boss-entry');
  const entry = entryHpPct(run, run.nodes.length - 1);
  beats.push({
    text: bossEntry
      ? `Walked into ${killer ?? 'the final fight'} at ${entry !== undefined ? Math.round(entry * 100) : '?'}% — it had ${death.stats.damageTaken} damage waiting.`
      : `${killer ?? 'The final fight'} ended it on floor ${death.floor} — ${death.stats.damageTaken} damage in the fight.`,
    floors: [death.floor],
  });

  // The way forward — one line, only when a real pattern matches.
  const linkedLeak = leaks.find((l) => l.applicable && linkedLeakIds.includes(l.id) && l.drill);
  if (linkedLeak?.drill) {
    beats.push({
      text: `Fits your wider pattern — “${linkedLeak.title}”. Drill: ${linkedLeak.drill.body}`,
      floors: [],
    });
  }

  return beats;
}
