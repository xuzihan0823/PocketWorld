import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { load } from './load-for-validation.mjs';

const source = readFileSync(new URL('./residentRig.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {}, require: () => THREE };
vm.runInNewContext(compiled, module);
const { createResidentRig, RESIDENT_SCALE } = module.exports;
const { gltf, mesh: reference, sample } = await load(new URL('../../../assets/public/models/resident/luna-walk-room.glb', import.meta.url));

function instance() {
  const asset = clone(gltf.scene);
  const rig = createResidentRig(asset, gltf.animations[0]);
  const mesh = asset.getObjectByProperty('isSkinnedMesh', true);
  return { asset, rig, mesh };
}

test('the neutral stance puts both soles on the floor with separate foot positions', () => {
  const { asset, rig, mesh } = instance();
  try {
    rig.applyPose(0, 0);
    rig.mesh.updateMatrixWorld(true);
    const left = asset.getObjectByName('mixamorigLeftFoot').getWorldPosition(new THREE.Vector3());
    const right = asset.getObjectByName('mixamorigRightFoot').getWorldPosition(new THREE.Vector3());
    assert(left.x - right.x > .10);
    const min = { Left: Infinity, Right: Infinity };
    const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
    const point = new THREE.Vector3();
    for (let i = 0; i < indices.count; i++) for (let n = 0; n < 4; n++) {
      if (weights.array[i * 4 + n] < .4) continue;
      const name = mesh.skeleton.bones[indices.array[i * 4 + n]].name;
      const side = /^mixamorig(Left|Right)(?:Foot|Toe)/.exec(name)?.[1];
      if (side) {
        mesh.getVertexPosition(i, point);
        min[side] = Math.min(min[side], mesh.localToWorld(point).y);
      }
    }
    for (const [side, y] of Object.entries(min)) assert(y >= -.002 && y < .005, `${side} sole at ${y}`);
  } finally { rig.dispose(); }
});

test('room uses the authored walk at full weight and does not share bone poses between rooms', () => {
  const a = instance(), b = instance();
  const otherHips = b.asset.getObjectByName('mixamorigHips').matrix.clone();
  try {
    for (const time of [0, .137, .489, .748, .999]) {
      a.rig.applyPose(time, 1);
      a.rig.mesh.updateMatrixWorld(true);
      sample(time);
      for (let i = 0; i < reference.skeleton.bones.length; i++) {
        const expected = reference.skeleton.bones[i], actual = a.mesh.skeleton.bones[i];
        assert(actual.position.distanceTo(expected.position) < 1e-7, expected.name);
        assert(actual.quaternion.angleTo(expected.quaternion) < 0.001, expected.name);
      }
      assert(b.asset.getObjectByName('mixamorigHips').matrix.equals(otherHips));
    }
  } finally { a.rig.dispose(); b.rig.dispose(); }
});

test('standing pelvis and neck are upright over the actual sole support area', () => {
  const { asset, rig, mesh } = instance();
  try {
    rig.applyPose(.73, 0);
    rig.mesh.updateMatrixWorld(true);
    const point = new THREE.Vector3(), sole = new THREE.Box3();
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.localToWorld(mesh.getVertexPosition(i, point));
      if (point.y < .025) sole.expandByPoint(point);
    }
    const hip = asset.getObjectByName('mixamorigHips').getWorldPosition(new THREE.Vector3());
    const neck = asset.getObjectByName('mixamorigNeck').getWorldPosition(new THREE.Vector3());
    for (const p of [hip, neck]) {
      assert(p.z > sole.min.z + .025 && p.z < sole.max.z - .025, 'body projects inside the foot support');
      assert(p.x > sole.min.x && p.x < sole.max.x, 'body remains between both feet');
    }
    assert(Math.abs(Math.atan2(neck.z - hip.z, neck.y - hip.y)) < .04, 'trunk is within 2.3 degrees of vertical');
    assert.deepEqual(rig.mesh.rotation.toArray().slice(0, 3), [0, 0, 0], 'balance must not tilt the character root');
  } finally { rig.dispose(); }
});

test('walk blending stays continuous at its endpoints and returns to the same balanced stance', () => {
  const { asset, rig } = instance();
  try {
    const joints = ['Hips', 'Neck', 'LeftFoot', 'RightFoot'].map(n => asset.getObjectByName('mixamorig' + n));
    for (const phase of [0, .2, .49, .7, .99]) for (const fps of [30, 60, 120]) {
      let previous;
      for (let step = 0; step <= Math.ceil(.14 * fps); step++) {
        const t = Math.min(1, step / (.14 * fps)), w = 1 - t * t * (3 - 2 * t);
        rig.applyPose(phase, w);
        rig.mesh.updateMatrixWorld(true);
        const pose = joints.map(j => j.getWorldPosition(new THREE.Vector3()));
        // A swinging foot can travel ~0.4 m during the existing 0.14 s stop.
        if (previous) pose.forEach((p, i) => assert(p.distanceTo(previous[i]) < 5 / fps, 'bounded joint speed during stopping'));
        previous = pose;
      }
      const stopped = previous;
      rig.applyPose((phase + .37) % 1, 0); rig.mesh.updateMatrixWorld(true);
      joints.forEach((j, i) => assert(j.getWorldPosition(new THREE.Vector3()).distanceTo(stopped[i]) < 1e-7));
      for (const endpoint of [0, 1]) {
        rig.applyPose(phase, endpoint); rig.mesh.updateMatrixWorld(true);
        const exact = joints.map(j => j.getWorldPosition(new THREE.Vector3()));
        rig.applyPose(phase, endpoint === 0 ? .0001 : .9999); rig.mesh.updateMatrixWorld(true);
        joints.forEach((j, i) => assert(j.getWorldPosition(new THREE.Vector3()).distanceTo(exact[i]) < .0001, 'no discontinuity entering or leaving walk'));
      }
    }
  } finally { rig.dispose(); }
});

test('interaction controls follow the skinned joints in room units and restore the walk', () => {
  const { asset, rig } = instance();
  try {
    rig.mesh.position.set(.4, .2, 1);
    rig.mesh.rotation.y = .86;
    rig.legs[0].thigh.rotation.x = -1.3;
    rig.legs[0].shin.rotation.x = 1.4;
    rig.arms[1].upper.rotation.set(-.55, .28, -.35);
    rig.arms[1].forearm.rotation.x = -.6;
    rig.applyPose(.4, 0);
    assert.equal(asset.scale.x, RESIDENT_SCALE);
    for (const [control, name] of [[rig.legs[0].foot, 'RightFoot'], [rig.arms[1].hand, 'LeftHand']]) {
      const actual = asset.getObjectByName('mixamorig' + name);
      assert(control.getWorldPosition(new THREE.Vector3()).distanceTo(actual.getWorldPosition(new THREE.Vector3())) < 1e-5, name);
    }
    const pose = asset.getObjectByName('mixamorigLeftArm').quaternion.clone();
    rig.applyPose(.4, 1);
    assert(pose.angleTo(asset.getObjectByName('mixamorigLeftArm').quaternion) > .1);
  } finally { rig.dispose(); }
});
