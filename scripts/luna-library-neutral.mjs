// Export the exact runtime standing pose for Blender's entry and release frames.
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { load } from '../src/scene/orbital/load-for-validation.mjs';

const cache = new Map();
function loadTS(path) {
  if (cache.has(path.href)) return cache.get(path.href);
  const mod = { exports: {} };
  const source = fs.readFileSync(path, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  vm.runInNewContext(outputText, { exports: mod.exports, require: id => {
    if (id === 'three') return THREE;
    if (id === 'three/examples/jsm/loaders/GLTFLoader.js') return { GLTFLoader };
    if (id.startsWith('.')) return loadTS(new URL(id + '.ts', path));
    throw new Error('Unexpected handoff dependency ' + id);
  } });
  cache.set(path.href, mod.exports);
  return mod.exports;
}
const cardigan = process.argv.includes('--cardigan');
const path = new URL(`../assets/public/models/resident/luna-${cardigan ? 'cardigan' : 'walk-room'}.glb`, import.meta.url);
const { gltf, mesh } = await load(path);
const { createResidentRig, RESIDENT_SCALE } = loadTS(new URL('../src/scene/orbital/residentRig.ts', import.meta.url));
const rig = createResidentRig(gltf.scene, gltf.animations.find(clip => clip.name === 'Walk_Grounded_Loop'), cardigan);
if (cardigan) rig.mesh.userData.outfit = 'cardigan';
rig.applyPose(0, 0);
const armContact = process.argv.includes('--arm-contact');
if (armContact) {
  const { createIdleState, createIdlePlayer } = loadTS(new URL('../src/scene/orbital/standingIdle.ts', import.meta.url));
  const idle = createIdleState();
  idle.restWeight = 1;
  createIdlePlayer(rig.mesh)(idle, false);
  rig.applyArmCorrectives(true);
}
let centered = new THREE.Matrix4();
if (process.argv.includes('--handoff')) {
  const dir = new URL('../src/scene/orbital/library/', import.meta.url);
  const b = loadTS(new URL('bookMotion.ts', dir));
  const r = loadTS(new URL('residentPose.ts', dir));
  const book = loadTS(new URL('catalog.ts', dir)).freshLibrary().books[0];
  const actor = new THREE.Group(); actor.add(rig.mesh); actor.rotation.y = Math.PI;
  if (cardigan) actor.rotation.y += loadTS(new URL('catalog.ts', dir)).shelfYaw('habitat');
  actor.position.fromArray(b.authoredBookStand('habitat', book, true));
  actor.updateMatrixWorld(true);
  for (let i = 0; i < 100; i++) {
    r.applyLibraryPose(rig, actor, 'habitat', { book, phase: 'open', progress: 0 }, .03, true);
    rig.applyPose(0, 0);
  }
  actor.updateMatrixWorld(true);
  // The baked hip owns the retreat until the runtime parent takes it over.
  centered.makeTranslation(0, 0, -b.AUTHORED_BOOK_RETREAT).multiply(actor.matrixWorld.clone().invert());
}
gltf.scene.updateMatrixWorld(true);
const pose = {};
gltf.scene.traverse(joint => {
  if (joint.isBone) pose[joint.name] = joint.matrixWorld.clone().premultiply(centered).toArray();
});
process.stdout.write(JSON.stringify(armContact ? {
  pose, scale: RESIDENT_SCALE, influences: mesh.morphTargetInfluences ?? [.85, .85],
} : pose));
