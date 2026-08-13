/**
 * CardName — listed card titles, colored as the card and with a hover portrait.
 */
import { cardArt } from '../lib/art';
import { cardColor, cardLabel } from '../lib/cards';
import ArtName from './ArtName';

interface CardNameProps {
  id: string;
}

export default function CardName({ id }: CardNameProps) {
  return <ArtName className="artName cardName" label={cardLabel(id)} src={cardArt(id)} color={cardColor(id)} />;
}
