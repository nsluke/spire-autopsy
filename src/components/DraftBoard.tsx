/**
 * Most-drafted cards (starters omitted) and the ascension record.
 * Win rates here are descriptive — the climb itself lives on the Coach.
 */
import { fmtInt } from '../lib/idFormat';
import type { AscensionRecord, PickCount } from '../lib/types';
import CardName from './CardName';

interface DraftBoardProps {
  topPicks: PickCount[];
  byAscension: AscensionRecord[];
}

export default function DraftBoard({ topPicks, byAscension }: DraftBoardProps) {
  const maxPicks = Math.max(1, ...topPicks.map((p) => p.picks));
  const maxRate = Math.max(1, ...byAscension.map((a) => a.winRatePct));

  return (
    <>
      {topPicks.length > 0 && (
        <section>
          <h2 className="sectionTitle">Most drafted</h2>
          {topPicks.map((p) => (
            <div className="cbar" key={p.id}>
              <span className="nm draftNm">
                <CardName id={p.id} />
              </span>
              <div className="tr" aria-hidden="true">
                <div className="fl draftFill" style={{ width: `${Math.min(100, (p.picks / maxPicks) * 82).toFixed(1)}%` }} />
              </div>
              <span className="vl num">
                {fmtInt(p.picks)} <span>picks</span>
              </span>
            </div>
          ))}
        </section>
      )}
      {byAscension.length > 0 && (
        <section>
          <h2 className="sectionTitle">By ascension</h2>
          {byAscension.map((a) => (
            <div className="cbar" key={a.ascension}>
              <span className="nm">A{a.ascension}</span>
              <div className="tr" aria-hidden="true">
                <div
                  className="fl"
                  style={{
                    width: `${Math.min(100, (a.winRatePct / maxRate) * 82).toFixed(1)}%`,
                    background: 'var(--ember)',
                  }}
                />
              </div>
              <span className="vl num">
                {a.winRatePct.toFixed(1)}%{' '}
                <span>
                  {a.wins}/{a.runs}
                </span>
              </span>
            </div>
          ))}
        </section>
      )}
    </>
  );
}
