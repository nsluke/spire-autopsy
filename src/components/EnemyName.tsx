/**
 * EnemyName — encounter/monster titles with a hover portrait when we have art.
 * Bosses and elites pick up the same colors the autopsy floor log uses.
 */
import { monsterArt } from '../lib/art';
import { displayName, encounterTier } from '../lib/idFormat';
import ArtName from './ArtName';

interface EnemyNameProps {
  id: string;
}

function enemyColor(id: string): string | undefined {
  const tier = encounterTier(id);
  if (tier === 'boss') return 'var(--loss)';
  if (tier === 'elite') return 'var(--ember)';
  return undefined;
}

export default function EnemyName({ id }: EnemyNameProps) {
  return (
    <ArtName
      className="artName enemyName"
      tipClass="artTip enemyTip"
      label={displayName(id)}
      src={monsterArt(id)}
      color={enemyColor(id)}
    />
  );
}
