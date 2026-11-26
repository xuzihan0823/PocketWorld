import { MathUtils, Matrix4, Quaternion, Vector3, type Bone, type Object3D, type SkinnedMesh } from 'three';

/** Fit the hand-to-mouth gesture and stretch to Luna's actual arm lengths. */
export function createYawnPose(root: Object3D) {
  const bone = (name: string) => root.getObjectByName('mixamorig' + name) as Bone;
  const skeleton = (root.getObjectByProperty('isSkinnedMesh', true) as SkinnedMesh).skeleton;
  const head = bone('Head');
  const basis = new Matrix4(), across = new Vector3();
  function frame(direction: Vector3, hinge: Vector3, rotation: Quaternion) {
    return rotation.setFromRotationMatrix(basis.makeBasis(direction, hinge, across.crossVectors(direction, hinge)));
  }
  function bindRotation(joint: Bone) {
    return new Quaternion().setFromRotationMatrix(basis.extractRotation(skeleton.boneInverses[skeleton.bones.indexOf(joint)]));
  }
  function inverseFrame(joint: Bone, child: Bone) {
    const direction = child.position.clone().normalize();
    const forward = new Vector3(0, 0, 1).applyQuaternion(bindRotation(joint));
    const hinge = new Vector3().crossVectors(direction, forward).normalize();
    return frame(direction, hinge, new Quaternion()).invert();
  }
  const arms = (['Left', 'Right'] as const).map(side => {
    const upper = bone(side + 'Arm'), forearm = bone(side + 'ForeArm'), hand = bone(side + 'Hand');
    const fingers = bone(side + 'HandMiddle1').position.clone().normalize();
    const palm = fingers.clone().cross(bone(side + 'HandIndex1').position.clone().sub(bone(side + 'HandPinky1').position))
      .normalize().multiplyScalar(side === 'Left' ? 1 : -1);
    const bindHand = bindRotation(forearm).multiply(bindRotation(hand).invert());
    const straightWrist = new Quaternion().setFromUnitVectors(fingers.clone().applyQuaternion(bindHand), hand.position.clone().normalize())
      .multiply(bindHand);
    return { upper, forearm, hand, palm, straightWrist, left: side === 'Left',
      upperFrame: inverseFrame(upper, forearm), lowerFrame: inverseFrame(forearm, hand) };
  });

  const room = new Quaternion(), upperWorld = new Quaternion(), lowerWorld = new Quaternion();
  const local = new Quaternion(), handWorld = new Quaternion();
  const shoulder = new Vector3(), wrist = new Vector3(), mouth = new Vector3();
  const line = new Vector3(), pole = new Vector3(), hinge = new Vector3();
  const upperDirection = new Vector3(), lowerDirection = new Vector3(), scale = new Vector3();
  const facingPalm = new Vector3(), currentPalm = new Vector3(), forward = new Vector3();
  const smooth = MathUtils.smoothstep;

  return (time: number, weight: number) => {
    root.getWorldQuaternion(room);
    head.getWorldPosition(mouth).add(wrist.set(.086, -.083, .142).applyQuaternion(room));
    for (const arm of arms) {
      const { upper, forearm, hand, palm, straightWrist, left, upperFrame, lowerFrame } = arm;
      const outward = left ? 1 : -1;
      const opened = smooth(time, 5.52, 6.48);
      const cover = left ? smooth(time, 2.33, 3.55) * (1 - opened) : 0;
      const stretch = (left ? opened : smooth(time, 3.12, 4.85)) * (1 - smooth(time, 6.82, 8.05));
      const reach = Math.min(1, cover + stretch);
      if (reach === 0) continue;
      const blend = reach * weight;
      upper.getWorldPosition(shoulder);
      wrist.set(outward * .212, left ? .209 : .234, .059).applyQuaternion(room).add(shoulder);
      wrist.lerp(mouth, cover / reach);
      // Move clear of the shoulder as the covering hand opens into the stretch.
      wrist.addScaledVector(forward.set(0, 0, 1).applyQuaternion(room), .30 * cover * stretch);
      upper.getWorldScale(scale);
      const upperLength = forearm.position.length() * scale.x;
      forearm.getWorldScale(scale);
      const lowerLength = hand.position.length() * scale.x;
      line.subVectors(wrist, shoulder);
      const minReach = Math.sqrt(upperLength ** 2 + lowerLength ** 2 + 2 * upperLength * lowerLength * Math.cos(2.17));
      const distance = MathUtils.clamp(line.length(), minReach, (upperLength + lowerLength) * .96);
      line.normalize();
      pole.set(outward * .77, -.95, -.38).applyQuaternion(room).projectOnPlane(line).normalize();
      const along = (upperLength * upperLength - lowerLength * lowerLength + distance * distance) / (2 * distance);
      upperDirection.copy(line).multiplyScalar(along).addScaledVector(pole, Math.sqrt(Math.max(0, upperLength * upperLength - along * along)));
      lowerDirection.copy(line).multiplyScalar(distance).sub(upperDirection).normalize();
      upperDirection.normalize();
      hinge.crossVectors(upperDirection, lowerDirection).normalize();
      frame(upperDirection, hinge, upperWorld).multiply(upperFrame);
      frame(lowerDirection, hinge, lowerWorld).multiply(lowerFrame);

      // Follow the forearm at the wrist. For the cover, turn the palm toward the face.
      handWorld.copy(lowerWorld).multiply(straightWrist);
      currentPalm.copy(palm).applyQuaternion(handWorld);
      facingPalm.set(0, -.13, -1).applyQuaternion(room).projectOnPlane(lowerDirection).normalize();
      const roll = Math.atan2(lowerDirection.dot(across.crossVectors(currentPalm, facingPalm)), currentPalm.dot(facingPalm));
      handWorld.premultiply(local.setFromAxisAngle(lowerDirection, MathUtils.clamp(roll, -.85, .85) * cover));

      upper.quaternion.slerp(upper.parent!.getWorldQuaternion(local).invert().multiply(upperWorld), blend);
      forearm.quaternion.slerp(local.copy(upperWorld).invert().multiply(lowerWorld), blend);
      const wristBlend = (1 - (1 - reach) ** 2) * weight;
      hand.quaternion.slerp(local.copy(lowerWorld).invert().multiply(handWorld), wristBlend);
    }
  };
}
