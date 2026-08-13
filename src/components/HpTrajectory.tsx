/**
 * HpTrajectory — the autopsy centerpiece: the run's HP% after every floor as an
 * ember line over a faint area fill, with act boundaries, the 60% boss-entry
 * guide, and every pivotal moment (spikes, boss entries, clutches, heals, the
 * death itself) marked where it happened.
 *
 * Interactive: hovering the plot shows a per-floor tooltip (room, HP, damage);
 * `highlightFloors` (driven by hovering the coach's read) rings those floors;
 * `onFloorHover` reports the hovered floor back so the narrative can light up
 * the sentences that mention it.
 *
 * Every coordinate is computed from report.trajectory / report.moments —
 * nothing here is hardcoded data.
 */
import { useCallback, useRef, useState, type PointerEvent } from 'react';
import { monsterArt } from '../lib/art';
import { displayName } from '../lib/idFormat';
import type { AutopsyMoment, AutopsyReport } from '../lib/types';

// viewBox geometry (matches the approved Mockup D)
const W = 940;
const H = 258;
const L = 46; // left axis x
const R = 924; // right edge x
const T = 18; // y of 100% HP
const B = 206; // y of 0% HP

/** Report strings may carry raw game ids or pre-formatted names; prettify only ids. */
function pretty(s: string): string {
  return s.includes('.') ? displayName(s) : s;
}

interface Pt {
  x: number;
  y: number;
  floor: number;
  act: number;
  frac: number; // hp fraction 0..1
}

interface ActSeg {
  act: number;
  labelX: number;
}

interface DotMarker {
  key: string;
  m: AutopsyMoment;
  p: Pt;
  color: string;
  r: number;
  labelX: number;
  labelY: number;
  anchor: 'start' | 'middle' | 'end';
  labelColor: string;
  text: string;
  bold: boolean;
}

interface Props {
  report: AutopsyReport;
  /** floors to ring (e.g. the ones a hovered narrative beat mentions) */
  highlightFloors?: number[];
  /** fires with the hovered floor, or null when the pointer leaves the plot */
  onFloorHover?: (floor: number | null) => void;
}

export default function HpTrajectory({ report, highlightFloors, onFloorHover }: Props) {
  const traj = report.trajectory;
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  if (traj.length === 0) {
    return (
      <p className="trajEmpty">
        This run file recorded no floor-by-floor stats, so there is no trajectory to draw.
      </p>
    );
  }

  // Tolerate either encoding of hpPct: fraction (0..1) or percent (0..100).
  const maxRaw = Math.max(...traj.map((t) => t.hpPct));
  const scale = maxRaw > 1.5 ? 100 : 1;
  const toFrac = (v: number) => Math.min(1, Math.max(0, v / scale));

  const n = traj.length;
  const xAt = (i: number) => (n > 1 ? L + (i * (R - L)) / (n - 1) : (L + R) / 2);
  const yAt = (f: number) => B - f * (B - T);

  const pts: Pt[] = traj.map((t, i) => {
    const frac = toFrac(t.hpPct);
    return { x: xAt(i), y: yAt(frac), floor: t.floor, act: t.act, frac };
  });
  const byFloor = new Map<number, Pt>(pts.map((p) => [p.floor, p]));

  const linePoints = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const areaPoints = `${pts[0].x.toFixed(1)},${B} ${linePoints} ${pts[n - 1].x.toFixed(1)},${B}`;

  // Act boundaries (midway between the last floor of one act and the first of the next).
  const boundaries: number[] = [];
  const segs: ActSeg[] = [];
  pts.forEach((p, i) => {
    if (i === 0) {
      segs.push({ act: p.act, labelX: L + 6 });
    } else if (p.act !== pts[i - 1].act) {
      const bx = (p.x + pts[i - 1].x) / 2;
      boundaries.push(bx);
      segs.push({ act: p.act, labelX: bx + 10 });
    }
  });
  const actLabel = (act: number): string => {
    const nm = report.actNames[act - 1];
    return `ACT ${act}${nm ? ` · ${pretty(nm).toUpperCase()}` : ''}`;
  };

  const y60 = yAt(0.6);

  // Moment markers. Heals render as ✚ glyphs; everything else as dots.
  const present = report.moments
    .filter((m) => byFloor.has(m.floor))
    .sort((a, b) => a.floor - b.floor);
  const heals = present.filter((m) => m.kind === 'heal');
  const dotMoments = present.filter((m) => m.kind !== 'heal');

  // Edge-aware label placement: centered in the middle of the chart, but
  // switch to end/start anchoring near the edges so long labels never spill
  // past the viewBox (SVG clips, it doesn't wrap).
  const EDGE = 110;
  const labelPlacement = (x: number): { x: number; anchor: 'start' | 'middle' | 'end' } => {
    if (x > R - EDGE) return { x: Math.min(x + 6, R), anchor: 'end' };
    if (x < L + EDGE) return { x: Math.max(x - 6, L), anchor: 'start' };
    return { x, anchor: 'middle' };
  };

  let prevLabel: { x: number; above: boolean } | undefined;
  const markers: DotMarker[] = dotMoments.map((m, idx) => {
    const p = byFloor.get(m.floor)!;
    const key = `${m.kind}-${m.floor}-${idx}`;
    if (m.kind === 'death') {
      const killer = m.label || (report.killedBy ? pretty(report.killedBy) : '');
      const rightSide = p.x > W / 2;
      return {
        key,
        m,
        p,
        color: 'var(--loss)',
        r: 6,
        labelX: rightSide ? Math.min(p.x + 10, R) : Math.max(p.x - 10, L),
        labelY: Math.min(B + 34, H - 6),
        anchor: rightSide ? 'end' : 'start',
        labelColor: 'var(--loss)',
        text: `✝ ${killer}`.trim(),
        bold: true,
      };
    }
    const clutch = m.kind === 'clutch';
    // Low point → clear air above the line; high point → label below. Flip when
    // the previous label sits on the same side too close by.
    let above = p.frac < 0.5;
    if (prevLabel && prevLabel.above === above && Math.abs(p.x - prevLabel.x) < 100) {
      above = !above;
    }
    prevLabel = { x: p.x, above };
    const placed = labelPlacement(p.x);
    return {
      key,
      m,
      p,
      color: clutch ? 'var(--win)' : 'var(--loss)',
      r: 5,
      labelX: placed.x,
      labelY: above ? Math.max(10, p.y - 12) : Math.min(H - 6, p.y + 19),
      anchor: placed.anchor,
      labelColor: clutch ? 'var(--win)' : 'var(--ink2)',
      text: m.label,
      bold: false,
    };
  });

  const endPct = Math.round(pts[n - 1].frac * 100);
  const momentSummary = present.length
    ? ` Key moments: ${present.map((m) => `floor ${m.floor} — ${m.label}`).join('; ')}.`
    : '';
  const aria = `HP percentage after each of the run's ${n} floors${
    report.win ? ', ending in victory' : `, ending at ${endPct}%`
  }.${momentSummary}`;

  const hasLossDots = markers.some((mk) => mk.m.kind !== 'clutch');
  const hasClutch = markers.some((mk) => mk.m.kind === 'clutch');

  // ---------- interaction ----------
  const handlePointerMove = (e: PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg || n === 0) return;
    const rect = svg.getBoundingClientRect();
    const xView = ((e.clientX - rect.left) / rect.width) * W;
    if (xView < L - 10 || xView > R + 10) {
      setHoverIdx(null);
      onFloorHover?.(null);
      return;
    }
    const idx = n > 1 ? Math.round(((xView - L) / (R - L)) * (n - 1)) : 0;
    const clamped = Math.min(n - 1, Math.max(0, idx));
    setHoverIdx(clamped);
    onFloorHover?.(pts[clamped].floor);
  };
  const handlePointerLeave = useCallback(() => {
    setHoverIdx(null);
    onFloorHover?.(null);
  }, [onFloorHover]);

  // Tooltip content for the hovered floor.
  const hover = hoverIdx !== null ? traj[hoverIdx] : undefined;
  const hoverPt = hoverIdx !== null ? pts[hoverIdx] : undefined;
  const tipLines: string[] = hover
    ? [
        `Floor ${hover.floor} · ${hover.roomLabel ? pretty(hover.roomLabel) : hover.mapPointType.replace('_', ' ')}`,
        `HP ${hover.hp}/${hover.maxHp} (${Math.round(toFrac(hover.hpPct) * 100)}%)`,
        ...(hover.damageTaken > 0 ? [`−${hover.damageTaken} damage`] : []),
        ...(hover.restChoice ? [`Campfire: ${hover.restChoice.toLowerCase()}`] : []),
      ]
    : [];
  const hoverArt = hover?.encounterId ? monsterArt(hover.encounterId) : undefined;
  const imgW = hoverArt ? 52 : 0;
  const tipW = Math.max(...tipLines.map((l) => l.length), 0) * 5.4 + 16 + imgW;
  const tipH = Math.max(tipLines.length * 13 + 10, hoverArt ? 62 : 0);
  const tipX = hoverPt ? (hoverPt.x + 12 + tipW > R ? hoverPt.x - 12 - tipW : hoverPt.x + 12) : 0;
  const tipY = hoverPt ? Math.max(T, Math.min(B - tipH, hoverPt.y - tipH / 2)) : 0;

  const highlightPts = (highlightFloors ?? [])
    .map((f) => byFloor.get(f))
    .filter((p): p is Pt => p !== undefined);

  return (
    <>
      <div className="trajWrap">
        <svg
          ref={svgRef}
          className="trajChart"
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={aria}
          onPointerMove={handlePointerMove}
          onPointerLeave={handlePointerLeave}
        >
          {/* axes */}
          <line x1={L} y1={T} x2={L} y2={B} stroke="var(--line)" />
          <line x1={L} y1={B} x2={R} y2={B} stroke="var(--line)" />

          {/* act boundary lines */}
          {boundaries.map((bx) => (
            <line key={`b${bx.toFixed(1)}`} x1={bx} y1={T} x2={bx} y2={B} stroke="var(--line-soft)" />
          ))}

          {/* 60% boss-entry guide */}
          <line x1={L} y1={y60} x2={R} y2={y60} stroke="var(--loss)" strokeDasharray="3 5" opacity={0.5} />
          <text x={L + 4} y={y60 - 4} fill="var(--loss)" fontSize={9} opacity={0.8}>
            60% — boss-entry line
          </text>

          {/* area fill + hp line */}
          <polygon points={areaPoints} fill="rgba(232, 163, 61, 0.07)" />
          <polyline points={linePoints} fill="none" stroke="var(--ember)" strokeWidth={2} />

          {/* axis + act labels */}
          <text x={L - 16} y={T + 3} fill="var(--faint)" fontSize={9} textAnchor="end">
            100
          </text>
          <text x={L - 16} y={B + 3} fill="var(--faint)" fontSize={9} textAnchor="end">
            0
          </text>
          {segs.map((s) => (
            <text key={`act${s.act}`} x={s.labelX} y={B + 16} fill="var(--faint)" fontSize={9}>
              {actLabel(s.act)}
            </text>
          ))}

          {/* moment markers */}
          {markers.map((mk) => (
            <g key={mk.key}>
              <circle cx={mk.p.x} cy={mk.p.y} r={mk.r} fill={mk.color} stroke="var(--ground)" strokeWidth={2}>
                {mk.m.detail ? <title>{mk.m.detail}</title> : null}
              </circle>
              <text
                x={mk.labelX}
                y={mk.labelY}
                fill={mk.labelColor}
                fontSize={mk.bold ? 10 : 9.5}
                fontWeight={mk.bold ? 600 : undefined}
                textAnchor={mk.anchor}
              >
                {mk.text}
              </text>
            </g>
          ))}

          {/* heal glyphs above the line */}
          {heals.map((m, i) => {
            const p = byFloor.get(m.floor)!;
            return (
              <text
                key={`heal-${m.floor}-${i}`}
                x={p.x}
                y={Math.max(T - 4, p.y - 8)}
                fill="var(--win)"
                fontSize={10}
                textAnchor="middle"
              >
                ✚{m.detail || m.label ? <title>{m.detail ?? m.label}</title> : null}
              </text>
            );
          })}

          {/* narrative-driven highlight rings */}
          {highlightPts.map((p) => (
            <g key={`hl-${p.floor}`} className="trajHalo">
              <line x1={p.x} y1={p.y + 8} x2={p.x} y2={B} stroke="var(--ember)" opacity={0.35} strokeDasharray="2 4" />
              <circle cx={p.x} cy={p.y} r={9} fill="none" stroke="var(--ember)" strokeWidth={2} />
              <circle cx={p.x} cy={p.y} r={3} fill="var(--ember)" />
            </g>
          ))}

          {/* hover crosshair + tooltip */}
          {hoverPt && hover && (
            <g className="trajTip" pointerEvents="none">
              <line x1={hoverPt.x} y1={T} x2={hoverPt.x} y2={B} stroke="var(--ink2)" opacity={0.25} />
              <circle cx={hoverPt.x} cy={hoverPt.y} r={4.5} fill="var(--ember)" stroke="var(--ground)" strokeWidth={1.5} />
              <rect x={tipX} y={tipY} width={tipW} height={tipH} rx={5} fill="var(--surface2)" stroke="var(--line)" />
              {hoverArt && (
                <image
                  href={hoverArt}
                  x={tipX + 6}
                  y={tipY + 6}
                  width={44}
                  height={44}
                  preserveAspectRatio="xMidYMid meet"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none';
                  }}
                />
              )}
              {tipLines.map((l, i) => (
                <text key={i} x={tipX + 8 + imgW} y={tipY + 15 + i * 13} fontSize={9.5} fill={i === 0 ? 'var(--ink)' : 'var(--ink2)'} fontWeight={i === 0 ? 600 : undefined}>
                  {l}
                </text>
              ))}
            </g>
          )}
        </svg>
      </div>
      <div className="trajLegend">
        <span>
          <i className="swatch swatchEmber" aria-hidden="true" />
          HP % after each floor
        </span>
        {hasLossDots && (
          <span>
            <i className="swatch swatchLoss" aria-hidden="true" />
            pivotal damage
          </span>
        )}
        {hasClutch && (
          <span>
            <i className="swatch swatchWin" aria-hidden="true" />
            clutch save
          </span>
        )}
        {heals.length > 0 && <span className="legendHeal">✚ campfire heal</span>}
      </div>
    </>
  );
}
