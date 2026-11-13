import { BOOK, leafPose, paperHalfThickness } from '../journal/bookModel.ts';

// The cover, bound sheets, editor and departing paper all use this one frame.
export const SCHEDULE_POSITION: [number, number, number] = [0.55, 1.121, -1.96];
export const SCHEDULE_SCALE = 0.17;
export const SCHEDULE_YAW = 0.08;
export const SCHEDULE_SPREAD = BOOK.leaves / 2;
const rightPage = leafPose(SCHEDULE_SPREAD, 0, 1, SCHEDULE_SPREAD, BOOK.leaves);
const center = rightPage.points[BOOK.segments / 2];
export const PAGE_LOCAL_POSITION: [number, number, number] = [center.x, center.y + paperHalfThickness(0.5, BOOK.leaves) + 0.001, 0];
export const PAGE_DISTANCE_FACTOR = 1.4;
export const BOOK_POSITION: [number, number, number] = [
  SCHEDULE_POSITION[0] + PAGE_LOCAL_POSITION[0] * SCHEDULE_SCALE * Math.cos(SCHEDULE_YAW),
  SCHEDULE_POSITION[1] + PAGE_LOCAL_POSITION[1] * SCHEDULE_SCALE,
  SCHEDULE_POSITION[2] - PAGE_LOCAL_POSITION[0] * SCHEDULE_SCALE * Math.sin(SCHEDULE_YAW),
];
