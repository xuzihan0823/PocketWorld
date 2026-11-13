import type { FurnitureVector } from './FurnitureParts';

// The open journal must fit between the turntable and the front edge of the desk.
export const JOURNAL_POSITION: FurnitureVector = [-0.60, 1.121, -1.873];
export const JOURNAL_SCALE = 0.096;
export const JOURNAL_YAW = -0.04;

export const JOURNAL_PAGE_POSITION: FurnitureVector = [
  JOURNAL_POSITION[0],
  JOURNAL_POSITION[1] + 0.025,
  JOURNAL_POSITION[2],
];
