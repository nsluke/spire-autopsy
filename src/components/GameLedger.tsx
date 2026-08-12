/**
 * "The game's own ledger" — renders a stored progress.save summary. Works
 * with zero imported runs (the cold-start quick look) and as a Dashboard
 * section beside our run-computed numbers. Sourced from the GAME's tallies,
 * which count standard solo runs only — labeled as such, never mixed with
 * our run-frame stats.
 */
import { cardInfo } from '../lib/cards';
import { characterColor, characterName, displayName, fmtInt } from '../lib/idFormat';
import type { Ledger } from '../lib/ledger';
import '../styles/ledger.css';

export default function GameLedger({ ledger }: { ledger: Ledger }) {
  return (
    <section aria-label="The game's own ledger, from progress.save">
      <h2 className="sectionTitle">The game’s own ledger</h2>
      <p className="ledgerNote">
        From progress.save — the game’s lifetime tallies for standard solo runs
        {ledger.playtimeHours !== undefined && (
          <>
            {' '}
            · <span className="num">{ledger.playtimeHours}</span>h in the Spire
          </>
        )}
        {ledger.floorsClimbed !== undefined && (
          <>
            {' '}
            · <span className="num">{fmtInt(ledger.floorsClimbed)}</span> floors climbed
          </>
        )}
      </p>
      <div className="ledgerChars">
        {ledger.characters.map((c) => (
          <div className="ledgerChar" key={c.character} style={{ borderColor: characterColor(c.character) }}>
            <span className="ledgerName" style={{ color: characterColor(c.character) }}>
              {characterName(c.character)}
            </span>
            <span className="ledgerWall num">wall A{c.wall}</span>
            <span className="ledgerRecord num">
              {c.wins}–{c.losses}
            </span>
            {c.bestStreak > 1 && <span className="ledgerMeta num">streak {c.bestStreak}</span>}
            {c.fastestWinSeconds !== undefined && (
              <span className="ledgerMeta num">best {Math.round(c.fastestWinSeconds / 60)}m</span>
            )}
          </div>
        ))}
      </div>
      {(ledger.topKillers.length > 0 || ledger.topPicked.length > 0) && (
        <p className="ledgerNote">
          {ledger.topKillers.length > 0 && (
            <>
              Most runs ended by{' '}
              {ledger.topKillers.map((k, i) => (
                <span key={k.encounter}>
                  {i > 0 && ', '}
                  <b>{displayName(k.encounter)}</b> <span className="num">×{k.losses}</span>
                </span>
              ))}
            </>
          )}
          {ledger.topKillers.length > 0 && ledger.topPicked.length > 0 && ' · '}
          {ledger.topPicked.length > 0 && (
            <>
              most-picked cards:{' '}
              {ledger.topPicked.map((c, i) => (
                <span key={c.card}>
                  {i > 0 && ', '}
                  {cardInfo(c.card)?.name ?? displayName(c.card)}
                </span>
              ))}
            </>
          )}
        </p>
      )}
    </section>
  );
}
