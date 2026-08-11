/**
 * Lifetime share card — a 1200×630 PNG rendered entirely client-side with
 * Canvas. This is the artifact people post to Discord/Reddit, so it carries
 * the site's identity: torchlit ground, ember accent, character colors,
 * the nemesis sprite. Same-origin art keeps the canvas untainted.
 */
import { characterColor, characterName, displayName } from './idFormat';
import { monsterArt } from './art';
import type { StatsSummary } from './types';

const W = 1200;
const H = 630;

const COLORS = {
  ground: '#131010',
  surface: '#1E1813',
  ink: '#EDE4D3',
  ink2: '#C8BBA2',
  muted: '#9C8D74',
  ember: '#E8A33D',
  loss: '#CC5A4E',
};

function loadImage(src: string): Promise<HTMLImageElement | undefined> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(undefined);
    img.src = src;
  });
}

export async function renderLifetimeCard(stats: StatsSummary): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const sans = '-apple-system, "Segoe UI", system-ui, sans-serif';
  const serif = '"Iowan Old Style", Palatino, Georgia, serif';
  const mono = 'ui-monospace, "SF Mono", Menlo, monospace';

  // ground + ember glow + vignette
  ctx.fillStyle = COLORS.ground;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(W / 2, -80, 60, W / 2, -80, 640);
  glow.addColorStop(0, 'rgba(232,163,61,0.14)');
  glow.addColorStop(1, 'rgba(232,163,61,0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
  const vig = ctx.createRadialGradient(W / 2, H / 2, H / 2, W / 2, H / 2, H);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, W, H);

  // brand
  ctx.fillStyle = COLORS.ember;
  ctx.font = `28px ${serif}`;
  ctx.fillText('✝', 56, 74);
  ctx.fillStyle = COLORS.ink;
  ctx.font = `600 30px ${serif}`;
  ctx.fillText('Spire Autopsy', 84, 74);
  ctx.fillStyle = COLORS.muted;
  ctx.font = `15px ${mono}`;
  const period = stats.firstRunDate && stats.lastRunDate ? `${stats.firstRunDate} → ${stats.lastRunDate}` : '';
  ctx.textAlign = 'right';
  ctx.fillText(period, W - 56, 70);
  ctx.textAlign = 'left';

  // headline stats
  const tiles: [string, string, string][] = [
    ['RUNS', String(stats.totalRuns), `${stats.wins} wins · ${stats.winRatePct}%`],
    ['FLOORS', stats.totalFloors.toLocaleString(), `${stats.totalMonstersFaced.toLocaleString()} monsters felled`],
    ['DAMAGE TANKED', stats.totalDamageTaken.toLocaleString(), `healed ${stats.totalHpHealed.toLocaleString()}`],
    ['BEST STREAK', String(stats.bestWinStreak), `${stats.totalHoursActive}h in the Spire`],
  ];
  tiles.forEach(([k, v, d], i) => {
    const x = 56 + i * 278;
    ctx.fillStyle = COLORS.muted;
    ctx.font = `600 13px ${mono}`;
    ctx.fillText(k, x, 140);
    ctx.fillStyle = COLORS.ink;
    ctx.font = `700 52px ${sans}`;
    ctx.fillText(v, x, 196);
    ctx.fillStyle = COLORS.ink2;
    ctx.font = `16px ${sans}`;
    ctx.fillText(d, x, 224);
  });

  // character win-rate bars (left column)
  ctx.fillStyle = COLORS.muted;
  ctx.font = `600 13px ${mono}`;
  ctx.fillText('WIN RATE BY CHARACTER', 56, 292);
  const maxRate = Math.max(1, ...stats.byCharacter.map((c) => c.winRatePct));
  stats.byCharacter.slice(0, 5).forEach((c, i) => {
    const y = 320 + i * 44;
    ctx.fillStyle = COLORS.ink2;
    ctx.font = `17px ${sans}`;
    ctx.fillText(characterName(c.character), 56, y + 14);
    ctx.fillStyle = 'rgba(237,228,211,0.08)';
    ctx.fillRect(200, y, 330, 14);
    ctx.fillStyle = characterColor(c.character);
    ctx.fillRect(200, y, Math.max(4, (c.winRatePct / maxRate) * 330), 14);
    ctx.fillStyle = COLORS.ink;
    ctx.font = `600 16px ${sans}`;
    ctx.fillText(`${c.winRatePct.toFixed(1)}%`, 546, y + 14);
    ctx.fillStyle = COLORS.muted;
    ctx.font = `13px ${mono}`;
    ctx.fillText(`${c.wins}/${c.runs}`, 610, y + 13);
  });

  // nemesis (right column) with sprite
  const nemesis = stats.killCauses.filter((k) => k.timesFought >= 10)[0] ?? stats.killCauses[0];
  if (nemesis) {
    ctx.fillStyle = COLORS.muted;
    ctx.font = `600 13px ${mono}`;
    ctx.fillText('NEMESIS', 720, 292);
    const img = await loadImage(monsterArt(nemesis.encounter) ?? '');
    if (img) {
      const size = 190;
      const ratio = Math.min(size / img.width, size / img.height);
      const dw = img.width * ratio;
      const dh = img.height * ratio;
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 24;
      ctx.drawImage(img, 720 + (size - dw) / 2, 316 + (size - dh) / 2, dw, dh);
      ctx.restore();
    }
    ctx.fillStyle = COLORS.ink;
    ctx.font = `600 26px ${serif}`;
    ctx.fillText(displayName(nemesis.encounter), 940, 360);
    ctx.fillStyle = COLORS.loss;
    ctx.font = `700 44px ${sans}`;
    ctx.fillText(`${nemesis.deathRatePct}%`, 940, 412);
    ctx.fillStyle = COLORS.ink2;
    ctx.font = `16px ${sans}`;
    ctx.fillText(`${nemesis.deaths} kills in ${nemesis.timesFought} meetings`, 940, 440);
  }

  // footer
  ctx.strokeStyle = 'rgba(237,228,211,0.12)';
  ctx.beginPath();
  ctx.moveTo(56, H - 74);
  ctx.lineTo(W - 56, H - 74);
  ctx.stroke();
  ctx.fillStyle = COLORS.muted;
  ctx.font = `14px ${mono}`;
  ctx.fillText('computed locally from my run files · nothing uploaded', 56, H - 42);
  ctx.textAlign = 'right';
  ctx.fillStyle = COLORS.ember;
  ctx.fillText('spire autopsy', W - 56, H - 42);
  ctx.textAlign = 'left';

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('canvas export failed'))), 'image/png');
  });
}

export async function downloadLifetimeCard(stats: StatsSummary): Promise<void> {
  const blob = await renderLifetimeCard(stats);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'spire-autopsy-card.png';
  a.click();
  URL.revokeObjectURL(url);
}
