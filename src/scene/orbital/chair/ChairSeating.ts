import { Group, MathUtils } from 'three';
import { SEAT_SWIVEL, chairFacing, chairFront, type ChairPose } from '../chairPose';
import { TRIPO_SPEED } from '../secondary/residentMode';

export type ChairPhase = 'APPROACH' | 'ALIGN' | 'TURN' | 'SIT_DOWN' | 'SEATED_IDLE' | 'STAND_UP' | 'EXIT';
export const OFFICE_CHAIR = { seatHeight: .37, seatWidth: .47, seatDepth: .44, rootAhead: .29, approachAhead: .76 };
export const SIT_TIME = 1.7;
type Point = [number, number];
const smooth = (t: number) => { t = MathUtils.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const difference = (a: number, b: number) => Math.atan2(Math.sin(b - a), Math.cos(b - a));

/** Owns the actor's ground transform only. The imported skeleton owns lowering/rising. */
export class ChairSeating {
  phase: ChairPhase | null = null;
  elapsed = 0;
  turnFrom = 0;
  turnAngle = 0;
  turnDuration = 1.6;
  turnProgress = 0;
  clipTime = 2.4;
  travel = 0;
  bound = false;
  private path: Point[] = [];
  private exitRequested = false;
  private onSeated?: () => void;
  private exitFace = false;
  private yaw = 0;
  private x = 0;
  private z = 0;

  begin(actor: Group, pose: ChairPose, path: Point[], onSeated: () => void) {
    if (this.phase) return false;
    this.path = path.map(p => [...p]);
    this.onSeated = onSeated;
    this.exitRequested = false;
    this.exitFace = false;
    this.bound = false;
    this.yaw = chairFacing(pose); this.x = pose.x; this.z = pose.z;
    pose.vx = pose.vz = pose.spin = pose.drop = 0;
    this.change('APPROACH');
    actor.userData.chairSeating = this;
    return true;
  }
  private change(phase: ChairPhase) { this.phase = phase; this.elapsed = 0; }
  requestExit() {
    if (!this.phase) return;
    if (this.phase === 'APPROACH') { this.phase = null; this.onSeated = undefined; }
    else if (this.phase === 'ALIGN') { this.exitFace = true; this.onSeated = undefined; this.change('EXIT'); }
    else if (this.phase === 'SEATED_IDLE') this.change('STAND_UP');
    else this.exitRequested = true;
  }
  get active() { return this.phase !== null; }
  get sitting() { return this.phase === 'SIT_DOWN' || this.phase === 'SEATED_IDLE' || this.phase === 'STAND_UP'; }

  update(actor: Group, pose: ChairPose, delta: number, canMove: (from: Point, to: Point) => boolean) {
    if (!this.phase) { delete actor.userData.chairSeating; return; }
    const dt = Math.min(Math.max(delta, 0), .05);
    this.elapsed += dt; this.travel = 0;
    pose.vx = pose.vz = pose.spin = pose.drop = 0;
    // Equivalent rigid binding in the chair's coordinates. No reparenting jump.
    if (this.bound) { this.x = pose.x; this.z = pose.z; this.yaw = chairFacing(pose); }
    const anchor: ChairPose = { ...pose, x: this.x, z: this.z, yaw: this.yaw - Math.PI - SEAT_SWIVEL };
    const rootPoint = chairFront(anchor, OFFICE_CHAIR.rootAhead);
    const move = (target: Point, speed: number, face = true) => {
      const from: Point = [actor.position.x, actor.position.z];
      const distance = Math.hypot(target[0] - from[0], target[1] - from[1]);
      const step = Math.min(distance, speed * dt), fraction = distance ? step / distance : 1;
      const next: Point = [MathUtils.lerp(from[0], target[0], fraction), MathUtils.lerp(from[1], target[1], fraction)];
      if (!canMove(from, next)) { this.phase = null; return false; }
      actor.position.set(next[0], 0, next[1]); this.travel = step;
      if (face && distance > .002) actor.rotation.y += difference(actor.rotation.y, Math.atan2(target[0] - from[0], target[1] - from[1])) * (1 - Math.exp(-dt * 12));
      return distance <= step + .00001;
    };
    if (this.phase === 'APPROACH') {
      const next = this.path[0];
      if (!next) this.change('ALIGN');
      else {
        const distance = Math.hypot(next[0] - actor.position.x, next[1] - actor.position.z);
        const speed = this.path.length === 1 ? Math.min(TRIPO_SPEED, .12 + distance * .8) : TRIPO_SPEED;
        if (move(next, speed)) this.path.shift();
      }
    } else if (this.phase === 'ALIGN') {
      const distance = Math.hypot(rootPoint[0] - actor.position.x, rootPoint[1] - actor.position.z);
      if (move(rootPoint, Math.min(.23, .08 + distance))) {
        this.turnFrom = actor.rotation.y; this.turnAngle = difference(this.turnFrom, this.yaw);
        this.turnDuration = Math.max(.65, Math.abs(this.turnAngle) / 1.65);
        this.turnProgress = 0; this.change('TURN');
      }
    } else if (this.phase === 'TURN') {
      this.turnProgress = Math.min(1, this.elapsed / this.turnDuration);
      actor.rotation.y = this.turnFrom + this.turnAngle * smooth(Math.min(1, this.turnProgress * 1.5));
      if (this.turnProgress === 1) { this.clipTime = 2.4; this.change('SIT_DOWN'); }
    } else if (this.phase === 'SIT_DOWN') {
      this.clipTime = 2.4 + Math.min(SIT_TIME, this.elapsed);
      if (this.elapsed >= SIT_TIME) {
        this.clipTime = 4.1; this.bound = true; this.change('SEATED_IDLE');
        if (!this.exitRequested) this.onSeated?.();
        this.onSeated = undefined;
      }
    } else if (this.phase === 'SEATED_IDLE') {
      this.clipTime = 4.1;
      if (this.exitRequested) this.change('STAND_UP');
    } else if (this.phase === 'STAND_UP') {
      this.clipTime = 5.8 + Math.min(SIT_TIME, this.elapsed);
      // Release after the pelvis has left the cushion, while retaining the same ground transform.
      if (this.elapsed > .65) this.bound = false;
      if (this.elapsed >= SIT_TIME) { this.clipTime = 7.5; this.change('EXIT'); }
    } else if (this.phase === 'EXIT') {
      if (move(chairFront(anchor, OFFICE_CHAIR.approachAhead), .25, this.exitFace)) this.phase = null;
    }
    if (this.bound) { actor.position.set(rootPoint[0], 0, rootPoint[1]); actor.rotation.y = this.yaw; }
    actor.userData.posture = this.phase === 'SEATED_IDLE' ? 'chair' : this.phase === 'STAND_UP' ? 'standing-up' : 'standing';
    actor.userData.grounded = true;
    if (!this.phase) delete actor.userData.chairSeating;
  }
}
