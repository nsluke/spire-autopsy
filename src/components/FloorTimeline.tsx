/**
 * FloorTimeline — the run as a downward log: every floor, what was there,
 * what you took, and what it cost. Sits under the coach's read; hovering a
 * row rings the same floor on the HP chart.
 */
import { FLOOR_KIND_LABEL, floorFacts, hpTone, momentsOnFloor, type FloorFacts } from '../lib/floorLog';
import { displayName } from '../lib/idFormat';
import { floorThumb } from '../lib/places';
import type { AutopsyMoment, NormalizedRun } from '../lib/types';
import ArtImg from './ArtImg';
import CardName from './CardName';
import EnemyName from './EnemyName';
import { PotionName, RelicName } from './ItemName';
import PlaceName from './PlaceName';

interface Props {
  run: NormalizedRun;
  moments: AutopsyMoment[];
  highlightFloors?: number[];
  onFloorHover?: (floor: number | null) => void;
}

const MOMENT_LABEL: Partial<Record<AutopsyMoment['kind'], string>> = {
  spike: 'spike',
  'point-of-no-return': 'no return',
  'boss-entry': 'entry',
  death: 'death',
  clutch: 'clutch',
  heal: 'heal',
};

export default function FloorTimeline({ run, moments, highlightFloors, onFloorHover }: Props) {
  if (run.nodes.length === 0) return null;
  const lit = new Set(highlightFloors ?? []);
  const acts: { act: number; name?: string; nodes: typeof run.nodes }[] = [];
  for (const node of run.nodes) {
    const last = acts[acts.length - 1];
    if (!last || last.act !== node.act) {
      acts.push({ act: node.act, name: run.acts[node.act - 1], nodes: [node] });
    } else {
      last.nodes.push(node);
    }
  }

  return (
    <section className="panel floorLog" aria-label="Floor-by-floor timeline">
      <h2 className="sectionTitle">The floors</h2>
      <p className="floorLogLead">
        Every floor, top to bottom. Red is damage, green is healing. Hover anything for
        what it does.
      </p>
      <ol className="floorList">
        {acts.map((group) => (
          <li key={group.act} className="floorAct">
            <h3 className="floorActTitle">
              Act {['I', 'II', 'III', 'IV'][group.act - 1] ?? group.act}
              {group.name ? <span> · {displayName(group.name)}</span> : null}
            </h3>
            <ol className="floorActList">
              {group.nodes.map((node) => {
                const facts = floorFacts(node, run.player.relics);
                const on = lit.has(facts.floor);
                return (
                  <li
                    key={facts.floor}
                    id={`autopsy-fl-${facts.floor}`}
                    className={`floorRow kind-${facts.kind}${on ? ' on' : ''}`}
                    onMouseEnter={() => onFloorHover?.(facts.floor)}
                    onMouseLeave={() => onFloorHover?.(null)}
                    onFocus={() => onFloorHover?.(facts.floor)}
                    onBlur={() => onFloorHover?.(null)}
                  >
                    <FloorRow facts={facts} chips={momentsOnFloor(moments, facts.floor)} />
                  </li>
                );
              })}
            </ol>
          </li>
        ))}
      </ol>
    </section>
  );
}

function FloorRow({ facts, chips }: { facts: FloorFacts; chips: AutopsyMoment[] }) {
  const tone = hpTone(facts.hp, facts.maxHp);
  const details = hasDetails(facts);
  return (
    <>
      <span className="floorRail" aria-hidden="true">
        <i className={`floorDot kind-${facts.kind}`} />
      </span>
      <div className="floorBody">
        <div className="floorHead">
          <span className="floorNum num">fl {facts.floor}</span>
          <span className={`floorKind kind-${facts.kind}`}>
            <PlaceName kind={facts.kind} label={FLOOR_KIND_LABEL[facts.kind]} />
          </span>
          <ArtImg src={floorThumb(facts)} className="floorArt" />
          <span className="floorTitle">
            {facts.encounterId ? <EnemyName id={facts.encounterId} /> : <PlaceName kind={facts.kind} eventId={facts.eventId} />}
          </span>
          {chips.map((m) => (
            <span key={m.kind} className={`floorChip chip-${m.kind}`}>
              {MOMENT_LABEL[m.kind] ?? m.kind}
            </span>
          ))}
          <span className={`floorHp num hp-${tone}`}>
            {facts.hp}/{facts.maxHp}
          </span>
          {facts.damageTaken > 0 && <span className="floorDmg num">−{facts.damageTaken}</span>}
          {facts.hpHealed > 0 && <span className="floorHeal num">+{facts.hpHealed}</span>}
          {facts.turns > 0 && <span className="floorTurns num">{facts.turns}t</span>}
        </div>
        {details && (
          <p className="floorDetails">
            <FloorDetails facts={facts} />
          </p>
        )}
      </div>
    </>
  );
}

function hasDetails(f: FloorFacts): boolean {
  return (
    f.picked.length +
      f.skipped.length +
      f.gainedExtra.length +
      f.removed.length +
      f.upgraded.length +
      f.relics.length +
      f.potions.length +
      f.potionsUsed.length +
      f.eventChoices.length >
      0 ||
    Boolean(f.rest) ||
    f.goldSpent > 0 ||
    f.goldGained >= 20 ||
    f.maxHpLost > 0 ||
    f.maxHpGained > 0
  );
}

function FloorDetails({ facts }: { facts: FloorFacts }) {
  const bits: JSX.Element[] = [];
  if (facts.rest) {
    bits.push(
      <span key="rest" className="floorBit">
        <PlaceName kind="rest" rest={facts.rest} />
      </span>,
    );
  }
  if (facts.eventChoices.length > 0) {
    bits.push(
      <span key="chose" className="floorBit">
        chose <span className="floorChoice">{facts.eventChoices.join(', ')}</span>
      </span>,
    );
  }
  pushCards(bits, 'picked', facts.picked);
  pushCards(bits, facts.skippedAll ? 'skipped all' : 'skipped', facts.skipped, 'skipped');
  pushCards(bits, 'gained', facts.gainedExtra);
  pushCards(bits, 'removed', facts.removed, 'removed');
  pushCards(bits, 'upgraded', facts.upgraded, 'upgraded');
  pushItems(bits, 'relic', facts.relics, (id) => <RelicName id={id} />);
  pushItems(bits, 'potion', facts.potions, (id) => <PotionName id={id} />);
  pushItems(bits, 'used', facts.potionsUsed, (id) => <PotionName id={id} />);
  if (facts.goldSpent > 0) {
    bits.push(
      <span key="gs" className="floorBit floorGold num">
        −{facts.goldSpent}g
      </span>,
    );
  } else if (facts.goldGained >= 20) {
    bits.push(
      <span key="gg" className="floorBit floorGold num">
        +{facts.goldGained}g
      </span>,
    );
  }
  if (facts.maxHpLost > 0) {
    bits.push(
      <span key="mhl" className="floorBit floorMaxLoss num">
        max −{facts.maxHpLost}
      </span>,
    );
  }
  if (facts.maxHpGained > 0) {
    bits.push(
      <span key="mhg" className="floorBit floorMaxGain num">
        max +{facts.maxHpGained}
      </span>,
    );
  }
  return (
    <>
      {bits.map((el, i) => (
        <span key={el.key}>
          {i > 0 ? <span className="floorSep"> · </span> : null}
          {el}
        </span>
      ))}
    </>
  );
}

function pushItems(bits: JSX.Element[], key: string, ids: string[], render: (id: string) => JSX.Element) {
  if (ids.length === 0) return;
  bits.push(
    <span key={key} className="floorBit">
      {key}{' '}
      {ids.map((id, i) => (
        <span key={`${key}-${i}-${id}`}>
          {i > 0 ? ', ' : ''}
          {render(id)}
        </span>
      ))}
    </span>,
  );
}

function pushCards(bits: JSX.Element[], key: string, ids: string[], tone?: 'skipped' | 'removed' | 'upgraded') {
  if (ids.length === 0) return;
  bits.push(
    <span key={key} className={`floorBit${tone ? ` ${tone}` : ''}`}>
      {key}{' '}
      {ids.map((id, i) => (
        <span key={`${key}-${i}-${id}`}>
          {i > 0 ? ', ' : ''}
          <CardName id={id} />
        </span>
      ))}
    </span>,
  );
}
