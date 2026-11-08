export type BedPoint = [number, number];
export interface BedClimbPose { x: number; z: number; y: number; yaw: number; sit: number; lie: number; bend: number; legLift: number }

/** Hip position while lying; the climb ends here and getting up plays the same timeline backwards. */
export const BED_LIE: BedPoint = [-2.6, 0.94];
const EDGE_INSET = 0.58, SIT_HIP = 0.88, LIE_HIP = 0.929, HOP = 0.06, LEG_LIFT = 0.25, LEAN = 0.12;
/** Walking pace stays readable: turn, hop onto the edge, lift and swing both legs aboard, scoot in, lie back. */
export const BED_CLIMB_SECONDS = 3, BED_CLIMB_REDUCED_SECONDS = 1;
export const BED_TURNED = 0.18;

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const ease = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const turnTo = (from: number, to: number, t: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * t;
const stage = (u: number, from: number, to: number) => ease(clamp((u - from) / (to - from), 0, 1));

/** The yaw that puts the resident's back to the mattress when standing at `entry`. */
export const bedOutwardYaw = (entry: BedPoint) => (Math.sign(entry[0] - BED_LIE[0]) || 1) * Math.PI / 2;

export function bedClimbPose(progress: number, entry: BedPoint, startYaw: number, hipHeight: number): BedClimbPose {
  const u = clamp(progress, 0, 1);
  const outward = bedOutwardYaw(entry);
  const turn = stage(u, 0, BED_TURNED), sitDown = stage(u, 0.14, 0.32), lift = stage(u, 0.3, 0.46);
  const swing = stage(u, 0.4, 0.64), lower = stage(u, 0.58, 0.7), scoot = stage(u, 0.36, 0.8), recline = stage(u, 0.76, 1);
  const edgeX = BED_LIE[0] + Math.sign(outward) * EDGE_INSET;
  const raised = lift - lower;
  return {
    x: lerp(lerp(entry[0], edgeX, sitDown), BED_LIE[0], scoot),
    z: lerp(entry[1], BED_LIE[1], sitDown),
    y: lerp(SIT_HIP * sitDown + Math.sin(sitDown * Math.PI) * HOP, LIE_HIP, recline) - hipHeight * sitDown,
    // Legs swing toward the foot of the bed, so the resident ends up facing it before lying back.
    yaw: swing > 0 ? turnTo(outward, 0, swing) : turnTo(startYaw, outward, turn),
    sit: sitDown * (1 - recline),
    lie: recline + raised * LEAN,
    bend: 1 - lift,
    legLift: raised * LEG_LIFT,
  };
}
