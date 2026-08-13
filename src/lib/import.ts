/**
 * File ingestion: drag-and-drop (files OR folders), <input webkitdirectory>,
 * and the File System Access API (Chromium) for one-click re-sync.
 *
 * Only *.run files are read; *.run.backup and everything else is filtered by
 * NAME before any bytes are touched.
 */
import { getMeta, knownRunIds, setMeta, storeRuns } from './db';
import { isProgressFile, LedgerParseError, parseProgressSave } from './ledger';
import { runIdFromFileName } from './normalize';
import type { ParseResponse, ParsedRow } from '../worker/parser.worker';

/** IndexedDB meta key holding the parsed progress.save Ledger. */
export const LEDGER_META_KEY = 'gameLedger';

export interface ImportProgress {
  phase: 'reading' | 'parsing' | 'storing' | 'done';
  done: number;
  total: number;
  added: number;
  skippedKnown: number;
  /** a progress.save was found and its ledger stored */
  ledgerCaptured: boolean;
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

/** IndexedDB meta key for the File System Access directory handle (Chromium). */
export const HISTORY_DIR_META = 'historyDirectoryHandle';

type PermissionedHandle = FileSystemDirectoryHandle & {
  queryPermission?: (d?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (d?: { mode?: 'read' | 'readwrite' }) => Promise<PermissionState>;
};

export async function loadHistoryDirectory(): Promise<FileSystemDirectoryHandle | undefined> {
  try {
    return await getMeta<FileSystemDirectoryHandle>(HISTORY_DIR_META);
  } catch {
    return undefined;
  }
}

export async function rememberHistoryDirectory(handle: FileSystemDirectoryHandle): Promise<void> {
  await setMeta(HISTORY_DIR_META, handle);
}

/** Capture a dropped folder as a persistable handle (Chromium). Must run during the drop event. */
export function directoryHandleFromDataTransfer(dt: DataTransfer): Promise<FileSystemDirectoryHandle | undefined> {
  const pending: Promise<FileSystemHandle | null>[] = [];
  for (const item of Array.from(dt.items)) {
    const asHandle = (item as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> })
      .getAsFileSystemHandle;
    if (typeof asHandle === 'function') pending.push(asHandle.call(item));
  }
  return Promise.all(pending).then((handles) => {
    const dir = handles.find((h) => h?.kind === 'directory');
    return dir && dir.kind === 'directory' ? (dir as FileSystemDirectoryHandle) : undefined;
  });
}

export async function ensureDirectoryRead(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as PermissionedHandle;
  try {
    const current = typeof h.queryPermission === 'function' ? await h.queryPermission({ mode: 'read' }) : 'prompt';
    if (current === 'granted') return true;
    if (current === 'denied') return false;
    if (typeof h.requestPermission === 'function') return (await h.requestPermission({ mode: 'read' })) === 'granted';
  } catch {
    return false;
  }
  return false;
}

/** Collect *.run files (plus progress.save) from a directory handle (File System Access API). */
export async function filesFromDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<File[]> {
  const out: File[] = [];
  for await (const [name, child] of handle as unknown as AsyncIterable<[string, FileSystemHandle]>) {
    if (child.kind === 'file' && (isRunFile(name) || isProgressFile(name))) {
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
    ledgerCaptured: false,
    failed: [],
  };
  onProgress({ ...progress });

  // progress.save rides along with any drop (or arrives alone): parse and
  // store the game's own ledger. A newer drop replaces the stored one.
  const progressFile = allFiles.find((f) => isProgressFile(f.name));
  if (progressFile) {
    try {
      await setMeta(LEDGER_META_KEY, parseProgressSave(await progressFile.text()));
      progress.ledgerCaptured = true;
    } catch (e) {
      progress.failed.push({
        fileName: progressFile.name,
        error: e instanceof LedgerParseError ? e.message : 'unreadable',
      });
    }
    onProgress({ ...progress });
  }
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
