import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import ts from 'typescript';
import * as T from 'three';
import { load } from '../orbital/load-for-validation.mjs';

async function compile(file, imports = {}) {
  const text = await readFile(new URL(file, import.meta.url), 'utf8');
  let { outputText } = ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  for (const [name, url] of Object.entries(imports)) outputText = outputText.replaceAll(`'${name}'`, JSON.stringify(url));
  return 'data:text/javascript;base64,' + Buffer.from(outputText).toString('base64');
}
const { createClassifiedSleeveAudit, createSleeveAudit } = await import(await compile('./sleeveSurface.ts', {
  three: import.meta.resolve('three'), 'three-mesh-bvh': import.meta.resolve('three-mesh-bvh'),
  './sleeveMask': await compile('./sleeveMask.ts'),
}));
function mesh(name, faces) {
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(faces.flat(2),3));
  geometry.setAttribute('uv', new T.Float32BufferAttribute(faces.flatMap(() => [0,0,1,0,0,1]),2));
  const result = new T.Mesh(geometry, new T.MeshBasicMaterial({ name: name+' material' }));
  result.name = name;
  return result;
}
const sheet = [[-2,-2,0],[2,-2,0],[0,2,0]];
const cross = [[-0.5,0,1],[0.5,0,1],[0,0,-1]];
function near(actual, expected, epsilon = 1e-6) {
  if (Array.isArray(expected)) return expected.forEach((v,i) => near(actual[i],v,epsilon));
  assert.ok(Math.abs(actual-expected) < epsilon, `got ${actual}, expected ${expected}`);
}
function layers(mesh, proxy) {
  const zero = () => new Float32Array(mesh.geometry.attributes.position.count*3);
  return { raw: zero(), blend: zero(), shell: zero(), final: zero(), proxy };
}

test('six posed surfaces use absolute offsets, finite face witnesses, world units and persistent original face IDs', () => {
  const source = mesh('main', [cross, sheet, sheet, sheet]);
  const facing = mesh('lining', [sheet]);
  const root = new T.Group(); root.add(source,facing);
  root.position.set(17,23,11); root.scale.set(2,3,4); root.rotateZ(Math.PI/2); root.updateMatrixWorld(true);
  const audit = createClassifiedSleeveAudit(source,facing,new Uint8Array([1,4,5,2]),[0]);
  const proxyPositions = new Float32Array(cross.flatMap(p => new T.Vector3(...p).applyMatrix4(root.matrixWorld).toArray()));
  const input = layers(source,{ positions: proxyPositions, triangles: [0,1,2], driverVertices: [0,1,2] });
  // Only the deepest vertex moves. A shared-position vertex in different faces need not share an offset.
  input.raw[8] = 0.75; input.blend[8] = 0.5; input.shell[8] = 0.25; input.final[8] = 1;
  const snapshot = audit.measureStages(input), stages = snapshot.stages;
  assert.deepEqual(Object.keys(stages), ['skinned','proxy','raw','blend','shell','final']);
  for (const [name,depth] of Object.entries({ skinned: 4, proxy: 4, raw: 1, blend: 2, shell: 3, final: 0 })) {
    for (const [target,id] of [['torso',1],['skin',2],['facing',0],['innerOuter',3]]) {
      const stats = stages[name][target];
      if (target === 'innerOuter' && name === 'proxy') { assert.equal(stats,null); continue; }
      assert.equal(stats.pairs, depth > 0 ? 1 : 0); near(stats.maxDepth,depth);
      if (!depth) continue;
      const hit = stats.records[0];
      assert.equal(hit.source.face,0); assert.equal(hit.target.face,id);
      assert.equal(hit.source.surface, name === 'proxy' ? 'proxy' : 'outer');
      assert.equal(hit.target.material, target === 'facing' ? 'lining material' : 'main material');
      near(hit.position,[17,23,11]); near(hit.deepestPosition,[17,23,11-depth]);
      near(hit.target.uv,[0.25,0.5]); assert.deepEqual(stats.byRegion,{ [hit.source.region]: 1 });
    }
  }
  const written = audit.measureStages({...input,limited:input.blend});
  near(written.limited.torso.maxDepth,2); near(written.stages.final.torso.maxDepth,0);
  proxyPositions.fill(40);
  assert.equal(audit.measureStages(input,{recordLimit:0}).stages.proxy.torso.pairs,0);
  assert.equal(stages.proxy.torso.pairs,1); // previous step rows are independent
  assert.equal(audit.measureStages(input,{recordLimit:0}).stages.raw.torso.records.length,0);
  const proxyMesh = mesh('proxy', [cross]); root.add(proxyMesh); root.updateMatrixWorld(true);
  assert.equal(audit.measureStages({...input,proxy:proxyMesh}).stages.proxy.torso.pairs,1);
});

test('finite projected footprint clips depth, winding sets depth side, UV-split adjacency and contacts are excluded', () => {
  const extended = [[-1,0,1],[-0.5,0,1],[3,0,-3]];
  const reversed = [sheet[0],sheet[2],sheet[1]];
  const seam = [extended[0],sheet[1],sheet[2]];
  const source = mesh('main',[extended, sheet, reversed, seam]);
  const facing = mesh('facing',[sheet]);
  const audit = createClassifiedSleeveAudit(source,facing,new Uint8Array([1,4,4,2]),[0]);
  const input = layers(source,{ positions: new Float32Array(sheet.flat()), triangles: [0,1,2] });
  // Move the split seam's vertex onto the target plane. The posed geometry would cross if welds were ignored.
  new T.Vector3(...sheet[0]).sub(new T.Vector3(...extended[0])).toArray(input.raw,27);
  const {stages} = audit.measureStages(input, {recordLimit:Infinity});
  assert.equal(stages.raw.innerOuter.pairs,0);
  assert.equal(stages.proxy.torso.pairs,0); // coplanar
  assert.equal(stages.raw.torso.pairs,2);
  const [forward,back] = [1,2].map(id => stages.raw.torso.records.find(r => r.target.face === id));
  near(forward.position,[0.1875,0,0]); near(forward.deepestPosition,[1,0,-1]); near(forward.depth,1);
  near(back.depth,1); near(back.deepestPosition[2],1);
  const few = audit.measureStages(input,{recordLimit:1}).stages.raw.torso;
  assert.equal(few.pairs,2); assert.equal(few.records.length,1); near(few.records[0].depth,few.maxDepth);
});

test('pose sampling includes morphs, independently transformed facing and offset skin vertices', () => {
  const main = mesh('main',[cross,sheet,sheet]);
  const facing = mesh('facing',[sheet]);
  const morph = new Float32Array(main.geometry.attributes.position.count*3);
  morph[8] = 0.5;
  main.geometry.morphTargetsRelative = true;
  main.geometry.morphAttributes.position = [new T.BufferAttribute(morph,3)];
  main.updateMorphTargets(); main.morphTargetInfluences[0] = 1;
  facing.position.z = -0.25; facing.updateMatrixWorld(true);
  const audit = createClassifiedSleeveAudit(main,facing,new Uint8Array([1,4,5]),[0]);
  const input = layers(main,{positions:new Float32Array(cross.flat()),triangles:[0,1,2]});
  for (let i = 6; i < 9; i++) input.shell[3*i+2] = -2;
  const {stages} = audit.measureStages(input);
  near(stages.skinned.torso.maxDepth,0.5); near(stages.skinned.facing.maxDepth,0.25);
  near(stages.proxy.facing.maxDepth,0.75); near(stages.shell.torso.maxDepth,0.5);
  assert.equal(stages.shell.skin.pairs,0); near(stages.final.skin.maxDepth,0.5);
  main.morphTargetInfluences[0] = 0; facing.position.z = -5; facing.updateMatrixWorld(true);
  const next = audit.measureStages(input).stages.skinned;
  near(next.torso.maxDepth,1); assert.equal(next.facing.pairs,0);
});

test('ribbon material primitives, atlas coverage and wrist/hand extent agree with the asset', async t => {
  const path = new URL('../../../assets/public/models/resident/luna-ribbon.glb', import.meta.url);
  // The headless loader strips textures. Read the source GLB to verify the painted atlas behind these UVs.
  const data = await readFile(path), jsonLength = data.readUInt32LE(12);
  const doc = JSON.parse(data.subarray(20,20+jsonLength));
  assert.equal(doc.meshes.length,1);
  assert.equal(doc.nodes.filter(n => n.mesh !== undefined).length,1);
  const primitive = doc.meshes[0].primitives[0];
  const baseColor = doc.materials[primitive.material].pbrMetallicRoughness.baseColorTexture;
  assert.equal(baseColor.texCoord ?? 0,0);
  const atlas = doc.images[doc.textures[baseColor.index].source], view = doc.bufferViews[atlas.bufferView];
  const startImage = 28+jsonLength+(view.byteOffset ?? 0);
  assert.equal(atlas.name,'Luna | Ribbon and everyday face');
  assert.equal(createHash('sha256').update(data.subarray(startImage,startImage+view.byteLength)).digest('hex'),
    '7b7e63f3068ab88c89918d69e0a0c4cce23a4d048b57a17f81a4568517e65c62');
  const {gltf,sample} = await load(path);
  let main;
  gltf.scene.traverse(o => { if (o.isSkinnedMesh && o.geometry.attributes.position.count === 38114) main = o; });
  gltf.scene.updateMatrixWorld(true);
  const audit = createSleeveAudit(main), {inventory,regionCoverage} = audit.mapping;
  assert.deepEqual(inventory.map(row => row.triangles),[42534,1814,15]);
  assert.deepEqual(inventory.flatMap(row => row.materials),['Luna | Ribbon jacket and painted face','Luna | Ivory underarm facing','Luna | Sock edge repair']);
  for (const [category,faces] of Object.entries({outer:1910,inward:556,rim:146,torso:6756,skin:1222,facing:880})) {
    assert.equal(regionCoverage[category].triangles,faces);
    assert.equal(regionCoverage[category].uvFaces,faces);
  }
  assert.ok(regionCoverage.skin.bindMax[1] < 0.57 && regionCoverage.skin.bindMin[0] > 0.19);
  assert.deepEqual(regionCoverage.skin.byRegion,{wristHand:1222});
  sample(0.25);
  main.skeleton.getBoneByName('mixamorigLeftForeArm').rotateX(0.7); gltf.scene.updateMatrixWorld(true);
  const input = layers(main,{ positions:new Float32Array(cross.flat()), triangles:[0,1,2] });
  for (const [i,stage] of ['raw','blend','shell','final'].entries()) {
    for (let j = 0; j < main.geometry.attributes.position.count; j++) {
      if (main.geometry.attributes.position.getX(j)>0.12) input[stage][3*j+2] = (i+1)*0.002;
    }
  }
  const result = audit.measureStages(input);
  for (const name of ['skinned','raw','blend','shell','final']) {
    assert.equal(typeof result.stages[name].innerOuter.pairs,'number');
    for (const stats of Object.values(result.stages[name])) {
      assert.ok(Number.isFinite(stats.maxDepth));
      assert.equal(stats.pairs, Object.values(stats.byRegion).reduce((a,b)=>a+b,0));
    }
  }
  const legacy = audit.measure(input.raw,input.final);
  assert.ok(result.stages.skinned.torso.pairs > 0 && result.stages.final.torso.pairs > result.stages.skinned.torso.pairs);
  assert.equal(result.stages.skinned.torso.pairs,legacy.skinned);
  assert.equal(result.stages.final.torso.pairs,legacy.final);
  t.diagnostic(`Posed torso crossings, skinned/final ${legacy.skinned}/${legacy.final}`);
  const start = performance.now();
  audit.measureStages(input); audit.measureStages(input); audit.measureStages(input);
  t.diagnostic(`Warm six-stage CPU audit, 3 same-pose evaluations with distinct offsets, ${((performance.now()-start)/3).toFixed(1)} ms/sample`);
});
