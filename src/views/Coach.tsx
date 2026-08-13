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
import { climbSummary, wallLine } from '../lib/climb';
import { getMeta, setMeta } from '../lib/db';
import { behaviorTrend, computeDrillProgress, DRILLS, type ActiveDrill } from '../lib/drills';
import { characterArt } from '../lib/art';
import { characterColor, characterName, fmtInt } from '../lib/idFormat';
import { completedRuns } from '../lib/normalize';
import type { LeakResult, NormalizedRun } from '../lib/types';
import ArtImg from '../components/ArtImg';
import LeakCard, { type DrillSlot } from '../components/LeakCard';
import RichLine from '../components/RichLine';
import '../styles/coach.css';

const MAX_LEAK_CARDS = 3;
const DISMISSED_KEY = 'dismissedLeaks';
const DRILL_KEY = 'activeDrill';

/**
 * One-line rendering of an observation body: its first sentence. Observation
 * copy is dense with decimals ("Wins average 2.4 elites"), so a terminator
 * only counts when it is followed by a space and a capital, or ends the text.
 */
function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](?=\s+[A-Z“"(]|\s*$)/s);
  return match ? match[0].trim() : text;
}

export default function Coach({ runs }: { runs: NormalizedRun[] }) {
  // null until the persisted veto list has loaded — avoids a flash where a
  // demoted leak briefly renders as a card before dropping into the drawer.
  const [dismissed, setDismissed] = useState<string[] | null>(null);
  const [activeDrill, setActiveDrill] = useState<ActiveDrill | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void getMeta<string[]>(DISMISSED_KEY).then((ids) => {
      if (alive) setDismissed(ids ?? []);
    });
    void getMeta<ActiveDrill>(DRILL_KEY).then((d) => {
      if (alive) setActiveDrill(d ?? null);
    });
    return () => {
      alive = false;
    };
  }, []);

  const leaks = useMemo<LeakResult[]>(() => detectLeaks(runs), [runs]);
  const completedCount = useMemo(() => completedRuns(runs).length, [runs]);

  if (dismissed === null || activeDrill === undefined) return null; // IndexedDB reads resolve in milliseconds

  const dismissedSet = new Set(dismissed);
  // Demoted leaks are out everywhere the coach speaks — including the wall's
  // "biggest lever", which must honor the same veto as the cards.
  const climb = climbSummary(runs, leaks.filter((l) => !dismissedSet.has(l.id)));
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
  // The active drill's leak is pinned: a new pattern can't displace the thing
  // the player is mid-way through practicing.
  if (activeDrill) {
    const i = rankedLeaks.findIndex((l) => l.id === activeDrill.leakId);
    if (i > 0) rankedLeaks.unshift(rankedLeaks.splice(i, 1)[0]);
  }
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

  const drillProgress = activeDrill ? computeDrillProgress(activeDrill, runs) : undefined;
  const startDrill = (leakId: string) => {
    if (!DRILLS[leakId]) return;
    // Carry the card's own bar onto the drill: the player is graded against
    // the number they were shown, even if later runs move the average.
    const bar = leaks.find((l) => l.id === leakId)?.drillBar;
    const drill: ActiveDrill = { leakId, acceptedAt: Date.now(), targetRuns: DRILLS[leakId].targetRuns, bar };
    setActiveDrill(drill);
    void setMeta(DRILL_KEY, drill);
  };
  const clearDrill = () => {
    setActiveDrill(null);
    void setMeta(DRILL_KEY, null);
  };
  const drillSlotFor = (leak: LeakResult): DrillSlot => {
    if (activeDrill?.leakId === leak.id && drillProgress) return { kind: 'active', progress: drillProgress };
    if (!DRILLS[leak.id]) return { kind: 'none' };
    if (activeDrill) return { kind: 'blocked', activeTitle: DRILLS[activeDrill.leakId]?.title ?? 'your active drill' };
    return { kind: 'available' };
  };

  return (
    <div className="coachView">
      <header className="coachHead">
        <div>
          <h1 className="coachTitle">What's costing you runs</h1>
          <p className="coachSub">
            From <span className="num">{fmtInt(completedCount)}</span> completed runs
          </p>
        </div>
        <div className="voiceRow" role="group" aria-label="Coach voice">
          <button type="button" className="pill on" aria-pressed="true">
            Coach
          </button>
          <button type="button" className="pill" disabled title="Soon">
            Analyst
          </button>
          <button type="button" className="pill" disabled title="Soon">
            The Spire Speaks
          </button>
        </div>
      </header>

      {climb.active && (
        <section className="climbStrip" aria-label="The wall — current ascension target per character">
          <div className="wallHead">
            <ArtImg src={characterArt(climb.active.character)} className="wallArt" />
            <div className="climbCell climbTarget">
              <span className="climbK">The wall</span>
              <span className="climbV num" style={{ color: characterColor(climb.active.character) }}>
                A{climb.active.target} {characterName(climb.active.character)}
              </span>
            </div>
            <div className="climbCell">
              <span className="climbK">Beaten</span>
              <span className="climbV num">
                {climb.active.frontier === null ? '—' : `A${climb.active.frontier}`}
              </span>
            </div>
          </div>
          <div className="climbNote">
            <RichLine
              text={wallLine(climb.active)}
              enemyIds={climb.active.topKiller ? [climb.active.topKiller.encounter] : undefined}
            />
            {climb.leverTitle && !climb.active.summited && (
              <>
                {' '}
                Biggest lever: <b>{climb.leverTitle}</b>.
              </>
            )}
          </div>
          {climb.walls.length > 1 && (
            <div className="wallChips" aria-label="Other characters' walls">
              {climb.walls.slice(1).map((w) => (
                <span
                  key={w.character}
                  className="wallChip num"
                  style={{ borderColor: characterColor(w.character) }}
                  title={wallLine(w)}
                >
                  {characterName(w.character)} → A{w.target}
                  {w.attempts > 0 && <span className="wallTries"> · {w.attempts}</span>}
                </span>
              ))}
            </div>
          )}
        </section>
      )}

      {cards.map((leak, i) => (
        <LeakCard
          key={leak.id}
          leak={leak}
          rank={i + 1}
          defaultOpen={i === 0}
          onDemote={demote}
          drillSlot={drillSlotFor(leak)}
          trend={behaviorTrend(leak.id, runs)}
          drillAcceptedAt={activeDrill?.leakId === leak.id ? activeDrill.acceptedAt : undefined}
          onStartDrill={startDrill}
          onClearDrill={clearDrill}
        />
      ))}

      {cards.length === 0 && (
        <p className="coachClear">
          No glaring leak. Nothing in your runs reads like a habit costing you wins. Keep climbing — the coach speaks
          when the evidence does.
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
