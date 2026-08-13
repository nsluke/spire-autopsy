/**
 * RichLine — a prose sentence that wraps known enemy, event, card, relic,
 * and potion names so they get the same hover tooltips as listed titles.
 */
import { cardLabel } from '../lib/cards';
import { displayName } from '../lib/idFormat';
import { potionLabel, relicLabel } from '../lib/items';
import { splitByNames } from '../lib/richText';
import CardName from './CardName';
import EnemyName from './EnemyName';
import { PotionName, RelicName } from './ItemName';
import { EventName } from './PlaceName';

interface Props {
  text: string;
  enemyIds?: string[];
  cardIds?: string[];
  relicIds?: string[];
  potionIds?: string[];
}

type Kind = 'enemy' | 'event' | 'card' | 'relic' | 'potion';

export default function RichLine({ text, enemyIds, cardIds, relicIds, potionIds }: Props) {
  const all: { id: string; name: string; kind: Kind }[] = [
    ...(enemyIds ?? []).map((id) => ({
      id,
      name: displayName(id),
      kind: id.startsWith('EVENT.') ? ('event' as const) : ('enemy' as const),
    })),
    ...(cardIds ?? []).map((id) => ({ id, name: cardLabel(id), kind: 'card' as const })),
    ...(relicIds ?? []).map((id) => ({ id, name: relicLabel(id), kind: 'relic' as const })),
    ...(potionIds ?? []).map((id) => ({ id, name: potionLabel(id), kind: 'potion' as const })),
  ].filter((e) => e.name);
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
        switch (ent.kind) {
          case 'event':
            return <EventName key={i} id={ent.id} label={ent.name} />;
          case 'enemy':
            return <EnemyName key={i} id={ent.id} />;
          case 'card':
            return <CardName key={i} id={ent.id} />;
          case 'relic':
            return <RelicName key={i} id={ent.id} />;
          case 'potion':
            return <PotionName key={i} id={ent.id} />;
        }
      })}
    </>
  );
}
