/**
 * Nemesis board: the five deadliest recurring encounters, ranked by death
 * rate, restricted to encounters met at least MIN_RATED_MEETINGS times so
 * every percentage stands on a real sample. The act pill is computed from
 * where each encounter was actually fought (modal act across the corpus).
 *
 * A row states the rate and stops there, which is where the board used to end.
 * Each row now opens a dossier — the same runs, split by character, next to
 * the fight's own numbers — because "you die here 40% of the time" is a
 * diagnosis and the intent table is what you do with it. The dossier reads the
 * runs prop, the same filtered set the killCauses came from, so the panel and
 * the row can never quote different populations.
 */
import { useState } from 'react';
import { monsterArt } from '../lib/art';
import { encounterTier, fmtInt } from '../lib/idFormat';
import type { KillCause, NormalizedRun } from '../lib/types';
import ArtImg from './ArtImg';
import { completedRuns } from '../lib/normalize';
import { nemesisId } from '../lib/leaks/nemesis';
import EnemyDossier, { MIN_RATED_MEETINGS, viewerAscension } from './EnemyDossier';
import EnemyName from './EnemyName';

const MIN_FIGHTS = MIN_RATED_MEETINGS;
const TOP_N = 5;

const TIER_LABELS: Record<ReturnType<typeof encounterTier>, string> = {
  boss: 'boss',
  elite: 'elite',
  weak: 'monster',
  normal: 'monster',
  event: 'event',
  other: 'encounter',
};

/** For each encounter id, the act it is most often fought in. */
function modalActs(runs: NormalizedRun[]): Map<string, number> {
  const counts = new Map<string, Map<number, number>>();
  for (const run of runs) {
    for (const node of run.nodes) {
      for (const room of node.rooms) {
        if (!room.modelId || room.monsterIds.length === 0) continue;
        let byAct = counts.get(room.modelId);
        if (!byAct) {
          byAct = new Map();
          counts.set(room.modelId, byAct);
        }
        byAct.set(node.act, (byAct.get(node.act) ?? 0) + 1);
      }
    }
  }
  const out = new Map<string, number>();
  for (const [id, byAct] of counts) {
    let bestAct = 0;
    let bestN = 0;
    for (const [act, n] of byAct) {
      if (n > bestN || (n === bestN && act < bestAct)) {
        bestAct = act;
        bestN = n;
      }
    }
    if (bestAct > 0) out.set(id, bestAct);
  }
  return out;
}

interface NemesisBoardProps {
  killCauses: KillCause[];
  runs: NormalizedRun[];
}

export default function NemesisBoard({ killCauses, runs }: NemesisBoardProps) {
  const [openId, setOpenId] = useState<string | null>(null);

  const qualified = killCauses
    .filter((k) => k.timesFought >= MIN_FIGHTS)
    .sort((a, b) => b.deathRatePct - a.deathRatePct || b.deaths - a.deaths)
    .slice(0, TOP_N);

  const acts = modalActs(runs);
  const maxDeaths = Math.max(0, ...qualified.map((k) => k.deaths));
  const ascension = viewerAscension(runs);
  // "Your nemesis" is the Coach's verdict, not this board's ranking. The board
  // sorts by death rate alone, so its top row can be a 1-death encounter the
  // Coach declines to name — crowning that row here would have two pages
  // calling two different enemies the same thing.
  const crowned = nemesisId(completedRuns(runs));

  return (
    <section>
      <h2 className="sectionTitle withPill">
        Nemesis board <span className="pill">by death rate · min {MIN_FIGHTS} fights</span>
      </h2>
      {qualified.length === 0 ? (
        <p className="emptyNote">
          No encounter has {MIN_FIGHTS}+ meetings yet — the nemesis board fills in as repeat fights accumulate.
        </p>
      ) : (
        qualified.map((k, i) => {
          const act = acts.get(k.encounter);
          const tierLabel = `${act ? `Act ${act} ` : ''}${TIER_LABELS[encounterTier(k.encounter)]}`;
          let flourish = '';
          if (k.encounter === crowned) flourish = ' — your true nemesis';
          else if (k.deaths === maxDeaths && qualified[0].deaths !== maxDeaths) flourish = ' — your top raw killer';
          else if (i === 0) flourish = ' — your highest death rate';
          const open = openId === k.encounter;
          const panelId = `dossier-${k.encounter.replace(/[^A-Za-z0-9]/g, '-')}`;
          return (
            <div className="nemRow" key={k.encounter}>
              <div className="nem">
                <ArtImg src={monsterArt(k.encounter)} className="nemArt" />
                <span className="nm">
                  <EnemyName id={k.encounter} ascension={ascension} /> <span className="pill">{tierLabel}</span>
                </span>
                <span className="rate num">{k.meetingsLogged ? `${k.deathRatePct}%` : '—'}</span>
                <span className="meta num">
                  {fmtInt(k.deaths)} {k.deaths === 1 ? 'kill' : 'kills'}
                  {k.meetingsLogged ? ` in ${fmtInt(k.timesFought)} meetings` : ' · meetings not logged'}
                  {flourish}
                </span>
                <button
                  type="button"
                  className={open ? 'pill nemMore on' : 'pill nemMore'}
                  aria-expanded={open}
                  aria-controls={panelId}
                  onClick={() => setOpenId(open ? null : k.encounter)}
                >
                  Dossier {open ? '▴' : '▾'}
                </button>
              </div>
              {open && <EnemyDossier id={k.encounter} runs={runs} panelId={panelId} />}
            </div>
          );
        })
      )}
    </section>
  );
}
