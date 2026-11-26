import * as THREE from 'three';
import { CAMERA_FOV } from './cabinView.ts';

export type SpacecraftViewMode = 'approach' | 'orbit' | 'entering-cabin' | 'leaving-cabin' | 'cabin';

export const SHIP_TARGET = new THREE.Vector3(0.45, 4.15, -0.113);
/** Front-left-above orbital framing: showcases stacked duplex bays, stairwell portholes, sloped bridge, solar wings, plumes, and Earth behind. */
export const ORBIT_DIRECTION = new THREE.Vector3(-4.2, 5.8, 16.2).normalize();
/** Opening deep-space approach vector: starts farther out & slightly aft-high, swooping gracefully to ORBIT_DIRECTION. */
export const APPROACH_DIRECTION = new THREE.Vector3(-11.2, 9.6, 23.0).normalize();

export const APPROACH_DURATION = 2.6;
export const ENTER_CABIN_DURATION = 1.15;
export const LEAVE_CABIN_DURATION = 1.05;
export const REDUCED_TRANSITION_DURATION = 0.14;

/** Up to 36x orbital time speed at full boost (~13.3 s per full orbital day/night cycle). */
export const BOOST_TIME_SCALE_EXTRA = 35;
export const BASE_EARTH_SPIN_SPEED = 0.008;
export const BOOST_EARTH_SPIN_SPEED = 0.34;
export const BASE_DRIFT_SPEED = 1.6;
export const BOOST_DRIFT_SPEED = 36.0;
export const BOOST_FOV_KICK = 5.5;

/** Sweeping low-Earth-orbit horizon geometry in exterior orbital view (`orbitPresence = 1`). */
export const ORBIT_EARTH_RADIUS = 468;
export const ORBIT_EARTH_DISTANCE = 760;

const orbitLook = ORBIT_DIRECTION.clone().negate();
const orbitRight = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), ORBIT_DIRECTION).normalize();
const orbitUp = new THREE.Vector3().crossVectors(ORBIT_DIRECTION, orbitRight);
const orbitCamRight = orbitRight; // +X screen right when looking along -ORBIT_DIRECTION
const orbitCamUp = orbitUp;       // +Y screen up when looking along -ORBIT_DIRECTION
const orbitHalfFovY = THREE.MathUtils.degToRad(CAMERA_FOV / 2);
const orbitVerticalSlope = Math.tan(orbitHalfFovY);

export interface OrbitCelestialLayout {
  earthPosition: [number, number, number];
  cabinEarthPosition: [number, number, number];
  earthRadius: number;
  moonPosition: [number, number, number];
  cabinMoonPosition: [number, number, number];
  moonRadius: number;
  cabinMoonRadius: number;
  sunStartTarget: [number, number, number];
  upDirection: [number, number, number];
  cameraLook: [number, number, number];
}

/**
 * Compute three-body celestial framing shared across exterior orbital cruise and interior cabin:
 * - Sweeping giant LEO Earth horizon arc beneath the hull (and visible behind/through the cabin window)
 * - Blazing starburst Sun in the upper-left sky
 * - Cratered Moon in the upper-right sky
 */
export function orbitCelestialLayout(aspect: number): OrbitCelestialLayout {
  const safeAspect = Math.max(0.35, Number.isFinite(aspect) ? aspect : 16 / 9);
  const halfFovX = Math.atan(orbitVerticalSlope * safeAspect);
  const portrait = safeAspect < 0.85;

  const dirFromNdc = (ndcX: number, ndcY: number) => {
    const yaw = Math.atan(ndcX * Math.tan(halfFovX));
    const pitch = Math.atan(ndcY * orbitVerticalSlope);
    return orbitLook.clone()
      .multiplyScalar(Math.cos(pitch) * Math.cos(yaw))
      .addScaledVector(orbitCamRight, Math.cos(pitch) * Math.sin(yaw))
      .addScaledVector(orbitCamUp, Math.sin(pitch))
      .normalize();
  };

  // 1. Giant LEO Earth sweeping across the bottom of the frame (raised gently in zoomed-in cabin view so the horizon fills the rear panorama window & lower backdrop)
  const earthAngRadius = Math.asin(ORBIT_EARTH_RADIUS / ORBIT_EARTH_DISTANCE);
  const makeEarthPos = (crestNdcY: number, yawNdcX: number): [number, number, number] => {
    const crestPitch = Math.atan(crestNdcY * orbitVerticalSlope);
    const centerPitch = crestPitch - earthAngRadius;
    const centerYaw = Math.atan(yawNdcX * Math.tan(halfFovX));
    return orbitLook.clone()
      .multiplyScalar(Math.cos(centerPitch) * Math.cos(centerYaw))
      .addScaledVector(orbitCamRight, Math.cos(centerPitch) * Math.sin(centerYaw))
      .addScaledVector(orbitCamUp, Math.sin(centerPitch))
      .normalize()
      .multiplyScalar(ORBIT_EARTH_DISTANCE)
      .toArray() as [number, number, number];
  };

  const earthPosition = makeEarthPos(portrait ? -0.22 : -0.275, -0.025);
  const cabinEarthPosition = makeEarthPos(portrait ? 0.14 : 0.18, 0.02);

  // 2. Cratered Moon suspended in the upper-right sky (framed cleanly in both orbit and cabin overview)
  const moonDir = dirFromNdc(portrait ? 0.50 : 0.39, portrait ? 0.45 : 0.43);
  const moonDist = 1180;
  const moonRadius = portrait ? 40 : 68;
  const moonPosition = moonDir.clone().multiplyScalar(moonDist).toArray() as [number, number, number];

  const cabinMoonDir = dirFromNdc(portrait ? 0.36 : 0.42, portrait ? 0.58 : 0.56);
  const cabinMoonPosition = cabinMoonDir.clone().multiplyScalar(moonDist).toArray() as [number, number, number];
  const cabinMoonRadius = portrait ? 34 : 54;

  // 3. Blazing Sun upper-left sky target at initial entry
  const sunStartTarget = dirFromNdc(-0.55, portrait ? 0.47 : 0.44).toArray() as [number, number, number];

  return {
    earthPosition,
    cabinEarthPosition,
    earthRadius: ORBIT_EARTH_RADIUS,
    moonPosition,
    cabinMoonPosition,
    moonRadius,
    cabinMoonRadius,
    sunStartTarget,
    upDirection: orbitCamUp.toArray() as [number, number, number],
    cameraLook: orbitLook.toArray() as [number, number, number],
  };
}

export interface SpacecraftFlightState {
  mode: SpacecraftViewMode;
  boosting: boolean;
  /** Smoothed thruster boost intensity in [0, 1]. */
  boost: number;
  /** Time multiplier applied to orbital sun cycle (>= 1). */
  timeScale: number;
  /** Accumulated Earth spin angle (radians) driven by cruise + boost. */
  earthSpinAngle: number;
  /** Accumulated orbital ground-track roll (radians) driven by cruise + boost. */
  earthOrbitSweep: number;
  /** Accumulated aft space-dust drift distance. */
  travelDrift: number;
  /** Current spacecraft hull opacity in [0, 1]. */
  hullOpacity: number;
  /** Uniform wrapper synced with `boost` for Cosmos particle shaders. */
  boostUniform: { value: number };
  /** Uniform wrapper synced with `travelDrift` for Cosmos particle shaders. */
  travelUniform: { value: number };
  /** Progress in [0, 1] of opening approach glide. */
  approachProgress: number;
  /** Continuous elapsed flight time in seconds. */
  clock: number;
}

export function smoothstep01(edge0: number, edge1: number, x: number): number {
  if (edge1 <= edge0) return x >= edge1 ? 1 : 0;
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function easeOutQuart(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return 1 - (1 - c) ** 4;
}

export function easeInOutCubic(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c < 0.5 ? 4 * c * c * c : 1 - ((-2 * c + 2) ** 3) / 2;
}

export function readInitialViewMode(search: string, reducedMotion: boolean): SpacecraftViewMode {
  const params = new URLSearchParams(search);
  const dev = params.get('dev');
  if (dev === 'mario' || dev === 'shooter') return 'cabin';
  const view = params.get('view')?.trim().toLowerCase();
  if (view === 'cabin') return 'cabin';
  if (view === 'orbit') return 'orbit';
  return reducedMotion ? 'orbit' : 'approach';
}

export function createFlightState(initialMode: SpacecraftViewMode): SpacecraftFlightState {
  const inCabin = initialMode === 'cabin';
  return {
    mode: initialMode,
    boosting: false,
    boost: 0,
    timeScale: 1,
    earthSpinAngle: 0,
    earthOrbitSweep: 0,
    travelDrift: 0,
    hullOpacity: inCabin ? 0 : 1,
    boostUniform: { value: 0 },
    travelUniform: { value: 0 },
    approachProgress: initialMode === 'approach' ? 0 : 1,
    clock: 0,
  };
}

/**
 * Compute orbital camera distance so the entire spacecraft (fuselage, solar wings, thrusters)
 * sits comfortably framed with deep-space & Earth context at both desktop and mobile portrait.
 */
export function orbitDistanceForAspect(aspect: number): number {
  const safeAspect = Math.max(0.35, Number.isFinite(aspect) ? aspect : 16 / 9);
  let distance = 26;
  // Duplex spacecraft visual envelope in Three.js Y-up coordinates (two-tier hull + wings + tail fin + plumes)
  for (const x of [-11.6, 9.8]) for (const y of [-1.4, 10.6]) for (const z of [-9.6, 9.6]) {
    const corner = new THREE.Vector3(x, y, z).sub(SHIP_TARGET);
    distance = Math.max(
      distance,
      corner.dot(ORBIT_DIRECTION) + Math.max(
        Math.abs(corner.dot(orbitRight)) / (0.68 * orbitVerticalSlope * safeAspect),
        Math.abs(corner.dot(orbitUp)) / (0.66 * orbitVerticalSlope),
      ),
    );
  }
  return distance;
}

/** Starting far-space camera position for the opening approach glide. */
export function approachStartPosition(aspect: number): THREE.Vector3 {
  const orbitDist = orbitDistanceForAspect(aspect);
  return SHIP_TARGET.clone().addScaledVector(APPROACH_DIRECTION, orbitDist * 2.45);
}

/** Target orbital cruise camera position. */
export function orbitHomePosition(aspect: number): THREE.Vector3 {
  return SHIP_TARGET.clone().addScaledVector(ORBIT_DIRECTION, orbitDistanceForAspect(aspect));
}

/** Compute hull opacity during orbit, cabin, and cutaway transitions. */
export function hullOpacityForTransition(mode: SpacecraftViewMode, progress: number): number {
  if (mode === 'approach' || mode === 'orbit') return 1;
  if (mode === 'cabin') return 0;
  if (mode === 'entering-cabin') return 1 - smoothstep01(0.18, 0.80, progress);
  return smoothstep01(0.14, 0.78, progress);
}

/** Advance orbital cruise, boost inertia, time acceleration, and Earth sweep by dt seconds. */
export function stepFlightState(flight: SpacecraftFlightState, dt: number, reducedMotion: boolean): boolean {
  const step = Math.max(0, Math.min(dt, 0.1));
  if (!reducedMotion) flight.clock += step;

  const canBoost = flight.mode === 'orbit' || flight.mode === 'approach';
  const targetBoost = canBoost && flight.boosting ? 1 : 0;
  const tau = targetBoost > flight.boost ? 0.30 : 0.85;
  const blend = 1 - Math.exp(-step / tau);
  flight.boost += (targetBoost - flight.boost) * blend;
  if (Math.abs(flight.boost - targetBoost) < 0.0005) flight.boost = targetBoost;

  flight.timeScale = 1 + flight.boost * BOOST_TIME_SCALE_EXTRA;
  flight.boostUniform.value = reducedMotion ? 0 : flight.boost;

  // Earth sweeps smoothly during cruise and speeds dramatically during boost
  const earthRate = (reducedMotion && flight.boost === 0)
    ? 0
    : BASE_EARTH_SPIN_SPEED + flight.boost * BOOST_EARTH_SPIN_SPEED;
  flight.earthSpinAngle += step * earthRate;
  if (!reducedMotion) {
    flight.earthOrbitSweep += step * (0.0018 + flight.boost * 0.085);
    const driftRate = (flight.mode === 'cabin' ? 0 : BASE_DRIFT_SPEED) + flight.boost * BOOST_DRIFT_SPEED;
    flight.travelDrift += step * driftRate;
    flight.travelUniform.value = flight.travelDrift;
  }

  let finishedApproach = false;
  if (flight.mode === 'approach') {
    if (reducedMotion) {
      flight.approachProgress = 1;
      flight.mode = 'orbit';
      finishedApproach = true;
    } else {
      flight.approachProgress = Math.min(1, flight.approachProgress + step / APPROACH_DURATION);
      if (flight.approachProgress >= 1) {
        flight.mode = 'orbit';
        finishedApproach = true;
      }
    }
  }
  return finishedApproach;
}
