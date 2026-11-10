import { Bone, Group, MathUtils, Object3D, Quaternion, SkinnedMesh, Vector3 } from 'three';
import type { ChairSeating } from './ChairSeating';

const smooth = (t: number) => { t = MathUtils.clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const Y = new Vector3(0, 1, 0);

/** Two-bone IK preserves all segment lengths and uses the character's forward knee plane. */
export function plantLeg(thigh: Bone, shin: Bone, foot: Bone, target: Vector3, orientation: Quaternion, forward: Vector3) {
  const hip = thigh.getWorldPosition(new Vector3()), knee = shin.getWorldPosition(new Vector3()), ankle = foot.getWorldPosition(new Vector3());
  const upper = hip.distanceTo(knee), lower = knee.distanceTo(ankle), axis = target.clone().sub(hip);
  const distance = MathUtils.clamp(axis.length(), Math.abs(upper - lower) + 1e-7, upper + lower - 1e-7);
  axis.normalize();
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const pole = forward.clone().addScaledVector(axis, -forward.dot(axis)).normalize();
  const goal = hip.clone().addScaledVector(axis, along).addScaledVector(pole, Math.sqrt(Math.max(0, upper * upper - along * along)));
  const rotate = (bone: Bone, from: Vector3, to: Vector3) => {
    const world = bone.getWorldQuaternion(new Quaternion());
    const change = new Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
    bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert()).multiply(change).multiply(world);
    bone.updateWorldMatrix(false, true);
  };
  rotate(thigh, knee.sub(hip), goal.sub(hip));
  const nextKnee = shin.getWorldPosition(new Vector3());
  rotate(shin, foot.getWorldPosition(new Vector3()).sub(nextKnee), target.clone().sub(nextKnee));
  foot.quaternion.copy(foot.parent!.getWorldQuaternion(new Quaternion()).invert()).multiply(orientation);
  foot.updateWorldMatrix(false, true);
}

export class TurnFootPlant {
  private legs: { thigh: Bone; shin: Bone; foot: Bone; offset: Vector3; rotation: Quaternion; anchor: Vector3; orientation: Quaternion; from: Vector3; fromQ: Quaternion }[];
  private step = -1;
  private active = false;
  private hips: Bone;
  private mesh!: SkinnedMesh;
  private soles: number[][] = [[], []];
  constructor(asset: Object3D, private actor: Group) {
    const bones = new Map<string, Bone>();
    asset.traverse(o => { if ((o as Bone).isBone) bones.set(o.name.replace(/[^\w]/g, ''), o as Bone); });
    asset.traverse(o => { if ((o as SkinnedMesh).isSkinnedMesh) this.mesh = o as SkinnedMesh; });
    const bone = (name: string) => bones.get('mixamorig' + name)!;
    this.hips = bone('Hips');
    actor.updateWorldMatrix(true, true);
    const inverse = actor.getWorldQuaternion(new Quaternion()).invert();
    this.legs = ['Left', 'Right'].map(side => {
      const foot = bone(side + 'Foot'), p = foot.getWorldPosition(new Vector3()), q = foot.getWorldQuaternion(new Quaternion());
      return { thigh: bone(side + 'UpLeg'), shin: bone(side + 'Leg'), foot, offset: actor.worldToLocal(p.clone()), rotation: inverse.clone().multiply(q), anchor: p.clone(), orientation: q.clone(), from: p.clone(), fromQ: q.clone() };
    });
    const attributes = this.mesh.geometry.attributes;
    for (let i = 0; i < attributes.position.count; i++) {
      if (attributes.position.getY(i) > .009) continue;
      for (const [side, name] of ['Left', 'Right'].entries()) {
        let weight = 0;
        for (let c = 0; c < 4; c++) {
          const boneName = this.mesh.skeleton.bones[attributes.skinIndex.getComponent(i, c)].name;
          if (boneName.includes(name + 'Foot') || boneName.includes(name + 'Toe')) weight += attributes.skinWeight.getComponent(i, c);
        }
        if (weight > .5) this.soles[side].push(i);
      }
    }
  }
  /** Crossfading rotations can dip the skin below the floor even with valid endpoint clips.
   * Correct only fades/turns; the accepted full-weight Walk remains untouched.
   */
  keepSolesAboveFloor() {
    this.actor.updateWorldMatrix(true, true);
    const floor = this.actor.parent!.getWorldPosition(new Vector3()).y;
    const forward = new Vector3(0, 0, 1).applyQuaternion(this.actor.getWorldQuaternion(new Quaternion()));
    const point = new Vector3();
    this.legs.forEach((leg, side) => {
      for (let pass = 0; pass < 2; pass++) {
        let minimum = Infinity;
        for (const index of this.soles[side]) minimum = Math.min(minimum, this.mesh.getVertexPosition(index, point).applyMatrix4(this.mesh.matrixWorld).y);
        if (minimum >= floor - .0001) break;
        const target = leg.foot.getWorldPosition(new Vector3()); target.y += floor - minimum + .00005;
        plantLeg(leg.thigh, leg.shin, leg.foot, target, leg.foot.getWorldQuaternion(new Quaternion()), forward);
      }
    });
  }
  apply(seating?: ChairSeating) {
    if (seating?.phase !== 'TURN') { this.active = false; this.step = -1; return; }
    const actor = this.actor;
    actor.updateWorldMatrix(true, true);
    if (!this.active) {
      for (const leg of this.legs) { leg.foot.getWorldPosition(leg.anchor); leg.foot.getWorldQuaternion(leg.orientation); }
      this.active = true;
    }
    const progress = seating.turnProgress * 6, step = Math.min(5, Math.floor(progress)), u = Math.min(1, progress - step);
    // A small knee bend gives the support leg room to turn without stretching it.
    const lower = .028 * smooth(seating.turnProgress / .12) * (1 - smooth((seating.turnProgress - .86) / .14));
    const pelvis = this.hips.getWorldPosition(new Vector3()); pelvis.y -= lower;
    this.hips.position.copy(this.hips.parent!.worldToLocal(pelvis));
    this.hips.updateWorldMatrix(false, true);
    if (step !== this.step) {
      if (this.step >= 0) {
        const previous = this.legs[this.step % 2];
        const yaw = seating.turnFrom + seating.turnAngle * smooth(Math.min(1, (this.step + 1) / 4));
        const q = actor.parent!.getWorldQuaternion(new Quaternion()).multiply(new Quaternion().setFromAxisAngle(Y, yaw));
        previous.anchor.copy(previous.offset).applyQuaternion(q).add(actor.getWorldPosition(new Vector3()));
        previous.orientation.copy(q).multiply(previous.rotation);
      }
      for (const leg of this.legs) { leg.from.copy(leg.anchor); leg.fromQ.copy(leg.orientation); }
      this.step = step;
    }
    // Four alternating turn steps, then two settling steps at the final orientation.
    const targetYaw = seating.turnFrom + seating.turnAngle * smooth(Math.min(1, (step + 1) / 4));
    const parentQ = actor.parent!.getWorldQuaternion(new Quaternion());
    const goalQ = parentQ.clone().multiply(new Quaternion().setFromAxisAngle(Y, targetYaw));
    const leg = this.legs[step % 2];
    const goal = leg.offset.clone().applyQuaternion(goalQ).add(actor.getWorldPosition(new Vector3()));
    leg.anchor.copy(leg.from).lerp(goal, smooth(u));
    leg.anchor.y += Math.sin(u * Math.PI) ** 2 * .035;
    leg.orientation.copy(leg.fromQ).slerp(goalQ.clone().multiply(leg.rotation), smooth(u));
    const forward = new Vector3(0, 0, 1).applyQuaternion(actor.getWorldQuaternion(new Quaternion()));
    for (const item of this.legs) plantLeg(item.thigh, item.shin, item.foot, item.anchor, item.orientation, forward);
  }
}
