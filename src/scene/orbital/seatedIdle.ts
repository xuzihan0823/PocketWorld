import { MathUtils, Matrix4, Quaternion, Vector3, type Bone } from 'three';
import type { ResidentRig } from './ResidentModel';
import type { ResidentOutfit } from './wardrobe/outfit';
import { CHAIR_LEG_SWING, SEATED_IDLE_FPS, SOFA_CHEEK_REST } from './seatedIdleFrames';

type SeatedIdleKind = 'sofa' | 'chair' | 'floor';
type SeatedOverlay = 'sofaDoze' | 'chairGlance' | 'floorGlance';
type SeatedClips = Partial<Record<SeatedOverlay, { duration: number }>>;
const motions = {
  sofa: { samples: SOFA_CHEEK_REST, delay: 1.1, rest: 7.2, overlay: 'sofaDoze' },
  chair: { samples: CHAIR_LEG_SWING, delay: .75, rest: 4.6, overlay: 'chairGlance' },
  floor: { samples: null, delay: 5.5, rest: 13, overlay: 'floorGlance' },
} as const;
const duration = (samples: readonly number[]) => (samples.length / 2 - 1) / SEATED_IDLE_FPS;

export function createSeatedIdle() {
  return { seat: null as SeatedIdleKind | null, overlay: null as SeatedOverlay | null,
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
      if (seat === 'floor') idle.overlay = motions.floor.overlay;
    }
  }
  if (!seat) return false;
  if (exiting) {
    if (idle.weight === 0) return false;
    idle.release = Math.min(1, idle.release + dt / .32);
    if (idle.release < 1) return true;
    idle.weight = 0;
    return false;
  }
  const { samples, rest, overlay } = motions[seat];
  const length = idle.overlay ? clips?.[idle.overlay]?.duration ?? 0 : samples ? duration(samples) : 0;
  idle.release = 0;
  idle.time += dt;
  if (idle.time >= length) {
    idle.time -= length + rest;
    idle.overlay = seat === 'floor' || (!idle.overlay && clips?.[overlay]) ? overlay : null;
    idle.weight = 0;
    return false;
  }
  const blend = idle.overlay ? .85 : .35;
  idle.weight = MathUtils.smoothstep(idle.time, 0, blend)
    * (1 - MathUtils.smoothstep(idle.time, length - blend - .05, length));
  return false;
}

const lapContact: Record<ResidentOutfit, [alongThigh: number, height: number]> = {
  everyday: [.64, .137],
  ribbon: [.55, .043],
  cardigan: [.58, .068],
};

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
      restHand: hand.quaternion.clone(),
      hip: bone(side + 'UpLeg'), knee: bone(side + 'Leg'), side: side === 'Left' ? 1 : -1,
      palmContact: middle.multiplyScalar(.57).addScaledVector(palm, .009),
      start: new Vector3(), rotation: new Quaternion(),
    };
  }
  const left = arm('Left'), right = arm('Right');
  const [lapAlong, lapHeight] = lapContact[outfit];
  const legs = (['Left', 'Right'] as const).map(side => ({ shin: bone(side + 'Leg'), foot: bone(side + 'Foot') }));
  const point = new Vector3();
  const basis = new Matrix4();
  const cheek = new Vector3(...cheekContact[outfit]);
  const thigh = new Vector3(), thighUp = new Vector3();

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
    const { upper, forearm, hand, inversePalm, palmContact, start, restHand, rotation, side } = chain;
    hand.getWorldPosition(start);
    hand.getWorldQuaternion(rotation);
    cross.crossVectors(tangent, normal);
    handPose.setFromRotationMatrix(basis.makeBasis(cross, tangent, normal)).multiply(inversePalm);
    hand.getWorldScale(scale);
    target.sub(point.copy(palmContact).multiply(scale).applyQuaternion(handPose));
    target.lerp(start, 1 - weight).addScaledVector(roomX, side * Math.sin(weight * Math.PI) * .04);

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
    forearm.getWorldQuaternion(parent).multiply(restHand);
    wristTwist.copy(rotation).multiply(parent.invert());
    const projection = wristTwist.x * lowerDirection.x + wristTwist.y * lowerDirection.y + wristTwist.z * lowerDirection.z;
    const pronation = 2 * Math.atan2(wristTwist.w < 0 ? -projection : projection, Math.abs(wristTwist.w));
    rotate(forearm, lowerDirection, MathUtils.clamp(pronation * .88, -1.36, 1.36) * weight);
    hand.quaternion.copy(forearm.getWorldQuaternion(parent).invert()).multiply(rotation);
  }

  function restOnThigh(chain: ReturnType<typeof arm>, weight: number) {
    chain.hip.getWorldPosition(target);
    chain.knee.getWorldPosition(point);
    thigh.subVectors(point, target).normalize();
    thighUp.copy(roomY).projectOnPlane(thigh).normalize();
    target.lerp(point, lapAlong).addScaledVector(thighUp, lapHeight).addScaledVector(roomX, chain.side * .012);
    normal.copy(thighUp).negate();
    tangent.copy(thigh).addScaledVector(roomX, -chain.side * .13).projectOnPlane(normal).normalize();
    chain.upper.getWorldPosition(bend).addScaledVector(roomY, -.21)
      .addScaledVector(roomZ, -.08).addScaledVector(roomX, chain.side * .055);
    solveHand(chain, weight);
  }

  function leanOnSeat(lap: number, weight: number, yaw: number) {
    head.getWorldQuaternion(headStart);
    rotate(spine[0], roomX, .34 * lap + .22 * weight);
    rotate(spine[0], roomZ, -.16 * weight);
    rotate(spine[1], roomX, .12 * lap + .02 * weight);
    rotate(spine[2], roomX, .045 * lap + .035 * weight);
    rotate(neck, roomX, -.17 * weight);
    headStart.premultiply(turn.setFromAxisAngle(roomX, .53 * weight))
      .premultiply(turn.setFromAxisAngle(roomZ, -.24 * weight))
      .premultiply(turn.setFromAxisAngle(roomY, yaw * weight));
    head.quaternion.copy(head.parent!.getWorldQuaternion(parent).invert()).multiply(headStart);
  }

  function supportCheek(weight: number) {
    // Cup the side of the jaw with an upward finger line and a tucked elbow.
    normal.copy(roomX).negate().addScaledVector(roomY, .30).addScaledVector(roomZ, -.28).normalize();
    tangent.copy(roomY).addScaledVector(roomZ, .30).projectOnPlane(normal).normalize();
    head.localToWorld(target.copy(cheek)).addScaledVector(roomX, .004).addScaledVector(roomY, -.025);
    left.hip.getWorldPosition(bend).lerp(left.knee.getWorldPosition(point), .49)
      .addScaledVector(roomX, .068).addScaledVector(roomY, .065);
    solveHand(left, weight);
  }

  return (idle: ReturnType<typeof createSeatedIdle>, lapWeight: number) => {
    const gesture = !!idle.weight && !idle.overlay;
    if (lapWeight <= 0 && !(gesture && idle.seat === 'chair')) return;
    const { samples } = motions[idle.seat === 'chair' ? 'chair' : 'sofa'];
    const frame = MathUtils.clamp(idle.time, 0, duration(samples)) * SEATED_IDLE_FPS;
    const start = Math.floor(frame), end = Math.min(start + 1, samples.length / 2 - 1);
    const first = MathUtils.lerp(samples[start * 2], samples[end * 2], frame - start);
    const second = MathUtils.lerp(samples[start * 2 + 1], samples[end * 2 + 1], frame - start);
    const weight = seatedIdleWeight(idle);
    rig.mesh.getWorldQuaternion(room);
    roomX.set(1, 0, 0).applyQuaternion(room);
    if (idle.seat === 'chair') {
      legs.forEach(({ shin, foot }, index) => {
        const swing = (index === 0 ? first : second) * weight;
        rotate(shin, roomX, swing);
        rotate(foot, roomX, -.32 * swing);
      });
    } else {
      roomY.set(0, 1, 0).applyQuaternion(room);
      roomZ.set(0, 0, 1).applyQuaternion(room);
      const cheekWeight = gesture && idle.seat === 'sofa' ? MathUtils.smoothstep(first, 0, 1) * weight : 0;
      leanOnSeat(lapWeight, cheekWeight, second);
      restOnThigh(left, lapWeight);
      restOnThigh(right, lapWeight);
      if (cheekWeight > 0) supportCheek(cheekWeight);
      rig.relaxFingers(lapWeight);
    }
  };
}
