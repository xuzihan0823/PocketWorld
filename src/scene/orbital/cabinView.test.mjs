import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { BEDROOM_WALL_FRONT, BEDROOM_WALL_OUTSET, CABIN_DIVIDER_X, CABIN_RIGHT, UPPER_DECK_OFFSET } from './cabinLayout.ts';
import { CAMERA_FOV, EARTH_RADIUS, HOME_ZOOM, cabinCameraFrame, earthPositionForAspect } from './cabinView.ts';
import { CABIN_STAIRS, STAIR_DISTANCE, sampleCabinStairs, stairLanding } from './cabinStairs.ts';

const [upperX, upperY] = UPPER_DECK_OFFSET;
const upperRight = CABIN_DIVIDER_X + upperX;
const lower = [
  [CABIN_DIVIDER_X, -.28, -3.41], [CABIN_DIVIDER_X, -.28, 3.19],
  [CABIN_RIGHT, -.28, -3.41], [CABIN_RIGHT, -.28, 3.19],
  [CABIN_DIVIDER_X, 3.77, -3.41], [CABIN_RIGHT, 3.77, -3.41], [CABIN_RIGHT, 3.77, 3.19],
];
const upper = [
  [CABIN_DIVIDER_X, upperY + .76, 3.19], [upperRight, upperY + .76, 3.19],
  [CABIN_DIVIDER_X, upperY + 3.77, -3.41], [upperRight, upperY + 3.77, -3.41],
  [upperRight + BEDROOM_WALL_OUTSET, upperY + 3.77, BEDROOM_WALL_FRONT],
];
const stairsLeft = CABIN_STAIRS.x - CABIN_STAIRS.width / 2;
const stairs = [
  [stairsLeft, 0, CABIN_STAIRS.lowerZ], [stairsLeft, upperY + .76, CABIN_STAIRS.upperZ],
];

for (const [width, height] of [[1400, 950], [390, 844], [844, 390]]) {
  test(`the cabin overview and both floor presets fit at ${width} × ${height}`, () => {
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, .08, 2000);
    camera.zoom = HOME_ZOOM;
    for (const [view, corners] of [['overview', [...lower, ...upper, ...stairs]], ['lower', lower], ['upper', upper]]) {
      const frame = cabinCameraFrame(view, aspect);
      camera.position.copy(frame.position);
      camera.lookAt(frame.target);
      camera.updateMatrixWorld();
      camera.updateProjectionMatrix();
      for (const point of corners) {
        const { x, y } = new THREE.Vector3(...point).project(camera);
        assert.ok(Math.abs(x) < .95 && Math.abs(y) < .95, `${view} cropped ${point}`);
      }
    }
    const eye = cabinCameraFrame('overview', aspect).position;
    const windowRay = new THREE.Vector3(.68, 2.6, -3.31).sub(eye).normalize();
    const earth = new THREE.Vector3(...earthPositionForAspect(aspect));
    assert.ok(earth.dot(windowRay) > 0);
    assert.ok(Math.abs(earth.clone().cross(windowRay).length() - EARTH_RADIUS) < .001);
  });
}

test('the stair path connects the authored landings at their actual deck elevations', () => {
  const lower = stairLanding('lower');
  const upper = stairLanding('upper');
  assert.deepEqual(sampleCabinStairs(0).position, [lower[0], 0, lower[1]]);
  const end = sampleCabinStairs(STAIR_DISTANCE).position;
  assert.ok(Math.hypot(end[0] - (upper[0] + upperX), end[1] - upperY, end[2] - upper[1]) < 1e-10);
  let last = sampleCabinStairs(0);
  for (let index = 1; index <= 1000; index++) {
    const next = sampleCabinStairs(STAIR_DISTANCE * index / 1000);
    assert.ok(next.position[1] >= last.position[1] - 1e-10);
    assert.ok(Math.hypot(...next.position.map((value, axis) => value - last.position[axis])) < .03);
    last = next;
  }
});
