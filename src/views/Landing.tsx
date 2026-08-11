/**
 * Landing / import view (Mockup A).
 *
 * First-visit: headline + dropzone + sample-data button + OS path helper +
 * three step cards + privacy line. When data already exists (#/import) the
 * same screen retitles to "Add more runs" with a back link to the dashboard.
 * Import progress is rendered from the ImportProgress stream; failures are
 * listed non-fatally.
 */
import { useEffect, useRef, useState } from 'react';
import type { ImportProgress } from '../lib/import';
import { fmtInt } from '../lib/idFormat';
import Dropzone from '../components/Dropzone';
import '../styles/landing.css';

interface LandingProps {
  onImport: (files: File[]) => Promise<void>;
  onDemo: () => Promise<void>;
  importState: ImportProgress | null;
  hasData: boolean;
}

type OsKey = 'macos' | 'windows' | 'linux';

const OS_PATHS: Record<OsKey, { label: string; path: string; note: string }> = {
  macos: {
    label: 'macOS',
    path: '~/Library/Application Support/SlayTheSpire2/steam/<your-id>/profile1/saves/history',
    note: 'confirmed on the current build',
  },
  windows: {
    label: 'Windows',
    path: '%USERPROFILE%\\AppData\\Local\\SlayTheSpire2\\steam\\<your-id>\\profile1\\saves\\history',
    note: 'early access — path may vary; tell us if yours differs',
  },
  linux: {
    label: 'Linux / Steam Deck',
    path: '~/.steam/steam/steamapps/compatdata/<app-id>/pfx/drive_c/users/steamuser/AppData/Local/SlayTheSpire2/steam/<your-id>/profile1/saves/history',
    note: 'early access — Proton prefix path may vary; tell us if yours differs',
  },
};

function detectOs(): OsKey {
  const probe = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`.toLowerCase();
  // 'mac' before 'win': "darwin" contains "win"
  if (probe.includes('mac') || probe.includes('darwin')) return 'macos';
  if (probe.includes('win')) return 'windows';
  if (probe.includes('linux') || probe.includes('x11') || probe.includes('steamdeck')) return 'linux';
  return 'macos'; // the one confirmed path
}

const PHASE_LABELS: Record<ImportProgress['phase'], string> = {
  reading: 'Reading files…',
  parsing: 'Parsing runs…',
  storing: 'Saving to this browser…',
  done: 'Import complete',
};

function ImportPanel({ p }: { p: ImportProgress }) {
  const showBar = (p.phase === 'reading' || p.phase === 'parsing') && p.total > 0;
  const pct = p.total > 0 ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <section className="panel importPanel" aria-live="polite">
      <h2 className="sectionTitle">Import</h2>
      <p className="importPhase">
        <span className="phaseLabel">{PHASE_LABELS[p.phase]}</span>
        {showBar && (
          <span className="num phaseCount">
            {fmtInt(p.done)} / {fmtInt(p.total)}
          </span>
        )}
      </p>
      {showBar && (
        <div
          className="progressTrack"
          role="progressbar"
          aria-label={PHASE_LABELS[p.phase]}
          aria-valuemin={0}
          aria-valuemax={p.total}
          aria-valuenow={p.done}
        >
          <div className="progressFill" style={{ width: `${pct}%` }} />
        </div>
      )}
      {p.phase === 'done' && (
        <ul className="importSummary">
          <li>
            <b className="num">{fmtInt(p.added)}</b> new {p.added === 1 ? 'run' : 'runs'} added
          </li>
          {p.skippedKnown > 0 && (
            <li>
              <b className="num">{fmtInt(p.skippedKnown)}</b> already imported — skipped
            </li>
          )}
          {p.added === 0 && p.skippedKnown === 0 && p.failed.length === 0 && (
            <li>no .run files found in what you dropped — check you picked the history folder itself</li>
          )}
        </ul>
      )}
      {p.failed.length > 0 && (
        <div className="failBlock">
          <p className="failIntro">
            {fmtInt(p.failed.length)} {p.failed.length === 1 ? 'file' : 'files'} couldn’t be read — everything else
            imported fine:
          </p>
          <ul className="failList">
            {p.failed.map((f) => (
              <li key={f.fileName}>
                <span className="failName">{f.fileName}</span> — {f.error}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function Landing({ onImport, onDemo, importState, hasData }: LandingProps) {
  const [os, setOs] = useState<OsKey>(() => detectOs());
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copyTimer = useRef<number | undefined>(undefined);
  const pathRef = useRef<HTMLElement>(null);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  const busy = importState !== null && importState.phase !== 'done';
  const info = OS_PATHS[os];

  /** Select the visible path text — the manual-copy fallback of last resort. */
  function selectPathText() {
    const el = pathRef.current;
    if (!el) return;
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  async function copyPath() {
    let ok = false;
    try {
      // Undefined on http:// / file:// origins and older browsers.
      await navigator.clipboard.writeText(info.path);
      ok = true;
    } catch {
      // Legacy fallback: select the visible path and copy the selection.
      try {
        selectPathText();
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
    }
    if (!ok) selectPathText(); // leave it selected so Ctrl/Cmd+C finishes the job
    setCopyState(ok ? 'copied' : 'failed');
    window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopyState('idle'), ok ? 1600 : 4000);
  }

  return (
    <div className="landing">
      <p className="landingBrand">
        <span className="landingMark">✝</span> Spire Autopsy
      </p>
      {hasData && (
        <p className="backRow">
          <a className="backLink" href="#/">
            ← Back to your dashboard
          </a>
        </p>
      )}

      <h1 className="landingTitle">{hasData ? 'Add more runs' : 'Your deaths have a paper trail.'}</h1>
      {hasData ? (
        <p className="landingSub">
          Point us at the same <span className="inlineMono">history</span> folder again — runs we’ve already read are
          skipped automatically. <strong>Nothing uploads. Ever.</strong>
        </p>
      ) : (
        <p className="landingSub">
          Slay the Spire 2 writes every run you finish to disk. Drop that folder here and get a coach’s read on why you
          lose — in your browser, on your machine. <strong>Nothing uploads. Ever.</strong>
        </p>
      )}

      <Dropzone onFiles={(files) => void onImport(files)} disabled={busy} />

      <div className="demoRow">
        <button type="button" className="demoBtn" onClick={() => void onDemo()} disabled={busy}>
          Try sample data
        </button>
        <span className="demoNote">28 real runs, bundled with the site — look around before importing your own</span>
      </div>

      {importState && <ImportPanel p={importState} />}

      <div className="osChips" role="group" aria-label="Show the save-folder path for your operating system">
        {(Object.keys(OS_PATHS) as OsKey[]).map((k) => (
          <button
            key={k}
            type="button"
            className={os === k ? 'pill on' : 'pill'}
            aria-pressed={os === k}
            onClick={() => {
              setOs(k);
              setCopyState('idle');
            }}
          >
            {OS_PATHS[k].label}
          </button>
        ))}
      </div>
      <div className="pathBox">
        <code className="pathText" ref={pathRef}>
          {info.path}
        </code>
        <button
          type="button"
          className="copyBtn"
          onClick={() => void copyPath()}
          aria-label="Copy save-folder path"
          aria-live="polite"
        >
          {copyState === 'copied' ? 'Copied ✓' : copyState === 'failed' ? 'Press Ctrl/⌘+C' : '⧉ Copy'}
        </button>
      </div>
      <p className="pathNote">({info.note})</p>

      <p className="stepsLine num" aria-label="How it works">
        <b>1</b> Point at the folder · <b>2</b> Two-second local parse · <b>3</b> Read your autopsy
      </p>

      <p className="privacyLine">Open source · works in airplane mode · the browser can't phone home (strict CSP).</p>
    </div>
  );
}
