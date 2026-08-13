/**
 * Latest-runs strip: a chronological row of ticks (oldest left) linking
 * through to each run's autopsy. Color is the outcome; the title carries
 * the full label so the strip never has to print 16 names.
 */
import { characterName, shortDate } from '../lib/idFormat';
import type { NormalizedRun } from '../lib/types';

const SHOW = 16;

interface RecentRunsProps {
  runs: NormalizedRun[];
}

export default function RecentRuns({ runs }: RecentRunsProps) {
  const latest = runs.filter((r) => !r.abandoned || r.nodes.length > 0).slice(-SHOW);
  if (latest.length < 3) return null;

  return (
    <section>
      <h2 className="sectionTitle withPill">
        Latest runs <span className="pill">{latest.length === SHOW ? `last ${SHOW}` : `${latest.length} runs`}</span>
      </h2>
      <div className="recent" role="list">
        {latest.map((r) => {
          const outcome = r.win ? 'win' : r.abandoned ? 'abandoned' : 'loss';
          const label = `${shortDate(r.startTime)} · ${characterName(r.player.character)} A${r.ascension} · ${outcome}`;
          return (
            <a
              key={r.id}
              role="listitem"
              className={`recentTick ${outcome}`}
              href={`#/autopsy/${r.id}`}
              title={label}
              aria-label={label}
            >
              <span className="recentMark" />
            </a>
          );
        })}
      </div>
    </section>
  );
}
