/**
 * IndexedDB persistence, raw-first.
 *
 * Stores:
 *  - raw:      original file text keyed by run id — the source of truth.
 *              Parser upgrades re-derive from here; users never re-upload.
 *  - summary:  one RunSummary row per run (what the run list queries).
 *  - meta:     parserVersion, persisted directory handle, dismissed leaks.
 *
 * Normalized runs are NOT stored: re-deriving 231 runs from raw takes <1s and
 * guarantees derived data can never go stale relative to the parser.
 */
import { openDB, type IDBPDatabase } from 'idb';
import { normalizeRun, summarize } from './normalize';
import type { NormalizedRun, RunSummary } from './types';

export const PARSER_VERSION = 1;
const DB_NAME = 'spire-autopsy';
const DB_VERSION = 1;

interface RawRow {
  id: string;
  fileName: string;
  text: string;
  importedAt: number;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(d) {
        d.createObjectStore('raw', { keyPath: 'id' });
        d.createObjectStore('summary', { keyPath: 'id' });
        d.createObjectStore('meta');
      },
    });
  }
  return dbPromise;
}

export async function knownRunIds(): Promise<Set<string>> {
  const d = await db();
  return new Set((await d.getAllKeys('raw')) as string[]);
}

export interface ImportResult {
  added: number;
  skipped: number;
  failed: { fileName: string; error: string }[];
}

/** Persist parsed files: raw text + summary row, in one transaction per batch. */
export async function storeRuns(
  rows: { id: string; fileName: string; text: string; summary: RunSummary }[],
): Promise<void> {
  const d = await db();
  const tx = d.transaction(['raw', 'summary'], 'readwrite');
  const now = Date.now();
  for (const row of rows) {
    void tx.objectStore('raw').put({ id: row.id, fileName: row.fileName, text: row.text, importedAt: now } satisfies RawRow);
    void tx.objectStore('summary').put(row.summary);
  }
  await tx.done;
}

export async function loadSummaries(): Promise<RunSummary[]> {
  const d = await db();
  return (await d.getAll('summary')) as RunSummary[];
}

/** Re-derive all NormalizedRuns from raw text (parser is fast; done on app load). */
export async function loadAllRuns(): Promise<NormalizedRun[]> {
  const d = await db();
  const raws = (await d.getAll('raw')) as RawRow[];
  const runs: NormalizedRun[] = [];
  for (const raw of raws) {
    try {
      runs.push(normalizeRun(JSON.parse(raw.text), raw.fileName));
    } catch {
      // tolerant: a raw row that no longer parses is skipped, never fatal
    }
  }
  return runs.sort((a, b) => a.startTime - b.startTime);
}

/** If the stored parserVersion is older than the code, refresh every summary row from raw. */
export async function migrateIfNeeded(): Promise<void> {
  const d = await db();
  const stored = ((await d.get('meta', 'parserVersion')) as number | undefined) ?? 0;
  if (stored === PARSER_VERSION) return;
  const raws = (await d.getAll('raw')) as RawRow[];
  const tx = d.transaction(['summary', 'meta'], 'readwrite');
  for (const raw of raws) {
    try {
      void tx.objectStore('summary').put(summarize(normalizeRun(JSON.parse(raw.text), raw.fileName)));
    } catch {
      /* skip */
    }
  }
  void tx.objectStore('meta').put(PARSER_VERSION, 'parserVersion');
  await tx.done;
}

/** All raw file rows — the journal export's payload. */
export async function exportRaws(): Promise<{ fileName: string; text: string }[]> {
  const d = await db();
  const raws = (await d.getAll('raw')) as RawRow[];
  return raws.map((r) => ({ fileName: r.fileName, text: r.text }));
}

export async function clearAllData(): Promise<void> {
  const d = await db();
  const tx = d.transaction(['raw', 'summary', 'meta'], 'readwrite');
  void tx.objectStore('raw').clear();
  void tx.objectStore('summary').clear();
  void tx.objectStore('meta').clear();
  await tx.done;
}

// ---- small meta helpers (dismissed leaks, directory handle) ----

export async function getMeta<T>(key: string): Promise<T | undefined> {
  return (await db()).get('meta', key) as Promise<T | undefined>;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await (await db()).put('meta', value, key);
}
