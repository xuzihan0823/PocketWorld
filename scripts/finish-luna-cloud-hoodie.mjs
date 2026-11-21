import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { load } from '../src/scene/orbital/load-for-validation.mjs';

const [input, output, seatInput, seatOutput] = process.argv.slice(2);
assert.ok(input && output && seatInput && seatOutput,
  'usage: node scripts/finish-luna-cloud-hoodie.mjs <base.glb> <out.glb> <base-seat.bin> <out-seat.bin>');
const raw = readFileSync(input);
assert.equal(raw.readUInt32LE(0), 0x46546c67);
const end = 20 + raw.readUInt32LE(12);
const doc = JSON.parse(raw.subarray(20, end));
let bin = Buffer.from(raw.subarray(end + 8));
const mesh = doc.meshes[0], [primitive] = mesh.primitives;
assert.equal(mesh.primitives.length, 1);
assert.deepEqual(mesh.extras.targetNames, ['LeftArmContact', 'RightArmContact']);
assert.ok(!mesh.extras.hoodieClearance, 'Already finished');
const names = doc.skins[0].joints.map(i => doc.nodes[i].name.replace(':', ''));
const sameSide = /Left(?:Arm|ForeArm|Shoulder)$|Right(?:Arm|ForeArm|Shoulder)$/;
const spine = /Spine\d?$|Hips$/;
const smooth = THREE.MathUtils.smoothstep;

function accessor(index) {
  const a = doc.accessors[index], view = doc.bufferViews[a.bufferView];
  const Type = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array }[a.componentType];
  const size = { SCALAR: 1, VEC3: 3, VEC4: 4 }[a.type];
  assert.ok(Type && size && !a.sparse && !view.byteStride);
  return new Type(bin.buffer, bin.byteOffset + view.byteOffset + (a.byteOffset ?? 0), a.count * size);
}

function save(path) {
  doc.buffers[0].byteLength = bin.length;
  const json = Buffer.from(JSON.stringify(doc));
  const pad = Buffer.alloc((4 - json.length % 4) % 4, 32);
  const head = Buffer.alloc(20), binHead = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(head.length + json.length + pad.length + binHead.length + bin.length, 8);
  head.writeUInt32LE(json.length + pad.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  binHead.writeUInt32LE(bin.length, 0);
  binHead.writeUInt32LE(0x004e4942, 4);
  writeFileSync(path, Buffer.concat([head, json, pad, binHead, bin]));
}

const position = accessor(primitive.attributes.POSITION);
const normals = accessor(primitive.attributes.NORMAL);
const indices = accessor(primitive.indices);
const contactIds = accessor(primitive.attributes._CONTACT_ID);
const joints = accessor(primitive.attributes.JOINTS_0);
const weights = accessor(primitive.attributes.WEIGHTS_0);
const vertices = position.length / 3;
assert.ok(vertices <= 65535, 'Sparse target index width');
const original = position.slice();
const byPosition = new Map(), nodes = [], nodeAt = new Array(vertices);
for (let i = 0; i < vertices; i++) {
  const [x, y, z] = position.subarray(3 * i, 3 * i + 3);
  const key = `${x},${y},${z}`;
  let node = byPosition.get(key);
  if (!node) {
    const base = new Float64Array(names.length);
    for (let k = 0; k < 4; k++) base[joints[4 * i + k]] += weights[4 * i + k];
    const a = Math.abs(x);
    const armOrSpine = !base.some((w, b) => w > .05 && !sameSide.test(names[b]) && !spine.test(names[b]));
    const range = smooth(a, .04, .071) * (1 - smooth(a, .147, .212));
    node = { i, index: nodes.length, x, y, z, current: base.slice(), next: base.slice(), neighbors: new Map(),
      blend: armOrSpine ? range * smooth(y, .585, .621) * (1 - smooth(y, .746, .792)) : 0,
      move: armOrSpine ? range * smooth(y, .563, .610) * (1 - smooth(y, .737, .780)) : 0 };
    byPosition.set(key, node);
    nodes.push(node);
  }
  nodeAt[i] = node;
}
for (let i = 0; i < indices.length; i += 3) for (let k = 0; k < 3; k++) {
  const a = nodeAt[indices[i + k]], b = nodeAt[indices[i + (k + 1) % 3]];
  if (a === b || a.neighbors.has(b) || (!a.blend && !b.blend && !a.move && !b.move)) continue;
  const distance = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  const weight = 1 / Math.max(.0015, distance);
  a.neighbors.set(b, weight);
  b.neighbors.set(a, weight);
}
const blendNodes = nodes.filter(a => a.blend > .001 && a.neighbors.size);
for (const a of blendNodes) a.mass = [...a.neighbors.values()].reduce((sum, w) => sum + w, 0);
for (let pass = 0; pass < 36; pass++) {
  for (const a of blendNodes) {
    const factor = .68 * a.blend;
    for (let j = 0; j < names.length; j++) a.next[j] = a.current[j] * (1 - factor);
    for (const [b, mass] of a.neighbors) {
      const blend = factor * mass / a.mass;
      for (let j = 0; j < names.length; j++) a.next[j] += b.current[j] * blend;
    }
  }
  for (const a of blendNodes) [a.current, a.next] = [a.next, a.current];
}
for (const a of blendNodes) {
  const top = Array.from(a.current.keys()).sort((x, y) => a.current[y] - a.current[x]).slice(0, 4);
  const total = top.reduce((sum, j) => sum + a.current[j], 0);
  a.skin = top.map(j => [j, a.current[j] / total]);
}
for (let i = 0; i < vertices; i++) {
  const { x, y, z, skin } = nodeAt[i], a = Math.abs(x);
  if (skin && contactIds[i] < 0) for (let k = 0; k < 4; k++) [joints[4 * i + k], weights[4 * i + k]] = skin[k];
  let arm = 0, chest = 0;
  const side = x > 0 ? 'Left' : 'Right';
  for (let k = 0; k < 4; k++) {
    const name = names[joints[4 * i + k]], weight = weights[4 * i + k];
    if (name.startsWith('mixamorig' + side) && sameSide.test(name)) arm += weight;
    if (spine.test(name)) chest += weight;
  }
  const sleeve = smooth(arm, .25, .9) * smooth(y, .462, .512) * (1 - smooth(y, .64, .682))
    * smooth(a, .085, .105) * (1 - smooth(a, .13, .21));
  const flank = smooth(chest, .65, .98) * smooth(y, .453, .516) * (1 - smooth(y, .635, .668))
    * smooth(a, .053, .083) * (1 - smooth(z, .07, .123));
  position[3 * i] += Math.sign(x) * (.044 * sleeve - .044 * flank);
}

// Transport the original smooth normals across the fitted surface, preserving UV splits.
const before = new THREE.Vector3(), after = new THREE.Vector3();
const p = new THREE.Vector3(), q = new THREE.Vector3(), r = new THREE.Vector3();
function areaNormal(coords, i, target) {
  p.fromArray(coords, 3 * indices[i]);
  q.fromArray(coords, 3 * indices[i + 1]).sub(p);
  r.fromArray(coords, 3 * indices[i + 2]).sub(p);
  return target.crossVectors(q, r);
}
for (const node of nodes) { node.before = new THREE.Vector3(); node.after = new THREE.Vector3(); }
for (let i = 0; i < indices.length; i += 3) {
  areaNormal(original, i, before);
  areaNormal(position, i, after);
  for (let j = 0; j < 3; j++) {
    nodeAt[indices[i + j]].before.add(before);
    nodeAt[indices[i + j]].after.add(after);
  }
}
for (const node of nodes) {
  node.before.normalize();
  node.after.normalize();
  node.reorient = new THREE.Quaternion().setFromUnitVectors(node.before, node.after);
}
const bounds = new THREE.Box3().setFromArray(position);
Object.assign(doc.accessors[primitive.attributes.POSITION], { min: bounds.min.toArray(), max: bounds.max.toArray() });
for (let i = 0; i < vertices; i++) p.fromArray(normals, 3 * i).applyQuaternion(nodeAt[i].reorient).normalize().toArray(normals, 3 * i);
mesh.extras.hoodieClearance = true;

// Keep the original chair contact in pre-skin space despite the fitted base mesh.
const originalSeat = readFileSync(seatInput);
assert.equal(originalSeat.readUInt32LE(0), 0x43535750);
assert.equal(originalSeat.readUInt32LE(4), 1);
const frames = originalSeat.readUInt32LE(8), contacts = originalSeat.readUInt32LE(12);
const quantum = originalSeat.readFloatLE(16);
assert.ok(quantum > 0 && Number.isFinite(quantum));
assert.equal(originalSeat.length, 20 + 6 * contacts * frames);
const fitByContact = new Map();
for (let i = 0; i < vertices; i++) {
  const id = contactIds[i];
  if (id < 0) continue;
  assert.ok(Number.isInteger(id) && id < contacts);
  const fit = Math.round((position[i * 3] - original[i * 3]) / quantum);
  assert.equal(fit, fitByContact.get(id) ?? fit, 'Duplicated seat vertex must keep the same offset');
  fitByContact.set(id, fit);
}
const corrections = new Int32Array(frames * contacts * 3);
let peak = 0;
for (let i = 0; i < corrections.length; i++) {
  const fit = i % 3 === 0 ? (fitByContact.get(Math.floor(i / 3) % contacts) ?? 0) : 0;
  corrections[i] = originalSeat.readInt16LE(20 + i * 2) - fit;
  peak = Math.max(peak, Math.abs(corrections[i]));
}
const stride = Math.max(1, Math.ceil(peak / 32767));
originalSeat.writeFloatLE(quantum * stride, 16);
for (let i = 0; i < corrections.length; i++) originalSeat.writeInt16LE(Math.round(corrections[i] / stride), 20 + i * 2);

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
mesh.extras.hoodieStretchDuration = clip.duration;

const scratch = mkdtempSync(join(process.env.PI_SCRATCH_DIR ?? tmpdir(), 'luna-hoodie-'));
try {
  const path = join(scratch, 'fitted.glb');
  save(path);
  const { gltf, mesh: surface } = await load(path);
  const rig = createResidentRig(gltf.scene, gltf.animations.find(c => c.name === 'Walk_Grounded_Loop'));
  const idle = createIdleState(() => .5);
  const player = createIdlePlayer(rig.mesh, clip);
  const movable = nodes.filter(a => a.move > .001);
  const edges = movable.flatMap(a => [...a.neighbors.keys()]
    .filter(b => b.move <= .001 || a.index < b.index).map(b => {
      const originalLen = p.fromArray(position, 3 * a.i).distanceTo(q.fromArray(position, 3 * b.i));
      return { a, b, max: originalLen * 1.45 + .0007 };
    })).filter(edge => edge.max > .001);
  const matrix = new THREE.Matrix3(), inverseSkin = new THREE.Matrix3();
  const delta = new THREE.Vector3(), offset = new THREE.Vector3();
  const boneMatrix = new THREE.Matrix4();
  function bake(time) {
    const weight = smooth(time, 0, STANDING_IDLE.yawnBlend) * smooth(clip.duration - time, 0, STANDING_IDLE.yawnBlend);
    rig.applyPose(0, 0, 1);
    player({ ...idle, weight: 1, restWeight: 1, yawnTime: time, yawnWeight: weight });
    rig.applyArmCorrectives(true);
    gltf.scene.updateMatrixWorld(true);
    for (const a of nodes) {
      a.start ??= new THREE.Vector3();
      a.posed ??= new THREE.Vector3();
      a.bindDelta ??= new THREE.Vector3();
      surface.getVertexPosition(a.i, a.start);
      a.posed.copy(a.start);
      a.bindDelta.set(0, 0, 0);
    }
    for (let pass = 0; pass < 64; pass++) {
      for (const { a, b, max } of edges) {
        const length = delta.copy(b.posed).sub(a.posed).length();
        if (length <= max) continue;
        const movableB = b.move > .001 ? b.move : 0;
        const influence = a.move + movableB;
        delta.multiplyScalar(.74 * (length - max) / (length * influence));
        a.posed.addScaledVector(delta, a.move);
        b.posed.addScaledVector(delta, -movableB);
      }
      for (const a of movable) {
        offset.copy(a.posed).sub(a.start).clampLength(0, .034).multiplyScalar(.975);
        a.posed.copy(a.start).add(offset);
      }
    }
    for (const a of movable) {
      const vi = a.i;
      matrix.elements.fill(0);
      for (let k = 0; k < 4; k++) {
        const w = weights[4 * vi + k];
        if (!w) continue;
        const j = joints[4 * vi + k];
        boneMatrix.multiplyMatrices(surface.skeleton.bones[j].matrixWorld, surface.skeleton.boneInverses[j]);
        boneMatrix.premultiply(surface.bindMatrixInverse).multiply(surface.bindMatrix);
        inverseSkin.setFromMatrix4(boneMatrix);
        for (let i = 0; i < 9; i++) matrix.elements[i] += w * inverseSkin.elements[i];
      }
      if (Math.abs(matrix.determinant()) < .08 || weight < .01) continue;
      a.bindDelta.copy(a.posed).sub(a.start).applyMatrix3(matrix.invert()).divideScalar(weight).clampLength(0, .045);
    }
    appendTarget(`HoodieStretch_${Math.round(100 * time)}`);
  }
  for (const time of [.90, 1.90, 2.65, 3.45, 4.30, 5.20, 6.15, 6.85, 7.45]) bake(time);
  rig.dispose();
  save(resolve(output));
  writeFileSync(seatOutput, originalSeat);
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

function appendTarget(name) {
  const ids = [], values = [], min = [0, 0, 0], max = [0, 0, 0];
  for (let i = 0; i < vertices; i++) {
    const d = nodeAt[i].bindDelta;
    if (d.lengthSq() < .00015 ** 2) continue;
    ids.push(i);
    for (const [j, v] of d.toArray().entries()) {
      values.push(v);
      min[j] = Math.min(min[j], v);
      max[j] = Math.max(max[j], v);
    }
  }
  assert.ok(ids.length, `${name} must have a nonempty correction`);
  function view(raw) {
    const index = doc.bufferViews.length;
    doc.bufferViews.push({ buffer: 0, byteOffset: bin.length, byteLength: raw.byteLength });
    bin = Buffer.concat([bin, raw, Buffer.alloc((4 - raw.byteLength % 4) % 4)]);
    return index;
  }
  const idView = view(Buffer.from(Uint16Array.from(ids).buffer));
  const deltaView = view(Buffer.from(Float32Array.from(values).buffer));
  primitive.targets.push({ POSITION: doc.accessors.length });
  doc.accessors.push({ componentType: 5126, count: vertices, type: 'VEC3', min, max,
    sparse: { count: ids.length, indices: { componentType: 5123, bufferView: idView }, values: { bufferView: deltaView } } });
  mesh.extras.targetNames.push(name);
  mesh.weights ??= [0, 0];
  mesh.weights.push(0);
}
