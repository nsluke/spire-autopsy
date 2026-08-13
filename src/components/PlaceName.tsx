/**
 * PlaceName — map-node titles (campfire, shop, chest, event) with a hover
 * card: the map icon or event illustration, plus a short "what this does".
 */
import { FLOOR_KIND_LABEL, restLabel, type FloorKind } from '../lib/floorLog';
import { eventArt, eventLabel, mapArt, placeBlurb, placeColor, restBlurb } from '../lib/places';
import ArtName from './ArtName';

interface PlaceNameProps {
  kind: FloorKind;
  eventId?: string;
  rest?: string;
  label?: string;
}

export default function PlaceName({ kind, eventId, rest, label }: PlaceNameProps) {
  const text = label ?? (rest ? restLabel(rest) : eventId ? eventLabel(eventId) : FLOOR_KIND_LABEL[kind]);
  const src = eventArt(eventId) ?? mapArt(kind);
  const blurb = rest ? restBlurb(rest) : placeBlurb(kind, eventId);
  return (
    <ArtName
      className="artName placeName"
      tipClass="artTip placeTip"
      label={text}
      src={src}
      blurb={blurb}
      color={placeColor(kind)}
    />
  );
}

/** EVENT.* titles — same hover card, used in slain-by lines and coach copy. */
export function EventName({ id, label }: { id: string; label?: string }) {
  return <PlaceName kind="event" eventId={id} label={label} />;
}
