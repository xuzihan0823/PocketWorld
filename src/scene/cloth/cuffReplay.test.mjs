import assert from 'node:assert/strict';
import test from 'node:test';
import { Scene } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createServer } from 'vite';
import { load } from '../orbital/load-for-validation.mjs';

test('left sleeve contact counts reproduce the zoned and feathered tracks at fixed life and switch steps', async t => {
  t.mock.method(GLTFLoader.prototype, 'loadAsync', async url => (await load('assets/public/' + url)).gltf);
  const server = await createServer({ configFile: false, server: { middlewareMode: true, hmr: false }, optimizeDeps: { noDiscovery: true } });
  t.after(() => server.close());
  const module = name => server.ssrLoadModule(`/src/scene/cloth/${name}.ts`);
  const [{ createActor, motions, releaseMeshes }, { garmentRegion }, { Xpbd }, { createSleeveAudit }] =
    await Promise.all(['actor', 'binding', 'physics', 'sleeveSurface'].map(module));
  const stage = new Scene(), actor = await createActor(stage, false, 0);
  t.after(() => { actor.dispose(); releaseMeshes(stage); });
  const audit = createSleeveAudit(actor.skin), dt = 1 / 120;
  const ends = [6, 8, 12, 14, 19.25, 29, 34.25];
  const runs = ['zoned', 'feathered'].map(strategy => {
    const region = garmentRegion(actor.skin, 'Left', false, true, true, 'contact', strategy);
    const solver = new Xpbd(region.profile);
    t.after(() => solver.dispose());
    return { region, solver };
  });
  // Rows give torso, cuff subset, facing and wrist/hand for each strategy in runs order.
  const checkpoints = new Map([
    [780, [[253, 0, 42, 38], [250, 0, 42, 35]]],
    [1080, [[224, 0, 2, 0], [230, 0, 3, 0]]],
    [1500, [[194, 0, 106, 70], [206, 0, 108, 76]]],
    [1800, [[0, 0, 0, 90], [0, 0, 0, 100]]],
    [2574, [[582, 484, 39, 282], [522, 428, 42, 362]]],
    [2702, [[298, 154, 75, 448], [229, 121, 70, 376]]],
    [3540, [[89, 0, 56, 120], [90, 0, 49, 143]]],
    [4111, [[212, 0, 0, 66], [253, 6, 12, 92]]],
    [4147, [[252, 0, 17, 143], [249, 8, 37, 96]]],
    [4230, [[209, 0, 42, 29], [207, 0, 44, 23]]],
  ]);
  let time = 0;
  for (let step = 1; step <= 4230; step++) {
    time += dt;
    const action = step <= 4110 ? ends.findIndex(end => time % 34.25 < end) : Math.floor((step - 4111) / 12) % motions.length;
    actor.select(motions[action]);
    actor.update(dt);
    for (const [i, { region, solver }] of runs.entries()) {
      region.sample(time);
      solver.step(dt, region.targets, region.balls);
      if (!checkpoints.has(step)) continue;
      region.sleeveLayers.final.fill(0);
      region.bind(solver.positions);
      const proxy = { positions: solver.positions, triangles: region.profile.triangles };
      const { torso, facing, skin } = audit.measureStages({ ...region.sleeveLayers, proxy }, { recordLimit: 0 }).stages.final;
      assert.deepEqual([torso.pairs, torso.byRegion.cuff ?? 0, facing.pairs, skin.pairs], checkpoints.get(step)[i], `step ${step}, strategy ${i}`);
    }
  }
});
