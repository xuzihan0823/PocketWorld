import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Test the exported skin and interpolated clips, including half-frames between
// Blender's 30 fps keys. No browser-only pose correction participates here.
export async function load(file) {
  const bytes = await fs.readFile(file), size = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20, 20 + size));
  doc.materials = [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }];
  doc.images = []; doc.textures = [];
  const raw = Buffer.from(JSON.stringify(doc));
  const json = Buffer.alloc(Math.ceil(raw.length / 4) * 4, 32); raw.copy(json);
  const bin = bytes.subarray(20 + size), buffer = Buffer.alloc(20 + json.length + bin.length);
  buffer.writeUInt32LE(0x46546c67, 0); buffer.writeUInt32LE(2, 4); buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(json.length, 12); buffer.writeUInt32LE(0x4e4f534a, 16);
  json.copy(buffer, 20); bin.copy(buffer, 20 + json.length);
  const gltf = await new GLTFLoader().parseAsync(buffer.buffer, '');
  let mesh; gltf.scene.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const defaults = [];
  gltf.scene.traverse(o => defaults.push([o, o.position.clone(), o.quaternion.clone(), o.scale.clone()]));
  function rest() {
    mixer.stopAllAction();
    // Skeleton.pose() assumes an untransformed non-bone parent. This asset
    // has an axis-conversion node; restore stored local TRS for a true rest.
    for (const [o, p, q, s] of defaults) { o.position.copy(p); o.quaternion.copy(q); o.scale.copy(s); }
    mesh.morphTargetInfluences?.fill(0);
    gltf.scene.updateMatrixWorld(true); mesh.skeleton.update();
  }
  const bone = name => mesh.skeleton.bones.find(b => b.name.replace(/[^\w]/g, '') === 'mixamorig' + name);
  function select(name) {
    rest();
    const action = mixer.clipAction(gltf.animations.find(a => a.name === name));
    action.reset().setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
    return time => { action.time = time; mixer.update(0); gltf.scene.updateMatrixWorld(true); mesh.skeleton.update(); };
  }
  return { gltf, mesh, bone, select, rest, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}
