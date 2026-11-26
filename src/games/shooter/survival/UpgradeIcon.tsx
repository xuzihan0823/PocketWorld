import React from 'react';
import type { CSSProperties } from 'react';
import type { UpgradeId } from './engine';
import atlasUrl from '../../../../assets/games/shooter/upgrade-icons.png';

// Cells in the 7 × 5 atlas, in row order.
const tiles: Record<UpgradeId, number> = {
  power: 0, rapid: 1, spread: 2, orbit: 3, magnet: 4, boots: 5, heart: 6,
  pulse: 7, deadeye: 8, silver: 9, sixth: 10, execute: 11, spinup: 12, capacitor: 13,
  stabilizer: 14, salvo: 15, warhead: 16, embers: 17, cluster: 18, fuse: 19, twin: 20,
  sigil: 21, gravity: 22, familiar: 23, gale: 24, reap: 25, whirl: 26, witchstep: 27,
  burn: 28, frost: 29, chain: 30, ricochet: 31, split: 32, crit: 33, vampire: 34,
};

export default function UpgradeIcon({ id }: { id: UpgradeId }): React.ReactElement {
  const cell = tiles[id];
  return <span
    aria-hidden="true"
    className="sg-upgrade-icon"
    style={{
      backgroundImage: 'url("' + atlasUrl + '")',
      backgroundPosition: (cell % 7 * 100 / 6) + '% ' + (Math.floor(cell / 7) * 25) + '%',
    } satisfies CSSProperties}
  />;
}
