/**
 * Dashboard view (Mockup B): lifetime summary before detail.
 * Header line, three working filter pills (all / standard / current patch),
 * eight stat tiles, then the two-column panel row — characters + quarterly
 * sparks on the left, nemesis board + deaths-by-act on the right.
 * Filtered figures are recomputed with the same pure computeStats used by
 * the app shell, so every number on screen always comes from the runs.
 */
import { useEffect, useMemo, useState } from 'react';
import { getMeta } from '../lib/db';
import { LEDGER_META_KEY } from '../lib/import';
import type { Ledger } from '../lib/ledger';
import { computeStats } from '../lib/stats';
import { fmtInt, shortDate } from '../lib/idFormat';
import { downloadLifetimeCard } from '../lib/shareCard';
import type { NormalizedRun, StatsSummary } from '../lib/types';
import GameLedger from '../components/GameLedger';
import StatTiles from '../components/StatTiles';
import CharacterBars from '../components/CharacterBars';
import TrendSparks from '../components/TrendSparks';
import NemesisBoard from '../components/NemesisBoard';
import DeathsByAct from '../components/DeathsByAct';
import '../styles/dashboard.css';

type Filter = 'all' | 'standard' | 'patch';

const FILTER_LABELS: Record<Filter, string> = {
  all: 'All runs',
  standard: 'Standard only',
  patch: 'Current patch',
};

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
];

/** "Five months in the Spire" — computed from the corpus' actual span. */
function spanTitle(firstSec: number, lastSec: number): string {
  const days = Math.max(1, Math.round((lastSec - firstSec) / 86400));
  let n: number;
  let unit: string;
  if (days < 14) {
    n = days;
    unit = 'day';
  } else if (days < 61) {
    n = Math.max(2, Math.round(days / 7));
    unit = 'week';
  } else if (days < 700) {
    n = Math.max(2, Math.round(days / 30.44));
    unit = 'month';
  } else {
    n = Math.max(2, Math.round(days / 365.25));
    unit = 'year';
  }
  const word = n < WORDS.length ? WORDS[n] : fmtInt(n);
  return `${word[0].toUpperCase()}${word.slice(1)} ${unit}${n === 1 ? '' : 's'} in the Spire`;
}

function dateRange(firstSec: number, lastSec: number): string {
  const y1 = new Date(firstSec * 1000).getFullYear();
  const y2 = new Date(lastSec * 1000).getFullYear();
  return y1 === y2
    ? `${shortDate(firstSec)} – ${shortDate(lastSec)}, ${y2}`
    : `${shortDate(firstSec)}, ${y1} – ${shortDate(lastSec)}, ${y2}`;
}

interface DashboardProps {
  stats: StatsSummary;
  runs: NormalizedRun[];
}

export default function Dashboard({ stats, runs }: DashboardProps) {
  const [filter, setFilter] = useState<Filter>('all');
  const [sharing, setSharing] = useState(false);
  const [ledger, setLedger] = useState<Ledger | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    void getMeta<Ledger>(LEDGER_META_KEY).then((l) => {
      if (alive) setLedger(l);
    });
    return () => {
      alive = false;
    };
  }, []);

  const chrono = useMemo(() => [...runs].sort((a, b) => a.startTime - b.startTime), [runs]);
  const latestBuild = chrono.length ? chrono[chrono.length - 1].buildId : '';

  const filtered = useMemo(() => {
    if (filter === 'standard') return chrono.filter((r) => r.gameMode === 'standard');
    if (filter === 'patch') return chrono.filter((r) => r.buildId === latestBuild);
    return chrono;
  }, [chrono, filter, latestBuild]);

  const view = useMemo(
    () => (filter === 'all' ? stats : computeStats(filtered)),
    [filter, stats, filtered],
  );

  const pillRow = (
    <div className="filterRow" role="group" aria-label="Filter runs">
      {(Object.keys(FILTER_LABELS) as Filter[]).map((f) => (
        <button
          key={f}
          type="button"
          className={filter === f ? 'pill on' : 'pill'}
          aria-pressed={filter === f}
          onClick={() => setFilter(f)}
        >
          {FILTER_LABELS[f]}
        </button>
      ))}
      <button
        type="button"
        className="pill sharePill"
        disabled={sharing}
        onClick={() => {
          setSharing(true);
          void downloadLifetimeCard(view).finally(() => setSharing(false));
        }}
        title="Download a 1200×630 PNG of this dashboard's headline stats"
      >
        {sharing ? 'Rendering…' : '↓ Share card'}
      </button>
    </div>
  );

  if (filtered.length === 0) {
    return (
      <div className="dash">
        <div className="dashHead">
          <div>
            <h1>The Spire awaits</h1>
            <p className="dashSub">No runs match this filter.</p>
          </div>
          {pillRow}
        </div>
      </div>
    );
  }

  const firstSec = filtered[0].startTime;
  const lastSec = filtered[filtered.length - 1].startTime;
  const firstBuild = filtered[0].buildId;
  const lastBuild = filtered[filtered.length - 1].buildId;
  let buildsSeg = '';
  if (firstBuild !== 'unknown' || lastBuild !== 'unknown') {
    buildsSeg = firstBuild === lastBuild ? ` · build ${lastBuild}` : ` · builds ${firstBuild} → ${lastBuild}`;
  }

  return (
    <div className="dash">
      <div className="dashHead">
        <div>
          <h1>{spanTitle(firstSec, lastSec)}</h1>
          <p className="dashSub num">
            {fmtInt(view.totalRuns)} runs · {dateRange(firstSec, lastSec)}
            {buildsSeg}
          </p>
        </div>
        {pillRow}
      </div>

      <StatTiles stats={view} runs={filtered} />

      <div className="dashCols">
        <div className="panel">
          <CharacterBars byCharacter={view.byCharacter} />
          <TrendSparks quarters={view.quarters} />
        </div>
        <div className="panel">
          <NemesisBoard killCauses={view.killCauses} runs={filtered} />
          <DeathsByAct deathsByAct={view.deathsByAct} />
        </div>
      </div>

      {ledger && (
        <div className="panel">
          <GameLedger ledger={ledger} />
        </div>
      )}
    </div>
  );
}
