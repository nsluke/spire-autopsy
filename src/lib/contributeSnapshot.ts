/**
 * Anonymous contribution snapshot — the only JSON that may leave the browser,
 * and only after an explicit click.
 *
 * Design:
 *  - aggregates and detector outcomes, never raw files or per-run rows
 *  - allowlist sanitize is the wire format (client and ingest both run it)
 *  - no seeds, Steam ids, filenames, timestamps, receipts, decks, or dates
 */

export const SNAPSHOT_KIND = 'spire-autopsy-contribute';
export const SNAPSHOT_SCHEMA = 1;

export interface SnapshotCharacter {
  character: string;
  runs: number;
  wins: number;
  avgAscension: number;
  maxAscension: number;
}

export interface SnapshotKillCause {
  encounter: string;
  deaths: number;
  timesFought: number;
}

export interface SnapshotLeak {
  id: string;
  tier: 'leak' | 'observation';
  applicable: boolean;
  healthy: boolean;
  strength: 'strong' | 'moderate' | 'weak';
  expectedWinsLost: number;
  dumbbell?: { winValue: number; lossValue: number; format: 'pct' | 'count' };
}

export interface SnapshotWall {
  character: string;
  target: number;
  attempts: number;
  deepestAct: number;
  summited: boolean;
  deathsByAct: [number, number, number];
  topKiller?: string;
}

export interface ContributionSnapshot {
  kind: typeof SNAPSHOT_KIND;
  schema: typeof SNAPSHOT_SCHEMA;
  appVersion: string;
  parserVersion: number;
  corpus: {
    runCount: number;
    wins: number;
    losses: number;
    abandoned: number;
    coopRuns: number;
    standardRuns: number;
    standardWins: number;
    winRatePct: number;
    totalHoursActive: number;
    medianRunMinutes: number;
    totalFloors: number;
    totalCombatRooms: number;
    eliteFights: number;
    bossFights: number;
    restSiteVisits: number;
    deathsByAct: number[];
    schemaVersions: Record<string, number>;
    buildIds: Record<string, number>;
    gameModes: Record<string, number>;
    byCharacter: SnapshotCharacter[];
    killCauses: SnapshotKillCause[];
  };
  leaks: SnapshotLeak[];
  climb: SnapshotWall[];
}

const STRENGTHS = new Set(['strong', 'moderate', 'weak']);
const TIERS = new Set(['leak', 'observation']);
const FORMATS = new Set(['pct', 'count']);

const MAX_STRING = 120;
const MAX_MAP_KEYS = 80;
const MAX_KILL_CAUSES = 40;
const MAX_CHARACTERS = 16;
const MAX_LEAKS = 24;
const MAX_WALLS = 16;
const MAX_DEATHS_BY_ACT = 8;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function finiteNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function intNum(v: unknown): number | undefined {
  const n = finiteNumber(v);
  return n === undefined ? undefined : Math.trunc(n);
}

function bool(v: unknown): boolean | undefined {
  return typeof v === 'boolean' ? v : undefined;
}

function shortString(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim();
  if (!s || s.length > MAX_STRING) return undefined;
  // Game ids are dotted TOKEN.NAME — reject anything that looks like a path or steam id.
  if (/steam/i.test(s) || /\.run/i.test(s) || /7656119/.test(s)) return undefined;
  return s;
}

function countMap(v: unknown): Record<string, number> {
  if (!isRecord(v)) return {};
  const out: Record<string, number> = {};
  for (const [k, raw] of Object.entries(v).slice(0, MAX_MAP_KEYS)) {
    const key = shortString(k);
    const n = intNum(raw);
    if (key && n !== undefined && n >= 0) out[key] = n;
  }
  return out;
}

function sanitizeCharacter(v: unknown): SnapshotCharacter | undefined {
  if (!isRecord(v)) return undefined;
  const character = shortString(v.character);
  const runs = intNum(v.runs);
  const wins = intNum(v.wins);
  const avgAscension = finiteNumber(v.avgAscension);
  const maxAscension = intNum(v.maxAscension);
  if (!character || runs === undefined || wins === undefined || avgAscension === undefined || maxAscension === undefined) {
    return undefined;
  }
  return { character, runs, wins, avgAscension, maxAscension };
}

function sanitizeKill(v: unknown): SnapshotKillCause | undefined {
  if (!isRecord(v)) return undefined;
  const encounter = shortString(v.encounter);
  const deaths = intNum(v.deaths);
  const timesFought = intNum(v.timesFought);
  if (!encounter || deaths === undefined || timesFought === undefined) return undefined;
  return { encounter, deaths, timesFought };
}

function sanitizeLeak(v: unknown): SnapshotLeak | undefined {
  if (!isRecord(v)) return undefined;
  const id = shortString(v.id);
  const tier = shortString(v.tier);
  const applicable = bool(v.applicable);
  const healthy = bool(v.healthy);
  const strength = shortString(v.strength);
  const expectedWinsLost = finiteNumber(v.expectedWinsLost);
  if (!id || !tier || !TIERS.has(tier) || applicable === undefined || healthy === undefined) return undefined;
  if (!strength || !STRENGTHS.has(strength) || expectedWinsLost === undefined) return undefined;
  const leak: SnapshotLeak = {
    id,
    tier: tier as SnapshotLeak['tier'],
    applicable,
    healthy,
    strength: strength as SnapshotLeak['strength'],
    expectedWinsLost,
  };
  if (isRecord(v.dumbbell)) {
    const winValue = finiteNumber(v.dumbbell.winValue);
    const lossValue = finiteNumber(v.dumbbell.lossValue);
    const format = shortString(v.dumbbell.format);
    if (winValue !== undefined && lossValue !== undefined && format && FORMATS.has(format)) {
      leak.dumbbell = { winValue, lossValue, format: format as 'pct' | 'count' };
    }
  }
  return leak;
}

function sanitizeWall(v: unknown): SnapshotWall | undefined {
  if (!isRecord(v)) return undefined;
  const character = shortString(v.character);
  const target = intNum(v.target);
  const attempts = intNum(v.attempts);
  const deepestAct = intNum(v.deepestAct);
  const summited = bool(v.summited);
  if (!character || target === undefined || attempts === undefined || deepestAct === undefined || summited === undefined) {
    return undefined;
  }
  const rawActs = Array.isArray(v.deathsByAct) ? v.deathsByAct.slice(0, 3).map(intNum) : [];
  const deathsByAct: [number, number, number] = [rawActs[0] ?? 0, rawActs[1] ?? 0, rawActs[2] ?? 0];
  const wall: SnapshotWall = { character, target, attempts, deepestAct, summited, deathsByAct };
  const killer = shortString(v.topKiller);
  if (killer) wall.topKiller = killer;
  return wall;
}

/**
 * Allowlist-pick an unknown payload into a ContributionSnapshot.
 * Extra keys are dropped; missing/invalid required fields → null (ingest rejects).
 */
export function sanitizeContribution(input: unknown): ContributionSnapshot | null {
  if (!isRecord(input)) return null;
  if (input.kind !== SNAPSHOT_KIND || input.schema !== SNAPSHOT_SCHEMA) return null;
  const appVersion = shortString(input.appVersion);
  const parserVersion = intNum(input.parserVersion);
  if (!appVersion || parserVersion === undefined) return null;
  if (!isRecord(input.corpus)) return null;
  const c = input.corpus;

  const runCount = intNum(c.runCount);
  const wins = intNum(c.wins);
  const losses = intNum(c.losses);
  const abandoned = intNum(c.abandoned);
  const coopRuns = intNum(c.coopRuns);
  const standardRuns = intNum(c.standardRuns);
  const standardWins = intNum(c.standardWins);
  const winRatePct = finiteNumber(c.winRatePct);
  const totalHoursActive = finiteNumber(c.totalHoursActive);
  const medianRunMinutes = finiteNumber(c.medianRunMinutes);
  const totalFloors = intNum(c.totalFloors);
  const totalCombatRooms = intNum(c.totalCombatRooms);
  const eliteFights = intNum(c.eliteFights);
  const bossFights = intNum(c.bossFights);
  const restSiteVisits = intNum(c.restSiteVisits);
  if (
    runCount === undefined ||
    wins === undefined ||
    losses === undefined ||
    abandoned === undefined ||
    coopRuns === undefined ||
    standardRuns === undefined ||
    standardWins === undefined ||
    winRatePct === undefined ||
    totalHoursActive === undefined ||
    medianRunMinutes === undefined ||
    totalFloors === undefined ||
    totalCombatRooms === undefined ||
    eliteFights === undefined ||
    bossFights === undefined ||
    restSiteVisits === undefined
  ) {
    return null;
  }

  const deathsByAct = Array.isArray(c.deathsByAct)
    ? c.deathsByAct.slice(0, MAX_DEATHS_BY_ACT).map((n) => intNum(n) ?? 0)
    : [];

  const byCharacter = Array.isArray(c.byCharacter)
    ? c.byCharacter.map(sanitizeCharacter).filter((x): x is SnapshotCharacter => !!x).slice(0, MAX_CHARACTERS)
    : [];
  const killCauses = Array.isArray(c.killCauses)
    ? c.killCauses.map(sanitizeKill).filter((x): x is SnapshotKillCause => !!x).slice(0, MAX_KILL_CAUSES)
    : [];
  const leaks = Array.isArray(input.leaks)
    ? input.leaks.map(sanitizeLeak).filter((x): x is SnapshotLeak => !!x).slice(0, MAX_LEAKS)
    : [];
  const climb = Array.isArray(input.climb)
    ? input.climb.map(sanitizeWall).filter((x): x is SnapshotWall => !!x).slice(0, MAX_WALLS)
    : [];

  return {
    kind: SNAPSHOT_KIND,
    schema: SNAPSHOT_SCHEMA,
    appVersion,
    parserVersion,
    corpus: {
      runCount,
      wins,
      losses,
      abandoned,
      coopRuns,
      standardRuns,
      standardWins,
      winRatePct,
      totalHoursActive,
      medianRunMinutes,
      totalFloors,
      totalCombatRooms,
      eliteFights,
      bossFights,
      restSiteVisits,
      deathsByAct,
      schemaVersions: countMap(c.schemaVersions),
      buildIds: countMap(c.buildIds),
      gameModes: countMap(c.gameModes),
      byCharacter,
      killCauses,
    },
    leaks,
    climb,
  };
}

/** Keys that must never appear anywhere in a snapshot (defense in depth for tests). */
export const FORBIDDEN_SNAPSHOT_KEYS = [
  'seed',
  'seeds',
  'distinctSeeds',
  'startTime',
  'start_time',
  'firstRunDate',
  'lastRunDate',
  'runId',
  'runReceipts',
  'receiptLines',
  'fileName',
  'filename',
  'player_id',
  'playerId',
  'text',
  'deck',
  'nodes',
  'lastPlayed',
  'contributedAt',
  'favoriteCard',
] as const;
