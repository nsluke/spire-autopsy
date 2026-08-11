/**
 * The house chart (Mockup C): a horizontal win/loss dumbbell.
 *
 * Collision-proof labeling learned in mockup review: the win dot's mono label
 * always sits ABOVE the rail, the loss dot's always BELOW — they can never
 * touch no matter how close the values are. A gradient segment connects the
 * dots. Scale is 0..max(win, loss) * 1.25 so neither dot pins to the edge.
 * When the caller has per-sample outcomes it may pass `ticks` to render the
 * sample-size strip underneath; otherwise the sampleLabel (always shown,
 * right-aligned above the track) carries the n.
 */
import type { CSSProperties } from 'react';
import type { DumbbellStat } from '../lib/types';
import '../styles/coach.css';

function fmt(value: number, format: DumbbellStat['format']): string {
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return format === 'pct' ? `${text}%` : text;
}

/** Keep a centered label from clipping at either edge of the track. */
function tagStyle(pos: number): CSSProperties {
  if (pos <= 10) return { left: `max(0px, calc(${pos}% - 7px))` };
  if (pos >= 90) return { right: 0 };
  return { left: `${pos}%`, transform: 'translateX(-50%)' };
}

interface DumbbellProps {
  stat: DumbbellStat;
  /** Optional per-sample strip: one tick per sample, true = "hot" (a loss). */
  ticks?: boolean[];
}

export default function Dumbbell({ stat, ticks }: DumbbellProps) {
  const scaleMax = Math.max(stat.winValue, stat.lossValue) * 1.25 || 1;
  const pos = (v: number) => Math.min(100, Math.max(0, (v / scaleMax) * 100));
  const winPos = pos(stat.winValue);
  const lossPos = pos(stat.lossValue);
  const gradient =
    winPos <= lossPos
      ? 'linear-gradient(90deg, var(--win), var(--loss))'
      : 'linear-gradient(90deg, var(--loss), var(--win))';

  // Only claim win/loss-cohort semantics when the caller didn't name its own
  // cohorts — a healthy-vs-low comparison must not read as "in runs you win".
  const winTag = stat.winLabel ?? 'wins';
  const lossTag = stat.lossLabel ?? 'losses';
  const ariaWin = stat.winLabel ?? 'in runs you win';
  const ariaLoss = stat.lossLabel ?? 'in runs you lose';

  return (
    <div
      className="dumbbell"
      role="img"
      aria-label={`${stat.label} — ${ariaWin}: ${fmt(stat.winValue, stat.format)}; ${ariaLoss}: ${fmt(stat.lossValue, stat.format)}. Sample: ${stat.sampleLabel}.`}
    >
      <div className="dbLabelRow" aria-hidden="true">
        <span>{stat.label}</span>
        <span className="dbSample num">{stat.sampleLabel}</span>
      </div>
      <div className="dbTrack" aria-hidden="true">
        <div className="dbRail" />
        <div
          className="dbSeg"
          style={{
            left: `${Math.min(winPos, lossPos)}%`,
            width: `${Math.abs(winPos - lossPos)}%`,
            background: gradient,
          }}
        />
        <span className="dbDot win" style={{ left: `${winPos}%` }} />
        <span className="dbDot loss" style={{ left: `${lossPos}%` }} />
        <span className="dbTag win num" style={tagStyle(winPos)}>
          {winTag} · {fmt(stat.winValue, stat.format)}
        </span>
        <span className="dbTag loss num" style={tagStyle(lossPos)}>
          {lossTag} · {fmt(stat.lossValue, stat.format)}
        </span>
      </div>
      {ticks && ticks.length > 0 && (
        <div className="dbTicks" aria-hidden="true">
          {ticks.map((hot, i) => (
            <i key={i} className={hot ? 'hot' : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}
