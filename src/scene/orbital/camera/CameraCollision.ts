import { Box3, Vector3 } from 'three';

const AXES = ['x', 'y', 'z'] as const;
type Axis = typeof AXES[number];

export const CAMERA_CLEARANCE = .15;
const separation = .002;

export function sweepCameraBox(from: Vector3, to: Vector3, box: Box3) {
  let enter = -Infinity, exit = Infinity;
  let axis: Axis = 'x';
  for (const key of AXES) {
    const change = to[key] - from[key];
    if (Math.abs(change) < 1e-8) {
      if (from[key] <= box.min[key] || from[key] >= box.max[key]) return null;
      continue;
    }
    const a = (box.min[key] - from[key]) / change;
    const b = (box.max[key] - from[key]) / change;
    if (Math.min(a, b) > enter) { enter = Math.min(a, b); axis = key; }
    exit = Math.min(exit, Math.max(a, b));
    if (enter >= exit) return null;
  }
  return enter >= 0 && enter < 1 && exit > 0 ? { time: enter, axis } : null;
}

export class CameraCollision {
  private boxes: Box3[] = [];
  private readonly next = new Vector3();
  private readonly from = new Vector3();

  setSolids(boxes: readonly Box3[]) {
    this.boxes = boxes.map(box => box.clone().expandByScalar(CAMERA_CLEARANCE));
  }

  private sweep(from: Vector3, to: Vector3) {
    let nearest: ReturnType<typeof sweepCameraBox> = null;
    for (const box of this.boxes) {
      const hit = sweepCameraBox(from, to, box);
      if (hit && (!nearest || hit.time < nearest.time)) nearest = hit;
    }
    return nearest;
  }

  private separate(point: Vector3, previous: Vector3) {
    for (const box of this.boxes) {
      if (!box.containsPoint(point)) continue;
      let distance = Infinity, face = 0, axis: Axis = 'x';
      for (const key of AXES) {
        for (const edge of [box.min[key] - separation, box.max[key] + separation]) {
          const gap = Math.abs(edge - previous[key]);
          if (gap < distance) { distance = gap; face = edge; axis = key; }
        }
      }
      point[axis] = face;
    }
  }

  resolve(out: Vector3, previous: Vector3) {
    const from = this.from.copy(previous);
    const to = this.next.copy(out);
    this.separate(from, previous);
    for (let i = 0; i < 3; i++) {
      const hit = this.sweep(from, to);
      if (!hit) break;
      const sign = Math.sign(to[hit.axis] - from[hit.axis]);
      from.lerp(to, hit.time);
      from[hit.axis] -= sign * separation;
      to[hit.axis] = from[hit.axis];
    }
    this.separate(to, from);
    out.copy(to);
  }

  route(from: Vector3, to: Vector3) {
    if (!this.sweep(from, to)) return null;
    const extent = new Box3();
    this.boxes.forEach(box => extent.union(box));
    const front = extent.max.z + .65;
    const viaFront = (point: Vector3) => new Vector3(point.x, point.y, front);
    const routes = [[from, viaFront(from), viaFront(to), to]];
    for (const x of [extent.min.x - .65, extent.max.x + .65]) {
      const side = (point: Vector3) => new Vector3(x, point.y, point.z);
      routes.push([from, side(from), side(to), to]);
      routes.push([from, side(from), viaFront(side(from)), viaFront(to), to]);
    }
    let best: Vector3[] | null = null, distance = Infinity;
    for (const route of routes) {
      let length = 0;
      for (let i = 1; i < route.length; i++) {
        if (this.sweep(route[i - 1], route[i])) { length = Infinity; break; }
        length += route[i - 1].distanceTo(route[i]);
      }
      if (length < distance) { distance = length; best = route; }
    }
    return best;
  }
}

export function followCameraRoute(out: Vector3, route: readonly Vector3[], progress: number) {
  if (progress >= 1) return out.copy(route[route.length - 1]);
  const lengths = route.slice(1).map((point, i) => point.distanceTo(route[i]));
  let remaining = lengths.reduce((total, length) => total + length, 0) * progress;
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i]) return out.lerpVectors(route[i], route[i + 1], lengths[i] ? remaining / lengths[i] : 0);
    remaining -= lengths[i];
  }
  return out.copy(route[route.length - 1]);
}
