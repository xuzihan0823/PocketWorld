import type { WorldAction } from '../../types/world';

export type DrawerInteraction = { request: (action: WorldAction) => void; busy: boolean };
export const DRAWER_TRAVEL = 0.64;
const LEFT = -0.19, RIGHT = 0.89, BACK = -2.60, FRONT = -1.575;
export const DRAWER_CLEAR_Z = FRONT + DRAWER_TRAVEL + 0.38;

export function canReachDrawer(position: { x: number; y: number; z: number }, open: boolean) {
  const front = FRONT + (open ? DRAWER_TRAVEL : 0);
  return position.y < 0.02 && position.z >= front && position.z <= front + 1.05
    && position.x >= LEFT - 0.18 && position.x <= RIGHT + 0.18;
}

export function drawerObstacle(extension: number, radius: number): [number, number, number, number] {
  return [LEFT - radius, RIGHT + radius, BACK - radius, FRONT + extension + radius];
}
