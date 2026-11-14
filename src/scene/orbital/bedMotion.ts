import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ResidentRig } from './ResidentModel';

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

export function createBedPlayer(root: THREE.Object3D, clip: THREE.AnimationClip, neutralPose: ResidentRig['neutralPose']) {
  const neutral = new Map(neutralPose.map(({ joint, pose }) => [joint.name, pose]));
  const channels = clip.tracks.map(track => {
    const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
    const target = root.getObjectByName(nodeName);
    if (!target || !['position', 'quaternion', 'scale'].includes(propertyName))
      throw new Error('Incompatible bed animation: ' + track.name);
    const property = propertyName as 'position' | 'quaternion' | 'scale';
    const curve = track.createInterpolant();
    const entry = target[property].clone().fromArray(curve.evaluate(0));
    const standing = neutral.get(nodeName)![property];
    const correction = property === 'quaternion'
      ? (entry as THREE.Quaternion).invert().multiply(standing as THREE.Quaternion)
      : (standing as THREE.Vector3).clone().sub(entry as THREE.Vector3);
    return { value: target[property], curve, property, correction };
  });
  const rotation = new THREE.Quaternion();
  return (time: number) => {
    const t = THREE.MathUtils.clamp(time, 0, clip.duration);
    // The authored bed entry predates the balanced standing pose. Fade only
    // its local entry offset, in both directions, before hand/seat contact.
    const progress = Math.min(1, t / .6);
    const weight = 1 - progress * progress * (3 - 2 * progress);
    for (const { value, curve, property, correction } of channels) {
      value.fromArray(curve.evaluate(t));
      if (weight === 0) continue;
      if (property === 'quaternion') (value as THREE.Quaternion).multiply(rotation.identity().slerp(correction as THREE.Quaternion, weight));
      else (value as THREE.Vector3).addScaledVector(correction as THREE.Vector3, weight);
    }
  };
}

/** Reversing from the current sample makes cancellation and retrigger continuous. */
export function advanceBedTime(time: number, delta: number, leaving: boolean, reducedMotion: boolean) {
  const dt = THREE.MathUtils.clamp(delta, 0, .04);
  return THREE.MathUtils.clamp(time + dt * (reducedMotion ? BED_DURATION / .4 : leaving ? -1.35 : 1) * (reducedMotion && leaving ? -1 : 1), 0, BED_DURATION);
}

