import { loadSceneAsset } from './assetQueue.ts';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { createCabinActionPlayer } from './cabinActions';

export const STANDING_IDLE = {
  delay: 6, firstYawn: [50, 70], repeatYawn: [65, 95],
  gestureGap: 8,
  firstShort: [12, 18], repeatShort: [22, 32], shortDuration: { listen: 3.2, clasp: 4.6 },
  fadeIn: 1.2, fadeOut: .28, yawnBlend: .85, restFade: .38,
  breathPeriod: 4.8, breathPitch: .025, swayPeriod: 9, swayRoll: .052,
  headTurn: .055, shoulderRoll: .025, armSwing: .055, elbowRelax: .07,
} as const;
const smooth = (value: number) => { const t = THREE.MathUtils.clamp(value, 0, 1); return t * t * (3 - 2 * t); };
const interval = (range: readonly number[], random: () => number) => range[0] + random() * (range[1] - range[0]);

type BuiltInGesture = keyof typeof STANDING_IDLE.shortDuration;
type ExtraGesture = 'rubEye' | 'shiftWeight' | 'stretchNeck';
type ShortGesture = BuiltInGesture | ExtraGesture;
type ExtraGestures = Partial<Record<ExtraGesture, { duration: number }>>;
const shortOrder: readonly ShortGesture[] = ['listen', 'clasp', 'rubEye', 'shiftWeight', 'stretchNeck'];
const isBuiltIn = (kind: ShortGesture): kind is BuiltInGesture => kind === 'listen' || kind === 'clasp';
const shortDuration = (kind: ShortGesture, extra: ExtraGestures) =>
  isBuiltIn(kind) ? STANDING_IDLE.shortDuration[kind] : extra[kind]?.duration ?? 0;

export function createIdleState(random = Math.random) {
  return { elapsed: 0, phase: 0, weight: 0, restWeight: 0, yawnTime: -1, yawnWeight: 0,
    nextYawn: interval(STANDING_IDLE.firstYawn, random), interrupted: false,
    nextGesture: 0,
    shortTime: -1, shortWeight: 0, shortKind: 'listen' as ShortGesture,
    nextShort: interval(STANDING_IDLE.firstShort, random) };
}
export type IdleState = ReturnType<typeof createIdleState>;

function fadeGesture(state: IdleState, dt: number) {
  for (const [time, weight] of [['yawnTime', 'yawnWeight'], ['shortTime', 'shortWeight']] as const) {
    state[weight] = Math.max(0, state[weight] - dt / STANDING_IDLE.fadeOut);
    if (state[weight] === 0) state[time] = -1;
  }
}

export function stepIdle(state: IdleState, delta: number, eligible: boolean, duration: number, random = Math.random,
  restEligible = eligible, extra: ExtraGestures = {}) {
  const dt = THREE.MathUtils.clamp(delta, 0, .05);
  state.restWeight = THREE.MathUtils.clamp(state.restWeight + (restEligible ? dt / STANDING_IDLE.restFade : -dt / STANDING_IDLE.fadeOut), 0, 1);
  if (state.weight > 0 || eligible) state.phase += dt;
  if (!eligible) {
    if (state.elapsed > 0) {
      state.nextYawn = interval(STANDING_IDLE.firstYawn, random);
      state.nextShort = interval(STANDING_IDLE.firstShort, random);
      state.nextGesture = 0;
    }
    state.elapsed = 0;
    state.interrupted = true;
    state.weight = Math.max(0, state.weight - dt / STANDING_IDLE.fadeOut);
    fadeGesture(state, dt);
    return;
  }
  state.elapsed += dt;
  state.weight = THREE.MathUtils.clamp(state.weight + (state.elapsed >= STANDING_IDLE.delay
    ? dt / STANDING_IDLE.fadeIn : -dt / STANDING_IDLE.fadeOut), 0, 1);
  const active = state.yawnTime >= 0 || state.shortTime >= 0;
  if (state.interrupted && active) {
    fadeGesture(state, dt);
    return;
  }
  state.interrupted = false;
  // Finish each gesture before starting another. Authored clips take priority when both are due.
  if (!active && state.elapsed >= state.nextGesture) {
    if (duration > 0 && state.elapsed >= state.nextYawn) state.yawnTime = 0;
    else if (state.elapsed >= state.nextShort) state.shortTime = 0;
  }
  if (state.shortTime >= 0) {
    const length = shortDuration(state.shortKind, extra);
    state.shortTime += dt;
    state.shortWeight = smooth(state.shortTime / .9) * smooth((length - state.shortTime) / 1.1);
    if (state.shortTime >= length) {
      state.shortTime = -1;
      state.shortWeight = 0;
      state.nextShort = state.elapsed + interval(STANDING_IDLE.repeatShort, random);
      state.nextGesture = state.elapsed + STANDING_IDLE.gestureGap;
      const available = shortOrder.filter(gesture => shortDuration(gesture, extra) > 0);
      state.shortKind = available[(available.indexOf(state.shortKind) + 1) % available.length];
    }
  }
  if (state.yawnTime < 0) return;
  state.yawnTime += dt;
  state.yawnWeight = smooth(state.yawnTime / STANDING_IDLE.yawnBlend)
    * smooth((duration - state.yawnTime) / STANDING_IDLE.yawnBlend);
  if (state.yawnTime >= duration) {
    state.yawnTime = -1;
    state.yawnWeight = 0;
    state.nextYawn = state.elapsed + interval(STANDING_IDLE.repeatYawn, random);
    state.nextGesture = state.elapsed + STANDING_IDLE.gestureGap;
  }
}

let pending: Promise<THREE.AnimationClip> | undefined;
export function loadYawn() {
  return pending ??= loadSceneAsset('./models/resident/luna-yawn.glb', () => new GLTFLoader().loadAsync('./models/resident/luna-yawn.glb')).then(({ animations }) => {
    const clip = animations.find(value => value.name === 'Luna_Yawn');
    if (!clip) throw new Error('Luna yawn animation missing');
    return clip;
  }).catch(error => { pending = undefined; throw error; });
}

// Local quaternion offsets sampled from the approved waist-level hand pose on Luna.
const CLASP = {
  LeftShoulder: [.0102243, .005779, -.0098703, .9998823],
  LeftArm: [-.0172959, -.4496834, -.2602116, .8542691],
  LeftForeArm: [-.2196271, .5187472, -.1729433, .8079331],
  LeftHand: [-.4723218, -.0838101, -.3732735, .7940749],
  RightShoulder: [-.01069, -.0078225, -.0112512, .999849],
  RightArm: [.0232018, .576048, -.2797195, .7677157],
  RightForeArm: [.4761283, -.3384597, -.1530518, .7970709],
  RightHand: [.4296488, -.5798923, -.4102365, .5575239],
} as const;

/** Called after the resident's base pose. Only upper-body rotations are owned here. */
export function createIdlePlayer(root: THREE.Object3D, clip?: THREE.AnimationClip,
  applyCabinAction?: ReturnType<typeof createCabinActionPlayer>, standingClip?: THREE.AnimationClip) {
  const bone = (name: string) => root.getObjectByName('mixamorig' + name)!;
  const bind = (motion?: THREE.AnimationClip) => motion?.tracks.map(track => {
    const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
    const joint = root.getObjectByName(nodeName);
    if (!joint || propertyName !== 'quaternion' || !/Spine|Neck|Head|Shoulder|Arm|Hand/.test(nodeName)) {
      throw new Error('Incompatible idle track ' + track.name);
    }
    return { joint, curve: track.createInterpolant() };
  }) ?? [];
  const yawnChannels = bind(clip), restChannels = bind(standingClip);
  const fittedSleeves = root.userData.outfit === 'cardigan';
  const spine = bone('Spine2'), neck = bone('Neck'), head = bone('Head');
  const arms = (['Right', 'Left'] as const).map(side => {
    const direction = side === 'Left' ? 1 : -1;
    const axis = bone(side + 'HandIndex1').getWorldPosition(new THREE.Vector3())
      .sub(bone(side + 'HandPinky1').getWorldPosition(new THREE.Vector3())).normalize().multiplyScalar(-direction);
    const fingers = ['Index', 'Middle', 'Ring', 'Pinky'].flatMap((name, index) => [1, 2].map(segment => {
      const joint = bone(side + 'Hand' + name + segment);
      return { joint, axis: axis.clone().applyQuaternion(joint.getWorldQuaternion(new THREE.Quaternion()).invert()),
        flex: (.80 + index * .10) * (segment === 1 ? .82 : 1) };
    }));
    const parts = (['Shoulder', 'Arm', 'ForeArm', 'Hand'] as const).map(part => ({
      joint: bone(side + part),
      clasp: new THREE.Quaternion(...CLASP[`${side}${part}`]).normalize(),
      base: new THREE.Quaternion(),
    }));
    return { direction, fingers, parts };
  });
  const rotation = new THREE.Quaternion(), euler = new THREE.Euler();
  const modelRotation = new THREE.Quaternion(), basis = new THREE.Quaternion(), inverseBasis = new THREE.Quaternion();
  const modelOffset = (joint: THREE.Object3D, x: number, y: number, z: number, weight: number) => {
    if (!weight || !(x || y || z)) return;
    joint.parent!.getWorldQuaternion(basis).invert().multiply(modelRotation);
    rotation.setFromEuler(euler.set(x * weight, y * weight, z * weight));
    rotation.premultiply(basis).multiply(inverseBasis.copy(basis).invert());
    joint.quaternion.premultiply(rotation);
  };
  const sleeveBreath = (joint: THREE.Object3D, x: number, y: number, z: number, weight: number) => {
    joint.quaternion.multiply(rotation.setFromEuler(euler.set(x * weight, y * weight, z * weight)));
  };
  const breathingOffset = fittedSleeves ? sleeveBreath : modelOffset;
  return (state: IdleState, animate = true) => {
    const restWeight = standingClip || !fittedSleeves ? smooth(state.restWeight) : 0;
    // Blender-authored relaxed shoulders, elbows, wrists and fingers.
    for (const { joint, curve } of restChannels) {
      rotation.fromArray(curve.evaluate(0));
      joint.quaternion.slerp(rotation, restWeight);
    }
    const weight = animate ? smooth(state.weight) : 0;
    const armWeight = fittedSleeves ? weight * .18 : weight;
    const breath = Math.sin(state.phase * Math.PI * 2 / STANDING_IDLE.breathPeriod);
    const sway = Math.sin(state.phase * Math.PI * 2 / STANDING_IDLE.swayPeriod);
    const shortWeight = animate ? state.shortWeight : 0;
    const listen = state.shortKind === 'listen' ? shortWeight : 0;
    const clasp = state.shortKind === 'clasp' ? shortWeight : 0;
    if (restWeight || weight || shortWeight) {
      root.getWorldQuaternion(modelRotation);
      breathingOffset(spine, breath * STANDING_IDLE.breathPitch, 0, sway * STANDING_IDLE.swayRoll, weight);
      breathingOffset(neck, -breath * .012, sway * STANDING_IDLE.headTurn, -sway * (fittedSleeves ? .015 : .022), weight);
      modelOffset(spine, .018 * listen + .043 * clasp, .058 * listen, -.018 * listen, 1);
      modelOffset(neck, .14 * listen + .20 * clasp, .23 * listen - .038 * clasp, -.12 * listen + .032 * clasp, 1);
      modelOffset(head, .064 * listen + .10 * clasp, .10 * listen, -.094 * listen, 1);
      for (const { direction, fingers, parts } of arms) {
        const [{ joint: shoulder }, { joint: upper }, { joint: forearm }, { joint: hand }] = parts;
        if (clasp) for (const part of parts) part.base.copy(part.joint.quaternion).multiply(part.clasp);
        if (!standingClip) {
          modelOffset(shoulder, 0, 0, direction * .025, restWeight);
          modelOffset(upper, -.125, 0, -direction * .15, restWeight);
          modelOffset(forearm, -.155, 0, -direction * .038, restWeight);
          modelOffset(hand, .085, -direction * .065, -direction * .025, restWeight);
        }
        if (fittedSleeves) {
          sleeveBreath(shoulder, 0, 0, -direction * breath * STANDING_IDLE.shoulderRoll, armWeight);
          sleeveBreath(upper, sway * STANDING_IDLE.armSwing, 0, -direction * .025, armWeight);
          sleeveBreath(forearm, STANDING_IDLE.elbowRelax * (.65 + .35 * breath), 0, 0, armWeight);
        } else {
          modelOffset(shoulder, 0, 0, direction * breath * STANDING_IDLE.shoulderRoll, weight);
          modelOffset(upper, (sway - .38) * STANDING_IDLE.armSwing, 0, -direction * sway * .018, weight);
          modelOffset(forearm, -STANDING_IDLE.elbowRelax * (.60 + .40 * breath), 0, 0, weight);
        }
        if (clasp) {
          for (const part of parts) part.joint.quaternion.slerp(part.base, clasp);
          // Sweep forward before closing the gap between the wrists.
          const arc = 4 * clasp * (1 - clasp);
          modelOffset(upper, -.30 * arc, 0, direction * .085 * arc, 1);
        }
        const curl = (standingClip ? 0 : .18 * restWeight) + .10 * clasp;
        for (const finger of fingers) finger.joint.rotateOnAxis(finger.axis, curl * finger.flex);
      }
    }
    if (!animate) return;
    if (state.shortTime >= 0 && !isBuiltIn(state.shortKind)) {
      if (shortWeight > 0) applyCabinAction?.(state.shortKind, state.shortTime, shortWeight);
      return;
    }
    const time = state.yawnTime;
    if (time < 0 || !state.yawnWeight) return;
    for (const { joint, curve } of yawnChannels) {
      rotation.fromArray(curve.evaluate(time));
      joint.quaternion.slerp(rotation, state.yawnWeight);
    }
  };
}
