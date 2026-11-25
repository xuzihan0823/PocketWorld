import { Bone, MathUtils, Matrix4, Quaternion, Vector3, type Object3D } from 'three';
import { PICKUP_GRIP_TIME } from '../cabinActions.ts';
import { placeLimbEnd } from '../residentRig.ts';

export function createPaperPose(mesh: Object3D) {
  const arm = ['Arm', 'ForeArm', 'Hand'].map(part => mesh.getObjectByName('mixamorigRight' + part) as Bone);
  const hand = arm[2];
  const knuckle = (finger: string) => mesh.getObjectByName('mixamorigRightHand' + finger + '1')!.position;
  const middle = knuckle('Middle');
  const along = middle.clone().normalize();
  const across = knuckle('Index').clone().sub(knuckle('Pinky')).projectOnPlane(along).normalize();
  const basis = new Matrix4(), third = new Vector3();
  const local = new Quaternion().setFromRotationMatrix(basis.makeBasis(along, across, third.crossVectors(along, across))).invert();
  const pads: Bone[] = [];
  hand.traverse(joint => { if (joint instanceof Bone) pads.push(joint); });
  const rotation = new Quaternion(), keyed = new Quaternion(), wrist = new Vector3(), offset = new Vector3();
  const normal = new Vector3(), pad = new Vector3(), scale = new Vector3(), goal = new Vector3();
  return (floor: Vector3, time: number, center: Vector3) => {
    const reach = MathUtils.smoothstep(time, .65, PICKUP_GRIP_TIME - .36);
    center.copy(floor);
    if (!reach) return;
    hand.getWorldQuaternion(keyed);
    hand.getWorldPosition(wrist);
    hand.getWorldScale(scale);
    const lift = MathUtils.smoothstep(time, PICKUP_GRIP_TIME, PICKUP_GRIP_TIME + .70);
    // Approach palm down. As the forearm rises, roll back into the authored carrying pose.
    along.set(0, -.32, 1).normalize().applyQuaternion(mesh.parent!.getWorldQuaternion(rotation));
    across.set(1, 0, 0).applyQuaternion(rotation);
    rotation.setFromRotationMatrix(basis.makeBasis(along, across, third.crossVectors(along, across))).multiply(local).slerp(keyed, lift);
    normal.crossVectors(across.copy(knuckle('Index')).sub(knuckle('Pinky')), middle).normalize().applyQuaternion(rotation);
    offset.copy(middle).multiply(scale).applyQuaternion(rotation);
    // Fit the ball against the curled finger pads and palm, accounting for the current grip.
    let depth = 0;
    for (const joint of pads) {
      hand.worldToLocal(joint.getWorldPosition(pad)).multiply(scale).applyQuaternion(rotation).sub(offset);
      const height = pad.dot(normal);
      const radius = .086 + (joint === hand || joint.name.endsWith('1') ? .016 : .007);
      const inside = radius * radius - (pad.lengthSq() - height * height);
      if (inside > 0) depth = Math.max(depth, height + Math.sqrt(inside));
    }
    offset.addScaledVector(normal, depth);
    center.lerp(goal.copy(wrist).add(offset), lift);
    center.y = Math.max(floor.y, center.y);
    wrist.lerp(goal.copy(center).sub(offset), reach);
    wrist.y += .065 * (1 - MathUtils.smoothstep(time, PICKUP_GRIP_TIME - .42, PICKUP_GRIP_TIME)) * reach;
    placeLimbEnd(arm, wrist, keyed.slerp(rotation, reach));
    if (time > PICKUP_GRIP_TIME) center.copy(hand.getWorldPosition(goal)).add(offset);
  };
}
