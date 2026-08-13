/**
 * ArtName — a labeled entity with a hover tooltip, portaled so
 * overflow:hidden on lists cannot clip it. The tip can be a bare portrait
 * (cards, enemies) or a framed STS2-style tooltip: title bar, portrait,
 * rarity meta line, rules text, flavor line. Missing art leaves the text
 * only, unless copy is supplied — then hover still explains.
 */
import { useCallback, useId, useState, type FocusEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import ArtImg from './ArtImg';
import '../styles/card-name.css';

interface ArtNameProps {
  label: string;
  /** Tip title bar text when it should differ from the inline label. */
  tipTitle?: string;
  src?: string;
  /** Small inline icon shown before the label itself (relics, potions). */
  icon?: string;
  /** Rules text — its presence upgrades the tip to the framed tooltip. */
  blurb?: string;
  /** Small-caps line: "Rare Relic · Ironclad". Framed tip only. */
  meta?: string;
  metaColor?: string;
  /** Italic flavor line under the rules text. */
  flavor?: string;
  color?: string;
  className?: string;
  tipClass?: string;
}

export default function ArtName({
  label,
  tipTitle,
  src,
  icon,
  blurb,
  meta,
  metaColor,
  flavor,
  color,
  className = 'artName',
  tipClass = 'artTip',
}: ArtNameProps) {
  const tipId = useId();
  const [anchor, setAnchor] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const framed = Boolean(blurb || meta);
  const hasTip = Boolean(src || framed);

  const show = useCallback(
    (el: HTMLElement) => {
      if (!hasTip) return;
      const r = el.getBoundingClientRect();
      setAnchor({
        x: r.left + r.width / 2,
        y: r.top - 8,
        below: r.top < 300,
      });
    },
    [hasTip],
  );

  function onEnter(e: MouseEvent<HTMLSpanElement> | FocusEvent<HTMLSpanElement>) {
    show(e.currentTarget);
  }

  const tipClassName = [tipClass, anchor?.below ? 'below' : '', framed ? 'framed' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <>
      <span
        className={className}
        style={color ? { color } : undefined}
        tabIndex={hasTip ? 0 : undefined}
        onMouseEnter={onEnter}
        onMouseLeave={() => setAnchor(null)}
        onFocus={onEnter}
        onBlur={() => setAnchor(null)}
        aria-describedby={anchor ? tipId : undefined}
      >
        {icon ? <ArtImg src={icon} className="artInlineIcon" /> : null}
        {label}
      </span>
      {anchor &&
        hasTip &&
        createPortal(
          <span
            id={tipId}
            className={tipClassName}
            style={{ left: anchor.x, top: anchor.below ? anchor.y + 22 : anchor.y }}
            role="tooltip"
          >
            {blurb ? <span className="artTipTitle">{tipTitle ?? label}</span> : null}
            {src ? <ArtImg src={src} alt="" /> : null}
            {meta ? (
              <span className="artTipMeta" style={metaColor ? { color: metaColor } : undefined}>
                {meta}
              </span>
            ) : null}
            {blurb ? <span className="artBlurb">{blurb}</span> : null}
            {flavor ? <span className="artTipFlavor">{flavor}</span> : null}
          </span>,
          document.body,
        )}
    </>
  );
}
