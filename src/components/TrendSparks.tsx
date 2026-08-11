/**
 * "The climb, quarter by quarter": two SEPARATE small line charts side by
 * side — win rate and average ascension — never a dual-axis chart.
 * The "read together" line appears only when the data earns it: ascension
 * trending up while win rate trends down.
 */
import type { TrendPoint } from '../lib/types';

const W = 180;
const H = 72;
const X0 = 6;
const X1 = 174;
const Y_TOP = 8;
const Y_BOT = 48;

/** Map a series onto polyline points inside the fixed viewBox. */
function toPoints(values: number[]): { pts: string; lastX: number; lastY: number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = values.length > 1 ? (X1 - X0) / (values.length - 1) : 0;
  const coords = values.map((v, i) => {
    const x = X0 + i * step;
    const y = Y_BOT - ((v - min) / span) * (Y_BOT - Y_TOP);
    return [x.toFixed(1), y.toFixed(1)];
  });
  const last = coords[coords.length - 1];
  return { pts: coords.map((c) => c.join(',')).join(' '), lastX: +last[0], lastY: +last[1] };
}

function Spark({ values, color, ariaLabel, caption, captionEnd }: {
  values: number[];
  color: string;
  ariaLabel: string;
  caption: string;
  captionEnd: string;
}) {
  const { pts, lastX, lastY } = toPoints(values);
  return (
    <div className="spark">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel}>
        <polyline points={pts} fill="none" stroke={color} strokeWidth="2" />
        <circle cx={lastX} cy={lastY} r="3.5" fill={color} />
        <text x={X0} y="66" fill="var(--muted)" fontSize="9">
          {caption} <tspan fill="var(--ink)">{captionEnd}</tspan>
        </text>
      </svg>
    </div>
  );
}

interface TrendSparksProps {
  quarters: TrendPoint[];
}

export default function TrendSparks({ quarters }: TrendSparksProps) {
  if (quarters.length < 2) return null;

  const first = quarters[0];
  const last = quarters[quarters.length - 1];
  const runCounts = quarters.map((q) => q.runs).join(', ');

  const winRates = quarters.map((q) => q.winRatePct);
  const ascensions = quarters.map((q) => q.avgAscension);

  const ascDelta = +(last.avgAscension - first.avgAscension).toFixed(1);
  const rateDelta = Math.round(first.winRatePct - last.winRatePct);
  const climbing = ascDelta > 0 && last.winRatePct < first.winRatePct;

  return (
    <section>
      <h2 className="sectionTitle">The climb, quarter by quarter</h2>
      <div className="sparkRow">
        <Spark
          values={winRates}
          color="var(--win)"
          ariaLabel={`Win rate by quarter: ${winRates.map((v) => v.toFixed(1)).join(', ')} percent, over ${runCounts} runs`}
          caption={`win rate ${first.winRatePct.toFixed(1)}% →`}
          captionEnd={`${last.winRatePct.toFixed(1)}%`}
        />
        <Spark
          values={ascensions}
          color="var(--ember)"
          ariaLabel={`Average ascension by quarter: ${ascensions.map((v) => v.toFixed(1)).join(', ')}, over ${runCounts} runs`}
          caption={`avg ascension A${first.avgAscension.toFixed(1)} →`}
          captionEnd={`A${last.avgAscension.toFixed(1)}`}
        />
      </div>
      {climbing && (
        <p className="readTogether">
          Read together: <strong>you&rsquo;re not getting worse — you&rsquo;re climbing.</strong> Difficulty rose{' '}
          {ascDelta} {ascDelta === 1 ? 'level' : 'levels'} while win rate fell {rateDelta}{' '}
          {rateDelta === 1 ? 'point' : 'points'}.
        </p>
      )}
    </section>
  );
}
