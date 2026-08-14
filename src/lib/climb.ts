/**
 * The Climb — per-character ascension walls.
 *
 * Deliberately NOT a leak detector: the point of ascension is to always be
 * pushing the next level, so the coach never suggests playing lower. Every
 * character gets a WALL — the level to take next — and a diagnosis of how the
 * attempts there have died (which act, which killer): coaching aimed at
 * breaking through the level the player is stuck on, not at retreating to a
 * comfortable one to farm win rate.
 *
 * Invariant (enforced by construction and by tests/copy-guard.test.ts): a
 * wall is never below any level the character has already played — the
 * target floors at the character's HIGHEST attempted ascension, so a casual
 * low-level detour run can never drag the wall down. The single exception to
 * next-level framing is a character that has beaten the cap — with nothing
 * above to take, and only there, the framing becomes consistency at the top.
 */
import { displayName } from './idFormat';
import { completedRuns } from './normalize';
import type { LeakResult, NormalizedRun } from './types';

/**
 * Current STS2 ascension ceiling (verified vs the wiki, Aug 2026; expected to
 * rise toward 20 at 1.0). The effective cap also grows with the data itself —
 * runs recorded above this constant raise it — so a game patch can never make
 * the wall point below what the player actually plays.
 */
export const ASCENSION_CAP = 10;

export interface CharacterWall {
  /** CHARACTER.* id */
  character: string;
  /** highest ascension beaten with this character; null before the first win */
  frontier: number | null;
  /**
   * The wall: max(frontier + 1, highest level ever played), capped at the
   * effective cap — never below anything the character has attempted, so the
   * coach cannot point down.
   */
  target: number;
  /** frontier has reached the cap — nothing above to take */
  summited: boolean;
  /** completed runs at the target level */
  attempts: number;
  /** furthest act entered across those attempts */
  deepestAct: number;
  /** startTime of this character's latest completed run */
  lastPlayed: number;
  /**
   * where target-level attempts died: [act 1, act 2, act 3]. Zero-floor
   * losses (no recorded history) count as attempts but not here.
   */
  deathsByAct: [number, number, number];
  /** commonest killer at the wall (ties resolve to the earliest-seen) */
  topKiller?: { encounter: string; deaths: number };
  /** summited only: the record at the cap */
  capRecord?: { wins: number; runs: number };
}

export interface ClimbSummary {
  /** one wall per character played, most recently played first */
  walls: CharacterWall[];
  /** the wall being actively pushed: the most recently played character's */
  active?: CharacterWall;
  /** title of the top applicable leak — the lever the coach pairs with the climb */
  leverTitle?: string;
}

export function climbSummary(runs: NormalizedRun[], leaks: LeakResult[]): ClimbSummary {
  const completed = completedRuns(runs);
  const effectiveCap = Math.max(ASCENSION_CAP, ...completed.map((r) => r.ascension));

  const byCharacter = new Map<string, NormalizedRun[]>();
  for (const run of completed) {
    const list = byCharacter.get(run.player.character) ?? [];
    list.push(run);
    byCharacter.set(run.player.character, list);
  }

  const walls: CharacterWall[] = [];
  for (const [character, characterRuns] of byCharacter) {
    const wins = characterRuns.filter((r) => r.win);
    const frontier = wins.length ? Math.max(...wins.map((r) => r.ascension)) : null;
    const highestPlayed = Math.max(...characterRuns.map((r) => r.ascension));
    const lastPlayed = Math.max(...characterRuns.map((r) => r.startTime));
    const summited = frontier !== null && frontier >= effectiveCap;
    const target = summited
      ? effectiveCap
      : Math.min(effectiveCap, Math.max(frontier === null ? 0 : frontier + 1, highestPlayed));

    const atTarget = characterRuns.filter((r) => r.ascension === target);
    const deathsByAct: [number, number, number] = [0, 0, 0];
    const killers = new Map<string, number>();
    for (const r of atTarget) {
      if (r.win || r.actsEntered === 0) continue;
      deathsByAct[Math.min(3, r.actsEntered) - 1] += 1;
      const killer = r.killedByEncounter ?? r.killedByEvent;
      if (killer) killers.set(killer, (killers.get(killer) ?? 0) + 1);
    }
    let topKiller: CharacterWall['topKiller'];
    for (const [encounter, deaths] of killers) {
      if (!topKiller || deaths > topKiller.deaths) topKiller = { encounter, deaths };
    }

    walls.push({
      character,
      frontier,
      target,
      summited,
      attempts: atTarget.length,
      deepestAct: Math.max(0, ...atTarget.map((r) => r.actsEntered)),
      lastPlayed,
      deathsByAct,
      topKiller,
      capRecord: summited
        ? { wins: atTarget.filter((r) => r.win).length, runs: atTarget.length }
        : undefined,
    });
  }

  walls.sort((a, b) => b.lastPlayed - a.lastPlayed);
  const lever = leaks.find((l) => l.tier === 'leak' && l.applicable && !l.healthy);
  return { walls, active: walls[0], leverTitle: lever?.title };
}

/**
 * One-line diagnosis of a wall — how the siege is going and where it breaks.
 * Pure so tests/copy-guard.test.ts can audit every branch it can emit.
 */
export function wallLine(wall: CharacterWall): string {
  if (wall.summited && wall.capRecord) {
    const { wins, runs } = wall.capRecord;
    return `A${wall.target} beaten — nothing above it to take. ${wins} ${wins === 1 ? 'win' : 'wins'} in ${runs} ${runs === 1 ? 'run' : 'runs'} at the cap; the climb here is consistency.`;
  }
  if (wall.attempts === 0) return 'Fresh ground — no attempts yet.';

  const deaths = wall.deathsByAct[0] + wall.deathsByAct[1] + wall.deathsByAct[2];
  const attempts = `${wall.attempts} ${wall.attempts === 1 ? 'attempt' : 'attempts'}`;
  if (deaths === 0) return `${attempts} so far.`;

  const perAct = wall.deathsByAct
    .map((count, i) => ({ count, act: i + 1 }))
    .filter((p) => p.count > 0);
  const spread =
    perAct.length === 1 && deaths === wall.attempts && wall.attempts > 1
      ? `every one has died in act ${perAct[0].act}`
      : perAct.length === 1
        ? `${deaths === 1 ? 'the death came' : 'the deaths came'} in act ${perAct[0].act}`
        : `deaths: ${perAct.map((p) => `${p.count} in act ${p.act}`).join(', ')}`;
  const killer =
    wall.topKiller && wall.topKiller.deaths >= 2
      ? ` ${displayName(wall.topKiller.encounter)} took ${wall.topKiller.deaths} of them.`
      : '';
  return `${attempts} — ${spread}.${killer}`;
}

export interface LatestVictory {
  character: string;
  ascension: number;
  /** the win raised this character's frontier — a new highest level beaten */
  newFrontier: boolean;
  /** the wall the character now faces (undefined when the cap is beaten) */
  nextTarget?: number;
}

/**
 * The latest completed run, when it was a win — the coach opens with the
 * celebration before the diagnosis. newFrontier compares against the wins
 * BEFORE this one, so beating your own record reads as taking the wall even
 * though the frontier already contains it by the time this runs.
 */
export function latestVictory(runs: NormalizedRun[]): LatestVictory | undefined {
  const completed = completedRuns(runs);
  if (completed.length === 0) return undefined;
  const latest = completed.reduce((a, b) => (b.startTime > a.startTime ? b : a));
  if (!latest.win) return undefined;
  const effectiveCap = Math.max(ASCENSION_CAP, ...completed.map((r) => r.ascension));
  const priorWins = completed.filter(
    (r) => r.win && r.player.character === latest.player.character && r.id !== latest.id,
  );
  const priorFrontier = priorWins.length ? Math.max(...priorWins.map((r) => r.ascension)) : null;
  return {
    character: latest.player.character,
    ascension: latest.ascension,
    newFrontier: priorFrontier === null || latest.ascension > priorFrontier,
    nextTarget: latest.ascension >= effectiveCap ? undefined : Math.min(effectiveCap, latest.ascension + 1),
  };
}
