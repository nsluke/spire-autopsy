/**
 * computeStats: pure aggregation from NormalizedRun[] to StatsSummary.
 * Conventions (locked by the verified audit of Luke's 231 runs):
 *  - Headline win rate includes all runs (custom + daily); standard-only shown separately.
 *  - "Active hours" excludes runs whose wall clock exceeded 8h (save left open).
 *  - A combat = a room with non-empty monsterIds. Monsters faced = Σ monsterIds.
 *  - Cards offered = every cardChoices entry; picked = wasPicked.
 *  - Kill causes are counted over non-abandoned losses; timesFought counts combat
 *    rooms with that modelId across ALL runs.
 *  - Deaths-by-act = actsEntered of each non-abandoned loss.
 */
import type {
  AscensionRecord,
  CharacterStats,
  KillCause,
  NormalizedRun,
  PickCount,
  RestChoiceCount,
  StatsSummary,
  TrendPoint,
} from './types';
import { cardInfo } from './cards';

const AFK_THRESHOLD_SECONDS = 8 * 3600;

/** Starter strikes/defends (and anything tagged starter in the metadata pack). */
function isStarterCard(id: string): boolean {
  const rarity = cardInfo(id)?.rarity;
  if (rarity) return rarity === 'starter';
  return /^CARD\.(STRIKE|DEFEND)(_[A-Z_]+)?$/.test(id);
}

export function computeStats(runs: NormalizedRun[]): StatsSummary {
  const total = runs.length;
  const wins = runs.filter((r) => r.win).length;
  const abandoned = runs.filter((r) => r.abandoned).length;
  const losses = total - wins - abandoned;
  const standard = runs.filter((r) => r.gameMode === 'standard');

  const times = runs.map((r) => r.runTimeSeconds).sort((a, b) => a - b);
  const totalSeconds = times.reduce((a, b) => a + b, 0);
  const activeSeconds = times.filter((t) => t <= AFK_THRESHOLD_SECONDS).reduce((a, b) => a + b, 0);
  const median = times.length ? times[Math.floor(times.length / 2)] : 0;

  let totalFloors = 0,
    dmg = 0,
    healed = 0,
    goldGained = 0,
    goldSpent = 0,
    goldStolen = 0,
    monsters = 0,
    combatRooms = 0,
    combatTurns = 0,
    elites = 0,
    bosses = 0,
    rests = 0,
    shops = 0,
    potionsUsed = 0,
    offered = 0,
    picked = 0,
    removed = 0,
    upgraded = 0;

  const fightCounts = new Map<string, number>();
  const restCounts = new Map<string, number>();
  const pickCounts = new Map<string, number>();

  for (const run of runs) {
    totalFloors += run.nodes.length;
    for (const node of run.nodes) {
      const s = node.stats;
      dmg += s.damageTaken;
      healed += s.hpHealed;
      goldGained += s.goldGained;
      goldSpent += s.goldSpent;
      goldStolen += s.goldStolen;
      potionsUsed += s.potionsUsed.length;
      offered += s.cardChoices.length;
      picked += s.cardChoices.filter((c) => c.wasPicked).length;
      removed += s.cardsRemoved.length;
      upgraded += s.cardsUpgraded.filter(Boolean).length;
      for (const choice of s.restChoices) restCounts.set(choice, (restCounts.get(choice) ?? 0) + 1);
      for (const ch of s.cardChoices) {
        if (ch.wasPicked) pickCounts.set(ch.card.id, (pickCounts.get(ch.card.id) ?? 0) + 1);
      }
      for (const room of node.rooms) {
        if (room.roomType === 'elite') elites++;
        if (room.roomType === 'boss') bosses++;
        if (room.roomType === 'rest_site') rests++;
        if (room.roomType === 'shop') shops++;
        if (room.monsterIds.length > 0) {
          combatRooms++;
          monsters += room.monsterIds.length;
          combatTurns += room.turnsTaken;
          if (room.modelId) fightCounts.set(room.modelId, (fightCounts.get(room.modelId) ?? 0) + 1);
        }
      }
    }
  }

  // Kill causes over non-abandoned losses
  const deathCounts = new Map<string, number>();
  for (const run of runs) {
    if (run.win || run.abandoned || !run.killedByEncounter) continue;
    deathCounts.set(run.killedByEncounter, (deathCounts.get(run.killedByEncounter) ?? 0) + 1);
  }
  const killCauses: KillCause[] = [...deathCounts.entries()]
    .map(([encounter, deaths]) => {
      const fought = fightCounts.get(encounter) ?? deaths;
      return { encounter, deaths, timesFought: fought, deathRatePct: Math.round((deaths / fought) * 100) };
    })
    .sort((a, b) => b.deaths - a.deaths || b.deathRatePct - a.deathRatePct);

  // Per character
  const byChar = new Map<string, NormalizedRun[]>();
  for (const run of runs) {
    const c = run.player.character;
    if (!byChar.has(c)) byChar.set(c, []);
    byChar.get(c)!.push(run);
  }
  const byCharacter: CharacterStats[] = [...byChar.entries()]
    .map(([character, rs]) => {
      const w = rs.filter((r) => r.win).length;
      const pickCounts = new Map<string, number>();
      for (const r of rs)
        for (const n of r.nodes)
          for (const ch of n.stats.cardChoices)
            if (ch.wasPicked) pickCounts.set(ch.card.id, (pickCounts.get(ch.card.id) ?? 0) + 1);
      const fav = [...pickCounts.entries()].sort((a, b) => b[1] - a[1])[0];
      return {
        character,
        runs: rs.length,
        wins: w,
        winRatePct: rs.length ? +(100 * (w / rs.length)).toFixed(1) : 0,
        avgAscension: rs.length ? +(rs.reduce((a, r) => a + r.ascension, 0) / rs.length).toFixed(2) : 0,
        maxAscension: Math.max(0, ...rs.map((r) => r.ascension)),
        avgFinalDeckSize: rs.length
          ? +(rs.reduce((a, r) => a + r.player.deck.length, 0) / rs.length).toFixed(1)
          : 0,
        favoriteCard: fav ? { id: fav[0], picks: fav[1] } : undefined,
      };
    })
    .sort((a, b) => b.winRatePct - a.winRatePct);

  // Best win streak (chronological)
  const chrono = [...runs].sort((a, b) => a.startTime - b.startTime);
  let streak = 0,
    best = 0;
  for (const run of chrono) {
    if (run.abandoned) continue;
    streak = run.win ? streak + 1 : 0;
    best = Math.max(best, streak);
  }

  // Quarter trend points
  const quarters: TrendPoint[] = [];
  if (chrono.length >= 8) {
    const qSize = Math.floor(chrono.length / 4);
    for (let q = 0; q < 4; q++) {
      const slice = chrono.slice(q * qSize, q === 3 ? chrono.length : (q + 1) * qSize);
      const w = slice.filter((r) => r.win).length;
      quarters.push({
        label: `Q${q + 1}`,
        runs: slice.length,
        wins: w,
        winRatePct: +((100 * w) / slice.length).toFixed(1),
        avgAscension: +(slice.reduce((a, r) => a + r.ascension, 0) / slice.length).toFixed(2),
      });
    }
  }

  const deathsByActMap = new Map<number, number>();
  for (const run of runs) {
    if (run.win || run.abandoned) continue;
    deathsByActMap.set(run.actsEntered, (deathsByActMap.get(run.actsEntered) ?? 0) + 1);
  }
  const maxAct = Math.max(0, ...deathsByActMap.keys());
  const deathsByAct = Array.from({ length: maxAct }, (_, i) => deathsByActMap.get(i + 1) ?? 0);

  const REST_ORDER = ['SMITH', 'HEAL', 'HATCH', 'DIG', 'COOK', 'LIFT', 'CLONE'];
  const restChoices: RestChoiceCount[] = [...restCounts.entries()]
    .map(([choice, count]) => ({ choice, count }))
    .sort((a, b) => {
      const ia = REST_ORDER.indexOf(a.choice);
      const ib = REST_ORDER.indexOf(b.choice);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || b.count - a.count;
    });

  const topPicks: PickCount[] = [...pickCounts.entries()]
    .filter(([id]) => !isStarterCard(id))
    .map(([id, n]) => ({ id, picks: n }))
    .sort((a, b) => b.picks - a.picks || a.id.localeCompare(b.id))
    .slice(0, 8);

  const ascMap = new Map<number, { runs: number; wins: number }>();
  for (const run of runs) {
    const row = ascMap.get(run.ascension) ?? { runs: 0, wins: 0 };
    row.runs += 1;
    if (run.win) row.wins += 1;
    ascMap.set(run.ascension, row);
  }
  const byAscension: AscensionRecord[] = [...ascMap.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ascension, row]) => ({
      ascension,
      runs: row.runs,
      wins: row.wins,
      winRatePct: row.runs ? +((100 * row.wins) / row.runs).toFixed(1) : 0,
    }));

  const dateFmt = (t: number) => new Date(t * 1000).toISOString().slice(0, 10);

  return {
    totalRuns: total,
    wins,
    losses,
    abandoned,
    winRatePct: total ? +((100 * wins) / total).toFixed(1) : 0,
    standardRuns: standard.length,
    standardWins: standard.filter((r) => r.win).length,
    totalHoursRaw: +(totalSeconds / 3600).toFixed(1),
    totalHoursActive: +(activeSeconds / 3600).toFixed(1),
    medianRunMinutes: +(median / 60).toFixed(1),
    totalFloors,
    totalDamageTaken: dmg,
    totalHpHealed: healed,
    totalGoldGained: goldGained,
    totalGoldSpent: goldSpent,
    totalGoldStolen: goldStolen,
    totalMonstersFaced: monsters,
    totalCombatRooms: combatRooms,
    totalCombatTurns: combatTurns,
    eliteFights: elites,
    bossFights: bosses,
    restSiteVisits: rests,
    shopVisits: shops,
    potionsUsed,
    cardsOffered: offered,
    cardsPicked: picked,
    cardsRemoved: removed,
    cardsUpgraded: upgraded,
    pickRatePct: offered ? +((100 * picked) / offered).toFixed(1) : 0,
    bestWinStreak: best,
    distinctSeeds: new Set(runs.map((r) => r.seed)).size,
    deathsByAct,
    byCharacter,
    killCauses,
    quarters,
    restChoices,
    topPicks,
    byAscension,
    firstRunDate: chrono.length ? dateFmt(chrono[0].startTime) : undefined,
    lastRunDate: chrono.length ? dateFmt(chrono[chrono.length - 1].startTime) : undefined,
  };
}
