import { describe, expect, it } from 'vitest';
import {
  biggestHit,
  debuffsApplied,
  dossier,
  enemyBlurb,
  enemyInfo,
  intentDamage,
  isMultiHit,
  memberHp,
} from '../src/lib/enemies';

describe('enemy lookup', () => {
  it('resolves a boss encounter id to its wiki entry', () => {
    const q = enemyInfo('ENCOUNTER.QUEEN_BOSS');
    expect(q?.name).toBe('Queen');
    expect(q?.hp).toBe('400');
    expect(q?.ascHp).toBe('419');
    expect(q?.intents?.length).toBeGreaterThan(3);
  });

  it('folds the ascension damage template into readable text', () => {
    const intents = enemyInfo('ENCOUNTER.QUEEN_BOSS')!.intents!;
    expect(intents.find((i) => i.name === 'Execution')?.text).toBe('Deals 15 (18 at A9+) damage.');
  });

  it('resolves MONSTER ids, including the ones the game spells differently', () => {
    expect(enemyInfo('MONSTER.MYSTERIOUS_KNIGHT')?.hp).toBe('101');
    expect(enemyInfo('MONSTER.ASSASSIN_RUBY_RAIDER')?.name).toBe('Assassin Raider');
  });

  it('singularizes plural encounters the wiki keys one at a time', () => {
    expect(enemyInfo('ENCOUNTER.INKLETS_NORMAL')?.name).toBe('Inklet');
    expect(enemyInfo('ENCOUNTER.INFESTED_PRISMS_ELITE')?.name).toBe('Infested Prism');
    // plural in the middle of the name, which the suffix rule cannot reach
    expect(enemyInfo('ENCOUNTER.SCROLLS_OF_BITING_WEAK')?.name).toBe('Scroll of Biting');
  });

  it('returns undefined rather than guessing at an undocumented fight', () => {
    // Kaiser Crab is in the run files but not on the wiki.
    expect(enemyInfo('ENCOUNTER.KAISER_CRAB_BOSS')).toBeUndefined();
    expect(dossier('ENCOUNTER.KAISER_CRAB_BOSS')).toBeUndefined();
    expect(enemyBlurb('ENCOUNTER.KAISER_CRAB_BOSS')).toBeUndefined();
  });
});

describe('encounter dossiers', () => {
  it('assembles a group encounter from its roster', () => {
    const d = dossier('ENCOUNTER.KNIGHTS_ELITE')!;
    expect(d.isGroup).toBe(true);
    expect(d.type).toBe('Elite');
    expect(d.members.map((m) => m.name)).toContain('Flail Knight');
    // the Knight Gang entry carries the roster but no HP of its own, so it
    // must not make the combined total unknown
    expect(d.totalHp).toBeGreaterThan(0);
  });

  it('scales HP at A8, where enemies get harder to kill', () => {
    const q = enemyInfo('ENCOUNTER.QUEEN_BOSS')!;
    expect(memberHp(q, 0)).toBe(400);
    expect(memberHp(q, 7)).toBe(400);
    expect(memberHp(q, 8)).toBe(419);
    expect(dossier('ENCOUNTER.QUEEN_BOSS', 8)!.totalHp).toBe(419);
  });

  it('reads HP ranges from their low end', () => {
    expect(memberHp(enemyInfo('MONSTER.BOWLBUG_ROCK')!, 0)).toBe(45);
  });
});

describe('reading the fight', () => {
  it('totals multi-hit damage instead of reading the per-hit number', () => {
    expect(intentDamage('Deals 3 (4 at A9+) damage x5.')).toBe(15);
    expect(intentDamage('Deals 15 (18 at A9+) damage.')).toBe(15);
    expect(intentDamage('Deals 6 (7 at A9+) damage ×4.')).toBe(24);
    expect(intentDamage('Gains 2 Strength.')).toBeUndefined();
  });

  it('names the hardest hit in the encounter', () => {
    expect(biggestHit(dossier('ENCOUNTER.SOUL_NEXUS_ELITE')!)?.name).toBe('Soul Burn');
  });

  it('flags fights whose damage arrives in swings, where block beats raw HP', () => {
    expect(isMultiHit(dossier('ENCOUNTER.QUEEN_BOSS')!)).toBe(true);
  });

  it('lists the debuffs a fight applies', () => {
    const d = debuffsApplied(dossier('ENCOUNTER.QUEEN_BOSS')!);
    expect(d).toContain('Frail');
    expect(d).toContain('Weak');
    expect(d).toContain('Vulnerable');
  });

  it('writes a tooltip line carrying HP and the hardest hit', () => {
    const blurb = enemyBlurb('ENCOUNTER.QUEEN_BOSS', 0)!;
    expect(blurb).toContain('400 HP');
    expect(blurb).toContain('Off with Your Head');
  });
});
