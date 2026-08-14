/**
 * EnemyName — encounter titles that carry the fight with them.
 *
 * Thesis: the moment a player reads "The Insatiable" in a receipt or a floor
 * log, the useful question is "what does it actually do?". The hover answers
 * with wiki facts only — HP, the intent table, the debuffs — and never with
 * strategy we would be inventing.
 *
 * Confounders, all of them honest-by-labeling:
 *  - HP has two columns (base and A8+). Callers that know the viewer's
 *    ascension pass it; the rest default to 0, so the tip says "(A0–A7)"
 *    whenever the two columns differ instead of quietly showing the wrong one.
 *  - Wiki HP cells are sometimes ranges ("32-35"), so the span is summed low
 *    and high rather than collapsed to one number.
 *  - A group encounter's roster is what the wiki LISTS; the game can field
 *    duplicates (Kin Follower ×2). The meta line says "roster of N" and the
 *    dossier prints the members, so no number here claims to be a fight total.
 *  - An id the wiki does not carry (Kaiser Crab, MONSTER.DOOR) resolves to
 *    nothing, and the tip falls back to today's bare portrait. Never a guess.
 */
import { monsterArt } from '../lib/art';
import { ASC_HP_LEVEL, biggestHit, debuffsApplied, dossier, type Dossier, type EnemyInfo } from '../lib/enemies';
import { displayName, encounterTier } from '../lib/idFormat';
import ArtName from './ArtName';

interface EnemyNameProps {
  id: string;
  /** Viewer's ascension — picks the A8+ HP column and labels which one it is. */
  ascension?: number;
}

/** Above this many intents the tip lists the hardest hit instead of the table. */
const MAX_TIP_INTENTS = 5;

function enemyColor(id: string): string | undefined {
  const tier = encounterTier(id);
  if (tier === 'boss') return 'var(--loss)';
  if (tier === 'elite') return 'var(--ember)';
  return undefined;
}

/** The HP cell that applies at this ascension — mirrors memberHp's A8 rule. */
export function hpCell(info: EnemyInfo, ascension: number): string | undefined {
  return ascension >= ASC_HP_LEVEL ? (info.ascHp ?? info.hp) : info.hp;
}

export interface HpSpan {
  lo: number;
  hi: number;
  /** members whose HP counted (roster-only entries carry none) */
  counted: number;
  /** the A8+ column exists and differs, so which column we read is worth saying */
  columnMatters: boolean;
}

/**
 * Summed HP across the roster, keeping ranges as ranges. memberHp() collapses
 * "32-35" to its low bound, which is right for a scalar but understates a
 * printed total, so the span is summed low-to-low and high-to-high here.
 */
export function hpSpan(d: Dossier, ascension: number): HpSpan | undefined {
  let lo = 0;
  let hi = 0;
  let counted = 0;
  for (const m of d.members) {
    const nums = hpCell(m, ascension)?.match(/\d+/g);
    if (!nums) continue;
    lo += Number(nums[0]);
    hi += Number(nums[nums.length - 1]);
    counted += 1;
  }
  if (counted === 0) return undefined;
  return {
    lo,
    hi,
    counted,
    columnMatters: d.members.some((m) => m.ascHp && m.hp && m.ascHp !== m.hp),
  };
}

/** "108 HP (A8+)" / "64–70 HP (A0–A7)" — never an unlabeled column. */
export function hpText(d: Dossier, ascension: number): string | undefined {
  const span = hpSpan(d, ascension);
  if (!span) return undefined;
  const value = span.lo === span.hi ? `${span.lo}` : `${span.lo}–${span.hi}`;
  if (!span.columnMatters) return `${value} HP`;
  return `${value} HP (${ascension >= ASC_HP_LEVEL ? `A${ASC_HP_LEVEL}+` : `A0–A${ASC_HP_LEVEL - 1}`})`;
}

/** Small-caps line: "Act 2 · Elite · 108 HP". */
export function enemyMeta(d: Dossier, ascension: number): string | undefined {
  const bits: string[] = [];
  const act = d.members.find((m) => m.act)?.act;
  if (act) bits.push(`Act ${act}`);
  if (d.type) bits.push(d.type);
  const hp = hpText(d, ascension);
  if (hp) bits.push(hp);
  const roster = d.members.filter((m) => m.hp).length;
  if (d.isGroup && roster > 1) bits.push(`roster of ${roster}`);
  return bits.length ? bits.join(' · ') : undefined;
}

/**
 * Tip body: the whole intent table for a single monster with a short one, and
 * the headline threat otherwise. One line per fact — the tip renders them
 * pre-line so the table stays a table.
 */
export function enemyTipLines(d: Dossier): string[] {
  const lines: string[] = [];
  const single = d.isGroup ? undefined : d.members[0];
  if (single?.startsWith) lines.push(`Starts with ${single.startsWith}.`);
  const intents = single?.intents ?? [];
  if (intents.length > 0 && intents.length <= MAX_TIP_INTENTS) {
    for (const intent of intents) lines.push(`${intent.name} — ${intent.text}`);
    return lines;
  }
  if (d.isGroup) {
    const roster = d.members.filter((m) => m.hp).map((m) => m.name);
    if (roster.length) lines.push(`Roster: ${roster.join(', ')}.`);
  }
  const hit = biggestHit(d);
  if (hit) lines.push(`Hardest hit — ${hit.name}: ${hit.text}`);
  const debuffs = debuffsApplied(d);
  if (debuffs.length) lines.push(`Applies ${debuffs.join(', ')}.`);
  return lines;
}

export default function EnemyName({ id, ascension = 0 }: EnemyNameProps) {
  const d = dossier(id, ascension);
  const lines = d ? enemyTipLines(d) : [];
  return (
    <ArtName
      className="artName enemyName"
      tipClass="artTip enemyTip"
      label={displayName(id)}
      tipTitle={d && !d.isGroup ? d.name : undefined}
      src={monsterArt(id)}
      meta={d ? enemyMeta(d, ascension) : undefined}
      metaColor={enemyColor(id)}
      blurb={lines.length ? lines.join('\n') : undefined}
      color={enemyColor(id)}
    />
  );
}
