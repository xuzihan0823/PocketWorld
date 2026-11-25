import { MathUtils, Matrix4, Quaternion, Vector3, type Bone } from 'three';
import type { ResidentRig } from './ResidentModel';
import type { ResidentOutfit } from './wardrobe/outfit';
import { CHAIR_LEG_SWING, SEATED_IDLE_FPS, SOFA_CHEEK_REST } from './seatedIdleFrames';

type SeatedIdleKind = 'sofa' | 'chair' | 'floor';
type SeatedOverlay = 'sofaDoze' | 'chairGlance' | 'floorGlance';
type SeatedClips = Partial<Record<SeatedOverlay, { duration: number }>>;
const sampleDuration = (samples: readonly number[]) => (samples.length / 2 - 1) / SEATED_IDLE_FPS;
const procedural = {
  cheekRest: { duration: sampleDuration(SOFA_CHEEK_REST), fadeIn: 1.65, fadeOut: 1.15 },
  legStretch: { duration: 7.6, fadeIn: 1.65, fadeOut: 1.7 },
  chairSwing: { duration: sampleDuration(CHAIR_LEG_SWING), fadeIn: .35, fadeOut: .35 },
};
type SeatedGesture = keyof typeof procedural | SeatedOverlay;
const motions = {
  sofa: { gestures: ['cheekRest', 'legStretch', 'sofaDoze'], delay: 0, rest: 4.2 },
  chair: { gestures: ['chairSwing', 'chairGlance'], delay: .75, rest: 4.6 },
  floor: { gestures: ['floorGlance'], delay: 5.5, rest: 13 },
} as const;

export function isSeatedOverlay(gesture: SeatedGesture | null): gesture is SeatedOverlay {
  return gesture === 'sofaDoze' || gesture === 'chairGlance' || gesture === 'floorGlance';
}

export function createSeatedIdle() {
  return { seat: null as SeatedIdleKind | null, gesture: null as SeatedGesture | null,
    time: 0, weight: 0, release: 0 };
}

export function seatedIdleWeight(idle: ReturnType<typeof createSeatedIdle>) {
  return idle.weight * (1 - MathUtils.smoothstep(idle.release, 0, 1));
}

/** Keep the last seated pose under an interrupted gesture until it returns to neutral. */
export function stepSeatedIdle(
  idle: ReturnType<typeof createSeatedIdle>,
  dt: number,
  seat: SeatedIdleKind | null,
  exiting: boolean,
  clips?: SeatedClips,
) {
  if (seat !== idle.seat) {
    Object.assign(idle, createSeatedIdle());
    idle.seat = seat;
    if (seat) {
      idle.time = -motions[seat].delay;
      idle.gesture = motions[seat].gestures[0];
    }
  }
  const gesture = idle.gesture;
  if (!seat || !gesture) return false;
  if (exiting) {
    if (idle.weight === 0) return false;
    const releaseTime = seat === 'sofa' ? .32 + .48 * idle.weight : .32;
    idle.release = Math.min(1, idle.release + dt / releaseTime);
    if (idle.release < 1) return true;
    idle.weight = 0;
    return false;
  }
  const { gestures, rest } = motions[seat];
  const overlay = isSeatedOverlay(gesture);
  const timing = overlay ? undefined : procedural[gesture];
  const length = overlay ? clips?.[gesture]?.duration ?? 0 : procedural[gesture].duration;
  idle.release = 0;
  idle.time += dt;
  if (idle.time >= length) {
    idle.time -= length + rest;
    const cycle: readonly SeatedGesture[] = gestures;
    const next = cycle[(cycle.indexOf(gesture) + 1) % cycle.length];
    idle.gesture = isSeatedOverlay(next) && !clips?.[next] ? cycle[0] : next;
    idle.weight = 0;
    return false;
  }
  idle.weight = MathUtils.smoothstep(idle.time, 0, timing?.fadeIn ?? .85)
    * (1 - MathUtils.smoothstep(idle.time, length - (timing?.fadeOut ?? .85) - .05, length));
  return false;
}

const cheekContact: Record<ResidentOutfit, [number, number, number]> = {
  everyday: [.053, .014, -.045],
  ribbon: [.053, .014, -.045],
  cardigan: [.058, .018, -.055],
};

export function createSeatedIdlePlayer(rig: ResidentRig, outfit: ResidentOutfit) {
  const bone = (name: string) => rig.mesh.getObjectByName('mixamorig' + name) as Bone;
  const spine = [bone('Spine'), bone('Spine1'), bone('Spine2')];
  const neck = bone('Neck'), head = bone('Head');
  function arm(side: 'Left' | 'Right') {
    const hand = bone(side + 'Hand');
    const middle = hand.worldToLocal(bone(side + 'HandMiddle1').getWorldPosition(new Vector3()));
    const across = hand.worldToLocal(bone(side + 'HandIndex1').getWorldPosition(new Vector3()))
      .sub(hand.worldToLocal(bone(side + 'HandPinky1').getWorldPosition(new Vector3())));
    const fingers = middle.clone().normalize();
    const palm = fingers.clone().cross(across).normalize().multiplyScalar(side === 'Left' ? 1 : -1);
    across.crossVectors(fingers, palm).normalize();
    const inversePalm = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(across, fingers, palm)).invert();
    return {
      upper: bone(side + 'Arm'), forearm: bone(side + 'ForeArm'), hand, inversePalm,
      palmContact: middle.multiplyScalar(.57).addScaledVector(palm, .009),
      start: new Vector3(), rotation: new Quaternion(),
    };
  }
  const left = arm('Left'), right = arm('Right');
  const leftHip = bone('LeftUpLeg'), leftKnee = bone('LeftLeg');
  const rightHip = bone('RightUpLeg'), rightKnee = bone('RightLeg');
  const freeHandOnLap = outfit === 'cardigan';
  const legs = (['Left', 'Right'] as const).map((side, i) => ({
    thigh: i === 0 ? leftHip : rightHip, shin: i === 0 ? leftKnee : rightKnee, foot: bone(side + 'Foot'),
    frontHem: rig.mesh.getObjectByName(i === 0 ? 'Dress_Front_L_01' : 'Dress_Front_R_01') as Bone | undefined,
  }));
  const centerHem = rig.mesh.getObjectByName('Dress_Front_01') as Bone | undefined;
  const point = new Vector3();
  const basis = new Matrix4();
  const cheek = new Vector3(...cheekContact[outfit]);
  const cheekNormal = new Vector3(.55, -.71, -.44).normalize();
  const cheekTangent = new Vector3(.20, .41, .89);
  cheekTangent.addScaledVector(cheekNormal, -cheekTangent.dot(cheekNormal)).normalize();

  const room = new Quaternion(), parent = new Quaternion(), inverseParent = new Quaternion(), turn = new Quaternion();
  const headStart = new Quaternion(), handPose = new Quaternion(), wristTwist = new Quaternion();
  const roomX = new Vector3(), roomY = new Vector3(), roomZ = new Vector3();
  const target = new Vector3(), bend = new Vector3();
  const shoulder = new Vector3(), elbow = new Vector3(), wrist = new Vector3(), line = new Vector3();
  const upperDirection = new Vector3(), lowerDirection = new Vector3(), solvedElbow = new Vector3();
  const normal = new Vector3(), tangent = new Vector3(), cross = new Vector3(), scale = new Vector3();

  function rotate(joint: Bone, worldAxis: Vector3, angle: number) {
    point.copy(worldAxis).applyQuaternion(joint.parent!.getWorldQuaternion(parent).invert());
    joint.quaternion.premultiply(turn.setFromAxisAngle(point, angle));
  }

  function aim(joint: Bone, from: Vector3, to: Vector3) {
    turn.setFromUnitVectors(from.normalize(), to.normalize());
    joint.parent!.getWorldQuaternion(parent);
    turn.premultiply(inverseParent.copy(parent).invert()).multiply(parent);
    joint.quaternion.premultiply(turn);
  }

  function solveHand(chain: ReturnType<typeof arm>, weight: number) {
    const { upper, forearm, hand, inversePalm, palmContact, start, rotation } = chain;
    cross.crossVectors(tangent, normal);
    handPose.setFromRotationMatrix(basis.makeBasis(cross, tangent, normal)).multiply(inversePalm);
    hand.getWorldScale(scale);
    target.sub(point.copy(palmContact).multiply(scale).applyQuaternion(handPose));
    const side = chain === left ? 1 : -1;
    target.lerp(start, 1 - weight).addScaledVector(roomX, side * Math.sin(weight * Math.PI) * .06);

    upper.getWorldPosition(shoulder);
    forearm.getWorldPosition(elbow);
    hand.getWorldPosition(wrist);
    upperDirection.subVectors(elbow, shoulder);
    lowerDirection.subVectors(wrist, elbow);
    const upperLength = upperDirection.length(), lowerLength = lowerDirection.length();
    line.subVectors(target, shoulder);
    const reach = MathUtils.clamp(line.length(), Math.abs(upperLength - lowerLength) + .001, upperLength + lowerLength - .001);
    line.normalize();
    bend.lerp(elbow, 1 - weight).sub(shoulder);
    bend.addScaledVector(line, -bend.dot(line)).normalize();
    const along = (upperLength ** 2 - lowerLength ** 2 + reach ** 2) / (2 * reach);
    solvedElbow.copy(shoulder).addScaledVector(line, along)
      .addScaledVector(bend, Math.sqrt(Math.max(0, upperLength ** 2 - along ** 2)));
    aim(upper, upperDirection, point.subVectors(solvedElbow, shoulder));
    forearm.getWorldPosition(elbow);
    hand.getWorldPosition(wrist);
    aim(forearm, lowerDirection.subVectors(wrist, elbow), point.copy(shoulder).addScaledVector(line, reach).sub(elbow));
    // Share pronation along the forearm so the cuff does not take the whole twist.
    rotation.slerp(handPose, weight);
    hand.getWorldPosition(wrist);
    lowerDirection.subVectors(wrist, elbow).normalize();
    wristTwist.copy(rotation).multiply(hand.getWorldQuaternion(inverseParent).invert());
    const projection = wristTwist.x * lowerDirection.x + wristTwist.y * lowerDirection.y + wristTwist.z * lowerDirection.z;
    const pronation = 2 * Math.atan2(wristTwist.w < 0 ? -projection : projection, Math.abs(wristTwist.w));
    rotate(forearm, lowerDirection, MathUtils.clamp(pronation * .65, -.95, .95));
    hand.quaternion.copy(forearm.getWorldQuaternion(parent).invert()).multiply(rotation);
  }

  function restOnCheek(weight: number, yaw: number) {
    if (weight <= 0) return;
    head.getWorldQuaternion(headStart);
    left.hand.getWorldPosition(left.start);
    left.hand.getWorldQuaternion(left.rotation);
    right.hand.getWorldPosition(right.start);
    right.hand.getWorldQuaternion(right.rotation);
    rotate(spine[0], roomX, .56 * weight);
    rotate(spine[0], roomZ, -.16 * weight);
    rotate(spine[1], roomX, .14 * weight);
    rotate(spine[2], roomX, .08 * weight);
    rotate(neck, roomX, -.17 * weight);
    headStart.premultiply(turn.setFromAxisAngle(roomX, .53 * weight))
      .premultiply(turn.setFromAxisAngle(roomZ, -.24 * weight))
      .premultiply(turn.setFromAxisAngle(roomY, yaw * weight));
    head.quaternion.copy(head.parent!.getWorldQuaternion(parent).invert()).multiply(headStart);

    normal.copy(cheekNormal).applyQuaternion(headStart).negate();
    tangent.copy(cheekTangent).applyQuaternion(headStart);
    head.localToWorld(target.copy(cheek));
    leftHip.getWorldPosition(bend).lerp(leftKnee.getWorldPosition(point), .58)
      .addScaledVector(roomX, .04).addScaledVector(roomY, .075);
    solveHand(left, weight);

    right.upper.getWorldPosition(bend)
      .addScaledVector(roomY, -.15).addScaledVector(roomX, -.14);
    if (freeHandOnLap) {
      // The cardigan cuff needs more space than the dress sleeves when the arms cross.
      rightHip.getWorldPosition(target).lerp(rightKnee.getWorldPosition(point), .46)
        .addScaledVector(roomY, .076).addScaledVector(roomX, -.024);
      normal.copy(roomY).negate();
      tangent.copy(roomZ).addScaledVector(roomX, .20).normalize();
    } else {
      left.forearm.getWorldPosition(target)
        .addScaledVector(roomY, -.03).addScaledVector(roomX, -.01);
      normal.copy(roomY);
      tangent.copy(roomX).addScaledVector(roomZ, .36).normalize();
    }
    solveHand(right, weight);
  }

  function stretchLegs(time: number, weight: number) {
    // Straighten first, then rock the extended legs twice with a small phase difference.
    const sway = MathUtils.smoothstep(time, 1.5, 2.1) * (1 - MathUtils.smoothstep(time, 5.9, 6.5));
    const phase = (time - 1.7) * (2 * Math.PI / 2.2);
    let highestLift = 0;
    legs.forEach(({ thigh, shin, foot, frontHem }, i) => {
      shin.getWorldPosition(point);
      thigh.getWorldPosition(upperDirection).sub(point).negate();
      foot.getWorldPosition(lowerDirection).sub(point);
      const extension = Math.max(0, upperDirection.angleTo(lowerDirection) - .10) * weight;
      const lift = (.26 + .125 * sway * Math.sin(phase - i * .6)) * weight;
      rotate(thigh, roomX, -lift);
      rotate(shin, roomX, -extension);
      rotate(foot, roomX, .76 * (extension + lift));
      if (frontHem) rotate(frontHem, roomX, -lift);
      highestLift = Math.max(highestLift, lift);
    });
    if (centerHem) rotate(centerHem, roomX, -highestLift);
  }

  return (idle: ReturnType<typeof createSeatedIdle>) => {
    const gesture = idle.gesture;
    if (!gesture || isSeatedOverlay(gesture) || !idle.weight) return;
    const weight = seatedIdleWeight(idle);
    rig.mesh.getWorldQuaternion(room);
    roomX.set(1, 0, 0).applyQuaternion(room);
    if (gesture === 'legStretch') {
      stretchLegs(idle.time, weight);
      return;
    }
    const samples = gesture === 'chairSwing' ? CHAIR_LEG_SWING : SOFA_CHEEK_REST;
    const frame = MathUtils.clamp(idle.time, 0, procedural[gesture].duration) * SEATED_IDLE_FPS;
    const start = Math.floor(frame), end = Math.min(start + 1, samples.length / 2 - 1);
    const first = MathUtils.lerp(samples[start * 2], samples[end * 2], frame - start);
    const second = MathUtils.lerp(samples[start * 2 + 1], samples[end * 2 + 1], frame - start);
    if (gesture === 'chairSwing') {
      legs.forEach(({ shin, foot }, index) => {
        const swing = (index === 0 ? first : second) * weight;
        rotate(shin, roomX, swing);
        rotate(foot, roomX, -.32 * swing);
      });
    } else {
      roomY.set(0, 1, 0).applyQuaternion(room);
      roomZ.set(0, 0, 1).applyQuaternion(room);
      restOnCheek(MathUtils.smoothstep(first, 0, 1) * weight, second);
    }
  };
}
