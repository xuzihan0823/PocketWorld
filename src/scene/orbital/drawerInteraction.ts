import type { WorldAction } from '../../types/world';

export type DrawerInteraction = { request: (action: WorldAction) => void; busy: boolean };
export const DRAWER_TRAVEL = 0.64;
const LEFT = -0.19, RIGHT = 0.89, BACK = -2.60, FRONT = -1.575;
/** Handle bar on the drawer face (closed position) and half the spacing between the two grips. */
export const DRAWER_HANDLE = { x: 0.35, y: 0.87, z: FRONT - 0.015, spread: 0.11 };
/** Gap between the drawer face and the resident's root while both hands hold the handle. */
export const DRAWER_STAND = 0.22;
export const DRAWER_REACH_TIME = 0.42, DRAWER_RELEASE_TIME = 0.34, DRAWER_SLIDE_SPEED = 0.46;
/** After letting go of the opened drawer the resident steps back to here, outside its walking keep-out margin. */
export const DRAWER_CLEAR_Z = FRONT + DRAWER_TRAVEL + 0.34;

/**
 * Drawer travel currently held by the resident's hands, keyed by scene. While a value is
 * present the drawer follows it instead of easing towards its committed open/closed state.
 */
export const drawerDrive: Partial<Record<string, number>> = {};

/** Where the resident stands to hold the handle when the drawer is pulled out by `extension`. */
export function drawerStandZ(extension: number) { return FRONT + extension + DRAWER_STAND; }

/** Drawer travel implied by the resident's root while gripping, so the hands never slip. */
export function drawerExtensionAt(rootZ: number) {
  return Math.min(DRAWER_TRAVEL, Math.max(0, rootZ - FRONT - DRAWER_STAND));
}

export function canReachDrawer(position: { x: number; y: number; z: number }, open: boolean) {
  const front = FRONT + (open ? DRAWER_TRAVEL : 0);
  return position.y < 0.02 && position.z >= front && position.z <= front + 1.05
    && position.x >= LEFT - 0.18 && position.x <= RIGHT + 0.18;
}

export function drawerObstacle(extension: number, radius: number): [number, number, number, number] {
  return [LEFT - radius, RIGHT + radius, BACK - radius, FRONT + extension + radius];
}
