/**
 * Deaths by act: a mini bar strip. Each bar carries its count directly
 * above it and its act label below — the color is decoration, the numbers
 * are the data.
 */
import { fmtInt } from '../lib/idFormat';

const MAX_BAR_PX = 56;

interface DeathsByActProps {
  deathsByAct: number[];
}

export default function DeathsByAct({ deathsByAct }: DeathsByActProps) {
  const total = deathsByAct.reduce((a, b) => a + b, 0);
  const max = Math.max(1, ...deathsByAct);
  const deadliest = deathsByAct.indexOf(Math.max(0, ...deathsByAct)) + 1;

  return (
    <section>
      <h2 className="sectionTitle">Deaths by act</h2>
      {total === 0 ? (
        <p className="emptyNote">No deaths in this set of runs — nothing to bury here.</p>
      ) : (
        <>
          <div className="actStrip">
            {deathsByAct.map((n, i) => (
              <div className="actCol" key={i}>
                <span className="actCount">{fmtInt(n)}</span>
                <div
                  className="actBar"
                  style={{ height: `${Math.max(2, Math.round((n / max) * MAX_BAR_PX))}px` }}
                  aria-hidden="true"
                />
                <span className="actLbl">Act {i + 1}</span>
              </div>
            ))}
          </div>
          <p className="miniMeta num">
            {fmtInt(total)} {total === 1 ? 'death' : 'deaths'} · most in Act {deadliest}
          </p>
        </>
      )}
    </section>
  );
}
