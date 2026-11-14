/**
 * Camera-aware wall visibility: pure geometry and fade timing, free of Three.js so it can be unit-tested.
 * Everything here is expressed in the room's own local coordinate system.
 */
export type Vec3 = readonly [number, number, number];
export type WallId = 'front' | 'back' | 'left' | 'right' | 'ceiling';

/** Tag stored in `userData.wall` on the group that holds one wall and its attached fixtures. */
export interface WallTag { id: WallId; /** Unit axis pointing out of the room. */ normal: Vec3 }

/** Axis-aligned bounds of a wall group in room coordinates, plus its outward axis. */
export interface WallBox extends WallTag { min: Vec3; max: Vec3 }

export const WALL_FADE = {
  /** Seconds for a full 1 → 0 fade. */
  fadeOut: 0.42,
  /** Seconds for a full 0 → 1 fade. */
  fadeIn: 0.55,
  /** Hysteresis on the camera's elevation above the wall plane (sine of the angle, ≈ 2.3°). */
  planeBand: 0.04,
  /** Extra metres around a hidden wall before a sight line counts as clear again. */
  rectMargin: 0.3,
} as const;

function axisOf(normal: Vec3): 0 | 1 | 2 {
  const a = Math.abs(normal[0]), b = Math.abs(normal[1]), c = Math.abs(normal[2]);
  return a >= b && a >= c ? 0 : b >= c ? 1 : 2;
}

/** Signed sine of the camera's angle above the wall's outer face, measured from the face centre. */
export function planeSide(wall: WallBox, camera: Vec3): number {
  const axis = axisOf(wall.normal), sign = Math.sign(wall.normal[axis]);
  const face = sign > 0 ? wall.max[axis] : wall.min[axis];
  let distance = 0;
  for (let i = 0; i < 3; i++) {
    const centre = i === axis ? face : (wall.min[i] + wall.max[i]) / 2;
    distance += (camera[i] - centre) ** 2;
  }
  return ((camera[axis] - face) * sign) / (Math.sqrt(distance) || 1);
}

/** Whether the segment from → to passes through the wall's footprint (expanded by `margin`). */
export function segmentHitsWall(wall: WallBox, from: Vec3, to: Vec3, margin = 0): boolean {
  const axis = axisOf(wall.normal), plane = (wall.min[axis] + wall.max[axis]) / 2;
  const a = from[axis] - plane, b = to[axis] - plane;
  if (a * b > 0 || a === b) return false;
  const t = a / (a - b);
  for (let i = 0; i < 3; i++) {
    if (i === axis) continue;
    const value = from[i] + (to[i] - from[i]) * t;
    if (value < wall.min[i] - margin || value > wall.max[i] + margin) return false;
  }
  return true;
}

/**
 * A wall occludes when the camera is outside its plane and at least one sight line to the
 * interior samples actually crosses it. `hidden` widens both tests so the state stays put near the boundary.
 */
export function wallOccludes(wall: WallBox, camera: Vec3, samples: readonly Vec3[], hidden: boolean): boolean {
  if (planeSide(wall, camera) <= (hidden ? -WALL_FADE.planeBand : WALL_FADE.planeBand)) return false;
  const margin = hidden ? WALL_FADE.rectMargin : 0;
  return samples.some(sample => segmentHitsWall(wall, camera, sample, margin));
}

/** Advances fade progress (1 = fully shown) toward the hidden or shown state, continuing from where it is. */
export function stepFade(progress: number, hidden: boolean, dt: number): number {
  return hidden ? Math.max(0, progress - dt / WALL_FADE.fadeOut) : Math.min(1, progress + dt / WALL_FADE.fadeIn);
}

/** Ease-in-out curve from fade progress to opacity. */
export function fadeOpacity(progress: number): number {
  const p = Math.min(1, Math.max(0, progress));
  return p * p * (3 - 2 * p);
}
