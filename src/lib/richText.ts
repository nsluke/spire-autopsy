/**
 * splitByNames — carve display names out of a prose line so the view can wrap
 * each hit in EnemyName / CardName. Longest name wins when one contains another.
 */
export type NamedSpan = { type: 'text' | 'name'; value: string };

export function splitByNames(text: string, names: string[]): NamedSpan[] {
  const unique = [...new Set(names.filter((n) => n.length > 0))].sort((a, b) => b.length - a.length);
  if (unique.length === 0) return [{ type: 'text', value: text }];
  const re = new RegExp(`(${unique.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`);
  const out: NamedSpan[] = [];
  for (const part of text.split(re)) {
    if (!part) continue;
    out.push({ type: unique.includes(part) ? 'name' : 'text', value: part });
  }
  return out.length > 0 ? out : [{ type: 'text', value: text }];
}
