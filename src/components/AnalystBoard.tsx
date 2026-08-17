/**
 * AnalystBoard — the Coach's second voice. Same detectors, zero prose
 * padding: every cohort, denominator, and receipt visible at once, as
 * tables. For the days the player wants the numbers, not the coaching.
 *
 * The Coach ranks three cards and folds the rest into a drawer. The Analyst
 * hides nothing: leaks and observations share one ledger and a tier column
 * does the sorting that the drawer used to do, and every receipt sits open
 * under its own row. Nothing here is computed — every figure is a
 * LeakResult/DrillProgress field, formatted and placed.
 *
 * Read-only surface: drills are the Coach voice's instrument, so this board
 * reports drill state but never starts or clears one.
 */
import type { DrillProgress, DrillVerdict } from '../lib/drills';
import RichLine from './RichLine';
import type { DumbbellStat, LeakResult, NormalizedRun } from '../lib/types';
import '../styles/analyst.css';

export interface AnalystBoardProps {
  /** ranked applicable leak-tier results (the coach's cards) */
  leaks: LeakResult[];
  /** observations + overflow + healthy, in drawer order */
  drawerItems: LeakResult[];
  runs: NormalizedRun[];
  activeDrill?: DrillProgress;
}

/** Columns in the ledger — the evidence row spans all of them. */
const COLUMNS = 7;

const VERDICT_GLYPH: Record<DrillVerdict, string> = { pass: '✓', fail: '✗', na: '—' };

/**
 * Mirrors Dumbbell's value formatter exactly: integers print bare, everything
 * else to one decimal, percentages keep their sign. Two voices quoting the
 * same detector must never print the same number differently.
 */
export function fmtCohortValue(value: number, format: DumbbellStat['format']): string {
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1);
  return format === 'pct' ? `${text}%` : text;
}

/**
 * The two dots' cohort names. A detector comparing anything other than won
 * runs vs lost runs sets both labels; only when it sets neither do the house
 * "wins"/"losses" defaults describe the values honestly.
 */
export function cohortTags(stat: DumbbellStat): { win: string; loss: string } {
  return { win: stat.winLabel ?? 'wins', loss: stat.lossLabel ?? 'losses' };
}

/** The ranking heuristic, fixed-width so the column reads as a column. */
export function rankScoreText(value: number): string {
  return value.toFixed(2);
}

/** Tier chip text — the column that replaces the Coach's drawer. */
export function tierTag(item: Pick<LeakResult, 'tier' | 'healthy'>): string {
  if (item.healthy) return 'clean';
  return item.tier === 'leak' ? 'leak' : 'obs';
}

/**
 * One ledger row per applicable detector. `leaks` (the full ranked list) and
 * `drawerItems` (its overflow tail plus observations and healthy results)
 * intentionally overlap in Coach.tsx, so the tail is deduped by id here
 * rather than printed twice.
 */
export function boardRows(
  leaks: LeakResult[],
  drawerItems: LeakResult[],
): { ranked: { leak: LeakResult; rank: number }[]; observations: LeakResult[]; clean: LeakResult[] } {
  const seen = new Set(leaks.map((l) => l.id));
  const extras = drawerItems.filter((d) => !seen.has(d.id));
  const all = [...leaks, ...extras];
  return {
    ranked: leaks.filter((l) => !l.healthy).map((leak, i) => ({ leak, rank: i + 1 })),
    observations: extras.filter((l) => !l.healthy),
    clean: all.filter((l) => l.healthy),
  };
}

function hasEvidence(leak: LeakResult): boolean {
  return (
    leak.body.length > 0 ||
    leak.receiptLines.length > 0 ||
    leak.runReceipts.length > 0 ||
    Boolean(leak.confoundNote) ||
    Boolean(leak.drill)
  );
}

function CohortCell({ stat }: { stat?: DumbbellStat }) {
  if (!stat) return <span className="anNil">—</span>;
  const tags = cohortTags(stat);
  return (
    <div className="anPair">
      <span className="anPairLabel">{stat.label}</span>
      <i className="anTag win">{tags.win}</i>
      <b className="anVal win num">{fmtCohortValue(stat.winValue, stat.format)}</b>
      <i className="anTag loss">{tags.loss}</i>
      <b className="anVal loss num">{fmtCohortValue(stat.lossValue, stat.format)}</b>
    </div>
  );
}

/** Receipts, confound, and the drill text — always open, never a <details>. */
function EvidenceCell({ leak }: { leak: LeakResult }) {
  return (
    <td className="anEvidCell" colSpan={COLUMNS}>
      {leak.body && <p className="anBody">{leak.body}</p>}
      {leak.receiptLines.map((line, i) => (
        <div className="anReceipt num" key={i}>
          {line}
        </div>
      ))}
      {leak.runReceipts.map((r, i) => (
        // key includes the index: one run can appear twice in one detector's receipts
        <a className="anReceipt anRun num" href={`#/autopsy/${r.runId}`} key={`${r.runId}-${i}`}>
          <RichLine
            text={r.label}
            enemyIds={r.enemyIds}
            cardIds={r.cardIds}
            relicIds={r.relicIds}
            potionIds={r.potionIds}
          />{' '}
          <span className="anCue">→</span>
        </a>
      ))}
      {leak.drill && (
        <p className="anDrillDef">
          <span className="anK">drill</span>
          <b>{leak.drill.title}</b> — {leak.drill.body}
        </p>
      )}
      {leak.confoundNote && <p className="anConfound">{leak.confoundNote}</p>}
    </td>
  );
}

function LedgerRows({ leak, rank }: { leak: LeakResult; rank?: number }) {
  return (
    <tbody className="anGroup">
      <tr className="anRow">
        <td className="anRank num">{rank ?? '—'}</td>
        <td>
          <span className={`anTier t-${tierTag(leak)}`}>{tierTag(leak)}</span>
        </td>
        <td className="anFinding">
          <span className="anName">{leak.title}</span>
          {leak.ratioBadge && <span className="anRatio num">{leak.ratioBadge}</span>}
        </td>
        <td className="anCohortCell">
          <CohortCell stat={leak.dumbbell} />
        </td>
        <td className="anSample num">{leak.dumbbell?.sampleLabel ?? <span className="anNil">—</span>}</td>
        <td>
          <span className={`anStrength s-${leak.strength}`}>{leak.strength}</span>
        </td>
        <td className="anScore num">{rankScoreText(leak.expectedWinsLost)}</td>
      </tr>
      {hasEvidence(leak) && (
        <tr className="anEvid">
          <EvidenceCell leak={leak} />
        </tr>
      )}
    </tbody>
  );
}

export default function AnalystBoard({ leaks, drawerItems, activeDrill }: AnalystBoardProps) {
  const { ranked, observations, clean } = boardRows(leaks, drawerItems);
  const total = ranked.length + observations.length;

  return (
    <section className="analystBoard" aria-label="Analyst board">
      <div className="anHead">
        <h2 className="anTitle">Leak ledger</h2>
        <span className="anLegend num">
          {total} scored · {clean.length} clean
        </span>
      </div>

      {activeDrill && (
        <div className="anDrill" aria-label="Active drill">
          <span className="anK">drill</span>
          <span className="anDrillName">{activeDrill.def.title}</span>
          <span className="anDrillCount num">
            {activeDrill.passes}/{activeDrill.drill.targetRuns} pass · {activeDrill.fails} fail
            {activeDrill.complete && ' · complete'}
          </span>
          <div className="anChips">
            {activeDrill.graded.length === 0 && <span className="anNil">no runs graded yet</span>}
            {activeDrill.graded.map((g) => (
              <a
                className={`anChip ${g.verdict} num`}
                href={`#/autopsy/${g.runId}`}
                key={g.runId}
                title={g.note}
              >
                <i>{VERDICT_GLYPH[g.verdict]}</i> {g.label}
              </a>
            ))}
          </div>
        </div>
      )}

      {total > 0 && (
        <div className="anScroll">
          <table className="anTable">
            <thead>
              <tr>
                <th className="anRank">#</th>
                <th>tier</th>
                <th>finding</th>
                <th>cohort split</th>
                <th>sample</th>
                <th>evidence</th>
                <th className="anScore" title="ranking heuristic — estimated wins lost per 100 runs">
                  rank score
                </th>
              </tr>
            </thead>
            {ranked.map(({ leak, rank }) => (
              <LedgerRows key={leak.id} leak={leak} rank={rank} />
            ))}
            {observations.map((leak) => (
              <LedgerRows key={leak.id} leak={leak} />
            ))}
          </table>
        </div>
      )}

      {total === 0 && <p className="anNil">No scored detector in this corpus.</p>}

      <p className="anFoot">
        rank score = ranking heuristic, est. wins lost per 100 runs. Ordering only, not a forecast.
      </p>

      {clean.length > 0 && (
        <div className="anClean">
          <span className="anK">clean</span>
          <dl>
            {clean.map((l) => (
              <div className="anCleanRow" key={l.id}>
                <dt>{l.title}</dt>
                <dd>
                  {l.body}
                  {l.receiptLines.map((line, i) => (
                    <span className="anCleanReceipt num" key={i}>
                      {line}
                    </span>
                  ))}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </section>
  );
}
