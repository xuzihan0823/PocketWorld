import * as THREE from 'three';
import { readingStand, shelfOrigin, slotFor, type LibraryBook, type Vec3 } from './catalog';
import type { LibraryFlow } from './useLibrary';

export const smooth = (t: number) => {
  const c = THREE.MathUtils.clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
};

const hermite = (p0: THREE.Vector3, t0: THREE.Vector3, p1: THREE.Vector3, t1: THREE.Vector3, u: number) => {
  const u2 = u * u, u3 = u2 * u;
  return new THREE.Vector3()
    .addScaledVector(p0, 2 * u3 - 3 * u2 + 1)
    .addScaledVector(t0, u3 - 2 * u2 + u)
    .addScaledVector(p1, -2 * u3 + 3 * u2)
    .addScaledVector(t1, u3 - u2);
};

const hermiteScalar = (p0: number, t0: number, p1: number, t1: number, u: number) => {
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * t0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * t1;
};

export const shelfQuaternion = new THREE.Quaternion().setFromRotationMatrix(
  new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0), new THREE.Vector3(0, 1, 0)),
);

const HELD_TILT = -0.32;
export const heldQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(HELD_TILT, Math.PI, 0));

export function bookStand(scene: string, book: LibraryBook, near = false): Vec3 {
  const origin = shelfOrigin(scene);
  const slot = slotFor(book);
  const x = THREE.MathUtils.clamp(origin[0] + slot.position[0] + 0.01, origin[0] - 0.44, origin[0] + 0.46);
  return [x, 0, origin[2] + (near ? 0.52 : 0.90)];
}

export function bookHalfStepOffset(book: LibraryBook): number {
  const row = slotFor(book).row;
  return row === 2 ? 0.065 : row === 1 ? 0.032 : 0.025;
}

export function bookGrabSide(book: LibraryBook): 0 | 1 {
  return slotFor(book).column <= 2 ? 1 : 0;
}

export function bookGrabLocal(book: LibraryBook): THREE.Vector3 {
  const slot = slotFor(book);
  const side = bookGrabSide(book);
  const grabZ = slot.row === 2 ? -0.042 : slot.row === 0 ? 0.015 : 0.0;
  // Touch the actual side/spine surface next to the hand instead of the book's interior center.
  return new THREE.Vector3(-0.003, side === 0 ? -0.002 : 0.060, grabZ);
}

export function coverOpenCurve(flow: LibraryFlow): number {
  const p = THREE.MathUtils.clamp(flow.progress, 0, 1);
  if (flow.phase === 'open') return smooth((p - 0.04) / 0.74);
  if (flow.phase === 'close') return 1 - smooth((p - 0.22) / 0.68);
  if (['reading', 'turn'].includes(flow.phase)) return 1;
  return 0;
}

export function bookCoverGripPose(openVal: number): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const theta = Math.PI * openVal;
  const hingeY = 0.058 * (1 - openVal);
  // Hook fingertips/palm cleanly at the lower-outer edge of the cover without twisting the wrist backwards.
  const cx = 0.18;
  const cy = -0.004;
  const cz = -0.088;
  const position = new THREE.Vector3(
    cx * Math.cos(theta) - cy * Math.sin(theta),
    hingeY + cx * Math.sin(theta) + cy * Math.cos(theta),
    cz,
  );
  // Smoothly stay palm-up/inward: (0,+1,0) at closed -> (-0.85,+0.52,0) lifting right -> (0,+1,0) supporting open!
  const palmZ = new THREE.Vector3(-0.85 * Math.sin(theta), 0.35 + 0.65 * Math.cos(theta) ** 2, 0).normalize();
  const fingerDir = new THREE.Vector3(0.36 * (1 - openVal), 0.18 * Math.sin(theta), 0.92).normalize();
  const palmY = fingerDir.negate();
  const palmX = new THREE.Vector3().crossVectors(palmY, palmZ).normalize();
  palmZ.crossVectors(palmX, palmY).normalize();
  const quaternion = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(palmX, palmY, palmZ));
  return { position, quaternion };
}

export function turningPageCurve(progress: number, direction: number) {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  let forwardRatio = 0;
  let liftPhase = 0; // 0..1 while hand actively carries page, >1 while releasing
  if (p < 0.16) {
    forwardRatio = 0;
  } else if (p < 0.22) {
    // Micro-lift of the page corner as fingers catch it
    forwardRatio = 0.025 * smooth((p - 0.16) / 0.06);
  } else if (p < 0.66) {
    // Slow peel off the stack, accelerating smoothly past the vertical spine (0.56 * PI = 100.8 deg)
    const u = (p - 0.22) / 0.44;
    const peel = 0.42 * u * u + 0.58 * (u * u * (3 - 2 * u));
    forwardRatio = 0.025 + 0.535 * peel;
    liftPhase = u;
  } else if (p < 0.94) {
    // Crossed spine: page falls naturally under gravity and settles flat onto opposite stack
    const f = (p - 0.66) / 0.28;
    forwardRatio = THREE.MathUtils.clamp(hermiteScalar(0.56, 0.54, 1.0, 0.0, f), 0.56, 1.0);
    liftPhase = 1;
  } else {
    forwardRatio = 1.0;
    liftPhase = 1;
  }
  const leafRatio = direction >= 0 ? forwardRatio : 1 - forwardRatio;
  const bendAmp = Math.sin(leafRatio * Math.PI) * 0.022;
  // Hand stays locked to page during [0.22, 0.68], approaches during [0, 0.22], releases during [0.68, 1.0]
  const handContact = p < 0.22 ? smooth(p / 0.22) : p <= 0.68 ? 1 : 1 - smooth((p - 0.68) / 0.16);
  return { leafRatio, bendAmp, handContact, liftPhase, forwardRatio };
}

export function turningPagePoint(leafRatio: number, bendAmp: number, rx = 0.185, rz = -0.085) {
  const theta = Math.PI * leafRatio;
  const by = Math.sin((rx / 0.235) * Math.PI) * bendAmp;
  const position = new THREE.Vector3(
    rx * Math.cos(theta) - by * Math.sin(theta),
    0.049 + rx * Math.sin(theta) + by * Math.cos(theta),
    rz,
  );
  const slope = (Math.PI / 0.235) * Math.cos((rx / 0.235) * Math.PI) * bendAmp;
  const tangentLocal = new THREE.Vector3(1, slope, 0).normalize();
  const normalLocal = new THREE.Vector3(-slope, 1, 0).normalize();
  const rot = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), theta);
  return {
    position,
    tangent: tangentLocal.applyQuaternion(rot),
    normal: normalLocal.applyQuaternion(rot),
  };
}

export function bookPose(scene: string, book: LibraryBook, flow: LibraryFlow) {
  const origin = shelfOrigin(scene);
  const slot = slotFor(book);
  const p = THREE.MathUtils.clamp(flow.progress, 0, 1);
  const t = smooth(p);
  const phase = flow.book?.id === book.id ? flow.phase : 'idle';
  const shelf = new THREE.Vector3(origin[0] + slot.position[0] + 0.035, slot.position[1], origin[2] + 0.20);
  const outside = shelf.clone().add(new THREE.Vector3(0, 0, 0.31));
  const root = bookStand(scene, book);
  const open = coverOpenCurve({ ...flow, phase });
  // Keep closed book centered in front of chest, shifting seamlessly as cover unfolds rightward.
  const heldBase = new THREE.Vector3(root[0] + 0.11 * (1 - open), 0.93, root[2] - 0.285);
  const position = shelf.clone();
  const quaternion = shelfQuaternion.clone();

  if (phase === 'shelving') {
    position.z += (1 - t) * 0.15;
  } else if (phase === 'extract') {
    const u = 2.1 * p * p - 1.1 * p * p * p;
    position.lerpVectors(shelf, outside, u);
  } else if (['carry', 'open', 'reading', 'turn', 'close', 'return-carry'].includes(phase)) {
    position.copy(heldBase);
    quaternion.copy(heldQuaternion);
    if (phase === 'carry') {
      // Continue straight-out +Z velocity from extract before arcing cleanly toward chest.
      const exitVel = new THREE.Vector3(0, 0, 0.44);
      position.copy(hermite(outside, exitVel, heldBase, new THREE.Vector3(0, 0, 0), p));
      quaternion.slerpQuaternions(shelfQuaternion, heldQuaternion, smooth((p - 0.06) / 0.88));
    } else if (phase === 'return-carry') {
      const enterVel = new THREE.Vector3(0, 0, -0.44);
      position.copy(hermite(heldBase, new THREE.Vector3(0, 0, 0), outside, enterVel, p));
      // Finish aligning straight to shelf slot before insert starts.
      quaternion.slerpQuaternions(heldQuaternion, shelfQuaternion, smooth(p / 0.86));
    } else if (phase === 'open') {
      const lift = smooth(p / 0.18) * (1 - smooth((p - 0.74) / 0.26)) * 0.015;
      const weightDip = -Math.sin(open * Math.PI) * 0.006;
      position.y += lift + weightDip;
      const roll = Math.sin(open * Math.PI) * 0.032;
      quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
    } else if (phase === 'close') {
      const lift = smooth(p / 0.22) * (1 - smooth((p - 0.85) / 0.15)) * 0.015;
      const weightDip = -Math.sin(open * Math.PI) * 0.005;
      position.y += lift + weightDip;
      const roll = Math.sin(open * Math.PI) * 0.025;
      quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), roll));
    } else if (phase === 'turn') {
      const tilt = Math.sin(smooth(p) * Math.PI) * (flow.direction >= 0 ? -0.016 : 0.016);
      quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), tilt));
    }
  } else if (phase === 'insert') {
    const q = 1 - p;
    const u = 1 - (2.1 * q * q - 1.1 * q * q * q);
    position.lerpVectors(outside, shelf, u);
  }

  return { position, quaternion, open, phase };
}

export function residentLibraryTarget(scene: string, flow: LibraryFlow): Vec3 {
  if (flow.book && flow.phase === 'align') return bookStand(scene, flow.book, true);
  return readingStand(scene);
}

export const leafProgress = (flow: LibraryFlow) => turningPageCurve(flow.progress, flow.direction).forwardRatio;
