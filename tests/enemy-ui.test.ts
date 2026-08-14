/**
 * Enemy UI — the pure functions behind the tooltip and the dossier.
 *
 * Two things are load-bearing and both are tested against the real fixture
 * corpus rather than a hand-built fake:
 *  - the dossier's record must reconcile with the nemesis board's headline.
 *    computeStats owns that headline, so encounterRecord() is asserted to
 *    reproduce it exactly, and the per-character rows to sum back to it. If
 *    the two ever drift, a player who remembers the run could catch the panel
 *    contradicting the row above it.
 *  - no HP figure is printed without saying which ascension column it came
 *    from, because the wiki carries two and they differ from A8 up.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalizeRun } from '../src/lib/normalize';
import { computeStats } from '../src/lib/stats';
import { dossier } from '../src/lib/enemies';
import type { NormalizedRun } from '../src/lib/types';
import { enemyMeta, enemyTipLines, hpSpan, hpText } from '../src/components/EnemyName';
import { encounterRecord, deathRatePct, intentTags, sameEntity, viewerAscension } from '../src/components/EnemyDossier';

const FIXTURES = ['1774194024', '1776190046', '1778212793', '1778528032', '1779248265', '1785858459'];

function load(name: string): NormalizedRun {
  const path = fileURLToPath(new URL(`./fixtures/${name}.run`, import.meta.url));
  return normalizeRun(JSON.parse(readFileSync(path, 'utf8')), `${name}.run`);
}

const CORPUS = FIXTURES.map(load);

describe('encounterRecord', () => {
  it('reproduces the nemesis board headline for every kill cause', () => {
    const { killCauses } = computeStats(CORPUS);
    expect(killCauses.length).toBeGreaterThan(0);
    for (const cause of killCauses) {
      const record = encounterRecord(CORPUS, cause.encounter);
      expect(record.deaths).toBe(cause.deaths);
      expect(record.meetings).toBe(cause.timesFought);
      expect(deathRatePct(record.deaths, record.meetings)).toBe(cause.deathRatePct);
    }
  });

  it('splits by character without losing or inventing a fight', () => {
    const { killCauses } = computeStats(CORPUS);
    for (const cause of killCauses) {
      const record = encounterRecord(CORPUS, cause.encounter);
      const meetings = record.byCharacter.reduce((a, c) => a + c.meetings, 0);
      const deaths = record.byCharacter.reduce((a, c) => a + c.deaths, 0);
      expect(meetings).toBe(record.meetings);
      expect(deaths).toBe(record.deaths);
      // one row per character, most-met first
      expect(new Set(record.byCharacter.map((c) => c.character)).size).toBe(record.byCharacter.length);
      for (let i = 1; i < record.byCharacter.length; i += 1) {
        expect(record.byCharacter[i - 1].meetings).toBeGreaterThanOrEqual(record.byCharacter[i].meetings);
      }
    }
  });

  it('records the last meeting and how that run ended', () => {
    const { killCauses } = computeStats(CORPUS);
    const killer = killCauses[0];
    const record = encounterRecord(CORPUS, killer.encounter);
    expect(record.last).toBeDefined();
    const runsThatMet = CORPUS.filter(
      (r) =>
        r.killedByEncounter === killer.encounter ||
        r.nodes.some((n) => n.rooms.some((m) => m.modelId === killer.encounter && m.monsterIds.length > 0)),
    );
    const newest = Math.max(...runsThatMet.map((r) => r.startTime));
    expect(record.last!.startTime).toBe(newest);
  });

  it('is empty for an encounter never met', () => {
    const record = encounterRecord(CORPUS, 'ENCOUNTER.NOT_A_REAL_FIGHT');
    expect(record).toEqual({ meetings: 0, deaths: 0, meetingsLogged: false, byCharacter: [], last: undefined });
  });

  it('flags a kill count standing in for a meeting count', () => {
    // computeStats falls back to meetings = deaths when no combat room was
    // logged. Mirrored here, but flagged: "3 kills in 3 meetings — 100%" is a
    // denominator a player could disprove, so the panel must not print it.
    const ghost = CORPUS.map((r, i) => {
      const copy = JSON.parse(JSON.stringify(r)) as typeof r;
      if (i < 3) {
        copy.win = false;
        copy.abandoned = false;
        copy.killedByEncounter = 'ENCOUNTER.GHOST_FIGHT';
      }
      return copy;
    });
    const record = encounterRecord(ghost, 'ENCOUNTER.GHOST_FIGHT');
    expect(record.deaths).toBe(3);
    expect(record.meetings).toBe(3); // the fallback, mirroring computeStats
    expect(record.meetingsLogged).toBe(false);
  });

  it('reads the ascension off the latest run in view', () => {
    const latest = [...CORPUS].sort((a, b) => b.startTime - a.startTime)[0];
    expect(viewerAscension(CORPUS)).toBe(latest.ascension);
    expect(viewerAscension([])).toBe(0);
  });
});

describe('HP is never printed without its ascension column', () => {
  it('labels which column it read when the two differ', () => {
    const flail = dossier('MONSTER.FLAIL_KNIGHT', 0)!; // 101 base, 108 at A8+
    expect(hpText(flail, 0)).toBe('101 HP (A0–A7)');
    expect(hpText(flail, 12)).toBe('108 HP (A8+)');
  });

  it('keeps a wiki range a range instead of collapsing it to the low bound', () => {
    const slime = dossier('MONSTER.LEAF_SLIME_M', 0)!; // "32-35"
    expect(hpSpan(slime, 0)).toMatchObject({ lo: 32, hi: 35, counted: 1 });
    expect(hpText(slime, 0)).toBe('32–35 HP (A0–A7)');
  });

  it('sums a group roster and says how many members it counted', () => {
    const knights = dossier('ENCOUNTER.KNIGHTS_ELITE', 12)!;
    const span = hpSpan(knights, 12)!;
    // the Knight Gang entry carries the roster but no HP of its own
    expect(span.counted).toBe(knights.members.filter((m) => m.hp).length);
    expect(enemyMeta(knights, 12)).toContain(`roster of ${span.counted}`);
  });

  it('drops the column note when the wiki lists one HP for every ascension', () => {
    for (const id of ['MONSTER.FLAIL_KNIGHT', 'MONSTER.LEAF_SLIME_M']) {
      const d = dossier(id, 0)!;
      const span = hpSpan(d, 0)!;
      if (!span.columnMatters) expect(hpText(d, 0)).not.toContain('A');
    }
  });
});

describe('tooltip body', () => {
  it('lists the whole intent table for a short single-monster fight', () => {
    const insatiable = dossier('ENCOUNTER.THE_INSATIABLE_BOSS', 0)!;
    const lines = enemyTipLines(insatiable);
    expect(lines).toContain('Lunging Bite — Deals 28 (31 at A9+) damage.');
    expect(lines.length).toBe(insatiable.members[0].intents!.length);
  });

  it('falls back to the roster and the hardest hit for a group', () => {
    const knights = dossier('ENCOUNTER.KNIGHTS_ELITE', 0)!;
    const lines = enemyTipLines(knights);
    expect(lines[0]).toMatch(/^Roster: /);
    expect(lines.some((l) => l.startsWith('Hardest hit — '))).toBe(true);
  });

  it('says nothing at all about an encounter the wiki does not carry', () => {
    expect(dossier('ENCOUNTER.KAISER_CRAB_ELITE', 0)).toBeUndefined();
  });
});

describe('sameEntity', () => {
  it('treats a spelling difference as the same creature', () => {
    expect(sameEntity('Leaf Slime (M)', 'Leaf Slime M')).toBe(true);
  });

  it('treats a plural encounter resolving to a singular entry as different', () => {
    // ENCOUNTER.INFESTED_PRISMS_ELITE resolves to one Infested Prism, whose HP
    // is one body — the panel has to name which of the two its numbers are.
    expect(sameEntity('Infested Prism', 'Infested Prisms')).toBe(false);
    expect(dossier('ENCOUNTER.INFESTED_PRISMS_ELITE', 0)!.members[0].name).toBe('Infested Prism');
  });
});

describe('intentTags', () => {
  it('reports a multi-hit swing as its total and its hit count', () => {
    expect(intentTags({ name: 'Thrash', text: 'Deals 8 (9 at A9+) damage ×2.' })).toEqual([
      { kind: 'attack', label: '16 total ×2' },
    ]);
  });

  it('names every debuff a single intent applies', () => {
    const tags = intentTags({ name: 'Orb of Frailty', text: 'Deals 8 (9 at A9+) damage. Applies 1 Frail.' });
    expect(tags).toEqual([
      { kind: 'attack', label: '8 dmg' },
      { kind: 'debuff', label: 'Frail' },
    ]);
  });

  it('does not repeat the intent name back as a debuff chip', () => {
    expect(intentTags({ name: 'Hex', text: 'Applies 2 Hex.' })).toEqual([]);
  });

  it('tags a block intent and leaves an attackless line unrated', () => {
    expect(intentTags({ name: 'Guard', text: 'Gains 12 Block.' })).toEqual([{ kind: 'block', label: 'Block' }]);
    expect(intentTags({ name: 'Salivate', text: 'Gains 2 (3 at A9+) Strength.' })).toEqual([]);
  });
});
