/**
 * One leak evidence card: severity chip, title, optional ratio badge, coach
 * body, dumbbell chart, behavior-trend sparkline, the DRILL box (available /
 * active-with-grades / blocked / complete), and the receipts drawer.
 *
 * Drill grading is fully automatic: verdict chips come from re-parsed runs,
 * never self-reporting. One drill can be active app-wide — when another
 * leak's drill is running, this card's drill offer is dimmed.
 */
import { useState } from 'react';
import type { DrillProgress } from '../lib/drills';
import type { LeakResult } from '../lib/types';
import Dumbbell from './Dumbbell';
import TrendSpark from './TrendSpark';
import '../styles/coach.css';

export type DrillSlot =
  | { kind: 'available' }
  | { kind: 'blocked'; activeTitle: string }
  | { kind: 'active'; progress: DrillProgress }
  | { kind: 'none' };

interface LeakCardProps {
  leak: LeakResult;
  /** 1-based rank shown in the severity chip ("Leak 1"). */
  rank: number;
  defaultOpen?: boolean;
  onDemote: (id: string) => void;
  drillSlot: DrillSlot;
  trend?: { startTime: number; rate: number }[];
  drillAcceptedAt?: number;
  onStartDrill: (leakId: string) => void;
  onClearDrill: () => void;
}

const VERDICT_GLYPH = { pass: '✓', fail: '✗', na: '—' } as const;

export default function LeakCard({
  leak,
  rank,
  defaultOpen = false,
  onDemote,
  drillSlot,
  trend,
  drillAcceptedAt,
  onStartDrill,
  onClearDrill,
}: LeakCardProps) {
  // Mirror the user's toggles in state so parent re-renders (e.g. demoting a
  // different card) never force the drawer back to its initial position.
  const [open, setOpen] = useState(defaultOpen);

  const active = drillSlot.kind === 'active' ? drillSlot.progress : undefined;

  return (
    <article className="leakCard">
      <div className="leakHead">
        <span className="leakSev">Leak {rank}</span>
        <h3 className="leakTitle">{leak.title}</h3>
        {active && (
          <span className="drillLive num" title="Drill in progress">
            drill {active.passes + active.fails}/{active.drill.targetRuns}
          </span>
        )}
        {leak.ratioBadge && <span className="leakRatio num">{leak.ratioBadge}</span>}
      </div>
      <div className="leakBody">
        <p className="leakText">{leak.body}</p>
        {leak.dumbbell && <Dumbbell stat={leak.dumbbell} />}
        {trend && trend.length > 1 && (
          <TrendSpark trend={trend} markAt={drillAcceptedAt} label="your rate, rolling 10 runs" />
        )}

        {leak.drill && drillSlot.kind === 'available' && (
          <div className="leakDrill">
            <b>{leak.drill.title}</b>
            <span>{leak.drill.body}</span>
            <button type="button" className="drillBtn" onClick={() => onStartDrill(leak.id)}>
              Start drill
            </button>
          </div>
        )}
        {leak.drill && drillSlot.kind === 'blocked' && (
          <div className="leakDrill drillBlocked">
            <b>{leak.drill.title}</b>
            <span>
              {leak.drill.body}{' '}
              <em className="blockedNote">One drill at a time — finish “{drillSlot.activeTitle}”.</em>
            </span>
          </div>
        )}
        {active && (
          <div className={active.complete ? 'leakDrill drillActive drillComplete' : 'leakDrill drillActive'}>
            <b>{active.complete ? 'Drill complete' : 'Drill in progress'}</b>
            <div className="drillGrades">
              {active.graded.length === 0 && <span className="drillWaiting">Graded automatically as new runs sync.</span>}
              {active.graded.map((g) => (
                <a
                  key={g.runId}
                  className={`gradeChip grade-${g.verdict} num`}
                  href={`#/autopsy/${g.runId}`}
                  title={g.note}
                >
                  <i>{VERDICT_GLYPH[g.verdict]}</i> {g.label}
                </a>
              ))}
              {!active.complete &&
                Array.from({ length: Math.max(0, active.drill.targetRuns - active.passes - active.fails) }, (_, i) => (
                  <span key={`slot${i}`} className="gradeChip gradeEmpty" aria-hidden="true">
                    ·
                  </span>
                ))}
            </div>
            <div className="drillMetaRow">
              <span className="num">
                {active.passes}/{active.drill.targetRuns} compliant
                {active.complete &&
                  active.passes >= 4 &&
                  (trend && trend.length > 1
                    ? ' — habit landed. Check the trend line above.'
                    : ' — habit landed.')}
              </span>
              <button type="button" className="drillBtn quiet" onClick={onClearDrill}>
                {active.complete ? 'Clear' : 'Abandon'}
              </button>
            </div>
          </div>
        )}
      </div>
      <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
        <summary>Receipts</summary>
        <div className="leakReceipts">
          {leak.receiptLines.map((line, i) => (
            <div className="receiptLine num" key={i}>
              {line}
            </div>
          ))}
          {leak.runReceipts.map((r, i) => (
            // key includes the index: one run can appear twice (e.g. two flagged
            // heals in the same run's receipts)
            <a className="receiptLine runReceipt num" key={`${r.runId}-${i}`} href={`#/autopsy/${r.runId}`}>
              {r.label} <span className="openCue">· open autopsy →</span>
            </a>
          ))}
          {leak.confoundNote && <p className="confoundNote">{leak.confoundNote}</p>}
          <div className="demoteRow">
            <span className="strengthTag">evidence: {leak.strength}</span>
            <button type="button" className="demoteBtn" onClick={() => onDemote(leak.id)}>
              This is deliberate — demote
            </button>
          </div>
        </div>
      </details>
    </article>
  );
}
