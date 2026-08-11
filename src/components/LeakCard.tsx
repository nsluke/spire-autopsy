/**
 * One leak evidence card (Mockup C): severity chip in --loss, sans title,
 * optional ratio badge top-right, Warm Coach body, dumbbell chart, dashed
 * ember drill box, and a receipts drawer holding mono evidence lines, links
 * to run autopsies, the confound note, and the "demote" veto button.
 */
import { useState } from 'react';
import type { LeakResult } from '../lib/types';
import Dumbbell from './Dumbbell';
import '../styles/coach.css';

interface LeakCardProps {
  leak: LeakResult;
  /** 1-based rank shown in the severity chip ("Leak 1"). */
  rank: number;
  defaultOpen?: boolean;
  onDemote: (id: string) => void;
}

export default function LeakCard({ leak, rank, defaultOpen = false, onDemote }: LeakCardProps) {
  // Mirror the user's toggles in state so parent re-renders (e.g. demoting a
  // different card) never force the drawer back to its initial position.
  const [open, setOpen] = useState(defaultOpen);

  return (
    <article className="leakCard">
      <div className="leakHead">
        <span className="leakSev">Leak {rank}</span>
        <h3 className="leakTitle">{leak.title}</h3>
        {leak.ratioBadge && <span className="leakRatio num">{leak.ratioBadge}</span>}
      </div>
      <div className="leakBody">
        <p className="leakText">{leak.body}</p>
        {leak.dumbbell && <Dumbbell stat={leak.dumbbell} />}
        {leak.drill && (
          <div className="leakDrill">
            <b>{leak.drill.title}</b>
            <span>{leak.drill.body}</span>
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
          {leak.runReceipts.map((r) => (
            <a className="receiptLine runReceipt num" key={r.runId} href={`#/autopsy/${r.runId}`}>
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
