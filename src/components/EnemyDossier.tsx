/**
 * EnemyDossier — the reference sheet a player reads before the next attempt.
 *
 * Thesis: two things beat an enemy that keeps killing you, and neither is an
 * opinion. First, your own record against it, split by character, because a
 * fight that Defect walks through can be the fight that ends every Regent run.
 * Second, the fight's real numbers: HP at your ascension and the full intent
 * table, so the swing that kills you has a name and a number before it lands.
 * No strategy is invented here — everything on this panel is either the
 * player's own run history or the wiki's enemy table.
 *
 * Receipts and their confounders:
 *  - meetings = combat rooms whose modelId is this encounter, kills = runs that
 *    ended to it (non-abandoned losses). Same convention as the nemesis board's
 *    headline, so the per-character rows sum to the row above them, and both
 *    describe the same population: the runs currently in view.
 *  - a rate is printed only at MIN_RATED_MEETINGS+ meetings. Below that the
 *    panel prints the raw counts and says the sample is thin, rather than
 *    turning two fights into a percentage.
 *  - one run can meet an encounter several times, so a kill attaches to the
 *    run, not to a specific meeting. "That run ended here" is therefore stated
 *    at run granularity.
 *  - wiki HP has a base and an A8+ column; the panel reads the column that
 *    applies at the ascension of the player's last meeting and says so.
 *  - a group's roster is what the wiki LISTS; the game can field duplicates
 *    (Kin Follower ×2), so member HP is printed per member and never summed
 *    into a claimed fight total.
 *  - encounters the wiki does not carry resolve to nothing; the panel then
 *    shows the record alone. Styles live in styles/dashboard.css under .dash.
 */
import { useMemo } from 'react';
import { monsterArt } from '../lib/art';
import { debuffsApplied, dossier, intentDamage, type EnemyIntent } from '../lib/enemies';
import { characterColor, characterName, displayName, fmtInt, shortDate } from '../lib/idFormat';
import type { NormalizedRun } from '../lib/types';
import ArtImg from './ArtImg';
import { hpCell, hpText } from './EnemyName';

/** Below this many meetings a percentage would be theatre — print counts. */
export const MIN_RATED_MEETINGS = 10;

export interface CharacterRecord {
  character: string;
  meetings: number;
  deaths: number;
}

export interface LastMeeting {
  startTime: number;
  character: string;
  ascension: number;
  outcome: 'here' | 'win' | 'elsewhere' | 'abandoned';
}

export interface EncounterRecord {
  meetings: number;
  deaths: number;
  /** false when meetings fell back to the kill count — see encounterRecord */
  meetingsLogged: boolean;
  /** most-met character first */
  byCharacter: CharacterRecord[];
  last?: LastMeeting;
}

/**
 * The player's record against one encounter, overall and per character.
 * Mirrors computeStats: meetings count combat rooms with this modelId across
 * every run in view (wins included), kills count non-abandoned losses that
 * ended to it, and an encounter that killed without ever being logged as a
 * fight room falls back to its kill count as its denominator.
 */
export function encounterRecord(runs: NormalizedRun[], id: string): EncounterRecord {
  const byChar = new Map<string, CharacterRecord>();
  let meetings = 0;
  let deaths = 0;
  let last: LastMeeting | undefined;

  for (const run of runs) {
    let met = 0;
    for (const node of run.nodes) {
      for (const room of node.rooms) {
        if (room.monsterIds.length > 0 && room.modelId === id) met += 1;
      }
    }
    const died = !run.win && !run.abandoned && run.killedByEncounter === id ? 1 : 0;
    if (met === 0 && died === 0) continue;

    meetings += met;
    deaths += died;
    const character = run.player.character;
    const rec = byChar.get(character) ?? { character, meetings: 0, deaths: 0 };
    rec.meetings += met;
    rec.deaths += died;
    byChar.set(character, rec);

    if (!last || run.startTime > last.startTime) {
      last = {
        startTime: run.startTime,
        character,
        ascension: run.ascension,
        outcome: died ? 'here' : run.win ? 'win' : run.abandoned ? 'abandoned' : 'elsewhere',
      };
    }
  }

  // computeStats falls back to meetings = deaths when no combat room was ever
  // logged for this encounter. Mirror the count so the rows still sum to the
  // headline, but FLAG it: "12 kills in 12 meetings — 100%" is the numerator
  // wearing a denominator's label, and it is the one figure on this panel a
  // player could disprove.
  const meetingsLogged = meetings > 0;
  if (meetings === 0) meetings = deaths;
  const byCharacter = [...byChar.values()]
    .map((r) => ({ ...r, meetings: r.meetings === 0 ? r.deaths : r.meetings }))
    .sort((a, b) => b.meetings - a.meetings || b.deaths - a.deaths);

  return { meetings, deaths, meetingsLogged, byCharacter, last };
}

export function deathRatePct(deaths: number, meetings: number): number {
  return meetings > 0 ? Math.round((deaths / meetings) * 100) : 0;
}

/**
 * The ascension the fight numbers are read at: the latest run in view. That is
 * the wall the player is climbing, and the next meeting will be fought there —
 * not at whatever ascension the last meeting happened to be.
 */
export function viewerAscension(runs: NormalizedRun[]): number {
  let latest: NormalizedRun | undefined;
  for (const run of runs) if (!latest || run.startTime > latest.startTime) latest = run;
  return latest?.ascension ?? 0;
}

export interface IntentTag {
  kind: 'attack' | 'debuff' | 'block';
  label: string;
}

/**
 * Glance-level tags for one intent line. debuffsApplied() is the only parser
 * for "Applies 1 Frail, 2 Weak" lists in the app, so it is fed a one-intent
 * dossier here rather than growing a second copy of that regex.
 */
export function intentTags(intent: EnemyIntent): IntentTag[] {
  const tags: IntentTag[] = [];
  const damage = intentDamage(intent.text);
  if (damage !== undefined) {
    const hits = intent.text.match(/[x×]\s*(\d+)/i);
    tags.push({ kind: 'attack', label: hits ? `${damage} total ×${hits[1]}` : `${damage} dmg` });
  }
  for (const name of debuffsApplied({ name: intent.name, members: [{ name: intent.name, intents: [intent] }], isGroup: false })) {
    // "Hex — Applies 2 Hex" needs no chip repeating the line's own name
    if (name !== intent.name) tags.push({ kind: 'debuff', label: name });
  }
  if (/\bBlock\b/.test(intent.text)) tags.push({ kind: 'block', label: 'Block' });
  return tags;
}

/**
 * Whether two names are the same creature spelled differently — "Leaf Slime M"
 * against "Leaf Slime (M)". A plural run-file name resolving to a singular wiki
 * entry ("Infested Prisms" -> "Infested Prism") is NOT the same thing: the
 * entry's HP is one body and the encounter can field several, so the panel has
 * to say which name its numbers belong to.
 */
export function sameEntity(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  return norm(a) === norm(b);
}

function plural(n: number, word: string): string {
  return `${fmtInt(n)} ${word}${n === 1 ? '' : 's'}`;
}

const OUTCOME_TEXT: Record<LastMeeting['outcome'], string> = {
  here: 'That run ended here.',
  win: 'That run went on to win.',
  elsewhere: 'That run ended elsewhere.',
  abandoned: 'That run was abandoned later.',
};

interface EnemyDossierProps {
  id: string;
  /** the runs currently in view — the same set the board's numbers came from */
  runs: NormalizedRun[];
  /** id for the row's aria-controls */
  panelId?: string;
}

export default function EnemyDossier({ id, runs, panelId }: EnemyDossierProps) {
  const record = useMemo(() => encounterRecord(runs, id), [runs, id]);
  const ascension = useMemo(() => viewerAscension(runs), [runs]);
  const d = useMemo(() => dossier(id, ascension), [id, ascension]);

  const hp = d ? hpText(d, ascension) : undefined;
  const act = d?.members.find((m) => m.act)?.act;
  const withIntents = (d?.members ?? []).filter((m) => (m.intents?.length ?? 0) > 0);

  const listed = displayName(id);
  const wikiName = d && !d.isGroup ? d.members[0].name : undefined;
  const renamed = wikiName && !sameEntity(wikiName, listed) ? wikiName : undefined;

  return (
    <div className="dossier" id={panelId}>
      <div className="dossHead">
        <ArtImg src={monsterArt(id)} className="dossArt" />
        <div className="dossHeadText">
          <span className="dossName">{wikiName && !renamed ? wikiName : listed}</span>
          <span className="dossPills">
            {d?.type && <span className="pill">{d.type}</span>}
            {act && <span className="pill">Act {act}</span>}
            {hp && <span className="pill num">{hp}</span>}
          </span>
        </div>
      </div>
      {renamed && (
        <p className="dossFoot">
          Your run files name this fight {listed}; the numbers below are the wiki&rsquo;s entry for {renamed}, one body.
        </p>
      )}

      <div className="dossSection">
        <span className="dossTitle">Your record</span>
        <div className="dossRec">
          <span className="dossWho">All runs in view</span>
          <span className="dossCount num">
            {plural(record.deaths, 'kill')}
            {record.meetingsLogged ? ` in ${plural(record.meetings, 'meeting')}` : ' · meetings not logged'}
          </span>
          <span className="dossRate num">
            {record.meetingsLogged && record.meetings >= MIN_RATED_MEETINGS ? (
              `${deathRatePct(record.deaths, record.meetings)}%`
            ) : (
              <span className="dossThin">thin sample</span>
            )}
          </span>
        </div>
        {record.byCharacter.map((c) => (
          <div className="dossRec" key={c.character}>
            <span className="dossWho" style={{ color: characterColor(c.character) }}>
              {characterName(c.character)}
            </span>
            <span className="dossCount num">
              {plural(c.deaths, 'kill')} in {plural(c.meetings, 'meeting')}
            </span>
            <span className="dossRate num">
              {c.meetings >= MIN_RATED_MEETINGS ? (
                `${deathRatePct(c.deaths, c.meetings)}%`
              ) : (
                <span className="dossThin">thin sample</span>
              )}
            </span>
          </div>
        ))}
        {record.last && (
          <p className="dossLast num">
            Last met {shortDate(record.last.startTime)} — {characterName(record.last.character)} A
            {record.last.ascension}. {OUTCOME_TEXT[record.last.outcome]}
          </p>
        )}
      </div>

      {!d && (
        <p className="dossNone">
          The wiki carries no entry for this encounter, so this panel stops at your own record. Nothing here is guessed.
        </p>
      )}

      {d?.isGroup && (
        <div className="dossSection">
          <span className="dossTitle">Roster</span>
          <div className="dossRoster">
            {/* the wiki's gang entry carries the roster but no HP of its own — it
                is not a body in the fight, so it is not a row here */}
            {d.members
              .filter((m) => m.hp)
              .map((m) => (
                <div className="dossMemberRow" key={m.name}>
                  <span className="dossMemberName">{m.name}</span>
                  <span className="dossMemberType">{m.type ?? ''}</span>
                  <span className="dossMemberHp num">{hpCell(m, ascension)?.replace('-', '–')} HP</span>
                </div>
              ))}
          </div>
          <p className="dossFoot">The wiki lists these members; the game can field more than one of any of them.</p>
        </div>
      )}

      {withIntents.length > 0 && (
        <div className="dossSection">
          <span className="dossTitle">Intents</span>
          {withIntents.map((m) => (
            <div className="dossIntentBlock" key={m.name}>
              {d?.isGroup && (
                <span className="dossIntentOwner">
                  {m.name}
                  {m.startsWith && <span className="dossStarts"> starts with {m.startsWith}</span>}
                </span>
              )}
              {!d?.isGroup && m.startsWith && <span className="dossStarts">Starts with {m.startsWith}</span>}
              <ul className="dossIntents">
                {m.intents!.map((intent, i) => (
                  <li className="dossIntent" key={`${intent.name}-${i}`}>
                    <span className="dossIntName">{intent.name}</span>
                    <span className="dossIntTags">
                      {intentTags(intent).map((t) => (
                        <span className={`pill tag-${t.kind} num`} key={t.kind + t.label}>
                          {t.label}
                        </span>
                      ))}
                    </span>
                    <span className="dossIntText">{intent.text}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      {d && (
        <p className="dossFoot">
          HP and intents come from the wiki&rsquo;s enemy tables, read at A{ascension} — the ascension of your latest
          run in view. Meetings count combat rooms with this encounter; kills count runs that ended to it.
        </p>
      )}
    </div>
  );
}
