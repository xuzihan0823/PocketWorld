import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { load } from './load-for-validation.mjs';
import { UPPER_DECK_OFFSET } from './cabinLayout.ts';
import { CABIN_STAIRS, STAIR_UPPER_PLATFORM_BACK } from './cabinStairs.ts';
import { CAMERA_FOV, EARTH_RADIUS, earthPositionForAspect } from './cabinView.ts';
import { createOrbitSunRig, createSunOrbit, sampleOrbitSun, startPhase } from './sunCycle.ts';
import {
  APPROACH_DURATION,
  BOOST_TIME_SCALE_EXTRA,
  SHIP_TARGET,
  approachStartPosition,
  createFlightState,
  hullOpacityForTransition,
  orbitCelestialLayout,
  orbitDistanceForAspect,
  orbitHomePosition,
  readInitialViewMode,
  stepFlightState,
} from './spacecraftFlight.ts';

test('initial view mode respects query params and reduced motion', () => {
  assert.equal(readInitialViewMode('', false), 'approach');
  assert.equal(readInitialViewMode('', true), 'orbit');
  assert.equal(readInitialViewMode('?view=orbit', false), 'orbit');
  assert.equal(readInitialViewMode('?view=cabin', false), 'cabin');
  assert.equal(readInitialViewMode('?dev=mario', false), 'cabin');
  assert.equal(readInitialViewMode('?dev=shooter', false), 'cabin');
});

test('orbital framing keeps the duplex spacecraft and Earth together in view across desktop and portrait', () => {
  for (const [width, height] of [[1440, 900], [390, 844], [844, 390]]) {
    const aspect = width / height;
    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, 0.08, 2000);
    const eye = orbitHomePosition(aspect);
    camera.position.copy(eye);
    camera.lookAt(SHIP_TARGET);
    camera.updateMatrixWorld();
    camera.updateProjectionMatrix();

    // Duplex spacecraft primary hull, upper loft, bow nose and tail fin stay uncropped
    for (const point of [
      [-7.20, -1.13, -4.93],
      [9.65, 9.04, 4.70],
      [-7.06, 10.30, -0.11],
      [9.88, 1.94, -0.11],
    ]) {
      const projected = new THREE.Vector3(...point).project(camera);
      assert.ok(Math.abs(projected.x) < 0.95 && Math.abs(projected.y) < 0.95, `${width}x${height} cropped ${point}`);
    }

    // Opening approach starts much farther out than settled orbit view
    const startDist = approachStartPosition(aspect).distanceTo(SHIP_TARGET);
    assert.ok(startDist > orbitDistanceForAspect(aspect) * 2.2);

    // Earth sits forward of the orbital camera look vector (visible behind/below the spacecraft)
    const lookDir = SHIP_TARGET.clone().sub(eye).normalize();
    const earthDir = new THREE.Vector3(...earthPositionForAspect(aspect)).normalize();
    assert.ok(lookDir.dot(earthDir) > 0.85, `${width}x${height} Earth alignment too weak: ${lookDir.dot(earthDir)}`);

    // Three-body orbital composition frames upper-left Sun, upper-right Moon, and lower LEO Earth horizon arc together
    const celestial = orbitCelestialLayout(aspect);
    const p0 = startPhase(createSunOrbit(earthPositionForAspect(aspect), EARTH_RADIUS));
    const sunRig = createOrbitSunRig(
      celestial.earthPosition,
      celestial.earthRadius,
      celestial.upDirection,
      celestial.sunStartTarget,
      p0,
    );
    const sunSample = sampleOrbitSun(sunRig, p0);
    const sunNdc = new THREE.Vector3(...sunSample.direction).multiplyScalar(1000).add(eye).project(camera);
    const moonNdc = new THREE.Vector3(...celestial.moonPosition).add(eye).project(camera);
    assert.ok(sunNdc.x < -0.25 && sunNdc.x > -0.88 && sunNdc.y > 0.20 && sunNdc.y < 0.85, `${width}x${height} Sun out of upper-left frame: ${sunNdc.x},${sunNdc.y}`);
    assert.ok(moonNdc.x > 0.20 && moonNdc.x < 0.85 && moonNdc.y > 0.20 && moonNdc.y < 0.85, `${width}x${height} Moon out of upper-right frame: ${moonNdc.x},${moonNdc.y}`);

    // Sweeping LEO Earth crest sits below the spacecraft center while staying inside the lower viewport
    const camUp = new THREE.Vector3(...celestial.upDirection).normalize();
    const orbitEarthCenter = new THREE.Vector3(...celestial.earthPosition);
    const radialToTop = camUp.clone().addScaledVector(orbitEarthCenter.clone().normalize(), -camUp.dot(orbitEarthCenter.clone().normalize())).normalize();
    const crestWorld = orbitEarthCenter.clone().addScaledVector(radialToTop, celestial.earthRadius).add(eye);
    const crestNdc = crestWorld.project(camera);
    assert.ok(crestNdc.y < -0.10 && crestNdc.y > -0.65, `${width}x${height} LEO Earth crest misaligned: ${crestNdc.y}`);
  }
});

test('exported duplex spacecraft-hull.glb encloses both cabin decks and stairs with animated rigs intact', async () => {
  const [{ gltf: hullGltf }, { gltf: cabinGltf }] = await Promise.all([
    load(new URL('../../../assets/public/models/cabin/spacecraft-hull.glb', import.meta.url)),
    load(new URL('../../../assets/public/models/cabin/open-cabin.glb', import.meta.url)),
  ]);
  hullGltf.scene.updateMatrixWorld(true);
  cabinGltf.scene.updateMatrixWorld(true);

  const mainBody = hullGltf.scene.getObjectByName('Hull_MainBody');
  assert.ok(mainBody, 'Hull_MainBody mesh must exist');
  for (const requiredNode of [
    'Comms_ParabolicDish',
    'Thruster_Plume_L',
    'Thruster_Plume_R',
    'Viewport_FrontBay_Glass',
    'Viewport_UpperFrontBay_Glass',
    'Viewport_BackPanorama_Glass',
    'BowCanopy_Glass',
    'Hull_InterDeckBrassBelt',
  ]) {
    assert.ok(hullGltf.scene.getObjectByName(requiredNode), `missing spacecraft node ${requiredNode}`);
  }

  const materials = new Set();
  hullGltf.scene.traverse(node => {
    if (!node.isMesh) return;
    const list = Array.isArray(node.material) ? node.material : [node.material];
    for (const mat of list) if (mat?.name) materials.add(mat.name);
  });
  for (const matName of ['Hull_CabinWarmGlow', 'Hull_ThrusterPlume', 'Hull_ThrusterCore', 'Hull_Porcelain', 'Hull_Apricot']) {
    assert.ok(materials.has(matName), `missing spacecraft material ${matName}`);
  }

  // Assemble the real duplex cabin bounding box (lower deck + shifted upper deck + staircase/guardrails)
  const cabinBox = new THREE.Box3();
  const lowerNames = ['Duplex_LowerShell', 'Duplex_DeckBase', 'Floor_Parquet', 'Stationery', 'Shelf_Gallery', 'Rugs'];
  const upperNames = ['Duplex_UpperShell', 'Duplex_BedroomBase', 'Floor_Parquet_Bedroom', 'Nightstand', 'Interactable_Wardrobe', 'Rugs_Upper'];
  const upperShift = new THREE.Vector3(...UPPER_DECK_OFFSET);

  for (const name of lowerNames) {
    const obj = cabinGltf.scene.getObjectByName(name);
    if (obj) cabinBox.expandByObject(obj);
  }
  for (const name of upperNames) {
    const obj = cabinGltf.scene.getObjectByName(name);
    if (!obj) continue;
    const b = new THREE.Box3().setFromObject(obj);
    b.min.add(upperShift);
    b.max.add(upperShift);
    cabinBox.union(b);
  }
  // Include staircase & upper landing guardrail envelope
  cabinBox.expandByPoint(new THREE.Vector3(CABIN_STAIRS.x - CABIN_STAIRS.width / 2, -0.22, STAIR_UPPER_PLATFORM_BACK));
  cabinBox.expandByPoint(new THREE.Vector3(CABIN_STAIRS.x + CABIN_STAIRS.width / 2, UPPER_DECK_OFFSET[1] + 0.79, CABIN_STAIRS.lowerZ + CABIN_STAIRS.width / 2));

  const hullBox = new THREE.Box3().setFromObject(mainBody);
  // Every axis of the main duplex fuselage encloses the entire two-story cabin + stairs with generous clearance
  assert.ok(hullBox.min.x < cabinBox.min.x - 1.0, `stern clearance too tight: hull=${hullBox.min.x} cabin=${cabinBox.min.x}`);
  assert.ok(hullBox.max.x > cabinBox.max.x + 1.0, `bow clearance too tight: hull=${hullBox.max.x} cabin=${cabinBox.max.x}`);
  assert.ok(hullBox.min.y < cabinBox.min.y - 0.5, `belly clearance too tight: hull=${hullBox.min.y} cabin=${cabinBox.min.y}`);
  assert.ok(hullBox.max.y > cabinBox.max.y + 0.8, `roof clearance too tight: hull=${hullBox.max.y} cabin=${cabinBox.max.y}`);
  assert.ok(hullBox.min.z < cabinBox.min.z - 0.8, `back flank clearance too tight: hull=${hullBox.min.z} cabin=${cabinBox.min.z}`);
  assert.ok(hullBox.max.z > cabinBox.max.z + 0.8, `front flank clearance too tight: hull=${hullBox.max.z} cabin=${cabinBox.max.z}`);
});

test('boost ramps up smoothly, accelerates orbital time and Earth spin, then coasts down cleanly', () => {
  const flight = createFlightState('orbit');
  assert.equal(flight.timeScale, 1);

  flight.boosting = true;
  for (let i = 0; i < 60; i++) stepFlightState(flight, 1 / 60, false);
  assert.ok(flight.boost > 0.9, `expected near-full boost, got ${flight.boost}`);
  assert.ok(flight.timeScale > 1 + BOOST_TIME_SCALE_EXTRA * 0.9);
  const boostedSpin = flight.earthSpinAngle;
  assert.ok(boostedSpin > 0.15);

  flight.boosting = false;
  for (let i = 0; i < 240; i++) stepFlightState(flight, 1 / 60, false);
  assert.ok(flight.boost < 0.02, `expected boost decay, got ${flight.boost}`);
  assert.ok(flight.timeScale < 1.8);
});

test('opening approach transitions cleanly to orbit and reduced motion skips long glide', () => {
  const normal = createFlightState('approach');
  let finished = false;
  for (let i = 0; i < Math.ceil(APPROACH_DURATION * 60) + 5; i++) {
    if (stepFlightState(normal, 1 / 60, false)) finished = true;
  }
  assert.equal(finished, true);
  assert.equal(normal.mode, 'orbit');
  assert.equal(normal.approachProgress, 1);

  const reduced = createFlightState('approach');
  assert.equal(stepFlightState(reduced, 1 / 60, true), true);
  assert.equal(reduced.mode, 'orbit');
});

test('hull opacity fades smoothly during enter/leave transitions and stays solid or hidden at endpoints', () => {
  assert.equal(hullOpacityForTransition('orbit', 0), 1);
  assert.equal(hullOpacityForTransition('cabin', 0), 0);
  assert.equal(hullOpacityForTransition('entering-cabin', 0), 1);
  assert.ok(hullOpacityForTransition('entering-cabin', 0.5) > 0.2 && hullOpacityForTransition('entering-cabin', 0.5) < 0.8);
  assert.equal(hullOpacityForTransition('entering-cabin', 1), 0);
  assert.equal(hullOpacityForTransition('leaving-cabin', 0), 0);
  assert.ok(hullOpacityForTransition('leaving-cabin', 0.5) > 0.2 && hullOpacityForTransition('leaving-cabin', 0.5) < 0.8);
  assert.equal(hullOpacityForTransition('leaving-cabin', 1), 1);
});
