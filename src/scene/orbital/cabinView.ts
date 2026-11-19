import { CABIN_LEFT, CABIN_RIGHT, CABIN_CENTER_X } from './cabinLayout.ts';
import * as THREE from 'three';

export const CAMERA_FOV = 34;
export const HOME_ZOOM = 1.55;
export const HOME_TARGET = new THREE.Vector3(CABIN_CENTER_X, 1.08, -.10);
export const HOME_DIRECTION = new THREE.Vector3(-7.8, 7.6, 13.5).normalize();
export const EARTH_RADIUS = 195;
const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), HOME_DIRECTION).normalize();
const up = new THREE.Vector3().crossVectors(HOME_DIRECTION, right);
const verticalSlope = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) / HOME_ZOOM;

/** Fit the plinth and the two standing walls against both view frustum axes. */
export function homeDistanceForAspect(aspect: number) {
  let distance = 0;
  for (const x of [CABIN_LEFT, CABIN_RIGHT]) for (const z of [-3.41, 3.18]) for (const y of [-.23, 3.78]) {
    if (x < 0 && z > 0 && y > 0) continue;
    const corner = new THREE.Vector3(x, y, z).sub(HOME_TARGET);
    distance = Math.max(distance, corner.dot(HOME_DIRECTION) + Math.max(
      Math.abs(corner.dot(right)) / (.92 * verticalSlope * aspect),
      Math.abs(corner.dot(up)) / (.90 * verticalSlope),
    ));
  }
  return distance;
}

/** Place the limb in the panorama for the initial composition, then leave the sky free to orbit. */
export function earthPositionForAspect(aspect: number) {
  const eye = HOME_TARGET.clone().addScaledVector(HOME_DIRECTION, homeDistanceForAspect(aspect));
  const sight = new THREE.Vector3(.45, 2.60, -3.31).sub(eye).normalize();
  const down = new THREE.Vector3(.21, -1, 0);
  down.addScaledVector(sight, -down.dot(sight)).normalize();
  const distance = 910, angle = Math.asin(EARTH_RADIUS / distance);
  return sight.multiplyScalar(distance * Math.cos(angle)).addScaledVector(down, distance * Math.sin(angle)).toArray();
}
