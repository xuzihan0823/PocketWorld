import assert from 'node:assert/strict';
import test from 'node:test';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { fitWardrobeGarment } from './garmentFit.ts';
import { createResidentRig } from '../residentRig.ts';
import { load } from '../load-for-validation.mjs';

test('wardrobe preserves fitted garment keys across swaps and releases the side fit for contact poses', async () => {
  for (const [outfit, file, keys] of [
    ['everyday', 'luna-walk-room', ['LeftArmContact', 'RightArmContact']],
    ['ribbon', 'luna-ribbon', []],
    ['cardigan', 'luna-cardigan', ['SleeveContact_L', 'SleeveContact_R']],
  ]) {
    const { gltf } = await load(`assets/public/models/resident/${file}.glb`);
    const source = gltf.scene.getObjectByProperty('isSkinnedMesh', true);
    const originals = [...(source.geometry.morphAttributes.position ?? [])];
    fitWardrobeGarment(gltf.scene, outfit);
    fitWardrobeGarment(gltf.scene, outfit);
    const asset = clone(gltf.scene);
    const mesh = asset.getObjectByName(source.name);
    const shapes = mesh.geometry.morphAttributes.position ?? [];
    for (const [i, key] of keys.entries()) assert.equal(shapes[mesh.morphTargetDictionary[key]], originals[i]);
    if (outfit === 'cardigan') {
      assert.equal(shapes.length, originals.length);
      continue;
    }
    assert.equal(shapes.length, originals.length + 1);
    const index = mesh.morphTargetDictionary.WardrobeSideEase;
    assert.ok(shapes[index].array.some(value => value !== 0));
    const walk = gltf.animations.find(clip => clip.name === 'Walk_Grounded_Loop');
    const rig = createResidentRig(asset, walk);
    rig.applyArmCorrectives(false, .075);
    assert.equal(mesh.morphTargetInfluences[index], .5);
    rig.applyArmCorrectives(false, .075);
    assert.equal(mesh.morphTargetInfluences[index], 0);
    assert.equal(source.morphTargetInfluences[index], 1, 'the cached wardrobe asset has its own influences');
    rig.applyArmCorrectives(true);
    assert.equal(mesh.morphTargetInfluences[index], 1);
    rig.dispose();
  }
});
