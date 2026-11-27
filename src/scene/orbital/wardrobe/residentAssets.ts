import { loadSceneAsset } from '../assetQueue.ts';
import { FileLoader, type AnimationClip } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { readSeatContactCache, type SeatContactCache } from '../chairAnimation';
import { readLibraryMotion, type LibraryMotion } from '../library/libraryMotion';
import type { ResidentOutfit } from './outfit';

export interface ResidentAssets {
  outfit: ResidentOutfit;
  scene: GLTF['scene'];
  walk: AnimationClip;
  handMotion?: GLTF;
  sit: AnimationClip;
  relaxed: { standing: AnimationClip; lap: AnimationClip; cheek: AnimationClip };
  fitted?: {
    sofa: AnimationClip;
    library: LibraryMotion;
    idle?: { yawn: AnimationClip };
  };
}

const files = {
  everyday: ['luna-walk-room.glb', 'luna-seat-contact.bin'],
  ribbon: ['luna-ribbon.glb', 'luna-ribbon-seat.bin'],
  cardigan: ['luna-cardigan.glb', 'luna-cardigan-seat.bin'],
} as const;
const base = import.meta.env.BASE_URL + 'models/resident/';
const pending = new Map<ResidentOutfit, Promise<ResidentAssets>>();
const pendingContacts = new Map<ResidentOutfit, Promise<SeatContactCache>>();

export function loadResidentSeatContact(outfit: ResidentOutfit): Promise<SeatContactCache> {
  const cached = pendingContacts.get(outfit);
  if (cached) return cached;
  const request = loadSceneAsset(base + files[outfit][1], () => new FileLoader().setResponseType('arraybuffer').loadAsync(base + files[outfit][1]))
    .then(buffer => readSeatContactCache(buffer as ArrayBuffer))
    .catch(error => { pendingContacts.delete(outfit); throw error; });
  pendingContacts.set(outfit, request);
  return request;
}

export function loadResidentAssets(outfit: ResidentOutfit): Promise<ResidentAssets> {
  const cached = pending.get(outfit);
  if (cached) return cached;
  const request = loadSceneAsset(base + files[outfit][0], () => new GLTFLoader().loadAsync(base + files[outfit][0])).then(async gltf => {
    const handsPath = base + 'luna-cardigan-hands.glb';
    const handMotion = outfit === 'cardigan'
      ? await loadSceneAsset(handsPath, () => new GLTFLoader().loadAsync(handsPath)) : undefined;
    const clip = (name: string) => {
      const match = gltf.animations.find(animation => animation.name === name);
      if (!match) throw new Error('人物动作缺失：' + name);
      return match;
    };
    return {
      outfit, handMotion, scene: gltf.scene, walk: clip('Walk_Grounded_Loop'), sit: clip('ChairSit_Contact'),
      relaxed: { standing: clip('Luna_Relaxed_Standing'), lap: clip('Luna_Sofa_Lap'), cheek: clip('Luna_Sofa_Cheek') },
      fitted: outfit !== 'everyday' ? {
        sofa: clip('Luna_CMU_75_20'), library: readLibraryMotion(gltf.animations),
        idle: outfit === 'cardigan' ? { yawn: clip('Luna_Yawn') } : undefined,
      } : undefined,
    };
  }).catch(error => { pending.delete(outfit); throw error; });
  pending.set(outfit, request);
  return request;
}
