import * as THREE from 'three';
import { SCENE_ORIGINS, type WorldSceneProps } from '../../../types/world';
import { CLOCK_POSITION, UPPER_DECK_OFFSET, WARDROBE_STAND } from '../cabinLayout';
import { CAMERA_FOV } from '../cabinView';
import { BOOK_POSITION } from '../schedule/SchedulePaper';
import { SCHEDULE_BOOK_POSITION } from '../schedule/bookLayout';
import { shelfPoint, shelfVector } from '../library/catalog';
import { sideLibraryCamera } from '../library/sideCamera';
import { JOURNAL_PAGE_POSITION } from '../journalLayout';

// Existing interaction compositions include panel and hand clearance.
const FOCUS: Record<string, { target: [number, number, number]; offset: [number, number, number] }> = {
  computer: { target: [1.77, 1.68, -2.30], offset: [0, 0.30, 3.5] },
  'music-player': { target: [-0.45, 1.2, -2.0], offset: [.4, 2.5, 3.1] },
  journal: { target: JOURNAL_PAGE_POSITION, offset: [0, 0.97, 0.45] },
  schedule: { target: [SCHEDULE_BOOK_POSITION[0] + 0.02, SCHEDULE_BOOK_POSITION[1] + 0.079, SCHEDULE_BOOK_POSITION[2]], offset: [0, 0.88, 0.48] },
  'schedule-glass': { target: [0.69, 2.53, -3.13], offset: [0, 0.02, 1.75] },
  'book-01': { target: [-.07, 1.03, .9], offset: [1.35, 1.12, 2.5] },
  cabinet: { target: [0, 0.48, .32], offset: [0.9, 0.71, 2.35] },
  wardrobe: { target: [WARDROBE_STAND[0], 1.20, WARDROBE_STAND[1]], offset: [-3.45, .80, 3.80] },
  clock: { target: [-2.06, 1.01, -2.615], offset: [0.10, 0.24, 1.15] },
};
export function interactionPose(props: Pick<WorldSceneProps, 'focusedObject' | 'transition' | 'library'>, size: { width: number; height: number }, sideSlot: string | undefined, sideReading: boolean) {
  const origin = new THREE.Vector3(...SCENE_ORIGINS[props.transition.toScene]);
  const target = new THREE.Vector3(), eye = new THREE.Vector3(), lens = new THREE.Vector2();
  const aspect = size.width / Math.max(1, size.height);
  const narrow = size.width < 720;
  const cameraView = props.library?.cameraView;
  const sideView = props.focusedObject === 'book-01' && cameraView === 'side';
  const pose = props.focusedObject ? FOCUS[props.focusedObject] : null;
  if (sideView && size.width > 0 && size.height > 0) {
    const side = sideLibraryCamera(props.transition.toScene, sideSlot, sideReading, size.width, size.height, CAMERA_FOV);
    target.fromArray(side.target).add(origin);
    eye.fromArray(side.offset).add(target);
    lens.set(...side.lensOffset);
  } else if (pose) {
    target.copy(origin).add(new THREE.Vector3(...pose.target));
    const offset = new THREE.Vector3(...pose.offset);
    if (props.focusedObject === 'journal') offset.multiplyScalar(Math.max(1, 0.9 / (size.width / size.height)));
    if (props.focusedObject === 'book-01') {
      if (cameraView === 'close') { offset.set(1.75, .65, .30); target.y = 1.08; }
    }
    if (props.focusedObject?.startsWith('schedule')) {
      offset.multiplyScalar(Math.max(1, (narrow && props.focusedObject === 'schedule' ? 0.5 : 0.62) / (size.width / size.height)));
      if (narrow && props.focusedObject === 'schedule') target.x = origin.x + BOOK_POSITION[0];
    }
    if (props.focusedObject === 'clock' && narrow) {
      target.x = origin.x + CLOCK_POSITION[0];
      target.y = origin.y + CLOCK_POSITION[1] - 0.10;
      offset.multiplyScalar(Math.max(1, 0.68 / (size.width / size.height)));
    }
    if (props.focusedObject === 'book-01' && narrow) { const close = cameraView === 'close'; offset.multiplyScalar(close ? 1.9 : 1.6); target.y -= close ? .40 : .55; }
    if (props.focusedObject === 'book-01' && !narrow) target.x += .45;
    if (props.focusedObject === 'cabinet' || props.focusedObject === 'book-01') {
      target.sub(origin);
      target.fromArray(shelfPoint(props.transition.toScene, target.x, target.y, target.z)).add(origin);
      offset.fromArray(shelfVector(props.transition.toScene, offset.x, offset.y, offset.z));
    }
    if (props.focusedObject === 'wardrobe' && narrow) offset.multiplyScalar(Math.max(1, .51 / aspect));
    if ((props.focusedObject === 'clock' || props.focusedObject === 'wardrobe') && props.transition.toScene === 'habitat') target.add(new THREE.Vector3(...UPPER_DECK_OFFSET));
    eye.copy(target).add(offset);
    // Frame the shelf and slot together, including on portrait touchscreens.
    if (props.focusedObject === 'computer') eye.z = target.z + Math.max(pose.offset[2], 2.25 / (2 * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2)) * (size.width / size.height)) + 0.25);
  } else return null;
  return { eye, target, lens, zoom: 1, fov: CAMERA_FOV, mix: 1 };
}
