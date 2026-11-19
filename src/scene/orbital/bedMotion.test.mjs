import { BED_ENTRY, BED_POSITION } from './cabinLayout.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { load } from './load-for-validation.mjs';

function module(file, dependencies) {
  const context = { exports: {}, require: name => dependencies[name] };
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(file, import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, context);
  return context.exports;
}
const residentRig = module('./residentRig.ts', { three: THREE });
const { createResidentRig } = residentRig;
const { createBedPlayer, advanceBedTime, BED_YAW, BED_DURATION } = module('./bedMotion.ts',
  { three: THREE, './cabinLayout': { BED_ENTRY }, './residentRig': residentRig, 'three/examples/jsm/loaders/GLTFLoader.js': { GLTFLoader } });
const raw = fs.readFileSync(new URL('../../../assets/public/models/resident/luna-bed-v3.glb', import.meta.url));
const doc = JSON.parse(raw.subarray(20, 20 + raw.readUInt32LE(12)));
const animation = await new GLTFLoader().parseAsync(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength), '');
const clip = animation.animations[0];
const { gltf } = await load(new URL('../../../assets/public/models/resident/luna-walk-room.glb', import.meta.url));
function instance() {
  const rig = createResidentRig(clone(gltf.scene), gltf.animations[0]);
  const root = new THREE.Group(); root.position.set(BED_ENTRY[0], 0, BED_ENTRY[1]); root.rotation.y = BED_YAW; root.add(rig.mesh);
  const apply = createBedPlayer(rig.mesh, clip, rig.neutralPose);
  const bone = name => rig.mesh.getObjectByName('mixamorig' + name);
  const sample = time => { apply(time); root.updateMatrixWorld(true); };
  return { rig, root, bone, sample };
}

test('bed library is animation-only and binds all 115 original joints', () => {
  assert.equal(doc.meshes, undefined); assert.equal(doc.images, undefined); assert.equal(doc.skins, undefined);
  assert.equal(doc.nodes.length, 115); assert.equal(clip.duration, BED_DURATION);
  assert(raw.length < 1000000);
  const { rig, sample } = instance(); sample(BED_DURATION); rig.dispose();
});

test('bed entry matches neutral stance and exit restores original walking', () => {
  const { rig, root, bone, sample } = instance();
  try {
    rig.applyPose(0, 0); root.updateMatrixWorld(true);
    const names = ['Hips', 'Head', 'LeftFoot', 'RightFoot', 'RightLeg', 'LeftHand', 'RightHand'];
    const neutral = names.map(n => bone(n).getWorldPosition(new THREE.Vector3()));
    sample(0);
    names.forEach((n, i) => assert(bone(n).getWorldPosition(new THREE.Vector3()).distanceTo(neutral[i]) < .00001, n));
    const original = root.matrixWorld.clone();
    sample(141 / 24); assert(root.matrixWorld.equals(original), 'parent must not add bed translation');
    assert(bone('Hips').getWorldPosition(new THREE.Vector3()).x < BED_POSITION[0] + .1);
    sample(0); rig.applyPose(.37, 1); root.updateMatrixWorld(true);
    const walking = bone('RightFoot').quaternion.clone();
    sample(3); rig.applyPose(.37, 1);
    assert(walking.angleTo(bone('RightFoot').quaternion) < .00001);
  } finally { rig.dispose(); }
});

test('right ankle points forward while seated and never flips through the action', () => {
  const { rig, bone, sample } = instance();
  try {
    sample(2);
    const foot = side => bone(side + 'ToeBase').getWorldPosition(new THREE.Vector3()).sub(bone(side + 'Foot').getWorldPosition(new THREE.Vector3())).normalize();
    const left = foot('Left'), right = foot('Right');
    assert(right.x > .5, 'right foot must not point sideways or backwards');
    assert(left.dot(right) > .65, 'both feet should follow the seated facing');
    let previous = null, maximum = 0;
    for (let f = 0; f <= 444; f++) {
      sample(f / 48);
      const q = bone('RightFoot').getWorldQuaternion(new THREE.Quaternion());
      if (previous) maximum = Math.max(maximum, q.angleTo(previous));
      previous = q;
      for (const n of ['RightLeg', 'RightFoot', 'RightToeBase']) assert(bone(n).matrixWorld.elements.every(Number.isFinite));
    }
    assert(maximum < .08, 'right foot rotation exceeds 4.6 degrees per half frame');
  } finally { rig.dispose(); }
});

test('standing correction leaves authored bed contacts and sleeping pose unchanged', () => {
  const { rig, bone, sample } = instance();
  try {
    for (const time of [.6, 1.5, 3, 6, BED_DURATION]) {
      sample(time);
      for (const track of clip.tracks) {
        const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
        const expected = track.createInterpolant().evaluate(time);
        const value = rig.mesh.getObjectByName(nodeName)[propertyName].toArray();
        value.forEach((v, i) => assert(Math.abs(v - expected[i]) < 1e-7, track.name));
      }
    }
    const forward = [];
    for (let f = 0; f <= 36; f++) {
      sample(f / 60);
      forward.push(['Hips', 'Head', 'LeftFoot', 'RightFoot'].map(n => bone(n).getWorldPosition(new THREE.Vector3())));
    }
    for (let f = 36; f >= 0; f--) {
      sample(f / 60);
      ['Hips', 'Head', 'LeftFoot', 'RightFoot'].forEach((n, i) => {
        const p = bone(n).getWorldPosition(new THREE.Vector3());
        assert(p.distanceTo(forward[f][i]) < 1e-7, 'cancellation retraces the same entry pose');
        if (f) assert(p.distanceTo(forward[f - 1][i]) < .02, n + ' entry continuity');
      });
    }
  } finally { rig.dispose(); }
});

function bakedSampler(rig, root) {
  const tracks = clip.tracks.map(track => {
    const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
    return { value: rig.mesh.getObjectByName(nodeName)[propertyName], curve: track.createInterpolant() };
  });
  return time => {
    for (const { value, curve } of tracks) value.fromArray(curve.evaluate(time));
    root.updateMatrixWorld(true);
  };
}

test('bed entry correction preserves both authored foot trajectories and sole orientation', () => {
  const { rig, root, bone, sample } = instance();
  const sampleBaked = bakedSampler(rig, root);
  try {
    for (let frame = 0; frame <= 36; frame++) {
      const time = frame / 60;
      sampleBaked(time);
      const expected = ['Left', 'Right'].map(side => ({
        position: bone(side + 'Foot').getWorldPosition(new THREE.Vector3()),
        rotation: bone(side + 'Foot').getWorldQuaternion(new THREE.Quaternion()),
      }));
      sample(time);
      ['Left', 'Right'].forEach((side, i) => {
        const gap = bone(side + 'Foot').getWorldPosition(new THREE.Vector3()).distanceTo(expected[i].position);
        // The IK keeps a 0.1 mm safety bend when an authored leg is fully extended.
        assert(gap < .0002, JSON.stringify({frame, side, gap}));
        assert(bone(side + 'Foot').getWorldQuaternion(new THREE.Quaternion()).angleTo(expected[i].rotation) < .001);
      });
    }
  } finally { rig.dispose(); }
});

test('bed clock is stable at 30/60/120 Hz, clamps background gaps and reverses on cancel', () => {
  for (const fps of [30, 60, 120]) {
    let time = 0;
    for (let i = 0; i < fps * 3; i++) time = advanceBedTime(time, 1 / fps, false, false);
    assert(Math.abs(time - 3) < 1e-10);
    const next = advanceBedTime(time, 1 / fps, true, false);
    assert(next < time && time - next < .05);
  }
  assert.equal(advanceBedTime(1, 30, false, false), 1.04);
  assert.equal(advanceBedTime(.01, .04, true, false), 0);
  assert.equal(advanceBedTime(BED_DURATION, .04, false, false), BED_DURATION);
  let reduced = 0;
  for (let i = 0; i < 12; i++) reduced = advanceBedTime(reduced, .04, false, true);
  assert.equal(reduced, BED_DURATION);
});

// Luna's heel, ball and calf are skinned to multiple joints. Sample the visible
// surface, including ToeBase articulation, independently of the authored targets.
function legSurface(mesh, side) {
  const sign = side === 'Left' ? 1 : -1;
  const position = mesh.geometry.attributes.position;
  const vertices = [];
  for (let i = 0; i < position.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(position, i);
    if (p.x * sign > 0 && p.y < .25) vertices.push({ i, p });
  }
  function centroid(patch) {
    assert(patch.length >= 8, 'missing skin landmark');
    const v = new THREE.Vector3();
    return () => {
      const sum = new THREE.Vector3();
      for (const { i } of patch) sum.add(mesh.getVertexPosition(i, v));
      return mesh.localToWorld(sum.divideScalar(patch.length));
    };
  }
  function nearest(x, y, z) {
    const target = new THREE.Vector3(sign * x, y, z);
    return centroid([...vertices].sort((a, b) => a.p.distanceToSquared(target) - b.p.distanceToSquared(target)).slice(0, 8));
  }
  const ring = y => centroid(vertices.filter(({ p }) => Math.abs(p.y - y) < .009));
  return { heel: nearest(.076, .025, -.026), toe: nearest(.066, .006, .078),
    outer: nearest(.095, .007, .057), inner: nearest(.055, .007, .057), calf: ring(.215), ankle: ring(.11), sign };
}

test('climb and wake keep the skinned sole, toes and ankle aligned with the bending knee', () => {
  const { rig, sample, bone } = instance();
  try {
    const mesh = rig.mesh.getObjectByName('Luna_Surface');
    for (const side of ['Left', 'Right']) {
      sample(0);
      const skin = legSurface(mesh, side), foot = bone(side + 'Foot');
      const neutralInverse = foot.quaternion.clone().invert();
      const shinAxis = foot.position.clone().normalize(); // knee -> ankle in parent coordinates
      const startToe = skin.toe();
      const check = (hz, backwards) => {
        const dt = (backwards ? 1.35 : 1) / hz;
        let previous, toeDrift = 0;
        for (let i = 0; i <= Math.ceil(BED_DURATION / dt); i++) {
          const t = THREE.MathUtils.clamp(backwards ? BED_DURATION - i * dt : i * dt, 0, BED_DURATION);
          sample(t);
          const frame = t * 24;
          const limit = (name, degrees, max) => assert(Math.abs(degrees) < max,
            `${side} ${name} ${degrees.toFixed(2)} at frame ${frame.toFixed(2)} (limit ${max})`);
          const up = skin.calf().sub(skin.ankle()).normalize();
          const toe = skin.toe(), forward = toe.clone().sub(skin.heel()).normalize();
          const lateral = skin.outer().sub(skin.inner()).multiplyScalar(skin.sign).projectOnPlane(forward).normalize();
          const normal = forward.clone().cross(lateral);
          const thigh = bone(side + 'Leg').getWorldPosition(new THREE.Vector3())
            .sub(bone(side + 'UpLeg').getWorldPosition(new THREE.Vector3()));
          const kneeDirection = thigh.projectOnPlane(up).normalize();
          const delta = foot.quaternion.clone().multiply(neutralInverse);
          const rad = THREE.MathUtils.RAD2DEG;
          const twist = 2 * Math.atan2(new THREE.Vector3(delta.x, delta.y, delta.z).dot(shinAxis), delta.w) * rad;
          limit('axial ankle twist relative to standing', THREE.MathUtils.euclideanModulo(twist + 180, 360) - 180, 5);
          limit('sole roll', Math.asin(THREE.MathUtils.clamp(lateral.dot(up), -1, 1)) * rad, 8);
          limit('ankle flexion', Math.atan2(up.dot(forward), up.dot(normal)) * rad, 32);
          // The resident's neutral stance has inward knees. Require close tracking once the foot releases.
          limit('toe direction vs knee plane', Math.atan2(up.dot(kneeDirection.clone().cross(forward)), kneeDirection.dot(forward)) * rad,
            frame < 18 ? 36 : 9);
          const q = foot.getWorldQuaternion(new THREE.Quaternion());
          if (previous) {
            limit('foot angular speed (deg/s)', q.angleTo(previous.q) * rad / dt, 140);
            assert(toe.distanceTo(previous.toe) < 1.5 * dt, `${side} toe jumped at ${frame}`);
          }
          if (frame <= (side === 'Left' ? 13 : 17)) toeDrift = Math.max(toeDrift, toe.distanceTo(startToe));
          previous = { q, toe };
        }
        assert(toeDrift < .001, `${side} toe drifted ${toeDrift * 1000} mm before lift`);
      };
      check(24, false);
      check(60, false);
      check(60, true);
    }
  } finally { rig.dispose(); }
});

async function fittedBed() {
  const { gltf: bed } = await load(new URL('../../../assets/public/models/replaced/bed.glb', import.meta.url));
  const bounds = new THREE.Box3().setFromObject(bed.scene);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const fitted = new THREE.Group(); // HabitatFurniture's contact fit and placement
  fitted.scale.set(1.72 / size.x, 1.4 / size.y, 2.6 / size.z);
  bed.scene.position.set(-center.x, -bounds.min.y, -center.z);
  fitted.position.set(...BED_POSITION);
  fitted.add(bed.scene);
  fitted.updateMatrixWorld(true);
  return fitted;
}

// Keep each heel vertex's identity through contact, including the UV seam.
test('landing sole vertices stay planted from first contact through sleep', async () => {
  const fitted = await fittedBed();
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  const { rig, sample } = instance();
  try {
    const skin = rig.mesh.getObjectByName('Luna_Surface');
    for (const [side, latestContact, band] of [
      ['Left', 140, [18113, 18114, 18115, 18270]],
      ['Right', 147, [18103, 18104, 18105, 18106, 18269]],
    ]) {
      const paths = band.map(() => []);
      for (let tick = 325; tick <= 555; tick++) { // f130–222 at 60 Hz
        const frame = tick * 24 / 60;
        sample(frame / 24);
        for (const [j, index] of band.entries()) {
          const p = skin.localToWorld(skin.getVertexPosition(index, new THREE.Vector3()));
          ray.ray.origin.set(p.x, 2, p.z);
          const hit = ray.intersectObject(fitted, true)[0];
          assert(hit, `${side} landing missed the bed at f${frame}`);
          const gap = p.y - hit.point.y;
          assert(gap >= 0, `${side} vertex ${index} entered the mattress at f${frame}`);
          if (gap > .012) {
            assert(!paths[j].length && frame < latestContact, `${side} vertex ${index} lost contact at f${frame}`);
            continue;
          }
          // Diameter catches out-and-back glide as well as displacement between endpoints.
          const point = new THREE.Vector2(p.x, p.z);
          for (const prev of paths[j]) assert(point.distanceTo(prev) < .003,
            `${side} sole vertex ${index} slid 3 mm at f${frame}`);
          paths[j].push(point);
        }
      }
    }
  } finally { rig.dispose(); }
});

// Bounds are in authored seconds so the same reach and turn play at 1.35x on waking.
// The 55 cm reach takes 16/24 s. 1.4 m/s allows acceleration and the return to support.
// 450 deg/s allows the hand and curled fingers to turn together by 7.5 degrees per 60 Hz step.
for (const [label, joints, property, limit] of [
  ['wrist travel', ['Hand'], 'getWorldPosition', 1.4],
  ['fingertip rotation', ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].map(n => `Hand${n}4`),
    'getWorldQuaternion', THREE.MathUtils.degToRad(450)],
]) {
  test(`bed ${label} is continuous in the baked action, player and reverse`, () => {
    const { rig, root, bone, sample } = instance();
    const positions = property === 'getWorldPosition';
    const bones = ['Left', 'Right'].flatMap(side => joints.map(name => bone(side + name)));
    try {
      for (const [apply, reverse] of [[bakedSampler(rig, root), false], [sample, false], [sample, true]]) {
        const dt = (reverse ? 1.35 : 1) / 60;
        let previous;
        for (let i = 0; i <= Math.ceil(BED_DURATION / dt); i++) {
          const time = THREE.MathUtils.clamp(reverse ? BED_DURATION - i * dt : i * dt, 0, BED_DURATION);
          apply(time);
          const pose = bones.map(b => positions ? b.getWorldPosition(new THREE.Vector3())
            : b.getWorldQuaternion(new THREE.Quaternion()).normalize());
          if (previous) pose.forEach((value, j) => {
            const step = positions ? value.distanceTo(previous[j]) : value.angleTo(previous[j]);
            assert(step < limit * dt, `${bones[j].name} ${label} at f${(time * 24).toFixed(2)}: ${step}`);
          });
          previous = pose;
        }
      }
    } finally { rig.dispose(); }
  });
}

test('climb and wake distribute arm rotation and keep each palm aligned with its forearm', () => {
  const { rig, bone, sample } = instance();
  try {
    for (const side of ['Left', 'Right']) {
      const joints = ['Arm', 'ForeArm', 'Hand'].map(name => bone(side + name));
      const knuckles = ['Index', 'Middle', 'Ring', 'Pinky'].map(name => bone(`${side}Hand${name}1`));
      const point = joint => joint.getWorldPosition(new THREE.Vector3());
      for (const reverse of [false, true]) {
        const step = (reverse ? 1.35 : 1) / 96;
        let previous;
        for (let tick = 0; tick <= Math.ceil(BED_DURATION / step); tick++) {
          const time = THREE.MathUtils.clamp(reverse ? BED_DURATION - tick * step : tick * step, 0, BED_DURATION);
          sample(time);
          const wrist = point(joints[2]), forearm = wrist.clone().sub(point(joints[1]));
          const bases = knuckles.map(point);
          const axis = bases.reduce((sum, p) => sum.add(p), new THREE.Vector3()).multiplyScalar(.25).sub(wrist).normalize();
          const palm = bases[0].clone().sub(bases[3]).cross(axis).normalize();
          const rotations = joints.map(joint => joint.quaternion.clone().normalize());
          const where = `${side} at frame ${(time * 24).toFixed(2)}`;
          assert(forearm.angleTo(axis) < THREE.MathUtils.degToRad(72), `folded wrist: ${where}`);
          if (time >= 16 / 24 && time <= 43 / 24) {
            assert(palm.y * (side === 'Left' ? 1 : -1) > Math.cos(THREE.MathUtils.degToRad(32)), `turned palm: ${where}`);
          }
          if (previous) {
            const frames = Math.abs(time - previous.time) * 24;
            rotations.forEach((q, i) => assert(q.angleTo(previous.rotations[i]) < THREE.MathUtils.degToRad(12) * frames + 1e-6,
              `${joints[i].name} jumped: ${where}`));
            for (const [a, b] of [[axis, previous.axis], [palm, previous.palm]]) {
              assert(a.angleTo(b) < THREE.MathUtils.degToRad(10) * frames + 1e-6, `palm axis jumped: ${where}`);
            }
          }
          previous = { time, rotations, axis, palm };
        }
      }
    }
  } finally { rig.dispose(); }
});

test('both supporting hands stay on the fitted mattress while the hips rise', async () => {
  const fitted = await fittedBed(), { rig, bone, sample } = instance();
  const skin = rig.mesh.getObjectByName('Luna_Surface');
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  try {
    for (const [side, patch] of [['Left', [3643, 3868]], ['Right', [5384, 1603, 3583]]]) {
      sample(16 / 24);
      const hand = bone(side + 'Hand'), anchor = hand.getWorldPosition(new THREE.Vector3());
      for (let half = 32; half <= 86; half++) {
        sample(half / 48);
        let gap = Infinity;
        for (const i of patch) {
          const p = skin.localToWorld(skin.getVertexPosition(i, new THREE.Vector3()));
          ray.ray.origin.set(p.x, 2, p.z);
          const hit = ray.intersectObject(fitted, true)[0];
          assert(hit, `${side} hand missed the mattress at frame ${half / 2}`);
          gap = Math.min(gap, p.y - hit.point.y);
        }
        assert(gap >= 0 && gap < .002, `${side} support gap ${gap} at frame ${half / 2}`);
        assert(hand.getWorldPosition(new THREE.Vector3()).distanceTo(anchor) < .008, `${side} support slid`);
      }
    }
  } finally { rig.dispose(); }
});
