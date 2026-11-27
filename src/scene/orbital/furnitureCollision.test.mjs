import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { FLOOR_SOFA } from './cabinLayout.ts';
import { load } from './load-for-validation.mjs';

const inside = (x, z) => FLOOR_SOFA.footprints.some(([a, b, c, d]) => x >= a && x <= b && z >= c && z <= d);

test('sofa collision strips cover the actual fitted GLB and leave its empty corners open', async () => {
  const { gltf } = await load(new URL('../../../assets/public/models/furniture/floor-sofa.glb', import.meta.url));
  const model = gltf.scene;
  const bounds = new THREE.Box3().setFromObject(model, true);
  const scale = FLOOR_SOFA.width / (bounds.max.x - bounds.min.x);
  const center = bounds.getCenter(new THREE.Vector3());
  model.scale.setScalar(scale);
  model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
  const group = new THREE.Group();
  group.rotation.y = FLOOR_SOFA.yaw;
  group.add(model);
  group.updateMatrixWorld(true);
  for (const pressure of [0, 1]) {
    model.traverse(part => {
      if (!part.isMesh) return;
      const index = part.morphTargetDictionary?.Seated;
      if (index !== undefined) part.morphTargetInfluences[index] = pressure;
      const vertex = new THREE.Vector3();
      for (let i = 0; i < part.geometry.attributes.position.count; i++) {
        part.getVertexPosition(i, vertex).applyMatrix4(part.matrixWorld);
        assert.ok(inside(vertex.x, vertex.z), `${part.name} pressure ${pressure}: ${vertex.x}, ${vertex.z} must stay solid`);
      }
    });
  }
  for (const [x, z] of [[.70, -.85], [-.65, -.80], [-.55, .85], [.70, .85]]) {
    assert.equal(inside(x, z), false, `empty corner ${x}, ${z} should not be solid`);
  }
  const area = FLOOR_SOFA.footprints.reduce((sum, [a, b, c, d]) => sum + (b - a) * (d - c), 0);
  assert.ok(area < 1.52 * 1.79 * .80, 'remove at least 20% of the old empty rectangular footprint');
});
