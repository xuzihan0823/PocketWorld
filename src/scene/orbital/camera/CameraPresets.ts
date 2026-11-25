import { Box3, Vector3, MathUtils, type Object3D } from 'three';
import { BED_POSITION, UPPER_DECK_OFFSET, type CabinDeck } from '../cabinLayout.ts';
import { CAMERA_FOV, HOME_ZOOM, viewpoints, type CabinView } from '../cabinView.ts';
import { fitCameraBounds } from './CameraFraming.ts';

export const INSPECT_FOV = 40;
export type CameraAnchorId = 'bedroom' | 'desktop' | 'bed' | 'music-player' | 'resident';

export interface CameraAnchor {
  id: CameraAnchorId;
  nodeName: string;
  deck?: CabinDeck;
  direction: Vector3;
  bounds?: Box3;
}

function bounds(center: readonly number[], size: [number, number, number]) {
  return new Box3().setFromCenterAndSize(new Vector3().fromArray(center), new Vector3(...size));
}

export const CAMERA_ANCHORS: readonly CameraAnchor[] = [
  { id: 'bedroom', nodeName: 'Cabin_UpperDeck', deck: 'upper', direction: new Vector3(-.64, .43, 1).normalize() },
  { id: 'desktop', nodeName: 'Furniture_Workbench', deck: 'lower', direction: new Vector3(-.22, .65, 1).normalize(),
    bounds: bounds([.57, 1.35, -2.38], [4.8, .8, 1.45]) },
  { id: 'bed', nodeName: 'Furniture_Bed', deck: 'upper', direction: new Vector3(-.66, .66, 1).normalize(),
    bounds: bounds(new Vector3(...BED_POSITION).add(new Vector3(...UPPER_DECK_OFFSET)).add(new Vector3(0, .65, 0)).toArray(), [1.8, 1.4, 2.65]) },
  { id: 'music-player', nodeName: 'RecordPlayer', deck: 'lower', direction: new Vector3(.16, .65, 1).normalize(),
    bounds: bounds([-.45, 1.29, -2], [.89, .39, .63]) },
  { id: 'resident', nodeName: 'OrbitalResident', direction: new Vector3(-.45, .14, 1).normalize() },
];

const sceneBoxes = Object.fromEntries(Object.entries(viewpoints).map(([id, view]) => {
  const box = new Box3();
  for (const { x, y, z } of view.bounds) {
    box.expandByPoint(new Vector3(x[0], y[0], z[0]));
    box.expandByPoint(new Vector3(x[1], y[1], z[1]));
  }
  return [id, box];
})) as Record<CabinView, Box3>;

export function panoramaBounds(view: CabinView) { return sceneBoxes[view]; }

export function panoramaFrame(view: CabinView, aspect: number) {
  const direction = viewpoints[view].direction;
  const fit = fitCameraBounds(sceneBoxes[view], direction, aspect, CAMERA_FOV);
  const distance = fit.halfHeight * HOME_ZOOM / Math.tan(MathUtils.degToRad(CAMERA_FOV / 2));
  return { ...fit, distance, position: fit.target.clone().addScaledVector(direction, distance) };
}

export function anchorBounds(anchor: CameraAnchor, node: Object3D, origin: Vector3) {
  if (anchor.bounds) return anchor.bounds.clone().translate(origin);
  if (anchor.id === 'bedroom') return sceneBoxes.upper.clone().translate(origin).expandByScalar(-.1);
  // A stable box around the character root avoids refitting on individual animation frames.
  const feet = node.getWorldPosition(new Vector3());
  feet.y += .82;
  return bounds(feet.toArray(), [1, 1.74, .86]);
}
