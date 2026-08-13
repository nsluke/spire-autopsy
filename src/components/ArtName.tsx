/**
 * ArtName — a labeled entity with an optional hover portrait, portaled so
 * overflow:hidden on lists cannot clip it. Missing art leaves the text only.
 */
import { useCallback, useId, useState, type FocusEvent, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import ArtImg from './ArtImg';
import '../styles/card-name.css';

interface ArtNameProps {
  label: string;
  src?: string;
  color?: string;
  className?: string;
  tipClass?: string;
}

export default function ArtName({ label, src, color, className = 'artName', tipClass = 'artTip' }: ArtNameProps) {
  const tipId = useId();
  const [anchor, setAnchor] = useState<{ x: number; y: number; below: boolean } | null>(null);

  const show = useCallback(
    (el: HTMLElement) => {
      if (!src) return;
      const r = el.getBoundingClientRect();
      setAnchor({
        x: r.left + r.width / 2,
        y: r.top,
        below: r.top < 280,
      });
    },
    [src],
  );

  function onEnter(e: MouseEvent<HTMLSpanElement> | FocusEvent<HTMLSpanElement>) {
    show(e.currentTarget);
  }

  return (
    <>
      <span
        className={className}
        style={color ? { color } : undefined}
        tabIndex={src ? 0 : undefined}
        onMouseEnter={onEnter}
        onMouseLeave={() => setAnchor(null)}
        onFocus={onEnter}
        onBlur={() => setAnchor(null)}
        aria-describedby={anchor ? tipId : undefined}
      >
        {label}
      </span>
      {anchor &&
        src &&
        createPortal(
          <span
            id={tipId}
            className={anchor.below ? `${tipClass} below` : tipClass}
            style={{ left: anchor.x, top: anchor.below ? anchor.y + 22 : anchor.y }}
            role="tooltip"
          >
            <ArtImg src={src} alt="" />
          </span>,
          document.body,
        )}
    </>
  );
}
