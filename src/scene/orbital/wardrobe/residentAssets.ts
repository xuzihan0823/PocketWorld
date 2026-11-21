import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OUTFIT_CATALOG, type ResidentOutfit } from './outfit';

export interface ResidentBundle {
  outfit: ResidentOutfit;
  scene: THREE.Group;
  walk: THREE.AnimationClip;
  sit: THREE.AnimationClip;
  contact: ArrayBuffer;
}

const resolved = new Map<ResidentOutfit, ResidentBundle>();
const pending = new Map<ResidentOutfit, Promise<ResidentBundle>>();

function loadArrayBuffer(url: string): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const loader = new THREE.FileLoader();
    loader.setResponseType('arraybuffer');
    loader.load(
      url,
      data => {
        if (data instanceof ArrayBuffer) resolve(data);
        else reject(new Error(`Expected ArrayBuffer from ${url}`));
      },
      undefined,
      reject,
    );
  });
}

export function getCachedResidentBundle(outfit: ResidentOutfit): ResidentBundle | null {
  return resolved.get(outfit) ?? null;
}

export function clearResidentBundle(outfit: ResidentOutfit): void {
  resolved.delete(outfit);
  pending.delete(outfit);
}

export function loadResidentBundle(outfit: ResidentOutfit): Promise<ResidentBundle> {
  const hit = resolved.get(outfit);
  if (hit) return Promise.resolve(hit);
  const inflight = pending.get(outfit);
  if (inflight) return inflight;

  const spec = OUTFIT_CATALOG[outfit];
  const base = import.meta.env.BASE_URL;
  const modelUrl = `${base}${spec.modelPath}`;
  const contactUrl = `${base}${spec.contactPath}`;

  const request = Promise.all([
    new GLTFLoader().loadAsync(modelUrl),
    loadArrayBuffer(contactUrl),
  ]).then(([gltf, contact]) => {
    const walk = gltf.animations.find(clip => clip.name === 'Walk_Grounded_Loop');
    if (!walk) throw new Error(`Luna (${outfit}) walk animation missing`);
    const sit = gltf.animations.find(clip => clip.name === 'ChairSit_Contact');
    if (!sit) throw new Error(`Luna (${outfit}) contact-corrected sit animation missing`);
    const bundle: ResidentBundle = { outfit, scene: gltf.scene, walk, sit, contact };
    resolved.set(outfit, bundle);
    pending.delete(outfit);
    return bundle;
  }).catch(error => {
    pending.delete(outfit);
    throw error;
  });

  pending.set(outfit, request);
  return request;
}

export function preloadResidentBundle(outfit: ResidentOutfit): void {
  void loadResidentBundle(outfit).catch(() => {
    // Failure will be surfaced and retried if the component actually mounts this outfit.
  });
}
