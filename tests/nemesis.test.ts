/**
 * nemesis.test.ts — the nemesis detector, hand-derived from the fixture corpus.
 *
 * Fixture facts this file leans on (verified by dumping every combat room):
 *   win  1779248265  Silent A6 win — meets ENCOUNTER.THE_INSATIABLE_BOSS once,
 *                    on floor 33, entered at 74%, cleared in 2 turns, 6
 *                    upgrades banked, 14 cards added. 22 combat rooms in all.
 *   win  1776190046  Defect A0 win — meets ENCOUNTER.KAISER_CRAB_BOSS on floor
 *                    33 (the boss the wiki has no entry for). 22 combat rooms.
 *   loss 1785858459  Defect A6 loss — dies to THE_INSATIABLE_BOSS on floor 33,
 *                    entered at 57%, 7 turns, 2 upgrades banked, 24 cards
 *                    added. 13 combat rooms.
 *   loss 1774194024  Ironclad A1 loss — dies to PHROG_PARASITE_ELITE, floor 6.
 *
 * Every expected number below is derived from those facts times the clone
 * count, never copied out of a previous run of the code.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DRILLS } from '../src/lib/drills';
import { detectLeaks } from '../src/lib/leaks';
import {
  BAR_FLOOR,
  MIN_CHAR_FIGHTS,
  meetings,
  nemesisBar,
  nemesisContext,
  nemesisId,
  nemesisLeak,
} from '../src/lib/leaks/nemesis';
import { normalizeRun } from '../src/lib/normalize';
import type { NormalizedRun } from '../src/lib/types';

function loadFixture(name: string): NormalizedRun {
  const path = fileURLToPath(new URL(`./fixtures/${name}.run`, import.meta.url));
  return normalizeRun(JSON.parse(readFileSync(path, 'utf8')), `${name}.run`);
}

const win1779 = loadFixture('1779248265');
const win1776 = loadFixture('1776190046');
const loss1785 = loadFixture('1785858459');
const loss1774 = loadFixture('1774194024');
const abandoned = loadFixture('1778528032');

const INSATIABLE = 'ENCOUNTER.THE_INSATIABLE_BOSS';
const KAISER = 'ENCOUNTER.KAISER_CRAB_BOSS';

let cloneCounter = 0;
function clones(run: NormalizedRun, n: number, mutate?: (r: NormalizedRun) => void): NormalizedRun[] {
  return Array.from({ length: n }, () => {
    cloneCounter += 1;
    const copy = JSON.parse(JSON.stringify(run)) as NormalizedRun;
    copy.id = `${run.id}-n${cloneCounter}`;
    copy.startTime = run.startTime + cloneCounter * 3600;
    mutate?.(copy);
    return copy;
  });
}

const asCharacter = (character: string) => (r: NormalizedRun) => {
  r.player.character = character;
};

/** Raise the pre-death node's HP so the killing meeting is entered at 80/92 ≈ 87%. */
const healthyDeathEntry = (r: NormalizedRun) => {
  r.nodes[31].stats.hp = 80;
};

/**
 * 30 completed runs — the same corpus leaks.test.ts uses.
 * The Insatiable: 7 survived meetings (Silent) + 14 deaths (Defect) = 21.
 */
const corpusMain = [
  ...clones(win1779, 7),
  ...clones(win1776, 7),
  ...clones(loss1785, 10),
  ...clones(loss1785, 4, healthyDeathEntry),
  ...clones(loss1774, 2),
];

// ---------- meetings: the population everything else is counted over ----------

describe('meetings', () => {
  it('reads one meeting per combat room, with the state carried into it', () => {
    const met = meetings(loss1785, INSATIABLE);
    expect(met).toHaveLength(1);
    expect(met[0]).toMatchObject({
      encounterId: INSATIABLE,
      floor: 33,
      act: 2,
      turns: 7,
      potionsThrown: 2,
      upgradesBanked: 2,
      died: true,
    });
    expect(Math.round(met[0].entryPct! * 100)).toBe(57);
  });

  it('counts a survived meeting with the same encounter as not-died', () => {
    const met = meetings(win1779, INSATIABLE);
    expect(met).toHaveLength(1);
    expect(met[0].died).toBe(false);
    expect(Math.round(met[0].entryPct! * 100)).toBe(74);
  });

  it('unfiltered, returns every combat room in the run', () => {
    expect(meetings(loss1785)).toHaveLength(13);
    expect(meetings(win1779)).toHaveLength(22);
    expect(meetings(win1776)).toHaveLength(22);
    expect(meetings(loss1774)).toHaveLength(3);
  });

  it('never calls a fight a death unless the run ended on it AND named it', () => {
    // The Phrog elite is fought on floor 9 of the Defect loss and survived; the
    // same encounter ends the Ironclad run on floor 6.
    expect(meetings(loss1785, 'ENCOUNTER.PHROG_PARASITE_ELITE')[0].died).toBe(false);
    expect(meetings(loss1774, 'ENCOUNTER.PHROG_PARASITE_ELITE')[0].died).toBe(true);
    // A run whose killed-by field names something else claims no death here.
    const misattributed = clones(loss1785, 1, (r) => {
      r.killedByEncounter = 'ENCOUNTER.SOMETHING_ELSE';
    })[0];
    expect(meetings(misattributed, INSATIABLE)[0].died).toBe(false);
  });
});

// ---------- gating: thin samples say so instead of computing ----------

describe('gating', () => {
  it('declines below 20 completed runs and names the number it has', () => {
    const res = nemesisLeak([win1779, win1776, loss1785, loss1774]);
    expect(res.applicable).toBe(false);
    expect(res.receiptLines).toHaveLength(0);
    expect(res.expectedWinsLost).toBe(0);
    expect(res.body).toContain('you have 4');
  });

  it('declines when nothing has been met 10 times, however many runs there are', () => {
    // 20 runs whose encounter ids are made unique per run: plenty of deaths,
    // no repeat fight, so there is nothing a death rate could be computed over.
    const unrepeatable = clones(loss1774, 20, (r) => {
      for (const node of r.nodes) {
        for (const room of node.rooms) if (room.modelId) room.modelId = `${room.modelId}.${r.id}`;
      }
      r.killedByEncounter = `ENCOUNTER.PHROG_PARASITE_ELITE.${r.id}`;
    });
    const res = nemesisLeak(unrepeatable);
    expect(res.applicable).toBe(false);
    expect(res.body).toContain('10 times');
    expect(nemesisId(unrepeatable)).toBeUndefined();
  });

  it('reports a clean bill of health when the deadliest repeat fight is under the death floor', () => {
    // The Insatiable: 20 meetings, 2 deaths (10%). Real sample, no nemesis.
    const corpus = [...clones(win1779, 18), ...clones(loss1785, 2)];
    const res = nemesisLeak(corpus);
    expect(res.applicable).toBe(true);
    expect(res.healthy).toBe(true);
    expect(res.drill).toBeUndefined();
    expect(res.expectedWinsLost).toBe(0);
    expect(res.receiptLines[1]).toBe('deadliest of them: The Insatiable, 2 deaths / 20 meetings (10%)');
  });

  it('lets the deadlier fight win when the toll is comparable', () => {
    // 30 runs. Phrog elite: 30 meetings (both fixtures fight it), 10 deaths →
    // 33%. The Insatiable: 20 meetings, 20 deaths → 100%. Rate decides.
    const corpus = [...clones(loss1774, 10), ...clones(loss1785, 20)];
    expect(nemesisId(corpus)).toBe(INSATIABLE);
  });

  it('does not let a higher rate on fewer deaths outrank a heavier toll', () => {
    // Phrog elite: 4 deaths / 10 meetings = 40%, score 1.6.
    // The Insatiable: 6 deaths / 20 meetings = 30%, score 1.8. Toll wins.
    const corpus = [
      ...clones(loss1785, 6), // 6 Insatiable deaths, 6 Phrog meetings survived
      ...clones(win1779, 14), // 14 more Insatiable meetings, all survived
      ...clones(loss1774, 4), // 4 Phrog meetings, all deaths
    ];
    expect(nemesisId(corpus)).toBe(INSATIABLE);
    // both candidates really did clear the floors — this is a contest, not a walkover
    const phrog = corpus.flatMap((r) => meetings(r, 'ENCOUNTER.PHROG_PARASITE_ELITE'));
    expect(phrog).toHaveLength(10);
    expect(phrog.filter((m) => m.died)).toHaveLength(4);
  });
});

// ---------- the fired card ----------

describe('the nemesis card', () => {
  const leak = nemesisLeak(corpusMain);

  it('names the encounter costing the most runs, with matching numerator and denominator', () => {
    expect(leak.applicable).toBe(true);
    expect(leak.id).toBe('nemesis');
    expect(leak.tier).toBe('leak');
    expect(leak.title).toBe('The Insatiable is ending your runs');
    expect(leak.receiptLines[0]).toBe('The Insatiable: 14 deaths / 21 meetings (67%)');
    expect(leak.receiptLines[1]).toBe('every other encounter in the same runs: 2 deaths / 475 meetings (0.4%)');
    expect(leak.ratioBadge).toBe('47% of your runs'); // 14 deaths across 30 completed runs
  });

  it('proves the receipt against an independent count of the same population', () => {
    // Recounted here from the corpus without touching the detector's code.
    let meetingCount = 0;
    let deathCount = 0;
    for (const run of corpusMain) {
      for (const node of run.nodes) {
        for (const room of node.rooms) {
          if (room.modelId !== INSATIABLE || room.monsterIds.length === 0) continue;
          meetingCount += 1;
          if (node === run.nodes[run.nodes.length - 1] && !run.win && run.killedByEncounter === INSATIABLE) {
            deathCount += 1;
          }
        }
      }
    }
    expect(meetingCount).toBe(21); // 7 Silent wins + 14 Defect losses
    expect(deathCount).toBe(14);
    expect(leak.receiptLines[0]).toBe(`The Insatiable: ${deathCount} deaths / ${meetingCount} meetings (67%)`);
    // and the baseline covers the complement exactly: every other combat room.
    const allRooms = corpusMain.reduce((sum, r) => sum + meetings(r).length, 0);
    expect(leak.receiptLines[1]).toContain(`/ ${allRooms - meetingCount} meetings`);
  });

  it('separates the meetings you survived from the ones that killed you', () => {
    expect(leak.receiptLines).toContain(
      'entry HP at The Insatiable: 74% median across the 7 you survived vs 57% across the 14 that killed you',
    );
    expect(leak.receiptLines).toContain(
      'turns taken at The Insatiable: 2.0 avg across the 7 you survived vs 7.0 across the 14 that killed you',
    );
    expect(leak.receiptLines).toContain(
      'upgrades banked entering The Insatiable: 6.0 avg across the 7 you survived vs 2.0 across the 14 that killed you',
    );
    // potions thrown are 2 on both sides — no gap, so it is not printed.
    expect(leak.receiptLines.some((l) => l.startsWith('potions thrown'))).toBe(false);
    expect(leak.dumbbell).toEqual({
      label: 'Entry HP',
      winValue: 74.3,
      lossValue: 56.5,
      format: 'pct',
      sampleLabel: '21 meetings with The Insatiable',
      // meeting cohorts, NOT run win/loss cohorts — the chart must say so
      winLabel: 'you survived',
      lossLabel: 'it killed you',
    });
  });

  it('quotes the fight’s own numbers at the ascension it is met at', () => {
    expect(leak.body).toContain('At A6 it is a boss with 321 HP');
    expect(leak.body).toContain('Lunging Bite — Deals 28 (31 at A9+) damage');
    expect(leak.receiptLines[leak.receiptLines.length - 1]).toBe(
      'wiki fight facts for The Insatiable: 321 HP at A6 · hardest intent Lunging Bite — Deals 28 (31 at A9+) damage · 1 of 2 attack intents hit more than once',
    );
  });

  it('does not call 1 of 2 attack intents "most"', () => {
    // The Insatiable publishes two damage lines and one of them is multi-hit.
    // isMultiHit's gate (a third of the lines) passes, but a majority claim
    // does not — and the intent table sits on screen for the player to count.
    const multiHit = leak.body.match(/(\d+) of its (\d+) attack intents land more than once/);
    expect(multiHit).not.toBeNull();
    expect(multiHit![1]).toBe('1');
    expect(multiHit![2]).toBe('2');
  });

  it('receipts the five most recent deaths, newest first, with the enemy tagged', () => {
    expect(leak.runReceipts).toHaveLength(5);
    for (const r of leak.runReceipts) {
      expect(r.enemyIds).toEqual([INSATIABLE]);
      expect(r.label).toMatch(/The Insatiable ended it on floor 33, entered at \d+%$/);
    }
    const order = leak.runReceipts.map((r) => Number(r.runId.split('-n')[1]));
    expect([...order].sort((a, b) => b - a)).toEqual(order);
  });

  it('names its confounders, including the one this corpus actually has', () => {
    expect(leak.confoundNote).toContain('killed-by field');
    expect(leak.confoundNote).toContain('the HP split and the character split are the same split here');
    expect(leak.confoundNote).toContain('losing takes turns');
  });

  it('ranks in the documented currency: meetings per run × the death-rate gap', () => {
    // 21 meetings / 30 runs × (14/21 − 2/475) × moderate(0.6) × 100
    const expected = (21 / 30) * (14 / 21 - 2 / 475) * 0.6 * 100;
    expect(leak.expectedWinsLost).toBeCloseTo(expected, 1);
    expect(leak.strength).toBe('moderate'); // 21 meetings — under the 30 strong needs
  });

  it('registers among the leak detectors with a distinct id', () => {
    const results = detectLeaks(corpusMain);
    const mine = results.find((r) => r.id === 'nemesis')!;
    expect(mine.tier).toBe('leak');
    expect(results.filter((r) => r.id === 'nemesis')).toHaveLength(1);
  });
});

// ---------- per character ----------

describe('per-character split', () => {
  /**
   * 21 completed runs, all meeting The Insatiable once:
   *   11 Regent deaths, 3 Defect deaths, 7 Silent survivals.
   * Only Regent clears the 10-meeting floor, so only Regent gets a rate.
   */
  const split = [
    ...clones(loss1785, 11, asCharacter('CHARACTER.REGENT')),
    ...clones(loss1785, 3),
    ...clones(win1779, 7),
  ];
  const leak = nemesisLeak(split);

  it('says which character carries the problem, as a count', () => {
    expect(leak.body).toContain('11 of the 14 are Regent runs.');
  });

  it('withholds a percentage from any character under the meeting floor', () => {
    expect(leak.receiptLines[2]).toBe(
      'The Insatiable by character: Regent 11 deaths / 11 meetings (100%); Defect 3 deaths / 3 meetings ' +
        `(rate withheld, under ${MIN_CHAR_FIGHTS}); Silent 0 deaths / 7 meetings (rate withheld, under ${MIN_CHAR_FIGHTS})`,
    );
    // the thin characters are named with raw counts and no percentage anywhere
    const thin = leak.receiptLines[2].split(';').filter((s) => s.includes('withheld'));
    expect(thin).toHaveLength(2);
    for (const piece of thin) expect(piece).not.toMatch(/\d+%/);
  });

  it('states plainly when the carrying character has never survived it', () => {
    expect(leak.receiptLines[3]).toBe('Regent has never survived it: 11 deaths in 11 meetings');
  });

  /**
   * 24 completed runs where Regent both wins and loses the fight:
   *   Regent 8 deaths + 5 survivals (13 meetings), Defect 4 deaths, Silent 7
   *   survivals. Regent clears the floor on both sides, so its own winning
   *   meetings can be contrasted with its own deaths.
   */
  const contrast = [
    ...clones(loss1785, 8, asCharacter('CHARACTER.REGENT')),
    ...clones(win1779, 5, asCharacter('CHARACTER.REGENT')),
    ...clones(loss1785, 4),
    ...clones(win1779, 7),
  ];
  const contrastLeak = nemesisLeak(contrast);

  it('contrasts the carrying character’s own winning meetings when both sides are deep enough', () => {
    expect(contrastLeak.receiptLines[2]).toContain('Regent 8 deaths / 13 meetings (62%)');
    expect(contrastLeak.receiptLines[3]).toBe(
      'Regent only: 74% entry HP median across the 5 it survived vs 57% across the 8 that killed it',
    );
  });

  it('drops the same-split confounder when the character appears on both sides', () => {
    expect(contrastLeak.confoundNote).not.toContain('the same split here');
  });

  it('reports the spread when no single character carries the deaths', () => {
    // 6 Regent deaths, 6 Defect deaths, 10 Silent survivals.
    const even = [
      ...clones(loss1785, 6, asCharacter('CHARACTER.REGENT')),
      ...clones(loss1785, 6),
      ...clones(win1779, 10),
    ];
    expect(nemesisLeak(even).body).toContain('The deaths are spread across Defect (6) and Regent (6)');
  });

  it('says there is no split to read when only one character has met it', () => {
    const solo = [...clones(loss1785, 12), ...clones(loss1774, 10)];
    expect(nemesisLeak(solo).body).toContain('Every one of those meetings is a Defect run');
  });
});

// ---------- an enemy the wiki does not document ----------

describe('undocumented encounters degrade to the player’s own record', () => {
  /** Die at the Kaiser Crab on floor 33 instead of clearing it. */
  const diedToCrab = (r: NormalizedRun) => {
    r.nodes = r.nodes.slice(0, 33);
    r.win = false;
    r.killedByEncounter = KAISER;
  };
  const corpus = [...clones(win1776, 14, diedToCrab), ...clones(win1776, 8)];
  const leak = nemesisLeak(corpus);

  it('still names the fight and counts it from the player’s runs', () => {
    expect(leak.applicable).toBe(true);
    expect(leak.title).toBe('Kaiser Crab is ending your runs');
    expect(leak.receiptLines[0]).toBe('Kaiser Crab: 14 deaths / 22 meetings (64%)');
  });

  it('says the wiki has nothing rather than guessing HP or an intent', () => {
    expect(leak.body).toContain('The wiki has no entry for Kaiser Crab, so this card is your own record');
    expect(leak.receiptLines).toContain('wiki fight facts for Kaiser Crab: none published — no HP, no intent table');
    expect(leak.body).not.toMatch(/\bHP\b.*\d/);
    expect(leak.receiptLines.some((l) => /hardest intent/.test(l))).toBe(false);
  });
});

// ---------- the drill bar is the player's own number ----------

describe('the drill bar', () => {
  it('is the median HP of the meetings this player actually survived', () => {
    expect(nemesisLeak(corpusMain).drillBar).toBe(74);
    expect(nemesisBar(74.3, 56.5)).toBe(74);
  });

  it('never asks for more than the ceiling, nor less than the house floor', () => {
    expect(nemesisBar(97, 40)).toBe(85);
    expect(nemesisBar(52, 30)).toBe(BAR_FLOOR);
  });

  it('offers no HP drill when entry HP is not what separates the meetings', () => {
    expect(nemesisBar(60, 74)).toBeUndefined();
    // A corpus where the deaths arrive HEALTHIER than the survivals.
    const inverted = [
      ...clones(loss1785, 12, healthyDeathEntry), // deaths entered at 87%
      ...clones(win1779, 10, (r) => {
        r.nodes[31].stats.hp = 20; // survivals entered at 22%
      }),
    ];
    const leak = nemesisLeak(inverted);
    expect(leak.applicable).toBe(true);
    expect(leak.drill).toBeUndefined();
    expect(leak.drillBar).toBeUndefined();
  });

  it('falls back to the house floor when there is no surviving meeting to read', () => {
    const neverWon = [...clones(loss1785, 12), ...clones(loss1774, 10)];
    const leak = nemesisLeak(neverWon);
    expect(leak.drillBar).toBe(BAR_FLOOR);
    expect(leak.body).toContain('You have survived it 0 times');
    expect(leak.drill?.body).toContain(`at ${BAR_FLOOR}% HP or better`);
  });

  it('quotes one number across the card, the receipt and the drill', () => {
    const leak = nemesisLeak(corpusMain);
    const bar = leak.drillBar!;
    expect(leak.drill?.body).toContain(`at ${bar}% HP or better`);
    expect(leak.receiptLines).toContain(
      `entry HP at The Insatiable: ${bar}% median across the 7 you survived vs 57% across the 14 that killed you`,
    );
  });
});

// ---------- the grader mirrors the detector ----------

describe('the nemesis drill grades exactly what the card accuses', () => {
  const def = DRILLS.nemesis;
  const ctx = nemesisContext(corpusMain);

  it('derives the same subject the card named', () => {
    expect(ctx.subject).toBe(INSATIABLE);
    expect(ctx.bar).toBe(74);
  });

  it('declines when there is no nemesis, and when the run never met it', () => {
    expect(def.grade(loss1785)).toEqual({ verdict: 'na', note: 'no encounter in your history is a nemesis yet' });
    expect(def.grade(loss1774, 74, INSATIABLE)).toEqual({ verdict: 'na', note: 'did not meet The Insatiable' });
    expect(def.grade(abandoned, 74, INSATIABLE).verdict).toBe('na');
  });

  it('fails a meeting under the bar and passes one at it', () => {
    expect(def.grade(loss1785, 74, INSATIABLE)).toEqual({
      verdict: 'fail',
      note: 'met The Insatiable at 57%, bar is 74%',
    });
    expect(def.grade(win1779, 74, INSATIABLE)).toEqual({
      verdict: 'pass',
      note: 'met The Insatiable at 74%, bar is 74%',
    });
  });

  it('holds the player to the bar the card quoted, not a constant', () => {
    expect(def.grade(loss1785, 50, INSATIABLE).verdict).toBe('pass');
    expect(def.grade(win1779, 80, INSATIABLE).verdict).toBe('fail');
  });

  it('never fails a run the card would not have flagged', () => {
    // Exhaustive over the corpus: a fail must correspond to a real meeting
    // below the bar, and every run with no such meeting must not be a fail.
    for (const run of corpusMain) {
      const met = meetings(run, ctx.subject!).filter((m) => m.entryPct !== undefined);
      const flagged = met.filter((m) => m.entryPct! * 100 < ctx.bar!);
      const { verdict } = def.grade(run, ctx.bar, ctx.subject);
      if (met.length === 0) expect(verdict).toBe('na');
      else expect(verdict).toBe(flagged.length > 0 ? 'fail' : 'pass');
    }
  });
});

// ---------- verification pass: claims a player could disprove ----------

describe('the drill never calls the bar something it is not', () => {
  /** Survived meetings at `s`, killing meetings at `d`, as HP fractions. */
  const split = (s: number, d: number) => [
    ...clones(win1779, 10, (r) => {
      r.nodes[31].stats.hp = Math.round(s * r.nodes[31].stats.maxHp);
    }),
    ...clones(loss1785, 12, (r) => {
      r.nodes[31].stats.hp = Math.round(d * r.nodes[31].stats.maxHp);
    }),
  ];

  it('says "the median" only when the clamp left the bar on the median', () => {
    const leak = nemesisLeak(corpusMain);
    expect(leak.drillBar).toBe(74);
    expect(leak.drill?.body).toContain('74% HP or better — the median you carry into the meetings you survive');
  });

  it('names the house floor as the floor when it lifts the bar off the median', () => {
    const leak = nemesisLeak(split(0.52, 0.3));
    expect(leak.drillBar).toBe(BAR_FLOOR);
    // The receipt the player can check says 51%; the drill must not call 60% that.
    expect(leak.receiptLines).toContain(
      'entry HP at The Insatiable: 51% median across the 10 you survived vs 30% across the 12 that killed you',
    );
    expect(leak.drill?.body).toContain('the house floor, above the 51% median');
    expect(leak.drill?.body).not.toContain('— the median you carry');
  });

  it('says it is capped when the ceiling pulls the bar below the median', () => {
    const leak = nemesisLeak(split(0.97, 0.4));
    expect(leak.drillBar).toBe(85);
    expect(leak.drill?.body).toContain('capped there; the ones you survive run to a 97% median');
    expect(leak.drill?.body).not.toContain('— the median you carry');
  });
});

describe('the multi-hit line counts instead of claiming a majority', () => {
  it('quotes a count the player can check against the intent table', () => {
    const body = nemesisLeak(corpusMain).body;
    // isMultiHit's gate is a third of the damage lines, so "most" would be a
    // claim the gate does not entitle the card to make.
    expect(body).not.toContain('Most of its attack intents');
    expect(body).toMatch(/\d+ of its \d+ attack intents land more than once/);
    const [, multi, total] = body.match(/(\d+) of its (\d+) attack intents/)!;
    expect(Number(multi)).toBeLessThanOrEqual(Number(total));
    expect(Number(multi)).toBeGreaterThan(0);
  });
});
