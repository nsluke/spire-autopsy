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
import { getMeta } from '../lib/db';
import { LEDGER_META_KEY, type ImportProgress } from '../lib/import';
import { fmtInt } from '../lib/idFormat';
import { exportJournal, importJournal, JournalImportError } from '../lib/journal';
import { characterArt } from '../lib/art';
import type { Ledger } from '../lib/ledger';
import type { NormalizedRun } from '../lib/types';
import ArtImg from '../components/ArtImg';
import ContributePanel from '../components/ContributePanel';
import Dropzone from '../components/Dropzone';
import GameLedger from '../components/GameLedger';
import { ingestConfigured } from '../lib/contribute';
import '../styles/landing.css';

export const ISSUES_URL = 'https://github.com/nsluke/spire-autopsy/issues/new/choose';

interface LandingProps {
  onImport: (files: File[]) => Promise<void>;
  onDemo: () => Promise<void>;
  importState: ImportProgress | null;
  hasData: boolean;
  runs: NormalizedRun[];
}

type OsKey = 'macos' | 'windows' | 'linux';

// All three verified against real installs / user-pasted paths (Aug 2026).
// Steam Deck runs the native Linux build by default → same path as Linux;
// forced-Proton installs live under compatdata/2868840/pfx/.../AppData instead.
const OS_PATHS: Record<OsKey, { label: string; path: string; note: string }> = {
  macos: {
    label: 'macOS',
    path: '~/Library/Application Support/SlayTheSpire2/steam/<your-id>/profile1/saves/history',
    note: 'confirmed on the current build',
  },
  windows: {
    label: 'Windows',
    path: '%APPDATA%\\SlayTheSpire2\\steam\\<your-id>\\profile1\\saves\\history',
    note: 'confirmed — paste into the Explorer address bar; %APPDATA% is the Roaming folder',
  },
  linux: {
    label: 'Linux / Steam Deck',
    path: '~/.local/share/SlayTheSpire2/steam/<your-id>/profile1/saves/history',
    note: 'confirmed for the native build (Deck default); Proton installs live under compatdata/2868840',
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
          {p.ledgerCaptured && <li>game ledger captured from progress.save</li>}
          {p.added === 0 && p.skippedKnown === 0 && p.failed.length === 0 && !p.ledgerCaptured && (
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
          <p className="failIntro">
            Looks like a bug on our side?{' '}
            <a href={ISSUES_URL} target="_blank" rel="noreferrer">
              Open an issue
            </a>{' '}
            with the file’s schema_version — game patches move, and we chase.
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * Journal backup row: export downloads one JSON of every run + coach state;
 * import restores it (idempotent) and reloads so all views recompute.
 */
function JournalRow({ hasData }: { hasData: boolean }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'importing' | 'error'>('idle');
  const [error, setError] = useState('');

  async function handleImport(file: File | undefined) {
    if (!file) return;
    setState('importing');
    try {
      await importJournal(file, () => undefined);
      window.location.hash = '#/';
      window.location.reload(); // full recompute from the restored journal
    } catch (e) {
      setError(e instanceof JournalImportError ? e.message : 'Import failed — is this a Spire Journal file?');
      setState('error');
    }
  }

  return (
    <div className="journalRow">
      <span className="journalLabel">Spire Journal</span>
      {hasData && (
        <button type="button" className="pill" onClick={() => void exportJournal()}>
          Export backup
        </button>
      )}
      <button type="button" className="pill" onClick={() => fileRef.current?.click()} disabled={state === 'importing'}>
        {state === 'importing' ? 'Restoring…' : 'Import backup'}
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="application/json"
        hidden
        onChange={(e) => void handleImport(e.target.files?.[0])}
      />
      {state === 'error' && <span className="journalError">{error}</span>}
      <span className="journalHint">Every run and every note, one file — carry it to another machine or keep it safe.</span>
    </div>
  );
}

export default function Landing({ onImport, onDemo, importState, hasData, runs }: LandingProps) {
  const [os, setOs] = useState<OsKey>(() => detectOs());
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [ledger, setLedger] = useState<Ledger | undefined>(undefined);
  const copyTimer = useRef<number | undefined>(undefined);
  const pathRef = useRef<HTMLElement>(null);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);

  // The quick-look ledger (progress.save) — refreshed whenever an import finishes.
  const importDone = importState?.phase === 'done';
  useEffect(() => {
    let alive = true;
    void getMeta<Ledger>(LEDGER_META_KEY).then((l) => {
      if (alive) setLedger(l);
    });
    return () => {
      alive = false;
    };
  }, [importDone]);

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
        <span className="landingMark" aria-hidden="true">
          {/* the favicon's dagger-cross, inlined so it can never render as emoji */}
          <svg viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="52" strokeLinecap="round">
            <line x1="256" y1="72" x2="256" y2="440" />
            <line x1="140" y1="184" x2="372" y2="184" />
          </svg>
        </span>{' '}
        Spire Autopsy
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
          skipped automatically. <strong>Run files never leave this browser.</strong>
        </p>
      ) : (
        <p className="landingSub">
          Slay the Spire 2 writes every run you finish to disk. Drop that folder here and get a coach’s read on why you
          lose — in your browser, on your machine. <strong>Run files never leave this browser.</strong>
        </p>
      )}

      {!hasData && (
        <div className="charLineup" aria-hidden="true">
          {['IRONCLAD', 'SILENT', 'DEFECT', 'NECROBINDER', 'REGENT'].map((c) => (
            <ArtImg key={c} src={characterArt(`CHARACTER.${c}`)} />
          ))}
        </div>
      )}

      <Dropzone
        onFiles={(files) => void onImport(files)}
        disabled={busy}
        pickerHint={
          os === 'macos'
            ? 'in the picker, press ⌘⇧G and paste the path below'
            : os === 'windows'
              ? 'in the picker, paste the path into the address bar'
              : undefined
        }
      />

      <div className="demoRow">
        <button type="button" className="demoBtn" onClick={() => void onDemo()} disabled={busy}>
          Try sample data
        </button>
        <span className="demoNote">57 real runs from a fellow climber — look around before importing your own</span>
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
          {copyState === 'copied' ? 'Copied ✓' : copyState === 'failed' ? 'Press Ctrl/⌘+C' : 'Copy'}
        </button>
      </div>
      <p className="pathNote">({info.note})</p>

      <p className="pathNote">
        In a hurry? Drop just <span className="inlineMono">progress.save</span> (one folder up) for a quick look at
        the game’s own ledger — the coach unlocks once the run files arrive.
      </p>

      <p className="stepsLine num" aria-label="How it works">
        <b>1</b> Point at the folder · <b>2</b> Two-second local parse · <b>3</b> Read your autopsy
      </p>

      {!hasData && ledger && (
        <div className="panel">
          <GameLedger ledger={ledger} />
        </div>
      )}

      <JournalRow hasData={hasData} />

      {hasData && <ContributePanel runs={runs} variant="row" />}

      <p className="privacyLine">
        Open source · works in airplane mode ·{' '}
        {ingestConfigured()
          ? 'nothing uploads unless you send a snapshot'
          : "the browser can't phone home (strict CSP)"}{' '}
        ·{' '}
        <a href={ISSUES_URL} target="_blank" rel="noreferrer">
          report a problem
        </a>
      </p>
    </div>
  );
}
