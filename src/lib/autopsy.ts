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
import { characterName, displayName, shortDate } from './idFormat';
import { floorEncounterId, floorTurns } from './floorLog';
import { potionLabel } from './items';
import { isHoardingDeath } from './leaks/potions';
import { completedRuns, deathNode, entryGold, entryHpPct } from './normalize';
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
/** Entry gold above this links / narrates gold-at-death — same line the observation draws. */
const RICH_DEATH = 150;
/** A point-of-no-return further than this from the death is a plateau, not a slide. */
const SLIDE_FLOORS = 8;

/**
 * A narrative beat plus the id lists RichLine needs to wrap item names for
 * hover art. Extends the public NarrativeBeat shape structurally so the
 * report type in types.ts is untouched.
 */
export interface AutopsyBeat extends NarrativeBeat {
  potionIds?: string[];
  relicIds?: string[];
  /** Another run this beat cites (win contrast) — linkable as #/autopsy/<id>. */
  runRef?: string;
}

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
    encounterId: floorEncounterId(node),
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
      detail: `${roomLabel(spikeNode) ?? 'This floor'} took ${spikeNode.stats.damageTaken} HP — the biggest single hit ${death ? 'outside the killing blow' : 'of the run'}.`,
    });
  }

  if (death) {
    // point-of-no-return: last node with hpPct > 50, when it isn't the death
    // node. Only a death within SLIDE_FLOORS of it reads as a real descent;
    // a long stretch of stable sub-half HP gets the neutral observation.
    let pnr: NodeVisit | undefined;
    for (const node of run.nodes) {
      if (hpPctOf(node) > 50) pnr = node;
    }
    if (pnr && pnr !== death) {
      const slide = death.floor - pnr.floor <= SLIDE_FLOORS;
      moments.push({
        floor: pnr.floor,
        kind: 'point-of-no-return',
        label: slide ? 'Point of no return' : 'Below half from here',
        detail: slide
          ? `After floor ${pnr.floor}, HP never climbed above half again.`
          : `From floor ${pnr.floor} on, you fought below half HP.`,
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

  let clutchNode: NodeVisit | undefined;
  if (run.win) {
    for (const node of run.nodes) {
      if (!clutchNode || hpPctOf(node) < hpPctOf(clutchNode)) clutchNode = node;
    }
    if (clutchNode) {
      moments.push({
        floor: clutchNode.floor,
        kind: 'clutch',
        label: `Clutch: survived at ${clutchNode.stats.hp}/${clutchNode.stats.maxHp} HP (${Math.round(hpPctOf(clutchNode))}%)`,
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
  // Link the potion leak on the card's own predicate, not a looser one: an
  // elite/boss death entered holding potions that never got thrown.
  if (isHoardingDeath(run) && applicableIds.has('potion-hoarding')) linkedLeakIds.push('potion-hoarding');
  if (death && applicableIds.has('gold-at-death') && entryGold(death) > RICH_DEATH)
    linkedLeakIds.push('gold-at-death');

  // ---------- narrative ----------
  const narrative = buildNarrative(run, allRuns, {
    death,
    spikeNode,
    clutchNode,
    moments,
    killer,
    killerId,
    linkedLeakIds,
    leaks,
  });

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
  clutchNode?: NodeVisit;
  moments: AutopsyMoment[];
  killer?: string;
  killerId?: string;
  linkedLeakIds: string[];
  leaks: LeakResult[];
}

/** "Fire Potion", "A and B", "A, B, and C". */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`;
}

const ORDINALS = ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'];

function ordinal(n: number): string {
  return ORDINALS[n - 1] ?? `${n}th`;
}

/** Deck size when the run stood on `floor`, from run-end floorAdded stamps. */
function deckSizeAtFloor(run: NormalizedRun, floor: number): number {
  return run.player.deck.filter((c) => (c.floorAdded ?? 1) <= floor).length;
}

/**
 * Most recent same-character run that fought this run's killer encounter and
 * walked out alive (the node is not that run's death node).
 */
function findSurvivedFight(
  run: NormalizedRun,
  candidates: NormalizedRun[],
): { run: NormalizedRun; node: NodeVisit; index: number } | undefined {
  const killerId = run.killedByEncounter;
  if (!killerId) return undefined;
  let best: { run: NormalizedRun; node: NodeVisit; index: number } | undefined;
  for (const r of candidates) {
    const rDeath = deathNode(r);
    r.nodes.forEach((node, index) => {
      if (node === rDeath || node.stats.hp <= 0) return;
      if (floorEncounterId(node) !== killerId) return;
      if (!best || r.startTime > best.run.startTime) best = { run: r, node, index };
    });
  }
  return best;
}

function combatId(node: NodeVisit | undefined): string[] | undefined {
  if (!node) return undefined;
  const id = floorEncounterId(node);
  if (!id || (!id.startsWith('ENCOUNTER.') && !id.startsWith('MONSTER.'))) return undefined;
  return [id];
}

function combatIds(...ids: (string | undefined)[]): string[] | undefined {
  const out = ids.filter((id): id is string => {
    if (!id) return false;
    return id.startsWith('ENCOUNTER.') || id.startsWith('MONSTER.') || id.startsWith('EVENT.');
  });
  return out.length > 0 ? out : undefined;
}

function buildNarrative(run: NormalizedRun, allRuns: NormalizedRun[], parts: NarrativeParts): AutopsyBeat[] {
  const { death, spikeNode, clutchNode, moments, killer, killerId, linkedLeakIds, leaks } = parts;
  const who = `${characterName(run.player.character)} at A${run.ascension}`;
  const beats: AutopsyBeat[] = [];

  // Depth context from the rest of the history (every completed run except this one).
  const others = completedRuns(allRuns).filter((r) => r.id !== run.id);
  const sameCharacter = others.filter((r) => r.player.character === run.player.character);
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
    // First win at (or above) this ascension with this character = the wall
    // fell. Not celebrated when the character had already been playing higher
    // — a win below the frontier of play isn't a breakthrough. Ties on
    // startTime break by id so exactly one run can be "first".
    const before = (r: NormalizedRun) =>
      r.startTime < run.startTime || (r.startTime === run.startTime && r.id < run.id);
    const breakthrough =
      !sameCharacter.some((r) => before(r) && r.win && r.ascension >= run.ascension) &&
      !sameCharacter.some((r) => before(r) && r.ascension > run.ascension);
    if (breakthrough) {
      beats.push({
        text: `Breakthrough — ${characterName(run.player.character)}'s first win at A${run.ascension}. The wall came down.`,
        floors: [],
      });
    }
    if (clutch && clutchNode) {
      const { hp, maxHp } = clutchNode.stats;
      beats.push({
        text: `Tightest squeeze: floor ${clutchNode.floor} — survived at ${hp}/${maxHp} HP (${Math.round(hpPctOf(clutchNode))}%).`,
        floors: [clutchNode.floor],
      });
    }
    if (spikeNode) {
      beats.push({
        text: `Most expensive floor: ${spikeNode.floor} — ${roomLabel(spikeNode) ?? 'that fight'} took ${spikeNode.stats.damageTaken} HP.`,
        floors: [spikeNode.floor],
        enemyIds: combatId(spikeNode),
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

  // Wall context: a loss at this character's CURRENT wall — their highest
  // level played and never beaten — is a siege attempt, and the autopsy
  // numbers it. Push-through framing, never "play lower": the beat is
  // skipped once the level is beaten OR once the character has moved higher,
  // so an outgrown level is never presented as an open objective.
  const highestPlayed = Math.max(run.ascension, ...sameCharacter.map((r) => r.ascension));
  if (
    run.ascension >= highestPlayed &&
    !sameCharacter.some((r) => r.win && r.ascension >= run.ascension)
  ) {
    const priorAttempts = sameCharacter
      .filter(
        (r) =>
          r.ascension === run.ascension &&
          (r.startTime < run.startTime || (r.startTime === run.startTime && r.id < run.id)),
      )
      .sort((a, b) => a.startTime - b.startTime || (a.id < b.id ? -1 : 1));
    const attemptNo = priorAttempts.length + 1;
    beats.push({
      text: `A${run.ascension} wall attempt #${attemptNo} with ${characterName(run.player.character)} — the level is still standing.`,
      floors: [],
    });

    // Siege progress: this attempt's depth against the earlier ones.
    const withDepth = priorAttempts.filter((r) => r.nodes.length > 0);
    if (run.nodes.length > 0 && withDepth.length > 0) {
      const deepestPrior = withDepth.reduce((a, b) => (b.nodes.length > a.nodes.length ? b : a));
      const bestDepth = deepestPrior.nodes.length;
      if (run.nodes.length > bestDepth) {
        const listable = withDepth.length === priorAttempts.length && withDepth.length <= 4;
        const fellOn = listable
          ? `#${withDepth.length === 1 ? '1' : `1–${withDepth.length}`} fell on ${
              withDepth.length === 1 ? 'floor' : 'floors'
            } ${nameList(withDepth.map((r) => String(r.nodes.length)))}`
          : `the deepest before stopped on floor ${bestDepth}`;
        beats.push({
          text: `Attempt #${attemptNo} is your deepest push at this wall yet — ${fellOn}.`,
          floors: [],
        });
      } else {
        const bestNo = priorAttempts.indexOf(deepestPrior) + 1;
        const rel = run.nodes.length === bestDepth ? 'level with' : 'shy of';
        beats.push({
          text: `Attempt #${attemptNo} stopped on floor ${run.nodes.length} — ${rel} attempt #${bestNo}'s floor ${bestDepth}.`,
          floors: [],
        });
      }
    }

    // Repeat killer: the same encounter closing multiple attempts at this wall.
    const killerKey = run.killedByEncounter ?? run.killedByEvent;
    if (killerKey && killer) {
      const priorKills = priorAttempts.filter(
        (r) => (r.killedByEncounter ?? r.killedByEvent) === killerKey,
      ).length;
      if (priorKills >= 1) {
        beats.push({
          text: `${ordinal(priorKills + 1)} time ${killer} has ended a wall attempt.`,
          floors: [],
          enemyIds: combatIds(killerKey),
        });
      }
    }
  }

  // The wound.
  if (spikeNode && spikeNode !== death) {
    beats.push({
      text: `Floor ${spikeNode.floor} was the wound: ${roomLabel(spikeNode) ?? 'the fight'} took ${spikeNode.stats.damageTaken} HP${depthNote}.`,
      floors: [spikeNode.floor],
      enemyIds: combatId(spikeNode),
    });
  }

  // The descent — or, when the run held steady below half for a long
  // stretch, the neutral observation (a plateau is not a death spiral).
  const pnr = moments.find((m) => m.kind === 'point-of-no-return');
  if (pnr) {
    beats.push({
      text:
        pnr.label === 'Point of no return'
          ? `After floor ${pnr.floor}, HP never crossed half again.`
          : `From floor ${pnr.floor} on, you fought below half HP.`,
      floors: [pnr.floor, death.floor],
    });
  }

  // The kill: entry HP whenever the data has it (hallway deaths included),
  // and the fight's length — 38 damage over 2 turns is a burst, over 9 a grind.
  const bossEntry = moments.find((m) => m.kind === 'boss-entry');
  const entry = entryHpPct(run, run.nodes.length - 1);
  const dmg = death.stats.damageTaken;
  const turns = floorTurns(death);
  const overTurns = turns > 0 ? ` over ${turns} ${turns === 1 ? 'turn' : 'turns'}` : '';
  beats.push({
    text: bossEntry
      ? `Walked into ${killer ?? 'the final fight'} at ${entry !== undefined ? Math.round(entry * 100) : '?'}% — ${dmg} damage${overTurns} ended it.`
      : entry !== undefined
        ? `${killer ?? 'The final fight'} ended it on floor ${death.floor} — you walked in at ${Math.round(entry * 100)}% and took ${dmg} damage${overTurns}.`
        : `${killer ?? 'The final fight'} ended it on floor ${death.floor} — ${dmg} damage${overTurns} in the fight.`,
    floors: [death.floor],
    enemyIds: combatIds(killerId),
  });

  // The death kit: what the run died holding. Unthrown potions and a fat
  // purse are the coach's first question answered.
  const held = run.player.potions;
  const goldHeld = Math.max(0, Math.round(entryGold(death)));
  const kitBits: string[] = [];
  if (held.length > 0) {
    const unthrown =
      death.stats.potionsUsed.length === 0
        ? ` — ${held.length === 1 ? 'never' : held.length === 2 ? 'neither' : 'none'} thrown`
        : '';
    kitBits.push(`holding ${nameList(held.map(potionLabel))}${unthrown}`);
  }
  if (goldHeld >= 100) kitBits.push(`with ${goldHeld} gold unspent`);
  if (kitBits.length > 0) {
    beats.push({
      text: `Died ${kitBits.join(held.length > 0 && death.stats.potionsUsed.length === 0 ? ' — ' : ', ')}.`,
      floors: [death.floor],
      potionIds: held.length > 0 ? [...held] : undefined,
    });
  }

  // Win contrast: the player HAS beaten this fight before — what differed.
  const survived = findSurvivedFight(run, sameCharacter);
  if (survived && killer) {
    const thenEntry = entryHpPct(survived.run, survived.index);
    const date = shortDate(survived.run.startTime);
    const nowPct = entry !== undefined ? Math.round(entry * 100) : undefined;
    const thenPct = thenEntry !== undefined ? Math.round(thenEntry * 100) : undefined;
    let text: string;
    if (thenPct !== undefined && nowPct !== undefined && Math.abs(thenPct - nowPct) >= 8) {
      text = `You've beaten ${killer} before — ${date} you entered at ${thenPct}% and walked out. Today: ${nowPct}%.`;
    } else {
      const thenDeck = deckSizeAtFloor(survived.run, survived.node.floor);
      const nowDeck = deckSizeAtFloor(run, death.floor);
      text =
        thenDeck > 0 && nowDeck > 0 && thenDeck !== nowDeck
          ? `You've beaten ${killer} before — ${date}, carrying ${thenDeck} cards to today's ${nowDeck}.`
          : `You've beaten ${killer} before — ${date} you walked out of the same fight.`;
    }
    beats.push({ text, floors: [], enemyIds: combatIds(run.killedByEncounter), runRef: survived.run.id });
  }

  // Draft thinness on the death act: only when the skip rate is extreme.
  const actNodes = run.nodes.filter((n) => n.act === death.act);
  const rewardScreens = actNodes.filter((n) => n.stats.cardChoices.length > 0);
  const passedScreens = rewardScreens.filter((n) => !n.stats.cardChoices.some((c) => c.wasPicked));
  if (rewardScreens.length >= 5 && passedScreens.length / rewardScreens.length >= 0.6) {
    beats.push({
      text: `Passed on ${passedScreens.length} of ${rewardScreens.length} card rewards in act ${death.act}.`,
      floors: [],
    });
  }

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
