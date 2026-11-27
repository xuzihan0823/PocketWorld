import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { load } from './load-for-validation.mjs';

const modules = new Map([['three', THREE], ['three/examples/jsm/loaders/GLTFLoader.js', { GLTFLoader }]]);
function local(name) {
  if (!modules.has(name)) {
    const scope = { exports: {}, require: local };
    vm.runInNewContext(ts.transpileModule(readFileSync(new URL(name.endsWith('.ts') ? name : name + '.ts', import.meta.url), 'utf8'),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, scope);
    modules.set(name, scope.exports);
  }
  return modules.get(name);
}
const { createResidentRig } = local('./residentRig');
const { createIdleState, createIdlePlayer, stepIdle } = local('./standingIdle');
const { createSeatedIdle, createSeatedIdlePlayer } = local('./seatedIdle');
const { sofaPlayer } = local('./sofaMotion');
const assets = new URL('../../../assets/public/models/resident/', import.meta.url);
const raw = readFileSync(new URL('luna-sofa-low-sit.glb', assets));
const { animations: [sofa] } = await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.length), '');
const files = { everyday: 'luna-walk-room.glb', ribbon: 'luna-ribbon.glb', cardigan: 'luna-cardigan.glb' };
const down = new THREE.Vector3(0, -1, 0);

function palmContact(root, side, wrist, middle, normal) {
  const center = wrist.clone().lerp(middle, .6), samples = [], triangles = [];
  root.traverse(mesh => {
    if (!mesh.isSkinnedMesh) return;
    const geometry = mesh.geometry, indices = geometry.index;
    const joints = geometry.attributes.skinIndex, weights = geometry.attributes.skinWeight;
    const points = [], body = [];
    for (let i = 0; i < joints.count; i++) {
      const point = mesh.getVertexPosition(i, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
      points.push(point);
      let handWeight = 0, thighWeight = 0;
      for (let channel = 0; channel < 4; channel++) {
        const name = mesh.skeleton.bones[joints.getComponent(i, channel)].name;
        const weight = weights.getComponent(i, channel);
        if (name.includes(side + 'Hand')) handWeight += weight;
        if (/Hips|UpLeg|Dress/.test(name)) thighWeight += weight;
      }
      body.push(thighWeight > .75);
      if (handWeight > .75 && point.distanceTo(center) < .025 && point.clone().sub(center).dot(normal) > .002) samples.push(point);
    }
    for (let i = 0; i < indices.count; i += 3) {
      const ids = [indices.getX(i), indices.getX(i + 1), indices.getX(i + 2)];
      if (ids.every(id => body[id])) triangles.push(new THREE.Triangle(...ids.map(id => points[id])));
    }
  });
  assert(samples.length >= 8, side + ' has actual palm skin samples');
  const nearest = new THREE.Vector3();
  const distances = samples.map(point => {
    let distance = Infinity;
    for (const triangle of triangles) distance = Math.min(distance, triangle.closestPointToPoint(point, nearest).distanceTo(point));
    return distance;
  }).sort((a, b) => a - b);
  assert(distances[0] < .004, `${side} palm floats above the lap: ${distances[0]} m`);
  assert(distances[Math.floor(distances.length / 2)] < .015, `${side} only touches with a distant fingertip`);
}


test('camera input interrupts gestures without dropping standing pose; movement and contact still release it', () => {
  // Execute the production eligibility and step call, so accidentally coupling
  // idleInput back into standingAtRest is caught by this regression.
  const source = readFileSync(new URL('./OrbitalResidents.tsx', import.meta.url), 'utf8');
  const block = source.match(/    const standingAtRest = [\s\S]+?    idleInput\.current = false;/)?.[0];
  assert.ok(block, 'resident standing update exists');
  const update = new vm.Script(`{ ${block} }`);
  for (const hz of [30, 60, 120]) for (const reducedMotion of [false, true]) {
    const state = createIdleState(() => .5);
    const scope = vm.createContext({
      rig: { current: {} }, p: { enabled: true, focusedObject: null, reducedMotion },
      document: { hidden: false }, s: { posture: 'standing', exiting: false, path: [], stairs: null, external: false },
      wanted: 'standing', walking: false, distance: 0, walkWeight: { current: 0 }, keys: { current: new Set() },
      idleInput: { current: false }, approach: { current: null }, libraryActive: false,
      cabinPerformance: { current: null }, plushGrip: { current: null }, idleMotion: { current: {} },
      idle: { current: state }, cabin: { clips: {} }, rawDelta: 1 / hz, stepIdle, Math,
    });
    for (let i = 0; i < hz; i++) update.runInContext(scope);
    assert.equal(state.restWeight, 1);
    Object.assign(state, { elapsed: 10, weight: 1, shortTime: 1, shortWeight: 1 });
    for (let i = 0; i < hz * 2; i++) {
      scope.idleInput.current = true; // pointerdown, held pointermove, wheel
      update.runInContext(scope);
      assert.equal(state.restWeight, 1, 'dragging must preserve the authored arm pose');
    }
    assert.equal(state.elapsed, 0);
    assert.equal(state.weight, 0);
    assert.equal(state.shortTime, -1);
    for (const blocker of ['walking', 'focusedObject', 'posture']) {
      state.restWeight = 1;
      if (blocker === 'walking') scope.walking = true;
      if (blocker === 'focusedObject') scope.p.focusedObject = 'library';
      if (blocker === 'posture') scope.s.posture = 'seated';
      for (let i = 0; i < hz; i++) update.runInContext(scope);
      assert.equal(state.restWeight, 0, `${blocker} must release standing arms`);
      scope.walking = false; scope.p.focusedObject = null; scope.s.posture = 'standing';
    }
  }
});

for (const [outfit, file] of Object.entries(files)) {
  test(`${outfit}: Blender standing pose lowers both arms with inward palms and keeps planted supports`, async () => {
    const { gltf } = await load(new URL(file, assets));
    const clip = name => gltf.animations.find(value => value.name === name);
    const rig = createResidentRig(gltf.scene, clip('Walk_Grounded_Loop'), outfit === 'cardigan');
    rig.mesh.userData.outfit = outfit;
    const bone = name => rig.mesh.getObjectByName('mixamorig' + name);
    const position = name => bone(name).getWorldPosition(new THREE.Vector3());
    const state = createIdleState();
    const player = createIdlePlayer(rig.mesh, undefined, undefined, clip('Luna_Relaxed_Standing'));
    rig.applyPose(0, 0); rig.mesh.updateMatrixWorld(true);
    const fixed = ['Hips', 'LeftFoot', 'RightFoot'].map(position);
    try {
      for (const hz of [30, 60, 120]) {
        let previous;
        for (let frame = 0; frame <= hz; frame++) {
          state.restWeight = Math.min(1, frame / hz / .38);
          rig.applyPose(0, 0); player(state, false); rig.mesh.updateMatrixWorld(true);
          const current = ['LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand'].map(name => bone(name).quaternion.clone());
          if (previous) current.forEach((q, i) => assert(q.angleTo(previous[i]) < .24, 'rest pose must fade continuously'));
          previous = current;
        }
      }
      for (const [index, name] of ['Hips', 'LeftFoot', 'RightFoot'].entries()) assert(position(name).distanceTo(fixed[index]) < 1e-7);
      for (const side of ['Left', 'Right']) {
        const shoulder = position(side + 'Arm'), elbow = position(side + 'ForeArm'), wrist = position(side + 'Hand');
        const middle = position(side + 'HandIndex1').add(position(side + 'HandRing1')).add(position(side + 'HandPinky1')).multiplyScalar(1 / 3);
        const spread = elbow.clone().sub(shoulder).angleTo(down);
        const [minSpread, maxSpread] = outfit === 'cardigan' ? [.28, .32] : [.145, .18];
        assert(spread > minSpread && spread < maxSpread, `${outfit} ${side} arm spread: ${spread}`);
        assert(middle.clone().sub(wrist).angleTo(wrist.clone().sub(elbow)) < .21, `${side} wrist bends outward`);
        const normal = middle.clone().sub(wrist).cross(position(side + 'HandIndex1').sub(position(side + 'HandPinky1'))).normalize();
        assert(normal.x < -.85, `${side} palm does not face the body`); // Cross product reverses between sides.
      }
    } finally { rig.dispose(); }
  });

  test(`${outfit}: Blender sofa lap has real palm contact and continuous reversible seated blending`, async () => {
    const { gltf } = await load(new URL(file, assets));
    const clip = name => gltf.animations.find(value => value.name === name);
    const rig = createResidentRig(gltf.scene, clip('Walk_Grounded_Loop'), outfit === 'cardigan');
    const sofaClip = clip('Luna_CMU_75_20') ?? sofa;
    const seated = sofaPlayer(rig.mesh, sofaClip);
    const player = createSeatedIdlePlayer(rig, outfit, clip('Luna_Sofa_Lap'), clip('Luna_Sofa_Cheek'));
    const idle = createSeatedIdle(); // Also the production reduced-motion path: no decorative gesture.
    const bone = name => rig.mesh.getObjectByName('mixamorig' + name);
    const position = name => bone(name).getWorldPosition(new THREE.Vector3());
    const sample = time => {
      rig.applyPose(0, 0); seated(time);
      player(idle, THREE.MathUtils.smoothstep(time, sofaClip.duration * .62, sofaClip.duration * .94));
      rig.mesh.updateMatrixWorld(true);
    };
    try {
      rig.applyPose(0, 0); seated(sofaClip.duration); rig.mesh.updateMatrixWorld(true);
      const names = ['Hips', 'LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'];
      const fixed = names.map(position);
      for (const hz of [30, 60, 120]) for (const reverse of [false, true]) {
        let previous;
        for (let i = 0; i <= Math.ceil(sofaClip.duration * hz); i++) {
          const t = Math.min(sofaClip.duration, i / hz);
          sample(reverse ? sofaClip.duration - t : t);
          const current = ['LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand'].map(name => bone(name).quaternion.clone());
          if (previous) current.forEach((q, j) => assert(q.angleTo(previous[j]) < .25, 'lap handoff must not pop'));
          previous = current;
        }
      }
      sample(sofaClip.duration);
      names.forEach((name, index) => assert(position(name).distanceTo(fixed[index]) < 1e-7, name + ' support moved'));
      for (const side of ['Left', 'Right']) {
        const wrist = position(side + 'Hand'), middle = position(side + 'HandIndex1').add(position(side + 'HandRing1')).add(position(side + 'HandPinky1')).multiplyScalar(1 / 3);
        const normal = middle.clone().sub(wrist).cross(position(side + 'HandIndex1').sub(position(side + 'HandPinky1'))).normalize().multiplyScalar(side === 'Left' ? 1 : -1);
        assert(normal.dot(down) > .82, side + ' palm must face the thigh');
        assert(middle.clone().sub(wrist).angleTo(wrist.clone().sub(position(side + 'ForeArm'))) < .79, side + ' wrist is folded');
        assert(position(side + 'HandMiddle3').sub(middle).dot(normal) > -.004, side + ' fingers bend backwards');
        palmContact(rig.mesh, side, wrist, middle, normal);
      }
      // The authored cheek pose preserves the free hand and avoids the old folded wrist.
      const restingRight = position('RightHand');
      const palmAxis = side => position(side + 'HandIndex1').add(position(side + 'HandRing1'))
        .add(position(side + 'HandPinky1')).multiplyScalar(1 / 3).sub(position(side + 'Hand'));
      for (const hz of [30, 60, 120]) {
        let previous;
        for (let i = 0; i <= 4.8 * hz; i++) {
          rig.applyPose(0, 0); seated(sofaClip.duration);
          player({ seat: 'sofa', time: i / hz, weight: 1, release: 0, overlay: null }, 1);
          rig.mesh.updateMatrixWorld(true);
          assert(position('RightHand').distanceTo(restingRight) < .00001, 'free hand slides off the thigh');
          const forearm = position('LeftHand').sub(position('LeftForeArm'));
          assert(palmAxis('Left').angleTo(forearm) < .95, 'cheek gesture folds the wrist');
          const rotation = bone('LeftHand').quaternion.clone();
          if (previous) assert(rotation.angleTo(previous) < .21, 'cheek gesture pops');
          previous = rotation;
        }
      }

    } finally { rig.dispose(); }
  });
}
