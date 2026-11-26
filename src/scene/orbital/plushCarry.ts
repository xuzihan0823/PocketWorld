import { Bone, Box3, Euler, MathUtils, Matrix4, Quaternion, Raycaster, SkinnedMesh, Vector3, type Intersection, type Object3D } from 'three';
import { BEDROOM_LEFT, CABIN_DIVIDER_X, PLUSH_FLOOR_BOUNDS, RESIDENT_RADIUS, deckFromAuthoredX } from './cabinLayout.ts';
import { dollOpen, plushFloorY, plushSupportHeight, type PlushBody, type PlushRect } from './plushMotion.ts';
import { placeLimbEnd } from './residentRig.ts';

export const plushLabels = { 'plush-bunny': '兔子', 'plush-bear': '小熊', 'plush-penguin': '企鹅' };
export function plushBounds(upper: boolean) {
  return upper ? { ...PLUSH_FLOOR_BOUNDS, left: BEDROOM_LEFT + .15, right: CABIN_DIVIDER_X - .05 }
    : { ...PLUSH_FLOOR_BOUNDS, left: CABIN_DIVIDER_X + .05 };
}
export function dropSpot(body: PlushBody, x: number, z: number, yaw: number, boxes: PlushRect[], dolls: PlushBody[]) {
  const bounds = plushBounds(deckFromAuthoredX(x) === 'upper');
  const distance = body.radius + RESIDENT_RADIUS + .055;
  for (const offset of [0, .35, -.35, .7, -.7, 1.05, -1.05, 1.57, -1.57, 2.3, -2.3, Math.PI]) {
    const facing = yaw + offset;
    const px = x + Math.sin(facing) * distance, pz = z + Math.cos(facing) * distance;
    if (dollOpen(px, pz, body.radius, boxes, bounds)
      && dolls.every(other => other === body || Math.hypot(px - other.x, pz - other.z) >= body.radius + other.radius + .02)) {
      return { x: px, z: pz, yaw: facing };
    }
  }
  return null;
}

// Raycast the untouched GLTF scene in its native units, using the renderer's pivot and scale.
export function createPlushShape(model: Object3D, height: number) {
  const bounds = new Box3().setFromObject(model);
  const half = bounds.getSize(new Vector3());
  const scale = height / half.y;
  half.multiplyScalar(scale / 2);
  return { half, model, origin: bounds.getCenter(new Vector3()), scale };
}
export type PlushShape = ReturnType<typeof createPlushShape>;

export function gripPlush(body: PlushBody, shape: PlushShape) {
  return { body, shape, floorX: body.x, floorZ: body.z, lift: 0, center: new Vector3(),
    rotation: new Euler(body.pitch, body.yaw, body.roll, 'YXZ'), visible: true };
}
export type PlushGrip = ReturnType<typeof gripPlush>;

/** Sample the inward surface of the palms and fingertips in the grip's rest pose. */
function bearHandSurface(mesh: Object3D, hand: Bone, along: Vector3, across: Vector3, inward: Vector3) {
  const cells = new Map<string, Vector3>();
  const point = new Vector3();
  mesh.traverse(part => {
    if (!(part instanceof SkinnedMesh)) return;
    const { skinIndex, skinWeight } = part.geometry.attributes;
    const handBones = part.skeleton.bones.map(bone => bone.name.startsWith(hand.name));
    for (let i = 0; i < skinIndex.count; i++) {
      let influence = 0;
      for (let j = 0; j < 4; j++) {
        if (handBones[skinIndex.getComponent(i, j)]) influence += skinWeight.getComponent(i, j);
      }
      if (influence < .70) continue;
      hand.worldToLocal(part.getVertexPosition(i, point).applyMatrix4(part.matrixWorld));
      const cell = Math.floor(point.dot(along) / .007) + ':' + Math.floor(point.dot(across) / .007);
      const previous = cells.get(cell);
      if (!previous || point.dot(inward) > previous.dot(inward)) cells.set(cell, point.clone());
    }
  });
  return Array.from(cells.values());
}

export function createPlushPose(mesh: Object3D) {
  mesh.parent?.updateWorldMatrix(true, false);
  mesh.updateMatrixWorld(true);
  const basis = new Matrix4(), cross = new Vector3();
  const arms = ['Right', 'Left'].map((name, i) => {
    const joints = ['Arm', 'ForeArm', 'Hand'].map(part => mesh.getObjectByName('mixamorig' + name + part) as Bone);
    const finger = (part: string) => mesh.getObjectByName('mixamorig' + name + 'Hand' + part)!;
    const knuckle = finger('Middle1').position;
    const along = knuckle.clone().normalize();
    const across = finger('Index1').position.clone().sub(finger('Pinky1').position).projectOnPlane(along).normalize();
    const localBasis = new Quaternion().setFromRotationMatrix(basis.makeBasis(along, across, cross.crossVectors(along, across))).invert();
    const hand = joints[2];
    const fingers: { joint: Bone; rotation: Quaternion }[] = [];
    hand.traverse(joint => {
      if (joint instanceof Bone && joint !== hand) fingers.push({ joint, rotation: joint.quaternion.clone() });
    });
    // Use the pad and knuckle of every finger, plus the palm heel, when fitting the hand.
    const pads = [knuckle.clone().multiplyScalar(.48), new Vector3(), ...fingers.map(({ joint }) =>
      hand.worldToLocal(joint.getWorldPosition(new Vector3())))];
    const side = i ? 1 : -1;
    const bearPads = bearHandSurface(mesh, hand, along, across, cross.clone().multiplyScalar(side));
    return { joints, knuckle, localBasis, pads, bearPads, fingers, side,
      grip: null as PlushGrip | null, lastLift: -1, lastCradle: -1, lastRotation: new Quaternion(), lateral: 0 };
  });
  const hips = mesh.getObjectByName('mixamorigHips')!, spine = mesh.getObjectByName('mixamorigSpine')!;
  const facing = new Quaternion(), relative = new Quaternion(), inverse = new Quaternion();
  const rotation = new Quaternion(), animated = new Quaternion();
  const floor = new Vector3(), offset = new Vector3(), goal = new Vector3(), wrist = new Vector3();
  const ray = new Raycaster(), hits: Intersection[] = [];
  const pad = new Vector3(), rayStart = new Vector3(), rayDirection = new Vector3();
  const normal = new Vector3(), along = new Vector3(), across = new Vector3(), scale = new Vector3();
  const outward = new Vector3(), contact = new Vector3();
  const animatedBend = new Vector3(), gripBend = new Vector3();
  return (root: Object3D, grip: PlushGrip, time: number, gripTime: number) => {
    const { body, shape } = grip, { half } = shape;
    const reach = MathUtils.smoothstep(time, gripTime - 1.25, gripTime - .35);
    const lift = MathUtils.smoothstep(time, gripTime, gripTime + 1.02);
    const turn = Math.atan2(Math.sin(root.rotation.y - body.yaw), Math.cos(root.rotation.y - body.yaw));
    const bear = body.id === 'plush-bear';
    const bearCradle = bear ? MathUtils.smoothstep(time, gripTime + .88, gripTime + 1.36) : 0;
    grip.rotation.set(body.pitch * (1 - lift) - .15 * bearCradle, body.yaw + turn * lift, body.roll * (1 - lift), 'YXZ');
    grip.lift = lift;
    root.getWorldQuaternion(facing);
    hips.getWorldPosition(grip.center).add(offset.set(0, half.y * .78 + .012 * bearCradle, half.z + .112 - .009 * bearCradle).applyQuaternion(facing));
    if (lift < 1) {
      floor.set(grip.floorX, plushFloorY(grip.floorX, grip.floorZ) + body.y
        + plushSupportHeight(body.roll, body.pitch, half.x, half.y, half.z), grip.floorZ);
      root.parent!.localToWorld(floor);
      grip.center.lerpVectors(floor, grip.center, lift);
      // Arc out in front of the bent head, then settle back into the walking cradle.
      const arc = bear ? .49 : .22;
      grip.center.add(offset.set(0, 0, arc * lift * (1 - lift)).applyQuaternion(facing));
    }
    if (!reach) return;
    // Unbend the spine above the keyed pelvis so the face clears the toy and both feet keep
    // their original floor contact. Rotate around the carrier's right axis in spine-parent space.
    if (lift < 1) {
      spine.parent!.getWorldQuaternion(inverse).invert();
      offset.set(1, 0, 0).applyQuaternion(facing).applyQuaternion(inverse);
      spine.quaternion.premultiply(rotation.setFromAxisAngle(offset, -.39 * reach * (1 - lift)));
    }
    // Compare the toy and hands in the carrier frame so turning preserves the contact fit.
    relative.setFromEuler(grip.rotation).premultiply(inverse.setFromAxisAngle(offset.set(0, 1, 0), -root.rotation.y));
    inverse.copy(relative).invert();
    for (const arm of arms) {
      const { joints, side } = arm;
      for (const { joint, rotation: rest } of arm.fingers) joint.quaternion.slerp(rest, reach);
      // Fingers approach pointing down, then turn forwards around the sides as Luna rises.
      normal.set(side, .16 - .20 * lift + .11 * bearCradle, -.48 + .66 * lift + .10 * bearCradle).normalize();
      along.set(0, -1 + .70 * lift + .08 * bearCradle, .15 + .85 * lift).projectOnPlane(normal).normalize();
      across.crossVectors(along, normal).multiplyScalar(side);
      rotation.setFromRotationMatrix(basis.makeBasis(along, across, cross.crossVectors(along, across)))
        .multiply(arm.localBasis);
      // Wrap the bear's rounded forelegs instead of aiming behind the torso.
      outward.set(side, .07 * bearCradle, .28 * bearCradle).normalize();
      contact.set(0, half.y * (.46 - .64 * lift - .09 * bearCradle), half.z * (-.56 + .33 * lift - .20 * bearCradle));
      joints[2].getWorldScale(scale);
      if (arm.grip !== grip || Math.abs(lift - arm.lastLift) > .001 || Math.abs(bearCradle - arm.lastCradle) > .001
        || arm.lastRotation.angleTo(relative) > .004) {
        // Slide the hand in from outside until the first pad touches any part, including wings.
        // The rigid cradle reuses its fit while walking, turning or changing decks.
        const outside = half.length() + .2;
        rayDirection.copy(outward).negate().applyQuaternion(inverse);
        let lateral = 0;
        const surface = bear && arm.bearPads.length > 0;
        const pads = surface ? arm.bearPads : arm.pads;
        for (const [i, point] of pads.entries()) {
          pad.copy(point).sub(arm.knuckle).multiply(scale).applyQuaternion(rotation);
          rayStart.copy(contact).add(pad).addScaledVector(outward, outside)
            .applyQuaternion(inverse).divideScalar(shape.scale).add(shape.origin);
          ray.set(rayStart, rayDirection);
          hits.length = 0;
          ray.intersectObject(shape.model, true, hits);
          if (hits.length) lateral = Math.max(lateral, outside - hits[0].distance * shape.scale
            + (surface ? .004 : i < 2 ? .014 : .006));
        }
        arm.lateral = lateral || half.x;
        arm.grip = grip;
        arm.lastLift = lift;
        arm.lastCradle = bearCradle;
        arm.lastRotation.copy(relative);
      }
      goal.copy(contact).addScaledVector(outward, arm.lateral)
        .sub(offset.copy(arm.knuckle).multiply(scale).applyQuaternion(rotation))
        .applyQuaternion(facing).add(grip.center);
      rotation.premultiply(facing);
      joints[2].getWorldPosition(wrist).lerp(goal, reach);
      joints[2].getWorldQuaternion(animated).slerp(rotation, reach);
      // Blend the elbow guide along with the wrist so an almost-zero grip weight keeps the keyed pose.
      joints[1].getWorldPosition(animatedBend).sub(joints[0].getWorldPosition(offset)).normalize();
      gripBend.set(side, -.55, -.45).normalize().applyQuaternion(facing);
      const approach = 1 - MathUtils.smoothstep(time, gripTime - .28, gripTime);
      const softReach = (.010 + .012 * approach) * MathUtils.smoothstep(reach, 0, .30);
      placeLimbEnd(joints, wrist, animated, animatedBend.lerp(gripBend, reach), softReach);
    }
  };
}
