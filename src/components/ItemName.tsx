/**
 * RelicName / PotionName — item names colored by rarity, with the full
 * STS2-style hover tooltip: icon, rarity line, rules text, flavor.
 */
import { itemMeta, potionInfo, potionLabel, relicInfo, relicLabel, rarityColor } from '../lib/items';
import ArtName from './ArtName';

export function RelicName({ id }: { id: string }) {
  const info = relicInfo(id);
  return (
    <ArtName
      className="artName relicName"
      tipClass="artTip itemTip"
      label={relicLabel(id)}
      icon={info?.art}
      src={info?.art}
      blurb={info?.blurb}
      meta={info ? itemMeta(info, 'relic') : undefined}
      metaColor={rarityColor(info?.rarity)}
      flavor={info?.flavor}
      color={info ? rarityColor(info.rarity) : undefined}
    />
  );
}

export function PotionName({ id }: { id: string }) {
  const info = potionInfo(id);
  return (
    <ArtName
      className="artName potionName"
      tipClass="artTip itemTip"
      label={potionLabel(id)}
      icon={info?.art}
      src={info?.art}
      blurb={info?.blurb}
      meta={info ? itemMeta(info, 'potion') : undefined}
      metaColor={rarityColor(info?.rarity)}
      flavor={info?.flavor}
      color={info ? rarityColor(info.rarity) : undefined}
    />
  );
}
