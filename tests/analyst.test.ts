/**
 * The Analyst renders only what the detectors hand it, so the only logic worth
 * testing is the formatting layer: that its figures match the Coach voice's
 * exactly, that a detector's own cohort labels are never overwritten by the
 * win/loss defaults, and that the ledger prints each detector once even though
 * Coach.tsx hands it overlapping lists.
 */
import { describe, expect, it } from 'vitest';
import { boardRows, cohortTags, fmtCohortValue, rankScoreText, tierTag } from '../src/components/AnalystBoard';
import type { DumbbellStat, LeakResult } from '../src/lib/types';

function leak(over: Partial<LeakResult> & { id: string }): LeakResult {
  return {
    tier: 'leak',
    title: over.id,
    body: '',
    receiptLines: [],
    runReceipts: [],
    strength: 'moderate',
    expectedWinsLost: 0,
    applicable: true,
    ...over,
  };
}

function stat(over: Partial<DumbbellStat> = {}): DumbbellStat {
  return { label: 'l', winValue: 1, lossValue: 2, format: 'pct', sampleLabel: 'n', ...over };
}

describe('fmtCohortValue', () => {
  it('prints integers bare and fractions to one decimal', () => {
    expect(fmtCohortValue(18, 'pct')).toBe('18%');
    expect(fmtCohortValue(18.44, 'pct')).toBe('18.4%');
    expect(fmtCohortValue(3, 'count')).toBe('3');
    expect(fmtCohortValue(3.25, 'count')).toBe('3.3');
  });
});

describe('cohortTags', () => {
  it('uses the detector own cohort names when it set them', () => {
    expect(cohortTags(stat({ winLabel: 'entered 60%+', lossLabel: 'entered <60%' }))).toEqual({
      win: 'entered 60%+',
      loss: 'entered <60%',
    });
  });

  it('falls back to win/loss cohorts only when neither label is set', () => {
    expect(cohortTags(stat())).toEqual({ win: 'wins', loss: 'losses' });
  });
});

describe('rankScoreText', () => {
  it('pads every score to the same width', () => {
    expect(rankScoreText(26.4)).toBe('26.40');
    expect(rankScoreText(0)).toBe('0.00');
  });
});

describe('tierTag', () => {
  it('names the three shelves the ledger replaces the drawer with', () => {
    expect(tierTag({ tier: 'leak' })).toBe('leak');
    expect(tierTag({ tier: 'observation' })).toBe('obs');
    expect(tierTag({ tier: 'observation', healthy: true })).toBe('clean');
  });
});

describe('boardRows', () => {
  it('prints an overflow leak once, not twice', () => {
    const a = leak({ id: 'a' });
    const b = leak({ id: 'b' });
    const obs = leak({ id: 'c', tier: 'observation' });
    // Coach.tsx passes the FULL ranked list plus a drawer that repeats its tail.
    const rows = boardRows([a, b], [b, obs]);
    expect(rows.ranked.map((r) => r.leak.id)).toEqual(['a', 'b']);
    expect(rows.observations.map((l) => l.id)).toEqual(['c']);
  });

  it('ranks by position in the already-sorted leak list', () => {
    const rows = boardRows([leak({ id: 'a' }), leak({ id: 'b' })], []);
    expect(rows.ranked.map((r) => r.rank)).toEqual([1, 2]);
  });

  it('shelves healthy detectors as clean, never as ledger rows', () => {
    const clean = leak({ id: 'h', tier: 'observation', healthy: true });
    const rows = boardRows([], [clean]);
    expect(rows.observations).toEqual([]);
    expect(rows.clean.map((l) => l.id)).toEqual(['h']);
  });
});
