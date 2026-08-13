/**
 * Copy guard — the coach must NEVER advise playing a lower ascension.
 *
 * House rule (Luke, Aug 2026): coaching is about breaking through the level
 * the player is stuck on, never about retreating to an easier one to farm win
 * rate. The only place win-rate-first framing is allowed is a character that
 * has beaten the cap (nothing above to take).
 *
 * Two layers:
 *  - words: every user-facing string the engine can emit (leak copy, dumbbell
 *    labels, drills and their grade notes, wall lines, autopsy beats and
 *    moments) is collected across corpora engineered to hit many branches,
 *    and settle-down phrasings are rejected;
 *  - numbers: a wall line never names a level below its own target, and an
 *    autopsy beat never names an ascension other than the run's own.
 * The structural guard (target never below the character's play) lives in
 * the climb tests.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeRun } from '../src/lib/normalize';
import { detectLeaks } from '../src/lib/leaks';
import { ASCENSION_CAP, climbSummary, wallLine } from '../src/lib/climb';
import { buildAutopsy } from '../src/lib/autopsy';
import { DRILLS } from '../src/lib/drills';
import type { NormalizedRun } from '../src/lib/types';

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
    copy.id = `${run.id}-g${counter}`;
    copy.startTime = run.startTime + counter * 3600;
    mutate?.(copy);
    return copy;
  });
}

/** Corpora chosen to reach many detector states: applicable, healthy, locked. */
const CORPORA: NormalizedRun[][] = [
  // full mixed corpus (applicable leaks + observations)
  [
    ...clones(win1779, 7),
    ...clones(win1776, 7),
    ...clones(loss1785, 14),
    ...clones(loss1774, 2),
    ...clones(loss1778, 2),
    ...clones(abandoned, 2),
  ],
  // tiny corpus (everything locked / not-yet-applicable)
  [win1779, win1776, loss1785, loss1774, loss1778, abandoned],
  // winless corpus (frontier-less walls)
  [...clones(loss1785, 12), ...clones(loss1774, 10)],
  // summited corpus (the one place consistency framing is allowed)
  [
    ...clones(win1779, 12, (r) => {
      r.ascension = ASCENSION_CAP;
    }),
    ...clones(loss1785, 10, (r) => {
      r.ascension = ASCENSION_CAP;
    }),
  ],
  // above-cap corpus (game patch ahead of the constant)
  [
    ...clones(loss1785, 6, (r) => {
      r.ascension = ASCENSION_CAP + 2;
    }),
    ...clones(win1776, 3, (r) => {
      r.ascension = ASCENSION_CAP + 2;
    }),
  ],
];

function emittedStrings(corpus: NormalizedRun[]): string[] {
  const out: string[] = [];
  const leaks = detectLeaks(corpus);
  for (const l of leaks) {
    out.push(l.title, l.body);
    if (l.drill) out.push(l.drill.title, l.drill.body);
    if (l.confoundNote) out.push(l.confoundNote);
    if (l.ratioBadge) out.push(l.ratioBadge);
    if (l.dumbbell) {
      out.push(l.dumbbell.label, l.dumbbell.sampleLabel);
      if (l.dumbbell.winLabel) out.push(l.dumbbell.winLabel);
      if (l.dumbbell.lossLabel) out.push(l.dumbbell.lossLabel);
    }
    out.push(...l.receiptLines, ...l.runReceipts.map((r) => r.label));
  }
  const climb = climbSummary(corpus, leaks);
  for (const wall of climb.walls) out.push(wallLine(wall));
  for (const def of Object.values(DRILLS)) {
    out.push(def.title, def.assignment);
    for (const run of corpus.filter((r) => !r.abandoned)) {
      const { note } = def.grade(run);
      if (note) out.push(note);
    }
  }
  for (const run of corpus) {
    const report = buildAutopsy(run, corpus, leaks);
    out.push(...report.narrative.map((b) => b.text));
    for (const m of report.moments) {
      out.push(m.label);
      if (m.detail) out.push(m.detail);
    }
  }
  return out;
}

describe('copy guard: the coach never advises settling at a lower ascension', () => {
  it.each(CORPORA.map((c, i) => [i, c] as const))('corpus %i emits no settle-down copy', (_i, corpus) => {
    for (const text of emittedStrings(corpus)) {
      for (const pattern of FORBIDDEN) {
        expect(text).not.toMatch(pattern);
      }
    }
  });

  it('the wall line never names an ascension below the wall itself', () => {
    for (const corpus of CORPORA) {
      const climb = climbSummary(corpus, detectLeaks(corpus));
      for (const wall of climb.walls) {
        const mentioned = [...wallLine(wall).matchAll(/\bA(\d+)\b/g)].map((m) => Number(m[1]));
        for (const level of mentioned) expect(level).toBeGreaterThanOrEqual(wall.target);
      }
    }
  });

  it('an autopsy beat never names an ascension other than the run’s own', () => {
    for (const corpus of CORPORA) {
      const leaks = detectLeaks(corpus);
      for (const run of corpus) {
        const report = buildAutopsy(run, corpus, leaks);
        for (const beat of report.narrative) {
          const mentioned = [...beat.text.matchAll(/\bA(\d+)\b/g)].map((m) => Number(m[1]));
          for (const level of mentioned) expect(level).toBe(run.ascension);
        }
      }
    }
  });
});

// ---------- the observation drawer's one-line summary ----------

describe('firstSentence', () => {
  // Mirrors src/views/Coach.tsx — observation bodies are full of decimals, and
  // "Wins average 2." shipped to the drawer before this rule existed.
  function firstSentence(text: string): string {
    const match = text.match(/^.*?[.!?](?=\s+[A-Z“"(]|\s*$)/s);
    return match ? match[0].trim() : text;
  }

  it('does not cut a sentence at a decimal point', () => {
    expect(firstSentence('Wins average 2.4 elites in act 1; losses average 1.9. Then more.')).toBe(
      'Wins average 2.4 elites in act 1; losses average 1.9.',
    );
    expect(firstSentence('Your losses draft as much early damage as your wins (1.8 vs 1.6 attacks).')).toBe(
      'Your losses draft as much early damage as your wins (1.8 vs 1.6 attacks).',
    );
  });

  it('still stops at a real sentence break', () => {
    expect(firstSentence('The door was half-closed. The rest followed.')).toBe('The door was half-closed.');
  });

  it('returns the whole text when there is no terminator', () => {
    expect(firstSentence('No period here')).toBe('No period here');
  });

  it('keeps every shipped observation body to one readable sentence', () => {
    const bodies = CORPORA.flatMap((c) =>
      detectLeaks(c)
        .filter((l) => l.tier === 'observation' && l.applicable)
        .map((l) => l.body),
    );
    expect(bodies.length).toBeGreaterThan(5);
    for (const body of bodies) {
      const line = firstSentence(body);
      expect(body.startsWith(line)).toBe(true);
      expect(line.length).toBeGreaterThan(12);
      // The cut is only legal at a real sentence break: either the body ends
      // there, or what follows opens a new sentence. "Wins average 2." — the
      // shipped bug — fails here because "4 elites" follows.
      const rest = body.slice(line.length);
      if (rest.trim().length > 0) expect(rest).toMatch(/^\s+[A-Z“"(]/);
    }
  });
});
