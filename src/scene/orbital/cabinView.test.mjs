import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CAMERA_FOV, EARTH_RADIUS, HOME_DIRECTION, HOME_TARGET, HOME_ZOOM, earthPositionForAspect, homeDistanceForAspect } from './cabinView.ts';

for (const [width, height] of [[1400, 950], [390, 844], [844, 390]]) {
  test(`the open cabin and Earth horizon are framed at ${width} × ${height}`, () => {
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, .08, 2000);
    camera.zoom = HOME_ZOOM;
    camera.position.copy(HOME_TARGET).addScaledVector(HOME_DIRECTION, homeDistanceForAspect(aspect));
    camera.lookAt(HOME_TARGET);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();
    // Four base corners, the back wall and the front end of the right wall.
    const corners = [
      [-6.57, -.23, -3.41], [-6.57, -.23, 3.18], [4.24, -.23, -3.41], [4.24, -.23, 3.18],
      [-6.57, 3.78, -3.41], [4.24, 3.78, -3.41], [4.24, 3.78, 3.18],
    ];
    for (const point of corners) {
      const { x, y } = new THREE.Vector3(...point).project(camera);
      assert.ok(Math.abs(x) < .95 && Math.abs(y) < .95, `cropped corner ${point}`);
    }
    const windowRay = new THREE.Vector3(.45, 2.6, -3.31).sub(camera.position).normalize();
    const earth = new THREE.Vector3(...earthPositionForAspect(aspect));
    assert.ok(earth.dot(windowRay) > 0);
    assert.ok(Math.abs(earth.clone().cross(windowRay).length() - EARTH_RADIUS) < .001);
  });
}
