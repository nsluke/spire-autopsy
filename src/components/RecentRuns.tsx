/**
 * Latest-runs strip: a chronological row of ticks (oldest left) linking
 * through to each run's autopsy. Fill is the character they played; a parchment
 * check marks a win so outcome isn't carried by color alone. Hovering a tick
 * opens a summary card (portaled so the strip cannot clip it).
 */
import { useCallback, useId, useState, type FocusEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { characterArt, monsterArt } from '../lib/art';
import { characterColor, characterName, displayName, formatDuration, shortDate } from '../lib/idFormat';
import type { NormalizedRun } from '../lib/types';
import ArtImg from './ArtImg';

const SHOW = 16;

interface RecentRunsProps {
  runs: NormalizedRun[];
}

export default function RecentRuns({ runs }: RecentRunsProps) {
  const latest = runs.filter((r) => !r.abandoned || r.nodes.length > 0).slice(-SHOW);
  if (latest.length < 3) return null;

  return (
    <section>
      <h2 className="sectionTitle withPill">
        Latest runs <span className="pill">{latest.length === SHOW ? `last ${SHOW}` : `${latest.length} runs`}</span>
      </h2>
      <div className="recent" role="list">
        {latest.map((r) => (
          <RunTick key={r.id} run={r} />
        ))}
      </div>
    </section>
  );
}

function RunTick({ run }: { run: NormalizedRun }) {
  const outcome = run.win ? 'win' : run.abandoned ? 'abandoned' : 'loss';
  const who = characterName(run.player.character);
  const label = `${shortDate(run.startTime)} · ${who} A${run.ascension} · ${outcome}`;
  const tipId = useId();
  const [anchor, setAnchor] = useState<{ x: number; y: number; below: boolean } | null>(null);

  const show = useCallback((el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    setAnchor({
      x: r.left + r.width / 2,
      y: r.top,
      below: r.top < 180,
    });
  }, []);

  function onEnter(e: MouseEvent<HTMLAnchorElement> | FocusEvent<HTMLAnchorElement>) {
    show(e.currentTarget);
  }

  return (
    <>
      <a
        role="listitem"
        className={`recentTick ${outcome}`}
        href={`#/autopsy/${run.id}`}
        aria-label={label}
        aria-describedby={anchor ? tipId : undefined}
        style={{ background: characterColor(run.player.character) }}
        onMouseEnter={onEnter}
        onMouseLeave={() => setAnchor(null)}
        onFocus={onEnter}
        onBlur={() => setAnchor(null)}
      >
        {run.win && <span className="recentMark" aria-hidden="true" />}
      </a>
      {anchor &&
        createPortal(
          <RunSummaryCard id={tipId} run={run} x={anchor.x} y={anchor.y} below={anchor.below} />,
          document.body,
        )}
    </>
  );
}

function RunSummaryCard({
  id,
  run,
  x,
  y,
  below,
}: {
  id: string;
  run: NormalizedRun;
  x: number;
  y: number;
  below: boolean;
}) {
  const killerId = run.killedByEncounter ?? run.killedByEvent;
  const last = run.nodes[run.nodes.length - 1];
  return (
    <div
      id={id}
      className={below ? 'runTip below' : 'runTip'}
      style={{ left: x, top: below ? y + 24 : y }}
      role="tooltip"
    >
      <ArtImg src={characterArt(run.player.character)} className="runTipChar" />
      <div className="runTipBody">
        <div className="runTipWho" style={{ color: characterColor(run.player.character) }}>
          {characterName(run.player.character)}
        </div>
        <div className="runTipMeta num">
          A{run.ascension} · {shortDate(run.startTime)}
        </div>
        {run.win ? (
          <div className="runTipEnd win">Victory</div>
        ) : run.abandoned ? (
          <div className="runTipEnd muted">Abandoned</div>
        ) : (
          <div className="runTipEnd loss">
            {killerId ? `Slain by ${displayName(killerId)}` : 'Run ended'}
          </div>
        )}
        <div className="runTipMeta num">
          {run.nodes.length} {run.nodes.length === 1 ? 'floor' : 'floors'}
          {run.runTimeSeconds > 0 ? ` · ${formatDuration(run.runTimeSeconds)}` : ''}
          {last ? ` · ${last.stats.hp}/${last.stats.maxHp} HP` : ''}
        </div>
      </div>
      {!run.win && <ArtImg src={monsterArt(run.killedByEncounter)} className="runTipKiller" />}
    </div>
  );
}
