/**
 * Normalizes a parsed .run file (v8 or v9) into the internal NormalizedRun model.
 *
 * Correctness notes, each verified against the 231-run audit corpus:
 *  - map_point_history is a list of acts, each a list of visited nodes in order.
 *    Floor numbers are the 1-based global node index (matches floor_added_to_deck).
 *  - A node can hold MULTIPLE rooms ("?" nodes: event that leads into a fight) —
 *    always iterate rooms[], never assume rooms[0].
 *  - Co-op exists (2–4 players). player_stats must be joined to players[] by
 *    player_id; solo files use id 1, co-op files use Steam ids. The "primary"
 *    player is players[0] (the local profile's owner in observed files).
 *  - Every list field may be absent; treat absence as empty.
 *  - HP/gold in node stats are the values AFTER the node resolved.
 */
import { runFileSchema } from './schema';
import type {
  CardChoice,
  CardRef,
  NodeStats,
  NodeVisit,
  NormalizedRun,
  RoomType,
  RoomVisit,
  RunSummary,
  SimpleChoice,
} from './types';

const NONE = 'NONE.NONE';

function toCardRef(c: { id: string; current_upgrade_level?: number; floor_added_to_deck?: number }): CardRef {
  return { id: c.id, upgradeLevel: c.current_upgrade_level ?? 0, floorAdded: c.floor_added_to_deck };
}

const KNOWN_ROOM_TYPES: RoomType[] = ['monster', 'elite', 'boss', 'event', 'rest_site', 'shop', 'treasure'];

function toRoom(r: { room_type: string; model_id?: string; monster_ids?: string[]; turns_taken?: number }): RoomVisit {
  const roomType = (KNOWN_ROOM_TYPES as string[]).includes(r.room_type) ? (r.room_type as RoomType) : 'event';
  return {
    roomType,
    modelId: r.model_id,
    monsterIds: r.monster_ids ?? [],
    turnsTaken: r.turns_taken ?? 0,
  };
}

export class RunParseError extends Error {
  constructor(message: string, readonly fileName?: string) {
    super(message);
    this.name = 'RunParseError';
  }
}

/** Derive the stable run id from its filename (e.g. "1785858459.run"). */
export function runIdFromFileName(fileName: string): string {
  return fileName.replace(/\.run(\.backup)?$/i, '');
}

export function normalizeRun(json: unknown, fileName: string): NormalizedRun {
  const parsed = runFileSchema.safeParse(json);
  if (!parsed.success) {
    throw new RunParseError(`not a recognizable run file: ${parsed.error.issues[0]?.message ?? 'unknown'}`, fileName);
  }
  const raw = parsed.data;
  const primary = raw.players[0];
  const primaryId = primary.id;

  const nodes: NodeVisit[] = [];
  let floor = 0;
  raw.map_point_history.forEach((act, actIdx) => {
    for (const node of act) {
      floor += 1;
      const allStats = node.player_stats ?? [];
      // Join by player_id, tolerating number-vs-string id encodings. Solo files
      // may safely fall back to the only row; in co-op a missing primary row
      // must become emptyStats — never another player's numbers.
      const ps =
        allStats.find((s) => String(s.player_id) === String(primaryId)) ??
        (raw.players.length === 1 ? allStats[0] : undefined);
      const stats: NodeStats = ps
        ? {
            playerId: ps.player_id,
            hp: ps.current_hp,
            maxHp: ps.max_hp,
            gold: ps.current_gold,
            damageTaken: ps.damage_taken,
            hpHealed: ps.hp_healed,
            maxHpGained: ps.max_hp_gained ?? 0,
            maxHpLost: ps.max_hp_lost ?? 0,
            goldGained: ps.gold_gained ?? 0,
            goldSpent: ps.gold_spent ?? 0,
            goldLost: ps.gold_lost ?? 0,
            goldStolen: ps.gold_stolen ?? 0,
            cardChoices: (ps.card_choices ?? []).map(
              (c): CardChoice => ({ card: toCardRef(c.card), wasPicked: c.was_picked ?? false }),
            ),
            relicChoices: (ps.relic_choices ?? []).map(
              (c): SimpleChoice => ({ choice: c.choice ?? '', wasPicked: c.was_picked ?? false }),
            ),
            potionChoices: (ps.potion_choices ?? []).map(
              (c): SimpleChoice => ({ choice: c.choice ?? '', wasPicked: c.was_picked ?? false }),
            ),
            restChoices: ps.rest_site_choices ?? [],
            potionsUsed: ps.potion_used ?? [],
            potionsDiscarded: ps.potion_discarded ?? [],
            cardsGained: (ps.cards_gained ?? []).map(toCardRef),
            cardsRemoved: (ps.cards_removed ?? []).map(toCardRef),
            cardsUpgraded: (ps.upgraded_cards ?? []).map((u) =>
              typeof u === 'string' ? u : ((u as { id?: string })?.id ?? ''),
            ),
            boughtRelics: ps.bought_relics ?? [],
            boughtPotions: ps.bought_potions ?? [],
            boughtColorless: ps.bought_colorless ?? [],
            eventChoiceKeys: (ps.event_choices ?? [])
              .map((e) => e.title?.key ?? '')
              .filter(Boolean),
          }
        : emptyStats(primaryId);
      nodes.push({
        floor,
        act: actIdx + 1,
        mapPointType: node.map_point_type,
        rooms: (node.rooms ?? []).map(toRoom),
        stats,
      });
    }
  });

  const killedByEncounter =
    raw.killed_by_encounter && raw.killed_by_encounter !== NONE ? raw.killed_by_encounter : undefined;
  const killedByEvent = raw.killed_by_event && raw.killed_by_event !== NONE ? raw.killed_by_event : undefined;

  return {
    id: runIdFromFileName(fileName),
    schemaVersion: raw.schema_version,
    buildId: raw.build_id ?? 'unknown',
    gameMode: raw.game_mode ?? 'standard',
    ascension: raw.ascension ?? 0,
    seed: raw.seed ?? '',
    startTime: raw.start_time,
    runTimeSeconds: raw.run_time ?? 0,
    win: raw.win,
    abandoned: raw.was_abandoned ?? false,
    killedByEncounter,
    killedByEvent,
    acts: raw.acts ?? [],
    actsEntered: raw.map_point_history.length,
    modifiers: (raw.modifiers ?? []).map((m) => m.id),
    coop: raw.players.length > 1,
    playerCount: raw.players.length,
    player: {
      id: primary.id,
      character: primary.character,
      deck: (primary.deck ?? []).map(toCardRef),
      relics: (primary.relics ?? []).map((r) => ({ id: r.id, floorAdded: r.floor_added_to_deck })),
      potions: (primary.potions ?? []).map((p) => p.id),
      maxPotionSlots: primary.max_potion_slot_count ?? 0,
    },
    nodes,
  };
}

function emptyStats(playerId: number | string): NodeStats {
  return {
    playerId,
    hp: 0,
    maxHp: 1,
    gold: 0,
    damageTaken: 0,
    hpHealed: 0,
    maxHpGained: 0,
    maxHpLost: 0,
    goldGained: 0,
    goldSpent: 0,
    goldLost: 0,
    goldStolen: 0,
    cardChoices: [],
    relicChoices: [],
    potionChoices: [],
    restChoices: [],
    potionsUsed: [],
    potionsDiscarded: [],
    cardsGained: [],
    cardsRemoved: [],
    cardsUpgraded: [],
    boughtRelics: [],
    boughtPotions: [],
    boughtColorless: [],
    eventChoiceKeys: [],
  };
}

export function summarize(run: NormalizedRun): RunSummary {
  return {
    id: run.id,
    schemaVersion: run.schemaVersion,
    buildId: run.buildId,
    gameMode: run.gameMode,
    ascension: run.ascension,
    character: run.player.character,
    win: run.win,
    abandoned: run.abandoned,
    coop: run.coop,
    killedByEncounter: run.killedByEncounter,
    startTime: run.startTime,
    runTimeSeconds: run.runTimeSeconds,
    floorsVisited: run.nodes.length,
    actsEntered: run.actsEntered,
    finalDeckSize: run.player.deck.length,
  };
}

// ---------- shared helpers used by stats, leaks, and autopsy ----------

/** HP fraction (0..1) with which the player ENTERED the node at `index` — i.e. the previous node's post-state. */
export function entryHpPct(run: NormalizedRun, index: number): number | undefined {
  if (index <= 0) return undefined; // node 1 is Neow; no meaningful entry HP
  const prev = run.nodes[index - 1].stats;
  if (prev.maxHp <= 0) return undefined;
  return prev.hp / prev.maxHp;
}

/** Gold with which the player ENTERED the node (reconstructed from its own deltas). */
export function entryGold(node: NodeVisit): number {
  return node.stats.gold + node.stats.goldSpent + node.stats.goldLost + node.stats.goldStolen - node.stats.goldGained;
}

/** True when this node contains a combat room of the given type. */
export function hasRoom(node: NodeVisit, type: RoomType): boolean {
  return node.rooms.some((r) => r.roomType === type);
}

/** The node on which a lost run ended (its last visited node); undefined for wins/abandoned. */
export function deathNode(run: NormalizedRun): NodeVisit | undefined {
  if (run.win || run.abandoned) return undefined;
  return run.nodes[run.nodes.length - 1];
}

/** Completed runs = not abandoned. The default corpus for all coaching stats. */
export function completedRuns(runs: NormalizedRun[]): NormalizedRun[] {
  return runs.filter((r) => !r.abandoned);
}
