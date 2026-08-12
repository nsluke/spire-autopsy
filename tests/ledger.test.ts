/**
 * ledger.test.ts — progress.save parsing (the single-file quick look).
 * Fixture: trimmed real progress.save (schema_version 21): Ironclad 7-42
 * (max_ascension 7, fastest 2287s), Regent 0-22 (fastest -1 = no win),
 * RANDOM_CHARACTER with zero games, 4 encounter entries led by Knowledge
 * Demon, 6 card entries led by Shrug It Off (33 picks), plus an unknown
 * future field the parser must tolerate.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { isProgressFile, LedgerParseError, parseProgressSave } from '../src/lib/ledger';

const text = readFileSync(fileURLToPath(new URL('./fixtures/progress.save', import.meta.url)), 'utf8');

describe('parseProgressSave', () => {
  const ledger = parseProgressSave(text, 1_786_500_000_000);

  it('maps character records with max_ascension as the wall', () => {
    const ironclad = ledger.characters.find((c) => c.character === 'CHARACTER.IRONCLAD')!;
    expect(ironclad).toMatchObject({ wall: 7, wins: 7, losses: 42, bestStreak: 1, fastestWinSeconds: 2287 });
    expect(ironclad.playtimeHours).toBeCloseTo(55, 0);
  });

  it('treats fastest_win_time -1 as no recorded win', () => {
    const regent = ledger.characters.find((c) => c.character === 'CHARACTER.REGENT')!;
    expect(regent.fastestWinSeconds).toBeUndefined();
    expect(regent).toMatchObject({ wall: 0, wins: 0, losses: 22 });
  });

  it('drops RANDOM_CHARACTER and unplayed characters, sorts by playtime', () => {
    expect(ledger.characters.map((c) => c.character)).toEqual(['CHARACTER.IRONCLAD', 'CHARACTER.REGENT']);
  });

  it('sums encounter losses across characters for the killer board', () => {
    expect(ledger.topKillers.length).toBeGreaterThan(0);
    expect(ledger.topKillers[0].encounter).toBe('ENCOUNTER.KNOWLEDGE_DEMON_BOSS');
    expect(ledger.topKillers[0].losses).toBeGreaterThanOrEqual(10);
    // sorted descending
    const losses = ledger.topKillers.map((k) => k.losses);
    expect([...losses].sort((a, b) => b - a)).toEqual(losses);
  });

  it('extracts totals and most-picked cards', () => {
    expect(ledger.schemaVersion).toBe(21);
    expect(ledger.floorsClimbed).toBe(6580);
    expect(ledger.playtimeHours).toBeCloseTo(257.7, 1);
    expect(ledger.topPicked[0]).toEqual({ card: 'CARD.SHRUG_IT_OFF', timesPicked: 33 });
    expect(ledger.topPicked).toHaveLength(5);
  });

  it('tolerates unknown future fields (passthrough) and missing optional lists', () => {
    const minimal = parseProgressSave(JSON.stringify({ schema_version: 99, mystery: true }));
    expect(minimal.characters).toEqual([]);
    expect(minimal.topKillers).toEqual([]);
    expect(minimal.floorsClimbed).toBeUndefined();
  });

  it('rejects non-JSON and wrong shapes with a friendly error', () => {
    expect(() => parseProgressSave('not json')).toThrow(LedgerParseError);
    expect(() => parseProgressSave('{"no_version": true}')).toThrow(LedgerParseError);
  });
});

describe('isProgressFile', () => {
  it('matches only the exact file name', () => {
    expect(isProgressFile('progress.save')).toBe(true);
    expect(isProgressFile('PROGRESS.SAVE')).toBe(true);
    expect(isProgressFile('progress.save.backup')).toBe(false);
    expect(isProgressFile('1785858459.run')).toBe(false);
  });
});
