import * as THREE from 'three';
import type { ResidentRig } from '../ResidentModel';
import type { LibraryFlow } from './useLibrary';
import { bookPose, bookStand, smooth, leafProgress } from './bookMotion';
import { shelfOrigin, slotFor } from './catalog';
import { reachPalm as reachArm, resetArms } from './armPose';
const point = new THREE.Vector3();
export function applyLibraryPose(rig: ResidentRig, root: THREE.Group, scene: string, flow: LibraryFlow, dt: number) {
  const phase = flow.phase, t = smooth(flow.progress), originX = scene === 'observatory' ? 14 : 0;
  rig.mesh.updateWorldMatrix(true, true);
  if (!flow.book || ['catalog', 'form', 'recenter', 'shelving'].includes(phase)) { resetArms(rig, 1 - Math.exp(-dt * 9)); return; }
  const book = bookPose(scene, flow.book, flow);
  const supportOrientation = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(1, 0, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0))).premultiply(book.quaternion);
  const contact = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyQuaternion(book.quaternion).add(book.position).add(new THREE.Vector3(originX, 0, 0));
  if (['align', 'reach', 'extract', 'insert', 'release'].includes(phase)) {
    const armSide = shelfOrigin(scene)[0] + slotFor(flow.book).position[0] < root.position.x ? 1 : 0;
    const aim = contact(-.015, .035, -.075);
    const blend = phase === 'reach' ? t : phase === 'release' ? 1 - t : phase === 'align' ? 0 : 1;
    const restWorld = rig.mesh.localToWorld(rig.arms[armSide].restWrist.clone());
    point.lerpVectors(restWorld, aim, blend); reachArm(rig, rig.arms[armSide], point, armSide);
    rig.arms[1 - armSide].upper.quaternion.slerp(new THREE.Quaternion(), 1 - Math.exp(-dt * 9)); rig.arms[1 - armSide].forearm.quaternion.slerp(new THREE.Quaternion(), 1 - Math.exp(-dt * 9));
  } else {
    if (phase === 'turn') {
      const side = flow.direction > 0 ? 1 : 0, support = 1 - side;
      reachArm(rig, rig.arms[support], contact(support ? .11 : -.11, -.018, -.13), support, { quaternion: supportOrientation, blend: 1 });
      const u = leafProgress(flow), heldX = side ? .17 : -.11;
      const at = (v: number) => { const angle = Math.PI * (flow.direction > 0 ? v : 1 - v); return new THREE.Vector3(.22 * Math.cos(angle), .055 + .22 * Math.sin(angle), -.125).addScaledVector(new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0), .012 + Math.sin(.22 / .235 * Math.PI) * Math.sin(angle) * .025); };
      const rest = new THREE.Vector3(heldX, -.018, -.13), edgeUnder = new THREE.Vector3(heldX, -.025, -.15);
      let hand = at(Math.min(.60, u));
      if (flow.progress < .15) { const g = flow.progress / .15; if (g < .55) hand.lerpVectors(rest, edgeUnder, smooth(g / .55)); else hand.lerpVectors(edgeUnder, at(0), smooth((g - .55) / .45)); }
      else if (u > .60) { const r = (u - .60) / .40; if (r < .55) hand.lerp(edgeUnder, smooth(r / .55)); else hand.lerpVectors(edgeUnder, rest, smooth((r - .55) / .45)); }
      const angle = Math.PI * (flow.direction > 0 ? Math.min(.60, u) : 1 - Math.min(.60, u));
      const palm = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, 1), new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0), new THREE.Vector3(-Math.sin(angle), Math.cos(angle), 0))).premultiply(book.quaternion);
      const blend = flow.progress < .15 ? smooth(flow.progress / .15) : u > .60 ? 1 - smooth((u - .60) / .40) : 1;
      reachArm(rig, rig.arms[side], contact(hand.x, hand.y, hand.z), side, { quaternion: palm, blend });
    } else {
      reachArm(rig, rig.arms[0], contact(-.11 * book.open, -.018, -.13), 0, { quaternion: supportOrientation, blend: 1 });
      reachArm(rig, rig.arms[1], contact(.17, -.018, -.13), 1, { quaternion: supportOrientation, blend: 1 });
    }
  }
  rig.neck.rotation.x = THREE.MathUtils.damp(rig.neck.rotation.x, .035, 6, dt);
}
export function libraryCrouch(flow: LibraryFlow) {
  if (!flow.book || slotFor(flow.book).row !== 0) return 0;
  const t = smooth(flow.progress);
  if (flow.phase === 'reach') return t * .21;
  if (flow.phase === 'extract' || flow.phase === 'insert') return .21;
  if (flow.phase === 'carry') return .21 * (1 - t);
  if (flow.phase === 'return-carry') return .21 * t;
  if (flow.phase === 'release') return .21 * (1 - t);
  return 0;
}
export function carryResident(root: THREE.Group, scene: string, flow: LibraryFlow) {
  if (!flow.book || !['carry', 'return-carry'].includes(flow.phase)) return;
  const near = bookStand(scene, flow.book, true), far = bookStand(scene, flow.book), t = smooth(flow.progress);
  root.position.x = far[0]; root.position.z = THREE.MathUtils.lerp(near[2], far[2], flow.phase === 'carry' ? t : 1 - t);
}
