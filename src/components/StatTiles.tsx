/**
 * The eight lifetime stat tiles (Mockup B, top row).
 * Every figure is computed from the stats/runs passed in — never hardcoded.
 */
import { characterName, fmtInt } from '../lib/idFormat';
import type { NormalizedRun, StatsSummary } from '../lib/types';

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six',
  'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
];

/** Small numbers as words ("three different characters"); digits beyond twelve. */
function numberWord(n: number): string {
  return n >= 0 && n < WORDS.length ? WORDS[n] : fmtInt(n);
}

/** Characters used inside the best (longest) win streak, chronologically. */
function bestStreakCharacters(runs: NormalizedRun[]): string[] {
  const chrono = [...runs].sort((a, b) => a.startTime - b.startTime);
  let current: NormalizedRun[] = [];
  let best: NormalizedRun[] = [];
  for (const run of chrono) {
    if (run.abandoned) continue;
    if (run.win) {
      current.push(run);
      if (current.length > best.length) best = [...current];
    } else {
      current = [];
    }
  }
  return [...new Set(best.map((r) => r.player.character))];
}

interface StatTilesProps {
  stats: StatsSummary;
  runs: NormalizedRun[];
}

export default function StatTiles({ stats, runs }: StatTilesProps) {
  const winningRuns = runs.filter((r) => r.win);
  const floorsPerWin = winningRuns.length
    ? Math.round(winningRuns.reduce((a, r) => a + r.nodes.length, 0) / winningRuns.length)
    : 0;

  const streakChars = bestStreakCharacters(runs);
  let streakDetail: string;
  if (stats.bestWinStreak === 0) streakDetail = 'first win still ahead';
  else if (streakChars.length === 1) streakDetail = `all on ${characterName(streakChars[0])}`;
  else streakDetail = `${numberWord(streakChars.length)} different characters`;

  const netHealer = stats.totalHpHealed > stats.totalDamageTaken;
  const pickPct = Math.round(stats.pickRatePct);

  const tiles: { k: string; v: string; d: string }[] = [
    {
      k: 'Runs',
      v: fmtInt(stats.totalRuns),
      d: `${fmtInt(stats.wins)} wins · ${stats.winRatePct}%`,
    },
    {
      k: 'Time climbing',
      v: `${fmtInt(Math.round(stats.totalHoursActive))}h`,
      d: `median run ${Math.round(stats.medianRunMinutes)} min`,
    },
    {
      k: 'Floors',
      v: fmtInt(stats.totalFloors),
      d: winningRuns.length ? `${floorsPerWin} per winning run` : 'no winning runs yet',
    },
    {
      k: 'Monsters felled',
      v: fmtInt(stats.totalMonstersFaced),
      d: `${fmtInt(stats.totalCombatTurns)} turns fought`,
    },
    {
      k: 'Damage tanked',
      v: fmtInt(stats.totalDamageTaken),
      d: `healed ${fmtInt(stats.totalHpHealed)}${netHealer ? ' — net healer' : ''}`,
    },
    {
      k: 'Gold earned',
      v: fmtInt(stats.totalGoldGained),
      d: stats.totalGoldStolen > 0 ? `${fmtInt(stats.totalGoldStolen)} stolen from you` : 'none stolen from you',
    },
    {
      k: 'Cards offered',
      v: fmtInt(stats.cardsOffered),
      d: `picked ${pickPct}%${stats.cardsOffered > 0 && pickPct < 25 ? ' — disciplined' : ''}`,
    },
    {
      k: 'Best streak',
      v: fmtInt(stats.bestWinStreak),
      d: streakDetail,
    },
  ];

  return (
    <div className="tiles">
      {tiles.map((t) => (
        <div className="tile" key={t.k}>
          <div className="k">{t.k}</div>
          <div className="v num">{t.v}</div>
          <div className="d">{t.d}</div>
        </div>
      ))}
    </div>
  );
}
