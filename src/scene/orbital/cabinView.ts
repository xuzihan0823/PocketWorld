import { BEDROOM_WALL_FRONT, BEDROOM_WALL_OUTSET, CABIN_DIVIDER_X, CABIN_RIGHT, HABITAT_SPAWN, UPPER_DECK_OFFSET, type CabinDeck } from './cabinLayout.ts';
import { CABIN_STAIRS } from './cabinStairs.ts';
import * as THREE from 'three';

export type CabinView = 'overview' | CabinDeck;
export const CAMERA_FOV = 34;
export const HOME_ZOOM = 1.55;
export const EARTH_RADIUS = 195;
const upperY = UPPER_DECK_OFFSET[1];
const upperRight = CABIN_DIVIDER_X + UPPER_DECK_OFFSET[0];

export const HOME_TARGET = new THREE.Vector3(.52, 3.52, -.20);
const HOME_DIRECTION = new THREE.Vector3(-.27, .22, 1).normalize();
export const OUTFIT_TARGET = new THREE.Vector3(HABITAT_SPAWN[0], .76, HABITAT_SPAWN[1]);
const outfitDirection = new THREE.Vector3(-.75, .17, 1).normalize();
export function outfitCameraPosition(aspect: number) {
  return OUTFIT_TARGET.clone().addScaledVector(outfitDirection, Math.max(5.2, 2.3 / aspect));
}

type Bounds = { x: [number, number]; y: [number, number]; z: [number, number] };
const lowerBounds: Bounds[] = [
  { x: [CABIN_DIVIDER_X, CABIN_RIGHT], y: [-.28, 0], z: [-3.41, 3.19] },
  { x: [CABIN_DIVIDER_X, CABIN_RIGHT], y: [0, 3.77], z: [-3.41, -3.10] },
  { x: [4.01, CABIN_RIGHT], y: [0, 3.77], z: [-3.30, 3.19] },
];
const upperBounds: Bounds[] = [
  { x: [CABIN_DIVIDER_X, upperRight], y: [upperY - .23, upperY + .76], z: [-3.41, 3.19] },
  { x: [CABIN_DIVIDER_X, upperRight], y: [upperY, upperY + 3.77], z: [-3.41, -3.1] },
  { x: [upperRight - .03, upperRight + BEDROOM_WALL_OUTSET], y: [upperY - .21, upperY + 3.77], z: [-3.41, BEDROOM_WALL_FRONT] },
];
const stairBounds: Bounds = {
  x: [CABIN_STAIRS.x - CABIN_STAIRS.width / 2, CABIN_DIVIDER_X],
  y: [0, upperY + .76],
  z: [CABIN_STAIRS.upperZ - CABIN_STAIRS.width, CABIN_STAIRS.lowerZ + CABIN_STAIRS.width / 2],
};
const viewpoints = {
  overview: { target: HOME_TARGET, direction: HOME_DIRECTION, bounds: [...lowerBounds, ...upperBounds, stairBounds] },
  lower: {
    target: new THREE.Vector3(1.15, 1.42, -.20),
    direction: new THREE.Vector3(-.19, .36, 1).normalize(),
    bounds: lowerBounds,
  },
  upper: {
    target: new THREE.Vector3(.30, upperY + 1.26, -.18),
    direction: new THREE.Vector3(-.31, .43, 1).normalize(),
    bounds: upperBounds,
  },
};

const verticalSlope = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) / HOME_ZOOM;

/** Fit the occupied corners in both frustum axes while leaving space around the silhouette. */
export function cabinCameraFrame(view: CabinView, aspect: number) {
  const { target, direction, bounds } = viewpoints[view];
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), direction).normalize();
  const up = new THREE.Vector3().crossVectors(direction, right);
  const width = Math.max(.1, aspect);
  let distance = 0;
  for (const box of bounds) for (const x of box.x) for (const y of box.y) for (const z of box.z) {
    const corner = new THREE.Vector3(x, y, z).sub(target);
    distance = Math.max(distance, corner.dot(direction) + Math.max(
      Math.abs(corner.dot(right)) / (.88 * verticalSlope * width),
      Math.abs(corner.dot(up)) / (.86 * verticalSlope),
    ));
  }
  return { target, position: target.clone().addScaledVector(direction, distance), distance };
}

/** Place the limb in the lower panorama for the initial composition. */
export function earthPositionForAspect(aspect: number) {
  const eye = cabinCameraFrame('overview', aspect).position;
  const sight = new THREE.Vector3(.68, 2.60, -3.31).sub(eye).normalize();
  const down = new THREE.Vector3(.21, -1, 0);
  down.addScaledVector(sight, -down.dot(sight)).normalize();
  const distance = 910, angle = Math.asin(EARTH_RADIUS / distance);
  return sight.multiplyScalar(distance * Math.cos(angle)).addScaledVector(down, distance * Math.sin(angle)).toArray();
}
