/**
 * Anonymous snapshot: the wire payload must never contain run files, seeds,
 * Steam ids, dates, receipts, or other per-run identifiers. Extra keys a
 * modified client might attach are stripped by sanitizeContribution.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeRun } from '../src/lib/normalize';
import {
  buildContribution,
  contributableRuns,
} from '../src/lib/contribute';
import {
  FORBIDDEN_SNAPSHOT_KEYS,
  SNAPSHOT_KIND,
  sanitizeContribution,
} from '../src/lib/contributeSnapshot';
import { handleContributeRequest, type ContributeEnv } from '../contribute-ingest/handler';
import type { NormalizedRun } from '../src/lib/types';

function loadFixture(name: string): NormalizedRun {
  const path = fileURLToPath(new URL(`./fixtures/${name}.run`, import.meta.url));
  return normalizeRun(JSON.parse(readFileSync(path, 'utf8')), `${name}.run`);
}

const win1779 = loadFixture('1779248265');
const win1776 = loadFixture('1776190046'); // also a bundled demo run
const loss1785 = loadFixture('1785858459');
const loss1774 = loadFixture('1774194024');
const abandoned = loadFixture('1778528032');

let cloneCounter = 0;
function clones(run: NormalizedRun, n: number, mutate?: (r: NormalizedRun) => void): NormalizedRun[] {
  return Array.from({ length: n }, () => {
    cloneCounter += 1;
    const copy = JSON.parse(JSON.stringify(run)) as NormalizedRun;
    copy.id = `${run.id}-c${cloneCounter}`;
    copy.startTime = run.startTime + cloneCounter * 3600;
    mutate?.(copy);
    return copy;
  });
}

function allKeys(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) allKeys(item, into);
  } else if (value !== null && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      allKeys(v, into);
    }
  }
  return into;
}

const corpus: NormalizedRun[] = [
  ...clones(win1779, 8),
  ...clones(win1776, 8),
  ...clones(loss1785, 12, (r) => {
    r.coop = true;
    r.playerCount = 2;
    r.player.id = '76561197965805643';
  }),
  ...clones(loss1774, 4),
  ...clones(abandoned, 2),
];

describe('anonymous contribution snapshot', () => {
  it('omits bundled demo runs so sample data cannot pollute the drop-off', () => {
    expect(contributableRuns([win1776])).toEqual([]);
    expect(buildContribution([win1776])).toBeNull();
    expect(buildContribution(corpus)?.corpus.runCount).toBe(corpus.length);
  });

  it('never includes identifying keys, seeds, Steam ids, filenames, or dates', () => {
    const snap = buildContribution(corpus);
    expect(snap).not.toBeNull();
    const keys = allKeys(snap);
    for (const forbidden of FORBIDDEN_SNAPSHOT_KEYS) {
      expect(keys.has(forbidden)).toBe(false);
    }
    const json = JSON.stringify(snap);
    expect(json).not.toMatch(/steam/i);
    expect(json).not.toMatch(/7656119/);
    expect(json).not.toMatch(/\.run/i);
    expect(json).not.toContain(win1779.seed);
    expect(json).not.toContain(loss1785.seed);
    expect(json).not.toContain(String(win1779.startTime));
    expect(json).not.toContain('1779248265');
    expect(json).not.toContain('runReceipts');
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}/); // ISO dates
  });

  it('keeps the aggregates and detector ids the product actually needs', () => {
    const snap = buildContribution(corpus)!;
    expect(snap.kind).toBe(SNAPSHOT_KIND);
    expect(snap.corpus.runCount).toBeGreaterThan(20);
    expect(snap.corpus.wins).toBeGreaterThan(0);
    expect(snap.corpus.coopRuns).toBe(12);
    expect(snap.leaks.length).toBeGreaterThan(0);
    expect(snap.leaks.every((l) => l.id.length > 0)).toBe(true);
    expect(snap.corpus.byCharacter.length).toBeGreaterThan(0);
    expect(Object.keys(snap.corpus.schemaVersions).length).toBeGreaterThan(0);
    expect(snap.climb.length).toBeGreaterThan(0);
  });

  it('sanitize drops extra keys a modified client might attach', () => {
    const snap = buildContribution(corpus)!;
    const dirty = {
      ...snap,
      seed: win1779.seed,
      steamId: '76561197965805643',
      runs: [{ id: win1779.id, seed: win1779.seed, fileName: '1779248265.run' }],
      corpus: { ...snap.corpus, firstRunDate: '2026-08-10', favoriteCard: { id: 'CARD.STRIKE', picks: 99 } },
    };
    const clean = sanitizeContribution(dirty);
    expect(clean).not.toBeNull();
    const json = JSON.stringify(clean);
    expect(json).not.toContain(win1779.seed);
    expect(json).not.toContain('7656119');
    expect(json).not.toContain('firstRunDate');
    expect(json).not.toContain('favoriteCard');
    expect(json).not.toContain('1779248265.run');
    expect(clean && 'runs' in clean).toBe(false);
    expect(clean && 'seed' in clean).toBe(false);
    expect(clean && 'steamId' in clean).toBe(false);
  });

  it('sanitize rejects payloads that are not snapshots', () => {
    expect(sanitizeContribution(null)).toBeNull();
    expect(sanitizeContribution({ kind: 'nope', schema: 1 })).toBeNull();
    expect(sanitizeContribution({ ...buildContribution(corpus), schema: 99 })).toBeNull();
  });
});

describe('contribute ingest', () => {
  function envWithStore(stored: unknown[][]): ContributeEnv {
    return {
      DB: {
        prepare: () => ({
          bind: (...args: unknown[]) => ({
            run: async () => {
              stored.push(args);
            },
          }),
        }),
      },
      ALLOWED_ORIGINS: 'http://localhost:5173',
    };
  }

  it('stores a sanitized snapshot and ignores extra fields', async () => {
    const stored: unknown[][] = [];
    const snap = buildContribution(corpus)!;
    const res = await handleContributeRequest(
      new Request('https://drop.example/api/contribute', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: JSON.stringify({ ...snap, seed: 'SHOULD-NOT-LAND' }),
      }),
      envWithStore(stored),
    );
    expect(res.status).toBe(201);
    expect(stored).toHaveLength(1);
    const payload = JSON.parse(stored[0][3] as string) as { seed?: string };
    expect(payload.seed).toBeUndefined();
    expect(JSON.stringify(payload)).not.toContain('SHOULD-NOT-LAND');
  });

  it('rejects a missing origin and a non-snapshot body', async () => {
    const stored: unknown[][] = [];
    const env = envWithStore(stored);
    const noOrigin = await handleContributeRequest(
      new Request('https://drop.example/api/contribute', { method: 'POST', body: '{}' }),
      env,
    );
    expect(noOrigin.status).toBe(403);

    const bad = await handleContributeRequest(
      new Request('https://drop.example/api/contribute', {
        method: 'POST',
        headers: { origin: 'http://localhost:5173', 'content-type': 'application/json' },
        body: '{"hello":"world"}',
      }),
      env,
    );
    expect(bad.status).toBe(422);
    expect(stored).toHaveLength(0);
  });
});
