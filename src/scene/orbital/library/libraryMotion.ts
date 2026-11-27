import { loadSceneAsset } from '../assetQueue.ts';
import * as THREE from 'three';
import { CARDIGAN_PICKUP } from './cardiganPickup';
import { RESIDENT_SCALE } from '../residentRig';
import { shelfRotation, AUTHORED_BOOK_RETREAT, smooth } from './bookMotion';
import { shelfPoint, slotFor, type LibraryBook } from './catalog';
import type { LibraryFlow, LibraryPhase } from './useLibrary';

const ASSET = './models/resident/luna-library.glb';
const BOOK = 'LibraryBook';
// Authored frames from scripts/bake-luna-library.py (30 fps).
const REACH_END = 72 / 180;
const EXTRACT_END = 108 / 180;
const COVER_HANDOFF = .20;
const sections: Partial<Record<LibraryPhase, readonly [number, number]>> = {
  reach: [0, REACH_END],
  extract: [REACH_END, EXTRACT_END],
  carry: [EXTRACT_END, 1],
  'return-carry': [1, EXTRACT_END],
  insert: [EXTRACT_END, REACH_END],
  release: [REACH_END, 0],
};

type JointProperty = 'position' | 'quaternion' | 'scale';
type JointTrack = { name: string; property: JointProperty; track: THREE.KeyframeTrack };
type LibraryClip = {
  duration: number;
  tracks: JointTrack[];
  bookPosition: THREE.Interpolant;
  bookRotation: THREE.Interpolant;
};

export type LibraryMotion = readonly [LibraryClip, LibraryClip, LibraryClip];

export function readLibraryMotion(clips: THREE.AnimationClip[]): LibraryMotion {
  function read(row: number): LibraryClip {
    const name = `Library_Pickup_${row}`;
    const clip = clips.find(value => value.name === name);
    if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0)
      throw new Error(`Luna book animation missing ${name}`);

    let bookPosition: THREE.Interpolant | undefined;
    let bookRotation: THREE.Interpolant | undefined;
    const tracks: JointTrack[] = [];
    for (const track of clip.tracks) {
      const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
      if (!nodeName || (propertyName !== 'position' && propertyName !== 'quaternion' && propertyName !== 'scale'))
        throw new Error(`Unexpected Luna book track ${track.name}`);
      if (nodeName === BOOK) {
        if (propertyName === 'position') bookPosition = track.createInterpolant();
        if (propertyName === 'quaternion') bookRotation = track.createInterpolant();
      } else {
        tracks.push({ name: nodeName, property: propertyName, track });
      }
    }
    if (!bookPosition || !bookRotation || !tracks.length)
      throw new Error(`Incomplete Luna book animation ${name}`);
    return { duration: clip.duration, tracks, bookPosition, bookRotation };
  }
  return [read(0), read(1), read(2)];
}

let pending: Promise<LibraryMotion> | undefined;

export function loadLibraryMotion() {
  return pending ??= import('three/examples/jsm/loaders/GLTFLoader.js')
    .then(({ GLTFLoader }) => loadSceneAsset(ASSET, () => new GLTFLoader().loadAsync(ASSET)))
    .then(({ animations }) => readLibraryMotion(animations))
    .catch(error => { pending = undefined; throw error; });
}

type LibrarySample = { progress: number; weight: number; coverProgress?: number };

export function libraryMotionSample(flow: LibraryFlow): LibrarySample | null {
  if (!flow.book) return null;
  const p = THREE.MathUtils.clamp(flow.progress, 0, 1);
  const section = sections[flow.phase];
  if (section) {
    const progress = THREE.MathUtils.lerp(section[0], section[1], p);
    // Blend into the authored entry without changing the planted shelf pose.
    return { progress, weight: smooth(progress / .05) };
  }
  if (flow.phase === 'open') return {
    progress: 1,
    weight: 1 - smooth(p / COVER_HANDOFF),
    coverProgress: THREE.MathUtils.clamp((p - COVER_HANDOFF) / (1 - COVER_HANDOFF), 0, 1),
  };
  if (flow.phase === 'close') return {
    progress: 1,
    weight: smooth((p - 1 + COVER_HANDOFF) / COVER_HANDOFF),
    coverProgress: Math.min(1, p / (1 - COVER_HANDOFF)),
  };
  return null;
}

export function libraryMotionDuration(motion: LibraryMotion, flow: LibraryFlow) {
  const section = sections[flow.phase];
  if (!flow.book || !section) return undefined;
  return motion[slotFor(flow.book).row].duration * Math.abs(section[1] - section[0]);
}

export function libraryCoverFlow(flow: LibraryFlow, sample: LibrarySample | null) {
  return sample?.coverProgress === undefined ? flow : { ...flow, progress: sample.coverProgress };
}

export function createLibraryPlayer(mesh: THREE.Object3D, motion: LibraryMotion) {
  const clips = motion.map((clip, row) => ({ duration: clip.duration, channels: clip.tracks.map(({ name, property, track }) => {
    const joint = mesh.getObjectByName(name);
    if (!(joint instanceof THREE.Bone)) throw new Error(`Incompatible Luna book joint ${name}`);
    // The garment has its own finger joint placement and skinned pad thickness.
    // Replace the affected rotation tracks with those fitted in Blender; sampling
    // them here keeps the original clip clock, reverse seeks and handoff weight.
    const keys = mesh.userData.outfit === 'cardigan' && property === 'quaternion'
      ? (CARDIGAN_PICKUP[row] as Record<string, number[][]>)[name] : undefined;
    const curve = keys ? new THREE.QuaternionKeyframeTrack(track.name, keys.map(key => key[0] / 30),
      keys.flatMap(key => new THREE.Quaternion().fromArray(key, 1).normalize().toArray())).createInterpolant()
      : track.createInterpolant();
    return { target: joint[property], property, curve,
      hipsPosition: name === 'mixamorigHips' && property === 'position' };
  }) }));
  const position = new THREE.Vector3(), quaternion = new THREE.Quaternion();

  return (book: LibraryBook, sample: LibrarySample) => {
    if (sample.weight <= 0) return;
    const clip = clips[slotFor(book).row];
    const time = sample.progress * clip.duration;
    for (const { target, property, curve, hipsPosition } of clip.channels) {
      const value = curve.evaluate(time);
      if (property === 'quaternion') (target as THREE.Quaternion).slerp(quaternion.fromArray(value), sample.weight);
      else {
        position.fromArray(value);
        // The held stance shifts the parent +Z. At yaw π the hip's local +Z cancels that shift during blending.
        if (hipsPosition && sample.coverProgress !== undefined) position.z += AUTHORED_BOOK_RETREAT / RESIDENT_SCALE;
        (target as THREE.Vector3).lerp(position, sample.weight);
      }
    }
  };
}

export function applyLibraryBookMotion(
  motion: LibraryMotion,
  scene: string,
  book: LibraryBook,
  sample: LibrarySample,
  position: THREE.Vector3,
  quaternion: THREE.Quaternion,
) {
  if (sample.weight <= 0) return;
  const slot = slotFor(book), clip = motion[slot.row];
  const time = sample.progress * clip.duration;
  const point = new THREE.Vector3().fromArray(clip.bookPosition.evaluate(time));
  point.fromArray(shelfPoint(scene, point.x + slot.position[0], point.y, point.z));
  position.lerp(point, sample.weight);
  quaternion.slerp(new THREE.Quaternion().fromArray(clip.bookRotation.evaluate(time)).premultiply(shelfRotation(scene)), sample.weight);
}
