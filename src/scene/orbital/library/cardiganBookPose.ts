import { MathUtils, Matrix4, Quaternion, Vector3, type Bone, type Object3D, type SkinnedMesh } from 'three';
import { placeLimbEnd, RESIDENT_SCALE } from '../residentRig';
import { bookCoverGripPose, bookPose, CARDIGAN_CLOSED_COVER_INSET } from './bookMotion';
import { applyLibraryBookMotion, libraryCoverFlow, type LibraryMotion, type LibrarySample } from './libraryMotion';
import type { LibraryFlow } from './useLibrary';

function createRaisedBookReach(mesh: Object3D, chain: Bone[], index: Bone, pinky: Bone) {
  const [upper, elbow, hand] = chain;
  const skin = mesh.getObjectByName('Luna_Cardigan_Surface') as SkinnedMesh;
  const { skeleton } = skin;
  const bindMatrix = new Matrix4(), basis = new Matrix4();
  const bindRotation = (joint: Object3D) => new Quaternion().setFromRotationMatrix(
    basis.extractRotation(bindMatrix.copy(skeleton.boneInverses[skeleton.bones.indexOf(joint as Bone)]).invert()),
  );
  const upperBind = bindRotation(upper.parent!).invert().multiply(bindRotation(upper));
  const shoulder = new Vector3(), elbowPoint = new Vector3(), wrist = new Vector3();
  const upperAxis = new Vector3(), lowerAxis = new Vector3(), direction = new Vector3();
  const bend = new Vector3(), guide = new Vector3(), palmAcross = new Vector3(), bendPlane = new Vector3();
  const upperRotation = new Quaternion(), lowerRotation = new Quaternion(), handRotation = new Quaternion();
  const targetRotation = new Quaternion(), rotation = new Quaternion(), inverse = new Quaternion();
  const { smoothstep } = MathUtils;

  function setWorldRotation(joint: Bone, world: Quaternion) {
    joint.quaternion.copy(joint.parent!.getWorldQuaternion(inverse).normalize().invert()).multiply(world);
  }

  return (p: number) => {
    if (p <= .07 || p >= .82) return;
    hand.getWorldPosition(wrist);
    upper.getWorldPosition(shoulder);
    elbow.getWorldPosition(elbowPoint);
    const elbowWeight = .65 * smoothstep(p, .12, .27) * (1 - smoothstep(p, .43, .82));
    if (elbowWeight > 0) {
      // Let the elbow lead a little lower while the wrist follows the same lift path.
      direction.copy(wrist).sub(shoulder).normalize();
      bend.copy(elbowPoint).sub(shoulder).projectOnPlane(direction).normalize();
      guide.set(-.65, -.9, -.10).applyQuaternion(mesh.getWorldQuaternion(rotation)).projectOnPlane(direction).normalize();
      placeLimbEnd(chain, wrist, hand.getWorldQuaternion(handRotation), bend.lerp(guide, elbowWeight).normalize());
      elbow.getWorldPosition(elbowPoint);
      hand.getWorldPosition(wrist);
    }

    upperAxis.copy(elbowPoint).sub(shoulder).normalize();
    lowerAxis.copy(wrist).sub(elbowPoint).normalize();
    elbow.getWorldQuaternion(lowerRotation).normalize();
    hand.getWorldQuaternion(handRotation).normalize();
    // Remove excess upper-arm roll without moving the elbow or rotating the forearm with it.
    targetRotation.copy(upper.parent!.getWorldQuaternion(rotation)).multiply(upperBind);
    direction.copy(elbow.position).normalize().applyQuaternion(targetRotation);
    targetRotation.premultiply(rotation.setFromUnitVectors(direction, upperAxis));
    upper.getWorldQuaternion(upperRotation).normalize();
    const sleeveWeight = .8 * smoothstep(p, .07, .40) * (1 - smoothstep(p, .68, .82));
    const upperTurn = upperRotation.angleTo(targetRotation);
    upperRotation.slerp(targetRotation, Math.min(sleeveWeight, .75 / Math.max(.001, upperTurn)));
    setWorldRotation(upper, upperRotation);
    setWorldRotation(elbow, lowerRotation);

    // Aim the palm toward the upcoming grip and share that roll with the sleeve.
    bendPlane.crossVectors(upperAxis, lowerAxis).normalize();
    index.getWorldPosition(palmAcross).sub(pinky.getWorldPosition(direction)).projectOnPlane(lowerAxis).normalize();
    const roll = Math.atan2(lowerAxis.dot(guide.crossVectors(bendPlane, palmAcross)), bendPlane.dot(palmAcross));
    const palmWeight = smoothstep(p, .13, .26) * (1 - smoothstep(p, .44, .76));
    const turn = (MathUtils.clamp(roll, -Math.PI / 3, .35) - roll) * palmWeight;
    // Ease the forearm into the lift so the outer elbow follows the fuller sleeve.
    const forearmTwist = 0.7 * smoothstep(p, .14, .27) * (1 - smoothstep(p, .32, .45));
    if (turn === 0 && forearmTwist === 0) return;
    lowerRotation.premultiply(rotation.setFromAxisAngle(lowerAxis, .38 * turn - forearmTwist));
    setWorldRotation(elbow, lowerRotation);
    handRotation.premultiply(rotation.setFromAxisAngle(lowerAxis, turn));
    setWorldRotation(hand, handRotation);
  };
}

/** Align the fitted book animation to the cardigan's different hand bind frame. */
export function createCardiganBookPose(mesh: Object3D) {
  const joint = (part: string) => mesh.getObjectByName(`mixamorigRight${part}`) as Bone;
  const hand = joint('Hand'), elbow = joint('ForeArm');
  const chain = [joint('Arm'), elbow, hand];
  const middle = joint('HandMiddle1'), index = joint('HandIndex1'), pinky = joint('HandPinky1');
  const fitRaisedReach = createRaisedBookReach(mesh, chain, index, pinky);
  const across = index.position.clone().sub(pinky.position);
  const back = middle.position.clone().normalize().negate();
  const normal = back.clone().cross(across).normalize();
  const sideways = back.clone().cross(normal);
  const palmBasisInverse = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(sideways, back, normal)).invert();
  const palmOffset = new Vector3(0, -.55 * middle.position.length() * RESIDENT_SCALE, .018);
  const closed = bookCoverGripPose(0, CARDIGAN_CLOSED_COVER_INSET);
  const wrist = new Vector3(), goal = new Vector3(), armDirection = new Vector3(), fingers = new Vector3();
  const rotation = new Quaternion(), palmRotation = new Quaternion(), targetRotation = new Quaternion();
  const wristRotation = new Quaternion(), inverseParent = new Quaternion();

  return (scene: string, flow: LibraryFlow, motion: LibraryMotion, sample: LibrarySample, raisedReach = false) => {
    const { book, phase, progress } = flow;
    if (!book) return;
    if (phase === 'reach' || phase === 'release') {
      // Ease out of the standing pose and finish before the fingers reach the spine.
      const approach = phase === 'reach' ? progress : 1 - progress;
      const free = MathUtils.smoothstep(approach, 0, .15) * (1 - MathUtils.smoothstep(approach, .55, .83));
      if (!free) return;
      hand.getWorldPosition(wrist);
      armDirection.copy(wrist).sub(elbow.getWorldPosition(goal)).normalize();
      fingers.copy(middle.getWorldPosition(goal)).sub(wrist).normalize();
      const bend = fingers.angleTo(armDirection);
      const correction = .78 * free * MathUtils.smoothstep(bend, Math.PI / 6, Math.PI / 3);
      if (correction > 0) {
        rotation.identity().slerp(targetRotation.setFromUnitVectors(fingers, armDirection), correction);
        hand.getWorldQuaternion(wristRotation);
        hand.quaternion.copy(elbow.getWorldQuaternion(inverseParent).invert()).multiply(rotation).multiply(wristRotation);
      }
      if (raisedReach) fitRaisedReach(approach);
      return;
    }

    // Once the left hand supports the book, bring the right palm onto the closed cover.
    // During the handoff, fade this fit out with the baked pose as cover IK takes over.
    let weight = sample.coverProgress === undefined ? 0 : sample.weight;
    if (phase === 'carry' || phase === 'return-carry') {
      const carry = phase === 'carry' ? progress : 1 - progress;
      weight = MathUtils.smoothstep(carry, .74, .98);
    }
    if (weight <= 0) return;
    const pose = bookPose(scene, book, libraryCoverFlow(flow, sample), true);
    applyLibraryBookMotion(motion, scene, book, sample, pose.position, pose.quaternion);
    palmRotation.copy(closed.quaternion).premultiply(pose.quaternion);
    targetRotation.copy(palmRotation).multiply(palmBasisInverse);
    goal.copy(closed.position).applyQuaternion(pose.quaternion).add(pose.position);
    if (scene === 'observatory') goal.x += 14;
    goal.sub(armDirection.copy(palmOffset).applyQuaternion(palmRotation));
    hand.getWorldPosition(wrist).lerp(goal, weight);
    hand.getWorldQuaternion(wristRotation).slerp(targetRotation, weight);
    placeLimbEnd(chain, wrist, wristRotation);
  };
}
