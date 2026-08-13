/**
 * Per-floor facts for the autopsy timeline. Pure reads off a NodeVisit —
 * the view colors and lays these out; this module only names what happened.
 */
import { displayName } from './idFormat';
import type { AutopsyMoment, NodeVisit, RoomType, RoomVisit } from './types';

export type FloorKind = 'monster' | 'elite' | 'boss' | 'event' | 'rest' | 'shop' | 'treasure';

export const FLOOR_KIND_LABEL: Record<FloorKind, string> = {
  monster: 'Fight',
  elite: 'Elite',
  boss: 'Boss',
  event: 'Event',
  rest: 'Campfire',
  shop: 'Shop',
  treasure: 'Chest',
};

const REST_LABELS: Record<string, string> = {
  SMITH: 'Smith',
  HEAL: 'Heal',
  HATCH: 'Hatch',
  DIG: 'Dig',
  COOK: 'Cook',
  LIFT: 'Lift',
  CLONE: 'Clone',
};

export function restLabel(choice: string): string {
  return REST_LABELS[choice] ?? choice.charAt(0) + choice.slice(1).toLowerCase();
}

const ROOM_PRIORITY: RoomType[] = [
  'boss',
  'elite',
  'monster',
  'treasure',
  'shop',
  'rest_site',
  'event',
];

const KIND_FROM_ROOM: Record<RoomType, FloorKind> = {
  monster: 'monster',
  elite: 'elite',
  boss: 'boss',
  event: 'event',
  rest_site: 'rest',
  shop: 'shop',
  treasure: 'treasure',
};

function primaryRoom(node: NodeVisit): RoomVisit | undefined {
  for (const type of ROOM_PRIORITY) {
    const room = node.rooms.find((r) => r.roomType === type);
    if (room) return room;
  }
  return node.rooms[0];
}

export function floorKind(node: NodeVisit): FloorKind {
  const room = primaryRoom(node);
  if (room) return KIND_FROM_ROOM[room.roomType];
  switch (node.mapPointType) {
    case 'elite':
      return 'elite';
    case 'boss':
      return 'boss';
    case 'shop':
      return 'shop';
    case 'treasure':
      return 'treasure';
    case 'rest_site':
      return 'rest';
    case 'monster':
      return 'monster';
    default:
      return 'event';
  }
}

export function floorTitle(node: NodeVisit): string {
  const room = primaryRoom(node);
  if (room?.modelId) return displayName(room.modelId);
  return FLOOR_KIND_LABEL[floorKind(node)];
}

/** Encounter id to look up monster art — combat rooms only. */
export function floorEncounterId(node: NodeVisit): string | undefined {
  const combat = node.rooms.find(
    (r) =>
      (r.roomType === 'boss' || r.roomType === 'elite' || r.roomType === 'monster') &&
      r.modelId &&
      !r.modelId.startsWith('EVENT.'),
  );
  return combat?.modelId;
}

/** EVENT.* id when this node is (or contains) a named event. */
export function floorEventId(node: NodeVisit): string | undefined {
  const room = primaryRoom(node);
  if (room?.modelId?.startsWith('EVENT.')) return room.modelId;
  return node.rooms.find((r) => r.modelId?.startsWith('EVENT.'))?.modelId;
}

export function floorTurns(node: NodeVisit): number {
  return Math.max(0, ...node.rooms.map((r) => r.turnsTaken));
}

/**
 * Human name of a chosen event option, from its localization key.
 * "TABLET_OF_TRUTH.pages.INITIAL.options.SMASH.title" → "Smash".
 * Keys without an options segment (relic titles, mod keys) return undefined —
 * a raw loc key would cheapen the log more than absence does.
 */
export function eventChoiceLabel(key: string): string | undefined {
  const m = /\.pages\.[^.]+\.options\.([^.]+)\.title$/.exec(key);
  if (!m) return undefined;
  const raw = m[1];
  if (!/^[A-Za-z0-9_]+$/.test(raw)) return undefined;
  const label = raw
    .toLowerCase()
    .split('_')
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
  return label || undefined;
}

/** Tone for an HP reading — 60% is the same boss-entry line the chart uses. */
export function hpTone(hp: number, maxHp: number): 'win' | 'ember' | 'loss' | 'muted' {
  if (maxHp <= 0) return 'muted';
  if (hp <= 0) return 'loss';
  const p = hp / maxHp;
  if (p >= 0.6) return 'win';
  if (p >= 0.4) return 'ember';
  return 'loss';
}

export interface FloorFacts {
  floor: number;
  act: number;
  kind: FloorKind;
  title: string;
  encounterId?: string;
  eventId?: string;
  turns: number;
  hp: number;
  maxHp: number;
  damageTaken: number;
  hpHealed: number;
  goldGained: number;
  goldSpent: number;
  maxHpGained: number;
  maxHpLost: number;
  picked: string[];
  /** Offered-and-skipped, only when the skip list is a small combat reward. */
  skipped: string[];
  /** True when a combat reward was skipped whole — skipped holds the full offer. */
  skippedAll: boolean;
  /** Cards that entered the deck without being a listed pick (shop, event, transform). */
  gainedExtra: string[];
  removed: string[];
  upgraded: string[];
  relics: string[];
  potions: string[];
  potionsUsed: string[];
  rest?: string;
  /** Chosen event options, prettified from their localization keys. */
  eventChoices: string[];
}

function unique(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

export function floorFacts(node: NodeVisit, runRelics?: { id: string; floorAdded?: number }[]): FloorFacts {
  const { stats } = node;
  const picked = unique(stats.cardChoices.filter((c) => c.wasPicked).map((c) => c.card.id));
  const skippedRaw = unique(stats.cardChoices.filter((c) => !c.wasPicked).map((c) => c.card.id));
  const pickedSet = new Set(picked);
  const gainedExtra = stats.cardsGained.map((c) => c.id).filter((id) => id && !pickedSet.has(id));
  const kind = floorKind(node);
  const combat = kind === 'monster' || kind === 'elite' || kind === 'boss';
  const showSkipped = kind !== 'shop' && picked.length > 0 && skippedRaw.length > 0 && skippedRaw.length <= 3;
  // A combat reward passed whole IS the skip — show the full offer.
  const skippedAll = combat && picked.length === 0 && skippedRaw.length > 0 && skippedRaw.length <= 4;
  // Relics that arrived on this floor without a choice or purchase record
  // (event grants, boss chests) — diffed off the run-end relic list. Floor 1
  // is excluded: starter relics carry floorAdded 1 and are not floor loot.
  const grantedRelics = (runRelics ?? [])
    .filter((r) => r.floorAdded === node.floor && node.floor > 1)
    .map((r) => r.id);

  return {
    floor: node.floor,
    act: node.act,
    kind,
    title: floorTitle(node),
    encounterId: floorEncounterId(node),
    eventId: floorEventId(node),
    turns: floorTurns(node),
    hp: stats.hp,
    maxHp: stats.maxHp,
    damageTaken: stats.damageTaken,
    hpHealed: stats.hpHealed,
    goldGained: stats.goldGained,
    goldSpent: stats.goldSpent,
    maxHpGained: stats.maxHpGained,
    maxHpLost: stats.maxHpLost,
    picked,
    skipped: showSkipped || skippedAll ? skippedRaw : [],
    skippedAll,
    gainedExtra,
    removed: stats.cardsRemoved.map((c) => c.id).filter(Boolean),
    upgraded: stats.cardsUpgraded.filter(Boolean),
    relics: unique([
      ...stats.relicChoices.filter((c) => c.wasPicked).map((c) => c.choice),
      ...stats.boughtRelics,
      ...grantedRelics,
    ]),
    potions: unique([
      ...stats.potionChoices.filter((c) => c.wasPicked).map((c) => c.choice),
      ...stats.boughtPotions,
    ]),
    potionsUsed: unique(stats.potionsUsed),
    rest: stats.restChoices[0],
    eventChoices: stats.eventChoiceKeys
      .map(eventChoiceLabel)
      .filter((l): l is string => l !== undefined),
  };
}

export function momentsOnFloor(moments: AutopsyMoment[], floor: number): AutopsyMoment[] {
  return moments.filter((m) => m.floor === floor);
}
