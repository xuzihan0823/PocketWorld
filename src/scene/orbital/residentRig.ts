import * as THREE from 'three';
import type { ResidentArm, ResidentLeg, ResidentRig } from './ResidentModel';
import type { StairGait } from './stairGait';

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

export function placeLimbEnd([base, middle, tip]: THREE.Bone[], point: THREE.Vector3, tipRotation: THREE.Quaternion, bendDirection?: THREE.Vector3) {
  const worldPosition = (joint: THREE.Bone) => joint.getWorldPosition(new THREE.Vector3());
  const worldRotation = (joint: THREE.Object3D) => joint.getWorldQuaternion(new THREE.Quaternion());
  const start = worldPosition(base), bend = worldPosition(middle), end = worldPosition(tip);
  const upper = bend.distanceTo(start), lower = end.distanceTo(bend);
  const axis = point.clone().sub(start);
  const distance = THREE.MathUtils.clamp(axis.length(), Math.abs(upper - lower) + .0001, upper + lower - .0001);
  axis.normalize();
  const pole = bendDirection ?? bend.clone().sub(start);
  pole.addScaledVector(axis, -pole.dot(axis)).normalize();
  const along = (upper * upper - lower * lower + distance * distance) / (2 * distance);
  const bendPoint = start.clone().addScaledVector(axis, along)
    .addScaledVector(pole, Math.sqrt(Math.max(0, upper * upper - along * along)));
  const setWorldRotation = (joint: THREE.Bone, rotation: THREE.Quaternion) => {
    joint.quaternion.copy(worldRotation(joint.parent!).invert()).multiply(rotation);
    joint.updateWorldMatrix(false, true);
  };
  const aim = (joint: THREE.Bone, from: THREE.Vector3, to: THREE.Vector3) => {
    const delta = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
    setWorldRotation(joint, delta.multiply(worldRotation(joint)));
  };
  aim(base, bend.clone().sub(start), bendPoint.clone().sub(start));
  const movedBend = worldPosition(middle);
  aim(middle, worldPosition(tip).sub(movedBend), start.addScaledVector(axis, distance).sub(movedBend));
  setWorldRotation(tip, tipRotation);
}

/** A spring with an analytic update so its settling time is independent of the display rate. */
function followSpring(frequency: number, dampingRatio = .72) {
  const damping = frequency * dampingRatio;
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

function createLongHairMotion(bones: Iterable<THREE.Bone>, head: THREE.Bone, mesh: THREE.Object3D) {
  const chains = Array.from(bones).filter(joint => joint.parent === head && typeof joint.userData.hairDrape === 'number').map(root => {
    const joints = [root];
    for (let next = root.children.find(child => child instanceof THREE.Bone && typeof child.userData.hairDrape === 'number');
      next instanceof THREE.Bone; next = next.children.find(child => child instanceof THREE.Bone && typeof child.userData.hairDrape === 'number')) {
      joints.push(next);
    }
    return joints.map(joint => {
      const drape = THREE.MathUtils.clamp(joint.userData.hairDrape, 0, 1);
      return { joint, drape, inertia: THREE.MathUtils.clamp(joint.userData.hairSway ?? drape, 0, 1) };
    });
  });
  if (!chains.length) return;
  const vertical = new THREE.Vector3(0, 1, 0);
  const headUp = new THREE.Vector3();
  const identity = new THREE.Quaternion(), meshRotation = new THREE.Quaternion();
  const neutralHeadInverse = head.getWorldQuaternion(new THREE.Quaternion()).invert();
  const headRotation = new THREE.Quaternion(), tiltCorrection = new THREE.Quaternion();
  const authored = new THREE.Quaternion(), parent = new THREE.Quaternion(), corrected = new THREE.Quaternion();
  const sway = new THREE.Quaternion(), pitchAxis = new THREE.Vector3(1, 0, 0);
  // For a downward, rearward strand, the yaw and lateral roll both oppose the turn.
  const turnAxis = new THREE.Vector3(0, .55, -.83).normalize();
  const turnLag = followSpring(8, .50);
  return {
    reset: turnLag.reset,
    apply(dt: number, pitch: number, turn: number) {
      headRotation.copy(mesh.getWorldQuaternion(meshRotation).invert()).multiply(head.getWorldQuaternion(authored));
      headUp.copy(vertical).applyQuaternion(neutralHeadInverse).applyQuaternion(headRotation);
      tiltCorrection.setFromUnitVectors(headUp, vertical);
      const yawLag = turnLag.step(-.40 * turn, dt);
      for (const chain of chains) {
        authored.copy(headRotation);
        parent.copy(headRotation);
        for (const { joint, drape, inertia } of chain) {
          authored.multiply(joint.quaternion);
          // The weights describe cumulative rotation along the chain in the resident's frame.
          // Solving each local rotation against the corrected parent keeps the roots anchored.
          corrected.copy(identity).slerp(tiltCorrection, drape);
          corrected.premultiply(sway.setFromAxisAngle(pitchAxis, pitch * inertia * .6));
          corrected.premultiply(sway.setFromAxisAngle(turnAxis, yawLag * inertia));
          corrected.multiply(authored);
          joint.quaternion.copy(parent.invert()).multiply(corrected);
          parent.copy(corrected);
        }
      }
    },
  };
}

function createFollowMotion(bones: Iterable<THREE.Bone>, head: THREE.Bone, longHair?: ReturnType<typeof createLongHairMotion>) {
  const inverse = new THREE.Quaternion();
  const forward = head.getWorldQuaternion(inverse).invert();
  const headForward = new THREE.Vector3(0, 0, 1).applyQuaternion(forward);
  const axis = new THREE.Vector3(), direction = new THREE.Vector3();
  const offset = new THREE.Quaternion();
  const parts = Array.from(bones).flatMap(joint => {
    const match = /^(Hair|Dress)_(.+)_0([1-4])$/.exec(joint.name);
    if (!match) return [];
    const hair = match[1] === 'Hair';
    if (hair && longHair && typeof joint.userData.hairDrape === 'number') return [];
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
      longHair?.reset();
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
    longHair?.apply(dt, hairPitchAngle, headTurn + .16 * swing * walk);
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

export function createResidentRig(asset: THREE.Object3D, clip: THREE.AnimationClip, authoredStanding = false,
  handMotion?: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }): ResidentRig {
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

  const hips = bone('Hips');
  if (!authoredStanding) {
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
    placeLimbEnd(leftLeg, leftSupport.point, leftSupport.sole);
    placeLimbEnd(rightLeg, rightSupport.point, rightSupport.sole);
  }
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
  const hair = createLongHairMotion(bones.values(), bone('Head'), mesh);
  const followMotion = createFollowMotion(bones.values(), bone('Head'), hair);
  const neutral = Array.from(bones.values(), joint => ({ joint, pose: capture(joint) }));
  const walkPose = neutral.map(({ joint }) => capture(joint));
  const axisX = new THREE.Vector3(1, 0, 0);
  const fold = new THREE.Quaternion();
  asset.scale.setScalar(RESIDENT_SCALE);
  mesh.add(asset);

  const socks = skinned.find(surface => surface.geometry.userData.soleContacts);
  const contactLegs = socks ? (['Left', 'Right'] as const).map(side => ({
    vertices: socks.geometry.userData.soleContacts[side] as number[],
    joints: ['UpLeg', 'Leg', 'Foot'].map(name => bone(side + name)),
  })) : [];
  const samplePoint = new THREE.Vector3(), ankle = new THREE.Vector3(), footRotation = new THREE.Quaternion();

  // Local joint interpolation on walk start/stop can lower the toes between two grounded poses.
  // Lift only a penetrating foot, using the fitted sock's support vertices and the existing leg IK.
  function correctBlendedContact() {
    if (!socks) return;
    mesh.updateWorldMatrix(true, true);
    const floor = mesh.getWorldPosition(samplePoint).y;
    for (const { vertices, joints } of contactLegs) {
      let lowest = floor;
      for (const vertex of vertices) {
        socks.getVertexPosition(vertex, samplePoint).applyMatrix4(socks.matrixWorld);
        lowest = Math.min(lowest, samplePoint.y);
      }
      if (lowest >= floor) continue;
      const foot = joints[2];
      foot.getWorldPosition(ankle).y += floor - lowest + .0002;
      placeLimbEnd(joints, ankle, foot.getWorldQuaternion(footRotation));
    }
  }

  // Update the attached skin bind matrices as well as the scaled neutral bones.
  mesh.updateMatrixWorld(true);
  const stairLegs = ['Right', 'Left'].map(side => {
    const joints = ['UpLeg', 'Leg', 'Foot', 'ToeBase'].map(name => bone(side + name));
    const foot = joints[2], toe = joints[3];
    const soleBounds = new THREE.Box3();
    for (const surface of skinned) {
      const indices = surface.geometry.getAttribute('skinIndex');
      const weights = surface.geometry.getAttribute('skinWeight');
      const footIndex = surface.skeleton.bones.indexOf(foot), toeIndex = surface.skeleton.bones.indexOf(toe);
      if (footIndex < 0) continue;
      for (let vertex = 0; vertex < indices.count; vertex++) {
        let soleWeight = 0;
        for (let channel = 0; channel < 4; channel++) {
          const index = indices.getComponent(vertex, channel);
          if (index === footIndex || index === toeIndex) soleWeight += weights.getComponent(vertex, channel);
        }
        if (soleWeight < .5) continue;
        surface.getVertexPosition(vertex, samplePoint).applyMatrix4(surface.matrixWorld);
        if (samplePoint.y < .026) soleBounds.expandByPoint(samplePoint);
      }
    }
    const ankle = foot.getWorldPosition(new THREE.Vector3());
    const center = soleBounds.isEmpty()
      ? ankle.clone().add(new THREE.Vector3(0, -.045, .048))
      : soleBounds.getCenter(new THREE.Vector3()).setY(soleBounds.min.y);
    const heel = soleBounds.isEmpty() ? -.075 : soleBounds.min.z - center.z;
    const forefoot = soleBounds.isEmpty() ? .075 : soleBounds.max.z - center.z;
    // When the sole is pitched, its middle can strike a nosing even while both ends clear their treads.
    const halfWidth = soleBounds.isEmpty() ? .042 : (soleBounds.max.x - soleBounds.min.x) / 2;
    const soleEdges = [-halfWidth, halfWidth].flatMap(x => Array.from({ length: 13 }, (_, i) =>
      new THREE.Vector3(x, 0, THREE.MathUtils.lerp(heel, forefoot, i / 12)).add(center).sub(ankle)));
    const hip = joints[0].getWorldPosition(new THREE.Vector3()), knee = joints[1].getWorldPosition(new THREE.Vector3());
    const upper = hip.distanceTo(knee), lower = knee.distanceTo(ankle);
    return { joints, foot, toe, soleEdges, hip, upper, lower, length: upper + lower,
      goal: new THREE.Vector3(), sole: new THREE.Quaternion(), minimumY: 0, inverseRotation: foot.getWorldQuaternion(new THREE.Quaternion()).invert(), centerX: center.x, ankleOffset: ankle.sub(center),
      rotation: foot.getWorldQuaternion(new THREE.Quaternion()), toeRotation: toe.quaternion.clone(), ankleY: center.y };
  });
  const stairDress = dress.filter(({ front, side }) => front || side).map(({ target, front }) => ({
    joint: target, rotation: target.quaternion.clone(), front,
    leg: /_(?:Left|L)_/.test(target.name) ? 1 : /_(?:Right|R)_/.test(target.name) ? 0 : null,
  }));
  const stairHips = hips.position.clone();
  const standingHipHeight = hips.getWorldPosition(new THREE.Vector3()).y;
  const stairHead = bone('Head');
  const headRestWorld = stairHead.getWorldQuaternion(new THREE.Quaternion());
  mesh.userData.contactHands = handMotion?.scene.userData.contactHands;
  const stairHands = ['Luna_Stair_Up', 'Luna_Stair_Down'].map(name =>
    handMotion?.animations.find(value => value.name === name)?.tracks.map(track => ({
      joint: mesh.getObjectByName(THREE.PropertyBinding.parseTrackName(track.name).nodeName) as THREE.Bone,
      sample: track.createInterpolant(),
    })));
  const stairArmChains = ['Right', 'Left'].map(side => ['Arm', 'ForeArm', 'Hand', 'HandMiddle1'].map(n => bone(side + n)));
  const limb = new THREE.Vector3(), aim = new THREE.Vector3();
  const pelvisShift = new THREE.Vector3();
  const kneeDirection = new THREE.Vector3();
  const axisY = new THREE.Vector3(0, 1, 0);
  const strideYaw = new THREE.Quaternion(), stridePitch = new THREE.Quaternion();
  const meshYaw = new THREE.Quaternion(), meshYawInverse = new THREE.Quaternion();
  const strideRotation = new THREE.Quaternion(), parentRotation = new THREE.Quaternion();
  const ankleGoal = new THREE.Vector3(), soleGoal = new THREE.Vector3(), soleEdge = new THREE.Vector3();
  const kneeLift = [0, 0];
  const thighDirection = new THREE.Vector3();

  function blendStairPitch(joint: THREE.Bone, rotation: THREE.Quaternion, pitch: number, weight: number) {
    joint.parent!.getWorldQuaternion(parentRotation);
    strideRotation.copy(parentRotation).invert().multiply(meshYaw)
      .multiply(stridePitch.setFromAxisAngle(axisX, pitch)).multiply(meshYawInverse)
      .multiply(parentRotation).multiply(rotation);
    joint.quaternion.slerp(strideRotation, weight);
  }

  function applyStairPose(gait: StairGait, stairX: number, surfaceAt: (z: number, heelRun?: number) => number) {
    const { weight, yaw, treads, descent } = gait;

    mesh.getWorldQuaternion(meshYaw);
    meshYawInverse.copy(meshYaw).invert();
    hips.position.lerp(stairHips, weight);
    // Keep torso pitch and gaze independent of both legs throughout the transfer of weight.
    limb.copy(neckBone.getWorldPosition(aim)).sub(hips.getWorldPosition(soleGoal)).applyQuaternion(meshYawInverse);
    blendStairPitch(hips, hips.quaternion, gait.lean - Math.atan2(limb.z, limb.y), weight);
    strideRotation.copy(meshYaw).multiply(stridePitch.setFromAxisAngle(axisX, gait.headPitch)).multiply(headRestWorld);
    strideRotation.premultiply(stairHead.parent!.getWorldQuaternion(parentRotation).invert());
    stairHead.quaternion.slerp(strideRotation, weight);
    const authoredHands = stairHands[descent ? 1 : 0];
    for (const [side, directions] of (authoredHands ? [] : gait.arms).entries()) {
      const chain = stairArmChains[side];
      for (let i = 0; i < chain.length - 1; i++) {
        const joint = chain[i];
        limb.copy(chain[i + 1].getWorldPosition(soleEdge)).sub(joint.getWorldPosition(soleGoal)).normalize();
        aim.fromArray(directions, 3 * i).normalize().applyQuaternion(meshYaw);
        strideRotation.setFromUnitVectors(limb, aim).multiply(joint.getWorldQuaternion(parentRotation));
        strideRotation.premultiply(joint.parent!.getWorldQuaternion(parentRotation).invert());
        joint.quaternion.slerp(strideRotation, weight);
      }
    }
    if (authoredHands && gait.arms.length) {
      for (const { joint, sample } of authoredHands)
        joint.quaternion.slerp(strideRotation.fromArray(sample.evaluate(gait.phase)), weight);
    }
    pelvisShift.set(0, 0, 0);
    strideYaw.setFromAxisAngle(axisY, yaw);
    for (const [side, leg] of stairLegs.entries()) {
      const step = gait.feet[side];
      stridePitch.setFromAxisAngle(axisX, step.pitch);
      strideRotation.copy(strideYaw).multiply(stridePitch).multiply(leg.rotation);
      const x = stairX + leg.centerX * Math.cos(yaw);
      soleGoal.set(x, step.y, step.z);
      soleGoal.y += step.clearance * leg.length;
      ankleGoal.copy(leg.ankleOffset).applyQuaternion(strideYaw)
        .add(soleGoal).y += Math.max(.001, leg.ankleY);
      leg.foot.getWorldPosition(ankle).lerp(ankleGoal, weight);
      leg.foot.getWorldQuaternion(footRotation).slerp(strideRotation, weight);
      leg.toe.quaternion.slerp(leg.toeRotation, weight);
      // The flat-walk blend can dip at a landing. Check the actual blended footprint, including its width during turns.
      strideRotation.copy(footRotation).multiply(leg.inverseRotation);
      if (weight < 1 && step.y === 0) {
        // At the lower turn the original flat stride can still place its trailing heel inside the first riser.
        const landingEdge = treads.frontZ;
        for (const corner of leg.soleEdges)
          ankle.z = Math.max(ankle.z, landingEdge + .012 - soleEdge.copy(corner).applyQuaternion(strideRotation).z);
      }
      leg.minimumY = -Infinity;
      if (step.swing && !descent) {
        // Round the path around a nosing. Delay horizontal travel while the
        // toes are low, then allow forward travel as the whole sole clears it.
        let slide = 0;
        for (const edge of leg.soleEdges) {
          soleEdge.copy(edge).applyQuaternion(strideRotation);
          const near = ankle.z + soleEdge.z - .006 - .030 * Math.abs(Math.sin(step.pitch));
          const top = Math.min(treads.count, Math.ceil((treads.frontZ - near) / treads.run));
          for (let level = top; level >= Math.max(1, top - 1); level--) {
            const overlap = treads.frontZ - (level - 1) * treads.run - near;
            const floorY = level * treads.rise - soleEdge.y + .002;
            const below = floorY - ankle.y;
            if (below <= 0) continue;
            const ratio = below / Math.max(.0001, overlap);
            slide = Math.max(slide, (overlap + .0001) * THREE.MathUtils.smoothstep(ratio, .5, 1));
            const lift = 1 - THREE.MathUtils.smoothstep(ratio, 1, 2);
            leg.minimumY = Math.max(leg.minimumY, floorY - (1 - lift) * treads.rise);
          }
        }
        ankle.z += slide;
      }
      const heelRun = descent && step.swing ? .24 * treads.run : 0;
      for (const corner of leg.soleEdges) {
        soleEdge.copy(corner).applyQuaternion(strideRotation);
        const z = ankle.z + soleEdge.z - .006 - .030 * Math.abs(Math.sin(step.pitch));
        leg.minimumY = Math.max(leg.minimumY, surfaceAt(z, heelRun) - soleEdge.y + .0015);
      }
      ankle.y = Math.max(ankle.y, leg.minimumY);
      leg.goal.copy(ankle);
      leg.sole.copy(footRotation);
      leg.joints[0].getWorldPosition(leg.hip);
      const source = gait.legs[side], share = step.swing ? 1 - gait.supportWeight : gait.supportWeight;
      aim.set(source.hipSide, 0, source.hipForward).multiplyScalar(leg.length).applyQuaternion(strideYaw);
      pelvisShift.x += share * (ankle.x + aim.x - leg.hip.x);
      pelvisShift.z += share * (ankle.z + aim.z - leg.hip.z);
    }
    // Recover pelvis height from the recorded knee angles and the two reachable ankle targets.
    // Near each foot exchange both legs contribute, avoiding a jump when support changes sides.
    pelvisShift.multiplyScalar(weight);
    // Anchor forward motion to the recorded pelvis path from one planted ankle to the next.
    const ankleOffset = (stairLegs[0].ankleOffset.z + stairLegs[1].ankleOffset.z) / 2;
    const { y: hipY, z: hipZ } = hips.getWorldPosition(aim);
    pelvisShift.z = THREE.MathUtils.lerp(pelvisShift.z, gait.pelvisZ + ankleOffset * Math.cos(yaw) - hipZ, weight);
    const targets = stairLegs.map((leg, side) => {
      const reachSq = leg.upper ** 2 + leg.lower ** 2 + 2 * leg.upper * leg.lower * Math.cos(gait.legs[side].flexion);
      const dx = leg.hip.x + pelvisShift.x - leg.goal.x;
      return { z: leg.goal.z - leg.hip.z, y: leg.goal.y - leg.hip.y, r2: Math.max(0, reachSq - dx * dx), dx };
    });
    const heights = targets.map((target, side) => {
      const dz = pelvisShift.z - target.z, leg = stairLegs[side];
      // A lightly bent receiving knee absorbs the load through contact on descent.
      const bend = descent ? Math.min(gait.legs[side].flexion, .34) * weight : 0;
      const maxReach = bend ? Math.sqrt(leg.upper ** 2 + leg.lower ** 2 + 2 * leg.upper * leg.lower * Math.cos(bend)) : leg.length;
      return {
        lift: target.y + Math.sqrt(Math.max(0, target.r2 - dz * dz)),
        max: target.y + Math.sqrt(Math.max(0, (maxReach - .0002) ** 2 - target.dx ** 2 - dz * dz)),
      };
    });
    const support = gait.feet[0].swing ? 1 : 0, swing = 1 - support;
    const free = 2 * (gait.supportWeight - .5) * weight;
    // During single support the free ankle can follow its recorded knee bend.
    // At double support both soles must reach their respective treads.
    const freeLeg = stairLegs[swing];
    // Limit how fast the straightening leg can raise the torso during the uphill transfer.
    const riseLimit = gait.ascentHeightLimit === null ? Infinity : standingHipHeight + gait.ascentHeightLimit - hipY;
    const supportLift = Math.min(heights[support].lift, riseLimit);
    let ankleShift = free * (supportLift - heights[swing].lift);
    if (descent) {
      const landingY = descent.ankleSurface + freeLeg.ankleOffset.y + Math.max(.001, freeLeg.ankleY);
      ankleShift = THREE.MathUtils.lerp(ankleShift, landingY - freeLeg.goal.y, descent.settle * weight);
    }
    ankleShift = Math.max(ankleShift, freeLeg.minimumY - freeLeg.goal.y);
    freeLeg.goal.y += ankleShift;
    const preferredLift = THREE.MathUtils.lerp(heights[swing].lift + ankleShift, heights[support].lift, gait.supportWeight);
    const lift = Math.min(preferredLift, riseLimit) * weight;
    pelvisShift.y = Math.min(lift, heights[support].max, heights[swing].max + ankleShift);
    hips.getWorldPosition(ankleGoal).add(pelvisShift);
    hips.position.copy(hips.parent!.worldToLocal(ankleGoal));
    for (const [side, leg] of stairLegs.entries()) {
      kneeDirection.set(side === 0 ? -.11 : .11, 0, 1).applyQuaternion(meshYaw);
      placeLimbEnd(leg.joints, leg.goal, leg.sole, kneeDirection);
      const [thigh, shin] = leg.joints;
      thighDirection.copy(shin.getWorldPosition(soleEdge)).sub(thigh.getWorldPosition(soleGoal)).applyQuaternion(meshYawInverse);
      kneeLift[side] = THREE.MathUtils.clamp(Math.atan2(thighDirection.z, -thighDirection.y) - .08, 0, 1.28);
    }
    // Let each front panel follow the corresponding knee so the deeper stair flexion keeps the skirt outside the legs.
    for (const { joint, rotation, front, leg } of stairDress) {
      const pitch = leg === null ? Math.max(...kneeLift) * .72
        : kneeLift[leg] * (front ? .91 : .40) + kneeLift[1 - leg] * (front ? .12 : 0);
      blendStairPitch(joint, rotation, -pitch, weight);
    }
  }

  function applyPose(phase: number, walkWeight: number) {
    if (walkWeight === 1) sample(phase);
    else {
      applyBlendedPose(phase, walkWeight);
      if (walkWeight > 0) correctBlendedContact();
    }
  }

  function applyBlendedPose(phase: number, walkWeight: number) {
    if (walkWeight > 0) {
      sample(phase);
      neutral.forEach(({ joint }, i) => {
        walkPose[i].position.copy(joint.position);
        walkPose[i].quaternion.copy(joint.quaternion);
        walkPose[i].scale.copy(joint.scale);
      });
    }
    for (const { joint, pose } of neutral) restore(joint, pose);
    // The controller's bones rotate in a room-aligned basis. Convert each
    // local rotation into the imported joint's parent frame before skinning.
    for (const { control: joint, target, parentBasis, neutral: rest } of controlMap)
      target.quaternion.copy(parentBasis).multiply(joint.quaternion).multiply(rest);
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

  return { mesh, legs, arms, torso, neck, head, skirtFront, skirtBack, applyPose, applyStairPose, followMotion, applyArmCorrectives,
    dispose: () => { for (const object of skinned) object.skeleton.dispose(); } };
}
