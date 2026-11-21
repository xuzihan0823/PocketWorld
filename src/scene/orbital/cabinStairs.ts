import { DECK_WALK_BOUNDS, UPPER_DECK_OFFSET, type CabinDeck } from './cabinLayout.ts';

type Point = [number, number];
type Position = [number, number, number];

export const CABIN_STAIRS = {
  x: -2.43,
  width: 1.04,
  lowerZ: 2.62,
  upperZ: -1.47,
  steps: 18,
};
const lowerX = DECK_WALK_BOUNDS.lower.left + .04;
const upperLocalX = DECK_WALK_BOUNDS.upper.left + .04;
const upperX = upperLocalX + UPPER_DECK_OFFSET[0];
const lowerTurn = lowerX - CABIN_STAIRS.x;
export const STAIR_RUN = CABIN_STAIRS.lowerZ - CABIN_STAIRS.upperZ;
const upperTurn = upperX - CABIN_STAIRS.x;
export const STAIR_DISTANCE = lowerTurn + STAIR_RUN + upperTurn;
export const STAIR_TREAD_RUN = STAIR_RUN / CABIN_STAIRS.steps;
export const STAIR_RISE = UPPER_DECK_OFFSET[1] / CABIN_STAIRS.steps;

export function stairLanding(deck: CabinDeck): Point {
  return deck === 'lower' ? [lowerX, CABIN_STAIRS.lowerZ] : [upperLocalX, CABIN_STAIRS.upperZ];
}

export function otherDeck(deck: CabinDeck): CabinDeck {
  return deck === 'lower' ? 'upper' : 'lower';
}

export function stairDestination(deck: CabinDeck): Position {
  const [x, z] = stairLanding(otherDeck(deck));
  return deck === 'lower' ? [x + .02, 0, z - .33] : [x + .30, 0, z];
}

export function atStairEntrance(deck: CabinDeck, point: Point, nextX: number) {
  return nextX < DECK_WALK_BOUNDS[deck].left
    && Math.abs(point[1] - stairLanding(deck)[1]) <= .31;
}

/** Distance increases on the way up. Both turns connect at floor level. */
export function sampleCabinStairs(distance: number): { position: Position; ascent: number } {
  const run = distance - lowerTurn;
  if (run <= 0) return { position: [lowerX - Math.max(0, distance), 0, CABIN_STAIRS.lowerZ], ascent: 0 };
  if (run >= STAIR_RUN) {
    const exit = Math.min(upperTurn, run - STAIR_RUN);
    return { position: [CABIN_STAIRS.x + exit, UPPER_DECK_OFFSET[1], CABIN_STAIRS.upperZ], ascent: 1 };
  }
  // Raise the pelvis at each riser over the first part of the tread.
  const step = run / STAIR_TREAD_RUN;
  const index = Math.floor(step);
  const t = Math.min(1, (step - index) / .38);
  const height = (index + t * t * (3 - 2 * t)) * STAIR_RISE;
  return { position: [CABIN_STAIRS.x, height, CABIN_STAIRS.lowerZ - run], ascent: run / STAIR_RUN };
}

export interface CabinResidentView {
  deck: CabinDeck;
  stairAscent: number | null;
}
