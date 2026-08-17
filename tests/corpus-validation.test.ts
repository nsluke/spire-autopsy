/**
 * Full-corpus validation: runs the production parser + stats + leak helpers over
 * a real STS2 history folder and asserts they reproduce independently verified
 * reference numbers (231-run corpus, audited Aug 2026; every figure below was
 * adversarially recomputed from raw files during the project's data audit).
 *
 * Skipped unless STS2_HISTORY points at a history folder:
 *   STS2_HISTORY="$HOME/Library/Application Support/SlayTheSpire2/steam/<id>/profile1/saves/history" npx vitest run tests/corpus-validation.test.ts
 *
 * Note on "household" metrics: the audit summed damage/heal/gold/choices over
 * ALL players in the 3 co-op runs; the app deliberately tracks the primary
 * player only. Those assertions therefore use a small tolerance band instead
 * of exact equality; structural (room-level) metrics must match exactly.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { completedRuns, deathNode, entryGold, entryHpPct, normalizeRun } from '../src/lib/normalize';
import { computeStats } from '../src/lib/stats';
import { climbSummary } from '../src/lib/climb';
import { detectLeaks } from '../src/lib/leaks';
import type { NormalizedRun, StatsSummary } from '../src/lib/types';

const HISTORY = process.env.STS2_HISTORY;

describe.skipIf(!HISTORY)('full-corpus validation against audited reference numbers', () => {
  let runs: NormalizedRun[] = [];
  let stats: StatsSummary;

  // The reference numbers describe the audited snapshot (231 runs; the last
  // audited run started Aug 10 2026 15:55, filename 1786402536). The history
  // folder keeps growing, so pin the corpus to the snapshot by filename
  // timestamp — the validation stays exact no matter how many runs are played
  // after the audit.
  const AUDIT_CUTOFF = 1786402536;

  beforeAll(() => {
    const files = readdirSync(HISTORY!)
      .filter((f) => /\.run$/i.test(f) && !/\.backup$/i.test(f))
      .filter((f) => Number(f.replace(/\.run$/i, '')) <= AUDIT_CUTOFF);
    runs = files.map((f) => normalizeRun(JSON.parse(readFileSync(join(HISTORY!, f), 'utf8')), f));
    stats = computeStats(runs);
  });

  it('parses every file without error', () => {
    expect(runs.length).toBe(231);
  });

  it('reproduces the audited run-frame totals exactly', () => {
    expect(stats.totalRuns).toBe(231);
    expect(stats.wins).toBe(33);
    expect(stats.losses).toBe(194);
    expect(stats.abandoned).toBe(4);
    expect(stats.winRatePct).toBe(14.3);
    expect(stats.standardRuns).toBe(218);
    expect(stats.standardWins).toBe(27);
    expect(stats.totalHoursRaw).toBeCloseTo(239.7, 1);
    expect(stats.totalHoursActive).toBeCloseTo(133.9, 1);
    expect(stats.bestWinStreak).toBe(3);
    expect(stats.distinctSeeds).toBe(231);
    expect(stats.deathsByAct).toEqual([82, 73, 39]);
  });

  it('reproduces the audited room-level totals exactly (player-independent)', () => {
    expect(stats.totalFloors).toBe(6463);
    expect(stats.totalCombatRooms).toBe(3121);
    expect(stats.totalMonstersFaced).toBe(5264);
    expect(stats.totalCombatTurns).toBe(14961);
    expect(stats.eliteFights).toBe(789);
    expect(stats.bossFights).toBe(323);
    expect(stats.restSiteVisits).toBe(1040);
  });

  it('matches audited household totals within the co-op delta (primary-player-only by design)', () => {
    // 3 of 231 runs are co-op; the audit summed all players, the app sums the
    // primary player only, so app values must be ≤ audit and within 4%.
    // The gold_gained delta was verified externally to be exactly the co-op
    // extras: primary 116,431 + other players 3,831 = audited 120,262.
    const bands: [number, number][] = [
      [stats.totalDamageTaken, 45378],
      [stats.totalHpHealed, 47431],
      [stats.totalGoldGained, 120262],
      [stats.totalGoldSpent, 95045],
      [stats.cardsOffered, 11808],
      [stats.cardsPicked, 2728],
      [stats.potionsUsed, 1548],
    ];
    for (const [app, audit] of bands) {
      expect(app).toBeLessThanOrEqual(audit);
      expect(app).toBeGreaterThanOrEqual(audit * 0.96);
    }
    expect(stats.totalGoldGained).toBe(116431);
    // Small-base metric: percentage bands mislead. Externally verified split:
    // audited household 1,729 = primary 1,609 + co-op teammates 120.
    expect(stats.totalGoldStolen).toBe(1609);
  });

  it('reproduces the audited per-character table', () => {
    const by = Object.fromEntries(stats.byCharacter.map((c) => [c.character, c]));
    expect(by['CHARACTER.SILENT']).toMatchObject({ runs: 50, wins: 10, winRatePct: 20 });
    expect(by['CHARACTER.IRONCLAD']).toMatchObject({ runs: 53, wins: 9, winRatePct: 17 });
    expect(by['CHARACTER.NECROBINDER']).toMatchObject({ runs: 38, wins: 4, winRatePct: 10.5 });
    expect(by['CHARACTER.REGENT']).toMatchObject({ runs: 25, wins: 1, winRatePct: 4 });
    // Defect: audit attributed 65 runs via players[0] (includes co-op files)
    expect(by['CHARACTER.DEFECT'].wins).toBe(9);
    expect(by['CHARACTER.DEFECT'].runs).toBeGreaterThanOrEqual(65);
  });

  it('reproduces the audited nemesis ranking', () => {
    const top = stats.killCauses.slice(0, 3).map((k) => [k.encounter, k.deaths, k.timesFought]);
    expect(top[0]).toEqual(['ENCOUNTER.KNOWLEDGE_DEMON_BOSS', 11, 27]);
    expect(top[1]).toEqual(['ENCOUNTER.THE_KIN_BOSS', 10, 31]);
    const testSubject = stats.killCauses.find((k) => k.encounter === 'ENCOUNTER.TEST_SUBJECT_BOSS');
    expect(testSubject).toMatchObject({ deaths: 7, timesFought: 14, deathRatePct: 50 });
  });

  it('reproduces the audited boss-entry-HP leak cohorts exactly', () => {
    let low = 0,
      lowDeaths = 0,
      healthy = 0,
      healthyDeaths = 0;
    for (const run of completedRuns(runs)) {
      const death = deathNode(run);
      run.nodes.forEach((node, i) => {
        if (!node.rooms.some((r) => r.roomType === 'boss')) return;
        const hp = entryHpPct(run, i);
        if (hp === undefined) return;
        const died = node === death;
        if (hp < 0.6) {
          low++;
          if (died) lowDeaths++;
        } else {
          healthy++;
          if (died) healthyDeaths++;
        }
      });
    }
    expect(low + healthy).toBe(323);
    expect(low).toBe(95);
    expect(lowDeaths).toBe(38); // 40% death rate entering low
    expect(healthyDeaths).toBe(35); // 15% entering healthy
  });

  it('reproduces the audited rich-shop removal stat exactly', () => {
    let richShops = 0,
      noRemoval = 0;
    for (const run of completedRuns(runs)) {
      for (const node of run.nodes) {
        if (!node.rooms.some((r) => r.roomType === 'shop')) continue;
        if (entryGold(node) < 100) continue;
        richShops++;
        if (node.stats.cardsRemoved.length === 0) noRemoval++;
      }
    }
    // The audit reported 359/236 using the simplified reconstruction
    // (gold + spent − gained); entryGold additionally restores gold lost and
    // stolen during the node — the complete formula — which admits 7 more
    // nodes over the 100g line. Both formulas were reproduced on this corpus.
    expect(richShops).toBe(366);
    expect(noRemoval).toBe(239); // 65%
  });

  it('reproduces the audited per-ascension win rates', () => {
    const byAsc = new Map<number, { runs: number; wins: number }>();
    for (const run of runs) {
      const row = byAsc.get(run.ascension) ?? { runs: 0, wins: 0 };
      row.runs++;
      if (run.win) row.wins++;
      byAsc.set(run.ascension, row);
    }
    expect(byAsc.get(0)).toMatchObject({ runs: 46, wins: 5 });
    expect(byAsc.get(2)).toMatchObject({ runs: 12, wins: 5 }); // 42%
    expect(byAsc.get(3)).toMatchObject({ runs: 45, wins: 4 });
    expect(byAsc.get(7)).toMatchObject({ runs: 14, wins: 1 });
    expect(byAsc.get(9)).toMatchObject({ runs: 9, wins: 0 });
  });

  it('detects the audited leaks and frames the per-character walls correctly', () => {
    const leaks = detectLeaks(runs);
    const ids = leaks.filter((l) => l.tier === 'leak' && l.applicable && !l.healthy).map((l) => l.id);
    expect(ids).toContain('boss-entry-hp');
    expect(ids).toContain('removal-discipline');

    // Ascension is climb framing, never a leak. Audited per-character walls
    // (independently recomputed from raw files, acts entered via
    // map_point_history):
    const climb = climbSummary(runs, leaks);
    const walls = Object.fromEntries(climb.walls.map((w) => [w.character, w]));
    expect(walls['CHARACTER.SILENT']).toMatchObject({ frontier: 8, target: 9, attempts: 9, deepestAct: 3 });
    expect(walls['CHARACTER.SILENT'].deathsByAct).toEqual([3, 4, 2]);
    expect(walls['CHARACTER.IRONCLAD']).toMatchObject({ frontier: 6, target: 7, attempts: 6 });
    expect(walls['CHARACTER.IRONCLAD'].deathsByAct).toEqual([1, 2, 3]);
    expect(walls['CHARACTER.IRONCLAD'].topKiller).toEqual({ encounter: 'ENCOUNTER.TEST_SUBJECT_BOSS', deaths: 2 });
    expect(walls['CHARACTER.DEFECT']).toMatchObject({ frontier: 6, target: 7, attempts: 4 });
    expect(walls['CHARACTER.DEFECT'].deathsByAct).toEqual([0, 3, 1]);
    expect(walls['CHARACTER.NECROBINDER']).toMatchObject({ frontier: 3, target: 4, attempts: 2 });
    expect(walls['CHARACTER.REGENT']).toMatchObject({ frontier: 0, target: 1, attempts: 0 });
    // The active wall is the most recently played character (the cutoff run is a Defect A7 loss).
    expect(climb.active?.character).toBe('CHARACTER.DEFECT');
    // Never-settle invariant across the real corpus: no wall below current play.
    for (const wall of climb.walls) {
      const characterRuns = completedRuns(runs).filter((r) => r.player.character === wall.character);
      const latest = characterRuns.reduce((a, b) => (b.startTime > a.startTime ? b : a));
      expect(wall.target).toBeGreaterThanOrEqual(latest.ascension);
    }
  });
});

/**
 * Live-folder smoke: everything above pins to the audited snapshot; this
 * section runs the WHOLE engine over every run in the folder, today's
 * included. No reference numbers — the assertions are lawfulness: nothing
 * throws, every emitted string honors the house rule, every ratio's
 * numerator fits its denominator. Every new run keeps re-validating the
 * detectors against reality.
 */
describe.skipIf(!HISTORY)('live-folder smoke over every run on disk', () => {
  let all: NormalizedRun[] = [];

  beforeAll(() => {
    const files = readdirSync(HISTORY!).filter((f) => /\.run$/i.test(f) && !/\.backup$/i.test(f));
    all = files.map((f) => normalizeRun(JSON.parse(readFileSync(join(HISTORY!, f), 'utf8')), f));
  });

  it('normalizes and autopsies every run without throwing', async () => {
    const { buildAutopsy } = await import('../src/lib/autopsy');
    const leaks = detectLeaks(all);
    for (const run of all) {
      const report = buildAutopsy(run, all, leaks);
      expect(report.runId).toBe(run.id);
      for (const beat of report.narrative) expect(beat.text.length).toBeGreaterThan(0);
    }
  });

  it('every detector speaks lawfully on the full live corpus', () => {
    const leaks = detectLeaks(all);
    expect(leaks.length).toBeGreaterThanOrEqual(11);
    const FORBIDDEN = [/lower ascension/i, /easier (ascension|level)/i, /\bsettl(e|ed|ing)\b/i, /\bnot ready\b/i];
    for (const leak of leaks) {
      const strings = [
        leak.title,
        leak.body,
        leak.confoundNote ?? '',
        leak.drill?.body ?? '',
        ...leak.receiptLines,
        ...leak.runReceipts.map((r) => r.label),
      ];
      for (const s of strings) for (const re of FORBIDDEN) expect(s).not.toMatch(re);
      // every "N/M" ratio in a receipt line keeps its numerator within its denominator
      for (const line of leak.receiptLines) {
        for (const m of line.matchAll(/(\d+)\/(\d+)/g)) {
          expect(Number(m[1])).toBeLessThanOrEqual(Number(m[2]));
        }
      }
      for (const r of leak.runReceipts) {
        expect(all.some((run) => run.id === r.runId)).toBe(true);
      }
    }
  });

  it('the climb never points below current play, and the latest victory points up', async () => {
    const { latestVictory } = await import('../src/lib/climb');
    const climb = climbSummary(all, detectLeaks(all));
    for (const wall of climb.walls) {
      const characterRuns = completedRuns(all).filter((r) => r.player.character === wall.character);
      const latest = characterRuns.reduce((a, b) => (b.startTime > a.startTime ? b : a));
      expect(wall.target).toBeGreaterThanOrEqual(latest.ascension);
    }
    const v = latestVictory(all);
    if (v && v.nextTarget !== undefined) expect(v.nextTarget).toBeGreaterThan(v.ascension);
  });
});
