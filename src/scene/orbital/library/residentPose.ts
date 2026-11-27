import * as THREE from 'three';
import { PAGE_TURN_AUTHORED } from './pageTurnFrames';
import type { ResidentRig } from '../ResidentModel';
import type { LibraryFlow } from './useLibrary';
import {
  authoredBookStand,
  libraryHeldBalance,
  bookCoverGripPose,
  bookGrabLocal,
  bookGrabSide,
  bookHalfStepOffset,
  bookPose,
  bookWingPoint,
  coverOpenCurve,
  smooth,
  bookSupportPose,
  turningHandPose,
} from './bookMotion';
import { shelfPoint, shelfVector, slotFor } from './catalog';
import { applyTorsoAndGazeIK, reachPalm, resetArms } from './armPose';

const point = new THREE.Vector3();

function makePalmQuat(px: THREE.Vector3, py: THREE.Vector3, pz: THREE.Vector3, bookQuat: THREE.Quaternion) {
  const x = px.clone().normalize();
  const z = pz.clone().normalize();
  const y = new THREE.Vector3().crossVectors(z, x).normalize();
  z.crossVectors(x, y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)).premultiply(bookQuat);
}

function shelfGrabOrientation(side: 0 | 1, bookQuat: THREE.Quaternion) {
  // Fingers (-Y_palm) point into shelf (+X_book angled slightly up +Z_book).
  // Palm (+Z_palm) presses inward against the book's outer side (+Y_book for Right, -Y_book for Left) angled slightly toward spine.
  const fingerDir = new THREE.Vector3(0.94, 0, 0.34).normalize();
  const palmY = fingerDir.negate();
  const palmZ = new THREE.Vector3(0.32, side === 0 ? 0.947 : -0.947, 0).normalize();
  const palmX = new THREE.Vector3().crossVectors(palmY, palmZ).normalize();
  return makePalmQuat(palmX, palmY, palmZ, bookQuat);
}

function arcLerp(a: THREE.Vector3, b: THREE.Vector3, lift: THREE.Vector3, t: number) {
  const s = smooth(t);
  return new THREE.Vector3().lerpVectors(a, b, s).addScaledVector(lift, Math.sin(s * Math.PI));
}

function guidedArc(from: THREE.Vector3, guide: THREE.Vector3, to: THREE.Vector3, t: number) {
  return from.clone().lerp(guide, t).lerp(guide.clone().lerp(to, t), t);
}

export function applyLibraryPose(rig: ResidentRig, root: THREE.Group, scene: string, flow: LibraryFlow, dt: number, authored = false) {
  const phase = flow.phase;
  const p = THREE.MathUtils.clamp(flow.progress, 0, 1);
  const t = smooth(p);
  const originX = scene === 'observatory' ? 14 : 0;
  if (authored && flow.book && ['open', 'reading', 'turn', 'close'].includes(phase)) {
    const balance = libraryHeldBalance(flow);
    root.position.fromArray(authoredBookStand(scene, flow.book, true, balance.back));
    // The cardigan has a shorter left reach. Shift the planted body toward
    // the opposite corner while the left fingers carry the returning sheet.
    if (rig.mesh.userData.outfit === 'cardigan' && flow.phase === 'turn' && flow.direction < 0) {
      const reach = smooth((p - .10) / .20) * (1 - smooth((p - .42) / .20));
      root.position.add(new THREE.Vector3(...shelfVector(scene, .015 * reach, 0, -.016 * reach)));
    }
    root.position.y -= balance.drop;
  }
  rig.mesh.updateWorldMatrix(true, true);

  if (!flow.book || ['catalog', 'form', 'recenter', 'shelving'].includes(phase)) {
    resetArms(rig, 1 - Math.exp(-dt * 9));
    return;
  }

  const slot = slotFor(flow.book);
  const book = bookPose(scene, flow.book, flow, authored);
  const shelfOffset = (x: number, y: number, z: number) => new THREE.Vector3(...shelfVector(scene, x, y, z));
  const grabSide = bookGrabSide(flow.book);
  const otherSide = (1 - grabSide) as 0 | 1;
  const grabLocal = bookGrabLocal(flow.book);

  const contact = (x: number, y: number, z: number) =>
    new THREE.Vector3(x, y, z).applyQuaternion(book.quaternion).add(book.position).add(new THREE.Vector3(originX, 0, 0));
  const contactVec = (v: THREE.Vector3) => contact(v.x, v.y, v.z);

  // Natural angled palm-up support aligned with each forearm (fingers point slightly inward toward spine).
  const supportOrientationFor = (side: 0 | 1) => bookSupportPose(side).quaternion.premultiply(book.quaternion);
  const rightSupportOrientation = supportOrientationFor(0);
  const leftSupportOrientation = supportOrientationFor(1);
  const supportOrientation = bookSupportPose(1, 0).quaternion.premultiply(book.quaternion);
  const grabQuat = shelfGrabOrientation(grabSide, book.quaternion);
  const grabWorld = contactVec(grabLocal);
  const bookCenterWorld = contact(0.11 * book.open, 0.03, 0);

  // Determine natural torso posture and gaze target for each phase.
  let gazeTarget: THREE.Vector3 | null = grabWorld;
  let gazeWeight = 1;
  let torsoPitch = 0;
  let torsoYaw = 0;
  let torsoRoll = 0;

  const restWorldOf = (s: 0 | 1) => rig.mesh.localToWorld(rig.arms[s].restWrist.clone().add(rig.arms[s].palmOffset));
  const shelfShoulderWeight = slot.row === 2 ? 1.0 : slot.row === 1 ? 0.55 : 0.45;
  const shelfTorsoPitch = slot.row === 2 ? -0.07 : slot.row === 0 ? -0.17 : -0.09;
  const shelfTorsoYaw = grabSide === 1 ? 0.14 : -0.14;

  if (phase === 'align') {
    gazeTarget = grabWorld;
    gazeWeight = smooth((p - 0.15) / 0.85);
    torsoPitch = shelfTorsoPitch * 0.25 * gazeWeight;
    torsoYaw = shelfTorsoYaw * 0.25 * gazeWeight;
    applyTorsoAndGazeIK(rig, gazeTarget, torsoPitch, torsoYaw, 0, gazeWeight, dt);
    resetArms(rig, 1 - Math.exp(-dt * 8));
    return;
  }

  if (phase === 'reach') {
    const reachBlend = smooth((p - 0.06) / 0.80);
    const bodyLead = smooth(p / 0.55);
    torsoPitch = shelfTorsoPitch * bodyLead;
    torsoYaw = shelfTorsoYaw * bodyLead;
    applyTorsoAndGazeIK(rig, grabWorld, torsoPitch, torsoYaw, 0, 1, dt);

    const pinchOffset = rig.arms[grabSide].palmOffset.clone().lerp(rig.arms[grabSide].fingerTipOffset ?? rig.arms[grabSide].palmOffset, 0.48);
    const restWorld = rig.mesh.localToWorld(rig.arms[grabSide].restWrist.clone().add(pinchOffset));
    const preGrab = contact(grabLocal.x - 0.055, grabLocal.y + (grabSide ? 0.015 : -0.015), grabLocal.z - 0.02);
    if (p < 0.65) {
      const u = smooth(p / 0.65);
      point.lerpVectors(restWorld, preGrab, u).add(shelfOffset(grabSide ? -0.03 : 0.03, -0.02, 0.03).multiplyScalar(Math.sin(u * Math.PI)));
    } else {
      const u = smooth((p - 0.65) / 0.23);
      point.lerpVectors(preGrab, grabWorld, u);
    }
    const gripCurl = p < 0.84 ? 0.15 * reachBlend : THREE.MathUtils.lerp(0.15, 0.48, smooth((p - 0.84) / 0.16));
    reachPalm(rig, rig.arms[grabSide], point, grabSide, {
      quaternion: grabQuat,
      blend: reachBlend,
      armBlend: smooth(p / 0.35),
      mode: 'pinch',
      shoulderWeight: shelfShoulderWeight * bodyLead,
      fingerCurl: gripCurl,
    });
    const otherIdentity = new THREE.Quaternion();
    rig.arms[otherSide].shoulder.quaternion.slerp(otherIdentity, 1 - Math.exp(-dt * 9));
    rig.arms[otherSide].upper.quaternion.slerp(otherIdentity, 1 - Math.exp(-dt * 9));
    rig.arms[otherSide].forearm.quaternion.slerp(otherIdentity, 1 - Math.exp(-dt * 9));
    rig.arms[otherSide].hand.quaternion.slerp(otherIdentity, 1 - Math.exp(-dt * 9));
    rig.arms[otherSide].setFingers?.(0.06);
    return;
  }

  if (phase === 'extract') {
    torsoPitch = shelfTorsoPitch;
    torsoYaw = shelfTorsoYaw * (1 - 0.2 * p);
    applyTorsoAndGazeIK(rig, grabWorld, torsoPitch, torsoYaw, 0, 1, dt);
    reachPalm(rig, rig.arms[grabSide], grabWorld, grabSide, {
      quaternion: grabQuat,
      blend: 1,
      mode: 'pinch',
      shoulderWeight: shelfShoulderWeight,
      fingerCurl: 0.48,
    });
    const otherIdentity = new THREE.Quaternion();
    rig.arms[otherSide].shoulder.quaternion.slerp(otherIdentity, 1 - Math.exp(-dt * 9));
    rig.arms[otherSide].upper.quaternion.slerp(otherIdentity, 1 - Math.exp(-dt * 9));
    rig.arms[otherSide].forearm.quaternion.slerp(otherIdentity, 1 - Math.exp(-dt * 9));
    rig.arms[otherSide].hand.quaternion.slerp(otherIdentity, 1 - Math.exp(-dt * 9));
    rig.arms[otherSide].setFingers?.(0.08);
    return;
  }

  const supportRelax = smooth(book.open / .4);
  const supportCurl = THREE.MathUtils.lerp(.04, -.12, supportRelax);
  const supportThumb = THREE.MathUtils.lerp(.024, -.5, supportRelax);
  const supportPole = (side: 0 | 1) => new THREE.Vector3(side ? .2 : -.2, -1.5, .6)
    .applyQuaternion(rig.mesh.getWorldQuaternion(new THREE.Quaternion()));
  const leftSupportClosed = contactVec(bookSupportPose(1, 0).position);
  const leftSupportOpen = contactVec(bookSupportPose(1).position);
  const rightSupportOpen = contactVec(bookSupportPose(0).position);
  const coverSlipGuide = contactVec(bookWingPoint(0, 1, 0.25, -0.025, -0.142));
  const coverClosedPose = bookCoverGripPose(0);
  const coverClosedWorld = contactVec(coverClosedPose.position);
  const coverClosedQuat = coverClosedPose.quaternion.clone().premultiply(book.quaternion);

  if (phase === 'carry') {
    torsoPitch = THREE.MathUtils.lerp(shelfTorsoPitch, -0.04, t);
    torsoYaw = THREE.MathUtils.lerp(shelfTorsoYaw * 0.8, 0, t);
    applyTorsoAndGazeIK(rig, bookCenterWorld, torsoPitch, torsoYaw, 0, 1, dt);

    // Smoothly bring Left hand (1) to cradle underneath and Right hand (0) onto cover edge ready to open.
    if (grabSide === 0) {
      // Right extracted -> holds spine until Left catches underneath, then shifts onto cover edge.
      const leftCatch = smooth((p - 0.10) / 0.68);
      const leftPos = arcLerp(restWorldOf(1), leftSupportClosed, shelfOffset(-0.04, -0.04, 0.05), leftCatch);
      reachPalm(rig, rig.arms[1], leftPos, 1, {
        quaternion: supportOrientation,
        blend: leftCatch,
        armBlend: smooth(leftCatch / 0.45),
        mode: 'palm',
        shoulderWeight: 0.15 * leftCatch,
        fingerCurl: THREE.MathUtils.lerp(0.05, 0.14, leftCatch),
      });
      const shift = smooth((p - 0.56) / 0.44);
      const rightPos = arcLerp(grabWorld, coverClosedWorld, shelfOffset(0.03, 0.05, 0.02), shift);
      const rightQuat = grabQuat.clone().slerp(coverClosedQuat, shift);
      reachPalm(rig, rig.arms[0], rightPos, 0, {
        quaternion: rightQuat,
        blend: 1,
        mode: shift > 0.5 ? 'palm' : 'pinch',
        shoulderWeight: shelfShoulderWeight * (1 - shift * 0.85),
        fingerCurl: THREE.MathUtils.lerp(0.48, 0.18, shift),
      });
    } else {
      // Left extracted -> slides from spine underneath book; Right catches and moves onto cover edge.
      const slide = smooth((p - 0.40) / 0.52);
      const leftPos = arcLerp(grabWorld, leftSupportClosed, shelfOffset(-0.03, -0.03, 0.01), slide);
      const leftQuat = grabQuat.clone().slerp(supportOrientation, slide);
      reachPalm(rig, rig.arms[1], leftPos, 1, {
        quaternion: leftQuat,
        blend: 1,
        mode: slide > 0.4 ? 'palm' : 'pinch',
        shoulderWeight: shelfShoulderWeight * (1 - slide * 0.85),
        fingerCurl: THREE.MathUtils.lerp(0.48, 0.14, slide),
      });
      const rightCatch = smooth((p - 0.16) / 0.72);
      const rightPos = arcLerp(restWorldOf(0), coverClosedWorld, shelfOffset(0.05, 0.04, 0.04), rightCatch);
      reachPalm(rig, rig.arms[0], rightPos, 0, {
        quaternion: coverClosedQuat,
        blend: rightCatch,
        armBlend: smooth(rightCatch / 0.45),
        mode: 'palm',
        shoulderWeight: 0.15 * rightCatch,
        fingerCurl: THREE.MathUtils.lerp(0.05, 0.18, rightCatch),
      });
    }
    return;
  }

  if (phase === 'open') {
    const openVal = coverOpenCurve(flow);
    const settleT = smooth((p - 0.78) / 0.22);
    const gazeOpen = new THREE.Vector3().lerpVectors(contactVec(bookCoverGripPose(openVal).position), contact(0, 0.05, -0.01), settleT);
    applyTorsoAndGazeIK(rig, gazeOpen, -0.04, 0, 0, 1, dt);

    // Follow the same tilted underside frame as the page wing while its weight moves to the spine.
    const supportPose = bookSupportPose(1, openVal);
    reachPalm(rig, rig.arms[1], contactVec(supportPose.position), 1, {
      quaternion: supportPose.quaternion.premultiply(book.quaternion),
      blend: 1,
      mode: 'palm',
      shoulderWeight: 0.1,
      fingerCurl: supportCurl, thumbOppose: supportThumb,
      poleHint: supportPole(1).lerp(new THREE.Vector3(.72, -.82, -.12).applyQuaternion(rig.mesh.getWorldQuaternion(new THREE.Quaternion())), 1-supportRelax),
    });

    // Right hand rides the actual front cover edge, then slips beneath the opened cover as book settles.
    const coverPose = bookCoverGripPose(openVal);
    const coverEdgeWorld = contactVec(coverPose.position);
    const coverQuatWorld = coverPose.quaternion.clone().premultiply(book.quaternion);
    if (p <= 0.78) {
      reachPalm(rig, rig.arms[0], coverEdgeWorld, 0, {
        quaternion: coverQuatWorld,
        forearmTwistBlend: 1 - smooth(openVal / .5),
        blend: 1,
        mode: 'palm',
        shoulderWeight: 0.15,
        fingerCurl: 0,
        thumbOppose: -0.4,
      });
    } else {
      const slip = smooth((p - 0.78) / 0.22);
      const rightPos = guidedArc(coverEdgeWorld, coverSlipGuide, rightSupportOpen, slip);
      const rightQuat = coverQuatWorld.clone().slerp(rightSupportOrientation, slip);
      reachPalm(rig, rig.arms[0], rightPos, 0, {
        quaternion: rightQuat,
        blend: 1,
        mode: 'palm',
        shoulderWeight: THREE.MathUtils.lerp(0.15, 0.1, slip),
        fingerCurl: THREE.MathUtils.lerp(0, supportCurl, slip),
        thumbOppose: THREE.MathUtils.lerp(-0.4, supportThumb, slip),
        poleHint: new THREE.Vector3(-.72, -.82, -.12).applyQuaternion(rig.mesh.getWorldQuaternion(new THREE.Quaternion())).lerp(supportPole(0), slip),
      });
    }
    return;
  }

  if (phase === 'reading') {
    applyTorsoAndGazeIK(rig, contact(0, 0.05, -0.01), -0.04, 0, 0, 1, dt);
    reachPalm(rig, rig.arms[0], rightSupportOpen, 0, { quaternion: rightSupportOrientation, blend: 1, mode: 'palm', shoulderWeight: 0.1, fingerCurl: supportCurl, thumbOppose: supportThumb, poleHint: supportPole(0) });
    reachPalm(rig, rig.arms[1], leftSupportOpen, 1, { quaternion: leftSupportOrientation, blend: 1, mode: 'palm', shoulderWeight: 0.1, fingerCurl: supportCurl, thumbOppose: supportThumb, poleHint: supportPole(1) });
    return;
  }

  if (phase === 'turn') {
    const hand = turningHandPose(p, flow.direction);
    const side = hand.side;
    // After releasing the sheet, a small in-plane turn follows the lower stance.
    // It leaves the page-contact frame, palm normal and both endpoints intact.
    if (authored) hand.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(
      new THREE.Vector3(0, 0, 1), (side ? -1 : 1) * .23 * Math.sin(Math.PI * smooth((p - PAGE_TURN_AUTHORED.ContactEnd) / .28))));
    const support = (1 - side) as 0 | 1;
    const supportPose = bookSupportPose(support);
    const activeBlend = smooth((p-.08)/.08) * (1-smooth((p-.86)/.14));
    // A small eye follow keeps the head down and torso quiet while the page passes the spine.
    const gazeTurn = contact(0, 0.05, -0.01).lerp(contactVec(hand.position), PAGE_TURN_AUTHORED.GazeFollow * Math.sin(p * Math.PI));
    applyTorsoAndGazeIK(rig, gazeTurn, -0.04, 0, 0, 1, dt);
    reachPalm(rig, rig.arms[support], contactVec(supportPose.position), support, {
      quaternion: supportPose.quaternion.premultiply(book.quaternion),
      blend: 1,
      mode: 'palm',
      shoulderWeight: 0.1,
      fingerCurl: supportCurl, thumbOppose: supportThumb, poleHint: supportPole(support),
    });
    reachPalm(rig, rig.arms[side], contactVec(hand.position), side, {
      quaternion: hand.quaternion.premultiply(book.quaternion),
      blend: 1,
      tipWeight: hand.tipWeight,
      shoulderWeight: hand.shoulderWeight,
      poleHint: new THREE.Vector3(side ? .72 : -.72,
        THREE.MathUtils.lerp(-.82, PAGE_TURN_AUTHORED.ElbowHeight + (authored ? .35 : 0), Math.sin(Math.PI * p) ** 2),
        THREE.MathUtils.lerp(-.12, PAGE_TURN_AUTHORED.ElbowForward, Math.sin(Math.PI * p) ** 2))
        .applyQuaternion(rig.mesh.getWorldQuaternion(new THREE.Quaternion())).lerp(supportPole(side), 1-activeBlend),
      fingerCurl: THREE.MathUtils.lerp(supportCurl, hand.fingerCurl, activeBlend),
      thumbOppose: THREE.MathUtils.lerp(supportThumb, hand.thumbOppose, activeBlend),
    });
    return;
  }

  if (phase === 'close') {
    const openVal = coverOpenCurve(flow);
    const coverPose = bookCoverGripPose(openVal);
    const coverEdgeWorld = contactVec(coverPose.position);
    const coverQuatWorld = coverPose.quaternion.clone().premultiply(book.quaternion);
    applyTorsoAndGazeIK(rig, bookCenterWorld, -0.04, 0, 0, 1, dt);

    const supportPose = bookSupportPose(1, openVal);
    reachPalm(rig, rig.arms[1], contactVec(supportPose.position), 1, {
      quaternion: supportPose.quaternion.premultiply(book.quaternion),
      blend: 1,
      mode: 'palm',
      shoulderWeight: 0.1,
      fingerCurl: supportCurl, thumbOppose: supportThumb,
      poleHint: supportPole(1).lerp(new THREE.Vector3(.72, -.82, -.12).applyQuaternion(rig.mesh.getWorldQuaternion(new THREE.Quaternion())), 1-supportRelax),
    });

    if (p < 0.22) {
      const s = smooth(p / 0.22);
      const rightPos = guidedArc(rightSupportOpen, coverSlipGuide, coverEdgeWorld, s);
      const rightQuat = rightSupportOrientation.clone().slerp(coverQuatWorld, s);
      reachPalm(rig, rig.arms[0], rightPos, 0, {
        quaternion: rightQuat,
        blend: 1,
        mode: 'palm',
        shoulderWeight: THREE.MathUtils.lerp(0.1, 0.15, s),
        fingerCurl: THREE.MathUtils.lerp(supportCurl, 0, s),
        thumbOppose: THREE.MathUtils.lerp(supportThumb, -0.4, s),
        poleHint: supportPole(0).lerp(new THREE.Vector3(-.72, -.82, -.12).applyQuaternion(rig.mesh.getWorldQuaternion(new THREE.Quaternion())), s),
      });
    } else {
      reachPalm(rig, rig.arms[0], coverEdgeWorld, 0, {
        quaternion: coverQuatWorld,
        forearmTwistBlend: 1 - smooth(openVal / .5),
        blend: 1,
        mode: 'palm',
        shoulderWeight: 0.15,
        fingerCurl: 0,
        thumbOppose: -0.4,
      });
    }
    return;
  }

  if (phase === 'return-carry') {
    torsoPitch = THREE.MathUtils.lerp(-0.04, shelfTorsoPitch, t);
    torsoYaw = THREE.MathUtils.lerp(0, shelfTorsoYaw * 0.85, t);
    applyTorsoAndGazeIK(rig, grabWorld, torsoPitch, torsoYaw, 0, 1, dt);

    if (grabSide === 0) {
      const shift = smooth(p / 0.42);
      const rightPos = arcLerp(coverClosedWorld, grabWorld, shelfOffset(0.03, 0.05, 0.02), shift);
      const rightQuat = coverClosedQuat.clone().slerp(grabQuat, shift);
      reachPalm(rig, rig.arms[0], rightPos, 0, {
        quaternion: rightQuat,
        blend: 1,
        mode: shift > 0.45 ? 'pinch' : 'palm',
        shoulderWeight: THREE.MathUtils.lerp(0.15, shelfShoulderWeight, t),
        fingerCurl: THREE.MathUtils.lerp(0.22, 0.48, shift),
      });
      const leftDrop = smooth((p - 0.22) / 0.65);
      const leftPos = arcLerp(leftSupportClosed, restWorldOf(1), shelfOffset(-0.04, -0.04, 0.05), leftDrop);
      reachPalm(rig, rig.arms[1], leftPos, 1, {
        quaternion: supportOrientation,
        blend: 1 - leftDrop,
        armBlend: 1 - smooth((leftDrop - 0.45) / 0.55),
        mode: 'palm',
        shoulderWeight: 0.1 * (1 - leftDrop),
        fingerCurl: THREE.MathUtils.lerp(0.14, 0.05, leftDrop),
      });
    } else {
      const slide = smooth(p / 0.48);
      const leftPos = arcLerp(leftSupportClosed, grabWorld, shelfOffset(-0.03, -0.03, 0.01), slide);
      const leftQuat = supportOrientation.clone().slerp(grabQuat, slide);
      reachPalm(rig, rig.arms[1], leftPos, 1, {
        quaternion: leftQuat,
        blend: 1,
        mode: slide > 0.45 ? 'pinch' : 'palm',
        shoulderWeight: THREE.MathUtils.lerp(0.15, shelfShoulderWeight, t),
        fingerCurl: THREE.MathUtils.lerp(0.14, 0.48, slide),
      });
      const rightDrop = smooth((p - 0.18) / 0.68);
      const rightPos = arcLerp(coverClosedWorld, restWorldOf(0), shelfOffset(0.05, 0.04, 0.04), rightDrop);
      reachPalm(rig, rig.arms[0], rightPos, 0, {
        quaternion: coverClosedQuat,
        blend: 1 - rightDrop,
        armBlend: 1 - smooth((rightDrop - 0.45) / 0.55),
        mode: 'palm',
        shoulderWeight: 0.1 * (1 - rightDrop),
        fingerCurl: THREE.MathUtils.lerp(0.22, 0.05, rightDrop),
      });
    }
    return;
  }

  if (phase === 'insert') {
    torsoPitch = shelfTorsoPitch;
    torsoYaw = THREE.MathUtils.lerp(shelfTorsoYaw * 0.85, shelfTorsoYaw, smooth(p / 0.4));
    applyTorsoAndGazeIK(rig, grabWorld, torsoPitch, torsoYaw, 0, 1, dt);
    reachPalm(rig, rig.arms[grabSide], grabWorld, grabSide, {
      quaternion: grabQuat,
      blend: 1,
      mode: 'pinch',
      shoulderWeight: shelfShoulderWeight,
      fingerCurl: 0.48,
    });
    const otherIdentity = new THREE.Quaternion();
    rig.arms[otherSide].shoulder.quaternion.slerp(otherIdentity, 1 - Math.exp(-dt * 9));
    rig.arms[otherSide].upper.quaternion.slerp(otherIdentity, 1 - Math.exp(-dt * 9));
    rig.arms[otherSide].forearm.quaternion.slerp(otherIdentity, 1 - Math.exp(-dt * 9));
    rig.arms[otherSide].hand.quaternion.slerp(otherIdentity, 1 - Math.exp(-dt * 9));
    rig.arms[otherSide].setFingers?.(0.05);
    return;
  }

  if (phase === 'release') {
    const pinchOffset = rig.arms[grabSide].palmOffset.clone().lerp(rig.arms[grabSide].fingerTipOffset ?? rig.arms[grabSide].palmOffset, 0.48);
    const restWorld = rig.mesh.localToWorld(rig.arms[grabSide].restWrist.clone().add(pinchOffset));
    const preGrab = contact(grabLocal.x - 0.055, grabLocal.y + (grabSide ? 0.015 : -0.015), grabLocal.z - 0.02);
    const bodyBack = 1 - smooth((p - 0.25) / 0.75);
    applyTorsoAndGazeIK(rig, grabWorld, shelfTorsoPitch * bodyBack, shelfTorsoYaw * bodyBack, 0, bodyBack, dt);

    let releasePos: THREE.Vector3;
    let releaseBlend = 1;
    let curl = 0.08;
    if (p < 0.25) {
      const s = smooth(p / 0.25);
      releasePos = new THREE.Vector3().lerpVectors(grabWorld, preGrab, s);
      curl = THREE.MathUtils.lerp(0.48, 0.12, s);
    } else {
      const s = smooth((p - 0.25) / 0.75);
      releasePos = new THREE.Vector3().lerpVectors(preGrab, restWorld, s).add(new THREE.Vector3(grabSide ? -0.03 : 0.03, -0.02, 0.03).multiplyScalar(Math.sin(s * Math.PI)));
      releaseBlend = 1 - s;
      curl = THREE.MathUtils.lerp(0.12, 0, s);
    }
    reachPalm(rig, rig.arms[grabSide], releasePos, grabSide, {
      quaternion: grabQuat,
      blend: releaseBlend,
      armBlend: releaseBlend,
      mode: 'pinch',
      shoulderWeight: shelfShoulderWeight * releaseBlend,
      fingerCurl: curl,
    });
    const otherIdentity = new THREE.Quaternion();
    rig.arms[otherSide].shoulder.quaternion.slerp(otherIdentity, 1 - Math.exp(-dt * 9));
    rig.arms[otherSide].upper.quaternion.slerp(otherIdentity, 1 - Math.exp(-dt * 9));
    rig.arms[otherSide].forearm.quaternion.slerp(otherIdentity, 1 - Math.exp(-dt * 9));
    rig.arms[otherSide].hand.quaternion.slerp(otherIdentity, 1 - Math.exp(-dt * 9));
    rig.arms[otherSide].setFingers?.(0);
  }
  void torsoRoll;
}

export function libraryCrouch(flow: LibraryFlow) {
  if (!flow.book || slotFor(flow.book).row !== 0) return 0;
  const p = THREE.MathUtils.clamp(flow.progress, 0, 1);
  const depth = 0.19;
  if (flow.phase === 'reach') return smooth(p / 0.60) * depth;
  if (flow.phase === 'extract' || flow.phase === 'insert') return depth;
  if (flow.phase === 'carry') return depth * (1 - smooth(p / 0.75));
  if (flow.phase === 'return-carry') return depth * smooth((p - 0.25) / 0.75);
  if (flow.phase === 'release') return depth * (1 - smooth((p - 0.20) / 0.80));
  return 0;
}

export function carryResident(root: THREE.Group, scene: string, flow: LibraryFlow) {
  if (!flow.book) return;
  const slotX = slotFor(flow.book).position[0] + .01;
  const near = .52, far = .90, pull = near + .12;
  const step = near - bookHalfStepOffset(flow.book);
  const p = THREE.MathUtils.clamp(flow.progress, 0, 1);
  let depth: number;
  switch (flow.phase) {
    case 'reach': depth = THREE.MathUtils.lerp(near, step, smooth(p / .42)); break;
    case 'extract': depth = THREE.MathUtils.lerp(step, pull, smooth(p)); break;
    case 'carry': depth = THREE.MathUtils.lerp(pull, far, smooth(p)); break;
    case 'return-carry': depth = THREE.MathUtils.lerp(far, pull, smooth(p)); break;
    case 'insert': depth = THREE.MathUtils.lerp(pull, step, smooth(p)); break;
    case 'release': depth = THREE.MathUtils.lerp(step, near, smooth((p - .30) / .70)); break;
    default: return;
  }
  root.position.fromArray(shelfPoint(scene, slotX, root.position.y, depth));
}
