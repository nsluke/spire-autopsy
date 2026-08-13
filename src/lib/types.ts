/**
 * Core domain types for Spire Autopsy.
 *
 * NormalizedRun is the single internal model both schema v8 and v9 run files
 * normalize into. Everything downstream (stats, leaks, autopsy, UI) consumes
 * only these types — never the raw file shape.
 */

// ---------- normalized run model ----------

export type RoomType =
  | 'monster'
  | 'elite'
  | 'boss'
  | 'event'
  | 'rest_site'
  | 'shop'
  | 'treasure';

export interface RoomVisit {
  roomType: RoomType;
  /** ENCOUNTER.* / EVENT.* id — absent for rest/shop/treasure rooms */
  modelId?: string;
  monsterIds: string[];
  turnsTaken: number;
}

export interface CardRef {
  id: string;
  upgradeLevel: number;
  /** 1-based global node index at which the card entered the deck */
  floorAdded?: number;
}

export interface CardChoice {
  card: CardRef;
  wasPicked: boolean;
}

export interface SimpleChoice {
  choice: string;
  wasPicked: boolean;
}

/** Per-player stats recorded at one visited map node. HP/gold are AFTER the node resolved. */
export interface NodeStats {
  playerId: number | string;
  hp: number;
  maxHp: number;
  gold: number;
  damageTaken: number;
  hpHealed: number;
  maxHpGained: number;
  maxHpLost: number;
  goldGained: number;
  goldSpent: number;
  goldLost: number;
  goldStolen: number;
  cardChoices: CardChoice[];
  relicChoices: SimpleChoice[];
  potionChoices: SimpleChoice[];
  restChoices: string[]; // SMITH | HEAL | HATCH | DIG | COOK | LIFT | CLONE
  potionsUsed: string[];
  potionsDiscarded: string[];
  cardsGained: CardRef[];
  cardsRemoved: CardRef[];
  cardsUpgraded: string[];
  boughtRelics: string[];
  boughtPotions: string[];
  boughtColorless: string[];
  eventChoiceKeys: string[]; // localization keys of chosen event options
}

export interface NodeVisit {
  /** 1-based index across the whole run (matches floor_added_to_deck) */
  floor: number;
  /** 1-based act number */
  act: number;
  /** raw map_point_type: monster | elite | boss | rest_site | shop | treasure | ancient | unknown */
  mapPointType: string;
  /** one node can hold multiple rooms (e.g. "?" event that leads into a fight) */
  rooms: RoomVisit[];
  /** stats for the local/primary player at this node */
  stats: NodeStats;
}

export interface PlayerEnd {
  id: number | string;
  character: string; // CHARACTER.*
  deck: CardRef[];
  relics: { id: string; floorAdded?: number }[];
  potions: string[]; // potion ids still held at run end
  maxPotionSlots: number;
}

export interface NormalizedRun {
  /** filename timestamp — stable unique id */
  id: string;
  schemaVersion: number;
  buildId: string;
  gameMode: string; // standard | custom | daily
  ascension: number;
  seed: string;
  startTime: number; // unix seconds
  runTimeSeconds: number;
  win: boolean;
  abandoned: boolean;
  killedByEncounter?: string; // ENCOUNTER.*
  killedByEvent?: string; // EVENT.*
  /** the three seeded acts, e.g. ACT.OVERGROWTH */
  acts: string[];
  /** number of acts actually entered */
  actsEntered: number;
  modifiers: string[];
  /** true when the file held 2+ players; per-node stats follow the primary player */
  coop: boolean;
  playerCount: number;
  /** run-end state of the primary player */
  player: PlayerEnd;
  nodes: NodeVisit[];
}

// ---------- summaries & stats ----------

export interface RunSummary {
  id: string;
  schemaVersion: number;
  buildId: string;
  gameMode: string;
  ascension: number;
  character: string;
  win: boolean;
  abandoned: boolean;
  coop: boolean;
  killedByEncounter?: string;
  startTime: number;
  runTimeSeconds: number;
  floorsVisited: number;
  actsEntered: number;
  finalDeckSize: number;
}

export interface CharacterStats {
  character: string;
  runs: number;
  wins: number;
  winRatePct: number;
  avgAscension: number;
  maxAscension: number;
  avgFinalDeckSize: number;
  favoriteCard?: { id: string; picks: number };
}

export interface KillCause {
  encounter: string;
  deaths: number;
  timesFought: number;
  deathRatePct: number;
  roomType?: RoomType;
}

export interface PickCount {
  id: string;
  picks: number;
}

export interface RestChoiceCount {
  choice: string;
  count: number;
}

export interface AscensionRecord {
  ascension: number;
  runs: number;
  wins: number;
  winRatePct: number;
}

export interface TrendPoint {
  label: string;
  runs: number;
  wins: number;
  winRatePct: number;
  avgAscension: number;
}

export interface StatsSummary {
  totalRuns: number;
  wins: number;
  losses: number;
  abandoned: number;
  winRatePct: number;
  standardRuns: number;
  standardWins: number;
  totalHoursRaw: number;
  /** hours excluding runs whose wall clock exceeded 8h (left open) */
  totalHoursActive: number;
  medianRunMinutes: number;
  totalFloors: number;
  totalDamageTaken: number;
  totalHpHealed: number;
  totalGoldGained: number;
  totalGoldSpent: number;
  totalGoldStolen: number;
  totalMonstersFaced: number;
  totalCombatRooms: number;
  totalCombatTurns: number;
  eliteFights: number;
  bossFights: number;
  restSiteVisits: number;
  shopVisits: number;
  potionsUsed: number;
  cardsOffered: number;
  cardsPicked: number;
  cardsRemoved: number;
  cardsUpgraded: number;
  pickRatePct: number;
  bestWinStreak: number;
  distinctSeeds: number;
  deathsByAct: number[];
  byCharacter: CharacterStats[];
  killCauses: KillCause[];
  quarters: TrendPoint[];
  restChoices: RestChoiceCount[];
  topPicks: PickCount[];
  byAscension: AscensionRecord[];
  firstRunDate?: string;
  lastRunDate?: string;
}

// ---------- coach / leaks ----------

export type EvidenceStrength = 'strong' | 'moderate' | 'weak';
export type LeakTier = 'leak' | 'observation';

export interface RunReceipt {
  runId: string;
  label: string; // e.g. "Aug 10 · Defect A6 · entered The Insatiable at 57%"
  /** encounter ids whose display names appear in label — wrapped for hover art */
  enemyIds?: string[];
}

export interface DumbbellStat {
  label: string;
  winValue: number;
  lossValue: number;
  /** how to format values, e.g. 'pct' | 'count' */
  format: 'pct' | 'count';
  sampleLabel: string; // e.g. "323 boss fights"
  /**
   * Cohort tags for the two dots. Omit ONLY when the values really are
   * win-cohort vs loss-cohort figures (the default labels say "wins"/"losses"
   * and the aria text says "in runs you win/lose"). Detectors comparing any
   * other cohort pair (e.g. healthy vs low boss entries) MUST set both.
   */
  winLabel?: string; // e.g. "entered 60%+"
  lossLabel?: string; // e.g. "entered <60%"
}

export interface LeakResult {
  id: string; // stable detector id, e.g. 'boss-entry-hp'
  tier: LeakTier;
  title: string;
  /** Warm Coach one-paragraph body */
  body: string;
  ratioBadge?: string; // e.g. "2.7× deadlier" — omit when win-side n < 10
  dumbbell?: DumbbellStat;
  receiptLines: string[]; // mono evidence lines with exact n's
  runReceipts: RunReceipt[];
  confoundNote?: string;
  drill?: { title: string; body: string };
  strength: EvidenceStrength;
  /** ranking key: estimated wins lost per 100 runs (heuristic) */
  expectedWinsLost: number;
  /** false when the corpus is too small for this detector to speak */
  applicable: boolean;
  /**
   * true when the detector RAN and found nothing to fix (distinct from
   * applicable:false = not enough data). Healthy results never render as
   * leak cards or "locked" analyses — they read as a clean bill of health.
   */
  healthy?: boolean;
}

// ---------- autopsy ----------

export interface AutopsyMoment {
  floor: number;
  kind: 'spike' | 'point-of-no-return' | 'boss-entry' | 'death' | 'clutch' | 'heal';
  label: string;
  detail?: string;
}

/**
 * One sentence of the coach's read, anchored to the floors it talks about.
 * Hovering/focusing a beat highlights those floors on the trajectory chart;
 * beats with no anchors (general advice) carry an empty floors list.
 */
export interface NarrativeBeat {
  text: string;
  floors: number[];
  /** encounter ids whose display names appear in text — wrapped for hover art */
  enemyIds?: string[];
}

export interface AutopsyReport {
  runId: string;
  character: string;
  ascension: number;
  win: boolean;
  killedBy?: string;
  floors: number;
  durationMinutes: number;
  seed: string;
  actNames: string[];
  /** hp/maxHp after each node, in visit order */
  trajectory: { floor: number; act: number; hpPct: number; hp: number; maxHp: number; mapPointType: string; roomLabel?: string; restChoice?: string; damageTaken: number; encounterId?: string }[];
  moments: AutopsyMoment[];
  /** Warm Coach read as floor-anchored beats (see NarrativeBeat) */
  narrative: NarrativeBeat[];
  /** ids of aggregate leaks this run exhibits */
  linkedLeakIds: string[];
}
