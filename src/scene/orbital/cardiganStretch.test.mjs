import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { load } from './load-for-validation.mjs';

const asset = new URL('../../../assets/public/models/resident/luna-cardigan.glb', import.meta.url);

async function fixture() {
  const context = await load(asset);
  context.rest();
  const { gltf } = context;
  const mesh = gltf.scene.getObjectByProperty('isSkinnedMesh', true);
  const position = bone => bone.getWorldPosition(new THREE.Vector3());
  const sides = ['Left', 'Right'].map(side => {
    const bones = ['Arm', 'ForeArm', 'Hand', 'HandIndex1', 'HandPinky1']
      .map(part => gltf.scene.getObjectByName('mixamorig' + side + part));
    return { side, bones, rest: bones.map(position), rotations: bones.map(b => b.getWorldQuaternion(new THREE.Quaternion())) };
  });
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const clip = gltf.animations.find(a => a.name === 'Luna_Yawn');
  assert.ok(clip);
  const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  return { mesh, sides, clip, sample(time) { mixer.setTime(time); context.update(); },
    close() { mixer.stopAllAction(); mixer.uncacheRoot(gltf.scene); } };
}

test('开衫伸展时上袖跟随上臂，不被胸廓牵成细带', async () => {
  const f = await fixture();
  try {
    const { mesh } = f;
    const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
    const regions = f.sides.map(({ side, bones, rest }) => {
      const axis = rest[2].clone().sub(rest[0]).normalize();
      const ids = [];
      for (let i = 0; i < position.count; i++) {
        const point = new THREE.Vector3().fromBufferAttribute(position, i);
        const delta = point.clone().sub(rest[1]), along = delta.dot(axis);
        if (Math.abs(point.x) < .105 || along < -.065 || along > -.03
          || delta.addScaledVector(axis, -along).length() > .05) continue;
        let hair = 0;
        for (let slot = 0; slot < 4; slot++) {
          if (/Hair/.test(mesh.skeleton.bones[skinIndex.getComponent(i, slot)].name)) hair += skinWeight.getComponent(i, slot);
        }
        if (hair <= .01) ids.push(i);
      }
      assert.ok(ids.length > 30, side + ' must sample the actual sleeve surface');
      return { side, ids, upper: bones[0], inverse: mesh.skeleton.boneInverses[mesh.skeleton.bones.indexOf(bones[0])] };
    });
    for (const time of [6.5, 6.75, 7, 7.25, 7.5]) {
      f.sample(time);
      for (const { side, ids, upper, inverse } of regions) {
        const skin = upper.matrixWorld.clone().multiply(inverse);
        for (const id of ids) {
          const expected = new THREE.Vector3().fromBufferAttribute(position, id).applyMatrix4(mesh.bindMatrix).applyMatrix4(skin);
          const actual = mesh.getVertexPosition(id, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
          assert.ok(actual.distanceTo(expected) < .006, `${side} sleeve pulled away from humerus at ${time}s`);
        }
      }
    }
  } finally { f.close(); }
});

test('开衫展开双臂时不过度轴转、折腕，展开与收手连续', async () => {
  const f = await fixture();
  try {
    assert.ok(Math.abs(f.clip.duration - 250 / 30) < 1e-5);
    for (const hz of [30, 60, 120]) {
      let previous;
      for (let frame = Math.ceil(6.2 * hz); frame <= Math.floor(8.25 * hz); frame++) {
        const time = frame / hz;
        f.sample(time);
        const current = [];
        for (const { side, bones, rest, rotations } of f.sides) {
          const points = bones.map(b => b.getWorldPosition(new THREE.Vector3()));
          current.push(...bones.slice(0, 3).map(b => b.getWorldQuaternion(new THREE.Quaternion())));
          if (time < 6.65 || time > 7.55) continue;
          const forearm = points[2].clone().sub(points[1]).normalize();
          const palm = points[3].clone().add(points[4]).multiplyScalar(.5).sub(points[2]).normalize();
          assert.ok(forearm.angleTo(palm) < THREE.MathUtils.degToRad(12), side + ' wrist overfold');
          for (const i of [0, 1]) {
            const axis = rest[i + 1].clone().sub(rest[i]).normalize();
            const direction = points[i + 1].clone().sub(points[i]).normalize();
            const delta = bones[i].getWorldQuaternion(new THREE.Quaternion()).multiply(rotations[i].clone().invert());
            const twist = new THREE.Quaternion().setFromUnitVectors(axis, direction).invert().multiply(delta);
            const angle = 2 * Math.atan2(new THREE.Vector3(twist.x, twist.y, twist.z).dot(axis), twist.w);
            assert.ok(Math.abs(Math.atan2(Math.sin(angle), Math.cos(angle))) < .55, side + ' arm twists during stretch');
          }
        }
        if (previous) current.forEach((q, i) => assert.ok(q.angleTo(previous[i]) < 10 / hz, `arm ${i} discontinuity ${q.angleTo(previous[i])} at ${time}s (${hz} Hz)`));
        previous = current;
      }
    }
  } finally { f.close(); }
});
