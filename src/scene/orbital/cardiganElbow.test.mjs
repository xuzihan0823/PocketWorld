import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { load } from './load-for-validation.mjs';

// Check the rendered sleeve, not only the IK joint positions: both were at the
// correct targets while Spine1/2 pulled the upper sleeve back toward the body.
test('cardigan sleeves follow the upper arms throughout three-row pickup and return', async t => {
  const { gltf } = await load(new URL('../../../assets/public/models/resident/luna-cardigan.glb', import.meta.url));
  const root = gltf.scene;
  const meshes = [];
  root.traverse(object => { if (object.isSkinnedMesh) meshes.push(object); });
  root.updateMatrixWorld(true);
  const bands = [];
  for (const side of ['Right', 'Left']) {
    const samples = [];
    for (const mesh of meshes) {
      const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
      const skeleton = mesh.skeleton;
      const upper = skeleton.bones.findIndex(b => b.name === 'mixamorig' + side + 'Arm');
      const elbow = skeleton.bones.findIndex(b => b.name === 'mixamorig' + side + 'ForeArm');
      assert.ok(upper >= 0 && elbow >= 0);
      const shoulderBind = new THREE.Vector3().setFromMatrixPosition(skeleton.boneInverses[upper].clone().invert());
      const elbowBind = new THREE.Vector3().setFromMatrixPosition(skeleton.boneInverses[elbow].clone().invert());
      const axis = elbowBind.clone().sub(shoulderBind).normalize();
      for (let id = 0; id < position.count; id++) {
        const bind = new THREE.Vector3().fromBufferAttribute(position, id);
        const offset = bind.clone().sub(elbowBind), along = offset.dot(axis);
        // Sample a cross-section of the upper sleeve clear of the shoulder and
        // hinge. Its surface must follow the humerus, with small cloth blending.
        if (along <= -.055 || along >= -.025 || Math.abs(bind.x) <= .105
          || offset.addScaledVector(axis, -along).length() >= .045) continue;
        let armWeight = 0, hairWeight = 0;
        for (let slot = 0; slot < 4; slot++) {
          const joint = skinIndex.getComponent(id, slot), weight = skinWeight.getComponent(id, slot);
          if (joint === upper || joint === elbow) armWeight += weight;
          if (skeleton.bones[joint].name.startsWith('Hair_')) hairWeight += weight;
        }
        if (armWeight > .1 && hairWeight < .01) samples.push({ mesh, id, bind, upper });
      }
    }
    assert.ok(samples.length >= 24, side + ' sleeve surface must be sampled');
    bands.push({ side, samples });
  }
  const mixer = new THREE.AnimationMixer(root);
  const expected = new THREE.Vector3(), actual = new THREE.Vector3(), skinMatrix = new THREE.Matrix4();
  let maximum = 0;
  try {
    for (let row = 0; row < 3; row++) {
      const source = gltf.animations.find(clip => clip.name === 'Library_Pickup_' + row);
      assert.ok(source);
      const clip = source.clone();
      clip.tracks = clip.tracks.filter(track => !track.name.startsWith('LibraryBook'));
      mixer.stopAllAction();
      const action = mixer.clipAction(clip).setLoop(THREE.LoopOnce, 1);
      action.clampWhenFinished = true;
      action.play();
      // Reverse seeks exercise the return path without allowing stateful drift.
      for (const direction of [1, -1]) for (let step = 0; step <= 360; step++) {
        const frame = direction === 1 ? step / 2 : 180 - step / 2;
        action.paused = false;
        mixer.setTime(frame / 30);
        root.updateMatrixWorld(true);
        for (const { side, samples } of bands) for (const { mesh, id, bind, upper } of samples) {
          skinMatrix.multiplyMatrices(mesh.skeleton.bones[upper].matrixWorld, mesh.skeleton.boneInverses[upper]);
          expected.copy(bind).applyMatrix4(mesh.bindMatrix).applyMatrix4(skinMatrix);
          mesh.getVertexPosition(id, actual).applyMatrix4(mesh.matrixWorld);
          const drift = expected.distanceTo(actual) * 1.43;
          maximum = Math.max(maximum, drift);
          assert.ok(drift < .006, `${side}, shelf ${row}, frame ${frame}: sleeve pulled ${(drift * 1000).toFixed(2)} mm from upper arm`);
        }
      }
    }
    t.diagnostic(`maximum upper-sleeve displacement: ${(maximum * 1000).toFixed(3)} mm`);
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    for (const mesh of meshes) mesh.skeleton.dispose();
  }
});
