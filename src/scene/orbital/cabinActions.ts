import { MathUtils, PropertyBinding, Quaternion, Vector3, type AnimationClip, type Object3D } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { ResidentOutfit } from './wardrobe/outfit';

export const RUG_SEAT: [number, number] = [-4.06, .32];
export const RUG_YAW = .32;
export const RUG_TOP = .013;
export const PAPER_PICKUP_REACH = .44;
export const PICKUP_GRIP_TIME = 1.9;
export const PAPER_PICKUP_PREFIX = 'schedule-paper-';
export const CABIN_IDLE_OFFSETS = ['stretchNeck', 'sofaDoze', 'chairGlance', 'floorGlance'] as const;
export const CABIN_ACTIONS = [
  'floorSit', 'floorStand', 'pickUp', 'rubEye', 'think', 'reachHigh', 'shiftWeight', ...CABIN_IDLE_OFFSETS,
] as const;
type CabinActionName = typeof CABIN_ACTIONS[number];
type CabinClips = Record<CabinActionName, AnimationClip>;
export type PaperPickup = { id: string; position: Vector3 };

export const isRugSeat = (id: string) => id === 'rug-seat';
export const isPaperPickup = (id: string) => id.startsWith(PAPER_PICKUP_PREFIX);

const pending = new Map<ResidentOutfit, Promise<CabinClips>>();
export function loadCabinActions(outfit: ResidentOutfit) {
  const cached = pending.get(outfit);
  if (cached) return cached;
  const path = import.meta.env.BASE_URL + 'models/resident/luna-cabin-actions-' + outfit + '.glb';
  const request = new GLTFLoader().loadAsync(path).then(({ animations }) => {
    const clips = {} as CabinClips;
    for (const name of CABIN_ACTIONS) {
      const clip = animations.find(value => value.name === name);
      if (!clip || clip.duration <= 0) throw new Error('Luna cabin action missing: ' + name);
      clips[name] = clip;
    }
    return clips;
  }).catch(error => { pending.delete(outfit); throw error; });
  pending.set(outfit, request);
  return request;
}

export function createCabinActionPlayer(root: Object3D, clips: CabinClips) {
  const channels = new Map(CABIN_ACTIONS.map(name => [name, clips[name].tracks.map(track => {
    const { nodeName, propertyName } = PropertyBinding.parseTrackName(track.name);
    const joint = root.getObjectByName(nodeName);
    if (!joint || (propertyName !== 'position' && propertyName !== 'quaternion'))
      throw new Error('Unexpected Luna cabin action track: ' + track.name);
    return { joint, propertyName, sample: track.createInterpolant() };
  })]));
  const offsets = new Set<string>(CABIN_IDLE_OFFSETS);
  const position = new Vector3(), rotation = new Quaternion(), neutral = new Quaternion();
  return (name: CabinActionName, time: number, blend = 1) => {
    const t = MathUtils.clamp(time, 0, clips[name].duration);
    for (const { joint, propertyName, sample } of channels.get(name)!) {
      const value = sample.evaluate(t);
      if (propertyName === 'position') joint.position.lerp(position.fromArray(value), blend);
      else if (offsets.has(name)) joint.quaternion.multiply(rotation.identity().slerp(neutral.fromArray(value), blend));
      else joint.quaternion.slerp(rotation.fromArray(value), blend);
    }
  };
}

type FloorPerformance = {
  kind: 'floor'; phase: 'sit' | 'seated' | 'rise' | 'undo-sit';
  time: number; leaving: boolean;
};
type PickupPerformance = {
  kind: 'paper'; time: number; leaving: boolean; id: string; point: Vector3;
  complete: () => void;
};
type PlushPerformance = { kind: 'plush'; placing: boolean; time: number; leaving: boolean };
export type CabinPerformance = FloorPerformance | PickupPerformance | PlushPerformance;
export const newRugPerformance = (): FloorPerformance => ({
  kind: 'floor', phase: 'sit', time: 0, leaving: false,
});
export function leaveCabinPerformance(performance: CabinPerformance) {
  performance.leaving = true;
  if (performance.kind !== 'floor') return;
  if (performance.phase === 'sit') performance.phase = 'undo-sit';
  if (performance.phase === 'seated') { performance.phase = 'rise'; performance.time = 0; }
}
export function advanceCabinPerformance(performance: CabinPerformance, dt: number, clips: CabinClips) {
  const { time } = performance;
  if (performance.kind !== 'floor') {
    const reverse = performance.leaving !== (performance.kind === 'plush' && performance.placing);
    performance.time = MathUtils.clamp(time + (reverse ? -dt : dt), 0, clips.pickUp.duration);
    return reverse ? performance.time === 0 : performance.time === clips.pickUp.duration;
  }
  switch (performance.phase) {
    case 'sit':
      performance.time = Math.min(clips.floorSit.duration, time + dt);
      if (performance.time === clips.floorSit.duration) {
        performance.phase = 'seated';
        performance.time = 0;
      }
      break;
    case 'undo-sit':
      performance.time = Math.max(0, time - dt);
      return performance.time === 0;
    case 'rise':
      performance.time = Math.min(clips.floorStand.duration, time + dt);
      return performance.time === clips.floorStand.duration;
  }
  return false;
}

export function applyCabinPerformance(
  performance: CabinPerformance, clips: CabinClips, apply: ReturnType<typeof createCabinActionPlayer>,
) {
  const { time } = performance;
  if (performance.kind !== 'floor') {
    apply('pickUp', time, MathUtils.smoothstep(time, 0, .45) * MathUtils.smoothstep(clips.pickUp.duration - time, 0, .36));
    return;
  }
  if (performance.phase === 'sit' || performance.phase === 'undo-sit') {
    apply('floorSit', time, MathUtils.smoothstep(time, 0, .45));
  } else if (performance.phase === 'rise') {
    const entry = MathUtils.smoothstep(time, 0, .50);
    if (entry < 1) apply('floorSit', clips.floorSit.duration);
    apply('floorStand', time, entry * MathUtils.smoothstep(clips.floorStand.duration - time, 0, .50));
  } else {
    apply('floorSit', clips.floorSit.duration);
  }
}
