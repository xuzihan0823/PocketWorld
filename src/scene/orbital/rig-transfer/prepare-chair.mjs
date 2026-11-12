// Extract the user's motion without duplicating the character mesh or textures.
// node .../prepare-chair.mjs <source.glb> <output.glb>
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as T from 'three';
import { load } from './load-for-validation.mjs';

const [source, output] = process.argv.slice(2);
const rig = await load(source), bones = rig.mesh.skeleton.bones;
const target = await load(new URL('../../../../public/models/resident/luna-walk-room.glb', import.meta.url));
for (let i = 0; i < bones.length; i++) {
  const j = target.mesh.skeleton.bones.findIndex(b => b.name === bones[i].name);
  assert(j >= 0, `Missing target bone ${bones[i].name}`);
  assert(rig.mesh.skeleton.boneInverses[i].elements.every((v, k) => Math.abs(v - target.mesh.skeleton.boneInverses[j].elements[k]) < .0001), `Retargeting required: ${bones[i].name}`);
}
const bone = name => bones.find(b => b.name === 'mixamorig' + name);
const pos = b => b.getWorldPosition(new T.Vector3());
const rot = b => b.getWorldQuaternion(new T.Quaternion());
const smooth = t => (t = T.MathUtils.clamp(t, 0, 1), t * t * (3 - 2 * t));
const footIds = side => {
  const ids = [], indices = rig.mesh.geometry.attributes.skinIndex, weights = rig.mesh.geometry.attributes.skinWeight;
  for (let i = 0; i < indices.count; i++) {
    let weight = 0;
    for (let c = 0; c < 4; c++) if (new RegExp(`mixamorig${side}(Foot|Toe)`).test(bones[indices.getComponent(i, c)].name)) weight += weights.getComponent(i, c);
    if (weight > .65) ids.push(i);
  }
  return ids;
};
const legs = ['Left', 'Right'].map(side => ({ side, joints: ['UpLeg', 'Leg', 'Foot'].map(n => bone(side + n)), ids: footIds(side) }));
const setRotation = (joint, q) => { joint.quaternion.copy(rot(joint.parent).invert()).multiply(q); joint.updateWorldMatrix(false, true); };
function solve([thigh, shin, foot], target, sole) {
  const h = pos(thigh), k = pos(shin), a = pos(foot), upper = h.distanceTo(k), lower = k.distanceTo(a);
  const axis = target.clone().sub(h), distance = T.MathUtils.clamp(axis.length(), Math.abs(upper - lower) + .0001, upper + lower - .0001);
  axis.normalize();
  const pole = k.clone().sub(h); pole.addScaledVector(axis, -pole.dot(axis));
  if (pole.lengthSq() < 1e-8) { pole.set(0, 0, 1); pole.addScaledVector(axis, -pole.dot(axis)); }
  pole.normalize();
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const knee = h.clone().addScaledVector(axis, along).addScaledVector(pole, Math.sqrt(Math.max(0, upper * upper - along * along)));
  const aim = (joint, from, to) => setRotation(joint, new T.Quaternion().setFromUnitVectors(from.normalize(), to.normalize()).multiply(rot(joint)));
  aim(thigh, k.sub(h), knee.sub(h));
  const moved = pos(shin);
  aim(shin, pos(foot).sub(moved), target.clone().sub(moved));
  setRotation(foot, sole);
}
// The original cushion is higher than Luna's standing hip. Keep the source's
// anticipation, then lift onto the seat; resting feet hang instead of pulling
// the pelvis through the cushion to force an unreachable floor contact.
rig.sample(.95);
for (const leg of legs) {
  const foot = leg.joints[2]; leg.anchor = pos(foot); leg.sole = rot(foot);
  const min = Math.min(...leg.ids.map(i => rig.mesh.localToWorld(rig.mesh.getVertexPosition(i, new T.Vector3())).y));
  leg.anchor.y -= min;
}
const frames = Array.from({ length: 289 }, (_, i) => i / 48), poses = bones.map(() => ({ position: [], quaternion: [], scale: [] }));
for (const time of frames) {
  rig.sample(time);
  const hips = bone('Hips'), point = pos(hips);
  const lift = smooth((time - .9) / .8), settle = smooth((time - 1.8) / 1.2);
  const transfer = smooth((time - 1.4) / 1.35);
  point.y = T.MathUtils.lerp(point.y, (1.03 - .086 * settle) / 1.43, lift);
  point.z -= .55 / 1.43 * transfer;
  hips.position.copy(hips.parent.worldToLocal(point)); rig.update();
  for (const leg of legs) {
    const foot = leg.joints[2], influence = smooth((time - .65) / .3);
    const flight = smooth((time - 1) / .75);
    const hang = new T.Vector3(leg.anchor.x, .564 / 1.43, (.55 + (leg.side === 'Right' ? .05 : 0) - .68) / 1.43);
    const target = pos(foot).lerp(leg.anchor, influence).lerp(hang, flight), q = rot(foot).slerp(leg.sole, influence);
    solve(leg.joints, target, q); rig.update();
    const min = Math.min(...leg.ids.map(i => rig.mesh.localToWorld(rig.mesh.getVertexPosition(i, new T.Vector3())).y));
    if (time < 1) { target.y -= min; solve(leg.joints, target, q); rig.update(); }
  }
  bones.forEach((b, i) => { for (const key of ['position', 'quaternion', 'scale']) poses[i][key].push(...b[key].toArray()); });
}
const nodes = bones.map(b => {
  const children = b.children.filter(c => c.isBone).map(c => bones.indexOf(c));
  return { name: b.name, ...(children.length ? { children } : {}) };
});
// Keep the glTF coordinate-conversion parent, which is also present on the room rig.
const parent = bones[0].parent;
nodes.push({ name: parent.name, translation: parent.position.toArray(), rotation: parent.quaternion.toArray(), scale: parent.scale.toArray(), children: [0] });
const doc = { asset: { version: '2.0', generator: 'PocketWorld chair motion extraction' }, scene: 0, scenes: [{ nodes: [nodes.length - 1] }], nodes, buffers: [{ byteLength: 0 }], bufferViews: [], accessors: [], animations: [{ name: 'Chair_Sit_Source', samplers: [], channels: [] }] };
const chunks = []; let byteLength = 0;
function accessor(values, width, times = false) {
  const data = Buffer.from(new Float32Array(values).buffer), view = doc.bufferViews.length, index = doc.accessors.length;
  doc.bufferViews.push({ buffer: 0, byteOffset: byteLength, byteLength: data.length }); chunks.push(data); byteLength += data.length;
  doc.accessors.push({ bufferView: view, componentType: 5126, count: values.length / width, type: width === 1 ? 'SCALAR' : `VEC${width}`, ...(times ? { min: [values[0]], max: [values.at(-1)] } : {}) });
  return index;
}
const allTimes = accessor(frames, 1, true), oneTime = accessor([0], 1, true), animation = doc.animations[0];
bones.forEach((b, index) => {
  for (const [key, path, width] of [['position', 'translation', 3], ['quaternion', 'rotation', 4], ['scale', 'scale', 3]]) {
    let values = poses[index][key];
    const constant = values.every((v, i) => Math.abs(v - values[i % width]) < 1e-6);
    if (constant) values = values.slice(0, width);
    nodes[index][path] = values.slice(0, width);
    if (constant) continue;
    animation.channels.push({ sampler: animation.samplers.length, target: { node: index, path } });
    animation.samplers.push({ input: constant ? oneTime : allTimes, output: accessor(values, width), interpolation: 'LINEAR' });
  }
});
// Include constant transforms too: consumers bind this clip onto a different resting pose.
bones.forEach((b, index) => { for (const [key, path, width] of [['position','translation',3],['quaternion','rotation',4],['scale','scale',3]]) {
  if (animation.channels.some(c => c.target.node === index && c.target.path === path)) continue;
  animation.channels.push({ sampler: animation.samplers.length, target: { node: index, path } });
  animation.samplers.push({ input: oneTime, output: accessor(poses[index][key].slice(0,width),width), interpolation:'LINEAR' });
} });
doc.buffers[0].byteLength = byteLength;
let json = Buffer.from(JSON.stringify(doc)); json = Buffer.concat([json, Buffer.alloc((-json.length) & 3, 32)]);
const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
header.writeUInt32LE(0x46546c67); header.writeUInt32LE(2,4); header.writeUInt32LE(28+json.length+byteLength,8); header.writeUInt32LE(json.length,12); header.writeUInt32LE(0x4e4f534a,16);
binHeader.writeUInt32LE(byteLength); binHeader.writeUInt32LE(0x004e4942,4);
await fs.writeFile(output,Buffer.concat([header,json,binHeader,...chunks]));
console.log(JSON.stringify({ output, bytes: 28+json.length+byteLength, frames:frames.length, duration:6, bones:bones.length, floorRelease:1, settledHipHeight:.944, anchors:legs.map(l=>l.anchor.toArray()) }));
