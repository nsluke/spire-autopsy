/**
 * Autopsy view — one run, dissected. A picker of recent deaths, the run header,
 * the HP trajectory chart, and the coach's narrative read with links into the
 * aggregate leaks it exhibits.
 *
 * Run selection: the runId prop when it matches an imported run, else the most
 * recent non-abandoned loss, else the most recent run.
 */
import { useMemo, useState } from 'react';
import ArtImg from '../components/ArtImg';
import HpTrajectory from '../components/HpTrajectory';
import { monsterArt } from '../lib/art';
import { buildAutopsy } from '../lib/autopsy';
import { characterName, displayName, formatDuration, shortDate } from '../lib/idFormat';
import { detectLeaks } from '../lib/leaks';
import type { LeakResult, NormalizedRun } from '../lib/types';
import '../styles/autopsy.css';

interface Props {
  runs: NormalizedRun[];
  runId?: string;
}

/** Report strings may carry raw game ids or pre-formatted names; prettify only ids. */
function pretty(s: string): string {
  return s.includes('.') ? displayName(s) : s;
}

export default function Autopsy({ runs, runId }: Props) {
  const newestFirst = useMemo(() => [...runs].sort((a, b) => b.startTime - a.startTime), [runs]);
  // Two-way link between the coach's read and the chart: hovering a beat rings
  // its floors on the trajectory; hovering the chart lights up the beats that
  // mention that floor.
  const [beatFloors, setBeatFloors] = useState<number[] | null>(null);
  const [chartFloor, setChartFloor] = useState<number | null>(null);

  const selected =
    (runId ? runs.find((r) => r.id === runId) : undefined) ??
    newestFirst.find((r) => !r.win && !r.abandoned) ??
    newestFirst[0];

  const leaks = useMemo(() => detectLeaks(runs), [runs]);
  const report = useMemo(
    () => (selected ? buildAutopsy(selected, runs, leaks) : undefined),
    [selected, runs, leaks],
  );

  // Picker: walk back from the most recent completed run until ~10 deaths are
  // collected; wins met along the way are listed too (marked with a ✓).
  const pickerRuns = useMemo(() => {
    const out: NormalizedRun[] = [];
    let deaths = 0;
    for (const r of newestFirst) {
      if (r.abandoned) continue;
      out.push(r);
      if (!r.win) deaths += 1;
      if (deaths >= 10 || out.length >= 14) break;
    }
    if (selected && !out.some((r) => r.id === selected.id)) out.push(selected);
    return out;
  }, [newestFirst, selected]);

  const linkedLeaks = useMemo(() => {
    if (!report) return [] as LeakResult[];
    return report.linkedLeakIds
      .map((id) => leaks.find((l) => l.id === id))
      .filter((l): l is LeakResult => l !== undefined);
  }, [report, leaks]);

  if (!selected || !report) {
    return <p className="autopsyEmpty">No runs on the table yet — import some and the first autopsy begins.</p>;
  }

  return (
    <div className="autopsy">
      <nav className="runPicker" aria-label="Recent runs to autopsy">
        {pickerRuns.map((r) => (
          <a
            key={r.id}
            href={`#/autopsy/${r.id}`}
            className={r.id === selected.id ? 'pill runPill on' : 'pill runPill'}
            aria-current={r.id === selected.id ? 'page' : undefined}
          >
            {r.win ? <span className="runPillWin">✓ </span> : null}
            {shortDate(r.startTime)} · {characterName(r.player.character)} A{r.ascension}
          </a>
        ))}
      </nav>

      <header className="autopsyHead">
        <div>
          <h1 className="autopsyTitle">
            {characterName(report.character)} · Ascension <span className="num">{report.ascension}</span> ·{' '}
            {report.win ? (
              <span className="autopsyWin">VICTORY</span>
            ) : report.killedBy ? (
              <span className="autopsyLoss">slain by {pretty(report.killedBy)}</span>
            ) : (
              <span className="autopsyEnd">{selected.abandoned ? 'run abandoned' : 'run ended'}</span>
            )}
          </h1>
          <p className="autopsySub num">
            {[
              `${report.floors} floors`,
              report.actNames.length > 0 ? report.actNames.map(pretty).join(' → ') : undefined,
              formatDuration(report.durationMinutes * 60),
              report.seed ? `seed ${report.seed}` : undefined,
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
        <div className="autopsyHeadRight">
          {!report.win && <ArtImg src={monsterArt(selected.killedByEncounter)} className="killerArt" />}
          <span className="pill num">{report.runId}.run</span>
        </div>
      </header>

      <section className="panel trajPanel">
        <HpTrajectory report={report} highlightFloors={beatFloors ?? undefined} onFloorHover={setChartFloor} />
      </section>

      {(report.narrative.length > 0 || linkedLeaks.length > 0) && (
        <section className="panel coachRead">
          <h2 className="sectionTitle">The coach's read</h2>
          <ul className="beatList">
            {report.narrative.map((beat, i) => {
              const anchored = beat.floors.length > 0;
              const lit = chartFloor !== null && beat.floors.includes(chartFloor);
              return (
                <li
                  key={i}
                  className={['beat', anchored ? 'beatAnchored' : '', lit ? 'beatLit' : ''].filter(Boolean).join(' ')}
                  tabIndex={anchored ? 0 : undefined}
                  onMouseEnter={anchored ? () => setBeatFloors(beat.floors) : undefined}
                  onMouseLeave={anchored ? () => setBeatFloors(null) : undefined}
                  onFocus={anchored ? () => setBeatFloors(beat.floors) : undefined}
                  onBlur={anchored ? () => setBeatFloors(null) : undefined}
                >
                  <span className="beatText">{beat.text}</span>
                  {anchored && (
                    <span className="beatFloors num" aria-label={`floors ${beat.floors.join(', ')}`}>
                      {beat.floors.map((f) => `fl ${f}`).join(' · ')} ↗
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {linkedLeaks.length > 0 && (
            <p className="patternLinks">
              Pattern links:{' '}
              {linkedLeaks.map((l, i) => (
                <span key={l.id}>
                  {i > 0 ? ' · ' : ''}
                  <a href="#/coach">{l.title}</a>
                </span>
              ))}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
