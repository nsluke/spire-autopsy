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

/**
 * First sentence of a copy block — the curt form the UI leads with. Copy is
 * dense with decimals ("Wins average 2.4 elites"), so a terminator only
 * counts when followed by a space and a capital, or the end of the text.
 */
export function firstSentence(text: string): string {
  const match = text.match(/^.*?[.!?](?=\s+[A-Z“"(]|\s*$)/s);
  return match ? match[0].trim() : text;
}
