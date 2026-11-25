import assert from 'node:assert/strict';
import test from 'node:test';
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Raycaster, Vector2, Vector3 } from 'three';
import { panoramaBounds, panoramaFrame } from './CameraPresets.ts';
import { CameraProjection, setCameraRay } from './CameraTransition.ts';
import { CameraCollision, CAMERA_CLEARANCE, followCameraRoute } from './CameraCollision.ts';
import { SceneVisibilityManager, cameraHitVisible } from './SceneVisibilityManager.ts';
import { HOME_ZOOM, CAMERA_FOV } from '../cabinView.ts';

const vector = (x, y, z) => new Vector3(x, y, z);
const box = (x1, y1, z1, x2, y2, z2) => new Box3(vector(x1, y1, z1), vector(x2, y2, z2));

test('orthographic presets fit every occupied corner on portrait, desktop and landscape', () => {
  const projection = new CameraProjection();
  for (const aspect of [.46, 1.46, 2.3]) {
    for (const view of ['overview', 'lower', 'upper']) {
      const frame = panoramaFrame(view, aspect);
      const driver = new PerspectiveCamera(CAMERA_FOV, aspect, .08, 2000);
      driver.zoom = HOME_ZOOM;
      driver.position.copy(frame.position);
      driver.lookAt(frame.target);
      driver.updateProjectionMatrix();
      const camera = projection.sync(driver, frame.target, 0);
      const { min, max } = panoramaBounds(view);
      for (const x of [min.x, max.x]) for (const y of [min.y, max.y]) for (const z of [min.z, max.z]) {
        const point = vector(x, y, z).project(camera);
        assert.ok(Math.abs(point.x) < .9 && Math.abs(point.y) < .9);
      }
    }
  }
});

test('matched lenses preserve target-plane points and ray hits throughout the blend', () => {
  const driver = new PerspectiveCamera(40, 1.6, .08, 2000);
  driver.position.set(0, 0, 15);
  driver.setViewOffset(1280, 800, 150, 60, 1280, 800);
  const projection = new CameraProjection();
  const target = vector(0, 0, 0), point = vector(.7, -.2, 0);
  const raycaster = new Raycaster();
  const expected = point.clone().project(projection.sync(driver, target, 1));
  for (const mix of [0, .01, .25, .5, .75, .99, 1]) {
    const camera = projection.sync(driver, target, mix);
    const position = point.clone().project(camera);
    assert.ok(Math.abs(position.x - expected.x) < 1e-10);
    assert.ok(Math.abs(position.y - expected.y) < 1e-10);
    setCameraRay(raycaster, new Vector2(position.x, position.y), camera);
    assert.ok(raycaster.ray.distanceToPoint(point) < 1e-7);
    assert.ok(Math.abs(vector(0, 0, 15 - .08).project(camera).z + 1) < 1e-11);
  }
});

test('camera sweep stops at fast wall and floor crossings and chooses a clear path around an edge', () => {
  const collision = new CameraCollision();
  const wall = box(-.1, 0, -2, .1, 3, 2);
  const floor = box(-2, -.2, -2, 2, 0, 2);
  collision.setSolids([wall, floor]);
  const from = vector(-2, 1.5, 0), goal = vector(2, 1.8, 0);
  const corrected = goal.clone();
  collision.resolve(corrected, from);
  assert.ok(corrected.x < wall.min.x - CAMERA_CLEARANCE);
  assert.equal(corrected.y, goal.y);
  const below = vector(1.3, -8, .4);
  collision.resolve(below, vector(1.3, 3, .4));
  assert.ok(below.y > CAMERA_CLEARANCE);
  const route = collision.route(from, goal);
  assert.ok(route?.length > 2);
  const candidate = vector(0, 0, 0), prior = from.clone();
  for (let i = 1; i <= 100; i++) {
    followCameraRoute(candidate, route, i / 100);
    const expected = candidate.clone();
    collision.resolve(candidate, prior);
    assert.ok(expected.distanceTo(candidate) < 1e-8);
    prior.copy(candidate);
  }
  assert.deepEqual(candidate.toArray(), goal.toArray());
});

test('occluders fade in the opaque pass and recover their original material, hit and shadow state', () => {
  const collision = new CameraCollision();
  const visibility = new SceneVisibilityManager(collision);
  const scene = new Group();
  const shared = new MeshBasicMaterial();
  const wall = new Mesh(new BoxGeometry(5, 5, .2), shared);
  wall.name = 'Duplex_LowerShellBack';
  wall.position.z = -2;
  wall.castShadow = true;
  scene.add(wall);
  const camera = new PerspectiveCamera(40, 1, .08, 2000);
  const target = vector(0, 0, 0);
  function tick() {
    camera.lookAt(target);
    camera.updateMatrixWorld();
    visibility.refresh(scene, .05);
    visibility.update(camera, [{ point: target, deck: 'lower' }], 'lower', null, true, false, true, false, .05);
  }
  camera.position.set(0, 0, -5);
  tick();
  assert.notEqual(wall.material, shared);
  assert.equal(wall.material.transparent, false);
  assert.equal(wall.material.depthWrite, true);
  assert.equal(wall.material.alphaHash, true);
  for (let i = 0; i < 20; i++) tick();
  assert.equal(wall.castShadow, false);
  assert.equal(cameraHitVisible(wall), false);
  camera.position.z = 5;
  tick();
  assert.equal(cameraHitVisible(wall), false);
  for (let i = 0; i < 20; i++) tick();
  assert.equal(wall.material, shared);
  assert.equal(wall.castShadow, true);
  assert.equal(cameraHitVisible(wall), true);
  visibility.dispose();
  wall.geometry.dispose();
  shared.dispose();
});

test('deck and wall cuts share one opacity and repeated reversals restore material ownership', () => {
  const collision = new CameraCollision();
  const visibility = new SceneVisibilityManager(collision);
  const interior = new Group();
  const upper = new Group();
  upper.name = 'Cabin_UpperDeck';
  const material = new MeshBasicMaterial();
  const wall = new Mesh(new BoxGeometry(4, 4, .2), material);
  wall.name = 'Duplex_UpperShellBack';
  wall.position.z = -2;
  upper.add(wall);
  interior.add(upper);
  const amount = () => wall.material.opacity;
  const camera = new PerspectiveCamera(40, 1, .08, 2000);
  const target = vector(0, 0, 0);
  function tick(showUpper) {
    camera.lookAt(target);
    camera.updateMatrixWorld();
    visibility.refresh(interior, .05);
    visibility.update(camera, [{ point: target, deck: 'upper' }], 'upper', null, showUpper, false, true, false, .05);
  }
  camera.position.z = 5;
  tick(true);
  assert.equal(wall.material, material);
  tick(false);
  assert.equal(upper.visible, true);
  assert.ok(amount() < 1);
  camera.position.z = -5;
  const before = amount();
  tick(true);
  assert.ok(amount() <= before + 1e-10, 'the wall stays covered when the deck starts returning');
  tick(true);
  assert.ok(amount() < before);
  camera.position.z = 5;
  tick(false);
  for (let frame = 0; frame < 40; frame++) tick(false);
  assert.equal(upper.visible, false);
  assert.equal(wall.material, material);
  for (let frame = 0; frame < 40; frame++) tick(true);
  assert.equal(upper.visible, true);
  assert.equal(wall.material, material);
  visibility.dispose();
  wall.geometry.dispose();
  material.dispose();
});
