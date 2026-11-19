import * as THREE from 'three';
import { PAGE_TURN_AUTHORED } from './pageTurnFrames';
import { readingStand, shelfPoint, shelfYaw, slotFor, type LibraryBook, type Vec3 } from './catalog';
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

const up = new THREE.Vector3(0, 1, 0);
export const shelfRotation = (scene: string) => new THREE.Quaternion().setFromAxisAngle(up, shelfYaw(scene));

const HELD_TILT = 0.08;
const READING_TILT = 0.08;
export const heldQuaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(HELD_TILT, Math.PI, 0));

export function bookStand(scene: string, book: LibraryBook, near = false): Vec3 {
  const x = THREE.MathUtils.clamp(slotFor(book).position[0] + .01, -.44, .46);
  return shelfPoint(scene, x, 0, near ? .52 : .90);
}

export const AUTHORED_BOOK_RETREAT = .30;

export function authoredBookStand(scene: string, book: LibraryBook, held = false, retreat = 0): Vec3 {
  return shelfPoint(scene, slotFor(book).position[0], 0, .58 + (held ? AUTHORED_BOOK_RETREAT : 0) + retreat);
}

/** A planted weight shift leaves the book and reading/turn hand endpoints fixed. */
export function libraryHeldBalance(flow: LibraryFlow) {
  const weight = smooth(coverOpenCurve(flow) / .35);
  return { back: .07 * weight, drop: .06 * weight };
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

export const BOOK_WING_ANGLE = THREE.MathUtils.degToRad(12);
export const BOOK_PAGE_WIDTH = 0.235;
const CLOSED_PAGE_THICKNESS = 0.041;
const PAGE_BOTTOM = 0.0065;
const PAGE_CLEARANCE = 0.0015;

/** Shared frames for the covers, page stacks, text and hand contacts. */
export function bookWingPose(side: 0 | 1, openVal = 1) {
  const open = THREE.MathUtils.clamp(openVal, 0, 1);
  const spread = Math.sin(open * Math.PI / 2) ** 2;
  const angle = side === 0 ? (Math.PI - BOOK_WING_ANGLE) * open - Math.PI : BOOK_WING_ANGLE * open;
  const thickness = side === 0 ? PAGE_TURN_AUTHORED.OpenStackThickness * spread
    : THREE.MathUtils.lerp(CLOSED_PAGE_THICKNESS, PAGE_TURN_AUTHORED.OpenStackThickness, spread);
  return {
    position: new THREE.Vector3(0, side === 0 ? 0.058 * (1 - open) : 0, 0),
    quaternion: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angle),
    widthScale: side === 0 ? spread : 1,
    thickness,
    surfaceY: PAGE_BOTTOM + thickness + PAGE_CLEARANCE,
  };
}

export function bookWingPoint(side: 0 | 1, openVal: number, radius: number, y: number, z: number) {
  const wing = bookWingPose(side, openVal);
  return new THREE.Vector3((side === 0 ? -1 : 1) * radius * wing.widthScale, y, z)
    .applyQuaternion(wing.quaternion).add(wing.position);
}

export function bookCoverPose(openVal: number) {
  const wing = bookWingPose(0, openVal);
  return { position: wing.position, quaternion: wing.quaternion.multiply(
    new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI)),
  };
}

export function bookCoverGripPose(openVal: number): { position: THREE.Vector3; quaternion: THREE.Quaternion } {
  const open = THREE.MathUtils.clamp(openVal, 0, 1);
  const cover = bookCoverPose(open);
  // Grip beside the spine while closed; the hand travels to the free edge as the cover opens.
  const prepare = 1 - smooth(open / .55);
  const position = new THREE.Vector3(0.18 - .135 * prepare, 0.0185, -0.088 + .06 * Math.sin(Math.PI * open)).applyQuaternion(cover.quaternion).add(cover.position);
  const normal = new THREE.Vector3(0, -1, 0).applyQuaternion(cover.quaternion);
  // Rest palm-down on the closed cover, then roll around its exposed edge.
  // At the closed cover the fingers lead inward from the reader's edge,
  // following the forearm instead of folding back toward the wrist.
  const fingers = new THREE.Vector3(0.36 * (1 - open), 0, .92).applyQuaternion(cover.quaternion);
  return { position, quaternion: palmQuaternion(fingers, normal) };
}

export const PAGE_TURN_SECONDS = 3;
export const PAGE_CONTACT_START = 0.30;
export const PAGE_CONTACT_END = PAGE_TURN_AUTHORED.ContactEnd;

export function turningPageCurve(progress: number, direction: number) {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  // The sheet waits for the crossing hand, peels slowly, then falls onto the other stack.
  // One continuous curve keeps its velocity unchanged when the fingers release it.
  const forwardRatio = authoredPageRatio(p);
  const leafRatio = direction >= 0 ? forwardRatio : 1 - forwardRatio;
  const bendAmp = Math.sin(leafRatio * Math.PI) * 0.008 * (direction >= 0 ? 1 : -1);
  const handContact = smooth((p - 0.16) / 0.14) * (1 - smooth((p - PAGE_CONTACT_END) / 0.10));
  return { leafRatio, bendAmp, handContact, liftPhase: forwardRatio, forwardRatio };
}

function palmQuaternion(fingerDirection: THREE.Vector3, palmNormal: THREE.Vector3) {
  const y = fingerDirection.clone().normalize().negate();
  const x = new THREE.Vector3().crossVectors(y, palmNormal).normalize();
  const z = new THREE.Vector3().crossVectors(x, y).normalize();
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
}

export function bookSupportPose(side: 0 | 1, openVal = 1) {
  const open = THREE.MathUtils.clamp(openVal, 0, 1);
  const wing = bookWingPose(side, open);
  // +Z is the reader's front edge after the held book's PI yaw.
  const radius = side === 0 ? 0.125 : THREE.MathUtils.lerp(0.19, 0.035, open) + Math.sin(open * Math.PI) * 0.012;
  // The support fingers relax during the first 40% of the spread. Raise the
  // skin contact with that hand shape, rather than lagging until the cover is flat.
  const relax = smooth(open / .4);
  const rise = Math.pow(relax, .6) * smooth(relax / .15);
  const y = THREE.MathUtils.lerp(-0.0265, -0.014, side === 1 ? rise : open);
  const z = THREE.MathUtils.lerp(-0.04, PAGE_TURN_AUTHORED.SupportFront, open);
  return {
    position: bookWingPoint(side, open, radius, y, z),
    quaternion: palmQuaternion(side === 0 ? new THREE.Vector3(.36, 0, .93)
      : new THREE.Vector3(-.36, 0, .93),
      new THREE.Vector3(side === 0 ? -0.10 : 0.10, 0.995, 0)).premultiply(wing.quaternion),
  };
}

function pageGrip(progress: number, direction: number) {
  const curve = turningPageCurve(progress, direction);
  const page = turningPagePoint(curve.leafRatio, curve.bendAmp, 0.205, 0.085);
  // The fingertip follows the curling sheet, but the palm sweeps above it.
  // A sheet normal reverses after the spine; using it as a hand frame turns
  // the whole palm face-up and folds the wrist back instead of sweeping.
  const tilt = PAGE_TURN_AUTHORED.SweepPalmTilt;
  const forward = PAGE_TURN_AUTHORED.SweepFingerForward;
  const palmNormal = new THREE.Vector3(0, -1, -tilt).normalize();
  const fingerDirection = new THREE.Vector3((direction >= 0 ? 1 : -1) * PAGE_TURN_AUTHORED.SweepFingerAcross, -tilt * forward, forward);
  return {
    position: page.position.clone().addScaledVector(page.normal, direction >= 0 ? 0.002 : -0.002),
    quaternion: palmQuaternion(fingerDirection, palmNormal),
  };
}

/** Book-local contact and palm frame; shared with numerical/rig validation, without a frame clock. */
export function turningHandPose(progress: number, direction: number) {
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  const side: 0 | 1 = direction >= 0 ? 0 : 1;
  const support = bookSupportPose(side);
  const sign = side === 0 ? -1 : 1;
  const outside = new THREE.Vector3(sign * PAGE_TURN_AUTHORED.OutsideRadius, -0.012, 0.045);
  const depart = new THREE.Vector3(sign * PAGE_TURN_AUTHORED.DepartRadius, outside.y, outside.z);
  const lowerStart = PAGE_TURN_AUTHORED.LowerStart, supportReturn = PAGE_TURN_AUTHORED.SupportReturn;
  const lifted = new THREE.Vector3(outside.x, PAGE_TURN_AUTHORED.ReachHeight, outside.z);
  const returnHigh = new THREE.Vector3(outside.x, PAGE_TURN_AUTHORED.ReturnHeight, outside.z);
  const edgeOn = palmQuaternion(new THREE.Vector3(-sign * 0.36, 0, 0.93), new THREE.Vector3(-sign, 0.18, 0));
  const catchPose = pageGrip(PAGE_CONTACT_START, direction);
  let position: THREE.Vector3, quaternion: THREE.Quaternion;
  let tipWeight = 0;
  if (p < 0.08) {
    const u = smooth(p / 0.08);
    position = support.position.clone().lerp(depart, u);
    quaternion = support.quaternion.clone();
  } else if (p < 0.16) {
    const u = smooth((p - 0.08) / 0.08);
    position = depart.clone().lerp(lifted, u);
    quaternion = support.quaternion.clone().slerp(edgeOn, u);
  } else if (p < PAGE_CONTACT_START) {
    const u = smooth((p - 0.16) / (PAGE_CONTACT_START - 0.16));
    position = lifted.clone().lerp(catchPose.position, u);
    position.y += Math.sin(u * Math.PI) * PAGE_TURN_AUTHORED.CrossArc;
    quaternion = edgeOn.clone().slerp(catchPose.quaternion, u);
    tipWeight = u;
  } else if (p <= PAGE_CONTACT_END) {
    ({ position, quaternion } = pageGrip(p, direction));
    tipWeight = 1;
  } else if (p < lowerStart) {
    const u = (p - PAGE_CONTACT_END) / (lowerStart - PAGE_CONTACT_END);
    const release = pageGrip(PAGE_CONTACT_END, direction);
    const epsilon = 0.0001;
    const velocity = pageGrip(PAGE_CONTACT_END + epsilon, direction).position
      .sub(pageGrip(PAGE_CONTACT_END - epsilon, direction).position).multiplyScalar((lowerStart - PAGE_CONTACT_END) / (2 * epsilon));
    // Release just beyond the spine, before the falling sheet pulls the palm into the stack.
    // Keep its tangent at release, then recover above the book and clear the outer edge.
    position = hermite(release.position, velocity, returnHigh, new THREE.Vector3(), u);
    // Keep the sweep palm-down until it clears the book; turn edge-on before
    // supinating outside the cover for the supporting return.
    quaternion = release.quaternion.clone().slerp(edgeOn, smooth(u));
    tipWeight = 1 - smooth(u);
  } else if (p < supportReturn) {
    const u = smooth((p - lowerStart) / (supportReturn - lowerStart));
    position = returnHigh.clone().lerp(outside, u);
    quaternion = edgeOn.clone().slerp(support.quaternion, u);
  } else {
    const u = smooth((p - supportReturn) / (1 - supportReturn));
    position = outside.clone().lerp(support.position, u);
    quaternion = support.quaternion.clone();
  }
  const pinch = smooth((p - 0.24) / 0.06) * (1 - smooth((p - PAGE_CONTACT_END) / 0.08));
  return { side, position, quaternion, tipWeight,
    fingerCurl: THREE.MathUtils.lerp(0.04, 0.12, pinch),
    thumbOppose: THREE.MathUtils.lerp(0.024, 0.18, pinch),
    shoulderWeight: 0.1 + 0.20 * Math.sin(Math.PI * p) ** 2 };
}

/** Blender Bezier handles are evaluated directly: continuous velocity, no frame history. */
export function authoredPageRatio(progress: number) {
  const keys = PAGE_TURN_AUTHORED.page;
  const p = THREE.MathUtils.clamp(progress, 0, 1);
  const i = keys.findIndex(key => key[0] >= p);
  if (i <= 0) return keys[0][1];
  const a = keys[i - 1], b = keys[i];
  const cubic = (x: number, y: number, z: number, w: number, t: number) =>
    (1 - t) ** 3 * x + 3 * (1 - t) ** 2 * t * y + 3 * (1 - t) * t * t * z + t ** 3 * w;
  let lo = 0, hi = 1;
  for (let n = 0; n < 36; n++) {
    const t = (lo + hi) / 2;
    if (cubic(a[0], a[4], b[2], b[0], t) < p) lo = t; else hi = t;
  }
  return cubic(a[1], a[5], b[3], b[1], (lo + hi) / 2);
}

export function turningPagePoint(leafRatio: number, bendAmp: number, rx = 0.185, rz = -0.085) {
  const reverse = bendAmp < 0;
  const ratio = THREE.MathUtils.clamp(reverse ? 1 - leafRatio : leafRatio, 0, 1);
  bendAmp = Math.abs(bendAmp);
  const surface = bookWingPose(1).surfaceY;
  // A bending wave travels from the free edge towards the binding. Integrating its
  // tangent preserves the paper's arc length while the fingertip sweeps low.
  // The old single pivot made an almost rigid board rise to the character's face.
  const width = PAGE_TURN_AUTHORED.CurlWaveWidth;
  const angleAt = (radius: number) => BOOK_WING_ANGLE + (Math.PI - 2 * BOOK_WING_ANGLE)
    * smooth((ratio - (1 - width) * (1 - radius / BOOK_PAGE_WIDTH)) / width)
    + Math.sin(radius / BOOK_PAGE_WIDTH * Math.PI) * bendAmp;
  const gutterX = THREE.MathUtils.lerp(-1, 1, ratio) * surface * Math.sin(BOOK_WING_ANGLE);
  const position = new THREE.Vector3(gutterX, surface * Math.cos(BOOK_WING_ANGLE), rz);
  const steps = 48, ds = rx / steps;
  for (let i = 0; i < steps; i++) {
    const theta = angleAt((i + 0.5) * ds);
    position.x += ds * Math.cos(theta);
    position.y += ds * Math.sin(theta);
  }
  const theta = angleAt(rx);
  const tangent = new THREE.Vector3(Math.cos(theta), Math.sin(theta), 0);
  if (reverse) { position.x *= -1; tangent.x *= -1; }
  return { position, tangent, normal: new THREE.Vector3(-tangent.y, tangent.x, 0) };
}

export function bookPose(scene: string, book: LibraryBook, flow: LibraryFlow, authored = false) {
  const slot = slotFor(book);
  const p = THREE.MathUtils.clamp(flow.progress, 0, 1);
  const t = smooth(p);
  const phase = flow.book?.id === book.id ? flow.phase : 'idle';
  const shelf = new THREE.Vector3(slot.position[0] + 0.035, slot.position[1], 0.20);
  const outside = shelf.clone().add(new THREE.Vector3(0, 0, 0.31));
  const standX = slot.position[0] + (authored ? 0 : .01);
  const standZ = authored ? .58 + AUTHORED_BOOK_RETREAT : .90;
  const open = coverOpenCurve({ ...flow, phase });
  // Preserve the baked closed handoff; the open book leaves room for the crossing
  // forearm in front of the torso, with the supporting palms beneath its footprint.
  const heldBase = new THREE.Vector3(standX + 0.11 * (1 - open), THREE.MathUtils.lerp(0.84, 0.85, open) + .09 * smooth(open / .3) * (1 - open), standZ - 0.32 + .035 * smooth(open / .3) + PAGE_TURN_AUTHORED.BookNear * open);
  heldBase.z -= .075 * Math.sin(Math.PI * open) - .004 * Math.sin(Math.PI * smooth((open - .35) / .55));
  heldBase.y -= .03 * Math.sin(Math.PI * open);
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
    // Keep the closed baked handoff, then raise the front edge with the opening cover.
    if (open > 0) quaternion.setFromEuler(new THREE.Euler(THREE.MathUtils.lerp(HELD_TILT, READING_TILT, open), Math.PI, 0));
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
      const lift = smooth(p / 0.22) * (1 - smooth((p - 0.85) / 0.15)) * 0.015 * smooth(open / .1);
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

  position.fromArray(shelfPoint(scene, position.x, position.y, position.z));
  quaternion.premultiply(shelfRotation(scene));
  return { position, quaternion, open, phase };
}

export function residentLibraryTarget(scene: string, flow: LibraryFlow, authored = false): Vec3 {
  if (flow.book && flow.phase === 'align') return authored ? authoredBookStand(scene, flow.book) : bookStand(scene, flow.book, true);
  return readingStand(scene);
}

export const leafProgress = (flow: LibraryFlow) => turningPageCurve(flow.progress, flow.direction).forwardRatio;
