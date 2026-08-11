/**
 * Tolerant Zod schema for STS2 .run files (schema_version 8 and 9).
 *
 * Design rules (from auditing 231 real files):
 *  - v8 is a strict subset of v9 — one schema handles both.
 *  - EVERY list/object field is optional: the game omits empty lists entirely.
 *  - Unknown fields must never fail a parse (.passthrough() everywhere) —
 *    early-access patches add fields at any time.
 *  - The only null observed anywhere is event variable string_value.
 */
import { z } from 'zod';

const cardRaw = z
  .object({
    id: z.string(),
    current_upgrade_level: z.number().optional(),
    floor_added_to_deck: z.number().optional(),
  })
  .passthrough();

const pickable = <T extends z.ZodTypeAny>(inner: T) =>
  z.object({ choice: inner.optional(), was_picked: z.boolean().optional() }).passthrough();

const playerStatsRaw = z
  .object({
    player_id: z.union([z.number(), z.string()]),
    current_hp: z.number(),
    max_hp: z.number(),
    current_gold: z.number(),
    damage_taken: z.number(),
    hp_healed: z.number(),
    max_hp_gained: z.number().optional(),
    max_hp_lost: z.number().optional(),
    gold_gained: z.number().optional(),
    gold_spent: z.number().optional(),
    gold_lost: z.number().optional(),
    gold_stolen: z.number().optional(),
    card_choices: z
      .array(z.object({ card: cardRaw, was_picked: z.boolean().optional() }).passthrough())
      .optional(),
    relic_choices: z.array(pickable(z.string())).optional(),
    potion_choices: z.array(pickable(z.string())).optional(),
    rest_site_choices: z.array(z.string()).optional(),
    potion_used: z.array(z.string()).optional(),
    potion_discarded: z.array(z.string()).optional(),
    cards_gained: z.array(cardRaw).optional(),
    cards_removed: z.array(cardRaw).optional(),
    upgraded_cards: z.array(z.unknown()).optional(),
    bought_relics: z.array(z.string()).optional(),
    bought_potions: z.array(z.string()).optional(),
    bought_colorless: z.array(z.string()).optional(),
    event_choices: z
      .array(z.object({ title: z.object({ key: z.string() }).passthrough().optional() }).passthrough())
      .optional(),
  })
  .passthrough();

const roomRaw = z
  .object({
    room_type: z.string(),
    model_id: z.string().optional(),
    monster_ids: z.array(z.string()).optional(),
    turns_taken: z.number().optional(),
  })
  .passthrough();

const mapPointRaw = z
  .object({
    map_point_type: z.string(),
    rooms: z.array(roomRaw).optional(),
    player_stats: z.array(playerStatsRaw).optional(),
  })
  .passthrough();

const playerRaw = z
  .object({
    id: z.union([z.number(), z.string()]),
    character: z.string(),
    deck: z.array(cardRaw).optional(),
    relics: z.array(z.object({ id: z.string(), floor_added_to_deck: z.number().optional() }).passthrough()).optional(),
    potions: z.array(z.object({ id: z.string() }).passthrough()).optional(),
    max_potion_slot_count: z.number().optional(),
  })
  .passthrough();

export const runFileSchema = z
  .object({
    schema_version: z.number(),
    build_id: z.string().optional(),
    game_mode: z.string().optional(),
    ascension: z.number().optional(),
    seed: z.string().optional(),
    start_time: z.number(),
    run_time: z.number().optional(),
    win: z.boolean(),
    was_abandoned: z.boolean().optional(),
    killed_by_encounter: z.string().optional(),
    killed_by_event: z.string().optional(),
    acts: z.array(z.string()).optional(),
    modifiers: z.array(z.object({ id: z.string() }).passthrough()).optional(),
    players: z.array(playerRaw).min(1),
    map_point_history: z.array(z.array(mapPointRaw)),
  })
  .passthrough();

export type RunFileRaw = z.infer<typeof runFileSchema>;
