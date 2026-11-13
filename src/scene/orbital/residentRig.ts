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

function plantNeutralLeg([thigh, shin, foot]: THREE.Bone[], point: THREE.Vector3, sole: THREE.Quaternion) {
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

  // Build a two-foot neutral pose using the planted phase of each leg, and
  // average the upper body at the two mid-swing phases for a relaxed stance.
  const leftLeg = ['UpLeg', 'Leg', 'Foot', 'ToeBase'].map(name => bone('Left' + name));
  const rightLeg = ['UpLeg', 'Leg', 'Foot', 'ToeBase'].map(name => bone('Right' + name));
  const support = (leg: THREE.Bone[]) => ({
    pose: leg.map(capture),
    point: leg[2].getWorldPosition(new THREE.Vector3()),
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
  plantNeutralLeg(leftLeg, leftSupport.point, leftSupport.sole);
  plantNeutralLeg(rightLeg, rightSupport.point, rightSupport.sole);
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
  const neck = control(bone('Neck'), torso, at(torsoBone));
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
  const arms: ResidentArm[] = ['Right', 'Left'].map(side => {
    const shoulderBone = bone(side + 'Shoulder'), upperBone = bone(side + 'Arm');
    const lowerBone = bone(side + 'ForeArm'), handBone = bone(side + 'Hand');
    const shoulder = control(shoulderBone, torso, at(torsoBone));
    const upper = control(upperBone, shoulder, at(shoulderBone));
    const forearm = control(lowerBone, upper, at(upperBone));
    const hand = control(handBone, forearm, at(lowerBone));
    const wrist = at(handBone);
    const palm = at(bone(side + 'HandMiddle1')).sub(wrist);
    const sign = side === 'Right' ? 1 : -1;
    const grip = new THREE.Vector3(.027, .068, .021 * sign);
    const handBasis = handBone.getWorldQuaternion(new THREE.Quaternion());
    const fingers = ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky'].flatMap((digit, finger) => {
      const chain = [1, 2, 3].map(i => bone(side + 'Hand' + digit + i));
      const open = chain.map(joint => joint.quaternion.clone());
      if (finger < 2) {
        // Fit the pad centers in hand space once. These offsets are in the authored Luna rig's units.
        const tip = bone(side + 'Hand' + digit + '4');
        const target = handBone.localToWorld(grip.clone().add(new THREE.Vector3(0, 0, (finger === 0 ? .0025 : -.0025) * sign)));
        const rotation = new THREE.Quaternion(), from = new THREE.Vector3(), to = new THREE.Vector3();
        for (let pass = 0; pass < 24; pass++) for (let i = chain.length - 1; i >= 0; i--) {
          const joint = chain[i];
          joint.worldToLocal(tip.getWorldPosition(from)).normalize();
          joint.worldToLocal(to.copy(target)).normalize();
          joint.quaternion.multiply(rotation.setFromUnitVectors(from, to));
        }
      } else {
        for (const [i, joint] of chain.entries()) {
          const axis = new THREE.Vector3(sign, 0, 0).applyQuaternion(handBasis)
            .applyQuaternion(joint.getWorldQuaternion(new THREE.Quaternion()).invert());
          joint.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(axis, [.23, .30, .17][i]));
        }
      }
      return chain.map((joint, i) => {
        const closed = joint.quaternion.clone();
        joint.quaternion.copy(open[i]);
        return { joint, open: open[i], closed };
      });
    });
    return { shoulder, upper, forearm, hand, restWrist: wrist,
      restUpper: forearm.position.clone(), restLower: hand.position.clone(),
      upperLength: forearm.position.length(), lowerLength: hand.position.length(),
      palmBasis: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), palm.clone().normalize()),
      palmOffset: palm.multiplyScalar(.50),
      pinch: {
        offset: grip.multiplyScalar(RESIDENT_SCALE),
        basis: handBasis.invert(),
        apply: amount => { for (const finger of fingers) finger.joint.quaternion.slerpQuaternions(finger.open, finger.closed, amount); },
      } };
  });
  const skirtFront = new THREE.Bone(), skirtBack = new THREE.Bone();
  const dress = Array.from(bones.values()).filter(joint => /^Dress_.+_01$/.test(joint.name)).map(target => ({
    target, parentBasis: target.parent!.getWorldQuaternion(new THREE.Quaternion()).invert(),
    neutral: target.getWorldQuaternion(new THREE.Quaternion()),
    front: target.name.includes('Front'), side: /^Dress_(Left|Right)_/.test(target.name),
  }));
  const neutral = Array.from(bones.values(), joint => ({ joint, pose: capture(joint) }));
  const walkPose = neutral.map(({ joint }) => capture(joint));
  const axisX = new THREE.Vector3(1, 0, 0);
  const fold = new THREE.Quaternion();
  asset.scale.setScalar(RESIDENT_SCALE);
  mesh.add(asset);

  function applyPose(phase: number, walkWeight: number) {
    if (walkWeight === 1) sample(phase);
    else applyBlendedPose(phase, walkWeight);
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

  return { mesh, legs, arms, torso, neck, skirtFront, skirtBack, applyPose,
    dispose: () => { for (const object of skinned) object.skeleton.dispose(); } };
}
