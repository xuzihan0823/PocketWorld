/**
 * Compressed orbital day. The Sun travels on a great circle that passes behind Earth, so
 * the habitat falls into Earth's shadow once per lap. Pure maths, no Three.js, so the
 * timing can be unit-tested.
 *
 * Phase 0 is orbital noon (Sun opposite Earth) and phase 0.5 is the middle of the eclipse.
 */
export type Vec3 = readonly [number, number, number];

/** One full lap, in real seconds at speed 1. */
export const SUN_CYCLE_SECONDS = 480;
/** Share of the lap during which the Sun is hidden behind Earth. */
export const ECLIPSE_FRACTION = 0.2;
/** The original fixed key-light direction; the visit starts with the Sun here. */
export const BASE_SUN_DIRECTION: Vec3 = [-0.534522, 0.801784, 0.267261];
/** Room key light never drops below this height, so the cabin stays readable. */
export const ROOM_LIGHT_MIN_ELEVATION = 0.3;

const DEG = Math.PI / 180;
const TWILIGHT_IN = -0.7;
const TWILIGHT_OUT = 1.5;
const WARM_BAND = 12;

export interface SunOrbit {
  /** Unit vector toward Earth's centre. */
  earth: Vec3;
  /** Unit vector in the orbit plane, perpendicular to `earth`. */
  axis: Vec3;
  /** Earth's apparent radius in degrees. */
  angularRadius: number;
  /** Easing exponent: slows the Sun near Earth so the eclipse lasts ECLIPSE_FRACTION of a lap. */
  exponent: number;
}

export interface SunSample {
  direction: [number, number, number];
  /** Degrees between the Sun and Earth's limb; negative while hidden. */
  separation: number;
  /** 0 inside Earth's shadow, 1 in full sunlight. */
  daylight: number;
  /** 1 when the Sun grazes the limb (light through the atmosphere), 0 far from it. */
  warmth: number;
}

export interface OrbitSunRig {
  /** Unit vector toward the orbital Earth's centre. */
  earth: [number, number, number];
  /** In-sky upward unit vector perpendicular to `earth`. */
  up: [number, number, number];
  /** In-sky leftward unit vector perpendicular to `earth` and `up`. */
  left: [number, number, number];
  /** Orbital Earth's apparent angular radius in degrees. */
  angularRadius: number;
  /** Peak horizontal swing angle (radians) toward port/starboard sky. */
  lateralSwing: number;
  /** Smooth exponential-linear basis weights matching limb contact at 0.4/0.6 and upper-left start. */
  shoulderWeight: number;
  linearWeight: number;
}

function length(v: Vec3) { return Math.hypot(v[0], v[1], v[2]); }
function normalize(v: Vec3): [number, number, number] {
  const l = length(v) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function dot(a: Vec3, b: Vec3) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function smoothstep(edge0: number, edge1: number, x: number) {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function createSunOrbit(earthPosition: Vec3, earthRadius: number, reference: Vec3 = BASE_SUN_DIRECTION): SunOrbit {
  const earth = normalize(earthPosition);
  const ref = normalize(reference);
  const along = dot(ref, earth);
  const axis = normalize([ref[0] - along * earth[0], ref[1] - along * earth[1], ref[2] - along * earth[2]]);
  const angularRadius = Math.asin(Math.min(1, earthRadius / length(earthPosition))) / DEG;
  const exponent = Math.log(angularRadius / 180) / Math.log(ECLIPSE_FRACTION);
  return { earth, axis, angularRadius, exponent };
}

/** Signed angle in degrees from Earth's centre along the orbit. */
export function sunAngle(orbit: SunOrbit, phase: number) {
  const p = phase - Math.floor(phase);
  const t = 1 - 2 * p;
  return 180 * Math.sign(t) * Math.abs(t) ** orbit.exponent;
}

/** Inverse of `sunAngle` for the descending half (0 < angle <= 180) or the rising half (negative). */
export function sunPhaseForAngle(orbit: SunOrbit, angle: number) {
  const t = Math.sign(angle) * (Math.min(180, Math.abs(angle)) / 180) ** (1 / orbit.exponent);
  return (1 - t) / 2;
}

/** Phase at which the Sun sits at `reference`, used as the start of every visit. */
export function startPhase(orbit: SunOrbit, reference: Vec3 = BASE_SUN_DIRECTION) {
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(normalize(reference), orbit.earth)))) / DEG;
  return sunPhaseForAngle(orbit, angle);
}

export function sampleSun(orbit: SunOrbit, phase: number): SunSample {
  const angle = sunAngle(orbit, phase);
  const c = Math.cos(angle * DEG);
  const s = Math.sin(angle * DEG);
  const { earth: e, axis: a } = orbit;
  const direction = normalize([e[0] * c + a[0] * s, e[1] * c + a[1] * s, e[2] * c + a[2] * s]);
  const separation = Math.abs(angle) - orbit.angularRadius;
  return {
    direction,
    separation,
    daylight: smoothstep(TWILIGHT_IN, TWILIGHT_OUT, separation),
    warmth: 1 - smoothstep(0, WARM_BAND, separation),
  };
}

function cross(a: Vec3, b: Vec3): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Build a C-smooth inclined orbital Sun trajectory for exterior orbital cruise so the blazing Sun
 * sits in the upper-left sky at initial entry (`initialPhase`), sweeps into sunset behind Earth's
 * limb at `phase = 0.4`, hides behind Earth across `[0.4, 0.6]` (`ECLIPSE_FRACTION`), and rises on
 * the opposite limb at `phase = 0.6`.
 */
export function createOrbitSunRig(
  earthPosition: Vec3,
  earthRadius: number,
  upHint: Vec3,
  sunStartTarget: Vec3,
  initialPhase: number,
): OrbitSunRig {
  const earth = normalize(earthPosition);
  const upAlong = dot(upHint, earth);
  const up = normalize([upHint[0] - upAlong * earth[0], upHint[1] - upAlong * earth[1], upHint[2] - upAlong * earth[2]]);
  const left = normalize(cross(up, earth));
  const angularRadiusRad = Math.asin(Math.min(0.98, earthRadius / (length(earthPosition) || 1)));
  const angularRadius = angularRadiusRad / DEG;

  const target = normalize(sunStartTarget);
  const sinAlphaStart = Math.max(0.05, Math.min(0.96, dot(target, up)));
  const alphaStart = Math.asin(sinAlphaStart);
  const cosAlphaStart = Math.max(0.05, Math.cos(alphaStart));
  const sinBetaStart = Math.max(-0.95, Math.min(0.95, dot(target, left) / cosAlphaStart));
  const betaStart = Math.max(0.08, Math.abs(Math.asin(sinBetaStart)));

  const p0 = initialPhase - Math.floor(initialPhase);
  const theta0 = 2 * Math.PI * (p0 - 0.5);
  const sinTheta0 = Math.max(0.25, Math.abs(Math.sin(theta0)));
  const limbTheta = ECLIPSE_FRACTION * Math.PI; // 0.2 * pi (phase 0.4 & 0.6)
  const sinLimb = Math.sin(limbTheta);

  // Clamp horizontal swing so limb contact always stays geometrically realizable inside `angularRadius`
  const maxBetaLimb = angularRadiusRad * 0.88;
  const lateralSwing = Math.min(betaStart / sinTheta0, maxBetaLimb / sinLimb);
  const betaLimb = lateralSwing * sinLimb;
  const cosAlphaLimb = Math.min(0.9999, Math.max(0.05, Math.cos(angularRadiusRad) / Math.cos(betaLimb)));
  const alphaLimb = Math.acos(cosAlphaLimb);

  const uLimb = (1 - Math.cos(limbTheta)) / 2;
  const uStart = Math.max(uLimb + 0.05, (1 - Math.cos(theta0)) / 2);
  const clampedStart = Math.max(alphaLimb + 10.5 * DEG, alphaStart);
  const fLimb = 1 - Math.exp(-uLimb * 14);
  const fStart = 1 - Math.exp(-uStart * 14);
  const det = fLimb * uStart - uLimb * fStart || 1e-6;
  const shoulderWeight = (alphaLimb * uStart - clampedStart * uLimb) / det;
  const linearWeight = (fLimb * clampedStart - fStart * alphaLimb) / det;

  return { earth, up, left, angularRadius, lateralSwing, shoulderWeight, linearWeight };
}

export function sampleOrbitSun(rig: OrbitSunRig, phase: number): SunSample {
  const p = phase - Math.floor(phase);
  const theta = 2 * Math.PI * (p - 0.5);
  const u = Math.max(0, (1 - Math.cos(theta)) / 2);
  const alpha = rig.shoulderWeight * (1 - Math.exp(-u * 14)) + rig.linearWeight * u;
  const beta = -rig.lateralSwing * Math.sin(theta);
  const cosA = Math.cos(alpha);
  const sinA = Math.sin(alpha);
  const cosB = Math.cos(beta);
  const sinB = Math.sin(beta);
  const { earth: e, up, left } = rig;
  const direction = normalize([
    e[0] * cosA * cosB + up[0] * sinA + left[0] * cosA * sinB,
    e[1] * cosA * cosB + up[1] * sinA + left[1] * cosA * sinB,
    e[2] * cosA * cosB + up[2] * sinA + left[2] * cosA * sinB,
  ]);
  const angle = Math.acos(Math.max(-1, Math.min(1, dot(direction, e)))) / DEG;
  const separation = angle - rig.angularRadius;
  return {
    direction,
    separation,
    daylight: smoothstep(TWILIGHT_IN, TWILIGHT_OUT, separation),
    warmth: 1 - smoothstep(0, WARM_BAND, separation),
  };
}

/** Key-light direction for the room: Sun azimuth, but never from below the floor. */
export function roomLightDirection(direction: Vec3, minElevation = ROOM_LIGHT_MIN_ELEVATION): [number, number, number] {
  if (direction[1] >= minElevation) return normalize(direction);
  const flat = Math.hypot(direction[0], direction[2]);
  if (flat < 1e-6) return [0, 1, 0];
  const horizontal = Math.sqrt(1 - minElevation * minElevation) / flat;
  return [direction[0] * horizontal, minElevation, direction[2] * horizontal];
}

export interface SunOverrides {
  /** Fixed phase from `?sun=`, or null to run the cycle. */
  phase: number | null;
  /** Speed multiplier from `?sunSpeed=`. */
  speed: number;
}

export function readSunOverrides(search: string): SunOverrides {
  const params = new URLSearchParams(search);
  const rawPhase = params.get('sun');
  const rawSpeed = params.get('sunSpeed');
  const phase = rawPhase === null || rawPhase.trim() === '' ? NaN : Number(rawPhase);
  const speed = rawSpeed === null || rawSpeed.trim() === '' ? NaN : Number(rawSpeed);
  return {
    phase: Number.isFinite(phase) ? phase - Math.floor(phase) : null,
    speed: Number.isFinite(speed) ? Math.min(240, Math.max(0, speed)) : 1,
  };
}
