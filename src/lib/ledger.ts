/**
 * The game's own ledger — progress.save support.
 *
 * progress.save sits next to the history folder and holds STS2's lifetime
 * tallies (its own schema, v21 observed). One file gives a first-visit
 * player something real before any .run files: per-character records and
 * walls, playtime, nemesis ledgers, most-picked cards.
 *
 * Verified against a real profile (Aug 2026): character_stats.max_ascension
 * is the highest UNLOCKED level — exactly the wall lib/climb.ts computes —
 * and total_wins/losses count standard solo runs only (customs, dailies and
 * co-op are excluded by the game, so these can differ from our run-frame
 * numbers; the UI labels the source).
 */
import { z } from 'zod';

const characterEntry = z
  .object({
    id: z.string(),
    max_ascension: z.number().optional(),
    total_wins: z.number().optional(),
    total_losses: z.number().optional(),
    best_win_streak: z.number().optional(),
    fastest_win_time: z.number().optional(),
    playtime: z.number().optional(),
  })
  .passthrough();

const fightStats = z
  .object({ character: z.string().optional(), wins: z.number().optional(), losses: z.number().optional() })
  .passthrough();

const progressSchema = z
  .object({
    schema_version: z.number(),
    character_stats: z.array(characterEntry).optional(),
    encounter_stats: z
      .array(z.object({ encounter_id: z.string(), fight_stats: z.array(fightStats).optional() }).passthrough())
      .optional(),
    card_stats: z
      .array(z.object({ id: z.string(), times_picked: z.number().optional() }).passthrough())
      .optional(),
    floors_climbed: z.number().optional(),
    total_playtime: z.number().optional(),
  })
  .passthrough();

export interface LedgerCharacter {
  character: string;
  /** highest unlocked ascension — the game's word for the character's wall */
  wall: number;
  wins: number;
  losses: number;
  bestStreak: number;
  /** seconds; undefined when the game recorded -1 (no win yet) */
  fastestWinSeconds?: number;
  playtimeHours: number;
}

export interface Ledger {
  schemaVersion: number;
  characters: LedgerCharacter[]; // played characters only, most playtime first
  floorsClimbed?: number;
  playtimeHours?: number;
  /** encounters that have taken the most runs, per the game's fight ledger */
  topKillers: { encounter: string; losses: number }[];
  topPicked: { card: string; timesPicked: number }[];
  importedAt: number; // unix ms
}

export class LedgerParseError extends Error {}

export function isProgressFile(name: string): boolean {
  return /^progress\.save$/i.test(name);
}

export function parseProgressSave(text: string, importedAt = Date.now()): Ledger {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LedgerParseError('progress.save is not valid JSON');
  }
  const parsed = progressSchema.safeParse(raw);
  if (!parsed.success) {
    throw new LedgerParseError('progress.save has an unexpected shape — a game patch may be ahead of us');
  }
  const data = parsed.data;

  const characters: LedgerCharacter[] = (data.character_stats ?? [])
    .filter((c) => (c.total_wins ?? 0) + (c.total_losses ?? 0) > 0 || (c.playtime ?? 0) > 0)
    .filter((c) => c.id !== 'CHARACTER.RANDOM_CHARACTER')
    .map((c) => ({
      character: c.id,
      wall: c.max_ascension ?? 0,
      wins: c.total_wins ?? 0,
      losses: c.total_losses ?? 0,
      bestStreak: c.best_win_streak ?? 0,
      fastestWinSeconds:
        c.fastest_win_time !== undefined && c.fastest_win_time >= 0 ? c.fastest_win_time : undefined,
      playtimeHours: +((c.playtime ?? 0) / 3600).toFixed(1),
    }))
    .sort((a, b) => b.playtimeHours - a.playtimeHours);

  const topKillers = (data.encounter_stats ?? [])
    .map((e) => ({
      encounter: e.encounter_id,
      losses: (e.fight_stats ?? []).reduce((sum, f) => sum + (f.losses ?? 0), 0),
    }))
    .filter((e) => e.losses > 0)
    .sort((a, b) => b.losses - a.losses)
    .slice(0, 3);

  const topPicked = (data.card_stats ?? [])
    .map((c) => ({ card: c.id, timesPicked: c.times_picked ?? 0 }))
    .filter((c) => c.timesPicked > 0)
    .sort((a, b) => b.timesPicked - a.timesPicked)
    .slice(0, 5);

  return {
    schemaVersion: data.schema_version,
    characters,
    floorsClimbed: data.floors_climbed,
    playtimeHours: data.total_playtime !== undefined ? +(data.total_playtime / 3600).toFixed(1) : undefined,
    topKillers,
    topPicked,
    importedAt,
  };
}
