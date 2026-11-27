import * as assetQueue from './assetQueue.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { load } from './load-for-validation.mjs';

function compile(file) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const context = { exports: {}, require: name => name === './assetQueue.ts' ? assetQueue : name === 'three' ? THREE : { GLTFLoader } };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context.exports;
}
const { createIdleState, stepIdle, createIdlePlayer, STANDING_IDLE } = compile('./standingIdle.ts');
const { createResidentRig } = compile('./residentRig.ts');
const random = () => .5;
const raw = readFileSync(new URL('../../../assets/public/models/resident/luna-yawn.glb', import.meta.url));
const { animations: [clip] } = await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), '');

test('all gestures finish without overlap and ordinary idle dominates at 30/60/120 Hz', () => {
  for (const hz of [30, 60, 120]) {
    for (const sample of [0, .5, .999]) {
      const rng = () => sample, state = createIdleState(rng);
      const counts = [0, 0, 0], seconds = [0, 0, 0];
      const durations = [clip.duration, STANDING_IDLE.shortDuration.listen, STANDING_IDLE.shortDuration.clasp];
      let previous = -1, started = 0, ended = -Infinity;
      for (let frame = 0; frame < hz * 1200; frame++) {
        stepIdle(state, 1 / hz, true, clip.duration, rng);
        assert([state.yawnTime, state.shortTime].filter(time => time >= 0).length <= 1);
        const active = state.yawnTime >= 0 ? 0 : state.shortTime < 0 ? -1 : state.shortKind === 'listen' ? 1 : 2;
        if (active >= 0) seconds[active] += 1 / hz;
        if (active !== previous) {
          if (previous >= 0) {
            assert.equal(active, -1, 'must return to ordinary idle');
            const duration = durations[previous];
            assert(Math.abs(frame / hz - started - duration) <= 2 / hz);
            ended = frame / hz;
          } else {
            assert(frame / hz - ended >= 8 - 2 / hz);
            counts[active]++;
            started = frame / hz;
          }
        }
        previous = active;
      }
      assert(counts.every(count => count > 0));
      assert(Math.abs(counts[1] - counts[2]) <= 1);
      assert(1200 - seconds.reduce((total, time) => total + time) > 1200 * .60);
    }
  }
});

test('ordinary idle dominates ten minutes at 30/60/120 Hz and yawns play once in full', () => {
  for (const hz of [30, 60, 120]) {
    const state = createIdleState(random);
    let yawnSeconds = 0, first = 0, count = 0, previous = -1;
    for (let frame = 0; frame < hz * 600; frame++) {
      stepIdle(state, 1 / hz, true, clip.duration, random);
      if (frame < hz * 5) assert.equal(state.weight, 0);
      if (state.yawnTime >= 0) {
        yawnSeconds += 1 / hz;
        if (previous < 0) { count++; first ||= frame / hz; }
      }
      previous = state.yawnTime;
    }
    assert(first >= 59.9 && first <= 60.1);
    assert(count >= 6 && count <= 7);
    assert(Math.abs(yawnSeconds - count * clip.duration) < .3);
    assert(yawnSeconds < 600 * .12);
  }
});

test('interruptions reset eligibility and fade the held gesture without restarting it', () => {
  const state = createIdleState(random);
  for (let i = 0; i < 62 * 60; i++) stepIdle(state, 1 / 60, true, clip.duration, random);
  assert(state.yawnTime > 1);
  const held = state.yawnTime;
  stepIdle(state, 1 / 60, false, clip.duration, random);
  assert.equal(state.elapsed, 0);
  assert.equal(state.yawnTime, held);
  for (let i = 0; i < 30; i++) stepIdle(state, 1 / 60, true, clip.duration, random);
  assert.equal(state.yawnTime, -1);
  assert.equal(state.yawnWeight, 0);
  stepIdle(state, 300, true, clip.duration, random);
  assert(state.elapsed < 1);
});

test('exported yawn binds to Luna and preserves every foot and root transform', async () => {
  const { gltf } = await load(new URL('../../../assets/public/models/resident/luna-walk-room.glb', import.meta.url));
  const rig = createResidentRig(gltf.scene, gltf.animations.find(c => c.name === 'Walk_Grounded_Loop'));
  const player = createIdlePlayer(rig.mesh, clip);
  rig.applyPose(0, 0);
  rig.mesh.updateMatrixWorld(true);
  const feet = ['LeftFoot', 'RightFoot', 'LeftToeBase', 'RightToeBase'].map(name => rig.mesh.getObjectByName('mixamorig' + name));
  const anchors = feet.map(bone => bone.matrixWorld.clone());
  const state = createIdleState(random);
  state.weight = 1;
  state.yawnWeight = 1;
  for (let frame = 0; frame <= 1000; frame++) {
    rig.applyPose(0, 0);
    state.elapsed = frame / 120;
    state.yawnTime = Math.min(frame / 120, clip.duration);
    player(state);
    rig.mesh.updateMatrixWorld(true);
    feet.forEach((bone, i) => assert.deepEqual(bone.matrixWorld.elements, anchors[i].elements));
    rig.mesh.traverse(bone => { if (bone.isBone) assert(bone.quaternion.toArray().every(Number.isFinite)); });
  }
  assert(Math.abs(clip.duration - 250 / 30) < 1e-6);
  assert.equal(clip.tracks.length, 54);
  rig.dispose();
});


test('ordinary idle visibly moves head and hands while preserving planted feet', async () => {
  const { gltf } = await load(new URL('../../../assets/public/models/resident/luna-walk-room.glb', import.meta.url));
  const rig = createResidentRig(gltf.scene, gltf.animations.find(c => c.name === 'Walk_Grounded_Loop'));
  const player = createIdlePlayer(rig.mesh);
  const state = createIdleState(random);
  state.weight = 1;
  const names = ['Head', 'LeftHand', 'RightHand', 'LeftFoot', 'RightFoot'];
  const joints = names.map(name => rig.mesh.getObjectByName('mixamorig' + name));
  const bounds = joints.map(() => new THREE.Box3());
  const point = new THREE.Vector3();
  try {
    for (let frame = 0; frame <= 9 * 60; frame++) {
      rig.applyPose(0, 0);
      state.phase = frame / 60;
      player(state);
      rig.mesh.updateMatrixWorld(true);
      joints.forEach((joint, i) => bounds[i].expandByPoint(joint.getWorldPosition(point)));
    }
    const travel = bounds.map(box => box.getSize(new THREE.Vector3()).length());
    for (let i = 0; i < 3; i++) assert(travel[i] > .015 && travel[i] < .14, names[i] + ' travel ' + travel[i]);
    assert(travel[3] < 1e-8 && travel[4] < 1e-8);
    console.log('ordinary idle movement in metres', Object.fromEntries(names.map((name, i) => [name, travel[i]])));
  } finally { rig.dispose(); }
});

test('丁香针织开衫的伸懒腰可绑定，并驱动两侧手腕', async () => {
  const { gltf } = await load(new URL('../../../assets/public/models/resident/luna-cardigan.glb', import.meta.url));
  const motion = gltf.animations.find(animation => animation.name === clip.name);
  assert.ok(motion, clip.name);
  assert.ok(Math.abs(motion.duration - clip.duration) < 1e-5);
  const player = createIdlePlayer(gltf.scene, motion);
  const state = createIdleState(random);
  state.yawnTime = motion.duration / 2;
  state.yawnWeight = 1;
  player(state);
  for (const side of ['Left', 'Right']) {
    const name = 'mixamorig' + side + 'Hand';
    const sample = motion.tracks.find(track => track.name === name + '.quaternion')
      .createInterpolant().evaluate(state.yawnTime);
    const expected = new THREE.Quaternion().fromArray(sample).normalize();
    assert.ok(gltf.scene.getObjectByName(name).quaternion.angleTo(expected) < .001);
  }
});

test('针织开衫两侧 Shape Keys 随各自的手臂受压和回弹', async () => {
  const { createSleeveContact } = compile('./wardrobe/sleeveContact.ts');
  const { gltf } = await load(new URL('../../../assets/public/models/resident/luna-cardigan.glb', import.meta.url));
  const rig = createResidentRig(gltf.scene, gltf.animations.find(a => a.name === 'Walk_Grounded_Loop'), true);
  try {
    const update = createSleeveContact(gltf.scene);
    const cloth = gltf.scene.getObjectByProperty('isSkinnedMesh', true);
    const left = cloth.morphTargetDictionary.SleeveContact_L, right = cloth.morphTargetDictionary.SleeveContact_R;
    const offsets = cloth.geometry.morphAttributes.position;
    assert.ok(offsets[left].array.some(value => value < -.005));
    assert.ok(offsets[right].array.some(value => value > .005));
    rig.applyPose(0, 0);
    update();
    assert.deepEqual([cloth.morphTargetInfluences[left], cloth.morphTargetInfluences[right]], [0, 0]);
    const yawn = gltf.animations.find(a => a.name === 'Luna_Yawn');
    const gesture = createIdlePlayer(rig.mesh, yawn);
    const state = createIdleState(random);
    let asymmetric = false, intermediate = false;
    for (let i = 0; i <= 60; i++) {
      rig.applyPose(0, 0);
      state.yawnTime = i / 60 * yawn.duration;
      state.yawnWeight = 1;
      gesture(state);
      update();
      const a = cloth.morphTargetInfluences[left], b = cloth.morphTargetInfluences[right];
      if (Math.abs(a - b) > .45) asymmetric = true;
      if ([a, b].some(value => value > .05 && value < .95)) intermediate = true;
    }
    assert.ok(asymmetric && intermediate);
    rig.applyPose(0, 0);
    update();
    assert.deepEqual([cloth.morphTargetInfluences[left], cloth.morphTargetInfluences[right]], [0, 0]);
  } finally { rig.dispose(); }
});

test('针织开衫自然站立时两只袖筒在肘部上下都保有宽度和厚度', async () => {
  const path = new URL('../../../assets/public/models/resident/luna-cardigan.glb', import.meta.url);
  const { gltf } = await load(path);
  const rig = createResidentRig(gltf.scene, gltf.animations.find(a => a.name === 'Walk_Grounded_Loop'), true);
  try {
    rig.applyPose(0, 0);
    compile('./wardrobe/sleeveContact.ts').createSleeveContact(gltf.scene)();
    rig.mesh.updateMatrixWorld(true);
    const cloth = gltf.scene.getObjectByProperty('isSkinnedMesh', true);
    const { skinIndex, position } = cloth.geometry.attributes;
    const point = new THREE.Vector3();
    for (const side of ['Left', 'Right']) {
      const [upper, elbow, wrist] = ['Arm', 'ForeArm', 'Hand'].map(name =>
        cloth.skeleton.getBoneByName('mixamorig' + side + name));
      const height = joint => cloth.worldToLocal(joint.getWorldPosition(point)).y;
      const bands = [upper, wrist].map(joint => ({
        y: THREE.MathUtils.lerp(height(elbow), height(joint), .32),
        section: new THREE.Box3(),
      }));
      for (let i = 0; i < position.count; i++) {
        const primary = cloth.skeleton.bones[skinIndex.getX(i)];
        if (primary !== upper && primary !== elbow) continue;
        cloth.getVertexPosition(i, point);
        for (const band of bands) {
          if (Math.abs(point.y - band.y) < .006) band.section.expandByPoint(point);
        }
      }
      for (const { section } of bands) {
        const { x: width, z: depth } = section.getSize(point);
        assert.ok(width > .032 && depth > .040 && width / depth > .44,
          side + ' sleeve cross-section ' + JSON.stringify({ width, depth }));
      }
    }
  } finally { rig.dispose(); }
});

test('针织开衫站立和呼吸时两侧袖口与衣身留有空隙', async () => {
  const { gltf } = await load(new URL('../../../assets/public/models/resident/luna-cardigan.glb', import.meta.url));
  const rig = createResidentRig(gltf.scene, gltf.animations.find(a => a.name === 'Walk_Grounded_Loop'), true);
  try {
    rig.mesh.userData.outfit = 'cardigan';
    const idle = createIdlePlayer(rig.mesh);
    const updateCloth = compile('./wardrobe/sleeveContact.ts').createSleeveContact(gltf.scene);
    const mesh = gltf.scene.getObjectByProperty('isSkinnedMesh', true);
    const { index, attributes } = mesh.geometry;
    const points = Array.from({ length: attributes.position.count }, () => new THREE.Vector3());
    const groups = { Left: [], Right: [], body: [] };
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      const names = ids.map(id => mesh.skeleton.bones[attributes.skinIndex.getX(id)].name);
      for (const side of ['Left', 'Right']) {
        if (names.every(name => name.includes(side) && /Arm|Hand/.test(name))) groups[side].push(ids);
      }
      if (names.every(name => /Hips|Spine|UpLeg|Dress/.test(name))) groups.body.push(ids);
    }
    function edge(triangles, y, sign, nearest) {
      let boundary = nearest ? Infinity : -Infinity;
      for (const ids of triangles) {
        for (let k = 0; k < 3; k++) {
          const a = points[ids[k]], b = points[ids[(k + 1) % 3]];
          if ((a.y > y) === (b.y > y)) continue;
          const x = sign * THREE.MathUtils.lerp(a.x, b.x, (y - a.y) / (b.y - a.y));
          boundary = nearest ? Math.min(boundary, x) : Math.max(boundary, x);
        }
      }
      return boundary;
    }
    const state = createIdleState(random);
    for (const phase of [0, 2.25, 4.5, 6.75]) {
      rig.applyPose(0, 0);
      state.weight = phase === 0 ? 0 : 1;
      state.phase = phase;
      idle(state);
      updateCloth();
      rig.mesh.updateMatrixWorld(true);
      points.forEach((point, id) => mesh.getVertexPosition(id, point));
      for (const side of ['Left', 'Right']) {
        const sign = side === 'Left' ? 1 : -1;
        const joint = name => mesh.worldToLocal(mesh.skeleton.getBoneByName('mixamorig' + side + name)
          .getWorldPosition(new THREE.Vector3()));
        const shoulder = joint('Arm'), elbow = joint('ForeArm'), wrist = joint('Hand');
        const spread = THREE.MathUtils.radToDeg(Math.atan2(Math.abs(elbow.x - shoulder.x), shoulder.y - elbow.y));
        assert.ok(spread > 12 && spread < 21.5, side + ' upper arm angle ' + spread);
        for (const fraction of [.75, .9]) {
          const y = THREE.MathUtils.lerp(elbow.y, wrist.y, fraction);
          const gap = edge(groups[side], y, sign, true) - edge(groups.body, y, sign, false);
          assert.ok(gap > .004 && gap < .04, JSON.stringify({ side, phase, fraction, gap }));
        }
      }
    }
  } finally { rig.dispose(); }
});

test('开衫领口和袖山在垂臂、摆臂与抬手时保持布面宽度', async () => {
  const { gltf } = await load(new URL('../../../assets/public/models/resident/luna-cardigan.glb', import.meta.url));
  const clip = name => gltf.animations.find(c => c.name === name);
  const rig = createResidentRig(gltf.scene, clip('Walk_Grounded_Loop'), true);
  const mesh = gltf.scene.getObjectByProperty('isSkinnedMesh', true);
  const mixer = new THREE.AnimationMixer(gltf.scene);
  try {
    const { index, attributes } = mesh.geometry;
    const bind = Array.from({ length: attributes.position.count }, (_, i) =>
      new THREE.Vector3().fromBufferAttribute(attributes.position, i));
    const center = new THREE.Vector3(), triangle = new THREE.Triangle();
    const panels = [[], []];
    for (let i = 0; i < index.count; i += 3) {
      const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
      if (ids.some(id => /Hair|Head/.test(mesh.skeleton.bones[attributes.skinIndex.getX(id)].name))) continue;
      triangle.set(...ids.map(id => bind[id])).getMidpoint(center);
      const x = Math.abs(center.x);
      if (x > .038 && x < .09 && center.y > .70 && center.y < .76 && center.z > .025) {
        panels[Number(center.x > 0)].push({ ids, area: triangle.getArea() });
      }
    }
    for (const panel of panels) assert.ok(panel.length > 50);
    const vertexIds = new Set(panels.flat().flatMap(({ ids }) => ids));
    const positions = new Map([...vertexIds].map(id => [id, new THREE.Vector3()]));
    for (const [pose, time] of [['stand', 0], ['walk', 0], ['walk', .25], ['walk', .5], ['walk', .75],
      ['Library_Pickup_2', 1.8], ['Luna_Yawn', 3.4]]) {
      mixer.stopAllAction();
      rig.applyPose(time, Number(pose === 'walk'));
      const gesture = clip(pose);
      if (pose !== 'stand' && pose !== 'walk') assert.ok(gesture, pose);
      if (gesture) { mixer.clipAction(gesture).reset().play(); mixer.setTime(time); }
      rig.mesh.updateMatrixWorld(true);
      for (const [id, point] of positions) mesh.getVertexPosition(id, point);
      for (const panel of panels) {
        const ratios = panel.map(({ ids, area }) =>
          triangle.set(...ids.map(id => positions.get(id))).getArea() / area).sort((a, b) => a - b);
        const nearMinimum = ratios[Math.floor(ratios.length * .01)];
        assert.ok(nearMinimum > (gesture ? .20 : .42), pose + ' collar compression ' + nearMinimum);
      }
    }
  } finally { mixer.stopAllAction(); rig.dispose(); }
});

test('针织开衫后摆中央在完整步态中连续变形', async () => {
  const { gltf } = await load(new URL('../../../assets/public/models/resident/luna-cardigan.glb', import.meta.url));
  const rig = createResidentRig(gltf.scene, gltf.animations.find(a => a.name === 'Walk_Grounded_Loop'), true);
  try {
    const mesh = gltf.scene.getObjectByProperty('isSkinnedMesh', true);
    const { position } = mesh.geometry.attributes;
    const index = mesh.geometry.index;
    const vertices = Array.from({ length: position.count }, (_, i) => new THREE.Vector3().fromBufferAttribute(position, i));
    // Follow five points across the visible back rib, including points between mesh vertices.
    const band = [-.036, -.018, 0, .018, .036].map(x => {
      const ray = new THREE.Ray(new THREE.Vector3(x, .487, -1), new THREE.Vector3(0, 0, 1));
      const hit = new THREE.Vector3();
      let anchor;
      for (let i = 0; i < index.count; i += 3) {
        const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
        const [a, b, c] = ids.map(id => vertices[id]);
        if (!ray.intersectTriangle(a, b, c, false, hit) || (anchor && hit.z >= anchor.rest.z)) continue;
        anchor = { ids, rest: hit.clone(), weights: THREE.Triangle.getBarycoord(hit, a, b, c, new THREE.Vector3()).toArray() };
      }
      assert.ok(anchor && anchor.rest.z < 0);
      return anchor;
    });
    const point = new THREE.Vector3();
    let largestBend = 0;
    for (let frame = 0; frame <= 24; frame++) {
      rig.applyPose(frame / 24, 1);
      rig.mesh.updateMatrixWorld(true);
      const displacement = band.map(({ ids, weights, rest }) => {
        const delta = rest.clone().negate();
        ids.forEach((id, i) => delta.addScaledVector(mesh.getVertexPosition(id, point), weights[i]));
        return delta;
      });
      for (let i = 1; i < displacement.length - 1; i++) {
        const localBend = displacement[i - 1].clone().lerp(displacement[i + 1], .5).sub(displacement[i]);
        largestBend = Math.max(largestBend, Math.hypot(localBend.y, localBend.z));
      }
    }
    assert.ok(largestBend < .002, '后摆中央折差 ' + largestBend);
  } finally { rig.dispose(); }
});

test('resting arms lower independently with cloth correctives and release for a reach or interaction', async () => {
  const { gltf, mesh } = await load(new URL('../../../assets/public/models/resident/luna-walk-room.glb', import.meta.url));
  const rig = createResidentRig(gltf.scene, gltf.animations.find(c => c.name === 'Walk_Grounded_Loop'));
  const player = createIdlePlayer(rig.mesh);
  const state = createIdleState(random);
  const bone = name => rig.mesh.getObjectByName('mixamorig' + name);
  const left = mesh.morphTargetDictionary.LeftArmContact;
  const right = mesh.morphTargetDictionary.RightArmContact;
  assert.notEqual(left, right);
  const weights = mesh.morphTargetInfluences;
  const place = name => bone(name).getWorldPosition(new THREE.Vector3());
  const w = () => ['LeftHand', 'RightHand'].map(place);
  const apply = (animated = true) => {
    rig.applyPose(0, 0);
    player(state, animated);
    rig.applyArmCorrectives(true);
  };
  try {
    apply();
    const initial = w();
    for (let i = 0; i < 60; i++) stepIdle(state, 1 / 60, false, 0, random, true);
    apply(false);
    assert.equal(state.weight, 0);
    assert.equal(state.shortTime, -1);
    assert(w().every((point, i) => Math.abs(point.x) < Math.abs(initial[i].x) - .03));
    assert(weights[left] > .42 && weights[right] > .42);

    // Lift one arm from the same pose; the opposite skirt side retains its own weight.
    const rightAtRest = weights[right];
    bone('LeftArm').rotateX(1.05);
    rig.applyArmCorrectives(true);
    assert(weights[left] < .15);
    assert.equal(weights[right], rightAtRest);

    Object.assign(state, { shortKind: 'clasp', shortTime: 2, shortWeight: 1, weight: 1 });
    apply();
    assert(place('LeftHandMiddle4').distanceTo(place('RightHandIndex4')) < .11);
    assert(weights[left] < .15 && weights[right] < .15);
    rig.applyArmCorrectives(false);
    assert(weights.every(value => value === 0));
  } finally {
    rig.dispose();
  }
});
