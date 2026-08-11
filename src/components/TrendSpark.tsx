/**
 * TrendSpark — a leak's behavior rate over time (rolling window), with an
 * optional vertical marker where a drill was accepted, so the payoff moment
 * — the line bending after the drill — is visible at a glance.
 */

interface TrendSparkProps {
  trend: { startTime: number; rate: number }[];
  /** unix ms of drill acceptance — draws the "drill started" marker */
  markAt?: number;
  label: string;
}

const W = 420;
const H = 54;
const PAD = 4;

export default function TrendSpark({ trend, markAt, label }: TrendSparkProps) {
  const t0 = trend[0].startTime;
  const t1 = trend[trend.length - 1].startTime;
  const span = Math.max(1, t1 - t0);
  const x = (t: number) => PAD + ((t - t0) / span) * (W - 2 * PAD);
  const y = (r: number) => H - PAD - r * (H - 2 * PAD);
  const points = trend.map((p) => `${x(p.startTime).toFixed(1)},${y(p.rate).toFixed(1)}`).join(' ');
  const last = trend[trend.length - 1];
  const first = trend[0];
  const improving = last.rate < first.rate;
  const markX = markAt !== undefined && markAt / 1000 >= t0 && markAt / 1000 <= t1 ? x(markAt / 1000) : undefined;

  return (
    <div className="trendSpark">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label}: ${Math.round(first.rate * 100)}% early, ${Math.round(last.rate * 100)}% now${
          markAt ? ', drill start marked' : ''
        }`}
      >
        {markX !== undefined && (
          <>
            <line x1={markX} y1={2} x2={markX} y2={H - 2} stroke="var(--ember)" strokeDasharray="2 3" opacity={0.7} />
            <text x={Math.min(markX + 4, W - 60)} y={9} fontSize={8} fill="var(--ember)">
              drill start
            </text>
          </>
        )}
        <polyline points={points} fill="none" stroke={improving ? 'var(--win)' : 'var(--loss)'} strokeWidth={1.8} />
        <circle cx={x(last.startTime)} cy={y(last.rate)} r={3} fill={improving ? 'var(--win)' : 'var(--loss)'} />
      </svg>
      <span className="trendLabel">
        {label} · now <b className="num">{Math.round(last.rate * 100)}%</b>
      </span>
    </div>
  );
}
