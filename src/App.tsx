/**
 * App shell: loads runs from IndexedDB, computes stats, and routes between
 * views by location.hash (static-host friendly):
 *   #/           Dashboard (or Landing when no data)
 *   #/coach      The coach — top leaks with receipts
 *   #/autopsy    Latest death autopsy; #/autopsy/<runId> for a specific run
 *   #/import     Landing/import screen (always reachable to add more runs)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadAllRuns, migrateIfNeeded } from './lib/db';
import { importDemoData, importFiles, type ImportProgress } from './lib/import';
import { computeStats } from './lib/stats';
import type { NormalizedRun } from './lib/types';
import Landing from './views/Landing';
import Dashboard from './views/Dashboard';
import Coach from './views/Coach';
import Autopsy from './views/Autopsy';

function useHashRoute(): string {
  const [hash, setHash] = useState(() => window.location.hash || '#/');
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || '#/');
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash;
}

export default function App() {
  const [runs, setRuns] = useState<NormalizedRun[] | null>(null);
  const [importState, setImportState] = useState<ImportProgress | null>(null);
  const hash = useHashRoute();

  const reload = useCallback(async () => {
    await migrateIfNeeded();
    setRuns(await loadAllRuns());
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleImport = useCallback(
    async (files: File[]) => {
      await importFiles(files, setImportState);
      await reload();
      window.location.hash = '#/';
    },
    [reload],
  );

  const handleDemo = useCallback(async () => {
    await importDemoData(setImportState);
    await reload();
    window.location.hash = '#/';
  }, [reload]);

  const stats = useMemo(() => (runs && runs.length ? computeStats(runs) : null), [runs]);

  if (runs === null) {
    return <div className="loading">Reading your journal…</div>;
  }

  const hasData = runs.length > 0;
  const route = hash.replace(/^#\/?/, '');
  const [page, param] = route.split('/');

  if (!hasData || page === 'import') {
    return (
      <Landing
        onImport={handleImport}
        onDemo={handleDemo}
        importState={importState}
        hasData={hasData}
        runs={runs}
      />
    );
  }

  let view: JSX.Element;
  if (page === 'coach') view = <Coach runs={runs} />;
  else if (page === 'autopsy') view = <Autopsy runs={runs} runId={param || undefined} />;
  else view = <Dashboard stats={stats!} runs={runs} />;

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brandMark" aria-hidden="true">
            {/* the favicon's dagger-cross, inlined so it can never render as emoji */}
            <svg viewBox="0 0 512 512" fill="none" stroke="currentColor" strokeWidth="52" strokeLinecap="round">
              <line x1="256" y1="72" x2="256" y2="440" />
              <line x1="140" y1="184" x2="372" y2="184" />
            </svg>
          </span>{' '}
          Spire Autopsy
        </a>
        <nav className="nav">
          <a className={!page ? 'on' : ''} href="#/">Dashboard</a>
          <a className={page === 'coach' ? 'on' : ''} href="#/coach">Coach</a>
          <a className={page === 'autopsy' ? 'on' : ''} href="#/autopsy">Autopsy</a>
          <a href="#/import">Add runs</a>
        </nav>
        <span
          className="privacyBadge"
          title="Your run files stay in this browser. An anonymous snapshot leaves only if you click Share."
        >
          0 uploads
        </span>
      </header>
      <main className="content">{view}</main>
      <footer className="footer">
        Everything on this page was computed in your browser from your own run files. Nothing uploads unless you send a
        snapshot. Not affiliated with Mega Crit.
      </footer>
    </div>
  );
}
