import { Bone, Matrix4, Object3D, Quaternion, Vector3 } from 'three';

export interface SecondaryOptions { hair: boolean; dress: boolean; collisions: boolean }
type Part = 'hair' | 'dress';
interface Joint {
  bone: Bone; part: Part; base: Quaternion; tailLocal: Vector3; tail: Vector3;
  velocity: Vector3; previous: Vector3; limit: number; radius: number;
  contactAllowance: number;
}
export interface BodyCapsule {
  name: string; bone: Bone; localA: Vector3; localB: Vector3;
  a: Vector3; b: Vector3; radius: number; parts: Part[];
}

const STEP = 1 / 120;
const key = (name: string) => name.replace(/[^\w]/g, '');
const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));

export class SecondaryMotion {
  readonly options: SecondaryOptions = { hair: true, dress: true, collisions: true };
  readonly capsules: BodyCapsule[] = [];
  readonly joints: Joint[] = [];
  readonly fixedStep = STEP;
  private rotationAllowance = { hair: 1, dress: 1 };
  steps = 0;
  resets = 0;
  private accumulator = 0;
  private initialized = false;
  private scale = 1;
  private lastAnchor = new Vector3();
  private anchor: Bone;
  private origin = new Vector3();
  private target = new Vector3();
  private direction = new Vector3();
  private baseDirection = new Vector3();
  private old = new Vector3();
  private sample = new Vector3();
  private segment = new Vector3();
  private closest = new Vector3();
  private normal = new Vector3();
  private parentRotation = new Quaternion();
  private worldRotation = new Quaternion();
  private swing = new Quaternion();
  private identity = new Quaternion();
  private inverse = new Matrix4();

  constructor(readonly root: Object3D) {
    root.updateWorldMatrix(true, true);
    const bones = new Map<string, Bone>();
    root.traverse(object => { if ((object as Bone).isBone) bones.set(key(object.name), object as Bone); });
    const get = (name: string) => {
      const bone = bones.get(key(name));
      if (!bone) throw new Error(`缺少角色骨骼：${name}`);
      return bone;
    };
    this.anchor = get('mixamorig:Hips');
    const head = get('mixamorig:Head');
    this.scale = head.getWorldPosition(this.target).distanceTo(this.anchor.getWorldPosition(this.origin)) / .281;
    for (const bone of bones.values()) {
      const part = bone.name.startsWith('Hair_') ? 'hair' : bone.name.startsWith('Dress_') ? 'dress' : null;
      if (!part) continue;
      const child = bone.children.find(child => (child as Bone).isBone) as Bone | undefined;
      const length = Number(bone.userData.secondary_length) || child?.position.length() || bone.position.length() * .94;
      const tailLocal = child ? child.position.clone() : new Vector3(0, length, 0);
      const depth = Number(bone.name.slice(-2));
      this.joints.push({ bone, part, base: bone.quaternion.clone(), tailLocal, tail: new Vector3(),
        previous: new Vector3(), velocity: new Vector3(),
        limit: (part === 'hair' ? (depth === 1 ? 18 : 28) : (depth === 1 ? 10 : 16)) * Math.PI / 180,
        radius: (part === 'hair' ? .009 : .008) * this.scale, contactAllowance: 1 });
    }
    if (this.joints.length !== 50) throw new Error(`需要 50 根裙发骨骼，实际为 ${this.joints.length}`);
    this.joints.sort((a, b) => this.depth(a.bone) - this.depth(b.bone));
    const add = (name: string, bone: Bone, a: Vector3, b: Vector3, radius: number, parts: Part[]) => {
      this.inverse.copy(bone.matrixWorld).invert();
      this.capsules.push({ name, bone, localA: a.clone().applyMatrix4(this.inverse),
        localB: b.clone().applyMatrix4(this.inverse), a: a.clone(), b: b.clone(),
        radius: radius * this.scale, parts });
    };
    const world = (bone: Bone) => bone.getWorldPosition(new Vector3());
    const spine = get('mixamorig:Spine'), chest = get('mixamorig:Spine2');
    const up = world(head).sub(world(this.anchor)).normalize();
    const left = world(get('mixamorig:LeftUpLeg')).sub(world(get('mixamorig:RightUpLeg'))).normalize();
    const forward = left.clone().cross(up).normalize();
    add('头部', head, world(head).addScaledVector(up, .025 * this.scale),
      world(head).addScaledVector(up, .075 * this.scale), .060, ['hair']);
    add('上躯干', chest, world(chest).addScaledVector(forward, -.015 * this.scale),
      world(chest).addScaledVector(up, .055 * this.scale).addScaledVector(forward, -.015 * this.scale), .052, ['hair']);
    add('下躯干', spine, world(spine).addScaledVector(forward, -.025 * this.scale),
      world(chest).addScaledVector(forward, -.025 * this.scale), .050, ['hair', 'dress']);
    add('骨盆', this.anchor, world(this.anchor).addScaledVector(left, -.032 * this.scale).addScaledVector(forward, -.025 * this.scale),
      world(this.anchor).addScaledVector(left, .032 * this.scale).addScaledVector(forward, -.025 * this.scale), .045, ['hair', 'dress']);
    for (const side of ['Left', 'Right']) {
      const arm = get(`mixamorig:${side}Arm`), forearm = get(`mixamorig:${side}ForeArm`);
      add(`${side}肩部`, arm, world(arm), world(arm).lerp(world(forearm), .38), .029, ['hair']);
      const thigh = get(`mixamorig:${side}UpLeg`), knee = get(`mixamorig:${side}Leg`);
      add(`${side}大腿`, thigh, world(thigh).lerp(world(knee), .15), world(knee), .039, ['dress']);
    }
  }

  private depth(object: Object3D) {
    let depth = 0;
    while (object.parent) { depth++; object = object.parent; }
    return depth;
  }

  configure(options: Partial<SecondaryOptions>) {
    if (Object.entries(options).some(([name, value]) => this.options[name as keyof SecondaryOptions] !== value)) {
      this.reset();
      Object.assign(this.options, options);
    }
  }

  // Contact clips can limit swing while a surface supports the fabric or hair.
  // Set it during base animation sampling so the solver keeps its existing history.
  setRotationAllowance(hair: number, dress: number) {
    this.rotationAllowance.hair = clamp(hair, 0, 1);
    this.rotationAllowance.dress = clamp(dress, 0, 1);
  }

  /** Limit only supported chains; free hems/fringe keep their inertia and solver history. */
  setChainAllowance(prefix: string, allowance: number) {
    for (const joint of this.joints) if (joint.bone.name.startsWith(prefix)) joint.contactAllowance = clamp(allowance, 0, 1);
  }

  // The mixer must run between restoring and capturing the base pose, including unkeyed bones.
  restoreBase() {
    for (const joint of this.joints) joint.bone.quaternion.copy(joint.base);
  }

  captureBasePose() {
    for (const joint of this.joints) joint.base.copy(joint.bone.quaternion);
  }

  reset() {
    this.restoreBase();
    this.initialized = false;
    this.accumulator = 0;
    for (const joint of this.joints) joint.velocity.set(0, 0, 0);
    this.resets++;
  }

  advance(delta: number, animateBase: (delta: number) => void) {
    if (!Number.isFinite(delta) || delta < 0) return;
    if (delta > .1) { this.reset(); delta = 0; }
    this.accumulator += delta;
    let count = 0;
    while (this.accumulator + 1e-10 >= STEP && count < 12) {
      this.restoreBase();
      animateBase(STEP);
      this.captureBasePose();
      this.root.updateWorldMatrix(true, true);
      this.simulate();
      this.accumulator = Math.max(0, this.accumulator - STEP);
      this.steps++;
      count++;
    }
    return count;
  }

  private constrain(joint: Joint, length: number) {
    this.direction.copy(joint.tail).sub(this.origin).normalize();
    if (this.direction.lengthSq() < .5) this.direction.copy(this.baseDirection);
    const angle = Math.acos(clamp(this.direction.dot(this.baseDirection), -1, 1));
    const limit = joint.limit * this.rotationAllowance[joint.part] * joint.contactAllowance;
    if (angle > limit) {
      this.swing.setFromUnitVectors(this.baseDirection, this.direction);
      this.swing.slerp(this.identity, 1 - limit / angle);
      this.direction.copy(this.baseDirection).applyQuaternion(this.swing);
    }
    joint.tail.copy(this.origin).addScaledVector(this.direction, length);
  }

  private penetration(point: Vector3, capsule: BodyCapsule, radius: number) {
    this.segment.copy(capsule.b).sub(capsule.a);
    const t = clamp(this.closest.copy(point).sub(capsule.a).dot(this.segment) / Math.max(1e-12, this.segment.lengthSq()), 0, 1);
    this.closest.copy(capsule.a).addScaledVector(this.segment, t);
    this.normal.copy(point).sub(this.closest);
    const distance = this.normal.length();
    if (distance > 1e-8) this.normal.multiplyScalar(1 / distance);
    else this.normal.copy(this.baseDirection).cross(this.segment).normalize();
    if (this.normal.lengthSq() < .5) this.normal.set(0, 0, 1);
    return capsule.radius + radius - distance;
  }

  private simulate() {
    this.anchor.getWorldPosition(this.target);
    if (this.initialized && this.target.distanceTo(this.lastAnchor) > .30 * this.scale) {
      this.initialized = false;
      this.resets++;
    }
    this.lastAnchor.copy(this.target);
    for (const capsule of this.capsules) {
      capsule.a.copy(capsule.localA).applyMatrix4(capsule.bone.matrixWorld);
      capsule.b.copy(capsule.localB).applyMatrix4(capsule.bone.matrixWorld);
    }
    for (const joint of this.joints) {
      joint.bone.updateWorldMatrix(true, false);
      this.origin.setFromMatrixPosition(joint.bone.matrixWorld);
      this.target.copy(joint.tailLocal).applyMatrix4(joint.bone.matrixWorld);
      const length = this.target.distanceTo(this.origin);
      this.baseDirection.copy(this.target).sub(this.origin).normalize();
      if (!this.initialized) { joint.tail.copy(this.target); joint.velocity.set(0, 0, 0); }
      joint.previous.copy(joint.tail);
      if (!this.options[joint.part] && !this.options.collisions) {
        joint.tail.copy(this.target); joint.velocity.set(0, 0, 0);
        continue;
      }
      if (this.options[joint.part]) {
        const stiffness = joint.part === 'hair' ? 150 : 240;
        const damping = joint.part === 'hair' ? 15 : 22;
        joint.velocity.addScaledVector(this.old.copy(this.target).sub(joint.tail), stiffness * STEP);
        joint.velocity.multiplyScalar(Math.exp(-damping * STEP));
        joint.tail.addScaledVector(joint.velocity, STEP);
      } else { joint.tail.copy(this.target); joint.velocity.set(0, 0, 0); }
      this.constrain(joint, length);
      if (this.options.collisions) {
        for (let iteration = 0; iteration < 4; iteration++) {
          for (const fraction of [.5, 1]) {
            for (const capsule of this.capsules) {
              if (!capsule.parts.includes(joint.part)) continue;
              this.sample.copy(this.origin).lerp(joint.tail, fraction);
              const overlap = this.penetration(this.sample, capsule, joint.radius);
              if (overlap > 0) {
                joint.tail.addScaledVector(this.normal, overlap / fraction);
                this.constrain(joint, length);
              }
            }
          }
        }
      }
      joint.velocity.copy(joint.tail).sub(joint.previous).multiplyScalar(1 / STEP);
      if (joint.velocity.length() > 3 * this.scale) joint.velocity.setLength(3 * this.scale);
      this.direction.copy(joint.tail).sub(this.origin).normalize();
      this.swing.setFromUnitVectors(this.baseDirection, this.direction);
      joint.bone.getWorldQuaternion(this.worldRotation);
      joint.bone.parent!.getWorldQuaternion(this.parentRotation).invert();
      joint.bone.quaternion.copy(this.parentRotation).multiply(this.swing).multiply(this.worldRotation).normalize();
      joint.bone.updateMatrixWorld(true);
    }
    this.initialized = true;
  }

  snapshot() {
    let maxAngle = 0, maxSpeed = 0, penetration = 0;
    let contactBone = '', contactBody = '';
    for (const joint of this.joints) {
      maxAngle = Math.max(maxAngle, joint.base.angleTo(joint.bone.quaternion));
      maxSpeed = Math.max(maxSpeed, joint.velocity.length());
      joint.bone.getWorldPosition(this.origin);
      for (const fraction of [.5, 1]) for (const capsule of this.capsules) {
        if (!capsule.parts.includes(joint.part)) continue;
        this.sample.copy(this.origin).lerp(joint.tail, fraction);
        const overlap = this.penetration(this.sample, capsule, joint.radius);
        if (overlap > penetration) { penetration = overlap; contactBone = joint.bone.name; contactBody = capsule.name; }
      }
    }
    return { steps: this.steps, resets: this.resets, maxAngle, maxSpeed, penetration, contactBone, contactBody,
      tails: this.joints.map(joint => joint.tail.toArray()),
      rotations: this.joints.map(joint => joint.bone.quaternion.toArray()) };
  }

  dispose() { this.reset(); }
}
