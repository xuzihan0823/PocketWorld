import * as THREE from 'three';
import type { ResidentRig } from './ResidentModel';
import { reachPalm } from './library/armPose';
import { DRAWER_HANDLE } from './drawerInteraction';

const shoulder = new THREE.Vector3(), grip = new THREE.Vector3(), identity = new THREE.Quaternion();
const palmToDrawer = new THREE.Quaternion();

/**
 * Puts both palms on the drawer handle. `space` is the scene group the drawer and the resident
 * live in, `extension` the drawer's current travel, and `blend` eases the arms from rest (0) to
 * the grip (1) by slerping the solved joint rotations back towards the neutral pose.
 */
export function applyDrawerHands(rig: ResidentRig, space: THREE.Object3D, extension: number, blend: number) {
  rig.mesh.updateWorldMatrix(true, true);
  space.updateWorldMatrix(true, false);
  // Palm faces the drawer (towards -z of the room) with the fingers pointing down over the bar.
  palmToDrawer.setFromRotationMatrix(new THREE.Matrix4().makeBasis(
    new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, -1, 0)));
  palmToDrawer.premultiply(space.getWorldQuaternion(new THREE.Quaternion()));
  rig.arms.forEach((arm, side) => {
    space.worldToLocal(arm.upper.getWorldPosition(shoulder));
    const offset = shoulder.x < DRAWER_HANDLE.x ? -DRAWER_HANDLE.spread : DRAWER_HANDLE.spread;
    grip.set(DRAWER_HANDLE.x + offset, DRAWER_HANDLE.y, DRAWER_HANDLE.z + extension);
    space.localToWorld(grip);
    reachPalm(rig, arm, grip, side, { quaternion: palmToDrawer, blend: .6 });
    if (blend < 1) {
      const rest = 1 - blend;
      arm.upper.quaternion.slerp(identity, rest);
      arm.forearm.quaternion.slerp(identity, rest);
      arm.hand.quaternion.slerp(identity, rest);
    }
  });
}

/** Returns both arms to the neutral pose at once (used when a drawer move is abandoned). */
export function releaseDrawerHands(rig: ResidentRig) {
  for (const arm of rig.arms) {
    arm.upper.quaternion.identity(); arm.forearm.quaternion.identity(); arm.hand.quaternion.identity();
  }
}
