// Headless Three.js skin/clip regression; material rendering is checked in the browser.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export async function load(path) {
  const raw = await fs.readFile(path), size = raw.readUInt32LE(12);
  const doc = JSON.parse(raw.subarray(20, 20 + size));
  doc.materials = [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }]; doc.images = []; doc.textures = [];
  const json = Buffer.from(JSON.stringify(doc)), padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32); json.copy(padded);
  const binary = raw.subarray(20 + size), buffer = Buffer.alloc(20 + padded.length + binary.length);
  buffer.writeUInt32LE(0x46546c67, 0); buffer.writeUInt32LE(2, 4); buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(padded.length, 12); buffer.writeUInt32LE(0x4e4f534a, 16); padded.copy(buffer, 20); binary.copy(buffer, 20 + padded.length);
  const gltf = await new GLTFLoader().parseAsync(buffer.buffer, '');
  let mesh; gltf.scene.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
  const mixer = new THREE.AnimationMixer(gltf.scene), action = mixer.clipAction(gltf.animations[0]);
  action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; action.play();
  const update = () => { gltf.scene.updateMatrixWorld(true); mesh.skeleton.update(); };
  const sample = t => { action.time = t; mixer.update(0); update(); };
  const rest = () => { mixer.stopAllAction(); mesh.skeleton.pose(); update(); };
  return { gltf, mesh, sample, rest, update };
}
