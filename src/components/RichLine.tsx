/**
 * RichLine — a prose sentence that wraps known enemy (and card) names so they
 * get the same hover portraits as listed titles.
 */
import { cardLabel } from '../lib/cards';
import { displayName } from '../lib/idFormat';
import { splitByNames } from '../lib/richText';
import CardName from './CardName';
import EnemyName from './EnemyName';

interface Props {
  text: string;
  enemyIds?: string[];
  cardIds?: string[];
}

export default function RichLine({ text, enemyIds, cardIds }: Props) {
  const enemies = (enemyIds ?? []).map((id) => ({ id, name: displayName(id), kind: 'enemy' as const }));
  const cards = (cardIds ?? []).map((id) => ({ id, name: cardLabel(id), kind: 'card' as const }));
  const all = [...enemies, ...cards].filter((e) => e.name);
  if (all.length === 0) return <>{text}</>;

  const byName = new Map(all.map((e) => [e.name, e]));
  const parts = splitByNames(
    text,
    all.map((e) => e.name),
  );

  return (
    <>
      {parts.map((part, i) => {
        if (part.type === 'text') return <span key={i}>{part.value}</span>;
        const ent = byName.get(part.value);
        if (!ent) return <span key={i}>{part.value}</span>;
        return ent.kind === 'enemy' ? <EnemyName key={i} id={ent.id} /> : <CardName key={i} id={ent.id} />;
      })}
    </>
  );
}
