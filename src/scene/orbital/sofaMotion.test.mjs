import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { load } from './load-for-validation.mjs';
import { FLOOR_SOFA } from './cabinLayout.ts';

function module(file, dependencies) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const context = { exports: {}, require: id => dependencies[id] };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context.exports;
}
const resident = module('./residentRig.ts', { three: THREE });
const { createSeatedIdlePlayer } = module('./seatedIdle.ts', {
  three: THREE, './seatedIdleFrames': module('./seatedIdleFrames.ts', {}),
});
const { SOFA_ENTRY, SOFA_STEPS, sofaPlayer, sofaPressure } = module('./sofaMotion.ts', {
  three: THREE, './cabinLayout': { FLOOR_SOFA }, './residentRig': resident,
  'three/examples/jsm/loaders/GLTFLoader.js': { GLTFLoader },
});

test('Low Sit matches standing, plants both feet throughout descent and restores the entry on reversal', async () => {
  const dir = new URL('../../../assets/public/models/resident/', import.meta.url);
  const { gltf } = await load(new URL('luna-walk-room.glb', dir));
  const rig = resident.createResidentRig(gltf.scene, gltf.animations.find(c => c.name === 'Walk_Grounded_Loop'));
  try {
    const raw = fs.readFileSync(new URL('luna-sofa-low-sit.glb', dir));
    const { animations: [clip] } = await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), '');
    assert.equal(clip.name, 'Luna_CMU_75_20');
    const apply = sofaPlayer(rig.mesh, clip);
    const position = name => rig.mesh.getObjectByName('mixamorig' + name).getWorldPosition(new THREE.Vector3());
    rig.applyPose(0, 0);
    const feet = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'];
    const planted = feet.map(position);
    const standing = position('Hips');
    const drift = new THREE.Vector3();
    for (let sample = 0; sample <= 166; sample++) {
      apply(sample / 60);
      feet.forEach((name, i) => {
        drift.copy(position(name)).sub(planted[i]);
        assert(drift.length() < .001, name + ' drift ' + drift.length());
      });
    }
    const seated = position('Hips');
    assert(seated.y < standing.y - .18 && seated.z < standing.z - .4);
    apply(clip.duration * 3);
    assert(position('Hips').distanceTo(seated) < 1e-6);
    apply(0);
    assert(position('Hips').distanceTo(standing) < 1e-6);
  } finally { rig.dispose(); }
});

test('the everyday skirt settles onto the loaded sofa and still covers both thighs', async () => {
  const models = new URL('../../../assets/public/models/', import.meta.url);
  const [{ gltf }, { gltf: motion }, { gltf: furniture }] = await Promise.all([
    load(new URL('resident/luna-walk-room.glb', models)),
    load(new URL('resident/luna-sofa-low-sit.glb', models)),
    load(new URL('furniture/floor-sofa.glb', models)),
  ]);
  const rig = resident.createResidentRig(gltf.scene, gltf.animations.find(c => c.name === 'Walk_Grounded_Loop'));
  try {
    const sofa = furniture.scene;
    const bounds = new THREE.Box3().setFromObject(sofa, true);
    const center = bounds.getCenter(new THREE.Vector3());
    const scale = FLOOR_SOFA.width / (bounds.max.x - bounds.min.x);
    sofa.scale.setScalar(scale);
    sofa.position.set(-center.x, -bounds.min.y, -center.z).multiplyScalar(scale);
    const clip = motion.animations[0];
    sofa.traverse(mesh => {
      if (mesh.isMesh) mesh.morphTargetInfluences[mesh.morphTargetDictionary.Seated] = sofaPressure(clip.duration, 'everyday');
    });
    sofa.updateMatrixWorld(true);
    const seat = new THREE.Vector3(SOFA_ENTRY[0], 0, SOFA_ENTRY[1]).sub(new THREE.Vector3(...FLOOR_SOFA.position));
    seat.applyAxisAngle(new THREE.Vector3(0, 1, 0), -FLOOR_SOFA.yaw);
    seat.z -= SOFA_STEPS * resident.WALK_SPEED;
    rig.mesh.position.copy(seat);
    rig.applyPose(0, 0);
    const sit = sofaPlayer(rig.mesh, clip);
    const playIdle = createSeatedIdlePlayer(rig, 'everyday');
    sit(clip.duration);
    rig.mesh.updateMatrixWorld(true);
    const mesh = rig.mesh.getObjectByProperty('isSkinnedMesh', true);
    mesh.computeBoundingSphere();
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    function panel(i) {
      let slot = 0;
      for (let j = 1; j < 4; j++) if (skinWeight.getComponent(i, j) > skinWeight.getComponent(i, slot)) slot = j;
      return mesh.skeleton.bones[skinIndex.getComponent(i, slot)].name;
    }
    const lowest = new Map(), point = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
      const name = panel(i);
      if (!/^Dress_Back(?:_[LR])?_03$/.test(name)) continue;
      mesh.localToWorld(mesh.getVertexPosition(i, point));
      if (!lowest.has(name) || point.y < lowest.get(name).y) lowest.set(name, point.clone());
    }
    assert.equal(lowest.size, 3);
    const ray = new THREE.Raycaster();
    ray.ray.direction.set(0, -1, 0);
    for (const [name, hem] of lowest) {
      ray.ray.origin.set(hem.x, 1, hem.z);
      const [cushion] = ray.intersectObject(sofa);
      assert.ok(cushion, name + ' hangs beyond the cushion');
      const gap = hem.y - cushion.point.y;
      assert.ok(gap >= -.002 && gap < .055, name + ' cushion clearance ' + gap);
    }
    const hips = rig.mesh.getObjectByName('mixamorigHips').getWorldPosition(point);
    assert.ok(hips.z > .28 && hips.z < .32, 'pelvis rests inside the raised front lip');
    for (const time of [0, 2.2, 3.2]) {
      rig.applyPose(0, 0);
      sit(clip.duration);
      playIdle({ seat: 'sofa', gesture: 'legStretch', time, weight: Number(time > 0), release: 0 });
      rig.mesh.updateMatrixWorld(true);
      mesh.computeBoundingSphere();
      for (const side of ['Left', 'Right']) {
        const joint = suffix => rig.mesh.getObjectByName('mixamorig' + side + suffix).getWorldPosition(new THREE.Vector3());
        const probe = joint('UpLeg').lerp(joint('Leg'), .79);
        ray.ray.origin.set(probe.x, 1, probe.z);
        const hits = [];
        THREE.SkinnedMesh.prototype.raycast.call(mesh, ray, hits);
        hits.sort((a, b) => a.distance - b.distance);
        const cloth = hits.find(hit => panel(hit.face.a).startsWith('Dress_Front'));
        const thigh = hits.find(hit => panel(hit.face.a).endsWith('UpLeg'));
        assert.ok(cloth && thigh && cloth.point.y > thigh.point.y + .005, 'front hem clears the thigh');
      }
    }
  } finally { rig.dispose(); }
});

test('each fitted outfit loads the cushion, then releases it on the reverse timeline', () => {
  for (const outfit of ['everyday', 'ribbon', 'cardigan']) {
    assert.equal(sofaPressure(null, outfit), 0);
    assert.equal(sofaPressure(-.6, outfit), 0);
    assert.equal(sofaPressure(1.1, outfit), 0);
    assert(sofaPressure(2.1, outfit) > sofaPressure(2.76, outfit));
    assert(sofaPressure(2.76, outfit) > 0);
    assert.equal(sofaPressure(0, outfit), 0);
  }
});
