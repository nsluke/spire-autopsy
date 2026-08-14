/**
 * Drills — the actionable half of a leak.
 *
 * A drill is a machine-verifiable in-game behavior ("reach every act boss
 * above 60% HP") accepted for a fixed number of runs. On every re-sync the
 * runs recorded after acceptance are auto-graded by the leak's compliance
 * predicate — no self-reporting. One drill is active at a time: a coach that
 * assigns five drills assigns none.
 *
 * Grading semantics:
 *  - only completed (non-abandoned) runs started after acceptance count;
 *  - 'na' runs (the behavior never came up — e.g. no boss fight reached)
 *    don't consume drill slots;
 *  - the drill completes when pass+fail reaches targetRuns.
 */
import { completedRuns, entryGold, entryHpPct, hasRoom } from './normalize';
import { displayName, shortDate, characterName } from './idFormat';
import { ATTACK_TARGET, draftProfile } from './leaks/damageDrafting';
import { ACT1_ADD_TARGET, deckAdditions } from './leaks/deckBloat';
import { TURN_TARGET, hallwayFights, medianHallwayTurns } from './leaks/fightPacing';
import { meetings, nemesisContext } from './leaks/nemesis';
import { HELD_BAR, beltAtLastFight, hardFights } from './leaks/potions';
import { REAL_SPEND, richShopGold } from './leaks/removals';
import { bossEntries, upgradeTarget, UPGRADES_PER_ACT } from './leaks/upgradeTempo';
import type { NormalizedRun } from './types';

export type DrillVerdict = 'pass' | 'fail' | 'na';

/**
 * Corpus-derived context for a detector whose predicate is about one specific
 * thing in the player's history rather than a constant — the nemesis card is
 * about ONE encounter, and a single run cannot name it. LeakResult carries only
 * a numeric drillBar, so the subject is re-derived here from the same corpus
 * the detector ran on. The frozen bar still wins over the re-derived one.
 */
export interface DrillContext {
  subject?: string;
  bar?: number;
}

export interface DrillDef {
  leakId: string;
  title: string;
  assignment: string;
  targetRuns: number;
  /** See DrillContext — only detectors with a per-corpus subject define this. */
  context?(runs: NormalizedRun[]): DrillContext;
  /**
   * `bar` is the leak's per-player threshold (LeakResult.drillBar), carried
   * from the card the player accepted. Graders that have one must use it, so
   * the number they are held to is always the number they were quoted.
   * `subject` comes from context() and is undefined when the corpus no longer
   * names one — in which case the grader must decline, never guess.
   */
  grade(run: NormalizedRun, bar?: number, subject?: string): { verdict: DrillVerdict; note?: string };
}

/** Persisted shape (IndexedDB meta key 'activeDrill'). */
export interface ActiveDrill {
  leakId: string;
  acceptedAt: number; // unix ms
  targetRuns: number;
  /** the card's drillBar at acceptance; older drills predate it */
  bar?: number;
  /** the card's drillSubject at acceptance; older drills re-derive it */
  subject?: string;
}

export interface GradedRun {
  runId: string;
  startTime: number;
  label: string; // "Aug 12 · Defect A7"
  verdict: DrillVerdict;
  note?: string;
}

export interface DrillProgress {
  drill: ActiveDrill;
  def: DrillDef;
  graded: GradedRun[]; // chronological, na included
  passes: number;
  fails: number;
  complete: boolean;
}

const LOW = 0.6;

/**
 * Every grader below mirrors its detector's predicate EXACTLY, including what
 * counts as evidence at all. A drill that fails a run the leak card would not
 * have flagged teaches the wrong habit, so where the detector declines to
 * accuse (a shop the removal may not have been affordable at, a belt with
 * nothing in it), the grader returns 'na' and the run consumes no drill slot.
 */

export const DRILLS: Record<string, DrillDef> = {
  'boss-entry-hp': {
    leakId: 'boss-entry-hp',
    title: 'Arrive at 60%+',
    assignment: 'Reach every act boss above 60% HP — rest site, potion, or the quieter path.',
    targetRuns: 5,
    grade(run) {
      let bossFights = 0;
      let worst: { name: string; pct: number } | undefined;
      run.nodes.forEach((node, i) => {
        const boss = node.rooms.find((r) => r.roomType === 'boss');
        if (!boss) return;
        const entry = entryHpPct(run, i);
        if (entry === undefined) return;
        bossFights++;
        if (entry < LOW && (!worst || entry < worst.pct)) {
          worst = { name: displayName(boss.modelId ?? ''), pct: entry };
        }
      });
      if (bossFights === 0) return { verdict: 'na', note: 'no boss reached' };
      return worst
        ? { verdict: 'fail', note: `entered ${worst.name || 'a boss'} at ${Math.round(worst.pct * 100)}%` }
        : { verdict: 'pass', note: `all ${bossFights} boss ${bossFights === 1 ? 'entry' : 'entries'} healthy` };
    },
  },
  'damage-drafting': {
    leakId: 'damage-drafting',
    title: 'Damage first',
    assignment: `Add at least ${ATTACK_TARGET} attack cards before your first elite fight — rewards, shops, and events all count.`,
    targetRuns: 5,
    grade(run) {
      const profile = draftProfile(run);
      if (!profile) return { verdict: 'na', note: 'no act-1 elite fought' };
      // "added" is load-bearing: the count excludes starter Strikes, and a note
      // reading "0 attacks" is a receipt the player can disprove from memory.
      return profile.attacksBeforeElite >= ATTACK_TARGET
        ? { verdict: 'pass', note: `${profile.attacksBeforeElite} attacks added before the first elite` }
        : { verdict: 'fail', note: `only ${profile.attacksBeforeElite} attack${profile.attacksBeforeElite === 1 ? '' : 's'} added before the floor-${profile.firstEliteFloor} elite, wanted ${ATTACK_TARGET}` };
    },
  },
  'removal-discipline': {
    leakId: 'removal-discipline',
    title: 'Buy the removal',
    assignment: `Any shop where you spend ${REAL_SPEND}+ gold, the removal comes first.`,
    targetRuns: 5,
    grade(run) {
      // Mirrors removals.ts: the act's removal money in hand, and real gold
      // spent on other things while removing nothing. A visit that spent
      // almost nothing is no evidence — the removal may not have been on offer
      // or affordable — so it never counts either way.
      let removed = 0;
      let spentPast: number | undefined;
      for (const node of run.nodes) {
        if (!hasRoom(node, 'shop')) continue;
        if (entryGold(node) < richShopGold(node.act)) continue;
        if (node.stats.cardsRemoved.length > 0) {
          removed += 1;
        } else if (node.stats.goldSpent >= REAL_SPEND && spentPast === undefined) {
          spentPast = node.stats.goldSpent;
        }
      }
      if (spentPast !== undefined) {
        return { verdict: 'fail', note: `spent ${spentPast} gold at a shop, none of it on the removal` };
      }
      if (removed === 0) return { verdict: 'na', note: 'no shop where the removal was clearly affordable' };
      return { verdict: 'pass', note: `removed a card at all ${removed} ${removed === 1 ? 'shop' : 'shops'} you spent at` };
    },
  },
  'potion-hoarding': {
    leakId: 'potion-hoarding',
    title: 'Throw them at the boss',
    assignment: `Every elite and boss gets a potion. Reaching the last fight of a run holding ${HELD_BAR}+ potions unthrown is a miss.`,
    targetRuns: 5,
    grade(run) {
      // The belt is only exactly known at the run's LAST node, so that is the
      // only fight this grades — see potions.ts.
      const last = run.nodes[run.nodes.length - 1];
      if (!last || !(hasRoom(last, 'elite') || hasRoom(last, 'boss'))) {
        return { verdict: 'na', note: 'the run did not end on an elite or boss fight' };
      }
      const thrown = last.stats.potionsUsed.length;
      if (thrown > 0) {
        return { verdict: 'pass', note: `threw ${thrown} ${thrown === 1 ? 'potion' : 'potions'} in the last fight` };
      }
      const belt = beltAtLastFight(run);
      if (belt < HELD_BAR) return { verdict: 'na', note: `held ${belt} potions entering the last fight` };
      // A won run is never a miss. The habit costs you the fights you lose;
      // charging a fail against a victory would be the drill arguing with the
      // scoreboard.
      if (run.win) return { verdict: 'pass', note: `won it holding ${belt} — the belt cost you nothing here` };
      return { verdict: 'fail', note: `entered the last fight holding ${belt} potions, threw none` };
    },
  },
  'deck-bloat': {
    leakId: 'deck-bloat',
    title: 'Skip the filler',
    assignment: `At most ${ACT1_ADD_TARGET} cards added in act 1. If a reward does not beat a card already in the deck, take the skip.`,
    targetRuns: 5,
    grade(run, bar = ACT1_ADD_TARGET) {
      if (run.actsEntered < 2) return { verdict: 'na', note: 'the run ended inside act 1' };
      const added = deckAdditions(run, 1);
      const cards = `${added} ${added === 1 ? 'card' : 'cards'} added in act 1`;
      return added <= bar ? { verdict: 'pass', note: cards } : { verdict: 'fail', note: `${cards}, bar is ${bar}` };
    },
  },
  'upgrade-tempo': {
    leakId: 'upgrade-tempo',
    title: 'Smith it',
    assignment: `Reach each act boss with ${UPGRADES_PER_ACT} upgrades per act banked. Above half HP, the campfire is a forge.`,
    targetRuns: 5,
    grade(run) {
      const entries = bossEntries(run);
      if (entries.length === 0) return { verdict: 'na', note: 'no boss reached' };
      const worst = entries.find((e) => e.short);
      return worst
        ? {
            verdict: 'fail',
            note: `met the act-${worst.act} boss with ${worst.banked} ${worst.banked === 1 ? 'upgrade' : 'upgrades'} banked, wanted ${upgradeTarget(worst.act)}`,
          }
        : { verdict: 'pass', note: `all ${entries.length} boss ${entries.length === 1 ? 'entry' : 'entries'} at the bar` };
    },
  },
  nemesis: {
    leakId: 'nemesis',
    title: 'Meet it healthy',
    assignment:
      'Reach the encounter that has ended the most of your runs at the HP you survive it at — rest site, potion, or the quieter path.',
    targetRuns: 5,
    context: nemesisContext,
    // Mirrors nemesis.ts exactly: the population is meetings with the ONE
    // encounter the card named, and the accusation is arriving under the bar
    // it quoted. No nemesis, no meeting, or no readable entry HP means the
    // behavior never came up — the run consumes no drill slot either way.
    //
    // No BAR either: nemesis.ts sets drillBar to undefined (and offers no
    // drill) when the meetings survived are no healthier than the deaths, or
    // when a cohort is too thin to compare. There the card explicitly says
    // entry HP is not what separates them, so grading a run against the house
    // 60% floor would accuse it of a miss the card never alleged.
    grade(run, bar, subject) {
      if (!subject) return { verdict: 'na', note: 'no encounter in your history is a nemesis yet' };
      if (bar === undefined) return { verdict: 'na', note: 'no entry-HP bar your history supports' };
      const name = displayName(subject);
      const met = meetings(run, subject).filter((m) => m.entryPct !== undefined);
      if (met.length === 0) return { verdict: 'na', note: `did not meet ${name}` };
      const worst = met.reduce((a, b) => (a.entryPct! <= b.entryPct! ? a : b));
      const pct = Math.round(worst.entryPct! * 100);
      return pct < bar
        ? { verdict: 'fail', note: `met ${name} at ${pct}%, bar is ${bar}%` }
        : { verdict: 'pass', note: `met ${name} at ${pct}%, bar is ${bar}%` };
    },
  },
  'fight-pacing': {
    leakId: 'fight-pacing',
    title: 'Close the hallway',
    assignment: `Keep the median act-1/2 hallway fight at ${TURN_TARGET} turns or under.`,
    targetRuns: 5,
    grade(run) {
      const fights = hallwayFights(run);
      if (fights.length < 4) return { verdict: 'na', note: 'too few hallway fights recorded' };
      const med = medianHallwayTurns(run)!;
      return med <= TURN_TARGET
        ? { verdict: 'pass', note: `median ${med} turns across ${fights.length} hallway fights` }
        : { verdict: 'fail', note: `median ${med} turns across ${fights.length} hallway fights, bar is ${TURN_TARGET}` };
    },
  },
};

export function computeDrillProgress(drill: ActiveDrill, runs: NormalizedRun[]): DrillProgress | undefined {
  const def = DRILLS[drill.leakId];
  if (!def) return undefined; // drill for a detector that no longer exists
  const eligible = completedRuns(runs)
    .filter((r) => r.startTime * 1000 >= drill.acceptedAt)
    .sort((a, b) => a.startTime - b.startTime);

  // The subject is re-derived from the whole corpus (the detector's own view);
  // the bar stays whatever the accepted card quoted.
  const ctx = def.context?.(runs) ?? {};
  const graded: GradedRun[] = [];
  let passes = 0;
  let fails = 0;
  for (const run of eligible) {
    if (passes + fails >= drill.targetRuns) break;
    const { verdict, note } = def.grade(run, drill.bar ?? ctx.bar, drill.subject ?? ctx.subject);
    if (verdict === 'pass') passes++;
    if (verdict === 'fail') fails++;
    graded.push({
      runId: run.id,
      startTime: run.startTime,
      label: `${shortDate(run.startTime)} · ${characterName(run.player.character)} A${run.ascension}`,
      verdict,
      note,
    });
  }
  return { drill, def, graded, passes, fails, complete: passes + fails >= drill.targetRuns };
}

/**
 * Per-run behavior-rate series for a leak (0..1, chronological), smoothed with
 * a trailing window — the leak card's trend sparkline. Returns undefined when
 * the leak has no rate function or too little history to say anything.
 */
export function behaviorTrend(
  leakId: string,
  runs: NormalizedRun[],
  window = 10,
): { startTime: number; rate: number }[] | undefined {
  const rateOf = RATE_FNS[leakId];
  if (!rateOf) return undefined;
  const ctx = DRILLS[leakId]?.context?.(runs) ?? {};
  const chrono = completedRuns(runs).sort((a, b) => a.startTime - b.startTime);
  const perRun: { startTime: number; rate: number }[] = [];
  for (const run of chrono) {
    const r = rateOf(run, ctx);
    if (r !== undefined) perRun.push({ startTime: run.startTime, rate: r });
  }
  if (perRun.length < window) return undefined;
  return perRun.map((p, i) => {
    const slice = perRun.slice(Math.max(0, i - window + 1), i + 1);
    return { startTime: p.startTime, rate: slice.reduce((a, s) => a + s.rate, 0) / slice.length };
  });
}

/**
 * Rate of the leak behavior within one run; undefined = didn't come up.
 *
 * Each entry mirrors its detector's headline predicate — a sparkline that
 * trends a different rule than the card above it is a lie with a nice curve.
 */
const RATE_FNS: Record<string, (run: NormalizedRun, ctx?: DrillContext) => number | undefined> = {
  'boss-entry-hp': (run) => {
    let fights = 0;
    let low = 0;
    run.nodes.forEach((node, i) => {
      if (!hasRoom(node, 'boss')) return;
      const entry = entryHpPct(run, i);
      if (entry === undefined) return;
      fights++;
      if (entry < LOW) low++;
    });
    return fights ? low / fights : undefined;
  },
  // removals.ts: rich visits are the denominator; only a real-spend visit with
  // no removal is a skip.
  'removal-discipline': (run) => {
    let rich = 0;
    let skipped = 0;
    for (const node of run.nodes) {
      if (!hasRoom(node, 'shop')) continue;
      if (entryGold(node) < richShopGold(node.act)) continue;
      rich++;
      if (node.stats.cardsRemoved.length === 0 && node.stats.goldSpent >= REAL_SPEND) skipped++;
    }
    return rich ? skipped / rich : undefined;
  },
  'damage-drafting': (run) => {
    const profile = draftProfile(run);
    if (!profile) return undefined;
    return profile.attacksBeforeElite < ATTACK_TARGET ? 1 : 0;
  },
  // potions.ts headline: elite/boss fights that got no potion.
  'potion-hoarding': (run) => {
    const fights = hardFights(run);
    if (!fights.length) return undefined;
    return fights.filter((n) => n.stats.potionsUsed.length === 0).length / fights.length;
  },
  'deck-bloat': (run) => (run.actsEntered < 2 ? undefined : deckAdditions(run, 1) > ACT1_ADD_TARGET ? 1 : 0),
  'upgrade-tempo': (run) => {
    const entries = bossEntries(run);
    if (!entries.length) return undefined;
    return entries.filter((e) => e.short).length / entries.length;
  },
  'fight-pacing': (run) => {
    const fights = hallwayFights(run);
    if (!fights.length) return undefined;
    return fights.filter((f) => f.turns > TURN_TARGET).length / fights.length;
  },
  // nemesis.ts headline: meetings with the named encounter entered under the
  // bar it quoted. Same subject and same bar as the drill grades against, so
  // the curve trends the rule the card states — and when the card names no
  // bar (survivals no healthier than the deaths, or a cohort too thin), there
  // is no rule to trend and the sparkline is withheld rather than silently
  // curving against a 60% the card never mentioned.
  nemesis: (run, ctx) => {
    if (!ctx?.subject || ctx.bar === undefined) return undefined;
    const met = meetings(run, ctx.subject).filter((m) => m.entryPct !== undefined);
    if (!met.length) return undefined;
    return met.filter((m) => m.entryPct! * 100 < ctx.bar!).length / met.length;
  },
};
