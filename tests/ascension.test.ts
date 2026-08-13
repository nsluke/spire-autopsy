import { describe, expect, it } from 'vitest';
import { ascensionBlurb, ascensionMeta, ASCENSION_MAX, ASCENSION_RULES } from '../src/lib/ascension';

describe('ascension modifiers', () => {
  it('carries all ten climb rules', () => {
    expect(Object.keys(ASCENSION_RULES)).toHaveLength(ASCENSION_MAX);
    expect(ascensionBlurb(1)).toBe('Elites spawn more often.');
    expect(ascensionBlurb(5)).toMatch(/cursed/);
    expect(ascensionBlurb(5)).toMatch(/Every rule below/);
  });

  it('handles the edges: base climb and past-max levels', () => {
    expect(ascensionBlurb(0)).toMatch(/base climb/i);
    expect(ascensionBlurb(99)).toMatch(/two Bosses/);
    expect(ascensionMeta(0)).toBe('Base climb');
    expect(ascensionMeta(10)).toMatch(/max level/);
  });

  it('never tells the player to climb down', () => {
    for (let level = 0; level <= 10; level += 1) {
      expect(ascensionBlurb(level)).not.toMatch(/lower|easier|settle|step down/i);
    }
  });
});
