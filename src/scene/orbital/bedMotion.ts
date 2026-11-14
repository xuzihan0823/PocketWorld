import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const BED_ENTRY: [number, number] = [-1.48, .73];
export const BED_YAW = Math.PI / 2;
export const BED_DURATION = 222 / 24;
export const BED_SLEEP_START = 192 / 24;
const MODEL = './models/resident/luna-bed-v3.glb';
let pending: Promise<THREE.AnimationClip> | undefined;

/** Loaded on first bed interaction; carries no duplicate mesh, skin, or texture. */
export function loadBedClip() {
  return pending ??= new GLTFLoader().loadAsync(MODEL).then(({ animations }) => {
    const clip = animations.find(value => value.name === 'Luna_Bed_V3_DirectSeat');
    if (!clip) throw new Error('Luna bed clip missing');
    return clip;
  }).catch(error => { pending = undefined; throw error; });
}

export function createBedPlayer(root: THREE.Object3D, clip: THREE.AnimationClip) {
  const channels = clip.tracks.map(track => {
    const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
    const target = root.getObjectByName(nodeName);
    if (!target || !['position', 'quaternion', 'scale'].includes(propertyName))
      throw new Error('Incompatible bed animation: ' + track.name);
    return { value: target[propertyName as 'position' | 'quaternion' | 'scale'], curve: track.createInterpolant() };
  });
  return (time: number) => {
    for (const { value, curve } of channels) value.fromArray(curve.evaluate(THREE.MathUtils.clamp(time, 0, clip.duration)));
  };
}

/** Reversing from the current sample makes cancellation and retrigger continuous. */
export function advanceBedTime(time: number, delta: number, leaving: boolean, reducedMotion: boolean) {
  const dt = THREE.MathUtils.clamp(delta, 0, .04);
  return THREE.MathUtils.clamp(time + dt * (reducedMotion ? BED_DURATION / .4 : leaving ? -1.35 : 1) * (reducedMotion && leaving ? -1 : 1), 0, BED_DURATION);
}

