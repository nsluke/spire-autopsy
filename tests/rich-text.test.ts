import { describe, expect, it } from 'vitest';
import { splitByNames } from '../src/lib/richText';

describe('splitByNames', () => {
  it('wraps an enemy name inside a coach sentence', () => {
    expect(splitByNames('Floor 12 was the wound: Skulking Colony took 47 HP.', ['Skulking Colony'])).toEqual([
      { type: 'text', value: 'Floor 12 was the wound: ' },
      { type: 'name', value: 'Skulking Colony' },
      { type: 'text', value: ' took 47 HP.' },
    ]);
  });

  it('prefers the longer name when one contains another', () => {
    const parts = splitByNames('The Kin Priest is not The Kin', ['The Kin Priest', 'The Kin']);
    expect(parts.map((p) => p.value)).toEqual(['The Kin Priest', ' is not ', 'The Kin']);
  });
});
