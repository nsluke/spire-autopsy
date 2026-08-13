/**
 * Opt-in anonymous snapshot. Default is still nothing leaving the machine.
 * Sending is a click, never an import side-effect.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  SNAPSHOT_EXCLUDES,
  SNAPSHOT_INCLUDES,
  buildContribution,
  contributableRuns,
  ingestConfigured,
  lastContributionAt,
  snapshotJson,
  submitContribution,
} from '../lib/contribute';
import type { NormalizedRun } from '../lib/types';
import '../styles/contribute.css';

type Status = 'idle' | 'sending' | 'sent' | 'error';

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function ContributePanel({
  runs,
  variant,
}: {
  runs: NormalizedRun[];
  variant: 'row' | 'panel';
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  const [lastSent, setLastSent] = useState<string | undefined>(undefined);

  const mine = useMemo(() => contributableRuns(runs), [runs]);
  const snapshot = useMemo(() => buildContribution(runs), [runs]);
  const canSend = ingestConfigured() && snapshot !== null;

  useEffect(() => {
    let alive = true;
    void lastContributionAt().then((v) => {
      if (alive) setLastSent(v);
    });
    return () => {
      alive = false;
    };
  }, []);

  function copySnapshot() {
    if (!snapshot) return;
    const text = snapshotJson(snapshot);
    void navigator.clipboard.writeText(text).catch(() => {
      const blob = new Blob([text], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'spire-autopsy-snapshot.json';
      a.click();
      URL.revokeObjectURL(url);
    });
  }

  async function send() {
    if (!snapshot) return;
    setStatus('sending');
    setError('');
    const result = await submitContribution(runs);
    if (result.ok) {
      setStatus('sent');
      setLastSent(new Date().toISOString());
      return;
    }
    setStatus('error');
    if (result.reason === 'no-endpoint') {
      setError('This build has no drop-off — copy the snapshot instead.');
    } else if (result.reason === 'empty') {
      setError('Nothing to send — bundled sample runs are not shared.');
    } else if (result.reason === 'rejected') {
      setError('The drop-off declined the snapshot.');
    } else {
      setError('Could not reach the drop-off. Copy the snapshot if you still want to share.');
    }
  }

  if (mine.length === 0) {
    return (
      <section className={variant === 'panel' ? 'panel contribute contributePanel' : 'contribute contributeRow'}>
        <span className="contributeLabel">Anonymous snapshot</span>
        <p className="contributeHint">
          Bundled sample runs stay here. Import your own history if you want to help the coach get smarter.
        </p>
      </section>
    );
  }

  return (
    <section className={variant === 'panel' ? 'panel contribute contributePanel' : 'contribute contributeRow'}>
      <div className="contributeHead">
        <span className="contributeLabel">Anonymous snapshot</span>
        {lastSent && status !== 'sent' && (
          <span className="contributeMeta">last sent {formatWhen(lastSent)}</span>
        )}
      </div>
      <p className="contributeLead">
        One click, one POST, never automatic. Counts and which checks fired — not your run files.
      </p>
      <div className="contributeActions">
        <button type="button" className="pill" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide what is sent' : 'What is sent'}
        </button>
        <button type="button" className="pill" onClick={copySnapshot}>
          Copy JSON
        </button>
        <button
          type="button"
          className="pill contributeSend"
          disabled={!canSend || status === 'sending'}
          onClick={() => void send()}
        >
          {status === 'sending' ? 'Sending…' : status === 'sent' ? 'Share again' : 'Share anonymously'}
        </button>
      </div>
      {!ingestConfigured() && (
        <p className="contributeHint">
          This build has no drop-off URL, so nothing can leave the browser. Copy JSON if you want to send a snapshot
          yourself.
        </p>
      )}
      {status === 'error' && <p className="contributeError">{error}</p>}
      {status === 'sent' && <p className="contributeHint">Sent — thank you. That snapshot had no run files in it.</p>}
      {open && snapshot && (
        <div className="contributePreview">
          <p className="contributePreviewK">Leaves this browser</p>
          <ul>
            {SNAPSHOT_INCLUDES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="contributePreviewK">Never included</p>
          <ul>
            {SNAPSHOT_EXCLUDES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="contributeHint">
            {snapshot.corpus.runCount} of your runs in this snapshot
            {runs.length - mine.length > 0 ? ` · ${runs.length - mine.length} bundled samples omitted` : ''}
          </p>
        </div>
      )}
    </section>
  );
}
