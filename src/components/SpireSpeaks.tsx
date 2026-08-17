/**
 * SpireSpeaks — the Coach's third voice. The Spire itself narrates the
 * climb: same verdicts, same numbers, delivered in-world. All copy comes
 * from lib/spireVoice.ts (pure, so the voice can be audited line by line);
 * this component only renders it.
 *
 * The page is an inscription: carved display face for the Spire's line, prose
 * paragraphs at reading measure, mono asides holding the receipts the prose
 * rewords, and an ember hairline between sections. Nothing here computes.
 */
import { useMemo } from 'react';
import type { LatestVictory } from '../lib/climb';
import type { DrillProgress } from '../lib/drills';
import { spireNarration, type SpirePassage } from '../lib/spireVoice';
import type { LeakResult, NormalizedRun } from '../lib/types';
import RichLine from './RichLine';
import '../styles/spire.css';

export interface SpireSpeaksProps {
  leaks: LeakResult[];
  drawerItems: LeakResult[];
  runs: NormalizedRun[];
  victory?: LatestVictory;
  activeDrill?: DrillProgress;
}

function Line({ p }: { p: SpirePassage }) {
  return <RichLine text={p.text} enemyIds={p.enemyIds} cardIds={p.cardIds} relicIds={p.relicIds} potionIds={p.potionIds} />;
}

export default function SpireSpeaks({ leaks, drawerItems, victory, activeDrill }: SpireSpeaksProps) {
  const narration = useMemo(
    () => spireNarration(leaks, drawerItems, victory, activeDrill),
    [leaks, drawerItems, victory, activeDrill],
  );

  return (
    <section className="spireScroll" aria-label="The Spire speaks">
      <h2 className="spireTitle">{narration.title}</h2>
      {narration.passages.map((p, i) => {
        const key = `${p.src}-${p.leakId ?? p.runRef ?? i}-${i}`;
        if (p.tone === 'rubric') {
          return (
            <h3 className="spireRubric" key={key}>
              <span>{p.text}</span>
            </h3>
          );
        }
        if (p.tone === 'aside') {
          return (
            <div className="spireAside num" key={key}>
              <Line p={p} />
              {p.runRef && (
                <a className="spireOpen" href={`#/autopsy/${p.runRef}`}>
                  open autopsy →
                </a>
              )}
            </div>
          );
        }
        return (
          <p className={p.tone === 'note' ? 'spireLine spireNote' : 'spireLine'} key={key}>
            <Line p={p} />
            {p.runRef && (
              <>
                {' '}
                <a className="spireOpen" href={`#/autopsy/${p.runRef}`}>
                  open autopsy →
                </a>
              </>
            )}
          </p>
        );
      })}
    </section>
  );
}
