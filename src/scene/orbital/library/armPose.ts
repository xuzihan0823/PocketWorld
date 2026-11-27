import * as THREE from 'three';
import { CARDIGAN_PALMS } from './cardiganPalms';
import type { ResidentArm, ResidentRig } from '../ResidentModel';

const origin = new THREE.Vector3();
const target = new THREE.Vector3();
const bend = new THREE.Vector3();
const elbow = new THREE.Vector3();
const local = new THREE.Vector3();
const rotation = new THREE.Quaternion();
const invParent = new THREE.Quaternion();
const tempMat = new THREE.Matrix4();
const tempEuler = new THREE.Euler();

function aim(bone: THREE.Bone, rest: THREE.Vector3, point: THREE.Vector3, planeNormal: THREE.Vector3) {
  bone.parent!.updateWorldMatrix(true, false);
  local.copy(point);
  bone.parent!.worldToLocal(local);
  local.sub(bone.position);
  if (local.lengthSq() < 1e-10) return;
  local.normalize();
  // A direction alone leaves roll undefined and its shortest arc flips near -rest.
  // The elbow plane supplies the second axis for a deterministic anatomical frame.
  const restForward = rest.clone().normalize();
  const restUp = new THREE.Vector3(0, 0, Math.abs(restForward.z) > 0.98 ? 0 : 1);
  if (restUp.lengthSq() === 0) restUp.set(0, 1, 0);
  restUp.addScaledVector(restForward, -restUp.dot(restForward)).normalize();
  const up = planeNormal.clone().applyQuaternion(bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert());
  up.addScaledVector(local, -up.dot(local)).normalize();
  const bindFrame = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().makeBasis(restForward, restUp, restForward.clone().cross(restUp)),
  );
  bone.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(local, up, local.clone().cross(up)))
    .multiply(bindFrame.invert());
  bone.updateWorldMatrix(false, true);
}

export function solveShoulder(
  rig: ResidentRig,
  arm: ResidentArm,
  destination: THREE.Vector3,
  side: number,
  weight = 1,
) {
  if (weight <= 0) {
    arm.shoulder.quaternion.identity();
    arm.shoulder.updateWorldMatrix(false, true);
    return;
  }
  rig.mesh.updateWorldMatrix(true, true);
  const shoulderWorld = arm.shoulder.getWorldPosition(new THREE.Vector3());
  const localDest = destination.clone().sub(shoulderWorld).applyQuaternion(rig.mesh.getWorldQuaternion(rotation).invert());
  const reachMax = arm.upperLength + arm.lowerLength;
  const dist = localDest.length();
  const stretch = THREE.MathUtils.clamp((dist - reachMax * 0.72) / (reachMax * 0.35), 0, 1);
  const heightBias = THREE.MathUtils.clamp((localDest.y + 0.04) / 0.30, -0.35, 1);
  const forwardBias = THREE.MathUtils.clamp((localDest.z - 0.08) / 0.28, 0, 1);
  const lift = THREE.MathUtils.clamp(heightBias * 0.22 + stretch * 0.14, -0.06, 0.30) * weight;
  const protract = THREE.MathUtils.clamp(forwardBias * 0.16 + stretch * 0.12, 0, 0.24) * weight;
  const sign = side ? 1 : -1;
  arm.shoulder.rotation.set(0, -sign * protract, sign * lift, 'YXZ');
  arm.shoulder.updateWorldMatrix(false, true);
}

export function reachArm(
  rig: ResidentRig,
  arm: ResidentArm,
  destination: THREE.Vector3,
  side: number,
  poleHint?: THREE.Vector3,
) {
  rig.mesh.updateWorldMatrix(true, true);
  arm.upper.getWorldPosition(origin);
  target.copy(destination).sub(origin);
  const rawDist = target.length();
  const minReach = Math.abs(arm.upperLength - arm.lowerLength) + 0.002;
  const maxReach = arm.upperLength + arm.lowerLength - 0.002;
  const distance = THREE.MathUtils.clamp(rawDist, minReach, maxReach);
  if (rawDist > 1e-6) target.divideScalar(rawDist);
  else target.set(0, -1, 0);

  const meshQuat = rig.mesh.getWorldQuaternion(rotation);
  // Anatomical elbow pole: comfortably outward, downward, and slightly backward.
  bend.set(side ? 0.72 : -0.72, -0.82, -0.12).applyQuaternion(meshQuat);
  if (poleHint && poleHint.lengthSq() > 1e-6) {
    bend.copy(poleHint);
  }
  bend.addScaledVector(target, -bend.dot(target));
  if (bend.lengthSq() < 1e-6) {
    bend.set(side ? 1 : -1, -0.2, 0).applyQuaternion(meshQuat);
    bend.addScaledVector(target, -bend.dot(target));
  }
  bend.normalize();

  const along = (arm.upperLength ** 2 - arm.lowerLength ** 2 + distance ** 2) / (2 * distance);
  elbow
    .copy(origin)
    .addScaledVector(target, along)
    .addScaledVector(bend, Math.sqrt(Math.max(0, arm.upperLength ** 2 - along ** 2)));
  const planeNormal = new THREE.Vector3().crossVectors(target, bend).multiplyScalar(side ? 1 : -1).normalize();
  aim(arm.upper, arm.restUpper, elbow, planeNormal);
  aim(arm.forearm, arm.restLower, destination, planeNormal);
  arm.hand.quaternion.identity();
}

export function resetArms(rig: ResidentRig, blend: number) {
  const identity = new THREE.Quaternion();
  rig.arms.forEach(arm => {
    arm.shoulder.quaternion.slerp(identity, blend);
    arm.upper.quaternion.slerp(identity, blend);
    arm.forearm.quaternion.slerp(identity, blend);
    arm.hand.quaternion.slerp(identity, blend);
    arm.setFingers?.(0, 0);
  });
  rig.torso.quaternion.slerp(identity, blend);
  rig.neck.quaternion.slerp(identity, blend);
  rig.head?.quaternion.slerp(identity, blend);
}

export interface ReachPalmOptions {
  quaternion?: THREE.Quaternion;
  blend?: number;
  armBlend?: number;
  mode?: 'palm' | 'tip' | 'pinch';
  tipWeight?: number;
  shoulderWeight?: number;
  poleHint?: THREE.Vector3;
  fingerCurl?: number;
  thumbOppose?: number;
  /** Exact bounded pronation for the closed-cover grip, faded out before reading. */
  forearmTwistBlend?: number;
}

export function reachPalm(
  rig: ResidentRig,
  arm: ResidentArm,
  contact: THREE.Vector3,
  side: number,
  orientationOrOptions?: { quaternion: THREE.Quaternion; blend: number } | ReachPalmOptions,
) {
  const opts: ReachPalmOptions = orientationOrOptions ?? {};
  if (opts.fingerCurl !== undefined) arm.setFingers?.(opts.fingerCurl, opts.thumbOppose);
  const shoulderWeight = opts.shoulderWeight ?? 0;
  solveShoulder(rig, arm, contact, side, shoulderWeight);

  const localOffset = new THREE.Vector3();
  // The cardigan middle-knuckle pivot lies inside the palm. Use the Blender
  // bearing frame fitted to the index and pinky roots and the loaded hand skin.
  const fitted = rig.mesh.userData.outfit === 'cardigan' ? CARDIGAN_PALMS[side] : undefined;
  const basis = fitted ? arm.palmBasis.clone() : arm.palmBasis;
  if (fitted) basis.multiply(new THREE.Quaternion().fromArray(fitted.basis));
  const palm = fitted
    ? new THREE.Vector3().fromArray(fitted.offset).applyQuaternion(arm.palmBasis)
    : arm.palmOffset?.clone() ?? (side ? new THREE.Vector3(-0.025, -0.004, 0.014) : new THREE.Vector3(-0.008, -0.025, -0.004));
  if (fitted) {
    // Relaxing the fingers brings the fleshy pads closer to the underside.
    const relaxed = THREE.MathUtils.clamp((.04 - (opts.fingerCurl ?? .04)) / .16, 0, 1);
    palm.add(new THREE.Vector3(0, 0, fitted.openPadDepth * relaxed).applyQuaternion(basis));
  }
  const tip = arm.fingerTipOffset?.clone() ?? palm.clone().multiplyScalar(1.55);
  if (opts.tipWeight !== undefined) localOffset.lerpVectors(palm, tip, opts.tipWeight);
  else if (opts.mode === 'tip') localOffset.copy(tip);
  else if (opts.mode === 'pinch') localOffset.lerpVectors(palm, tip, 0.48);
  else localOffset.copy(palm);

  const handWorldQuat = new THREE.Quaternion();
  const palmBasisInv = basis ? basis.clone().invert() : new THREE.Quaternion();
  const wrist = contact.clone();

  const elbowPos = new THREE.Vector3();
  const wristPos = new THREE.Vector3();
  const forearmAxis = new THREE.Vector3();
  const forearmWorldQuat = new THREE.Quaternion();
  const twistQuat = new THREE.Quaternion();

  for (let i = 0; i < 4; i++) {
    reachArm(rig, arm, wrist, side, opts.poleHint);
    arm.hand.updateWorldMatrix(true, false);
    if (opts.quaternion && basis) {
      const blend = opts.blend ?? 1;
      const restPalm = arm.hand.getWorldQuaternion(handWorldQuat).multiply(basis);
      const base = restPalm.clone().slerp(opts.quaternion, blend);

      // Share pronation/supination twist along the forearm so the wrist never pinches ("拧麻花").
      arm.forearm.getWorldPosition(elbowPos);
      arm.hand.getWorldPosition(wristPos);
      forearmAxis.copy(wristPos).sub(elbowPos);
      if (forearmAxis.lengthSq() > 1e-8) {
        forearmAxis.normalize();
        const delta = base.clone().multiply(restPalm.clone().invert());
        const dot = delta.x * forearmAxis.x + delta.y * forearmAxis.y + delta.z * forearmAxis.z;
        // Preserve the signed swing/twist decomposition. Squaring the projected
        // quaternion discarded pronation direction and could turn the forearm
        // away from the requested palm, leaving a half turn at the wrist.
        // The signed sine is invariant to q/-q and continuous at a half turn.
        // Fade out at the undefined opposite swing instead of selecting a
        // discontinuous atan2 branch; retain the existing 100° upper bound.
        const sineShare = 1.75 * (2 * dot * delta.w) / (dot * dot + delta.w * delta.w + 0.16);
        // This grip stays on one side of the half-turn branch. The sine share
        // loses leverage there and leaves >100 degrees in the closed wrist.
        // Canonicalizing q/-q keeps repeated or reverse seeking deterministic.
        const request = 2 * Math.atan2(dot * (delta.w < 0 ? -1 : 1), Math.abs(delta.w));
        const share = THREE.MathUtils.lerp(sineShare, THREE.MathUtils.clamp(request, -1.75, 1.75), opts.forearmTwistBlend ?? 0);
        twistQuat.setFromAxisAngle(forearmAxis, share);
        arm.forearm.parent!.getWorldQuaternion(invParent).invert();
        arm.forearm.getWorldQuaternion(forearmWorldQuat);
        arm.forearm.quaternion.copy(invParent).multiply(twistQuat).multiply(forearmWorldQuat);
        arm.forearm.updateWorldMatrix(false, true);
      }

      arm.hand.parent!.getWorldQuaternion(invParent).invert();
      arm.hand.quaternion.copy(invParent).multiply(base).multiply(palmBasisInv);
      arm.hand.updateWorldMatrix(false, false);
    }
    const worldOffset = localOffset.clone().applyQuaternion(arm.hand.getWorldQuaternion(handWorldQuat));
    wrist.copy(contact).sub(worldOffset);
  }
  if (opts.armBlend !== undefined && opts.armBlend < 1) {
    const ab = THREE.MathUtils.clamp(opts.armBlend, 0, 1);
    const id = new THREE.Quaternion();
    arm.shoulder.quaternion.copy(id.clone().slerp(arm.shoulder.quaternion, ab));
    arm.upper.quaternion.copy(id.clone().slerp(arm.upper.quaternion, ab));
    arm.forearm.quaternion.copy(id.clone().slerp(arm.forearm.quaternion, ab));
    arm.hand.quaternion.copy(id.clone().slerp(arm.hand.quaternion, ab));
  }
}

export function applyTorsoAndGazeIK(
  rig: ResidentRig,
  gazeWorld: THREE.Vector3 | null,
  torsoPitch: number,
  torsoYaw: number,
  torsoRoll: number,
  gazeWeight: number,
  dt: number,
) {
  const kBody = 1 - Math.exp(-dt * 8);
  const targetTorso = new THREE.Quaternion().setFromEuler(tempEuler.set(torsoPitch, torsoYaw, torsoRoll, 'YXZ'));
  rig.torso.quaternion.slerp(targetTorso, kBody);
  rig.torso.updateWorldMatrix(true, true);

  const identity = new THREE.Quaternion();
  if (!gazeWorld || gazeWeight <= 0.001) {
    rig.neck.quaternion.slerp(identity, kBody);
    rig.head?.quaternion.slerp(identity, kBody);
    return;
  }
  const neckPos = rig.neck.getWorldPosition(new THREE.Vector3());
  const dir = gazeWorld.clone().sub(neckPos);
  if (dir.lengthSq() < 1e-6) return;
  dir.applyQuaternion(rig.torso.getWorldQuaternion(rotation).invert()).normalize();
  const yaw = THREE.MathUtils.clamp(Math.atan2(dir.x, dir.z), -0.52, 0.52) * gazeWeight;
  const pitch = THREE.MathUtils.clamp(-Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) + 0.06, -0.38, 0.48) * gazeWeight;
  const kGaze = 1 - Math.exp(-dt * 10);
  if (rig.head) {
    rig.neck.quaternion.slerp(new THREE.Quaternion().setFromEuler(tempEuler.set(pitch * 0.36, yaw * 0.36, 0, 'YXZ')), kGaze);
    rig.head.quaternion.slerp(new THREE.Quaternion().setFromEuler(tempEuler.set(pitch * 0.64, yaw * 0.64, 0, 'YXZ')), kGaze);
  } else {
    rig.neck.quaternion.slerp(new THREE.Quaternion().setFromEuler(tempEuler.set(pitch, yaw, 0, 'YXZ')), kGaze);
  }
  void tempMat;
}
