export const BOOK = { leaves: 32, segments: 32, width: 1.38, height: 1.92, thickness: 0.004, board: 0.024, base: 0.029, spineRadius: 0.09 };

export const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
const sheetThickness = (leafCount: number) => BOOK.thickness * BOOK.leaves / leafCount;
export const paperHalfThickness = (u: number, leafCount: number) =>
  sheetThickness(leafCount) * 0.72 / 2 * (0.04 + 0.96 * smooth((u - 0.2) / 0.3));

function restingHeight(u: number, root: number, edge: number) {
  const shoulder = u < 0.35 ? 0.02 * Math.sin(Math.PI * u / 0.35) ** 2 : 0;
  return root + (edge - root) * smooth(u / 0.5) + shoulder;
}

export function leafPose(index: number, turn: number, opening: number, cursor: number, leafCount: number, turnCurl = 1) {
  const t = smooth(turn), relaxed = smooth((opening - 0.25) / 0.75);
  const stackStep = sheetThickness(leafCount);
  const rightEdge = BOOK.base + (leafCount - index) * stackStep;
  const leftEdge = BOOK.base + (index + 1) * stackStep;
  const bindingAngle = (index + 0.5 - cursor) * stackStep / BOOK.spineRadius;
  const boundY = BOOK.base + BOOK.spineRadius * Math.cos(bindingAngle);
  const root = rightEdge * (1 - relaxed) + boundY * relaxed;
  const step = BOOK.width / BOOK.segments;
  const points = [{ x: 0.065 * (1 - relaxed) + BOOK.spineRadius * Math.sin(bindingAngle) * relaxed, y: root }], angles: number[] = [];
  for (let i = 0; i < BOOK.segments; i++) {
    const a = i / BOOK.segments, b = (i + 1) / BOOK.segments;
    const rightSlope = Math.atan2(restingHeight(b, boundY, rightEdge) - restingHeight(a, boundY, rightEdge), step);
    const leftSlope = Math.atan2(restingHeight(b, boundY, leftEdge) - restingHeight(a, boundY, leftEdge), step);
    const curl = turnCurl * 0.65 * Math.sin(2 * Math.PI * t) * Math.sin(Math.PI * (a + b) / 2);
    const angle = Math.PI * t + relaxed * ((1 - t) * rightSlope - t * leftSlope + curl);
    angles.push(angle);
    const previous = points[i];
    points.push({ x: previous.x + step * Math.cos(angle), y: previous.y + step * Math.sin(angle) });
  }
  angles.push(angles[angles.length - 1]);
  return { points, angles };
}

// Open a bookmarked spread as one stack, without sweeping through page numbers.
export function openingStackPose(index: number, opening: number, spread: number, leafCount: number) {
  return leafPose(index, index < spread ? opening : 0, opening, spread * smooth(opening), leafCount, 0);
}

export function coverPose(opening: number, openAsStack = false) {
  const t = smooth(opening);
  const angle = Math.PI * t;
  const clearance = openAsStack ? 0.012 * Math.sin(Math.PI * opening) : 0;
  return {
    x: 0.045 * (1 - 2 * t) - Math.sin(angle) * clearance,
    y: (BOOK.base + BOOK.leaves * BOOK.thickness + 0.018) * (1 - t) + BOOK.board / 2 * t + Math.cos(angle) * clearance,
    angle,
  };
}
