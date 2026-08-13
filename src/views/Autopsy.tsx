/**
 * Autopsy view — one run, dissected. A picker of recent deaths, the run header,
 * the HP trajectory chart, the coach's narrative read, and a downward
 * floor-by-floor log of what actually happened.
 *
 * Run selection: the runId prop when it matches an imported run, else the most
 * recent non-abandoned loss, else the most recent run.
 */
import { useMemo, useState } from 'react';
import ArtImg from '../components/ArtImg';
import EnemyName from '../components/EnemyName';
import FloorTimeline from '../components/FloorTimeline';
import HpTrajectory from '../components/HpTrajectory';
import RichLine from '../components/RichLine';
import { characterArt, monsterArt } from '../lib/art';
import { buildAutopsy } from '../lib/autopsy';
import { FLOOR_KIND_LABEL, floorKind, floorTitle, hpTone } from '../lib/floorLog';
import { characterColor, characterName, displayName, formatDuration, shortDate } from '../lib/idFormat';
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

function scrollToFloor(floor: number) {
  const el = document.getElementById(`autopsy-fl-${floor}`);
  if (!el) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  el.scrollIntoView({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
}

export default function Autopsy({ runs, runId }: Props) {
  const newestFirst = useMemo(() => [...runs].sort((a, b) => b.startTime - a.startTime), [runs]);
  // Two-way link between the coach's read and the chart: hovering a beat rings
  // its floors on the trajectory; hovering the chart lights up the beats that
  // mention that floor. The floor log joins the same loop.
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

  const last = selected.nodes[selected.nodes.length - 1];
  const logHighlight = beatFloors ?? (chartFloor !== null ? [chartFloor] : undefined);

  return (
    <div className="autopsy">
      <nav className="runPicker" aria-label="Recent runs to autopsy">
        {pickerRuns.map((r) => {
          const outcome = r.win ? 'win' : r.abandoned ? 'abandoned' : 'loss';
          return (
            <a
              key={r.id}
              href={`#/autopsy/${r.id}`}
              className={['pill', 'runPill', outcome, r.id === selected.id ? 'on' : ''].filter(Boolean).join(' ')}
              style={{ borderLeftColor: characterColor(r.player.character) }}
              aria-current={r.id === selected.id ? 'page' : undefined}
            >
              {r.win ? <span className="runPillWin">✓ </span> : null}
              {shortDate(r.startTime)} · {characterName(r.player.character)} A{r.ascension}
            </a>
          );
        })}
      </nav>

      <header className="autopsyHead">
        <div className="autopsyHeadMain">
          <ArtImg src={characterArt(report.character)} className="autopsyCharArt" />
          <div>
            <h1 className="autopsyTitle">
              <span style={{ color: characterColor(report.character) }}>{characterName(report.character)}</span>
              {' · '}
              Ascension <span className="num">{report.ascension}</span>
              {' · '}
              {report.win ? (
                <span className="autopsyWin">VICTORY</span>
              ) : report.killedBy ? (
                <span className="autopsyLoss">
                  slain by{' '}
                  {selected.killedByEncounter || selected.killedByEvent ? (
                    <EnemyName id={(selected.killedByEncounter ?? selected.killedByEvent)!} />
                  ) : (
                    pretty(report.killedBy)
                  )}
                </span>
              ) : (
                <span className="autopsyEnd">{selected.abandoned ? 'run abandoned' : 'run ended'}</span>
              )}
            </h1>
            <p className="autopsySub">
              <span className="num">{report.floors} floors</span>
              {report.actNames.length > 0 && (
                <>
                  <span className="subSep"> · </span>
                  {report.actNames.map((a, i) => (
                    <span key={a}>
                      {i > 0 ? ' → ' : ''}
                      <span className="actName">{pretty(a)}</span>
                    </span>
                  ))}
                </>
              )}
              <span className="subSep"> · </span>
              <span className="num">{formatDuration(report.durationMinutes * 60)}</span>
              {last && (
                <>
                  <span className="subSep"> · </span>
                  <span className={`num hp-${hpTone(last.stats.hp, last.stats.maxHp)}`}>
                    {last.stats.hp}/{last.stats.maxHp} HP
                  </span>
                </>
              )}
              {report.seed ? (
                <>
                  <span className="subSep"> · </span>
                  <span className="num">seed {report.seed}</span>
                </>
              ) : null}
            </p>
            {selected.nodes.length > 0 && (
              <div className="runSpine" role="list" aria-label="Path of this run">
                {selected.nodes.map((n) => {
                  const kind = floorKind(n);
                  const on = (beatFloors?.includes(n.floor) ?? false) || chartFloor === n.floor;
                  return (
                    <button
                      key={n.floor}
                      type="button"
                      role="listitem"
                      className={`spineTick kind-${kind}${on ? ' on' : ''}`}
                      title={`Floor ${n.floor} · ${FLOOR_KIND_LABEL[kind]} · ${floorTitle(n)}`}
                      aria-label={`Floor ${n.floor}, ${FLOOR_KIND_LABEL[kind]}, ${floorTitle(n)}`}
                      onMouseEnter={() => setChartFloor(n.floor)}
                      onMouseLeave={() => setChartFloor(null)}
                      onFocus={() => setChartFloor(n.floor)}
                      onBlur={() => setChartFloor(null)}
                      onClick={() => scrollToFloor(n.floor)}
                    />
                  );
                })}
              </div>
            )}
          </div>
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
                  onClick={anchored ? () => scrollToFloor(beat.floors[0]) : undefined}
                >
                  <span className="beatText">
                    <RichLine text={beat.text} enemyIds={beat.enemyIds} />
                  </span>
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

      <FloorTimeline
        run={selected}
        moments={report.moments}
        highlightFloors={logHighlight}
        onFloorHover={setChartFloor}
      />
    </div>
  );
}
