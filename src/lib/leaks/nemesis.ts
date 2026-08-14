/**
 * Detector — nemesis (tier 'leak').
 *
 * Thesis: one encounter is ending more of this player's runs than any other,
 * and the useful report is not "you die to it" but what separates the meetings
 * they SURVIVED from the ones that killed them — then what the fight actually
 * does, from the wiki's own numbers at the ascension they meet it at.
 *
 * Two populations, and they must never be crossed:
 *  - MEETINGS: every combat room whose modelId is this encounter, across
 *    completed runs. One room = one meeting.
 *  - DEATHS: the meeting the run ended on, confirmed by killed_by_encounter.
 * Every percentage on this card is deaths/meetings over the same filter, so a
 * player who remembers a run can check any line against it.
 *
 * WHY HALLWAY MONSTERS ARE IN THE POOL. Ranking is deaths × death-rate, and a
 * hallway encounter is met so often that its rate collapses — Nibbits met 40
 * times for 1 death scores 0.025 against a boss met 20 times for 6 deaths at
 * 1.8. So the ranking already suppresses them without a hand-placed rule, and
 * a hallway fight that genuinely keeps ending runs deserves to be named. The
 * flip side is the confounder: hallway encounters are met more often, which
 * deflates their rate against a boss you meet once a run — see confoundNote.
 *
 * PER-CHARACTER is first-class, not a footnote. Defect's answer to a fight is
 * not Regent's. But with a few dozen runs across five characters most splits
 * are 2 or 3 fights deep, so counts ("11 of your 14 deaths are Regent runs")
 * are always safe to state while RATES are gated behind MIN_CHAR_FIGHTS and
 * otherwise reported as withheld. A percentage from 2 fights is a lie with a
 * denominator.
 *
 * FIGHT FACTS come from lib/enemies.ts and are quoted, never invented: HP at
 * the player's own ascension, the hardest intent verbatim, whether the intent
 * table is mostly multi-hit, and the debuffs it applies. Kaiser Crab and
 * MONSTER.DOOR are genuinely absent from the wiki; when dossier() returns
 * undefined the card degrades to the player's own record and says so.
 */
import { attackIntents, biggestHit, debuffsApplied, dossier, isMultiHit, multiHitIntents, type Dossier } from '../enemies';
import { characterName, displayName, encounterTier } from '../idFormat';
import { completedRuns, deathNode, entryHpPct } from '../normalize';
import type { EvidenceStrength, LeakResult, NormalizedRun } from '../types';
import {
  LOW_BOSS_ENTRY,
  healthyResult,
  mean1,
  median,
  mostRecent,
  n1,
  notYetApplicable,
  pctLabel,
  rankScore,
  runTag,
} from './helpers';

const ID = 'nemesis';
const TITLE = 'One fight is ending your runs';
const MIN_COMPLETED = 20;

/** Meetings an encounter needs before it can be ranked — NemesisBoard's floor. */
export const MIN_FIGHTS = 10;

/** Deaths it needs before "nemesis" is a word we are entitled to use. */
export const MIN_DEATHS = 3;

/** Meetings ON ONE CHARACTER before a per-character death rate may be quoted. */
export const MIN_CHAR_FIGHTS = 10;

/** Fights a cohort needs before survived-vs-died numbers are worth comparing. */
export const MIN_COHORT = 3;

/** The drill's floor and ceiling, as whole percents of max HP. */
export const BAR_FLOOR = Math.round(LOW_BOSS_ENTRY * 100);
export const BAR_CEILING = 85;

/** One combat room, with the state the player walked into it carrying. */
export interface Meeting {
  run: NormalizedRun;
  encounterId: string;
  floor: number;
  act: number;
  turns: number;
  /** 0..1 entry HP fraction; undefined only when the fight has no prior node */
  entryPct?: number;
  potionsThrown: number;
  upgradesBanked: number;
  cardsAdded: number;
  died: boolean;
}

/**
 * Every combat meeting in a run (optionally filtered to one encounter), with
 * upgrades and card additions counted as they stood ENTERING the fight — the
 * same convention upgradeTempo.ts and deckBloat.ts use, including deckBloat's
 * id|floorAdded dedupe so a card bouncing back into the deck is not a second
 * addition.
 *
 * potionsThrown is a node figure: a "?" node holding two combats would credit
 * both rooms with the node's potions. No such node exists in the corpus, and
 * the alternative — dropping the field — loses a real separator.
 */
export function meetings(run: NormalizedRun, encounterId?: string): Meeting[] {
  const death = deathNode(run);
  const out: Meeting[] = [];
  const added = new Set<string>();
  let upgrades = 0;
  run.nodes.forEach((node, index) => {
    for (const room of node.rooms) {
      if (!room.modelId || room.monsterIds.length === 0) continue;
      if (encounterId && room.modelId !== encounterId) continue;
      out.push({
        run,
        encounterId: room.modelId,
        floor: node.floor,
        act: node.act,
        turns: room.turnsTaken,
        entryPct: entryHpPct(run, index),
        potionsThrown: node.stats.potionsUsed.length,
        upgradesBanked: upgrades,
        cardsAdded: added.size,
        died: node === death && run.killedByEncounter === room.modelId,
      });
    }
    upgrades += node.stats.cardsUpgraded.filter(Boolean).length;
    for (const choice of node.stats.cardChoices) {
      if (choice.wasPicked) added.add(`${choice.card.id}|${choice.card.floorAdded ?? node.floor}`);
    }
    for (const gained of node.stats.cardsGained) added.add(`${gained.id}|${gained.floorAdded ?? node.floor}`);
  });
  return out;
}

/** Every meeting in the corpus, grouped by encounter id. */
export function meetingsByEncounter(completed: NormalizedRun[]): Map<string, Meeting[]> {
  const out = new Map<string, Meeting[]>();
  for (const run of completed) {
    for (const meeting of meetings(run)) {
      const list = out.get(meeting.encounterId);
      if (list) list.push(meeting);
      else out.set(meeting.encounterId, [meeting]);
    }
  }
  return out;
}

/**
 * The encounter costing this player the most runs: deaths × death rate, over
 * encounters met MIN_FIGHTS times with at least MIN_DEATHS deaths. The product
 * is the point — rate alone crowns a 1-of-10, raw deaths alone crowns whatever
 * is met most often. Ties break on deaths, then meetings, then id, so the pick
 * is stable across re-syncs.
 */
export function nemesisId(completed: NormalizedRun[]): string | undefined {
  let best: { id: string; score: number; deaths: number; met: number } | undefined;
  for (const [id, met] of meetingsByEncounter(completed)) {
    if (met.length < MIN_FIGHTS) continue;
    const deaths = met.filter((m) => m.died).length;
    if (deaths < MIN_DEATHS) continue;
    const score = (deaths * deaths) / met.length;
    const better =
      !best ||
      score > best.score ||
      (score === best.score &&
        (deaths > best.deaths || (deaths === best.deaths && (met.length > best.met || id < best.id))));
    if (better) best = { id, score, deaths, met: met.length };
  }
  return best?.id;
}

/**
 * The entry-HP bar this player is held to at their nemesis: the median HP of
 * the meetings they actually survived, clamped. Undefined when their survived
 * meetings are no healthier than their deaths — at which point entry HP is not
 * what separates the two and no HP drill would be honest.
 *
 * The clamp is the same argument deckBloat.ts makes about its card bar: the
 * floor is the house 60% boss-door number, and above BAR_CEILING the bar stops
 * being a routing decision and becomes a wish about how the run went.
 */
export function nemesisBar(survivedMedianPct: number, diedMedianPct: number): number | undefined {
  if (survivedMedianPct <= diedMedianPct) return undefined;
  return Math.min(BAR_CEILING, Math.max(BAR_FLOOR, Math.round(survivedMedianPct)));
}

/**
 * What the nemesis drill grades against, re-derived from the corpus: the
 * subject encounter and today's bar. The bar frozen onto the accepted drill
 * always wins over this one — see computeDrillProgress.
 */
export function nemesisContext(runs: NormalizedRun[]): { subject?: string; bar?: number } {
  const completed = completedRuns(runs);
  const subject = nemesisId(completed);
  if (!subject) return {};
  const met = completed.flatMap((run) => meetings(run, subject));
  const survived = entryPcts(met.filter((m) => !m.died));
  const died = entryPcts(met.filter((m) => m.died));
  const bar =
    survived.length === 0
      ? BAR_FLOOR
      : survived.length >= MIN_COHORT && died.length >= MIN_COHORT
        ? nemesisBar(median(survived), median(died))
        : undefined;
  return { subject, bar };
}

/** Entry HP of the meetings that have one, as whole-percent numbers. */
function entryPcts(list: Meeting[]): number[] {
  return list.filter((m) => m.entryPct !== undefined).map((m) => m.entryPct! * 100);
}

/**
 * pctLabel, except a real-but-tiny rate keeps a decimal. The baseline death
 * rate across hundreds of hallway meetings rounds to "0%", and a card that
 * says a fight is deadlier than nothing has said nothing.
 */
function rateLabel(fraction: number): string {
  return fraction > 0 && fraction < 0.01 ? `${(fraction * 100).toFixed(1)}%` : pctLabel(fraction);
}

/** "boss" | "elite" | "hallway fight" — from the encounter id, always available. */
function tierWord(id: string): string {
  const tier = encounterTier(id);
  if (tier === 'boss') return 'boss';
  if (tier === 'elite') return 'elite';
  return 'hallway fight';
}

// ---------- what separated the meetings you lived through ----------

interface Separator {
  key: string;
  /** dumbbell label */
  label: string;
  format: 'pct' | 'count';
  /** the smallest gap worth printing — below it the two cohorts agree */
  minGap: number;
  value(m: Meeting): number | undefined;
  /** survived value, died value, survived n, died n */
  line(a: number, b: number, n: number, m: number, name: string): string;
}

/**
 * Gaps small enough to be noise are not printed. Each floor is the smallest
 * difference that changes a decision: 8 points of max HP is a rest site, a
 * turn and a half is a whole enemy turn of damage, half a potion is a potion
 * every other fight, a card or an upgrade is one reward screen.
 */
const SEPARATORS: Separator[] = [
  {
    key: 'entry-hp',
    label: 'Entry HP',
    format: 'pct',
    minGap: 8,
    value: (m) => (m.entryPct === undefined ? undefined : m.entryPct * 100),
    line: (a, b, n, m, name) =>
      `entry HP at ${name}: ${Math.round(a)}% median across the ${n} you survived vs ${Math.round(b)}% across the ${m} that killed you`,
  },
  {
    key: 'turns',
    label: 'Turns taken',
    format: 'count',
    minGap: 1.5,
    value: (m) => (m.turns > 0 ? m.turns : undefined),
    line: (a, b, n, m, name) =>
      `turns taken at ${name}: ${n1(a)} avg across the ${n} you survived vs ${n1(b)} across the ${m} that killed you`,
  },
  {
    key: 'potions',
    label: 'Potions thrown in the fight',
    format: 'count',
    minGap: 0.5,
    value: (m) => m.potionsThrown,
    line: (a, b, n, m, name) =>
      `potions thrown at ${name}: ${n1(a)} avg across the ${n} you survived vs ${n1(b)} across the ${m} that killed you`,
  },
  {
    key: 'upgrades',
    label: 'Upgrades banked',
    format: 'count',
    minGap: 1,
    value: (m) => m.upgradesBanked,
    line: (a, b, n, m, name) =>
      `upgrades banked entering ${name}: ${n1(a)} avg across the ${n} you survived vs ${n1(b)} across the ${m} that killed you`,
  },
  {
    key: 'cards',
    label: 'Cards added before the fight',
    format: 'count',
    minGap: 1.5,
    value: (m) => m.cardsAdded,
    line: (a, b, n, m, name) =>
      `cards added before ${name}: ${n1(a)} avg across the ${n} you survived vs ${n1(b)} across the ${m} that killed you`,
  },
];

interface Gap {
  sep: Separator;
  survivedValue: number;
  diedValue: number;
  survivedN: number;
  diedN: number;
  gap: number;
}

/**
 * Every separator with a real gap, biggest relative gap first. Entry HP is
 * measured as a median (it is a bar, and one 12% disaster should not move it);
 * the counting metrics are means.
 */
function separators(survived: Meeting[], died: Meeting[]): Gap[] {
  const out: Gap[] = [];
  for (const sep of SEPARATORS) {
    const a = survived.map(sep.value).filter((v): v is number => v !== undefined);
    const b = died.map(sep.value).filter((v): v is number => v !== undefined);
    if (a.length < MIN_COHORT || b.length < MIN_COHORT) continue;
    const av = sep.format === 'pct' ? median(a) : mean1(a);
    const bv = sep.format === 'pct' ? median(b) : mean1(b);
    const gap = Math.abs(av - bv);
    if (gap < sep.minGap) continue;
    out.push({ sep, survivedValue: av, diedValue: bv, survivedN: a.length, diedN: b.length, gap });
  }
  return out.sort((x, y) => y.gap / Math.max(1, y.diedValue) - x.gap / Math.max(1, x.diedValue));
}

// ---------- the fight's own numbers ----------

/**
 * The wiki's read of the fight at the ascension the player MOST RECENTLY met
 * it at — the version they are climbing now, not the easiest one they ever
 * saw. Empty when the encounter has no wiki entry.
 */
function fightFacts(encounterId: string, met: Meeting[]): { sentences: string[]; receipt?: string } {
  const latest = mostRecent(met, (m) => m.run.startTime, 1)[0];
  const ascension = latest?.run.ascension ?? 0;
  const d = dossier(encounterId, ascension);
  const name = displayName(encounterId);
  if (!d) {
    return {
      sentences: [`The wiki has no entry for ${name}, so this card is your own record and nothing else.`],
      receipt: `wiki fight facts for ${name}: none published — no HP, no intent table`,
    };
  }

  const sentences: string[] = [];
  const facts: string[] = [];
  if (d.totalHp) {
    const across = d.isGroup ? ` across ${d.members.filter((m) => m.hp).length} bodies` : '';
    sentences.push(`At A${ascension} it is a ${tierWord(encounterId)} with ${d.totalHp} HP${across}.`);
    facts.push(`${d.totalHp} HP${across} at A${ascension}`);
  }
  const hit = biggestHit(d);
  if (hit) {
    sentences.push(`Its hardest line is ${hit.name} — ${hit.text.replace(/\.$/, '')}.`);
    facts.push(`hardest intent ${hit.name} — ${hit.text.replace(/\.$/, '')}`);
  }
  if (isMultiHit(d)) {
    // Count them rather than saying "most": isMultiHit's gate is 34% of the
    // damage lines, so "most" would be a claim the gate does not entitle us to
    // the day a roster lands between a third and a half. A count is checkable
    // against the intent table the dossier prints directly underneath.
    const { multi, total } = multiHitLines(d);
    sentences.push(
      `${multi} of its ${total} attack intents land more than once, so the number to cover is the swing total, not the number printed on one hit.`,
    );
    facts.push(`${multi} of ${total} attack intents hit more than once`);
  }
  const debuffs = debuffsApplied(d);
  if (debuffs.length) {
    sentences.push(`It applies ${listOf(debuffs.slice(0, 3))}.`);
    facts.push(`applies ${debuffs.slice(0, 3).join(', ')}`);
  }
  return {
    sentences,
    receipt: facts.length ? `wiki fight facts for ${d.name}: ${facts.join(' · ')}` : undefined,
  };
}

/**
 * Attack intents across the roster, and how many of them strike more than
 * once. Mirrors isMultiHit()'s own line rule exactly — damage lines are the
 * denominator, an "xN" clause is what makes one multi-hit — so the printed
 * count and the gate that lets it print can never disagree.
 */
function multiHitLines(d: Dossier): { multi: number; total: number } {
  // Shares isMultiHit's population exactly — the sentence quotes the same
  // counts the gate was computed from.
  return { multi: multiHitIntents(d).length, total: attackIntents(d).length };
}

/** "Frail, Weak and Vulnerable" */
function listOf(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

// ---------- the detector ----------

export function nemesisLeak(completed: NormalizedRun[]): LeakResult {
  if (completed.length < MIN_COMPLETED) {
    return notYetApplicable(
      ID,
      'leak',
      TITLE,
      `This check ranks every encounter you have met ${MIN_FIGHTS}+ times by how often it ends the run, then compares the meetings you survived against the ones you didn't. It needs at least ${MIN_COMPLETED} finished runs and you have ${completed.length}.`,
    );
  }

  const byEncounter = meetingsByEncounter(completed);
  const ranked = [...byEncounter.entries()].filter(([, met]) => met.length >= MIN_FIGHTS);
  if (ranked.length === 0) {
    return notYetApplicable(
      ID,
      'leak',
      TITLE,
      `No encounter appears in your history ${MIN_FIGHTS} times yet, and a death rate off fewer meetings than that is a coin flip with a percentage sign. This unlocks as repeat fights pile up.`,
    );
  }

  const chosen = nemesisId(completed);
  if (!chosen) {
    const deadliest = ranked
      .map(([id, met]) => ({ id, met, deaths: met.filter((m) => m.died).length }))
      .sort((a, b) => b.deaths / b.met.length - a.deaths / a.met.length || b.deaths - a.deaths)[0];
    return healthyResult(
      ID,
      'leak',
      TITLE,
      `No single fight is picking you off. Across ${ranked.length} encounters you have met ${MIN_FIGHTS}+ times, the worst is ${displayName(deadliest.id)} at ${deadliest.deaths} ${deadliest.deaths === 1 ? 'death' : 'deaths'} in ${deadliest.met.length} meetings — under the ${MIN_DEATHS}-death floor this card needs before it names a nemesis.${deadliest.deaths > 0 ? ' Your deaths are spread across the roster, so the lever is a habit rather than a fight.' : ''}`,
      [
        `encounters met ${MIN_FIGHTS}+ times: ${ranked.length}`,
        `deadliest of them: ${displayName(deadliest.id)}, ${deadliest.deaths} deaths / ${deadliest.met.length} meetings (${pctLabel(deadliest.deaths / deadliest.met.length)})`,
      ],
    );
  }

  const met = byEncounter.get(chosen)!;
  const name = displayName(chosen);
  const deaths = met.filter((m) => m.died).length;
  const rate = deaths / met.length;

  // Baseline: every OTHER combat meeting in the same corpus, same death rule.
  const others = [...byEncounter.entries()].filter(([id]) => id !== chosen).flatMap(([, list]) => list);
  const otherDeaths = others.filter((m) => m.died).length;
  const otherRate = others.length ? otherDeaths / others.length : 0;

  const survived = met.filter((m) => !m.died);
  const died = met.filter((m) => m.died);

  // ----- per character -----
  const characters = [...new Set(met.map((m) => m.run.player.character))];
  const charRows = characters
    .map((character) => {
      const rows = met.filter((m) => m.run.player.character === character);
      return { character, met: rows, deaths: rows.filter((m) => m.died).length };
    })
    .sort((a, b) => b.deaths - a.deaths || b.met.length - a.met.length || a.character.localeCompare(b.character));
  const top = charRows[0];
  const charLine = `${name} by character: ${charRows
    .map((row) =>
      row.met.length >= MIN_CHAR_FIGHTS
        ? `${characterName(row.character)} ${row.deaths} deaths / ${row.met.length} meetings (${pctLabel(row.deaths / row.met.length)})`
        : `${characterName(row.character)} ${row.deaths} deaths / ${row.met.length} meetings (rate withheld, under ${MIN_CHAR_FIGHTS})`,
    )
    .join('; ')}`;

  let charSentence: string;
  if (charRows.length === 1) {
    charSentence = `Every one of those meetings is a ${characterName(top.character)} run, so there is no per-character split to read yet.`;
  } else if (top.deaths === deaths) {
    charSentence = `All ${deaths} of those deaths are ${characterName(top.character)} runs.`;
  } else if (top.deaths / deaths >= 0.6) {
    charSentence = `${top.deaths} of the ${deaths} are ${characterName(top.character)} runs.`;
  } else {
    charSentence = `The deaths are spread across ${listOf(charRows.filter((r) => r.deaths > 0).map((r) => `${characterName(r.character)} (${r.deaths})`))} — no single character carries it.`;
  }

  // The carrying character's own meetings: only contrast when both of ITS
  // cohorts are deep enough, otherwise say plainly that they are not.
  const topSurvived = top.met.filter((m) => !m.died);
  const topDied = top.met.filter((m) => m.died);
  const topEntrySurvived = entryPcts(topSurvived);
  const topEntryDied = entryPcts(topDied);
  let charContrast: string;
  if (topEntrySurvived.length >= MIN_COHORT && topEntryDied.length >= MIN_COHORT) {
    charContrast = `${characterName(top.character)} only: ${Math.round(median(topEntrySurvived))}% entry HP median across the ${topEntrySurvived.length} it survived vs ${Math.round(median(topEntryDied))}% across the ${topEntryDied.length} that killed it`;
  } else if (topSurvived.length > 0) {
    charContrast = `${characterName(top.character)} has survived it ${topSurvived.length} ${topSurvived.length === 1 ? 'time' : 'times'} against ${topDied.length} deaths — too thin to compare, counted not rated`;
  } else {
    charContrast = `${characterName(top.character)} has never survived it: ${topDied.length} deaths in ${top.met.length} meetings`;
  }

  // ----- what separated the meetings -----
  const gaps = separators(survived, died);
  const entryGap = gaps.find((g) => g.sep.key === 'entry-hp');
  const entrySurvived = entryPcts(survived);
  const entryDied = entryPcts(died);
  const bar =
    entrySurvived.length === 0
      ? BAR_FLOOR
      : entrySurvived.length >= MIN_COHORT && entryDied.length >= MIN_COHORT
        ? nemesisBar(median(entrySurvived), median(entryDied))
        : undefined;

  let separatorSentence: string;
  if (survived.length < MIN_COHORT) {
    separatorSentence = `You have survived it ${survived.length} ${survived.length === 1 ? 'time' : 'times'}, which is too few to say what a surviving meeting looks like.`;
  } else if (gaps.length === 0) {
    separatorSentence = `Nothing in how you arrive separates the meetings you survive from the ones you don't — same HP, same potions, same turns. What decides it is inside the fight.`;
  } else if (entryGap) {
    separatorSentence = `You reach it at ${Math.round(entryGap.survivedValue)}% HP in the meetings you survive and ${Math.round(entryGap.diedValue)}% in the ones you don't.`;
  } else {
    const g = gaps[0];
    separatorSentence = `${g.sep.label} is what separates them: ${n1(g.survivedValue)} in the ${g.survivedN} you survived, ${n1(g.diedValue)} in the ${g.diedN} that killed you.`;
  }

  const facts = fightFacts(chosen, met);

  // Entry HP leads the separators whenever it has a gap: it is the number the
  // body quotes and the number the drill grades, and a receipt drawer that
  // omits the quoted number is the one line a player would go looking for.
  const orderedGaps = entryGap ? [entryGap, ...gaps.filter((g) => g !== entryGap)] : gaps;

  const receiptLines = [
    `${name}: ${deaths} deaths / ${met.length} meetings (${rateLabel(rate)})`,
    `every other encounter in the same runs: ${otherDeaths} deaths / ${others.length} meetings (${rateLabel(otherRate)})`,
    charLine,
    charContrast,
    ...orderedGaps.slice(0, 4).map((g) => g.sep.line(g.survivedValue, g.diedValue, g.survivedN, g.diedN, name)),
    ...(facts.receipt ? [facts.receipt] : []),
  ];

  const strength: EvidenceStrength =
    met.length >= 30 && deaths >= 10 ? 'strong' : met.length >= 20 && deaths >= 5 ? 'moderate' : 'weak';

  const runReceipts = mostRecent(died, (m) => m.run.startTime, 5).map((m) => ({
    runId: m.run.id,
    label: `${runTag(m.run)} · ${name} ended it on floor ${m.floor}${
      m.entryPct === undefined ? '' : `, entered at ${pctLabel(m.entryPct)}`
    }`,
    enemyIds: [chosen],
  }));

  // Confounders, assembled from what this corpus actually shows.
  const confounds = [
    `Meetings are combat rooms in completed runs; a death is the meeting the run ended on, confirmed against the run's own killed-by field.`,
    `An encounter you meet once a run is rated on fewer meetings than one you meet three times, which flatters the common fight's rate.`,
  ];
  const survivedChars = new Set(survived.map((m) => m.run.player.character));
  const diedChars = new Set(died.map((m) => m.run.player.character));
  if (
    survived.length > 0 &&
    died.length > 0 &&
    [...survivedChars].every((c) => !diedChars.has(c))
  ) {
    confounds.push(
      `Every meeting you survived was on ${listOf([...survivedChars].map(characterName))} and every one that killed you was on ${listOf([...diedChars].map(characterName))} — the HP split and the character split are the same split here.`,
    );
  }
  if (gaps.some((g) => g.sep.key === 'turns')) {
    confounds.push('A fight you lose runs long partly because losing takes turns — read the turn gap as a symptom alongside the rest.');
  }

  const dumbbellGap = entryGap ?? gaps[0];

  // The bar is the survived median only when the clamp left it where it found
  // it. When the clamp bites — a player who survives at 51% gets held to the
  // 60% house floor, one who survives at 97% is capped at 85% — calling the
  // bar "the median" contradicts the entry-HP receipt printed three rows above
  // it, and the receipt is the number they can check. So the drill names which
  // number the bar actually is, and quotes the median alongside it either way.
  const survivedMedian = entrySurvived.length >= MIN_COHORT ? Math.round(median(entrySurvived)) : undefined;
  const barNote =
    bar === undefined || survivedMedian === undefined
      ? ''
      : bar === survivedMedian
        ? ' — the median you carry into the meetings you survive'
        : bar > survivedMedian
          ? ` — the house floor, above the ${survivedMedian}% median you carry into the ones you survive`
          : ` — capped there; the ones you survive run to a ${survivedMedian}% median`;

  return {
    id: ID,
    tier: 'leak',
    title: `${name} is ending your runs`,
    body: `${name} has ended ${deaths} of your runs across ${met.length} meetings — ${rateLabel(rate)}, against ${rateLabel(otherRate)} across the other ${others.length} fights in the same runs. ${charSentence} ${separatorSentence}${facts.sentences.length ? ` ${facts.sentences.join(' ')}` : ''}`,
    // Share of COMPLETED RUNS this one fight ended — same denominator the
    // corpus is counted on, and short enough for the head row's nowrap badge.
    ratioBadge: `${pctLabel(deaths / completed.length)} of your runs`,
    dumbbell: dumbbellGap
      ? {
          label: dumbbellGap.sep.label,
          winValue: +dumbbellGap.survivedValue.toFixed(1),
          lossValue: +dumbbellGap.diedValue.toFixed(1),
          format: dumbbellGap.sep.format,
          sampleLabel: `${met.length} meetings with ${name}`,
          // Meeting cohorts, NOT run win/loss cohorts — label them as such.
          winLabel: 'you survived',
          lossLabel: 'it killed you',
        }
      : undefined,
    receiptLines,
    runReceipts,
    confoundNote: confounds.join(' '),
    drill: bar
      ? {
          title: `Meet ${name} healthy`,
          body: `Next 5 runs: reach ${name} at ${bar}% HP or better${barNote}. Rest site, potion, or the quieter path.`,
        }
      : undefined,
    drillBar: bar,
    drillSubject: chosen,
    strength,
    expectedWinsLost: rankScore(met.length / completed.length, rate - otherRate, strength),
    applicable: true,
  };
}
