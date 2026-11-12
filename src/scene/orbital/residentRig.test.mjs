import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { load } from './rig-transfer/load-for-validation.mjs';
import { chairSurface } from './rig-transfer/chair-surface-review.mjs';

const source = readFileSync(new URL('./residentRig.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const module = { exports: {}, require: () => THREE };
vm.runInNewContext(compiled, module);
const { createResidentRig, RESIDENT_SCALE } = module.exports;
const { gltf, mesh: reference, sample } = await load(new URL('../../../public/models/resident/luna-walk-room.glb', import.meta.url));
const chairBytes = readFileSync(new URL('../../../public/models/resident/luna-chair-sit.glb', import.meta.url));
const chairAsset = await new GLTFLoader().parseAsync(chairBytes.buffer.slice(chairBytes.byteOffset, chairBytes.byteOffset + chairBytes.byteLength), '');

function instance() {
  const asset = clone(gltf.scene);
  const rig = createResidentRig(asset, gltf.animations[0], new THREE.Group(), chairAsset.animations[0]);
  const mesh = asset.getObjectByProperty('isSkinnedMesh', true);
  return { asset, rig, mesh };
}

test('the neutral stance puts both soles on the floor with separate foot positions', () => {
  const { asset, rig, mesh } = instance();
  try {
    rig.applyPose(0, 0, false);
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

test('chair clip keeps the high-seat feet suspended, preserves leg lengths and restores walking', () => {
  const { asset, rig, mesh } = instance();
  const joint = name => asset.getObjectByName('mixamorig' + name);
  const position = bone => bone.getWorldPosition(new THREE.Vector3());
  const legs = ['Left', 'Right'].map(side => ['UpLeg', 'Leg', 'Foot'].map(name => joint(side + name)));
  rig.applyPose(0, 0, false, { time: 3, weight: 1, perch: 0 });
  rig.mesh.updateMatrixWorld(true);
  const anchors = legs.map(leg => position(leg[2]));
  const lengths = legs.map(leg => [position(leg[0]).distanceTo(position(leg[1])), position(leg[1]).distanceTo(position(leg[2]))]);
  try {
    for (let f = 0; f <= 288; f++) {
      const time = f / 48;
      rig.applyPose(0, 0, false, { time, weight: 1, perch: 0 }); rig.mesh.updateMatrixWorld(true);
      legs.forEach((leg, side) => {
        if (time >= 3) assert(position(leg[2]).distanceTo(anchors[side]) < .001, `${time}/${side} resting ankle drift`);
        for (let segment = 0; segment < 2; segment++) assert(Math.abs(position(leg[segment]).distanceTo(position(leg[segment + 1])) - lengths[side][segment]) < .00001);
      });
      if (f % 24 === 0) for (let i = 0; i < mesh.geometry.attributes.position.count; i++)
        assert(mesh.getVertexPosition(i, new THREE.Vector3()).toArray().every(Number.isFinite));
    }
    rig.applyPose(.4, 1, false); sample(.4);
    mesh.skeleton.bones.forEach((bone, i) => assert(bone.quaternion.angleTo(reference.skeleton.bones[i].quaternion) < .001));
  } finally { rig.dispose(); }
});

for (const kind of ['rolling', 'lounge']) test(`${kind}: actual skin clears full-size cushion, arms and back through entry, idle and reverse`, async () => {
  const { rig, mesh } = instance(), surface = await chairSurface(kind, mesh);
  try {
    assert.deepEqual(surface.dimensions, kind === 'rolling' ? [.9,1.4,.9] : [1.04,1.4,1]);
    for (let frame=0;frame<=288;frame++) {
      const time=frame/48,transfer=THREE.MathUtils.smoothstep(time,1.4,2.75);
      rig.mesh.position.set(0,kind==='lounge'?-.037*transfer:0,.68+(kind==='lounge'?.065:0));
      rig.applyPose(0,0,true,{time,weight:1,perch:0});rig.mesh.updateMatrixWorld(true);
      const result=surface.sample();assert.equal(result.intersections,0,JSON.stringify({kind,time,...result}));
      if(time>=3) for(const gap of result.buttockGaps) assert(gap!==null&&gap>=0&&gap<.015,`${kind}/${time} unsupported buttock: ${gap}`);
    }
    for(const weight of [0,.25,.5,.75,1]) {
      rig.mesh.position.set(0,0,kind==='lounge'?.745:.68);rig.applyPose(0,0,true,{time:0,weight,perch:0});rig.mesh.updateMatrixWorld(true);
      assert.equal(surface.sample().intersections,0,`entry/release blend ${weight}`);
    }
  } finally {surface.dispose();rig.dispose();}
});

test('scoot entry, grounded push, recovery and cancellation keep skin outside the cushion', async () => {
  const {rig,mesh}=instance(),surface=await chairSurface('rolling',mesh);
  try {
    for(const time of [3,4.5,5.5]) for(let frame=0;frame<=72;frame++) {
      const perch=Math.min(1,frame/36),sole=.03+Math.max(0,frame-36)/36*.06;
      rig.mesh.position.set(0,-.36*perch,.68+.14*THREE.MathUtils.smoothstep(perch,0,.6));
      rig.applyPose(0,0,true,{time,weight:1,perch,sole,soleLift:0});rig.mesh.updateMatrixWorld(true);
      const sample=surface.sample(.35*perch);
      assert.equal(sample.intersections,0,`scoot ${time}/${perch}/${sole}`);
      if(perch===1) for(const gap of sample.buttockGaps) assert(gap!==null&&gap>=0&&gap<.02,`scoot support ${time}/${sole}/${gap}`);
      if(perch===1) {
        const min={Left:Infinity,Right:Infinity},si=mesh.geometry.attributes.skinIndex,sw=mesh.geometry.attributes.skinWeight;
        for(let i=0;i<si.count;i++)for(let n=0;n<4;n++) {
          const side=/^mixamorig(Left|Right)(?:Foot|Toe)/.exec(mesh.skeleton.bones[si.getComponent(i,n)].name)?.[1];
          if(side&&sw.getComponent(i,n)>.4)min[side]=Math.min(min[side],mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).y);
        }
        for(const [side,y] of Object.entries(min))assert(y>=-.002&&y<.006,`${time}/${sole}/${side} pushing sole ${y}`);
      }
    }
    for(let frame=0;frame<=120;frame++) {
      const elapsed=frame/60,time=Math.max(0,3-elapsed*1.35),perch=Math.exp(-7*elapsed);
      rig.mesh.position.set(0,-.36*perch,.68+.14*THREE.MathUtils.smoothstep(perch,0,.6));
      rig.applyPose(0,0,true,{time,weight:1,perch,sole:.03,soleLift:.06});rig.mesh.updateMatrixWorld(true);
      assert.equal(surface.sample(.35*perch).intersections,0,`scoot cancellation ${elapsed}`);
    }
  } finally {surface.dispose();rig.dispose();}
});

test('room uses the authored walk at full weight and does not share bone poses between rooms', () => {
  const a = instance(), b = instance();
  const otherHips = b.asset.getObjectByName('mixamorigHips').matrix.clone();
  try {
    for (const time of [0, .137, .489, .748, .999]) {
      a.rig.applyPose(time, 1, true);
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
    rig.applyPose(.4, 0, true);
    assert.equal(asset.scale.x, RESIDENT_SCALE);
    for (const [control, name] of [[rig.legs[0].foot, 'RightFoot'], [rig.arms[1].hand, 'LeftHand']]) {
      const actual = asset.getObjectByName('mixamorig' + name);
      assert(control.getWorldPosition(new THREE.Vector3()).distanceTo(actual.getWorldPosition(new THREE.Vector3())) < 1e-5, name);
    }
    const pose = asset.getObjectByName('mixamorigLeftArm').quaternion.clone();
    rig.applyPose(.4, 1, false);
    assert(pose.angleTo(asset.getObjectByName('mixamorigLeftArm').quaternion) > .1);
  } finally { rig.dispose(); }
});
