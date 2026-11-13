import * as THREE from 'three';
import { readingStand, shelfOrigin, slotFor, type LibraryBook, type Vec3 } from './catalog';
import type { LibraryFlow } from './useLibrary';
export const smooth = (t: number) => t * t * (3 - 2 * t);
const shelfQuaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)));
const heldQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(-.10, Math.PI, 0));
export function bookStand(scene: string, book: LibraryBook, near = false): Vec3 {
  const origin = shelfOrigin(scene), slot = slotFor(book);
  return [THREE.MathUtils.clamp(origin[0] + slot.position[0], -3.65, -3.10), 0, origin[2] + (near ? .54 : .96)];
}
export function bookPose(scene: string, book: LibraryBook, flow: LibraryFlow) {
  const origin = shelfOrigin(scene), slot = slotFor(book), t = smooth(flow.progress), phase = flow.book?.id === book.id ? flow.phase : 'idle';
  const shelf = new THREE.Vector3(origin[0] + slot.position[0] + .035, slot.position[1], origin[2] + .20);
  const outside = shelf.clone().add(new THREE.Vector3(0, 0, .34));
  const root = bookStand(scene, book);
  const held = new THREE.Vector3(root[0], .92, root[2] - .31);
  const position = shelf.clone(), quaternion = shelfQuaternion.clone(); let open = 0;
  if (phase === 'shelving') position.z += (1 - t) * .15;
  if (phase === 'extract') position.lerp(outside, t);
  if (['carry', 'open', 'reading', 'turn', 'close', 'return-carry'].includes(phase)) {
    position.copy(held); quaternion.copy(heldQuaternion);
    if (phase === 'carry') { position.lerpVectors(outside, held, t); quaternion.slerpQuaternions(shelfQuaternion, heldQuaternion, t); }
    if (phase === 'return-carry') { position.lerpVectors(held, outside, t); quaternion.slerpQuaternions(heldQuaternion, shelfQuaternion, t); }
    if (['reading', 'turn'].includes(phase)) open = 1;
    if (phase === 'open') open = t;
    if (phase === 'close') open = 1 - t;
  }
  if (phase === 'insert') position.lerpVectors(outside, shelf, t);
  return { position, quaternion, open, phase };
}
export function residentLibraryTarget(scene: string, flow: LibraryFlow): Vec3 {
  if (flow.book && flow.phase === 'align') return bookStand(scene, flow.book, true);
  return readingStand(scene);
}

export const leafProgress = (flow: LibraryFlow) => THREE.MathUtils.clamp((flow.progress - .15) / .75, 0, 1);
