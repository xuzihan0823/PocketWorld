import { DECK_WALK_BOUNDS, RESIDENT_RADIUS, UPPER_DECK_OFFSET, deckFromAuthoredX, type CabinDeck } from './cabinLayout.ts';

type Point = [number, number];
type Position = [number, number, number];

export const CABIN_STAIRS = {
  x: -2.43,
  width: 1.04,
  lowerZ: 2.62,
  upperZ: -1.47,
  steps: 18,
};
export const STAIR_UPPER_PLATFORM_BACK = CABIN_STAIRS.upperZ - CABIN_STAIRS.width + .14;
export const STAIR_UPPER_ENTRY_FRONT = CABIN_STAIRS.upperZ + RESIDENT_RADIUS + .10;
const lowerX = DECK_WALK_BOUNDS.lower.left + .04;
const upperLocalX = DECK_WALK_BOUNDS.upper.left + .04;
const upperX = upperLocalX + UPPER_DECK_OFFSET[0];
// Turn clear of the first riser, and finish the last stride before turning into the bedroom.
const landingRun = .29;
const lowerTurn = lowerX - CABIN_STAIRS.x;
export const STAIR_RUN = CABIN_STAIRS.lowerZ - CABIN_STAIRS.upperZ;
const upperTurn = upperX - CABIN_STAIRS.x;
export const STAIR_DISTANCE = lowerTurn + landingRun + STAIR_RUN + landingRun + upperTurn;
export const STAIR_TREAD_RUN = STAIR_RUN / CABIN_STAIRS.steps;
export const STAIR_RISE = UPPER_DECK_OFFSET[1] / CABIN_STAIRS.steps;

export function stairLanding(deck: CabinDeck): Point {
  return deck === 'lower' ? [lowerX, CABIN_STAIRS.lowerZ + landingRun] : [upperLocalX, CABIN_STAIRS.upperZ - landingRun];
}

/** A click is a walk request; crossing decks becomes a walk to this deck's landing. */
export function stairApproachPoint(deck: CabinDeck, point: Point): Position {
  if (deckFromAuthoredX(point[0]) === deck) return [point[0], 0, point[1]];
  const [x, z] = stairLanding(deck);
  return [x, 0, z];
}

export function otherDeck(deck: CabinDeck): CabinDeck {
  return deck === 'lower' ? 'upper' : 'lower';
}

/** Distance increases on the way up. Both turns connect at floor level. */
export function sampleCabinStairs(distance: number): { position: Position; ascent: number; tread: number | null } {
  const run = distance - lowerTurn - landingRun;
  if (distance <= lowerTurn) return { position: [lowerX - Math.max(0, distance), 0, CABIN_STAIRS.lowerZ + landingRun], ascent: 0, tread: null };
  if (run >= STAIR_RUN + landingRun) {
    const exit = Math.min(upperTurn, run - STAIR_RUN - landingRun);
    return { position: [CABIN_STAIRS.x + exit, UPPER_DECK_OFFSET[1], CABIN_STAIRS.upperZ - landingRun], ascent: 1, tread: null };
  }
  // Feet handle the risers while the resident root advances along the incline.
  const tread = run / STAIR_TREAD_RUN;
  const ascent = Math.min(1, Math.max(0, run / STAIR_RUN));
  return { position: [CABIN_STAIRS.x, ascent * UPPER_DECK_OFFSET[1], CABIN_STAIRS.lowerZ - run], ascent, tread };
}

export interface CabinResidentView {
  deck: CabinDeck;
  stairAscent: number | null;
}
