/**
 * The Spire Journal — one-file backup and portability for everything local:
 * every raw run file plus coach state (dismissed leaks, active drill).
 * Export downloads a single JSON; import feeds the raws back through the
 * normal import pipeline (idempotent — known run ids are skipped) and
 * restores coach state. This is the no-backend answer to "new machine".
 */
import { exportRaws, getMeta, setMeta } from './db';
import { importFiles, type ImportProgress } from './import';

const JOURNAL_VERSION = 1;
const META_KEYS = ['dismissedLeaks', 'activeDrill'] as const;

interface JournalFile {
  spireAutopsyJournal: number; // version marker doubles as a format sniff
  exportedAt: string;
  runs: { fileName: string; text: string }[];
  meta: Partial<Record<(typeof META_KEYS)[number], unknown>>;
}

export async function exportJournal(): Promise<void> {
  const journal: JournalFile = {
    spireAutopsyJournal: JOURNAL_VERSION,
    exportedAt: new Date().toISOString(),
    runs: await exportRaws(),
    meta: {},
  };
  for (const key of META_KEYS) {
    const value = await getMeta(key);
    if (value !== undefined) journal.meta[key] = value;
  }
  const blob = new Blob([JSON.stringify(journal)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `spire-journal-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export class JournalImportError extends Error {}

export async function importJournal(file: File, onProgress: (p: ImportProgress) => void): Promise<ImportProgress> {
  let parsed: JournalFile;
  try {
    parsed = JSON.parse(await file.text()) as JournalFile;
  } catch {
    throw new JournalImportError('That file is not valid JSON.');
  }
  if (typeof parsed?.spireAutopsyJournal !== 'number' || !Array.isArray(parsed.runs)) {
    throw new JournalImportError('That file is not a Spire Journal export.');
  }
  const files = parsed.runs.map((r) => new File([r.text], r.fileName, { type: 'application/json' }));
  const progress = await importFiles(files, onProgress);
  for (const key of META_KEYS) {
    if (parsed.meta && key in parsed.meta) await setMeta(key, parsed.meta[key]);
  }
  return progress;
}
