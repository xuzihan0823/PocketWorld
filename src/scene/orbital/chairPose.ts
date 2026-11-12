import type { WorldSceneId } from '../../types/world';

export interface ChairPose { x: number; z: number; yaw: number; vx: number; vz: number; spin: number; drop: number }
/** Residents mutate this every frame and the furniture mirrors it, so rolling never re-renders React. */
export const CHAIR_POSES: Record<WorldSceneId, ChairPose> = {
  habitat: { x: 1.45, z: -0.85, yaw: 0.15, vx: 0, vz: 0, spin: 0, drop: 0 },
  observatory: { x: -1.65, z: 0.75, yaw: 0.42, vx: 0, vz: 0, spin: 0, drop: 0 },
};
export const SEAT_SWIVEL = -0.2;
/** Gas-lift travel that lets the short-legged resident reach the floor while scooting. */
export const SEAT_DROP = 0.35;

export function chairFacing(pose: ChairPose) { return pose.yaw + SEAT_SWIVEL + Math.PI; }

export function chairFront(pose: ChairPose, distance: number): [number, number] {
  const yaw = chairFacing(pose);
  return [pose.x + Math.sin(yaw) * distance, pose.z + Math.cos(yaw) * distance];
}
