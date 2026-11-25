import { AnimationClip, MathUtils, Object3D, PropertyBinding } from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FLOOR_SOFA } from './cabinLayout';
import { WALK_SPEED } from './residentRig';
import type { ResidentOutfit } from './wardrobe/outfit';

// Route to the rug outside the blanket's navigation box. Only the last
// straight backward steps enter that conservative box, along the open front.
const approachDepth = 1.50;
const seatCenterX = -.16;
const standingDepth = .665;
export const SOFA_ENTRY: [number, number] = [
  FLOOR_SOFA.position[0] + Math.sin(FLOOR_SOFA.yaw) * approachDepth + Math.cos(FLOOR_SOFA.yaw) * seatCenterX,
  FLOOR_SOFA.position[2] + Math.cos(FLOOR_SOFA.yaw) * approachDepth - Math.sin(FLOOR_SOFA.yaw) * seatCenterX,
];
export const SOFA_STEPS = (approachDepth - standingDepth) / WALK_SPEED;
let pending: Promise<AnimationClip> | undefined;
export function loadSofaClip() {
  return pending ??= new GLTFLoader().loadAsync('./models/resident/luna-sofa-low-sit.glb').then(asset => {
    const clip = asset.animations.find(animation => animation.name === 'Luna_CMU_75_20');
    if (!clip) throw new Error('Missing CMU 75_20');
    return clip;
  }).catch(error => { pending = undefined; throw error; });
}
export function sofaPlayer(root: Object3D, clip: AnimationClip) {
  const channels = clip.tracks.map(track => {
    const { nodeName, propertyName } = PropertyBinding.parseTrackName(track.name);
    const joint = root.getObjectByName(nodeName);
    if (!joint || (propertyName !== 'position' && propertyName !== 'quaternion')) throw new Error(track.name);
    return { property: joint[propertyName], sample: track.createInterpolant() };
  });
  return (time: number) => {
    for (const channel of channels) channel.property.fromArray(channel.sample.evaluate(MathUtils.clamp(time, 0, clip.duration)));
  };
}

// Cushion deflection in mm, fitted to each outfit's seated mesh. Samples
// start at bake frame 34 and span two frames each. The Seated morph is 80 mm.
const compression: Record<ResidentOutfit, number[]> = {
  everyday: [0, 0, 5, 16, 28, 41, 56, 72, 84, 91, 96, 96, 96, 96, 96, 95, 94, 93, 92, 91, 90, 89, 90, 91, 92, 92],
  ribbon: [0, 6, 23, 35, 45, 53, 61, 63, 65, 68, 70, 78, 86, 96, 106, 104, 97, 93, 90, 87, 84, 80, 77, 73, 71, 70],
  cardigan: [0, 0, 3, 18, 29, 43, 56, 61, 61, 54, 54, 58, 65, 73, 76, 76, 75, 73, 72, 68, 63, 60, 57, 54, 53, 52],
};
export function sofaPressure(time: number | null, outfit: ResidentOutfit) {
  if (time === null) return 0;
  const samples = compression[outfit];
  const frame = MathUtils.clamp((time * 30 - 34) / 2, 0, samples.length - 1);
  const left = Math.floor(frame);
  return MathUtils.lerp(samples[left], samples[Math.min(left + 1, samples.length - 1)], frame - left) / 80;
}
