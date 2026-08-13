/**
 * Path mix + campfire split — elites/bosses/shops/rests/removals already
 * counted in computeStats, shown as per-run rates so a 30-run journal and a
 * 300-run journal read on the same scale.
 */
import { fmtInt } from '../lib/idFormat';
import type { RestChoiceCount, StatsSummary } from '../lib/types';

const REST_LABELS: Record<string, string> = {
  SMITH: 'Smith',
  HEAL: 'Heal',
  HATCH: 'Hatch',
  DIG: 'Dig',
  COOK: 'Cook',
  LIFT: 'Lift',
  CLONE: 'Clone',
};

function restLabel(choice: string): string {
  return REST_LABELS[choice] ?? choice.charAt(0) + choice.slice(1).toLowerCase();
}

function perRun(n: number, runs: number): string {
  if (runs <= 0) return '—';
  const v = n / runs;
  return v >= 10 ? v.toFixed(0) : v.toFixed(1);
}

interface PathBoardProps {
  stats: StatsSummary;
}

export default function PathBoard({ stats }: PathBoardProps) {
  const n = stats.totalRuns;
  const metrics: { k: string; v: string; d: string }[] = [
    { k: 'Elites', v: fmtInt(stats.eliteFights), d: `${perRun(stats.eliteFights, n)} / run` },
    { k: 'Bosses', v: fmtInt(stats.bossFights), d: `${perRun(stats.bossFights, n)} / run` },
    { k: 'Shops', v: fmtInt(stats.shopVisits), d: `${perRun(stats.shopVisits, n)} / run` },
    { k: 'Campfires', v: fmtInt(stats.restSiteVisits), d: `${perRun(stats.restSiteVisits, n)} / run` },
    { k: 'Removed', v: fmtInt(stats.cardsRemoved), d: `${fmtInt(stats.cardsUpgraded)} upgraded` },
    { k: 'Potions', v: fmtInt(stats.potionsUsed), d: `${perRun(stats.potionsUsed, n)} used / run` },
  ];

  const restTotal = stats.restChoices.reduce((a, r) => a + r.count, 0);
  const maxRest = Math.max(1, ...stats.restChoices.map((r) => r.count));

  return (
    <>
      <section>
        <h2 className="sectionTitle">The path</h2>
        <div className="pathMix">
          {metrics.map((m) => (
            <div className="pathCell" key={m.k}>
              <div className="k">{m.k}</div>
              <div className="v num">{m.v}</div>
              <div className="d">{m.d}</div>
            </div>
          ))}
        </div>
      </section>
      {restTotal > 0 && (
        <section>
          <h2 className="sectionTitle">Campfires</h2>
          {stats.restChoices.map((r) => (
            <RestRow key={r.choice} row={r} max={maxRest} total={restTotal} />
          ))}
        </section>
      )}
    </>
  );
}

function RestRow({ row, max, total }: { row: RestChoiceCount; max: number; total: number }) {
  const pct = Math.round((100 * row.count) / total);
  return (
    <div className="cbar restBar">
      <span className="nm">{restLabel(row.choice)}</span>
      <div className="tr" aria-hidden="true">
        <div className="fl restFill" style={{ width: `${Math.min(100, (row.count / max) * 82).toFixed(1)}%` }} />
      </div>
      <span className="vl num">
        {fmtInt(row.count)} <span>{pct}%</span>
      </span>
    </div>
  );
}
