import assert from 'node:assert/strict';
import test from 'node:test';
import { Bone, BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, Skeleton, SkinnedMesh, Vector3 } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createServer } from 'vite';
import { load } from '../orbital/load-for-validation.mjs';
import { createSleeveReference } from './sleeveReference.ts';

test('the guard uses immutable edge and area references and shares protection across a split seam', () => {
  const geometry = new BufferGeometry();
  const bind = new Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0, 0,0,0, 0,1,0, -1,0,0], 3);
  geometry.setAttribute('position', bind);
  geometry.setIndex([0,1,2, 3,4,5]);
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  const pose = bind.clone();
  mesh.getVertexPosition = (id, out) => out.fromBufferAttribute(pose, id);
  const reference = createSleeveReference(mesh, new Set([0,1,2,3,4,5]));
  mesh.scale.set(2,3,4);
  mesh.updateMatrixWorld(true);
  reference.sample();
  assert.deepEqual([0,1,2,3,4,5].map(id => reference.weight(id)), [1,1,1,1,1,1]);

  // Move the first face's apex close to its opposite edge. Each edge retains > 38% of bind length.
  pose.setXYZ(1, .05, .5, 0);
  reference.sample();
  assert.deepEqual([0,1,2,3,4,5].map(id => reference.weight(id)), [0,0,0,0,0,1]);
  // A short edge with unchanged area must independently activate protection at its endpoints.
  pose.setXYZ(1, .25, 0, 0);
  pose.setXYZ(2, 0, 4, 0);
  reference.sample();
  assert.ok(reference.weight(1) > 0 && reference.weight(1) < 1);
  assert.equal(reference.weight(0), reference.weight(3));
  assert.equal(reference.weight(2), 1);

  pose.copy(bind);
  reference.sample();
  assert.deepEqual([0,1,2,3,4,5].map(id => reference.weight(id)), [1,1,1,1,1,1]);
  assert.deepEqual(new Vector3().fromBufferAttribute(bind, 1).toArray(), [1,0,0]);
  geometry.dispose();
  mesh.material.dispose();
});

test('a collapsed reference triangle recovers its rotated bind edges around the animated centroid', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute([0,0,0, 1,0,0, 0,1,0], 3));
  geometry.setAttribute('skinWeight', new Float32BufferAttribute([1,0,0,0, 1,0,0,0, 1,0,0,0], 4));
  geometry.setAttribute('skinIndex', new Float32BufferAttribute(new Float32Array(12), 4));
  geometry.setIndex([0,1,2]);
  const mesh = new SkinnedMesh(geometry, new MeshBasicMaterial());
  const bone = new Bone();
  mesh.add(bone);
  mesh.bind(new Skeleton([bone]));
  const guard = createSleeveReference(mesh, new Set([0,1,2]), true);
  bone.rotation.z = Math.PI / 2;
  mesh.updateMatrixWorld(true);
  const centroid = new Vector3(.3, .2, .1);
  mesh.getVertexPosition = (_, out) => out.copy(centroid);
  guard.sample();
  const corners = [0,1,2].map(id => {
    assert.equal(guard.weight(id), 0);
    return guard.correction(id, new Vector3()).add(centroid);
  });
  assert.ok(corners[1].clone().sub(corners[0]).distanceTo(new Vector3(0, 1, 0)) < 1e-8);
  assert.ok(corners[2].clone().sub(corners[0]).distanceTo(new Vector3(-1, 0, 0)) < 1e-8);
  assert.ok(corners.reduce((sum, pt) => sum.add(pt), new Vector3()).divideScalar(3).distanceTo(centroid) < 1e-8);
  mesh.skeleton.dispose();
  geometry.dispose();
  mesh.material.dispose();
});

test('the ribbon reference pipeline reproduces the display edge and both incident faces at synchronized step 4125', async t => {
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async url => (await load('assets/public/' + url)).gltf);
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true } });
  t.after(() => server.close());
  const { replaySleeve } = await server.ssrLoadModule('/src/scene/cloth/sleeveReplay.ts');
  let measured = false;
  await replaySleeve('xpbd', false, undefined, [], {
    pipeline: 'reference', cuff: 'zoned', animationBlend: 'continuous', stateTransition: true, rapidSwitch: true,
    onStep(frame) {
      if (frame.step !== 4125) return;
      const { mesh, limited, bindings } = frame.bindSurface();
      const attr = mesh.geometry.getAttribute('pwCloth');
      assert.deepEqual(attr.array, limited);
      for (const { id, fade } of bindings) {
        const base = mesh.getVertexPosition(id, new Vector3());
        const shown = base.clone().add(new Vector3().fromBufferAttribute(attr, id));
        const offsetMm = 1000 * shown.applyMatrix4(mesh.matrixWorld).distanceTo(base.applyMatrix4(mesh.matrixWorld));
        assert.ok(offsetMm <= 18 * fade + 1e-5);
      }
      const [a,b,c,d] = [20798,20799,20800,20801].map(id => mesh.getVertexPosition(id, new Vector3())
        .add(new Vector3().fromBufferAttribute(attr, id)).applyMatrix4(mesh.matrixWorld));
      const area = (x,y,z) => x.clone().sub(z).cross(y.clone().sub(z)).length() * 5e5;
      assert.ok(Math.abs(a.distanceTo(c) * 1000 - 3.873) < .001);
      assert.ok(Math.abs(area(a,b,c) - 8.140) < .001);
      assert.ok(Math.abs(area(a,c,d) - 12.218) < .001);
      measured = true;
    },
  });
  assert.ok(measured);
});
