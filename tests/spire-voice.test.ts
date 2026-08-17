/**
 * spire-voice.test.ts — the audit the Spire's voice exists to pass.
 *
 * The voice is atmospheric, which is exactly why it is the most likely place
 * for an invented fact to appear. So every passage is checked back against the
 * record it claims to reword:
 *   (a) every digit in a passage appears in the LeakResult / DrillProgress /
 *       LatestVictory fields that passage is tagged to (src + leakId), and
 *       pure-address passages carry no digits at all;
 *   (b) the house rule holds — the FORBIDDEN list is copied verbatim from
 *       tests/copy-guard.test.ts (that file is not edited);
 *   (c) no exclamation marks and no emoji;
 *   (d) a victory passage never names an ascension below the run's own.
 * Corpora are built by cloning fixtures the way tests/leaks.test.ts does, then
 * split exactly the way Coach.tsx splits them before handing them to the view.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ASCENSION_CAP, latestVictory, type LatestVictory } from '../src/lib/climb';
import { computeDrillProgress, DRILLS, type ActiveDrill, type DrillProgress } from '../src/lib/drills';
import { detectLeaks } from '../src/lib/leaks';
import { normalizeRun } from '../src/lib/normalize';
import { spireNarration, SPELLED_NUMERALS, type SpireNarration, type SpirePassage } from '../src/lib/spireVoice';
import type { LeakResult, NormalizedRun } from '../src/lib/types';

// ---------- corpora ----------

function loadFixture(name: string): NormalizedRun {
  const path = fileURLToPath(new URL(`./fixtures/${name}.run`, import.meta.url));
  return normalizeRun(JSON.parse(readFileSync(path, 'utf8')), `${name}.run`);
}

const win1779 = loadFixture('1779248265'); // Silent A6 win
const win1776 = loadFixture('1776190046'); // Defect A0 win
const loss1785 = loadFixture('1785858459'); // Defect A6 loss
const loss1774 = loadFixture('1774194024'); // Ironclad A1 loss
const loss1778 = loadFixture('1778212793'); // Necrobinder A3 loss
const abandoned = loadFixture('1778528032');

let counter = 0;
function clones(run: NormalizedRun, n: number, mutate?: (r: NormalizedRun) => void): NormalizedRun[] {
  return Array.from({ length: n }, () => {
    counter += 1;
    const copy = JSON.parse(JSON.stringify(run)) as NormalizedRun;
    copy.id = `${run.id}-s${counter}`;
    copy.startTime = run.startTime + counter * 3600;
    mutate?.(copy);
    return copy;
  });
}

const CORPORA: Record<string, NormalizedRun[]> = {
  // mixed: applicable leaks, observations, and a healthy verdict or two
  mixed: [
    ...clones(win1779, 7),
    ...clones(win1776, 7),
    ...clones(loss1785, 14),
    ...clones(loss1774, 2),
    ...clones(loss1778, 2),
    ...clones(abandoned, 2),
  ],
  // tiny: every detector declines — the Spire has nothing to hold against you
  tiny: [win1779, win1776, loss1785, loss1774, loss1778, abandoned],
  // winless: no victory opener anywhere
  winless: [...clones(loss1785, 12), ...clones(loss1774, 10)],
  // all wins: healthy verdicts, the "what I could not find" branch
  wins: [...clones(win1779, 14), ...clones(win1776, 12)],
  // at the cap: the victory branch with no level above it
  summited: [
    ...clones(loss1785, 10, (r) => {
      r.ascension = ASCENSION_CAP;
    }),
    ...clones(win1779, 12, (r) => {
      r.ascension = ASCENSION_CAP;
    }),
  ],
};

/** Exactly the split Coach.tsx performs before rendering a voice. */
function coachSplit(runs: NormalizedRun[]): { leaks: LeakResult[]; drawerItems: LeakResult[]; all: LeakResult[] } {
  const all = detectLeaks(runs);
  const applicable = all.filter((l) => l.applicable);
  const healthy = applicable.filter((l) => l.healthy);
  const active = applicable.filter((l) => !l.healthy);
  const ranked = active.filter((l) => l.tier === 'leak').sort((a, b) => b.expectedWinsLost - a.expectedWinsLost);
  return {
    leaks: ranked,
    drawerItems: [...ranked.slice(3), ...active.filter((l) => l.tier === 'observation'), ...healthy],
    all,
  };
}

/** Every drill this corpus can put under way, graded from the first run on. */
function drillStates(runs: NormalizedRun[], all: LeakResult[]): DrillProgress[] {
  const out: DrillProgress[] = [];
  for (const id of Object.keys(DRILLS)) {
    const card = all.find((l) => l.id === id);
    const drill: ActiveDrill = {
      leakId: id,
      acceptedAt: 0,
      targetRuns: DRILLS[id].targetRuns,
      bar: card?.drillBar,
      subject: card?.drillSubject,
    };
    const progress = computeDrillProgress(drill, runs);
    if (progress) out.push(progress);
    // and the same drill with nothing graded yet (accepted after every run)
    const fresh = computeDrillProgress({ ...drill, acceptedAt: Date.now() * 2 }, runs);
    if (fresh) out.push(fresh);
  }
  return out;
}

/** Hand-built victories covering all three branches of the opener. */
const VICTORIES: LatestVictory[] = [
  { character: 'CHARACTER.SILENT', ascension: 6, newFrontier: true, nextTarget: 7 },
  { character: 'CHARACTER.IRONCLAD', ascension: ASCENSION_CAP, newFrontier: true, nextTarget: undefined },
  { character: 'CHARACTER.DEFECT', ascension: 4, newFrontier: false, nextTarget: 5 },
];

/** Every narration reachable from these corpora, tagged with what fed it. */
interface Case {
  name: string;
  narration: SpireNarration;
  leaks: LeakResult[];
  drawerItems: LeakResult[];
  victory?: LatestVictory;
  drill?: DrillProgress;
}

const CASES: Case[] = [];
for (const [name, runs] of Object.entries(CORPORA)) {
  const { leaks, drawerItems, all } = coachSplit(runs);
  const victories: (LatestVictory | undefined)[] = [undefined, latestVictory(runs), ...VICTORIES];
  for (const [vi, victory] of victories.entries()) {
    CASES.push({
      name: `${name} · victory ${vi}`,
      narration: spireNarration(leaks, drawerItems, victory),
      leaks,
      drawerItems,
      victory,
    });
  }
  for (const drill of drillStates(runs, all)) {
    CASES.push({
      name: `${name} · drill ${drill.drill.leakId} · ${drill.graded.length} graded`,
      narration: spireNarration(leaks, drawerItems, latestVictory(runs), drill),
      leaks,
      drawerItems,
      victory: latestVictory(runs),
      drill,
    });
  }
}

// ---------- number extraction ----------

const digitsIn = (text: string): number[] => (text.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);

/** Every number the detector actually produced for this leak. */
function leakNumbers(leak: LeakResult): Set<number> {
  const strings = [
    leak.title,
    leak.body,
    ...leak.receiptLines,
    ...leak.runReceipts.map((r) => r.label),
    leak.ratioBadge ?? '',
    leak.confoundNote ?? '',
    leak.drill?.title ?? '',
    leak.drill?.body ?? '',
    leak.dumbbell?.label ?? '',
    leak.dumbbell?.sampleLabel ?? '',
    leak.dumbbell?.winLabel ?? '',
    leak.dumbbell?.lossLabel ?? '',
  ];
  const nums = strings.flatMap(digitsIn);
  if (leak.dumbbell) nums.push(leak.dumbbell.winValue, leak.dumbbell.lossValue);
  if (leak.drillBar !== undefined) nums.push(leak.drillBar);
  return new Set(nums);
}

function drillNumbers(p: DrillProgress): Set<number> {
  const strings = [
    p.def.title,
    p.def.assignment,
    ...p.graded.map((g) => `${g.label} ${g.note ?? ''}`),
  ];
  const nums = strings.flatMap(digitsIn);
  nums.push(p.drill.targetRuns, p.passes, p.fails, p.graded.length);
  if (p.drill.bar !== undefined) nums.push(p.drill.bar);
  return new Set(nums);
}

function victoryNumbers(v: LatestVictory): Set<number> {
  const nums = [v.ascension];
  if (v.nextTarget !== undefined) nums.push(v.nextTarget);
  return new Set(nums);
}

// ---------- (a) grounding ----------

describe('the Spire never narrates a number that is not in the record', () => {
  it('builds narrations across every corpus and drill state', () => {
    expect(CASES.length).toBeGreaterThan(20);
    // the leanest reachable page is still an opening and a closing address
    for (const c of CASES) expect(c.narration.passages.length).toBeGreaterThanOrEqual(2);
  });

  it.each(CASES.map((c) => [c.name, c] as const))('%s: every digit traces to its source', (_name, c) => {
    const byId = new Map([...c.leaks, ...c.drawerItems].map((l) => [l.id, l]));
    for (const p of c.narration.passages) {
      const found = digitsIn(p.text);
      if (p.src === 'spire') {
        // pure address: the Spire's own grammar, with nothing to check
        expect(found, `address passage carries digits: ${p.text}`).toEqual([]);
        continue;
      }
      if (found.length === 0) continue;
      let pool: Set<number>;
      if (p.src === 'leak') {
        const leak = byId.get(p.leakId ?? '');
        expect(leak, `passage tagged to an unknown leak: ${p.leakId}`).toBeTruthy();
        pool = leakNumbers(leak!);
      } else if (p.src === 'drill') {
        expect(c.drill).toBeTruthy();
        pool = drillNumbers(c.drill!);
      } else {
        expect(c.victory).toBeTruthy();
        pool = victoryNumbers(c.victory!);
      }
      for (const n of found) {
        expect(pool.has(n), `"${n}" in «${p.text}» is not in its ${p.src} record`).toBe(true);
      }
    }
  });

  it('the title never carries a number', () => {
    for (const c of CASES) expect(digitsIn(c.narration.title)).toEqual([]);
  });

  it('spelled-out counts are repeated in digits in the mono aside beneath them', () => {
    const spelled = SPELLED_NUMERALS.map((word, value) => ({ word, value })).slice(2); // "one"/"two" occur as prose
    for (const c of CASES) {
      const asideDigits = new Set(
        c.narration.passages.filter((p) => p.tone === 'aside').flatMap((p) => digitsIn(p.text)),
      );
      for (const p of c.narration.passages) {
        if (p.src !== 'drill' || p.tone === 'aside') continue;
        for (const { word, value } of spelled) {
          if (new RegExp(`\\b${word}\\b`, 'i').test(p.text)) {
            expect(asideDigits.has(value), `«${p.text}» spells ${word} with no ${value} in the receipts`).toBe(true);
          }
        }
      }
    }
  });
});

// ---------- (b) the house rule ----------

// Copied verbatim from tests/copy-guard.test.ts — that file is the source of
// truth for the rule and is not edited by this one.
const FORBIDDEN: RegExp[] = [
  /lower ascension/i,
  /easier (ascension|level|difficulty)/i,
  /\bsettl(e|es|ed|ing)\b/i,
  /\bstep (back )?down\b/i,
  /\bback down to\b/i,
  /\bdrop(s|ped|ping)? (back )?(down )?to a/i,
  /\b(go|going|went|return|returning|retreat|retreating|climb|move|moving) (back |down )+to a\d/i,
  /\b(go|return|retreat) to a\d/i,
  /practi[cs]e at a/i,
  /\bfarm(ing)? (easy )?(wins|win ?rate)\b/i,
  /\bwin ?rate first\b/i,
  /\b(not|n't|not yet) ready\b/i,
];

describe('the Spire never tells you to take a smaller mountain', () => {
  it.each(CASES.map((c) => [c.name, c] as const))('%s emits no settle-down copy', (_name, c) => {
    for (const text of [c.narration.title, ...c.narration.passages.map((p) => p.text)]) {
      for (const pattern of FORBIDDEN) expect(text).not.toMatch(pattern);
    }
  });
});

// ---------- (c) tone ----------

describe('tone', () => {
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2190}-\u{21FF}\u{2600}-\u{27BF}\u{FE0F}]/u;

  it('never raises its voice and never draws a picture', () => {
    for (const c of CASES) {
      for (const text of [c.narration.title, ...c.narration.passages.map((p) => p.text)]) {
        expect(text).not.toContain('!');
        expect(text).not.toMatch(EMOJI);
      }
    }
  });

  it('addresses the climber in the second person', () => {
    for (const c of CASES) {
      const prose = c.narration.passages.filter((p) => p.tone === 'prose').map((p) => p.text);
      expect(prose.some((t) => /\byou\b|\byour\b/i.test(t))).toBe(true);
    }
  });
});

// ---------- (d) the wall ----------

describe('the victory opener points up, never down', () => {
  it('never names an ascension below the run it is celebrating', () => {
    for (const c of CASES) {
      if (!c.victory) continue;
      for (const p of c.narration.passages) {
        if (p.src !== 'victory') continue;
        const named = [...p.text.matchAll(/\bA(\d+)\b/g)].map((m) => Number(m[1]));
        expect(named.length).toBeGreaterThan(0);
        for (const level of named) expect(level).toBeGreaterThanOrEqual(c.victory.ascension);
      }
    }
  });

  it('states the next wall whenever the win took a new level and one is left', () => {
    const { leaks, drawerItems } = coachSplit(CORPORA.mixed);
    const n = spireNarration(leaks, drawerItems, VICTORIES[0]);
    const victory = n.passages.filter((p: SpirePassage) => p.src === 'victory').map((p) => p.text);
    expect(victory.join(' ')).toContain('A7');
  });
});

// ---------- coverage of the branches that must exist ----------

describe('what the Spire says when there is nothing to accuse', () => {
  it('reports what it could not find, from the healthy bodies', () => {
    const { leaks, drawerItems } = coachSplit(CORPORA.wins);
    const healthy = drawerItems.filter((l) => l.healthy);
    expect(healthy.length).toBeGreaterThan(0);
    const n = spireNarration(leaks, drawerItems);
    const text = n.passages.map((p) => p.text).join('\n');
    expect(text).toContain('What I looked for and did not find');
    for (const l of healthy) expect(n.passages.some((p) => p.leakId === l.id)).toBe(true);
  });

  it('still speaks when every detector is locked', () => {
    const { leaks, drawerItems } = coachSplit(CORPORA.tiny);
    expect(leaks).toEqual([]);
    const n = spireNarration(leaks, drawerItems);
    expect(n.passages.length).toBeGreaterThan(1);
    expect(n.title).toBe('I find little to hold against you');
  });

  it('narrates at most the three leaks the coach cards, in the coach’s order', () => {
    const { leaks, drawerItems } = coachSplit(CORPORA.mixed);
    expect(leaks.length).toBeGreaterThan(3);
    const n = spireNarration(leaks, drawerItems);
    const narrated = [...new Set(n.passages.filter((p) => p.src === 'leak').map((p) => p.leakId))];
    const top3 = leaks.slice(0, 3).map((l) => l.id);
    expect(narrated.slice(0, 3)).toEqual(top3);
  });

  it('carries the run receipt ids so names keep their tooltips', () => {
    const { leaks, drawerItems } = coachSplit(CORPORA.mixed);
    const n = spireNarration(leaks, drawerItems);
    const memories = n.passages.filter((p) => p.runRef);
    expect(memories.length).toBeGreaterThan(0);
    const withEnemies = memories.filter((p) => (p.enemyIds ?? []).length > 0);
    expect(withEnemies.length).toBeGreaterThan(0);
  });
});
