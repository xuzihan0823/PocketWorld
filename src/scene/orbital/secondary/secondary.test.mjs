import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const output = ts.transpileModule(fs.readFileSync(new URL('./SecondaryMotion.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exports = {};
vm.runInNewContext(output, { exports, require: () => THREE });
const { SecondaryMotion } = exports;
const bytes = fs.readFileSync(new URL('../../../../public/models/resident/luna-tripo-dynamics.glb', import.meta.url));
const jsonLength = bytes.readUInt32LE(12);
const manifest = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString());
manifest.materials = [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }];
manifest.images = []; manifest.textures = [];
const json = Buffer.from(JSON.stringify(manifest).padEnd(Math.ceil(JSON.stringify(manifest).length / 4) * 4, ' '));
const bin = bytes.subarray(20 + jsonLength);
const buffer = Buffer.alloc(20 + json.length + bin.length);
buffer.writeUInt32LE(0x46546c67, 0); buffer.writeUInt32LE(2, 4); buffer.writeUInt32LE(buffer.length, 8);
buffer.writeUInt32LE(json.length, 12); buffer.writeUInt32LE(0x4e4f534a, 16); json.copy(buffer, 20); bin.copy(buffer, 20 + json.length);

async function fixture(clip = 'Walk') {
  const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
  const mover = new THREE.Group(); mover.add(gltf.scene); mover.updateMatrixWorld(true);
  const motion = new SecondaryMotion(gltf.scene), mixer = new THREE.AnimationMixer(gltf.scene);
  if (clip) mixer.clipAction(gltf.animations.find(a => a.name === clip)).play();
  return { gltf, mover, motion, mixer };
}

test('交付 GLB 保留 103 根骨骼、50 根辅助骨骼和四段实际动作', async () => {
  const { gltf, motion } = await fixture();
  assert.deepEqual(gltf.animations.map(a => a.name), ['Walk', 'ArmsUp', 'Sit', 'LieDown']);
  for (const animation of gltf.animations) assert.ok(animation.tracks.some(track =>
    track.name.endsWith('.quaternion') && track.values.some((value, index) => Math.abs(value - track.values[index % 4]) > .1)), animation.name);
  let mesh; gltf.scene.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
  assert.equal(mesh.skeleton.bones.length, 103); assert.equal(motion.joints.length, 50);
  const weights = mesh.geometry.attributes.skinWeight;
  for (let i = 0; i < weights.count; i++) assert.ok(Math.abs(weights.getX(i) + weights.getY(i) + weights.getZ(i) + weights.getW(i) - 1) < 1e-5);
  assert.equal(motion.capsules.length, 8);
});

test('30/60/144 fps 和不均匀帧间隔使用相同固定步动画与模拟', async () => {
  const states = [];
  for (const fps of [30, 60, 144, 0]) {
    const { mover, motion, mixer } = await fixture();
    let time = 0;
    const animate = dt => { time += dt; mixer.update(dt); mover.position.x = .12 * Math.sin(time * 2); };
    if (fps) for (let i = 0; i < 3 * fps; i++) motion.advance(1 / fps, animate);
    else for (let i = 0; i < 120; i++) { motion.advance(.008, animate); motion.advance(.017, animate); }
    assert.equal(motion.steps, 360);
    states.push(motion.snapshot());
  }
  for (const state of states.slice(1)) for (let i = 0; i < 50; i++) {
    assert.ok(new THREE.Vector3(...state.tails[i]).distanceTo(new THREE.Vector3(...states[0].tails[i])) < 1e-9);
  }
});

test('停止移动后衰减稳定；各关节始终保持旋转限制', async () => {
  const { mover, motion } = await fixture(null);
  motion.configure({ collisions: false });
  let t = 0;
  const step = dt => { t += dt; if (t < 1) mover.position.x = .2 * t; };
  for (let i = 0; i < 120; i++) motion.advance(1 / 120, step);
  const moving = motion.snapshot();
  assert.ok(moving.maxAngle > .01, 'moving hair should show inertia');
  for (let i = 0; i < 600; i++) motion.advance(1 / 120, step);
  const settled = motion.snapshot();
  assert.ok(settled.maxSpeed < .001, `settled speed ${settled.maxSpeed}`);
  assert.ok(settled.maxAngle < moving.maxAngle * .05);
  for (const joint of motion.joints) assert.ok(joint.base.angleTo(joint.bone.quaternion) <= joint.limit + 1e-5);
});

test('静态模式与原动画相同，反复开关无累计变换且不改身体骨骼', async () => {
  const current = await fixture('Sit'), reference = await fixture('Sit');
  current.motion.configure({ hair: false, dress: false, collisions: false });
  for (let i = 0; i < 120; i++) current.motion.advance(1 / 60, dt => { current.mixer.update(dt); reference.mixer.update(dt); });
  const expected = new Map(); reference.gltf.scene.traverse(o => { if (o.isBone) expected.set(o.name, o.quaternion.clone()); });
  current.gltf.scene.traverse(o => { if (o.isBone) assert.ok(o.quaternion.equals(expected.get(o.name)), o.name); });
  for (let i = 0; i < 30; i++) {
    current.motion.configure({ hair: true, dress: true, collisions: true }); current.motion.advance(1 / 60, () => {});
    current.motion.configure({ hair: false, dress: false, collisions: false }); current.motion.advance(1 / 60, () => {});
  }
  current.gltf.scene.traverse(o => { if (o.isBone) assert.ok(o.quaternion.equals(expected.get(o.name)), o.name); });
});

test('四段动作播放有限且满足旋转约束，碰撞减少采样穿透', async () => {
  const results = [];
  for (const clip of ['Walk', 'ArmsUp', 'Sit', 'LieDown']) {
    const values = [];
    for (const collisions of [false, true]) {
      const { motion, mixer } = await fixture(clip);
      motion.configure({ collisions });
      for (let i = 0; i < 240; i++) motion.advance(1 / 120, dt => mixer.update(dt));
      const state = motion.snapshot();
      assert.ok(state.tails.flat().every(Number.isFinite));
      for (const joint of motion.joints) assert.ok(joint.base.angleTo(joint.bone.quaternion) <= joint.limit + 1e-5, `${clip} ${joint.bone.name}`);
      values.push({ penetration: state.penetration, bone: state.contactBone, body: state.contactBody });
    }
    results.push({ clip, without: values[0], with: values[1] });
    assert.ok(values[1].penetration <= values[0].penetration + .002, JSON.stringify(results.at(-1)));
  }
  console.log('Collision samples:', JSON.stringify(results));
});

test('头发与裙摆独立开关只控制各自的弹簧', async () => {
  for (const enabled of ['hair', 'dress']) {
    const { motion, mover } = await fixture(null);
    motion.configure({ hair: enabled === 'hair', dress: enabled === 'dress', collisions: false });
    for (let i = 0; i < 120; i++) motion.advance(1 / 120, () => { mover.position.x += .0015; });
    let moving = 0;
    for (const joint of motion.joints) {
      if (joint.part !== enabled) assert.ok(joint.bone.quaternion.equals(joint.base));
      else moving = Math.max(moving, joint.bone.quaternion.angleTo(joint.base));
    }
    assert.ok(moving > .01);
  }
});

test('切后台和瞬移会复位，两个实例互不影响', async () => {
  const a = await fixture(), b = await fixture();
  a.motion.advance(1 / 60, dt => a.mixer.update(dt));
  const before = b.motion.snapshot();
  a.motion.advance(5, dt => a.mixer.update(dt)); assert.equal(a.motion.steps, 2);
  a.mover.position.set(5, 0, 0);
  a.motion.advance(1 / 60, dt => a.mixer.update(dt));
  assert.ok(a.motion.snapshot().tails.flat().every(Number.isFinite));
  assert.deepEqual(b.motion.snapshot(), before);
});

test('GLB 姿势修正跟随实际动画，切换动作和停止后不残留', async () => {
  const { gltf, mixer, motion } = await fixture(null);
  let mesh; gltf.scene.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
  assert.deepEqual(Object.keys(mesh.morphTargetDictionary), ['Axilla_Raise_1', 'Axilla_Raise_2', 'Axilla_Raise_3', 'Sit_Clearance', 'LieDown_Clearance']);
  for (const [name, expected] of [['ArmsUp', [0, 0, 1, 0, 0]], ['Sit', [0, 0, 0, 1, 0]], ['LieDown', [0, 0, 0, 0, 1]], ['Walk', [0, 0, 0, 0, 0]]]) {
    mixer.stopAllAction(); motion.reset();
    const action = mixer.clipAction(gltf.animations.find(a => a.name === name)).reset().play();
    mixer.update(0);
    assert.ok(mesh.morphTargetInfluences.every(value => Math.abs(value) < 1e-6), `${name} starts neutral`);
    motion.configure({ hair: false, dress: false, collisions: false });
    for (let i = 0; i < 240; i++) {
      motion.advance(1 / 120, dt => mixer.update(dt));
      assert.ok(mesh.morphTargetInfluences.every(w => Number.isFinite(w) && w >= -1e-6 && w <= 1 + 1e-6));
    }
    expected.forEach((value, index) => assert.ok(Math.abs(mesh.morphTargetInfluences[index] - value) < 1e-5, `${name}: ${mesh.morphTargetInfluences}`));
    motion.configure({ hair: true, dress: true, collisions: true });
    motion.advance(1 / 60, () => {});
    expected.forEach((value, index) => assert.ok(Math.abs(mesh.morphTargetInfluences[index] - value) < 1e-5));
    if (name !== 'Walk') {
      for (const time of [.4, 3.6]) {
        action.time = time; mixer.update(0);
        const transition = name === 'ArmsUp' ? [.5, .5, 0, 0, 0] : expected.map(value => value * .5);
        transition.forEach((value, index) => assert.ok(Math.abs(mesh.morphTargetInfluences[index] - value) < 1e-5, `${name} at ${time}`));
      }
      action.time = 4; mixer.update(0);
      assert.ok(mesh.morphTargetInfluences.every(value => Math.abs(value) < 1e-6), `${name} returns neutral`);
    }
  }
  mixer.stopAllAction();
  assert.ok(mesh.morphTargetInfluences.every(value => value === 0));
});
