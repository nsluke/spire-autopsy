/**
 * Nemesis board: the five deadliest recurring encounters, ranked by death
 * rate, restricted to encounters met at least 10 times so every percentage
 * stands on a real sample. The act pill is computed from where each
 * encounter was actually fought (modal act across the corpus).
 */
import { monsterArt } from '../lib/art';
import { displayName, encounterTier, fmtInt } from '../lib/idFormat';
import type { KillCause, NormalizedRun } from '../lib/types';
import ArtImg from './ArtImg';

const MIN_FIGHTS = 10;
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
  const qualified = killCauses
    .filter((k) => k.timesFought >= MIN_FIGHTS)
    .sort((a, b) => b.deathRatePct - a.deathRatePct || b.deaths - a.deaths)
    .slice(0, TOP_N);

  const acts = modalActs(runs);
  const maxDeaths = Math.max(0, ...qualified.map((k) => k.deaths));

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
          if (i === 0) flourish = ' — your true nemesis';
          else if (k.deaths === maxDeaths && qualified[0].deaths !== maxDeaths) flourish = ' — your top raw killer';
          return (
            <div className="nem" key={k.encounter}>
              <ArtImg src={monsterArt(k.encounter)} className="nemArt" />
              <span className="nm">
                {displayName(k.encounter)} <span className="pill">{tierLabel}</span>
              </span>
              <span className="rate num">{k.deathRatePct}%</span>
              <span className="meta num">
                {fmtInt(k.deaths)} {k.deaths === 1 ? 'kill' : 'kills'} in {fmtInt(k.timesFought)} meetings
                {flourish}
              </span>
            </div>
          );
        })
      )}
    </section>
  );
}
