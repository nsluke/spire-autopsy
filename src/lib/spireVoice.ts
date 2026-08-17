/**
 * The Spire's voice — every line the mountain speaks, generated as pure data.
 *
 * Thesis: a voice this atmospheric is exactly where invented facts creep in,
 * so none of it lives in a component. spireNarration() turns the detector
 * output the Coach view already computed (LeakResult / DrillProgress /
 * LatestVictory) into ordered passages, and NOTHING here measures anything:
 * every digit in every passage is lifted verbatim from a field the detectors
 * produced, or is a number that field already holds. The Spire supplies
 * grammar, address and order — never a statistic. tests/spire-voice.test.ts
 * audits that claim line by line by extracting the digits back out.
 *
 * House rule, same as every other voice: the wall is the goal. The Spire is
 * unimpressed, precise, and never merciful about the next level.
 */
import type { LatestVictory } from './climb';
import type { DrillProgress } from './drills';
import { characterName } from './idFormat';
import { firstSentence } from './richText';
import type { LeakResult } from './types';

/** prose = paragraph, note = quieter paragraph, aside = mono evidence, rubric = section head. */
export type PassageTone = 'prose' | 'note' | 'aside' | 'rubric';

/**
 * Which prop a passage rewords — the audit key. 'spire' passages are pure
 * address and carry no digits at all; every other tag names the record whose
 * numbers the passage is allowed to quote.
 */
export type PassageSource = 'spire' | 'leak' | 'drill' | 'victory';

export interface SpirePassage {
  text: string;
  tone: PassageTone;
  src: PassageSource;
  /** LeakResult.id when src === 'leak' — the record this passage is graded against */
  leakId?: string;
  enemyIds?: string[];
  cardIds?: string[];
  relicIds?: string[];
  potionIds?: string[];
  /** run id, when the passage remembers one run and can link to its autopsy */
  runRef?: string;
}

export interface SpireNarration {
  title: string;
  passages: SpirePassage[];
}

/** The coach shows three cards; the Spire dwells on the same three. */
export const MAX_NARRATED = 3;
const MAX_RECEIPT_LINES = 5;
const MAX_MEMORIES = 2;

/**
 * One line of address per detector: what the Spire has watched you do. These
 * are the only sentences in the file with no data in them, so they carry NO
 * digits — the numbers arrive in the passages that follow, out of the record.
 */
const OPENERS: Record<string, string> = {
  'boss-entry-hp':
    'You reach the end of an act already opened up. What waits at the top of my acts does not care what the hallway cost you.',
  nemesis:
    'One of the things that lives in me keeps ending your climbs. It has taken your measure. Take its.',
  'removal-discipline':
    'The cards you were born with are still doing your fighting. We should speak of why.',
  'damage-drafting':
    'You build to survive my first act and forget that something in it has to die.',
  'potion-hoarding': 'The potions, then. I hand them out to be thrown.',
  'deck-bloat': 'Your dead decks run fatter than your winning ones. I watched every card go in.',
  'upgrade-tempo': "You reach my bosses' doors with your blades unwhetted.",
  'fight-pacing': 'Your fights in my hallways run long. I have time. You do not.',
  'elite-appetite': 'My elites are a choice. Your record says the choice is not a neutral one.',
  'gold-at-death': 'Some of your deaths are rich ones. I count the coin when the run stops.',
  'event-tax': 'My question marks take their cut in blood, and you keep signing.',
  'rest-discipline': 'You sleep at my fires while you are still whole.',
};

/** What the Spire went looking for and failed to find — the healthy verdicts. */
const LOOKED_FOR: Record<string, string> = {
  'boss-entry-hp': 'I looked for you arriving at the end of an act already bleeding.',
  nemesis: 'I looked for one of mine with your measure.',
  'removal-discipline': 'I looked for shops you left without cutting anything out of the deck.',
  'damage-drafting': 'I looked for a deck that brings nothing to my first act that kills.',
  'potion-hoarding': 'I looked for hoarded potions.',
  'deck-bloat': 'I looked for a deck grown fat in my first act.',
  'upgrade-tempo': 'I looked for fires you rose from unchanged.',
  'fight-pacing': 'I looked for hallway fights that run long.',
  'elite-appetite': 'I looked at how you treat my elites.',
  'gold-at-death': 'I looked for gold still in your hands when the run stopped.',
  'event-tax': 'I looked for blood spent at my question marks.',
  'rest-discipline': 'I looked for sleep taken while you were whole.',
};

const SPELLED = ['none', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/**
 * A count as a word, for voice. Only ever used where the same count is printed
 * in digits in the mono aside directly beneath the passage — a player must
 * always be able to check the claim in numerals.
 */
function spell(n: number): string {
  return Number.isInteger(n) && n >= 0 && n < SPELLED.length ? SPELLED[n] : String(n);
}

function passage(
  text: string,
  tone: PassageTone,
  src: PassageSource,
  extra: Partial<SpirePassage> = {},
): SpirePassage {
  return { text, tone, src, ...extra };
}

// ---------- victory ----------

/**
 * The Spire acknowledges the win with the same four facts the Coach's victory
 * strip states (ascension, character, newFrontier, nextTarget) and no others —
 * then names the next wall, never more gently than the coach does.
 */
function victoryPassages(v: LatestVictory): SpirePassage[] {
  const name = characterName(v.character);
  if (v.newFrontier && v.nextTarget !== undefined) {
    return [
      passage(
        `A${v.ascension} ${name} — you took it off me. I do not hand levels back, so the wall stands at A${v.nextTarget} now, and it is the only one worth the walk.`,
        'prose',
        'victory',
      ),
    ];
  }
  if (v.newFrontier) {
    return [
      passage(
        `A${v.ascension} ${name} — you took it off me, and there is nothing above it left to take. What remains is doing it again until the record stops arguing.`,
        'prose',
        'victory',
      ),
    ];
  }
  return [
    passage(
      `A win at A${v.ascension}. ${name} holds the level — held, not taken. You have stood this high before.`,
      'prose',
      'victory',
    ),
  ];
}

// ---------- one leak, in full ----------

function dumbbellSentence(leak: LeakResult): string | undefined {
  const d = leak.dumbbell;
  if (!d) return undefined;
  const unit = d.format === 'pct' ? '%' : '';
  // Cohort tags are telegraphic by design ('entered <60%', 'it killed you'),
  // so labelled dumbbells are set as a carved record rather than a sentence.
  // Unlabelled ones really are win/loss cohorts and can be said plainly.
  const record =
    d.winLabel && d.lossLabel
      ? `${d.label}: ${d.lossValue}${unit} (${d.lossLabel}) against ${d.winValue}${unit} (${d.winLabel}).`
      : `${d.label}: ${d.lossValue}${unit} in the runs I end, against ${d.winValue}${unit} in the runs you finish.`;
  return `${record} Counted across ${d.sampleLabel}.`;
}

function leakPassages(leak: LeakResult, drillIsOnThisLeak: boolean): SpirePassage[] {
  const tag = { leakId: leak.id };
  const out: SpirePassage[] = [passage(leak.title, 'rubric', 'leak', tag)];

  const opener = OPENERS[leak.id];
  if (opener) out.push(passage(opener, 'prose', 'leak', tag));

  const dumb = dumbbellSentence(leak);
  out.push(
    dumb
      ? passage(dumb, 'prose', 'leak', tag)
      : passage(`My record of it reads: ${firstSentence(leak.body)}`, 'prose', 'leak', tag),
  );
  if (leak.ratioBadge) out.push(passage(leak.ratioBadge, 'aside', 'leak', tag));
  for (const line of leak.receiptLines.slice(0, MAX_RECEIPT_LINES)) {
    out.push(passage(line, 'aside', 'leak', tag));
  }
  // No count here — a computed number would be the one figure on the page
  // that traces to nothing. The disclosure carries no digits.
  if (leak.receiptLines.length > MAX_RECEIPT_LINES) {
    out.push(passage('The Analyst keeps the rest of this ledger.', 'aside', 'leak', tag));
  }

  // Two runs can produce the same receipt line (same day, same character, same
  // number). The Spire is precise, not repetitive — one memory per wording.
  const seen = new Set<string>();
  const memories = leak.runReceipts.filter((r) => {
    if (seen.has(r.label)) return false;
    seen.add(r.label);
    return true;
  });
  for (const r of memories.slice(0, MAX_MEMORIES)) {
    out.push(
      passage(`I remember it: ${r.label}.`, 'prose', 'leak', {
        ...tag,
        enemyIds: r.enemyIds,
        cardIds: r.cardIds,
        relicIds: r.relicIds,
        potionIds: r.potionIds,
        runRef: r.runId,
      }),
    );
  }

  // The drill is the coach's instrument, not mine — I only read out what is
  // written on it, and only for a leak that is not already under oath.
  if (leak.drill && !drillIsOnThisLeak) {
    out.push(
      passage(`The way through it is written plainly. ${leak.drill.title}: ${leak.drill.body}`, 'prose', 'leak', tag),
    );
  }
  if (leak.confoundNote) out.push(passage(`In fairness to you: ${leak.confoundNote}`, 'note', 'leak', tag));
  return out;
}

// ---------- the oath ----------

const VERDICT_WORD = { pass: 'kept', fail: 'broken', na: 'not tested' } as const;

/**
 * Drill state, reported and never operated: the Spire has no start, clear or
 * demote. Every number comes off DrillProgress, and the spelled-out counts in
 * the prose are repeated in digits in the aside underneath.
 */
function drillPassages(p: DrillProgress): SpirePassage[] {
  const asked = p.drill.targetRuns;
  const out: SpirePassage[] = [passage('The oath', 'rubric', 'spire')];
  const broken = p.fails > 0 ? `, ${spell(p.fails)} ${p.fails === 1 ? 'has' : 'have'} not` : '';
  out.push(
    passage(
      `You swore something between climbs: ${p.def.title}. Of the ${spell(asked)} climbs it asks for, ${spell(p.passes)} ${p.passes === 1 ? 'has' : 'have'} kept it${broken}. I grade it off the climbs themselves; you do not get to tell me how they went.`,
      'prose',
      'drill',
    ),
  );
  out.push(
    passage(
      `oath · ${p.passes}/${asked} kept${p.fails > 0 ? ` · ${p.fails} broken` : ''}`,
      'aside',
      'drill',
    ),
  );
  for (const g of p.graded) {
    out.push(
      passage(`${VERDICT_WORD[g.verdict]} · ${g.label}${g.note ? ` — ${g.note}` : ''}`, 'aside', 'drill', {
        runRef: g.runId,
      }),
    );
  }
  if (p.graded.length === 0) {
    out.push(passage('Nothing since. The oath is graded on the climbs you make, not the ones you describe.', 'prose', 'drill'));
  } else if (p.complete) {
    out.push(passage('That is the whole of it. The oath is finished.', 'prose', 'drill'));
  }
  return out;
}

// ---------- the whole narration ----------

export function spireNarration(
  leaks: LeakResult[],
  drawerItems: LeakResult[],
  victory?: LatestVictory,
  activeDrill?: DrillProgress,
): SpireNarration {
  const accused = leaks.filter((l) => l.applicable && !l.healthy && l.tier === 'leak');
  const narrated = accused.slice(0, MAX_NARRATED);
  const spoken = new Set(narrated.map((l) => l.id));
  const healthy = drawerItems.filter((l) => l.healthy && !spoken.has(l.id));
  const minor = drawerItems.filter((l) => !l.healthy && l.applicable && !spoken.has(l.id));

  const title = victory
    ? victory.newFrontier
      ? 'You took a level off me'
      : 'You held the level'
    : accused.length > 0
      ? 'I have been counting'
      : 'I find little to hold against you';

  const passages: SpirePassage[] = [];
  if (victory) passages.push(...victoryPassages(victory));

  passages.push(
    passage(
      accused.length > 0
        ? 'I am the same mountain every time you enter. The hallways rearrange. The habits do not, and I have watched all of yours.'
        : 'I am the same mountain every time you enter. I have watched all of your climbs, and there is nothing in them yet that I would call a habit.',
      'prose',
      'spire',
    ),
  );

  if (narrated.length > 0) {
    passages.push(passage('What the record holds against you', 'rubric', 'spire'));
    for (const leak of narrated) {
      passages.push(...leakPassages(leak, activeDrill?.drill.leakId === leak.id));
    }
  }

  if (activeDrill) passages.push(...drillPassages(activeDrill));

  if (healthy.length > 0) {
    passages.push(passage('What I looked for and did not find', 'rubric', 'spire'));
    for (const l of healthy) {
      const looked = LOOKED_FOR[l.id] ?? `I went looking through ${l.title}.`;
      passages.push(
        passage(`${looked} It is not what is costing you climbs. ${firstSentence(l.body)}`, 'prose', 'leak', {
          leakId: l.id,
        }),
      );
    }
  }

  if (minor.length > 0) {
    passages.push(passage('Smaller marks', 'rubric', 'spire'));
    for (const l of minor) {
      passages.push(passage(`${l.title}. ${firstSentence(l.body)}`, 'note', 'leak', { leakId: l.id }));
    }
  }

  passages.push(
    passage(
      narrated.length > 0
        ? 'I do not wish you luck. Bring the habit instead, and bring it to the level above the one you have. I will be here, unchanged, counting.'
        : 'Keep climbing. The level above the one you hold is the only one worth the walk, and I will be counting there too.',
      'prose',
      'spire',
    ),
  );

  return { title, passages };
}

/** Exported for the audit: the counts the voice is allowed to spell out. */
export const SPELLED_NUMERALS = SPELLED;
