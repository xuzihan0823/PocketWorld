import * as THREE from 'three';
import type { ResidentRig } from '../ResidentModel';
import type { LibraryFlow } from './useLibrary';
import {
  bookCoverGripPose,
  bookGrabLocal,
  bookGrabSide,
  bookHalfStepOffset,
  bookPose,
  bookStand,
  coverOpenCurve,
  smooth,
  turningPageCurve,
  turningPagePoint,
} from './bookMotion';
import { slotFor } from './catalog';
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

export function applyLibraryPose(rig: ResidentRig, root: THREE.Group, scene: string, flow: LibraryFlow, dt: number) {
  const phase = flow.phase;
  const p = THREE.MathUtils.clamp(flow.progress, 0, 1);
  const t = smooth(p);
  const originX = scene === 'observatory' ? 14 : 0;
  rig.mesh.updateWorldMatrix(true, true);

  if (!flow.book || ['catalog', 'form', 'recenter', 'shelving'].includes(phase)) {
    resetArms(rig, 1 - Math.exp(-dt * 9));
    return;
  }

  const slot = slotFor(flow.book);
  const book = bookPose(scene, flow.book, flow);
  const grabSide = bookGrabSide(flow.book);
  const otherSide = (1 - grabSide) as 0 | 1;
  const grabLocal = bookGrabLocal(flow.book);

  const contact = (x: number, y: number, z: number) =>
    new THREE.Vector3(x, y, z).applyQuaternion(book.quaternion).add(book.position).add(new THREE.Vector3(originX, 0, 0));
  const contactVec = (v: THREE.Vector3) => contact(v.x, v.y, v.z);

  // Natural angled palm-up support aligned with each forearm (fingers point slightly inward toward spine).
  const supportOrientationFor = (side: 0 | 1) => {
    const fingerDir = new THREE.Vector3(side === 0 ? 0.36 : -0.36, 0, 0.93).normalize();
    const palmY = fingerDir.negate();
    const palmZ = new THREE.Vector3(side === 0 ? -0.10 : 0.10, 0.995, 0).normalize();
    const palmX = new THREE.Vector3().crossVectors(palmY, palmZ).normalize();
    return makePalmQuat(palmX, palmY, palmZ, book.quaternion);
  };
  const rightSupportOrientation = supportOrientationFor(0);
  const leftSupportOrientation = supportOrientationFor(1);
  const supportOrientation = leftSupportOrientation;
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
      point.lerpVectors(restWorld, preGrab, u).add(new THREE.Vector3(grabSide ? -0.03 : 0.03, -0.02, 0.03).multiplyScalar(Math.sin(u * Math.PI)));
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

  const leftSupportClosed = contact(0.12, -0.009, -0.072);
  const leftSupportOpen = contact(0.125, -0.009, -0.072);
  const rightSupportOpen = contact(-0.125, -0.009, -0.072);
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
      const leftPos = arcLerp(restWorldOf(1), leftSupportClosed, new THREE.Vector3(-0.04, -0.04, 0.05), leftCatch);
      reachPalm(rig, rig.arms[1], leftPos, 1, {
        quaternion: supportOrientation,
        blend: leftCatch,
        armBlend: smooth(leftCatch / 0.45),
        mode: 'palm',
        shoulderWeight: 0.15 * leftCatch,
        fingerCurl: THREE.MathUtils.lerp(0.05, 0.14, leftCatch),
      });
      const shift = smooth((p - 0.56) / 0.44);
      const rightPos = arcLerp(grabWorld, coverClosedWorld, new THREE.Vector3(0.03, 0.05, 0.02), shift);
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
      const leftPos = arcLerp(grabWorld, leftSupportClosed, new THREE.Vector3(-0.03, -0.03, 0.01), slide);
      const leftQuat = grabQuat.clone().slerp(supportOrientation, slide);
      reachPalm(rig, rig.arms[1], leftPos, 1, {
        quaternion: leftQuat,
        blend: 1,
        mode: slide > 0.4 ? 'palm' : 'pinch',
        shoulderWeight: shelfShoulderWeight * (1 - slide * 0.85),
        fingerCurl: THREE.MathUtils.lerp(0.48, 0.14, slide),
      });
      const rightCatch = smooth((p - 0.16) / 0.72);
      const rightPos = arcLerp(restWorldOf(0), coverClosedWorld, new THREE.Vector3(0.05, 0.04, 0.04), rightCatch);
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

    // Left hand adjusts slightly with shifting cover weight.
    const weightShiftX = THREE.MathUtils.lerp(0.12, 0.125, openVal) + Math.sin(openVal * Math.PI) * 0.012;
    const weightDipY = -0.007 - Math.sin(openVal * Math.PI) * 0.004;
    reachPalm(rig, rig.arms[1], contact(weightShiftX, weightDipY - 0.002, -0.072), 1, {
      quaternion: supportOrientation,
      blend: 1,
      mode: 'palm',
      shoulderWeight: 0.1,
      fingerCurl: 0.14,
    });

    // Right hand rides the actual front cover edge, then slips beneath the opened cover as book settles.
    const coverPose = bookCoverGripPose(openVal);
    const coverEdgeWorld = contactVec(coverPose.position);
    const coverQuatWorld = coverPose.quaternion.clone().premultiply(book.quaternion);
    if (p <= 0.78) {
      reachPalm(rig, rig.arms[0], coverEdgeWorld, 0, {
        quaternion: coverQuatWorld,
        blend: 1,
        mode: 'palm',
        shoulderWeight: 0.15,
        fingerCurl: 0.22,
      });
    } else {
      const slip = smooth((p - 0.78) / 0.22);
      const viaEdge = contact(-0.215, -0.010, -0.085);
      const rightPos = slip < 0.45
        ? new THREE.Vector3().lerpVectors(coverEdgeWorld, viaEdge, smooth(slip / 0.45))
        : new THREE.Vector3().lerpVectors(viaEdge, rightSupportOpen, smooth((slip - 0.45) / 0.55));
      const rightQuat = coverQuatWorld.clone().slerp(rightSupportOrientation, slip);
      reachPalm(rig, rig.arms[0], rightPos, 0, {
        quaternion: rightQuat,
        blend: 1,
        mode: 'palm',
        shoulderWeight: 0.1,
        fingerCurl: THREE.MathUtils.lerp(0.22, 0.14, slip),
      });
    }
    return;
  }

  if (phase === 'reading') {
    applyTorsoAndGazeIK(rig, contact(0, 0.05, -0.01), -0.04, 0, 0, 1, dt);
    reachPalm(rig, rig.arms[0], rightSupportOpen, 0, { quaternion: rightSupportOrientation, blend: 1, mode: 'palm', shoulderWeight: 0.1, fingerCurl: 0.04 });
    reachPalm(rig, rig.arms[1], leftSupportOpen, 1, { quaternion: leftSupportOrientation, blend: 1, mode: 'palm', shoulderWeight: 0.1, fingerCurl: 0.04 });
    return;
  }

  if (phase === 'turn') {
    const dir = flow.direction >= 0 ? 1 : -1;
    const side = (dir > 0 ? 1 : 0) as 0 | 1;
    const support = (1 - side) as 0 | 1;
    const curve = turningPageCurve(p, dir);
    const pagePt = turningPagePoint(curve.leafRatio, curve.bendAmp);
    // Outward push face: +normal for forward (0->PI, pushing rightward -X_book), -normal for backward (PI->0, pushing leftward +X_book).
    const pushNormal = dir > 0 ? pagePt.normal : pagePt.normal.clone().negate();
    const pageWorld = contactVec(pagePt.position.clone().addScaledVector(pushNormal, -0.002));

    const gazeTurn = new THREE.Vector3().lerpVectors(contact(0, 0.05, -0.01), pageWorld, 0.45 * Math.sin(p * Math.PI));
    applyTorsoAndGazeIK(rig, gazeTurn, -0.04, 0, 0, 1, dt);

    const shiftSupport = p < 0.20 ? smooth(p / 0.20) : p > 0.78 ? 1 - smooth((p - 0.78) / 0.22) : 1;
    const supportX = (support ? 1 : -1) * THREE.MathUtils.lerp(0.125, 0.088, shiftSupport);
    const sideSupportQuat = supportOrientationFor(side);
    const otherSupportQuat = supportOrientationFor(support);
    reachPalm(rig, rig.arms[support], contact(supportX, -0.009, -0.072), support, {
      quaternion: otherSupportQuat,
      blend: 1,
      mode: 'palm',
      shoulderWeight: 0.1,
      fingerCurl: 0.12,
    });

    // Natural lifting/guiding hand orientation: palm stays UP-and-INWARD along +pushNormal (zero 180° wrist flip!).
    const fingerAim = new THREE.Vector3(side ? -0.46 : 0.46, 0.25 * Math.sin(curve.leafRatio * Math.PI), 0.85).normalize();
    const palmZ = pushNormal.clone().add(new THREE.Vector3(0, 0.35, 0)).normalize();
    const palmY = fingerAim.clone().negate();
    const palmX = new THREE.Vector3().crossVectors(palmY, palmZ).normalize();
    palmZ.crossVectors(palmX, palmY).normalize();
    const pageQuat = makePalmQuat(palmX, palmY, palmZ, book.quaternion);

    const startUnder = contact(side ? 0.125 : -0.125, -0.007, -0.072);
    const outerClear = contact(side ? 0.225 : -0.225, 0.016, -0.098);
    const returnOuter = contact(side ? 0.225 : -0.225, 0.014, -0.095);

    let turnPos: THREE.Vector3;
    let turnQuat: THREE.Quaternion;
    let turnMode: 'palm' | 'tip' = 'tip';
    let curl = 0.16;

    if (p < 0.22) {
      const u = p / 0.22;
      if (u < 0.5) {
        const s = smooth(u / 0.5);
        turnPos = new THREE.Vector3().lerpVectors(startUnder, outerClear, s);
        turnQuat = sideSupportQuat.clone().slerp(pageQuat, s * 0.45);
        turnMode = 'palm';
        curl = 0.08;
      } else {
        const s = smooth((u - 0.5) / 0.5);
        turnPos = new THREE.Vector3().lerpVectors(outerClear, pageWorld, s);
        turnQuat = sideSupportQuat.clone().slerp(pageQuat, 0.45 + 0.55 * s);
        turnMode = 'tip';
        curl = THREE.MathUtils.lerp(0.08, 0.18, s);
      }
    } else if (p <= 0.66) {
      turnPos = pageWorld;
      turnQuat = pageQuat;
      turnMode = 'tip';
      curl = 0.10;
    } else {
      const u = (p - 0.66) / 0.34;
      const releasePoint = turningPagePoint(dir > 0 ? 0.56 : 0.44, Math.sin((dir > 0 ? 0.56 : 0.44) * Math.PI) * 0.022);
      const releasePushNormal = dir > 0 ? releasePoint.normal : releasePoint.normal.clone().negate();
      const liftOff = contactVec(releasePoint.position.clone().addScaledVector(releasePushNormal, -0.032));
      if (u < 0.28) {
        const s = smooth(u / 0.28);
        turnPos = new THREE.Vector3().lerpVectors(pageWorld, liftOff, s);
        turnQuat = pageQuat.clone().slerp(sideSupportQuat, s * 0.25);
        turnMode = 'tip';
        curl = THREE.MathUtils.lerp(0.20, 0.10, s);
      } else if (u < 0.65) {
        const s = smooth((u - 0.28) / 0.37);
        turnPos = new THREE.Vector3().lerpVectors(liftOff, returnOuter, s);
        turnQuat = pageQuat.clone().slerp(sideSupportQuat, 0.25 + 0.55 * s);
        turnMode = 'palm';
        curl = 0.08;
      } else {
        const s = smooth((u - 0.65) / 0.35);
        turnPos = new THREE.Vector3().lerpVectors(returnOuter, startUnder, s);
        turnQuat = pageQuat.clone().slerp(sideSupportQuat, 0.80 + 0.20 * s);
        turnMode = 'palm';
        curl = 0.08;
      }
    }

    reachPalm(rig, rig.arms[side], turnPos, side, {
      quaternion: turnQuat,
      blend: 1,
      mode: turnMode,
      shoulderWeight: 0.40,
      fingerCurl: curl,
    });
    return;
  }

  if (phase === 'close') {
    const openVal = coverOpenCurve(flow);
    const coverPose = bookCoverGripPose(openVal);
    const coverEdgeWorld = contactVec(coverPose.position);
    const coverQuatWorld = coverPose.quaternion.clone().premultiply(book.quaternion);
    applyTorsoAndGazeIK(rig, bookCenterWorld, -0.04, 0, 0, 1, dt);

    const weightShiftX = THREE.MathUtils.lerp(0.12, 0.125, openVal) + Math.sin(openVal * Math.PI) * 0.012;
    const weightDipY = -0.007 - Math.sin(openVal * Math.PI) * 0.004;
    reachPalm(rig, rig.arms[1], contact(weightShiftX, weightDipY - 0.002, -0.072), 1, {
      quaternion: supportOrientation,
      blend: 1,
      mode: 'palm',
      shoulderWeight: 0.1,
      fingerCurl: 0.14,
    });

    if (p < 0.22) {
      const s = smooth(p / 0.22);
      const viaEdge = contact(-0.215, -0.010, -0.085);
      const rightPos = s < 0.55
        ? new THREE.Vector3().lerpVectors(rightSupportOpen, viaEdge, smooth(s / 0.55))
        : new THREE.Vector3().lerpVectors(viaEdge, coverEdgeWorld, smooth((s - 0.55) / 0.45));
      const rightQuat = rightSupportOrientation.clone().slerp(coverQuatWorld, s);
      reachPalm(rig, rig.arms[0], rightPos, 0, {
        quaternion: rightQuat,
        blend: 1,
        mode: 'palm',
        shoulderWeight: 0.12,
        fingerCurl: THREE.MathUtils.lerp(0.14, 0.22, s),
      });
    } else {
      reachPalm(rig, rig.arms[0], coverEdgeWorld, 0, {
        quaternion: coverQuatWorld,
        blend: 1,
        mode: 'palm',
        shoulderWeight: 0.15,
        fingerCurl: 0.22,
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
      const rightPos = arcLerp(coverClosedWorld, grabWorld, new THREE.Vector3(0.03, 0.05, 0.02), shift);
      const rightQuat = coverClosedQuat.clone().slerp(grabQuat, shift);
      reachPalm(rig, rig.arms[0], rightPos, 0, {
        quaternion: rightQuat,
        blend: 1,
        mode: shift > 0.45 ? 'pinch' : 'palm',
        shoulderWeight: THREE.MathUtils.lerp(0.15, shelfShoulderWeight, t),
        fingerCurl: THREE.MathUtils.lerp(0.22, 0.48, shift),
      });
      const leftDrop = smooth((p - 0.22) / 0.65);
      const leftPos = arcLerp(leftSupportClosed, restWorldOf(1), new THREE.Vector3(-0.04, -0.04, 0.05), leftDrop);
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
      const leftPos = arcLerp(leftSupportClosed, grabWorld, new THREE.Vector3(-0.03, -0.03, 0.01), slide);
      const leftQuat = supportOrientation.clone().slerp(grabQuat, slide);
      reachPalm(rig, rig.arms[1], leftPos, 1, {
        quaternion: leftQuat,
        blend: 1,
        mode: slide > 0.45 ? 'pinch' : 'palm',
        shoulderWeight: THREE.MathUtils.lerp(0.15, shelfShoulderWeight, t),
        fingerCurl: THREE.MathUtils.lerp(0.14, 0.48, slide),
      });
      const rightDrop = smooth((p - 0.18) / 0.68);
      const rightPos = arcLerp(coverClosedWorld, restWorldOf(0), new THREE.Vector3(0.05, 0.04, 0.04), rightDrop);
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
  const near = bookStand(scene, flow.book, true);
  const far = bookStand(scene, flow.book);
  const stepZ = near[2] - bookHalfStepOffset(flow.book);
  const pullZ = near[2] + 0.12;
  const p = THREE.MathUtils.clamp(flow.progress, 0, 1);

  if (flow.phase === 'reach') {
    root.position.x = near[0];
    root.position.z = THREE.MathUtils.lerp(near[2], stepZ, smooth(p / 0.42));
  } else if (flow.phase === 'extract') {
    root.position.x = near[0];
    root.position.z = THREE.MathUtils.lerp(stepZ, pullZ, smooth(p));
  } else if (flow.phase === 'carry') {
    root.position.x = THREE.MathUtils.lerp(near[0], far[0], smooth(p));
    root.position.z = THREE.MathUtils.lerp(pullZ, far[2], smooth(p));
  } else if (flow.phase === 'return-carry') {
    root.position.x = THREE.MathUtils.lerp(far[0], near[0], smooth(p));
    root.position.z = THREE.MathUtils.lerp(far[2], pullZ, smooth(p));
  } else if (flow.phase === 'insert') {
    root.position.x = near[0];
    root.position.z = THREE.MathUtils.lerp(pullZ, stepZ, smooth(p));
  } else if (flow.phase === 'release') {
    root.position.x = near[0];
    root.position.z = THREE.MathUtils.lerp(stepZ, near[2], smooth((p - 0.30) / 0.70));
  }
}
