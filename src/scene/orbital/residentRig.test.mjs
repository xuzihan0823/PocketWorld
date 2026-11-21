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

test('hair and skirt follow movement without shifting body bones and settle after stopping', () => {
  const { asset, rig, mesh } = instance();
  const bones = mesh.skeleton.bones;
  const base = bones.map(() => new THREE.Quaternion());
  const dt = 1 / 60;
  const speed = .576 * RESIDENT_SCALE;
  function pose(phase, yaw, walkWeight, dx, dz, enabled = true) {
    rig.applyPose(phase, walkWeight);
    bones.forEach((bone, i) => base[i].copy(bone.quaternion));
    rig.followMotion(dt, enabled, yaw, dx, dz, phase);
    const angles = { Hair_: 0, Dress_: 0 };
    bones.forEach((bone, i) => {
      const part = Object.keys(angles).find(prefix => bone.name.startsWith(prefix));
      const angle = bone.quaternion.clone().normalize().angleTo(base[i].normalize());
      if (part) angles[part] = Math.max(angles[part], angle);
      else assert(bone.quaternion.clone().normalize().equals(base[i]), bone.name);
    });
    return angles;
  }
  try {
    let angles;
    for (let i = 0; i < 40; i++) {
      const yaw = Math.min(i, 25) * .035;
      angles = pose(i * dt, yaw, 1, Math.sin(yaw) * speed * dt, Math.cos(yaw) * speed * dt);
    }
    assert(angles.Hair_ > .02 && angles.Dress_ > .012);
    angles = pose(.65, .875, 0, 0, 0);
    assert(angles.Hair_ > .01 && angles.Dress_ > .01, 'stop retains momentum');
    for (let i = 0; i < 90; i++) angles = pose(.65, .875, 0, 0, 0);
    assert(angles.Hair_ < .00001 && angles.Dress_ < .00001, 'settles on the authored pose');

    // Check the skinned surface so rotating a lightly weighted joint alone cannot pass.
    const indices = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    const vertices = { hair: [], skirt: [] };
    for (let index = 0; index < indices.count; index += 27) {
      for (let slot = 0; slot < 4; slot++) {
        if (weights.array[index * 4 + slot] < .55) continue;
        const name = bones[indices.array[index * 4 + slot]].name;
        if (/^Hair_(Back|Side)_.+_0[34]$/.test(name)) vertices.hair.push(index);
        if (/^Dress_.+_03$/.test(name)) vertices.skirt.push(index);
      }
    }
    const vertex = index => mesh.localToWorld(mesh.getVertexPosition(index, new THREE.Vector3()));
    const maximum = { hair: 0, skirt: 0 };
    for (let frame = 0; frame < 60; frame += 2) {
      const phase = frame / 60;
      rig.applyPose(phase, 1);
      rig.mesh.updateMatrixWorld(true);
      const rest = { hair: vertices.hair.map(vertex), skirt: vertices.skirt.map(vertex) };
      rig.followMotion(2 * dt, true, 0, 0, speed * 2 * dt, phase);
      rig.mesh.updateMatrixWorld(true);
      for (const part of ['hair', 'skirt']) {
        vertices[part].forEach((index, sample) => {
          maximum[part] = Math.max(maximum[part], vertex(index).distanceTo(rest[part][sample]));
        });
      }
    }
    assert(maximum.hair > .06 && maximum.hair < .11, `hair surface displacement: ${maximum.hair}`);
    assert(maximum.skirt > .029 && maximum.skirt < .065, `skirt surface displacement: ${maximum.skirt}`);
    pose(0, 0, 0, 0, 0, false);

    // Rotate the real head in place as the standing idle layer does.
    const head = asset.getObjectByName('mixamorigHead');
    let maxHair = 0;
    for (let i = 0; i < 25; i++) {
      rig.applyPose(0, 0);
      const hair = asset.getObjectByName('Hair_Back_C_02');
      const rest = hair.quaternion.clone();
      head.rotateY(i * .02);
      rig.followMotion(dt, true, .875, 0, 0, 0);
      maxHair = Math.max(maxHair, hair.quaternion.clone().normalize().angleTo(rest.normalize()));
    }
    assert(maxHair > .01, 'hair follows a turn of the head while standing');
    angles = pose(.65, .875, 0, 0, 0, false);
    assert(angles.Hair_ < .00001 && angles.Dress_ < .00001, 'contact and reduced motion use the base pose');
  } finally { rig.dispose(); }
});

test('free-standing upright posture removes spine hunch and matches walk torso alignment', () => {
  const bindScene = clone(gltf.scene);
  bindScene.updateMatrixWorld(true);
  const bindWorld = name => bindScene.getObjectByName('mixamorig' + name).getWorldQuaternion(new THREE.Quaternion());
  const pitchFromBind = (root, name) => {
    const q = root.getObjectByName('mixamorig' + name).getWorldQuaternion(new THREE.Quaternion())
      .multiply(bindWorld(name).invert());
    return new THREE.Euler().setFromQuaternion(q, 'XYZ').x;
  };
  const { asset, rig, mesh } = instance();
  try {
    rig.applyPose(0, 0, 1);
    rig.mesh.updateMatrixWorld(true);

    // 1. Spine stays upright relative to bind pose (eliminating the +12 deg Spine2 / +22 deg Neck hunch).
    for (const name of ['Hips', 'Spine', 'Spine1', 'Spine2']) {
      const pitch = pitchFromBind(asset, name);
      assert(Math.abs(pitch) < .06, `${name} should stay upright relative to bind pose (${pitch})`);
    }
    const neckPitch = pitchFromBind(asset, 'Neck');
    assert(Math.abs(neckPitch) < .12, `Neck should stay upright (${neckPitch})`);

    // 2. Knees straighten from the old ~20 deg crouch while both soles stay planted on the floor.
    const pos = name => asset.getObjectByName('mixamorig' + name).getWorldPosition(new THREE.Vector3());
    const hip = pos('LeftUpLeg'), knee = pos('LeftLeg'), ankle = pos('LeftFoot');
    const kneeFlex = Math.PI - hip.clone().sub(knee).angleTo(ankle.clone().sub(knee));
    assert(kneeFlex < .24, `standing knee flexion should stay light (${kneeFlex} rad)`);

    const point = new THREE.Vector3(), sole = new THREE.Box3();
    let minY = Infinity;
    for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
      mesh.localToWorld(mesh.getVertexPosition(i, point));
      minY = Math.min(minY, point.y);
      if (point.y < .025) sole.expandByPoint(point);
    }
    assert(minY >= -.002 && minY < .005, `upright standing sole height ${minY}`);
    for (const p of [pos('Hips'), pos('Neck')]) {
      assert(p.z > sole.min.z + .02 && p.z < sole.max.z - .02, 'upright body stays inside foot support');
    }

    // 3. Standing-to-walk chest pitch jump stays small (no hunch-to-upright pop).
    const standChest = pitchFromBind(asset, 'Spine2');
    for (const phase of [0, .25, .5, .75]) {
      rig.applyPose(phase, 1, 1);
      rig.mesh.updateMatrixWorld(true);
      const walkChest = pitchFromBind(asset, 'Spine2');
      assert(Math.abs(walkChest - standChest) < .09, `chest pitch jump at phase=${phase}: ${walkChest - standChest}`);
    }
  } finally { rig.dispose(); }
});
