import * as THREE from 'three';
import type { ResidentRig } from '../ResidentModel';
import { reachArm } from '../library/armPose';
import type { BoundBookControl } from './bookControl';

const forward = new THREE.Vector3(0, 0, -1);
const across = new THREE.Vector3(), palm = new THREE.Vector3(), wrist = new THREE.Vector3();
const rest = new THREE.Vector3(), orientation = new THREE.Quaternion(), local = new THREE.Quaternion();
const basis = new THREE.Matrix4(), neutral = new THREE.Quaternion();

export function resetJournalPose(rig: ResidentRig) {
  rig.torso.quaternion.identity();
  rig.neck.quaternion.identity();
  for (const arm of rig.arms) {
    arm.shoulder.quaternion.identity();
    arm.upper.quaternion.identity();
    arm.forearm.quaternion.identity();
    arm.hand.quaternion.identity();
  }
}

export function reachJournalPage(rig: ResidentRig, hips: THREE.Group, hand: BoundBookControl['hand']) {
  hips.rotation.x = .37 * hand.reach;
  const arm = rig.arms[hand.side];
  rig.torso.rotation.x = .12 * hand.reach;
  rig.neck.rotation.x = .10 * hand.reach;
  arm.shoulder.rotation.z = (hand.side === 0 ? -.76 : .76) * hand.reach;
  palm.copy(hand.normal).multiplyScalar(hand.side === 0 ? -1 : 1);
  // Point the fingers toward the binding side of the desk and align the pinch with the sheet.
  across.crossVectors(forward, palm).normalize();
  orientation.setFromRotationMatrix(basis.makeBasis(across, forward, palm));
  wrist.copy(hand.point).sub(rest.copy(arm.pinch.offset).applyQuaternion(orientation));
  arm.hand.parent!.localToWorld(rest.copy(arm.hand.position));
  wrist.lerpVectors(rest, wrist, hand.reach);
  reachArm(rig, arm, wrist, hand.side);
  arm.forearm.getWorldQuaternion(local).invert().multiply(orientation).multiply(arm.pinch.basis);
  arm.hand.quaternion.slerpQuaternions(neutral, local, hand.reach);
}
