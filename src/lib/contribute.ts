/**
 * Client-side anonymous contribution: build a snapshot from local runs,
 * POST it only after an explicit click, remember last-sent locally.
 *
 * The drop-off URL is build-time config (VITE_CONTRIBUTE_URL). When unset,
 * the UI still previews/copies — nothing is allowed to phone home.
 */
import demoIndex from '../../public/demo/index.json';
import { PARSER_VERSION, getMeta, setMeta } from './db';
import { detectLeaks } from './leaks';
import { climbSummary } from './climb';
import { computeStats } from './stats';
import type { NormalizedRun } from './types';
import {
  SNAPSHOT_KIND,
  SNAPSHOT_SCHEMA,
  sanitizeContribution,
  type ContributionSnapshot,
} from './contributeSnapshot';
import pkg from '../../package.json';

const LAST_CONTRIBUTION_META = 'lastContributionAt';

const DEMO_IDS = new Set((demoIndex as string[]).map((name) => name.replace(/\.run$/i, '')));

/** Runs that are not the bundled sample set. */
export function contributableRuns(runs: NormalizedRun[]): NormalizedRun[] {
  return runs.filter((r) => !DEMO_IDS.has(r.id));
}

export function contributeUrl(): string | undefined {
  const explicit = (import.meta.env.VITE_CONTRIBUTE_URL ?? '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  if (import.meta.env.VITE_CONTRIBUTE_SAME_ORIGIN === 'true' && typeof window !== 'undefined') {
    return `${window.location.origin}/api/contribute`;
  }
  return undefined;
}

export function ingestConfigured(): boolean {
  return Boolean((import.meta.env.VITE_CONTRIBUTE_URL ?? '').trim()) || import.meta.env.VITE_CONTRIBUTE_SAME_ORIGIN === 'true';
}

function countBy(runs: NormalizedRun[], key: (r: NormalizedRun) => string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of runs) {
    const k = key(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

/** Build the allowlisted snapshot. Demo runs are excluded so sample data cannot pollute the drop-off. */
export function buildContribution(runs: NormalizedRun[]): ContributionSnapshot | null {
  const mine = contributableRuns(runs);
  if (mine.length === 0) return null;
  const stats = computeStats(mine);
  const leaks = detectLeaks(mine);
  const climb = climbSummary(mine, leaks);

  const built: ContributionSnapshot = {
    kind: SNAPSHOT_KIND,
    schema: SNAPSHOT_SCHEMA,
    appVersion: pkg.version,
    parserVersion: PARSER_VERSION,
    corpus: {
      runCount: stats.totalRuns,
      wins: stats.wins,
      losses: stats.losses,
      abandoned: stats.abandoned,
      coopRuns: mine.filter((r) => r.coop).length,
      standardRuns: stats.standardRuns,
      standardWins: stats.standardWins,
      winRatePct: stats.winRatePct,
      totalHoursActive: stats.totalHoursActive,
      medianRunMinutes: stats.medianRunMinutes,
      totalFloors: stats.totalFloors,
      totalCombatRooms: stats.totalCombatRooms,
      eliteFights: stats.eliteFights,
      bossFights: stats.bossFights,
      restSiteVisits: stats.restSiteVisits,
      deathsByAct: stats.deathsByAct,
      schemaVersions: countBy(mine, (r) => String(r.schemaVersion)),
      buildIds: countBy(mine, (r) => r.buildId || 'unknown'),
      gameModes: countBy(mine, (r) => r.gameMode || 'unknown'),
      byCharacter: stats.byCharacter.map((c) => ({
        character: c.character,
        runs: c.runs,
        wins: c.wins,
        avgAscension: c.avgAscension,
        maxAscension: c.maxAscension,
      })),
      killCauses: stats.killCauses.map((k) => ({
        encounter: k.encounter,
        deaths: k.deaths,
        timesFought: k.timesFought,
      })),
    },
    leaks: leaks.map((l) => ({
      id: l.id,
      tier: l.tier,
      applicable: l.applicable,
      healthy: Boolean(l.healthy),
      strength: l.strength,
      expectedWinsLost: l.expectedWinsLost,
      dumbbell: l.dumbbell
        ? { winValue: l.dumbbell.winValue, lossValue: l.dumbbell.lossValue, format: l.dumbbell.format }
        : undefined,
    })),
    climb: climb.walls.map((w) => ({
      character: w.character,
      target: w.target,
      attempts: w.attempts,
      deepestAct: w.deepestAct,
      summited: w.summited,
      deathsByAct: w.deathsByAct,
      topKiller: w.topKiller?.encounter,
    })),
  };

  return sanitizeContribution(built);
}

export const SNAPSHOT_INCLUDES = [
  'How many runs / wins / losses you have (not which runs)',
  'Character mix and average ascension',
  'Which coach checks fired (ids and scores, not receipts)',
  'Game schema and build versions the parser saw',
] as const;

export const SNAPSHOT_EXCLUDES = [
  'Run files and original JSON',
  'Seeds, Steam ids, filenames, decks, floor-by-floor HP',
  'Dates, timestamps, and share-card copy',
] as const;

export type ContributeSubmitResult =
  | { ok: true }
  | { ok: false; reason: 'no-endpoint' | 'network' | 'rejected' | 'empty' };

export async function submitContribution(runs: NormalizedRun[]): Promise<ContributeSubmitResult> {
  const snapshot = buildContribution(runs);
  if (!snapshot) return { ok: false, reason: 'empty' };
  const url = contributeUrl();
  if (!url) return { ok: false, reason: 'no-endpoint' };
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(snapshot),
    });
    if (!res.ok) return { ok: false, reason: 'rejected' };
    await setMeta(LAST_CONTRIBUTION_META, new Date().toISOString());
    return { ok: true };
  } catch {
    return { ok: false, reason: 'network' };
  }
}

export async function lastContributionAt(): Promise<string | undefined> {
  return getMeta<string>(LAST_CONTRIBUTION_META);
}

export function snapshotJson(snapshot: ContributionSnapshot): string {
  return `${JSON.stringify(snapshot, null, 2)}\n`;
}
