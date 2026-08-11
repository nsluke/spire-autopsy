/**
 * Coach view (Mockup C): "What's costing you runs".
 *
 * detectLeaks(runs) → LeakResult[] is the only data dependency (pure, from
 * ../lib/leaks). The view shows at most three leak-tier cards ranked by
 * expectedWinsLost — a coach that lists everything coaches nothing — with
 * everything else (overflow leaks + observations) collapsed into a drawer.
 * Detectors that can't speak yet (applicable=false) render as one quiet
 * locked card: the cold-start ladder. Detectors that ran and found nothing
 * to fix (healthy=true) go to the drawer as a clean bill of health instead. The "demote" veto persists to
 * meta('dismissedLeaks') so a deliberate playstyle isn't re-flagged every
 * visit; demoted leaks live in the drawer with a restore affordance.
 */
import { useEffect, useMemo, useState } from 'react';
import { detectLeaks } from '../lib/leaks';
import { getMeta, setMeta } from '../lib/db';
import { fmtInt } from '../lib/idFormat';
import { completedRuns } from '../lib/normalize';
import type { LeakResult, NormalizedRun } from '../lib/types';
import LeakCard from '../components/LeakCard';
import '../styles/coach.css';

const MAX_LEAK_CARDS = 3;
const DISMISSED_KEY = 'dismissedLeaks';

/** One-line rendering of an observation body: its first sentence. */
function firstSentence(text: string): string {
  const match = text.match(/^[^.!?]*[.!?]/);
  return match ? match[0].trim() : text;
}

export default function Coach({ runs }: { runs: NormalizedRun[] }) {
  // null until the persisted veto list has loaded — avoids a flash where a
  // demoted leak briefly renders as a card before dropping into the drawer.
  const [dismissed, setDismissed] = useState<string[] | null>(null);

  useEffect(() => {
    let alive = true;
    void getMeta<string[]>(DISMISSED_KEY).then((ids) => {
      if (alive) setDismissed(ids ?? []);
    });
    return () => {
      alive = false;
    };
  }, []);

  const leaks = useMemo<LeakResult[]>(() => detectLeaks(runs), [runs]);
  const completedCount = useMemo(() => completedRuns(runs).length, [runs]);

  if (dismissed === null) return null; // IndexedDB read resolves in milliseconds

  const dismissedSet = new Set(dismissed);
  const applicable = leaks.filter((l) => l.applicable);
  const locked = leaks.filter((l) => !l.applicable);
  // Healthy = the detector ran and found nothing to fix. Never a leak card,
  // never "locked" — it reads as a clean bill of health in the drawer.
  const healthy = applicable.filter((l) => l.healthy && !dismissedSet.has(l.id));
  const demoted = applicable.filter((l) => dismissedSet.has(l.id));
  const active = applicable.filter((l) => !dismissedSet.has(l.id) && !l.healthy);
  const rankedLeaks = active
    .filter((l) => l.tier === 'leak')
    .sort((a, b) => b.expectedWinsLost - a.expectedWinsLost);
  const cards = rankedLeaks.slice(0, MAX_LEAK_CARDS);
  const drawerItems = [
    ...rankedLeaks.slice(MAX_LEAK_CARDS),
    ...active.filter((l) => l.tier === 'observation'),
    ...healthy,
  ];

  const persist = (next: string[]) => {
    setDismissed(next);
    void setMeta(DISMISSED_KEY, next);
  };
  const demote = (id: string) => persist([...dismissed.filter((d) => d !== id), id]);
  const restore = (id: string) => persist(dismissed.filter((d) => d !== id));

  return (
    <div className="coachView">
      <header className="coachHead">
        <div>
          <h1 className="coachTitle">What's costing you runs</h1>
          <p className="coachSub">
            Ranked by estimated wins lost · evidence from <span className="num">{fmtInt(completedCount)}</span>{' '}
            completed runs
          </p>
        </div>
        <div className="voiceRow" role="group" aria-label="Coach voice">
          <button type="button" className="pill on" aria-pressed="true">
            Coach
          </button>
          <button type="button" className="pill" disabled title="coming in v0.2">
            Analyst
          </button>
          <button type="button" className="pill" disabled title="coming in v0.2">
            The Spire Speaks
          </button>
        </div>
      </header>

      {cards.map((leak, i) => (
        <LeakCard key={leak.id} leak={leak} rank={i + 1} defaultOpen={i === 0} onDemote={demote} />
      ))}

      {cards.length === 0 && (
        <p className="coachClear">
          No glaring leak right now. Nothing in your completed runs looks like a habit that's clearly costing you wins —
          keep playing, and check back as new runs sharpen the evidence.
        </p>
      )}

      {locked.length > 0 && (
        <section className="lockedCard" aria-label="Analyses that unlock with more runs">
          <h2 className="lockedTitle">Locked — more coaching unlocks as your journal grows</h2>
          <ul>
            {locked.map((l) => (
              <li key={l.id}>
                <b>{l.title}</b>
                {l.body && <> — {l.body}</>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {(drawerItems.length > 0 || demoted.length > 0) && (
        <details className="obsDrawer">
          <summary>
            Minor observations ({drawerItems.length})
            {demoted.length > 0 && <> · {demoted.length} demoted</>}
          </summary>
          <div className="obsList">
            {drawerItems.map((l) => (
              <div className="obsItem" key={l.id}>
                <span className="obsTitle">
                  {l.healthy ? '✓ ' : ''}
                  {l.title}
                </span>
                <span className="obsBody">{firstSentence(l.body)}</span>
              </div>
            ))}
            {demoted.map((l) => (
              <div className="obsItem demoted" key={l.id}>
                <span className="obsTitle">{l.title}</span>
                <span className="obsBody">Demoted by you — kept out of your leaks until you say otherwise.</span>
                <button type="button" className="restoreBtn" onClick={() => restore(l.id)}>
                  Restore
                </button>
              </div>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
