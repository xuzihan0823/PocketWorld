import * as THREE from 'three';
import type { ResidentArm, ResidentLeg, ResidentRig } from './ResidentModel';

export const HIP_HEIGHT = 0.69;
export const RESIDENT_SCALE = 1.43;
export const WALK_SPEED = 0.576 * RESIDENT_SCALE;

type BonePose = { position: THREE.Vector3; quaternion: THREE.Quaternion; scale: THREE.Vector3 };
const capture = (bone: THREE.Bone): BonePose => ({
  position: bone.position.clone(), quaternion: bone.quaternion.clone(), scale: bone.scale.clone(),
});
function restore(bone: THREE.Bone, pose: BonePose) {
  bone.position.copy(pose.position);
  bone.quaternion.copy(pose.quaternion);
  bone.scale.copy(pose.scale);
}
const tilt = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(to.z - from.z, from.y - to.y);

function plantResidentLeg([thigh, shin, foot]: THREE.Bone[], point: THREE.Vector3, sole: THREE.Quaternion) {
  const worldPosition = (joint: THREE.Bone) => joint.getWorldPosition(new THREE.Vector3());
  const worldRotation = (joint: THREE.Object3D) => joint.getWorldQuaternion(new THREE.Quaternion());
  const hip = worldPosition(thigh), knee = worldPosition(shin), ankle = worldPosition(foot);
  const upper = knee.distanceTo(hip), lower = ankle.distanceTo(knee);
  const axis = point.clone().sub(hip);
  const distance = Math.min(axis.length(), upper + lower - .0001);
  axis.normalize();
  const pole = knee.clone().sub(hip);
  pole.addScaledVector(axis, -pole.dot(axis)).normalize();
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const bentKnee = hip.clone().addScaledVector(axis, along)
    .addScaledVector(pole, Math.sqrt(Math.max(0, upper * upper - along * along)));
  const setWorldRotation = (joint: THREE.Bone, rotation: THREE.Quaternion) => {
    joint.quaternion.copy(worldRotation(joint.parent!).invert()).multiply(rotation);
    joint.updateWorldMatrix(false, true);
  };
  const aim = (joint: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3) => {
    const delta = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
    setWorldRotation(joint, delta.multiply(worldRotation(joint)));
  };
  aim(thigh, knee.clone().sub(hip), bentKnee.clone().sub(hip));
  const movedKnee = worldPosition(shin);
  aim(shin, worldPosition(foot).sub(movedKnee), hip.addScaledVector(axis, distance).sub(movedKnee));
  setWorldRotation(foot, sole);
}

/** A spring with an analytic update so its settling time is independent of the display rate. */
function followSpring(frequency: number) {
  const damping = frequency * .72;
  const oscillation = Math.sqrt(frequency ** 2 - damping ** 2);
  let value = 0;
  let velocity = 0;
  return {
    step(target: number, dt: number) {
      const error = value - target;
      const envelope = Math.exp(-damping * dt);
      const sin = Math.sin(oscillation * dt);
      const cos = Math.cos(oscillation * dt);
      value = target + envelope * (error * cos + (velocity + damping * error) / oscillation * sin);
      velocity = envelope * (velocity * cos - (damping * velocity + frequency ** 2 * error) / oscillation * sin);
      return value;
    },
    reset() { value = velocity = 0; },
  };
}

function createFollowMotion(bones: Iterable<THREE.Bone>, head: THREE.Bone) {
  const inverse = new THREE.Quaternion();
  const forward = head.getWorldQuaternion(inverse).invert();
  const headForward = new THREE.Vector3(0, 0, 1).applyQuaternion(forward);
  const axis = new THREE.Vector3(), direction = new THREE.Vector3();
  const offset = new THREE.Quaternion();
  const parts = Array.from(bones).flatMap(joint => {
    const match = /^(Hair|Dress)_(.+)_0([1-4])$/.exec(joint.name);
    if (!match) return [];
    const hair = match[1] === 'Hair';
    const depth = Number(match[3]);
    const weight = (hair ? [.17, .34, .42, .40] : [.21, .41, .48])[depth - 1]
      * (hair && match[2].startsWith('Front') ? .45 : 1);
    joint.getWorldQuaternion(inverse).invert();
    return [{
      joint, hair, weight,
      pitchAxis: new THREE.Vector3(1, 0, 0).applyQuaternion(inverse),
      rollAxis: new THREE.Vector3(0, 0, 1).applyQuaternion(inverse),
    }];
  });
  const hairPitch = followSpring(14), hairRoll = followSpring(12);
  const skirtPitch = followSpring(17), skirtRoll = followSpring(15);
  const clamp = THREE.MathUtils.clamp;
  const angleDelta = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  let previous: { yaw: number; gaze: number } | null = null;

  return (rawDelta: number, enabled: boolean, yaw: number, dx: number, dz: number, phase: number) => {
    if (!enabled || rawDelta > .2) {
      previous = null;
      hairPitch.reset(); hairRoll.reset(); skirtPitch.reset(); skirtRoll.reset();
      return;
    }
    if (rawDelta <= 0) return;
    const dt = Math.min(rawDelta, .05);
    direction.copy(headForward).applyQuaternion(head.getWorldQuaternion(inverse));
    const gaze = Math.atan2(direction.x, direction.z);
    const turning = previous ? clamp(angleDelta(yaw, previous.yaw) / rawDelta / 4.5, -1, 1) : 0;
    const headTurn = previous ? clamp(angleDelta(gaze, previous.gaze) / rawDelta / 4.5, -1, 1) : 0;
    if (previous) { previous.yaw = yaw; previous.gaze = gaze; }
    else previous = { yaw, gaze };
    const walk = clamp(Math.hypot(dx, dz) / (dt * WALK_SPEED), 0, 1);
    const forwardSpeed = clamp((dx * Math.sin(yaw) + dz * Math.cos(yaw)) / (dt * WALK_SPEED), -.35, 1);
    const swing = Math.sin(phase * Math.PI * 2);
    const hairPitchAngle = hairPitch.step(.15 * forwardSpeed + .090 * swing * walk, dt);
    const hairRollAngle = hairRoll.step(-.31 * headTurn + .105 * swing * walk, dt);
    const skirtPitchAngle = skirtPitch.step(.085 * forwardSpeed + .060 * swing * walk, dt);
    const skirtRollAngle = skirtRoll.step(-.20 * turning + .145 * swing * walk, dt);
    for (const { joint, hair, weight, pitchAxis, rollAxis } of parts) {
      const pitch = (hair ? hairPitchAngle : skirtPitchAngle) * weight;
      const roll = (hair ? hairRollAngle : skirtRollAngle) * weight;
      const angle = Math.hypot(pitch, roll);
      if (angle < .0001) continue;
      axis.copy(pitchAxis).multiplyScalar(pitch / angle).addScaledVector(rollAxis, roll / angle);
      joint.quaternion.multiply(offset.setFromAxisAngle(axis, angle));
    }
  };
}

export function createResidentRig(asset: THREE.Object3D, clip: THREE.AnimationClip): ResidentRig {
  const bones = new Map<string, THREE.Bone>();
  const skinned: THREE.SkinnedMesh[] = [];
  asset.traverse(object => {
    if (object instanceof THREE.Bone) bones.set(object.name, object);
    if (object instanceof THREE.SkinnedMesh) {
      skinned.push(object);
      object.castShadow = object.receiveShadow = true;
      object.frustumCulled = false;
      object.raycast = () => {};
    }
  });
  if (!skinned.length || clip.duration !== 1) throw new Error('Luna requires a one-second skinned walk clip');
  const bone = (name: string) => {
    const value = bones.get('mixamorig' + name);
    if (!value) throw new Error(`Luna is missing bone ${name}`);
    return value;
  };
  const channels = clip.tracks.map(track => {
    const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
    const target = bones.get(nodeName);
    if (!target || (propertyName !== 'position' && propertyName !== 'quaternion' && propertyName !== 'scale'))
      throw new Error(`Unexpected Luna animation track ${track.name}`);
    return { value: target[propertyName], curve: track.createInterpolant() };
  });
  const sample = (t: number) => {
    for (const { value, curve } of channels) value.fromArray(curve.evaluate(t));
  };

  // Capture upright bind-pose spine orientations before sampling the walk cycle
  // so the free-standing upright stance stays straight without inheriting walk hunch.
  asset.updateMatrixWorld(true);
  const spineNames = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head'] as const;
  const bindSpineWorld = new Map(spineNames.map(name => [name, bone(name).getWorldQuaternion(new THREE.Quaternion())]));

  // Build a two-foot neutral pose using the planted phase of each leg, and
  // average the upper body at the two mid-swing phases for a relaxed stance.
  const leftLeg = ['UpLeg', 'Leg', 'Foot', 'ToeBase'].map(name => bone('Left' + name));
  const rightLeg = ['UpLeg', 'Leg', 'Foot', 'ToeBase'].map(name => bone('Right' + name));
  const support = (leg: THREE.Bone[]) => ({
    pose: leg.map(capture),
    point: leg[2].getWorldPosition(new THREE.Vector3()),
    toe: leg[3].getWorldPosition(new THREE.Vector3()),
    sole: leg[2].getWorldQuaternion(new THREE.Quaternion()),
  });
  sample(.20);
  const leftSupport = support(leftLeg);
  sample(.70);
  const rightSupport = support(rightLeg);
  sample(.32);
  const opposite = Array.from(bones.values(), capture);
  sample(.82);
  Array.from(bones.values()).forEach((joint, i) => {
    joint.position.lerp(opposite[i].position, .5);
    joint.quaternion.slerp(opposite[i].quaternion, .5);
    joint.scale.lerp(opposite[i].scale, .5);
  });
  leftLeg.forEach((joint, i) => restore(joint, leftSupport.pose[i]));
  rightLeg.forEach((joint, i) => restore(joint, rightSupport.pose[i]));
  // Mid-swing averages leave the pelvis behind the planted feet and the trunk
  // leaning back. Balance the pelvis over the rear/middle of the sole, then
  // align the neck above it. Replant both legs below, preserving their soles.
  const hips = bone('Hips');
  const hipPosition = hips.getWorldPosition(new THREE.Vector3());
  const neckPosition = bone('Neck').getWorldPosition(new THREE.Vector3());
  const forward = (leftSupport.point.z + rightSupport.point.z) * .5
    + ((leftSupport.toe.z - leftSupport.point.z) + (rightSupport.toe.z - rightSupport.point.z)) * .175;
  const pitch = Math.atan2(hipPosition.z - neckPosition.z, neckPosition.y - hipPosition.y);
  const balancedRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch)
    .multiply(hips.getWorldQuaternion(new THREE.Quaternion()));
  hips.position.copy(hips.parent!.worldToLocal(hipPosition.clone().setZ(forward)));
  hips.quaternion.copy(hips.parent!.getWorldQuaternion(new THREE.Quaternion()).invert()).multiply(balancedRotation);
  hips.updateWorldMatrix(false, true);
  plantResidentLeg(leftLeg, leftSupport.point, leftSupport.sole);
  plantResidentLeg(rightLeg, rightSupport.point, rightSupport.sole);
  asset.updateMatrixWorld(true);
  const mesh = new THREE.Group();
  mesh.name = 'Resident';
  const controlMap: { control: THREE.Bone; target: THREE.Bone; parentBasis: THREE.Quaternion; neutral: THREE.Quaternion }[] = [];
  const at = (joint: THREE.Bone) => joint.getWorldPosition(new THREE.Vector3()).multiplyScalar(RESIDENT_SCALE);
  function control(target: THREE.Bone, parent: THREE.Object3D = mesh, origin = new THREE.Vector3()) {
    const joint = new THREE.Bone();
    joint.position.copy(at(target)).sub(origin);
    parent.add(joint);
    controlMap.push({ control: joint, target,
      parentBasis: target.parent!.getWorldQuaternion(new THREE.Quaternion()).invert(),
      neutral: target.getWorldQuaternion(new THREE.Quaternion()) });
    return joint;
  }
  const torsoBone = bone('Spine2');
  const torso = control(torsoBone);
  const neckBone = bone('Neck');
  const neck = control(neckBone, torso, at(torsoBone));
  const head = control(bone('Head'), neck, at(neckBone));
  const legs: ResidentLeg[] = ['Right', 'Left'].map(side => {
    const thighBone = bone(side + 'UpLeg'), shinBone = bone(side + 'Leg'), footBone = bone(side + 'Foot');
    const h = at(thighBone), k = at(shinBone), a = at(footBone);
    const thigh = control(thighBone);
    const shin = control(shinBone, thigh, h);
    const foot = control(footBone, shin, k);
    return { thigh, shin, foot, upperLength: Math.hypot(k.y - h.y, k.z - h.z),
      lowerLength: Math.hypot(a.y - k.y, a.z - k.z), ankleHeight: a.y,
      hipForward: h.z, straighten: [tilt(h, k), tilt(k, a) - tilt(h, k)] };
  });
  const arms: ResidentArm[] = ['Right', 'Left'].map((side, sideIndex) => {
    const shoulderBone = bone(side + 'Shoulder'), upperBone = bone(side + 'Arm');
    const lowerBone = bone(side + 'ForeArm'), handBone = bone(side + 'Hand');
    const shoulder = control(shoulderBone, torso, at(torsoBone));
    const upper = control(upperBone, shoulder, at(shoulderBone));
    const forearm = control(lowerBone, upper, at(upperBone));
    const hand = control(handBone, forearm, at(lowerBone));
    const wrist = at(handBone);
    const mid1 = at(bone(side + 'HandMiddle1'));
    const mid4 = at(bone(side + 'HandMiddle4'));
    const idx1 = at(bone(side + 'HandIndex1'));
    const pnk1 = at(bone(side + 'HandPinky1'));
    const palmVec = mid1.clone().sub(wrist);
    const fingerDir = palmVec.clone().normalize();
    const across = idx1.clone().sub(pnk1).normalize();
    const palmY = fingerDir.clone().negate();
    const rawNormal = (sideIndex === 0 ? across.clone().cross(fingerDir) : fingerDir.clone().cross(across)).normalize();
    const palmX = palmY.clone().cross(rawNormal).normalize();
    const palmZ = palmX.clone().cross(palmY).normalize();
    const palmBasis = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(palmX, palmY, palmZ));
    const palmOffset = palmVec.clone().multiplyScalar(0.55).addScaledVector(palmZ, 0.018);
    const fingerTipOffset = mid4.clone().sub(wrist);
    const curlAxis = palmX.clone().negate();
    const thumbAxis = fingerDir.clone().multiplyScalar(sideIndex === 0 ? -0.85 : 0.85).addScaledVector(curlAxis, 0.5).normalize();
    const fingerChains = ['Index', 'Middle', 'Ring', 'Pinky'].map((name, fi) =>
      [1, 2, 3].map(seg => ({ bone: control(bone(`${side}Hand${name}${seg}`), hand, wrist), factor: (0.75 + seg * 0.22) * (0.92 + fi * 0.05) }))
    ).flat();
    const thumbChain = [1, 2].map(seg => ({ bone: control(bone(`${side}HandThumb${seg}`), hand, wrist), factor: seg === 1 ? 0.65 : 0.9 }));
    const handNeutral = handBone.getWorldQuaternion(new THREE.Quaternion());
    const middleChain = [1, 2, 3, 4].map(seg => {
      const target = bone(side + 'HandMiddle' + seg);
      return { target, rest: capture(target), mapping: controlMap.find(entry => entry.target === target) };
    });
    const fingerMatrix = new THREE.Matrix4(), segmentMatrix = new THREE.Matrix4();
    const segmentRotation = new THREE.Quaternion();
    const setFingers = (curl: number, thumbOppose = curl * 0.6) => {
      for (const f of fingerChains) f.bone.quaternion.setFromAxisAngle(curlAxis, curl * f.factor);
      for (const t of thumbChain) t.bone.quaternion.setFromAxisAngle(thumbAxis, thumbOppose * t.factor);
      // Solve the actual curled middle-finger chain, in the hand controller's
      // neutral room basis. Library IK must touch the sheet with the real tip,
      // rather than a shortened neutral finger proxy that floats above it.
      fingerMatrix.identity();
      for (const { rest, mapping } of middleChain) {
        if (mapping) segmentRotation.copy(mapping.parentBasis).multiply(mapping.control.quaternion).multiply(mapping.neutral);
        else segmentRotation.copy(rest.quaternion);
        segmentMatrix.compose(rest.position, segmentRotation, rest.scale);
        fingerMatrix.multiply(segmentMatrix);
      }
      fingerTipOffset.setFromMatrixPosition(fingerMatrix).multiplyScalar(RESIDENT_SCALE).applyQuaternion(handNeutral);
    };
    return { shoulder, upper, forearm, hand, restWrist: wrist,
      restUpper: forearm.position.clone(), restLower: hand.position.clone(),
      upperLength: forearm.position.length(), lowerLength: hand.position.length(),
      palmBasis, palmOffset, fingerTipOffset, setFingers };
  });
  const skirtFront = new THREE.Bone(), skirtBack = new THREE.Bone();
  const dress = Array.from(bones.values()).filter(joint => /^Dress_.+_01$/.test(joint.name)).map(target => ({
    target, parentBasis: target.parent!.getWorldQuaternion(new THREE.Quaternion()).invert(),
    neutral: target.getWorldQuaternion(new THREE.Quaternion()),
    front: target.name.includes('Front'), side: /^Dress_(Left|Right)_/.test(target.name),
  }));
  const followMotion = createFollowMotion(bones.values(), bone('Head'));
  const neutral = Array.from(bones.values(), joint => ({ joint, pose: capture(joint) }));

  // Build an upright free-standing pose from the same planted feet so standing
  // stays tall and straight without the walking S-bend hunch or bent-knee squat,
  // while leaving `neutral` untouched for baked sofa/chair/library handoffs.
  const setWorldRotation = (joint: THREE.Bone, rotation: THREE.Quaternion) => {
    joint.quaternion.copy(joint.parent!.getWorldQuaternion(new THREE.Quaternion()).invert()).multiply(rotation);
    joint.updateWorldMatrix(false, true);
  };
  const uprightTargets: readonly (readonly [typeof spineNames[number], number])[] = [
    ['Hips', -.020],
    ['Spine', -.010],
    ['Spine1', -.010],
    ['Spine2', .025],
    ['Neck', .085],
    ['Head', -.030],
  ];
  const worldDelta = new THREE.Quaternion(), euler = new THREE.Euler();
  const standHip = hips.getWorldPosition(new THREE.Vector3());
  standHip.y += .008 / RESIDENT_SCALE;
  standHip.z -= .006 / RESIDENT_SCALE;
  hips.position.copy(hips.parent!.worldToLocal(standHip));
  for (const [name, targetPitch] of uprightTargets) {
    const joint = bone(name);
    const bindQ = bindSpineWorld.get(name)!;
    worldDelta.copy(joint.getWorldQuaternion(new THREE.Quaternion())).multiply(bindQ.clone().invert());
    euler.setFromQuaternion(worldDelta, 'XYZ');
    worldDelta.setFromEuler(euler.set(targetPitch, euler.y * .25, euler.z * .25, 'XYZ')).multiply(bindQ);
    setWorldRotation(joint, worldDelta);
  }
  // Keep shoulders naturally seated on the straightened ribcage and gently align
  // only the upper arms downward so elbows hang vertically beneath the shoulders.
  const armDrop = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), .14);
  for (const side of ['Left', 'Right'] as const) {
    const arm = bone(side + 'Arm');
    setWorldRotation(arm, armDrop.clone().multiply(arm.getWorldQuaternion(new THREE.Quaternion())));
  }
  hips.updateWorldMatrix(false, true);
  plantResidentLeg(leftLeg, leftSupport.point, leftSupport.sole);
  plantResidentLeg(rightLeg, rightSupport.point, rightSupport.sole);
  asset.updateMatrixWorld(true);
  const upright = neutral.map(({ joint }) => capture(joint));
  for (const { joint, pose } of neutral) restore(joint, pose);
  asset.updateMatrixWorld(true);

  const walkPose = neutral.map(({ joint }) => capture(joint));
  const axisX = new THREE.Vector3(1, 0, 0);
  const fold = new THREE.Quaternion();
  asset.scale.setScalar(RESIDENT_SCALE);
  mesh.add(asset);

  function applyPose(phase: number, walkWeight: number, uprightWeight = 0) {
    if (walkWeight === 1) sample(phase);
    else applyBlendedPose(phase, walkWeight, uprightWeight);
  }

  function applyBlendedPose(phase: number, walkWeight: number, uprightWeight: number) {
    if (walkWeight > 0) {
      sample(phase);
      neutral.forEach(({ joint }, i) => {
        walkPose[i].position.copy(joint.position);
        walkPose[i].quaternion.copy(joint.quaternion);
        walkPose[i].scale.copy(joint.scale);
      });
    }
    for (const { joint, pose } of neutral) restore(joint, pose);
    if (uprightWeight > 0) neutral.forEach(({ joint }, i) => {
      joint.position.lerp(upright[i].position, uprightWeight);
      joint.quaternion.slerp(upright[i].quaternion, uprightWeight);
      joint.scale.lerp(upright[i].scale, uprightWeight);
    });
    // The controller's bones rotate in a room-aligned basis. Convert each
    // local rotation into the imported joint's parent frame before skinning.
    for (const { control: joint, target, parentBasis, neutral: rest } of controlMap) {
      if (uprightWeight > 0 && joint.quaternion.x === 0 && joint.quaternion.y === 0 && joint.quaternion.z === 0 && joint.quaternion.w === 1) continue;
      target.quaternion.copy(parentBasis).multiply(joint.quaternion).multiply(rest);
    }
    for (const { target, parentBasis, neutral: rest, front, side } of dress) {
      const x = front ? skirtFront.rotation.x * .75 : side ? skirtFront.rotation.x * .34 : skirtBack.rotation.x;
      target.quaternion.copy(parentBasis).multiply(fold.setFromAxisAngle(axisX, x)).multiply(rest);
    }
    if (walkWeight > 0) neutral.forEach(({ joint }, i) => {
      joint.position.lerp(walkPose[i].position, walkWeight);
      joint.quaternion.slerp(walkPose[i].quaternion, walkWeight);
      joint.scale.lerp(walkPose[i].scale, walkWeight);
    });
  }

  const correctives = (['Left', 'Right'] as const).flatMap(side => {
    const targets = skinned.flatMap(object => {
      const index = object.morphTargetDictionary?.[side + 'ArmContact'];
      return index === undefined || !object.morphTargetInfluences ? [] : [{ index, weights: object.morphTargetInfluences }];
    });
    return targets.length ? [{ upper: bone(side + 'Arm'), elbow: bone(side + 'ForeArm'),
      wrist: bone(side + 'Hand'), targets }] : [];
  });
  const down = new THREE.Vector3(), facing = new THREE.Vector3();
  const shoulderPoint = new THREE.Vector3(), elbowPoint = new THREE.Vector3(), wristPoint = new THREE.Vector3();
  const direction = new THREE.Vector3(), orientation = new THREE.Quaternion();
  function applyArmCorrectives(enabled: boolean) {
    if (!correctives.length) return;
    if (enabled) {
      down.copy(hips.getWorldPosition(shoulderPoint)).sub(neckBone.getWorldPosition(elbowPoint)).normalize();
      facing.set(0, 0, 1).applyQuaternion(mesh.getWorldQuaternion(orientation));
    }
    for (const { upper, elbow, wrist, targets } of correctives) {
      let weight = 0;
      if (enabled) {
        upper.getWorldPosition(shoulderPoint);
        elbow.getWorldPosition(elbowPoint);
        wrist.getWorldPosition(wristPoint);
        const upperDown = direction.copy(elbowPoint).sub(shoulderPoint).normalize().dot(down);
        const lowerDown = direction.copy(wristPoint).sub(elbowPoint).normalize().dot(down);
        const reachForward = direction.copy(wristPoint).sub(shoulderPoint).normalize().dot(facing);
        weight = THREE.MathUtils.smoothstep(upperDown, .925, .989)
          * THREE.MathUtils.smoothstep(lowerDown, .76, .925)
          * (1 - THREE.MathUtils.smoothstep(reachForward, .14, .31));
      }
      for (const { index, weights } of targets) weights[index] = weight;
    }
  }

  return { mesh, legs, arms, torso, neck, head, skirtFront, skirtBack, applyPose, followMotion, applyArmCorrectives,
    dispose: () => { for (const object of skinned) object.skeleton.dispose(); } };
}
