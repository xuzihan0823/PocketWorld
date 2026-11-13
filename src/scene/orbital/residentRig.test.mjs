import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { load } from './load-for-validation.mjs';
import { BOOK, leafPose, pageGripPose, pageTurnPose } from './journal/bookModel.ts';

function loadModule(path, dependencies = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { exports: {}, require: name => name === 'three' ? THREE : dependencies[name] };
  vm.runInNewContext(compiled, context);
  return context.exports;
}
const { createResidentRig, RESIDENT_SCALE, HIP_HEIGHT } = loadModule('./residentRig.ts');
const { reachJournalPage, resetJournalPose } = loadModule('./journal/residentPose.ts', {
  '../library/armPose': loadModule('./library/armPose.ts'),
});
const { JOURNAL_STAND, JOURNAL_POSITION, JOURNAL_YAW, JOURNAL_SCALE } = loadModule('./journalLayout.ts');
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

test('both hands pinch the moving diary corner and the walk restores the authored fingers', () => {
  const { asset, rig } = instance();
  const stand = new THREE.Group(), hips = new THREE.Group(), book = new THREE.Group();
  stand.position.set(JOURNAL_STAND[0], 0, JOURNAL_STAND[1]);
  stand.rotation.y = Math.PI;
  hips.position.y = HIP_HEIGHT;
  rig.mesh.position.y = -HIP_HEIGHT;
  stand.add(hips); hips.add(rig.mesh);
  book.position.set(...JOURNAL_POSITION);
  book.rotation.y = JOURNAL_YAW;
  book.scale.setScalar(JOURNAL_SCALE);
  try {
    for (const direction of [1, -1]) {
      const side = direction === 1 ? 0 : 1;
      const name = side === 0 ? 'Right' : 'Left';
      const thumb = asset.getObjectByName('mixamorig' + name + 'HandThumb4');
      const index = asset.getObjectByName('mixamorig' + name + 'HandIndex4');
      const knuckle = asset.getObjectByName('mixamorig' + name + 'HandIndex1');
      rig.applyPose(0, 0);
      const idle = knuckle.quaternion.clone();
      for (const leaf of [0, BOOK.leaves - 1]) for (let step = 24; step <= 68; step += 2) {
        const { reach, grip, corner, page } = pageTurnPose(step / 100);
        const turned = direction === 1 ? page : 1 - page;
        const shape = leafPose(leaf, turned, 1, leaf + turned, BOOK.leaves);
        const contact = pageGripPose(shape, corner * direction, direction);
        const point = book.localToWorld(new THREE.Vector3(contact.x, contact.y, contact.z));
        const normal = new THREE.Vector3(contact.nx, contact.ny, 0).transformDirection(book.matrixWorld);
        resetJournalPose(rig);
        reachJournalPage(rig, hips, { side, reach, grip, point, normal });
        rig.applyPose(0, 0);
        rig.arms[side].pinch.apply(grip);
        const pads = thumb.getWorldPosition(new THREE.Vector3()).lerp(index.getWorldPosition(new THREE.Vector3()), .5);
        assert(pads.distanceTo(point) < .003, `${name} fingertips missed leaf ${leaf} at ${step}%`);
        assert(knuckle.quaternion.angleTo(idle) > .1);
      }
      resetJournalPose(rig);
      rig.applyPose(0, 0);
      assert(knuckle.quaternion.equals(idle));
    }
  } finally { rig.dispose(); }
});
