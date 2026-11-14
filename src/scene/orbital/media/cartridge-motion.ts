import type { GameId } from '../../../types/game';

export type CartridgePoint = [number, number, number];
export const CARTRIDGE_SLOT: CartridgePoint = [2.26, 1.27, -2.05];
export const CARTRIDGE_DRAG_HEIGHT = 1.44;
export const CARTRIDGE_HEIGHT = 0.25;
// The fitted cartridge and its fallback both have a centered vertical pivot.
const CARTRIDGE_REST_HEIGHT = 1.12 + CARTRIDGE_HEIGHT / 2;
// Both cartridges sit entirely to the left of the monitor housing (x >= .975),
// clustered by the monitor's rear-left corner and staggered front-to-back.
export const cartridgePosition = (game: GameId): CartridgePoint => [game === 'mario' ? 0.60 : 0.76, CARTRIDGE_REST_HEIGHT, game === 'mario' ? -2.64 : -2.50];

export function clampCartridgeDrag(point: CartridgePoint): CartridgePoint {
  // Keep the entire cartridge in front of the monitor and above the desk/keyboard.
  return [Math.max(0, Math.min(2.8, point[0])), Math.max(CARTRIDGE_DRAG_HEIGHT, Math.min(2.7, point[1])), CARTRIDGE_SLOT[2]];
}

export function isCartridgeDrop(point: CartridgePoint): boolean {
  return point.every(Number.isFinite) && Math.abs(point[0] - CARTRIDGE_SLOT[0]) <= 0.25
    && point[1] >= CARTRIDGE_SLOT[1] - 0.12 && point[1] <= CARTRIDGE_SLOT[1] + 0.42
    && Math.abs(point[2] - CARTRIDGE_SLOT[2]) <= 0.12;
}

export function cartridgeDragState(intended: CartridgePoint) {
  // Collision clamping must not turn a release far below the desk into a valid drop.
  return { point: clampCartridgeDrag(intended), nearSlot: isCartridgeDrop(intended) };
}

/** Lift, pull forward, move across, then lower; never cut diagonally through the CRT. */
export function cartridgeTransferPoint(from: CartridgePoint, to: CartridgePoint, progress: number): CartridgePoint {
  // The staggered rear cartridge passes over the front one when moving toward the slot.
  const height = Math.max(CARTRIDGE_REST_HEIGHT + CARTRIDGE_HEIGHT + 0.025, from[1], to[1]);
  const points: CartridgePoint[] = [from, [from[0], height, from[2]], [from[0], height, CARTRIDGE_SLOT[2]],
    [to[0], height, CARTRIDGE_SLOT[2]], [to[0], height, to[2]], to];
  const scaled = Math.max(0, Math.min(1, progress)) * (points.length - 1);
  const index = Math.min(points.length - 2, Math.floor(scaled));
  const t = scaled - index, eased = t * t * (3 - 2 * t);
  return points[index].map((value, axis) => value + (points[index + 1][axis] - value) * eased) as CartridgePoint;
}
