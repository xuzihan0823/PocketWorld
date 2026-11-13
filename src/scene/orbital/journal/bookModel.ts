export const BOOK = { leaves: 32, segments: 32, width: 1.38, height: 1.92, thickness: 0.004, board: 0.024, base: 0.029, spineRadius: 0.09 };

export const clamp = (value: number) => Math.max(0, Math.min(1, value));
export const smooth = (value: number) => { const t = clamp(value); return t * t * (3 - 2 * t); };
export const PAGE_TURN_SECONDS = 1.05;
const PICK_UP = 0.24;
const RELEASE = 0.68;
const LAND = 0.91;

export function pageTurnPose(time: number) {
  const pull = smooth((time - PICK_UP) / (RELEASE - PICK_UP));
  const fall = smooth((time - RELEASE) / (LAND - RELEASE));
  const settle = clamp((time - LAND) / (1 - LAND));
  const lift = clamp((time - 0.17) / 0.59);
  const reach = smooth(time / PICK_UP) * (1 - smooth((time - RELEASE) / (1 - RELEASE)));
  const grip = smooth((time - 0.14) / 0.10) * (1 - smooth((time - RELEASE) / 0.12));
  return {
    page: 0.60 * pull + 0.40 * fall,
    corner: 0.64 * lift * (1 - lift) - 0.608 * (settle * (1 - settle)) ** 2,
    reach,
    grip,
    holding: time <= RELEASE,
  };
}

// The lift tapers toward both the sewn edge and the far end of the sheet.
export function cornerLift(u: number, v: number, height: number) {
  return height * smooth((u - 0.57) / 0.43) * smooth((v - 0.37) / 0.63);
}
const sheetThickness = (leafCount: number) => BOOK.thickness * BOOK.leaves / leafCount;
export const paperHalfThickness = (u: number, leafCount: number) =>
  sheetThickness(leafCount) * 0.72 / 2 * (0.04 + 0.96 * smooth((u - 0.2) / 0.3));

function restingHeight(u: number, root: number, edge: number) {
  const shoulder = u < 0.35 ? 0.02 * Math.sin(Math.PI * u / 0.35) ** 2 : 0;
  return root + (edge - root) * smooth(u / 0.5) + shoulder;
}

export function leafPose(index: number, turn: number, opening: number, cursor: number, leafCount: number) {
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
    const curl = 0.65 * Math.sin(2 * Math.PI * t) * Math.sin(Math.PI * (a + b) / 2);
    const angle = Math.PI * t + relaxed * ((1 - t) * rightSlope - t * leftSlope + curl);
    angles.push(angle);
    const previous = points[i];
    points.push({ x: previous.x + step * Math.cos(angle), y: previous.y + step * Math.sin(angle) });
  }
  angles.push(angles[angles.length - 1]);
  return { points, angles };
}

export function pageGripPose(shape: ReturnType<typeof leafPose>, curl: number, direction: number) {
  const column = BOOK.segments - 1;
  const point = shape.points[column], angle = shape.angles[column];
  const lift = cornerLift(column / BOOK.segments, 1, curl);
  const sin = Math.sin(angle), cos = Math.cos(angle);
  return {
    x: point.x - sin * lift, y: point.y + cos * lift, z: BOOK.height / 2,
    nx: -direction * sin, ny: direction * cos,
  };
}

export function coverPose(opening: number) {
  const t = smooth(opening);
  return { x: 0.045 * (1 - 2 * t), y: (BOOK.base + BOOK.leaves * BOOK.thickness + 0.018) * (1 - t) + BOOK.board / 2 * t, angle: Math.PI * t };
}
