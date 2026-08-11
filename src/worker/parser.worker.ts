/**
 * Parse worker: receives file texts, returns summaries + raw rows for storage.
 * Keeps JSON.parse + Zod validation off the main thread during import.
 *
 * Protocol:
 *   in:  { type: 'parse', files: { fileName: string; text: string }[] }
 *   out: { type: 'progress', done: number, total: number }
 *        { type: 'result', rows: ParsedRow[], failed: { fileName, error }[] }
 */
import { normalizeRun, runIdFromFileName, summarize } from '../lib/normalize';
import type { RunSummary } from '../lib/types';

export interface ParsedRow {
  id: string;
  fileName: string;
  text: string;
  summary: RunSummary;
}

export interface ParseRequest {
  type: 'parse';
  files: { fileName: string; text: string }[];
}

export type ParseResponse =
  | { type: 'progress'; done: number; total: number }
  | { type: 'result'; rows: ParsedRow[]; failed: { fileName: string; error: string }[] };

self.onmessage = (e: MessageEvent<ParseRequest>) => {
  if (e.data.type !== 'parse') return;
  const { files } = e.data;
  const rows: ParsedRow[] = [];
  const failed: { fileName: string; error: string }[] = [];
  files.forEach((f, i) => {
    try {
      const run = normalizeRun(JSON.parse(f.text), f.fileName);
      rows.push({ id: runIdFromFileName(f.fileName), fileName: f.fileName, text: f.text, summary: summarize(run) });
    } catch (err) {
      failed.push({ fileName: f.fileName, error: err instanceof Error ? err.message : String(err) });
    }
    if ((i + 1) % 25 === 0 || i + 1 === files.length) {
      (self as unknown as Worker).postMessage({ type: 'progress', done: i + 1, total: files.length } satisfies ParseResponse);
    }
  });
  (self as unknown as Worker).postMessage({ type: 'result', rows, failed } satisfies ParseResponse);
};
