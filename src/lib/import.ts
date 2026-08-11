/**
 * File ingestion: drag-and-drop (files OR folders), <input webkitdirectory>,
 * and the File System Access API (Chromium) for one-click re-sync.
 *
 * Only *.run files are read; *.run.backup and everything else is filtered by
 * NAME before any bytes are touched.
 */
import { knownRunIds, storeRuns } from './db';
import { runIdFromFileName } from './normalize';
import type { ParseResponse, ParsedRow } from '../worker/parser.worker';

export interface ImportProgress {
  phase: 'reading' | 'parsing' | 'storing' | 'done';
  done: number;
  total: number;
  added: number;
  skippedKnown: number;
  failed: { fileName: string; error: string }[];
}

export function isRunFile(name: string): boolean {
  return /\.run$/i.test(name) && !/\.backup$/i.test(name);
}

/** Recursively collect File objects from a DataTransfer (supports dropped folders). */
export async function filesFromDataTransfer(dt: DataTransfer): Promise<File[]> {
  const out: File[] = [];
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items)) {
    const entry = item.webkitGetAsEntry?.();
    if (entry) entries.push(entry);
    else {
      const f = item.getAsFile();
      if (f) out.push(f);
    }
  }
  async function walk(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push(file);
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns results in chunks; loop until empty
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((res, rej) => reader.readEntries(res, rej));
        if (batch.length === 0) break;
        for (const child of batch) await walk(child);
      }
    }
  }
  for (const entry of entries) await walk(entry);
  return out;
}

export const supportsDirectoryPicker = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

/** Collect *.run files from a directory handle (File System Access API). */
export async function filesFromDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<File[]> {
  const out: File[] = [];
  for await (const [name, child] of handle as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    if (child.kind === 'file' && isRunFile(name)) {
      out.push(await (child as FileSystemFileHandle).getFile());
    }
  }
  return out;
}

/**
 * Full import pipeline: filter by name → skip already-imported ids → read text
 * → parse in worker → store. Incremental by design: re-importing a folder only
 * touches new files.
 */
export async function importFiles(
  allFiles: File[],
  onProgress: (p: ImportProgress) => void,
): Promise<ImportProgress> {
  const runFiles = allFiles.filter((f) => isRunFile(f.name));
  const known = await knownRunIds();
  const fresh = runFiles.filter((f) => !known.has(runIdFromFileName(f.name)));
  const skippedKnown = runFiles.length - fresh.length;

  const progress: ImportProgress = {
    phase: 'reading',
    done: 0,
    total: fresh.length,
    added: 0,
    skippedKnown,
    failed: [],
  };
  onProgress({ ...progress });
  if (fresh.length === 0) {
    progress.phase = 'done';
    onProgress({ ...progress });
    return progress;
  }

  const texts: { fileName: string; text: string }[] = [];
  for (const f of fresh) {
    texts.push({ fileName: f.name, text: await f.text() });
    progress.done++;
    if (progress.done % 20 === 0) onProgress({ ...progress });
  }

  progress.phase = 'parsing';
  progress.done = 0;
  onProgress({ ...progress });

  const worker = new Worker(new URL('../worker/parser.worker.ts', import.meta.url), { type: 'module' });
  const rows = await new Promise<ParsedRow[]>((resolve) => {
    worker.onmessage = (e: MessageEvent<ParseResponse>) => {
      if (e.data.type === 'progress') {
        progress.done = e.data.done;
        onProgress({ ...progress });
      } else {
        progress.failed = e.data.failed;
        resolve(e.data.rows);
      }
    };
    worker.postMessage({ type: 'parse', files: texts });
  });
  worker.terminate();

  progress.phase = 'storing';
  onProgress({ ...progress });
  await storeRuns(rows);
  progress.added = rows.length;
  progress.phase = 'done';
  onProgress({ ...progress });
  return progress;
}

/** Demo mode: fetch bundled sample runs (real anonymous solo runs) and import them. */
export async function importDemoData(onProgress: (p: ImportProgress) => void): Promise<ImportProgress> {
  const index = (await (await fetch('demo/index.json')).json()) as string[];
  const files: File[] = [];
  for (const name of index) {
    const text = await (await fetch(`demo/${name}`)).text();
    files.push(new File([text], name, { type: 'application/json' }));
  }
  return importFiles(files, onProgress);
}
