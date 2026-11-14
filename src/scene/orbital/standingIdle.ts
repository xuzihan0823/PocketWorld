import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const STANDING_IDLE = {
  delay: 6, firstYawn: [50, 70], repeatYawn: [65, 95],
  fadeIn: 1.2, fadeOut: .28, yawnBlend: .85,
  breathPeriod: 4.8, breathPitch: .009, swayRoll: .007,
} as const;
const smooth = (value: number) => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const interval = (range: readonly number[], random: () => number) => range[0] + random() * (range[1] - range[0]);

export function createIdleState(random = Math.random) {
  return { elapsed: 0, phase: 0, weight: 0, yawnTime: -1, yawnWeight: 0,
    nextYawn: interval(STANDING_IDLE.firstYawn, random), interrupted: false };
}
export type IdleState = ReturnType<typeof createIdleState>;

export function stepIdle(state: IdleState, delta: number, eligible: boolean, duration: number, random = Math.random) {
  const dt = THREE.MathUtils.clamp(delta, 0, .05);
  if (state.weight > 0 || eligible) state.phase += dt;
  if (!eligible) {
    if (state.elapsed > 0) state.nextYawn = interval(STANDING_IDLE.firstYawn, random);
    state.elapsed = 0;
    state.interrupted = true;
    state.weight = Math.max(0, state.weight - dt / STANDING_IDLE.fadeOut);
    state.yawnWeight = Math.max(0, state.yawnWeight - dt / STANDING_IDLE.fadeOut);
    if (!state.yawnWeight) state.yawnTime = -1;
    return;
  }
  state.elapsed += dt;
  state.weight = Math.min(1, state.weight + (state.elapsed >= STANDING_IDLE.delay ? dt / STANDING_IDLE.fadeIn : -dt / STANDING_IDLE.fadeOut));
  state.weight = Math.max(0, state.weight);
  if (state.interrupted && state.yawnTime >= 0) {
    state.yawnWeight = Math.max(0, state.yawnWeight - dt / STANDING_IDLE.fadeOut);
    if (!state.yawnWeight) state.yawnTime = -1;
    return;
  }
  state.interrupted = false;
  if (duration > 0 && state.yawnTime < 0 && state.elapsed >= state.nextYawn) state.yawnTime = 0;
  if (state.yawnTime < 0) return;
  state.yawnTime += dt;
  state.yawnWeight = smooth(state.yawnTime / STANDING_IDLE.yawnBlend)
    * smooth((duration - state.yawnTime) / STANDING_IDLE.yawnBlend);
  if (state.yawnTime >= duration) {
    state.yawnTime = -1;
    state.yawnWeight = 0;
    state.nextYawn = state.elapsed + interval(STANDING_IDLE.repeatYawn, random);
  }
}

let pending: Promise<THREE.AnimationClip> | undefined;
export function loadYawn() {
  return pending ??= new GLTFLoader().loadAsync('./models/resident/luna-yawn.glb').then(({ animations }) => {
    const clip = animations.find(value => value.name === 'Luna_Yawn');
    if (!clip) throw new Error('Luna yawn animation missing');
    return clip;
  }).catch(error => { pending = undefined; throw error; });
}

/** Called after the resident's base pose. Only upper-body rotations are owned here. */
export function createIdlePlayer(root: THREE.Object3D, clip?: THREE.AnimationClip) {
  const channels = clip?.tracks.map(track => {
    const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
    const joint = root.getObjectByName(nodeName);
    if (!joint || propertyName !== 'quaternion') throw new Error('Incompatible yawn track ' + track.name);
    return { joint, curve: track.createInterpolant() };
  }) ?? [];
  const spine = root.getObjectByName('mixamorigSpine2')!;
  const identity = new THREE.Quaternion(), rotation = new THREE.Quaternion(), euler = new THREE.Euler();
  return (state: IdleState) => {
    const breath = Math.sin(state.phase * Math.PI * 2 / STANDING_IDLE.breathPeriod);
    const sway = Math.sin(state.phase * Math.PI * 2 / 11);
    rotation.setFromEuler(euler.set(breath * STANDING_IDLE.breathPitch, 0, sway * STANDING_IDLE.swayRoll));
    rotation.slerp(identity, 1 - smooth(state.weight));
    spine.quaternion.multiply(rotation);
    if (state.yawnTime < 0 || !state.yawnWeight) return;
    for (const { joint, curve } of channels) {
      rotation.fromArray(curve.evaluate(state.yawnTime));
      joint.quaternion.slerp(rotation, state.yawnWeight);
    }
  };
}
