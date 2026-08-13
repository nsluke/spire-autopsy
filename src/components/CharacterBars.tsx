/**
 * Win rate by character: direct-labeled horizontal bars filled with the
 * colorblind-validated character colors, plus the signature-pick line.
 * Bars are scaled relative to the best character's rate; the exact
 * percentage AND the raw fraction are always printed next to each bar,
 * so color never carries the information alone.
 */
import { characterArt } from '../lib/art';
import { characterColor, characterName } from '../lib/idFormat';
import type { CharacterStats } from '../lib/types';
import ArtImg from './ArtImg';
import CardName from './CardName';

interface CharacterBarsProps {
  byCharacter: CharacterStats[];
}

export default function CharacterBars({ byCharacter }: CharacterBarsProps) {
  if (byCharacter.length === 0) return null;

  // byCharacter arrives sorted by win rate (descending) from computeStats.
  const maxRate = Math.max(1, ...byCharacter.map((c) => c.winRatePct));

  const signatures = byCharacter
    .filter((c) => c.favoriteCard)
    .map((c) => ({ character: c.character, id: c.favoriteCard!.id }));

  return (
    <section>
      <h2 className="sectionTitle">Win rate by character</h2>
      {byCharacter.map((c) => (
        <div className="cbar" key={c.character}>
          <span className="nm">
            <ArtImg src={characterArt(c.character)} className="cbarArt" />
            {characterName(c.character)}
          </span>
          <div className="tr" aria-hidden="true">
            <div
              className="fl"
              style={{
                width: `${Math.min(100, (c.winRatePct / maxRate) * 82).toFixed(1)}%`,
                background: characterColor(c.character),
              }}
            />
          </div>
          <span className="vl num">
            {c.winRatePct.toFixed(1)}%{' '}
            <span>
              {c.wins}/{c.runs} · A{c.maxAscension}
            </span>
          </span>
        </div>
      ))}
      {signatures.length > 0 && (
        <p className="sigLine">
          Signature picks —{' '}
          {signatures.map((s, i) => (
            <span key={s.character}>
              {i > 0 && ' · '}
              {characterName(s.character)}: <CardName id={s.id} />
            </span>
          ))}
        </p>
      )}
    </section>
  );
}
