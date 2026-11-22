import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { load } from '../src/scene/orbital/load-for-validation.mjs';

const moduleCache = new Map();
function loadTs(url) {
  if (moduleCache.has(url.href)) return moduleCache.get(url.href);
  const source = ts.transpileModule(readFileSync(url, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const scope = { exports: {}, require(name) {
    if (name === 'three') return THREE;
    if (name.endsWith('/GLTFLoader.js')) return { GLTFLoader: class {} };
    if (name.startsWith('.')) return loadTs(new URL(name + '.ts', url));
    throw new Error(`Unexpected import: ${name}`);
  } };
  vm.runInNewContext(source, scope);
  moduleCache.set(url.href, scope.exports);
  return scope.exports;
}
const runtime = new URL('../src/scene/orbital/', import.meta.url);
const { createResidentRig } = loadTs(new URL('residentRig.ts', runtime));
const { createIdlePlayer, createIdleState, STANDING_IDLE } = loadTs(new URL('standingIdle.ts', runtime));
const { gltf: yawn } = await load(new URL('../assets/public/models/resident/luna-yawn.glb', import.meta.url));
const clip = yawn.animations.find(animation => animation.name === 'Luna_Yawn');
assert.ok(clip);
const [input, poseOutput] = process.argv.slice(2);
assert.ok(input && poseOutput, 'Expected the finished GLB and a preview pose path');
const final = await load(resolve(input));
const idle = createIdleState(() => .5);
const smooth = THREE.MathUtils.smoothstep;
const boneMatrix = new THREE.Matrix4();
const previewRig = createResidentRig(final.gltf.scene, final.gltf.animations.find(c => c.name === 'Walk_Grounded_Loop'));
const previewIdle = createIdlePlayer(previewRig.mesh, clip);
const preview = [];
const fps = 15;
function samplePose(phase, weight, time, gestureWeight, restWeight = 1) {
  previewRig.applyPose(0, 0, 1);
  previewIdle({ ...idle, phase, weight, restWeight, yawnTime: time, yawnWeight: gestureWeight });
  previewRig.applyArmCorrectives(true, time, gestureWeight);
  final.gltf.scene.updateMatrixWorld(true);
  const surface = final.mesh;
  return {
    matrices: surface.skeleton.bones.map((bone, j) => boneMatrix
      .multiplyMatrices(bone.matrixWorld, surface.skeleton.boneInverses[j])
      .premultiply(surface.bindMatrixInverse).multiply(surface.bindMatrix).toArray()),
    weights: [...surface.morphTargetInfluences],
  };
}
const idleFrames = Math.round(STANDING_IDLE.breathPeriod * fps);
for (let frame = 0; frame < idleFrames; frame++) {
  const weight = smooth(frame, 0, fps / 2) * (1 - smooth(frame, idleFrames - fps, idleFrames - 1));
  preview.push(samplePose(frame / fps, weight, -1, 0));
}
for (let frame = 0; frame <= Math.ceil(clip.duration * fps); frame++) {
  const time = Math.min(frame / fps, clip.duration);
  const blend = smooth(time, 0, STANDING_IDLE.yawnBlend) * smooth(clip.duration - time, 0, STANDING_IDLE.yawnBlend);
  preview.push(samplePose(0, 1, time, blend));
}
previewRig.dispose();
writeFileSync(poseOutput, JSON.stringify({ preview, idleFrames, fps }));
