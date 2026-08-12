/**
 * Shared plumbing for the leak detectors.
 *
 * RANKING FORMULA (used by every detector via rankScore):
 *   expectedWinsLost ≈ freqPerRun × rateDelta × strengthWeight × 100
 * where
 *   freqPerRun    = how often the risky pattern shows up per completed run
 *                   (e.g. low-HP boss entries per run, rich shops skipped per run),
 *   rateDelta     = (bad-outcome rate WITH the pattern) − (rate WITHOUT it),
 *                   as a 0..1 fraction, floored at 0,
 *   strengthWeight = strong 1.0 / moderate 0.6 / weak 0.3.
 * The product estimates "wins lost per 100 runs" — a heuristic for ordering
 * leaks by how much fixing them could matter, never shown as a promise.
 */
import { characterName, shortDate } from '../idFormat';
import type { EvidenceStrength, LeakResult, LeakTier, NormalizedRun } from '../types';

/** Entering a boss fight below this HP fraction counts as a "low" entry. */
export const LOW_BOSS_ENTRY = 0.6;

const STRENGTH_WEIGHT: Record<EvidenceStrength, number> = {
  strong: 1,
  moderate: 0.6,
  weak: 0.3,
};

/** See the ranking formula in the file header. */
export function rankScore(freqPerRun: number, rateDelta: number, strength: EvidenceStrength): number {
  return +(Math.max(0, freqPerRun) * Math.max(0, rateDelta) * STRENGTH_WEIGHT[strength] * 100).toFixed(2);
}

/** "Aug 10 · Defect A6" — the prefix every run receipt starts with. */
export function runTag(run: NormalizedRun): string {
  return `${shortDate(run.startTime)} · ${characterName(run.player.character)} A${run.ascension}`;
}

/** 0.565 → "57%" */
export function pctLabel(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** Mean rounded to 1 decimal; 0 for an empty list. */
export function mean1(values: number[]): number {
  return values.length ? +(values.reduce((a, b) => a + b, 0) / values.length).toFixed(1) : 0;
}

/**
 * A mean for prose: integers keep a forced decimal ("1.0 attacks") so an
 * average can never read as a grammatical singular ("1 attacks").
 */
export function n1(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

/** Median of a numeric list; 0 for an empty list. */
export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Up to n items, most recent first, by the given timestamp accessor. */
export function mostRecent<T>(items: T[], time: (item: T) => number, n: number): T[] {
  return [...items].sort((a, b) => time(b) - time(a)).slice(0, n);
}

/**
 * The friendly "not enough data yet" result every detector returns instead of
 * emitting garbage when its denominators are too small. `body` explains what
 * unlocks the detector.
 */
export function notYetApplicable(id: string, tier: LeakTier, title: string, body: string): LeakResult {
  return {
    id,
    tier,
    title,
    body,
    receiptLines: [],
    runReceipts: [],
    strength: 'weak',
    expectedWinsLost: 0,
    applicable: false,
  };
}

/**
 * The "ran and found nothing to fix" result — the detector HAD enough data
 * and the pattern simply isn't there. Distinct from notYetApplicable so the
 * UI can file it as a clean bill of health instead of a locked analysis.
 */
export function healthyResult(
  id: string,
  tier: LeakTier,
  title: string,
  body: string,
  receiptLines: string[] = [],
): LeakResult {
  return {
    id,
    tier,
    title,
    body,
    receiptLines,
    runReceipts: [],
    strength: 'weak',
    expectedWinsLost: 0,
    applicable: true,
    healthy: true,
  };
}
