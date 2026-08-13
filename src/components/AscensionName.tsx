/**
 * AscensionName — an "A5" chip that explains itself: hover shows the rule
 * that level adds and the reminder that lower rules stack.
 */
import { ascensionBlurb, ascensionMeta } from '../lib/ascension';
import ArtName from './ArtName';

interface Props {
  level: number;
  /** Override the visible text (defaults to "A<level>"). */
  label?: string;
  className?: string;
}

export default function AscensionName({ level, label, className = 'artName ascName num' }: Props) {
  return (
    <ArtName
      className={className}
      tipClass="artTip ascTip"
      label={label ?? `A${level}`}
      tipTitle={`Ascension ${level}`}
      blurb={ascensionBlurb(level)}
      meta={ascensionMeta(level)}
      metaColor="var(--ember)"
    />
  );
}
