/**
 * ArtImg — an <img> that vanishes if its file is missing, so partial art
 * coverage never leaves broken-image icons. Decorative by default (alt="")
 * because the entity's name is always present as adjacent text.
 */
import { useState } from 'react';

interface Props {
  src: string | undefined;
  alt?: string;
  className?: string;
}

export default function ArtImg({ src, alt = '', className }: Props) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return null;
  return (
    <img src={src} alt={alt} className={className} loading="lazy" draggable={false} onError={() => setFailed(true)} />
  );
}
