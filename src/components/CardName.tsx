/**
 * CardName — listed card titles, colored as the card and with a hover
 * portrait. The card art carries its own name and frame; the tip adds the
 * rarity line the game would show ("Rare Attack · 2 Energy").
 */
import { cardArt } from '../lib/art';
import { cardColor, cardInfo, cardLabel } from '../lib/cards';
import { rarityColor } from '../lib/items';
import ArtName from './ArtName';

interface CardNameProps {
  id: string;
}

function cardMeta(id: string): string | undefined {
  const info = cardInfo(id);
  if (!info) return undefined;
  const kind = info.type[0].toUpperCase() + info.type.slice(1);
  const rarity = info.rarity[0].toUpperCase() + info.rarity.slice(1);
  const cost = info.cost == null ? '' : ` · ${info.cost === -1 ? 'X' : info.cost} Energy`;
  return `${rarity} ${kind}${cost}`;
}

export default function CardName({ id }: CardNameProps) {
  const info = cardInfo(id);
  return (
    <ArtName
      className="artName cardName"
      tipClass="artTip cardArtTip"
      label={cardLabel(id)}
      src={cardArt(id)}
      meta={cardMeta(id)}
      metaColor={rarityColor(info?.rarity)}
      color={cardColor(id)}
    />
  );
}
