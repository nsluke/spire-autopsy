/**
 * autopsy.test.ts — buildAutopsy against the known fixtures.
 * Key facts for 1785858459 (Defect A6 loss to The Insatiable):
 *   33 nodes / 2 acts; biggest non-death damage spike = floor 12 (47 HP);
 *   HEAL rests on floors 16, 24, 32; last floor above half HP = 32 (57%);
 *   death fight entered at 52/92 ≈ 57%, death on floor 33.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildAutopsy, type AutopsyBeat } from '../src/lib/autopsy';
import { detectLeaks } from '../src/lib/leaks';
import { normalizeRun } from '../src/lib/normalize';
import type { NormalizedRun } from '../src/lib/types';

function loadFixture(name: string): NormalizedRun {
  const path = fileURLToPath(new URL(`./fixtures/${name}.run`, import.meta.url));
  return normalizeRun(JSON.parse(readFileSync(path, 'utf8')), `${name}.run`);
}

const win1779 = loadFixture('1779248265');
const win1776 = loadFixture('1776190046'); // Defect A0 win
const loss1785 = loadFixture('1785858459');
const loss1774 = loadFixture('1774194024'); // Ironclad A1 loss, died rich
const abandoned = loadFixture('1778528032');

let cloneCounter = 0;
function clones(run: NormalizedRun, n: number): NormalizedRun[] {
  return Array.from({ length: n }, () => {
    cloneCounter += 1;
    const copy = JSON.parse(JSON.stringify(run)) as NormalizedRun;
    copy.id = `${run.id}-c${cloneCounter}`;
    copy.startTime = run.startTime + cloneCounter * 3600;
    return copy;
  });
}

// 20 completed runs — enough for boss-entry-hp and removal-discipline to apply.
const corpus = [...clones(win1779, 10), ...clones(loss1785, 10)];
const leaks = detectLeaks(corpus);

describe('autopsy of 1785858459 (loss)', () => {
  const report = buildAutopsy(loss1785, [...corpus, loss1785], leaks);

  it('carries the run header', () => {
    expect(report.runId).toBe('1785858459');
    expect(report.character).toBe('CHARACTER.DEFECT');
    expect(report.ascension).toBe(6);
    expect(report.win).toBe(false);
    expect(report.killedBy).toBe('The Insatiable');
    expect(report.floors).toBe(33);
    expect(report.actNames).toEqual(['Overgrowth', 'Hive', 'Glory']);
    expect(report.durationMinutes).toBeGreaterThanOrEqual(0);
  });

  it('builds a full hp trajectory with room labels and rest choices', () => {
    expect(report.trajectory).toHaveLength(33);
    const last = report.trajectory[32];
    expect(last.hpPct).toBe(0);
    expect(last.hp).toBe(0);
    expect(last.maxHp).toBe(92);
    expect(last.roomLabel).toBe('The Insatiable');
    expect(report.trajectory[11].damageTaken).toBe(47);
    expect(report.trajectory[15].restChoice).toBe('HEAL'); // floor 16
  });

  it('finds the spike on floor 12, excluding the death node', () => {
    const spike = report.moments.find((m) => m.kind === 'spike');
    expect(spike).toBeDefined();
    expect(spike!.floor).toBe(12);
    expect(spike!.label).toContain('47');
  });

  it('finds the point of no return on floor 32', () => {
    const pnr = report.moments.find((m) => m.kind === 'point-of-no-return');
    expect(pnr).toBeDefined();
    expect(pnr!.floor).toBe(32);
  });

  it('records the low boss entry and the death', () => {
    const entry = report.moments.find((m) => m.kind === 'boss-entry');
    expect(entry).toBeDefined();
    expect(entry!.floor).toBe(33);
    expect(entry!.label).toContain('57%');

    const death = report.moments.find((m) => m.kind === 'death');
    expect(death).toBeDefined();
    expect(death!.floor).toBe(33);
    expect(death!.label).toContain('The Insatiable');
  });

  it('marks every HEAL rest and sorts moments by floor', () => {
    const heals = report.moments.filter((m) => m.kind === 'heal').map((m) => m.floor);
    expect(heals).toEqual([16, 24, 32]);
    const floors = report.moments.map((m) => m.floor);
    expect([...floors].sort((a, b) => a - b)).toEqual(floors);
  });

  it('writes floor-anchored beats from computed numbers', () => {
    expect(report.narrative.length).toBeGreaterThanOrEqual(3);
    for (const b of report.narrative) expect(b.text.length).toBeGreaterThan(0);
    // a loss at a level this character never beat opens as a wall attempt
    const wall = report.narrative[0];
    expect(wall.text).toContain('A6 wall attempt #1');
    expect(wall.text).toContain('Defect');
    expect(wall.floors).toEqual([]);
    // the wound beat anchors on floor 12 and cites the 47 damage
    const wound = report.narrative[1];
    expect(wound.text).toContain('Floor 12');
    expect(wound.text).toContain('47');
    expect(wound.floors).toContain(12);
    expect(wound.enemyIds?.[0]).toMatch(/BYGONE_EFFIGY/);
    // the kill beat anchors on the death floor
    const kill = report.narrative.find((b) => b.floors.includes(33));
    expect(kill).toBeDefined();
    // every anchored floor exists in the trajectory (the chart can ring it)
    const floors = new Set(report.trajectory.map((t) => t.floor));
    for (const b of report.narrative) for (const f of b.floors) expect(floors.has(f)).toBe(true);
  });

  it('links the leaks this run exhibits — and only those', () => {
    // entered the killer boss fight at 57% (<60%) → boss-entry-hp
    expect(report.linkedLeakIds).toContain('boss-entry-hp');
    // this run removed 9 cards, so removal-discipline must NOT be linked
    expect(report.linkedLeakIds).not.toContain('removal-discipline');
  });
});

describe('autopsy of 1779248265 (win)', () => {
  const report = buildAutopsy(win1779, [win1779, loss1785], detectLeaks([win1779, loss1785]));

  it('celebrates the clutch instead of hunting for a death', () => {
    expect(report.win).toBe(true);
    expect(report.killedBy).toBeUndefined();
    const clutch = report.moments.find((m) => m.kind === 'clutch');
    expect(clutch).toBeDefined();
    expect(clutch!.floor).toBe(8); // lowest survived: 24/70 ≈ 34%
    expect(clutch!.label).toContain('34%');
    expect(report.moments.some((m) => m.kind === 'death')).toBe(false);
    expect(report.moments.some((m) => m.kind === 'point-of-no-return')).toBe(false);
    expect(report.narrative.length).toBeGreaterThanOrEqual(1);
  });

  it('links no leaks when none are applicable on the corpus', () => {
    expect(report.linkedLeakIds).toEqual([]);
  });

  it('celebrates a breakthrough: the first win at this level with this character', () => {
    const breakthrough = report.narrative.find((b) => b.text.includes('Breakthrough'));
    expect(breakthrough).toBeDefined();
    expect(breakthrough!.text).toContain('first win at A6');
    expect(breakthrough!.text).toContain('Silent');
  });

  it('does not repeat the breakthrough once the level has already been beaten', () => {
    const earlier = clones(win1779, 1)[0];
    earlier.startTime = win1779.startTime - 3600; // an older win at the same level
    const rerun = buildAutopsy(win1779, [earlier, win1779, loss1785], []);
    expect(rerun.narrative.some((b) => b.text.includes('Breakthrough'))).toBe(false);
  });
});

describe('wall framing never points backward', () => {
  it('an outgrown level is not presented as an open wall', () => {
    // Old A6 loss, but the character has since attempted A8: the A6 autopsy
    // must not claim "the level is still standing" — the wall has moved up.
    const higher = clones(loss1785, 1)[0];
    higher.ascension = 8;
    const report = buildAutopsy(loss1785, [loss1785, higher], []);
    expect(report.narrative.some((b) => b.text.includes('wall attempt'))).toBe(false);
    // while a loss at the character's highest level IS a wall attempt
    const atWall = buildAutopsy(higher, [loss1785, higher], []);
    expect(atWall.narrative.some((b) => b.text.includes('A8 wall attempt'))).toBe(true);
  });

  it('a win below prior play is not celebrated as a breakthrough', () => {
    const higherLoss = clones(loss1785, 1)[0]; // Defect A6 loss, earlier
    higherLoss.startTime = win1776.startTime - 3600;
    const report = buildAutopsy(win1776, [higherLoss, win1776], []); // Defect A0 win after A6 play
    expect(report.narrative.some((b) => b.text.includes('Breakthrough'))).toBe(false);
  });
});

describe('runs with no floor history (schema-legal map_point_history: [])', () => {
  function withoutNodes(base: NormalizedRun, patch: Partial<NormalizedRun>): NormalizedRun {
    const copy = JSON.parse(JSON.stringify(base)) as NormalizedRun;
    copy.nodes = [];
    Object.assign(copy, patch);
    return copy;
  }

  it('a zero-floor win narrates without throwing', () => {
    const run = withoutNodes(win1779, { win: true, abandoned: false });
    const report = buildAutopsy(run, [run], []);
    expect(report.trajectory).toHaveLength(0);
    expect(report.narrative.length).toBeGreaterThan(0);
    expect(report.narrative[0].text).toContain('win');
  });

  it('a zero-floor loss is not mislabeled as abandoned', () => {
    const run = withoutNodes(loss1785, { win: false, abandoned: false });
    const report = buildAutopsy(run, [run], []);
    expect(report.narrative.length).toBeGreaterThan(0);
    expect(report.narrative[0].text).not.toContain('abandoned');
  });
});

describe('autopsy of an abandoned run', () => {
  const report = buildAutopsy(abandoned, [abandoned], []);

  it('stays brief and kind — no death moment, no post-mortem', () => {
    expect(report.moments.some((m) => m.kind === 'death')).toBe(false);
    expect(report.narrative).toHaveLength(1);
    expect(report.narrative[0].text).toContain('Abandoned');
  });
});

// ---------- the kill: fight length and entry HP ----------

describe('the kill beat', () => {
  it('reports the killer fight length — 52 damage over 7 turns', () => {
    const report = buildAutopsy(loss1785, [loss1785], []);
    const kill = report.narrative.find((b) => b.text.includes('Walked into'));
    expect(kill).toBeDefined();
    expect(kill!.text).toContain('at 57%');
    expect(kill!.text).toContain('52 damage over 7 turns');
  });

  it('keeps the entry number when a hallway fight kills the run', () => {
    const run = clones(loss1785, 1)[0];
    for (const room of run.nodes[run.nodes.length - 1].rooms) room.roomType = 'monster';
    const report = buildAutopsy(run, [run], []);
    expect(report.moments.some((m) => m.kind === 'boss-entry')).toBe(false);
    // The descent beat also carries the death floor — match the kill by its verb.
    const kill = report.narrative.find((b) => b.floors.includes(33) && b.text.includes('ended it'));
    expect(kill).toBeDefined();
    expect(kill!.text).toContain('you walked in at 57%');
    expect(kill!.text).toContain('over 7 turns');
  });
});

// ---------- the death kit ----------

describe('the death kit', () => {
  it('reads out unthrown potions with hover ids', () => {
    const run = clones(loss1785, 1)[0];
    run.player.potions = ['POTION.FIRE_POTION', 'POTION.DUPLICATION_POTION'];
    run.nodes[run.nodes.length - 1].stats.potionsUsed = [];
    const report = buildAutopsy(run, [run], []);
    const kit = report.narrative.find((b) => b.text.startsWith('Died holding')) as AutopsyBeat;
    expect(kit).toBeDefined();
    expect(kit.text).toContain('Fire Potion and Duplication Potion — neither thrown');
    expect(kit.potionIds).toEqual(['POTION.FIRE_POTION', 'POTION.DUPLICATION_POTION']);
    // 53 gold at death is not worth a clause
    expect(kit.text).not.toContain('gold');
  });

  it('drops the unthrown clause when potions were actually used', () => {
    const run = clones(loss1785, 1)[0];
    run.player.potions = ['POTION.FIRE_POTION'];
    const report = buildAutopsy(run, [run], []); // fixture death used two potions
    const kit = report.narrative.find((b) => b.text.startsWith('Died holding'));
    expect(kit).toBeDefined();
    expect(kit!.text).not.toContain('thrown');
  });

  it('names the unspent gold on a rich death (Ironclad died carrying 463)', () => {
    const report = buildAutopsy(loss1774, [loss1774], []);
    const kit = report.narrative.find((b) => b.text.includes('gold unspent'));
    expect(kit).toBeDefined();
    expect(kit!.text).toContain('463 gold unspent');
  });

  it('says nothing when the kit is empty (no potions, thin purse)', () => {
    const report = buildAutopsy(loss1785, [loss1785], []);
    expect(report.narrative.some((b) => b.text.startsWith('Died '))).toBe(false);
  });
});

// ---------- wall siege progress ----------

describe('wall siege progress', () => {
  function priorAt(depth: number, hoursAgo: number): NormalizedRun {
    const r = clones(loss1785, 1)[0];
    r.startTime = loss1785.startTime - hoursAgo * 3600;
    r.nodes = r.nodes.slice(0, depth);
    return r;
  }

  it('celebrates the deepest push and lists where earlier attempts fell', () => {
    const p1 = priorAt(12, 2);
    const p2 = priorAt(18, 1);
    const report = buildAutopsy(loss1785, [p1, p2, loss1785], []);
    expect(report.narrative[0].text).toContain('wall attempt #3');
    const depth = report.narrative.find((b) => b.text.includes('deepest push'));
    expect(depth).toBeDefined();
    expect(depth!.text).toContain('#1–2 fell on floors 12 and 18');
  });

  it('measures a shallower attempt against the best prior push', () => {
    const p1 = priorAt(33, 2); // full-depth prior
    const current = priorAt(20, 0);
    current.startTime = loss1785.startTime; // after p1
    const report = buildAutopsy(current, [p1, current], []);
    const depth = report.narrative.find((b) => b.text.includes('stopped on floor 20'));
    expect(depth).toBeDefined();
    expect(depth!.text).toContain("shy of attempt #1's floor 33");
  });

  it('counts the repeat killer by name', () => {
    const p1 = priorAt(12, 2);
    const p2 = priorAt(18, 1);
    const report = buildAutopsy(loss1785, [p1, p2, loss1785], []);
    const repeat = report.narrative.find((b) => b.text.includes('ended a wall attempt'));
    expect(repeat).toBeDefined();
    expect(repeat!.text).toBe('Third time The Insatiable has ended a wall attempt.');
    expect(repeat!.enemyIds).toEqual(['ENCOUNTER.THE_INSATIABLE_BOSS']);
  });

  it('stays quiet on the first attempt', () => {
    const report = buildAutopsy(loss1785, [loss1785], []);
    expect(report.narrative.some((b) => b.text.includes('deepest push'))).toBe(false);
    expect(report.narrative.some((b) => b.text.includes('ended a wall attempt'))).toBe(false);
  });
});

// ---------- win contrast ----------

describe('win contrast', () => {
  function survivedInsatiable(): NormalizedRun {
    const r = clones(loss1785, 1)[0];
    r.win = true;
    r.startTime = loss1785.startTime - 30 * 24 * 3600;
    const last = r.nodes[r.nodes.length - 1];
    last.stats.hp = 40; // walked out alive
    return r;
  }

  it('contrasts entry HP when the player has beaten this boss before', () => {
    const prior = survivedInsatiable();
    prior.nodes[31].stats.hp = 80; // entered the boss at 80/92 ≈ 87%
    const report = buildAutopsy(loss1785, [prior, loss1785], []);
    const contrast = report.narrative.find((b) => b.text.includes("You've beaten")) as AutopsyBeat;
    expect(contrast).toBeDefined();
    expect(contrast.text).toContain("You've beaten The Insatiable before");
    expect(contrast.text).toContain('entered at 87% and walked out');
    expect(contrast.text).toContain('Today: 57%');
    expect(contrast.runRef).toBe(prior.id);
    expect(contrast.floors).toEqual([]);
  });

  it('falls back to deck size when the entries match', () => {
    const prior = survivedInsatiable(); // same 57% entry
    prior.player.deck = prior.player.deck.slice(0, 20);
    const report = buildAutopsy(loss1785, [prior, loss1785], []);
    const contrast = report.narrative.find((b) => b.text.includes("You've beaten"));
    expect(contrast).toBeDefined();
    expect(contrast!.text).toContain("carrying 20 cards to today's 28");
  });

  it('never cites a fight the other run also died in', () => {
    const prior = clones(loss1785, 1)[0]; // died to the same boss
    prior.startTime = loss1785.startTime - 3600;
    const report = buildAutopsy(loss1785, [prior, loss1785], []);
    expect(report.narrative.some((b) => b.text.includes("You've beaten"))).toBe(false);
  });
});

// ---------- linked leaks: gold-at-death ----------

describe('gold-at-death linking', () => {
  const richDeaths = clones(loss1785, 16).map((r) => {
    r.nodes[r.nodes.length - 1].stats.gold = 300;
    return r;
  });
  const corpus = [...richDeaths, loss1785];
  const leaks = detectLeaks(corpus);

  it('links the pattern on a run that died rich', () => {
    const report = buildAutopsy(richDeaths[0], corpus, leaks);
    expect(report.linkedLeakIds).toContain('gold-at-death');
  });

  it('does not link it on a run that died poor (53 gold)', () => {
    const report = buildAutopsy(loss1785, corpus, leaks);
    expect(report.linkedLeakIds).not.toContain('gold-at-death');
  });
});

// ---------- point of no return: slide vs plateau ----------

describe('point of no return', () => {
  it('keeps the descent framing when the death is close (floor 32 → 33)', () => {
    const report = buildAutopsy(loss1785, [loss1785], []);
    const pnr = report.moments.find((m) => m.kind === 'point-of-no-return');
    expect(pnr!.label).toBe('Point of no return');
    expect(pnr!.detail).toContain('never climbed above half again');
    expect(report.narrative.some((b) => b.text.includes('never crossed half again'))).toBe(true);
  });

  it('reads a long sub-half plateau as an observation, not a death spiral', () => {
    const run = clones(loss1785, 1)[0];
    for (const node of run.nodes.slice(5, 32)) node.stats.hp = 40; // ≤43% of maxHp from floor 6 on
    const report = buildAutopsy(run, [run], []);
    const pnr = report.moments.find((m) => m.kind === 'point-of-no-return');
    expect(pnr).toBeDefined();
    expect(pnr!.label).toBe('Below half from here');
    expect(pnr!.detail).toBe(`From floor ${pnr!.floor} on, you fought below half HP.`);
    expect(report.narrative.some((b) => b.text.includes('you fought below half HP'))).toBe(true);
    expect(report.narrative.some((b) => b.text.includes('never crossed half'))).toBe(false);
  });
});

// ---------- draft thinness on the death act ----------

describe('draft thinness', () => {
  it('calls out an extreme skip rate in the death act', () => {
    const run = clones(loss1785, 1)[0];
    const deathAct = run.nodes[run.nodes.length - 1].act;
    for (const node of run.nodes.filter((n) => n.act === deathAct)) {
      for (const c of node.stats.cardChoices) c.wasPicked = false;
    }
    const report = buildAutopsy(run, [run], []);
    const thin = report.narrative.find((b) => b.text.includes('card rewards'));
    expect(thin).toBeDefined();
    expect(thin!.text).toBe(`Passed on 7 of 7 card rewards in act ${deathAct}.`);
  });

  it('says nothing at the fixture skip rate (2 of 7)', () => {
    const report = buildAutopsy(loss1785, [loss1785], []);
    expect(report.narrative.some((b) => b.text.includes('card rewards'))).toBe(false);
  });
});

// ---------- copy details ----------

describe('moment copy', () => {
  it('the spike names the killing blow on losses and the run on wins', () => {
    const lossReport = buildAutopsy(loss1785, [loss1785], []);
    expect(lossReport.moments.find((m) => m.kind === 'spike')!.detail).toContain(
      'outside the killing blow',
    );
    const winReport = buildAutopsy(win1779, [win1779], []);
    expect(winReport.moments.find((m) => m.kind === 'spike')!.detail).toContain(
      'the biggest single hit of the run',
    );
  });

  it('the clutch beat is built from node stats, not label surgery', () => {
    const report = buildAutopsy(win1779, [win1779], []);
    const squeeze = report.narrative.find((b) => b.text.includes('Tightest squeeze'));
    expect(squeeze).toBeDefined();
    expect(squeeze!.text).toContain('24/70 HP (34%)');
  });
});
