import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { load } from '../load-for-validation.mjs';

function loadTS(relativePath, deps = {}) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {}, require: id => id === 'three' ? THREE : deps[id] };
  vm.runInNewContext(compiled, mod);
  return mod.exports;
}

const catalog = loadTS('./catalog.ts');
const authored = loadTS('./pageTurnFrames.ts');
const bookMotion = loadTS('./bookMotion.ts', { './catalog': catalog, './pageTurnFrames': authored });
const armPose = loadTS('./armPose.ts');
const residentPose = loadTS('./residentPose.ts', { './bookMotion': bookMotion, './catalog': catalog, './armPose': armPose, './pageTurnFrames': authored });
const rigMod = loadTS('../residentRig.ts');
const libraryMotion = loadTS('./libraryMotion.ts', { './bookMotion': bookMotion, './catalog': catalog, '../residentRig': rigMod });
const { gltf } = await load(new URL('../../../../assets/public/models/resident/luna-walk-room.glb', import.meta.url));

function makeRig() {
  const asset = clone(gltf.scene);
  const rig = rigMod.createResidentRig(asset, gltf.animations[0]);
  const root = new THREE.Group();
  root.add(rig.mesh);
  root.rotation.y = Math.PI + catalog.shelfYaw('habitat');
  return { asset, rig, root };
}

function stepPose(rig, root, book, phase, progress, direction = 1) {
  const flow = { phase, book, page: 0, targetPage: 1, direction, progress, pages: [], nextId: null, closeRequested: false, exit: false, pending: null };
  const isHeld = ['open', 'reading', 'turn', 'close'].includes(phase);
  const stand = bookMotion.bookStand('habitat', book, !isHeld);
  root.position.set(stand[0], 0, stand[2]);
  residentPose.carryResident(root, 'habitat', flow);
  root.position.y -= residentPose.libraryCrouch(flow);
  root.updateMatrixWorld(true);
  // Settle damped torso/gaze over a few steps so we inspect the target pose.
  for (let i = 0; i < 6; i++) residentPose.applyLibraryPose(rig, root, 'habitat', flow, 0.25);
  rig.applyPose(0, 0);
  root.updateMatrixWorld(true);
  return bookMotion.bookPose('habitat', book, flow);
}

// Same rounded solids and moving frames as LibraryBooks/SoftBox. Contact is
// measured against triangle surfaces, independently of the IK palm target.
function roundedBookSolids(open) {
  const parts = [], identity = new THREE.Quaternion();
  const frameMatrix = frame => new THREE.Matrix4().compose(frame.position, frame.quaternion,
    new THREE.Vector3(frame.widthScale ?? 1, 1, 1));
  const wings = [0, 1].map(side => bookMotion.bookWingPose(side, open));
  const matrices = wings.map(frameMatrix);
  function add(dims, radius, center, parent, scale = [1, 1, 1]) {
    const matrix = parent.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(...center), identity, new THREE.Vector3(...scale)));
    if (Math.abs(matrix.determinant()) < 1e-9) return;
    const geometry = new RoundedBoxGeometry(...dims, 2, Math.max(.0001, Math.min(radius, ...dims.map(d => d * .45))));
    geometry.applyMatrix4(matrix); geometry.computeBoundingBox();
    const box = geometry.boundingBox.clone(), centerPoint = box.getCenter(new THREE.Vector3());
    const positions = geometry.getAttribute('position'), index = geometry.index, triangles = [], planes = [];
    for (let i = 0; i < (index ? index.count : positions.count); i += 3) {
      const triangle = new THREE.Triangle(...[0, 1, 2].map(k => new THREE.Vector3().fromBufferAttribute(positions, index ? index.getX(i + k) : i + k)));
      const normal = triangle.getNormal(new THREE.Vector3());
      if (normal.lengthSq() < .5) continue;
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, triangle.a);
      if (plane.distanceToPoint(centerPoint) > 0) plane.negate();
      triangles.push(triangle); planes.push(plane);
    }
    geometry.dispose(); parts.push({ box, triangles, planes });
  }
  add([.24, .012, .22], .003, [.12, 0, 0], matrices[1]);
  for (const side of [0, 1]) {
    const thickness = wings[side].thickness;
    add([.226, .041, .209], .002, [side ? .12 : -.12, .0065 + thickness / 2, 0], matrices[side], [1, thickness / .041, 1]);
  }
  const spine = new THREE.Matrix4().makeScale(1, (.012 + wings[1].thickness) / .053, 1);
  add([.011, .065, .22], .003, [0, .026, 0], spine);
  add([.005, .035, .09], .001, [-.006, .026, 0], spine);
  const cover = frameMatrix(bookMotion.bookCoverPose(open));
  add([.24, .012, .22], .003, [.12, 0, 0], cover);
  add([.12, .002, .09], .001, [.12, .007, 0], cover);
  return parts;
}

function skinSurfaceContact(vertices, parts) {
  let distance = Infinity, depth = 0;
  const nearest = new THREE.Vector3();
  for (const point of vertices) for (const part of parts) {
    const inside = part.box.containsPoint(point) && part.planes.every(plane => plane.distanceToPoint(point) <= 1e-7);
    if (!inside && part.box.distanceToPoint(point) >= distance) continue;
    let d = Infinity;
    for (const triangle of part.triangles) d = Math.min(d, triangle.closestPointToPoint(point, nearest).distanceTo(point));
    distance = Math.min(distance, d);
    if (inside) depth = Math.max(depth, d);
  }
  return { distance, depth };
}

test('十八个书位在伸手、抽出与推入全程保持手书贴合且手臂未超限', () => {
  const { rig, root } = makeRig();
  try {
    for (const slot of catalog.BOOK_SLOTS) {
      const book = { id: 'b', source: 'builtin', title: 'T', author: 'A', text: 'x', color: '#617e79', slotId: slot.id, anchor: 0 };
      const grabSide = bookMotion.bookGrabSide(book);
      const grabLocal = bookMotion.bookGrabLocal(book);
      const shelfPos = bookMotion.bookPose('habitat', book, { phase: 'reach', book, progress: 0, page: 0, targetPage: 0, direction: 1, pages: [], nextId: null, closeRequested: false, exit: false, pending: null }).position;
      const reachEnd = bookMotion.bookPose('habitat', book, { phase: 'reach', book, progress: 1, page: 0, targetPage: 0, direction: 1, pages: [], nextId: null, closeRequested: false, exit: false, pending: null }).position;
      assert.ok(shelfPos.distanceTo(reachEnd) < 1e-6, `${slot.id} reach 阶段书不能提前移动`);

      for (const [phase, samples] of [['reach', [1]], ['extract', [0, 0.5, 1]], ['insert', [0, 0.5, 1]]]) {
        for (const p of samples) {
          const pose = stepPose(rig, root, book, phase, p);
          const expected = grabLocal.clone().applyQuaternion(pose.quaternion).add(pose.position);
          const arm = rig.arms[grabSide];
          const modeOff = arm.palmOffset.clone().lerp(arm.fingerTipOffset, 0.48);
          const actual = modeOff.applyQuaternion(arm.hand.getWorldQuaternion(new THREE.Quaternion())).add(arm.hand.getWorldPosition(new THREE.Vector3()));
          assert.ok(actual.distanceTo(expected) < 0.002, `${slot.id} ${phase}@${p} 接触误差 ${actual.distanceTo(expected)}`);
          const ext = arm.upper.getWorldPosition(new THREE.Vector3()).distanceTo(arm.hand.getWorldPosition(new THREE.Vector3())) / (arm.upperLength + arm.lowerLength);
          assert.ok(ext < 0.92, `${slot.id} ${phase}@${p} 手臂伸展比例 ${ext}`);
        }
      }
    }
  } finally {
    rig.dispose();
  }
});

test('Blender three-row clips bind to the resident and keep every book at its shelf and handoff anchors', async () => {
  const { gltf: baked } = await load(new URL('../../../../assets/public/models/resident/luna-library.glb', import.meta.url));
  const motion = libraryMotion.readLibraryMotion(baked.animations);
  const { rig, root, asset } = makeRig();
  const play = libraryMotion.createLibraryPlayer(rig.mesh, motion);
  const contacts = ['RightHand', 'LeftHand', 'RightFoot', 'LeftFoot'].map(name => asset.getObjectByName(`mixamorig${name}`));
  function sample(book, phase, progress) {
    const flow = { book, phase, progress };
    const frame = libraryMotion.libraryMotionSample(flow);
    const coverFlow = libraryMotion.libraryCoverFlow(flow, frame);
    const pose = bookMotion.bookPose('habitat', book, coverFlow, true);
    root.position.fromArray(bookMotion.authoredBookStand('habitat', book, frame.coverProgress !== undefined));
    rig.applyPose(0, 0);
    play(book, frame);
    libraryMotion.applyLibraryBookMotion(motion, 'habitat', book, frame, pose.position, pose.quaternion);
    return { pose, anchors: contacts.map(joint => joint.getWorldPosition(new THREE.Vector3())) };
  }
  const adjacent = [
    ['reach', 1, 'extract', 0], ['extract', 1, 'carry', 0],
    ['carry', 1, 'open', 0], ['close', 1, 'return-carry', 0],
    ['return-carry', 1, 'insert', 0], ['insert', 1, 'release', 0],
  ];
  try {
    for (const slot of catalog.BOOK_SLOTS) {
      const book = { id: 'b', slotId: slot.id };
      const shelf = bookMotion.bookPose('habitat', book, { phase: 'idle', progress: 0 });
      const held = bookMotion.bookPose('habitat', book, { book, phase: 'open', progress: 0 }, true);
      const extracted = sample(book, 'extract', 0).pose;
      const carried = sample(book, 'carry', 1).pose;
      assert.ok(extracted.position.distanceTo(shelf.position) < .002, `${slot.id} seated book position`);
      assert.ok(extracted.quaternion.angleTo(shelf.quaternion) < .003, `${slot.id} seated book orientation`);
      assert.ok(carried.position.distanceTo(held.position) < .002, `${slot.id} held book position`);
      assert.ok(carried.quaternion.angleTo(held.quaternion) < .003, `${slot.id} held book orientation`);
      for (const [a, p, b, q] of adjacent) {
        const start = sample(book, a, p), end = sample(book, b, q);
        assert.ok(start.pose.position.distanceTo(end.pose.position) < .0001, `${slot.id} ${a} → ${b}: book position`);
        assert.ok(start.pose.quaternion.angleTo(end.pose.quaternion) < .001, `${slot.id} ${a} → ${b}: book orientation`);
        start.anchors.forEach((anchor, i) => {
          assert.ok(anchor.distanceTo(end.anchors[i]) < .0001, `${slot.id} ${a} → ${b}: ${contacts[i].name}`);
        });
      }
      const pull = sample(book, 'extract', .35), push = sample(book, 'insert', .65);
      assert.ok(pull.pose.position.distanceTo(push.pose.position) < .0001, `${slot.id} insertion reverses extraction`);
      pull.anchors.forEach((anchor, i) => {
        assert.ok(anchor.distanceTo(push.anchors[i]) < .0001, `${slot.id} ${contacts[i].name} reverses with the book`);
      });
    }
  } finally {
    rig.dispose();
  }
});

test('开书、合书与双向翻页手部轨迹紧贴封面边缘和弯曲纸页', () => {
  const { rig, root } = makeRig();
  try {
    const book = catalog.freshLibrary().books[0];
    for (let i = 0; i <= 10; i++) {
      const p = i / 10;
      const pose = stepPose(rig, root, book, 'open', p);
      if (p <= 0.78) {
        const cg = bookMotion.bookCoverGripPose(pose.open);
        const expected = cg.position.clone().applyQuaternion(pose.quaternion).add(pose.position);
        const arm = rig.arms[0];
        const actual = arm.palmOffset.clone().applyQuaternion(arm.hand.getWorldQuaternion(new THREE.Quaternion())).add(arm.hand.getWorldPosition(new THREE.Vector3()));
        assert.ok(actual.distanceTo(expected) < 0.002, `open@${p} 封面手接触误差`);
      }
      const cpose = stepPose(rig, root, book, 'close', p);
      if (p >= 0.22) {
        const cg = bookMotion.bookCoverGripPose(cpose.open);
        const expected = cg.position.clone().applyQuaternion(cpose.quaternion).add(cpose.position);
        const arm = rig.arms[0];
        const actual = arm.palmOffset.clone().applyQuaternion(arm.hand.getWorldQuaternion(new THREE.Quaternion())).add(arm.hand.getWorldPosition(new THREE.Vector3()));
        assert.ok(actual.distanceTo(expected) < 0.002, `close@${p} 封面手接触误差`);
      }
    }
    for (const dir of [1, -1]) {
      for (let i = Math.round(bookMotion.PAGE_CONTACT_START * 100); i <= Math.round(bookMotion.PAGE_CONTACT_END * 100); i += 3) {
        const p = i / 100;
        const pose = stepPose(rig, root, book, 'turn', p, dir);
        const curve = bookMotion.turningPageCurve(p, dir);
        const pt = bookMotion.turningPagePoint(curve.leafRatio, curve.bendAmp, 0.205, 0.085);
        const expected = pt.position.clone().addScaledVector(pt.normal, dir > 0 ? 0.002 : -0.002).applyQuaternion(pose.quaternion).add(pose.position);
        const arm = rig.arms[dir > 0 ? 0 : 1];
        const actual = arm.fingerTipOffset.clone().applyQuaternion(arm.hand.getWorldQuaternion(new THREE.Quaternion())).add(arm.hand.getWorldPosition(new THREE.Vector3()));
        assert.ok(actual.distanceTo(expected) < 0.002, `turn(${dir})@${p} 纸页指尖误差`);
      }
      const endCurve = bookMotion.turningPageCurve(1, dir);
      assert.equal(endCurve.leafRatio, dir > 0 ? 1 : 0);
      assert.ok(Math.abs(endCurve.bendAmp) < 1e-6);
    }
  } finally {
    rig.dispose();
  }
});

test('开书、双向翻页和合书的蒙皮手臂不会单帧反转', () => {
  const { asset, rig, root } = makeRig();
  const book = catalog.freshLibrary().books[0];
  const joints = ['Right', 'Left'].flatMap(side => ['Arm', 'ForeArm', 'Hand'].map(name => asset.getObjectByName(`mixamorig${side}${name}`)));
  const phases = [['open', 1], ['reading', 1], ['turn', 1], ['reading', 1], ['turn', -1], ['reading', 1], ['close', 1]];
  root.position.fromArray(bookMotion.authoredBookStand('habitat', book, true));
  let previous;
  try {
    for (const [phase, direction] of phases) for (let frame = 0; frame <= 240; frame++) {
      const flow = { book, phase, direction, progress: frame / 240 };
      residentPose.applyLibraryPose(rig, root, 'habitat', flow, 1 / 120, true);
      rig.applyPose(0, 0);
      if (previous) joints.forEach((joint, i) => {
        assert.ok(joint.quaternion.angleTo(previous[i]) < Math.PI / 15,
          `${phase}(${direction}) frame ${frame}: ${joint.name} changed more than 12°`);
      });
      previous = joints.map(joint => joint.quaternion.clone());
    }
  } finally {
    rig.dispose();
  }
});

test('连续阶段衔接处手腕与书本位置无跳变，且底层屈膝脚底贴地稳定', () => {
  const { asset, rig, root } = makeRig();
  try {
    for (const book of [catalog.freshLibrary().books[0], { ...catalog.freshLibrary().books[0], slotId: 's0-0' }, { ...catalog.freshLibrary().books[0], slotId: 's2-5' }]) {
      const pairs = [
        [['reach', 1], ['extract', 0]],
        [['extract', 1], ['carry', 0]],
        [['carry', 1], ['open', 0]],
        [['open', 1], ['reading', 0]],
        [['reading', 1], ['turn', 0]],
        [['turn', 1], ['reading', 0]],
        [['reading', 1], ['close', 0]],
        [['close', 1], ['return-carry', 0]],
        [['return-carry', 1], ['insert', 0]],
        [['insert', 1], ['release', 0]],
      ];
      for (const [[phA, pA], [phB, pB]] of pairs) {
        const poseA = stepPose(rig, root, book, phA, pA);
        const wristsA = rig.arms.map(a => a.hand.getWorldPosition(new THREE.Vector3()));
        const poseB = stepPose(rig, root, book, phB, pB);
        const wristsB = rig.arms.map(a => a.hand.getWorldPosition(new THREE.Vector3()));
        assert.ok(poseA.position.distanceTo(poseB.position) < 0.002, `${book.slotId} ${phA}->${phB} 书位置跳变`);
        for (let s = 0; s < 2; s++) {
          assert.ok(wristsA[s].distanceTo(wristsB[s]) < 0.015, `${book.slotId} ${phA}->${phB} arm ${s} 手腕跳变 ${wristsA[s].distanceTo(wristsB[s])}`);
        }
      }
    }

    // Check bottom-shelf crouch leg IK keeps both soles anchored at neutral foot Y/Z.
    const bottomBook = { ...catalog.freshLibrary().books[0], slotId: 's0-0' };
    rig.applyPose(0, 0);
    rig.mesh.position.y = 0;
    rig.mesh.updateMatrixWorld(true);
    const neutralL = asset.getObjectByName('mixamorigLeftFoot').getWorldPosition(new THREE.Vector3());
    for (const crouch of [0.02, 0.10, 0.19]) {
      const leg = rig.legs[1];
      const footZ = leg.thigh.position.z + leg.shin.position.z + leg.foot.position.z;
      const ahead = footZ - leg.hipForward;
      const below = leg.thigh.position.y - leg.ankleHeight - crouch;
      const { upperLength: thigh, lowerLength: shin } = leg;
      const reach = THREE.MathUtils.clamp(Math.hypot(ahead, below), Math.abs(thigh - shin) + 0.001, (thigh + shin) * 0.999);
      const hip = Math.atan2(ahead, below) + Math.acos(THREE.MathUtils.clamp((thigh * thigh + reach * reach - shin * shin) / (2 * thigh * reach), -1, 1));
      const knee = Math.PI - Math.acos(THREE.MathUtils.clamp((thigh * thigh + shin * shin - reach * reach) / (2 * thigh * shin), -1, 1));
      leg.thigh.rotation.x = -hip + leg.straighten[0];
      leg.shin.rotation.x = knee + leg.straighten[1];
      leg.foot.rotation.x = -(leg.thigh.rotation.x + leg.shin.rotation.x);
      rig.mesh.position.y = -crouch;
      rig.applyPose(0, 0);
      rig.mesh.updateMatrixWorld(true);
      const movedL = asset.getObjectByName('mixamorigLeftFoot').getWorldPosition(new THREE.Vector3());
      assert.ok(Math.abs(movedL.y - neutralL.y) < 0.002 && Math.abs(movedL.z - neutralL.z) < 0.002, `crouch ${crouch} 脚位漂移`);
    }
    void bottomBook;
  } finally {
    rig.dispose();
  }
});

test('翻页手先跨页再接触：双向掌心朝纸页，页过书脊后释放，回到原侧托书', () => {
  assert.ok(bookMotion.PAGE_TURN_SECONDS >= 2.8 && bookMotion.PAGE_TURN_SECONDS <= 3.2);
  for (const direction of [1, -1]) {
    const side = direction > 0 ? 0 : 1;
    const rest = bookMotion.bookSupportPose(side);
    const start = bookMotion.turningHandPose(0, direction);
    const end = bookMotion.turningHandPose(1, direction);
    assert.equal(start.side, side);
    for (const pose of [start, end]) {
      assert.ok(pose.position.distanceTo(rest.position) < 1e-9);
      assert.ok(pose.quaternion.angleTo(rest.quaternion) < 1e-7);
      assert.equal(pose.tipWeight, 0);
    }
    const caught = bookMotion.turningHandPose(bookMotion.PAGE_CONTACT_START, direction);
    assert.ok(caught.position.x * rest.position.x < 0, 'cross the spine to the opposite page corner before lifting');
    assert.ok(new THREE.Vector3(0, 0, 1).applyQuaternion(caught.quaternion).y < -0.8, 'palm approaches from above with fingers angled down');
    assert.equal(bookMotion.turningPageCurve(bookMotion.PAGE_CONTACT_START, direction).forwardRatio, 0);
    assert.ok(bookMotion.turningPageCurve(bookMotion.PAGE_CONTACT_END, direction).forwardRatio > 0.5, 'carry the page beyond the spine before release');
    for (let frame = 0; frame <= 720; frame++) {
      const p = frame / 720;
      const hand = bookMotion.turningHandPose(p, direction);
      if (p >= bookMotion.PAGE_CONTACT_START && p <= bookMotion.PAGE_CONTACT_END) {
        const curve = bookMotion.turningPageCurve(p, direction);
        const page = bookMotion.turningPagePoint(curve.leafRatio, curve.bendAmp, 0.205, 0.085);
        const palmNormal = new THREE.Vector3(0, 0, 1).applyQuaternion(hand.quaternion);
        assert.ok(palmNormal.y < -0.8, 'palm stays down even when the sheet normal turns upwards');
        assert.ok(Math.abs(hand.position.distanceTo(page.position) - 0.002) < 1e-9);
        assert.equal(hand.tipWeight, 1);
        assert.ok(hand.fingerCurl <= 0.15 && hand.thumbOppose <= 0.2, 'pinch stays soft');
      }
    }
    for (const boundary of [0.08, 0.16, bookMotion.PAGE_CONTACT_START, bookMotion.PAGE_CONTACT_END, 0.78, 0.86]) {
      const epsilon = 1e-5;
      const a = bookMotion.turningHandPose(boundary - epsilon, direction);
      const b = bookMotion.turningHandPose(boundary + epsilon, direction);
      assert.ok(a.position.distanceTo(b.position) < 0.0001, `position continuous at ${boundary}`);
      assert.ok(a.quaternion.angleTo(b.quaternion) < 0.001, `palm frame continuous at ${boundary}`);
      const center = bookMotion.turningHandPose(boundary, direction).position;
      const incoming = center.clone().sub(a.position).divideScalar(epsilon);
      const outgoing = b.position.clone().sub(center).divideScalar(epsilon);
      assert.ok(incoming.distanceTo(outgoing) < 0.006, `velocity continuous at ${boundary}`);
    }
  }
});

test('正向翻页左手持续托在书脊下，双向手臂保持可达且不穿过纸页堆', () => {
  const { rig, root } = makeRig();
  const book = catalog.freshLibrary().books[0];
  try {
    for (const direction of [1, -1]) for (let frame = 0; frame <= 180; frame++) {
      const p = frame / 180;
      const pose = stepPose(rig, root, book, 'turn', p, direction);
      const hand = bookMotion.turningHandPose(p, direction);
      const supportSide = 1 - hand.side;
      const support = rig.arms[supportSide];
      const actual = support.palmOffset.clone().applyQuaternion(support.hand.getWorldQuaternion(new THREE.Quaternion())).add(support.hand.getWorldPosition(new THREE.Vector3()));
      const local = actual.sub(pose.position).applyQuaternion(pose.quaternion.clone().invert());
      assert.ok(local.distanceTo(bookMotion.bookSupportPose(supportSide).position) < 0.002);
      if (direction > 0) assert.ok(local.x < 0.08 && local.y < 0, 'left cradles beneath the spine');
      const turning = rig.arms[hand.side];
      const fingertip = turning.palmOffset.clone().lerp(turning.fingerTipOffset, hand.tipWeight)
        .applyQuaternion(turning.hand.getWorldQuaternion(new THREE.Quaternion())).add(turning.hand.getWorldPosition(new THREE.Vector3()));
      const expected = hand.position.clone().applyQuaternion(pose.quaternion).add(pose.position);
      assert.ok(fingertip.distanceTo(expected) < 0.002, `turning contact ${direction}@${p}`);
      if (direction > 0) {
        const wrist = support.hand.getWorldPosition(new THREE.Vector3()).sub(pose.position).applyQuaternion(pose.quaternion.clone().invert());
        assert.ok(Math.abs(wrist.z) < 0.1075 && wrist.z < local.z, 'support wrist stays beneath the book footprint behind its contacting palm');
      }
      for (const arm of rig.arms) {
        const extension = arm.upper.getWorldPosition(new THREE.Vector3()).distanceTo(arm.hand.getWorldPosition(new THREE.Vector3())) / (arm.upperLength + arm.lowerLength);
        assert.ok(extension < 0.985, `reachable ${direction}@${p}: ${extension}`);
      }
      // The crossing contact clears the top face; lowering happens only beyond the cover edge.
      if (p >= 0.16 && p <= bookMotion.PAGE_CONTACT_START) assert.ok(hand.position.y >= 0.049, 'reach travels above the page stack');
      if (p > bookMotion.PAGE_CONTACT_END && p < 0.78) assert.ok(hand.position.y > 0.12, 'released palm returns above the falling sheet and page stacks');
      if (p > 0.78 && p < 0.86) assert.ok(Math.abs(hand.position.x) > 0.24, 'lower hand beyond the cover with room for the palm width');
    }
  } finally {
    rig.dispose();
  }
});

test('浅 V 的封面、正文和活动页在两端共面，合书保持原厚度', () => {
  const angle = bookMotion.BOOK_WING_ANGLE;
  assert.ok(angle >= THREE.MathUtils.degToRad(10) && angle <= THREE.MathUtils.degToRad(14));
  assert.equal(bookMotion.bookWingPose(1, 0).thickness, 0.041);
  assert.equal(bookMotion.bookWingPose(0, 0).widthScale, 0);
  for (const side of [0, 1]) {
    const wing = bookMotion.bookWingPose(side);
    assert.ok(Math.abs(wing.thickness - 0.011) < 1e-12, 'opened page stacks relax to the Blender-authored thin book profile');
    const normal = new THREE.Vector3(0, 1, 0).applyQuaternion(wing.quaternion);
    assert.ok(Math.abs(normal.y - Math.cos(angle)) < 1e-12);
    for (let i = 0; i <= 18; i++) {
      const radius = bookMotion.BOOK_PAGE_WIDTH * i / 18;
      for (const z of [-0.1075, 0.1075]) {
        const top = bookMotion.bookWingPoint(side, 1, radius, wing.surfaceY, z);
        const page = bookMotion.turningPagePoint(side === 1 ? 0 : 1, 0, radius, z);
        assert.ok(page.position.distanceTo(top) < 1e-12, `${side} vertex ${i} lands on the static top face`);
        assert.ok(Math.abs(page.normal.dot(normal)) > 1 - 1e-12, 'sheet and text share the wing plane');
      }
    }
  }
  for (let i = 0; i <= 120; i++) {
    const open = i / 120;
    const frame = bookMotion.bookCoverPose(open);
    const grip = bookMotion.bookCoverGripPose(open);
    const local = grip.position.clone().sub(frame.position).applyQuaternion(frame.quaternion.clone().invert());
    assert.ok(local.distanceTo(new THREE.Vector3(0.18-.135*(1-bookMotion.smooth(open/.55)), 0.0185, -0.088+.06*Math.sin(Math.PI*open))) < 1e-12, 'cover hand remains attached during opening and closing');
    const support = bookMotion.bookSupportPose(1, open);
    const wing = bookMotion.bookWingPose(1, open);
    const underside = support.position.clone().sub(wing.position).applyQuaternion(wing.quaternion.clone().invert());
    assert.ok(underside.y >= -.0265 - 1e-12 && underside.y <= -.014 + 1e-12, 'left support anchor stays below the bottom cover');
    if (i === 0 || i === 120) assert.ok(Math.abs(underside.y - (i === 0 ? -.0265 : -.014)) < 1e-12, 'closed and fully open support heights stay unchanged');
    assert.ok(underside.x > 0 && underside.x <= 0.19 + 1e-12, 'left support moves continuously toward the spine');
  }
  const left = bookMotion.bookSupportPose(1).position;
  assert.ok(left.x < 0.05 && left.z > 0.02 && left.z < 0.07, 'left palm supports inside the book footprint near the spine');
});

test('腰前闭书与阅读开合和烘焙交接端点连续，抬页低于面部', () => {
  const book = catalog.freshLibrary().books[0];
  for (const authored of [false, true]) {
    const pose = (phase, progress, direction = 1) => bookMotion.bookPose('habitat', book, { book, phase, progress, direction }, authored);
    assert.equal(pose('open', 0).position.y, 0.84);
    assert.equal(pose('reading', 0).position.y, 0.85);
    const closed = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08, Math.PI, 0));
    const reading = new THREE.Quaternion().setFromEuler(new THREE.Euler(0.08, Math.PI, 0));
    assert.ok(bookMotion.heldQuaternion.angleTo(closed) < 1e-7, 'preserve the baked closed tilt');
    closed.premultiply(bookMotion.shelfRotation('habitat'));
    reading.premultiply(bookMotion.shelfRotation('habitat'));
    assert.ok(pose('open', 0).quaternion.angleTo(closed) < 1e-7);
    assert.ok(pose('close', 1).quaternion.angleTo(closed) < 1e-7);
    assert.ok(pose('reading', 0).quaternion.angleTo(reading) < 1e-7);
    assert.ok(new THREE.Vector3(0, 0, 1).applyQuaternion(reading).y > 0, 'the open front edge rises');
    for (const phase of ['open', 'close']) {
      let previous;
      for (let i = 0; i <= 120; i++) {
        const held = pose(phase, i / 120);
        const front = new THREE.Vector3(0, 0, 1).applyQuaternion(held.quaternion);
        const pitch = Math.atan2(front.y, Math.hypot(front.x, front.z));
        assert.ok(Math.abs(pitch - THREE.MathUtils.lerp(0.08, 0.08, held.open)) < 1e-10, 'pitch follows the same continuous cover opening');
        if (previous) assert.ok(held.quaternion.angleTo(previous) < 0.02, phase + ': continuous orientation');
        previous = held.quaternion.clone();
      }
    }
    for (const [[a, p], [b, q]] of [
      [['carry', 1], ['open', 0]], [['open', 1], ['reading', 0]],
      [['reading', 1], ['close', 0]], [['close', 1], ['return-carry', 0]],
    ]) {
      assert.ok(pose(a, p).position.distanceTo(pose(b, q).position) < 1e-12, `${a} → ${b}: position`);
      assert.ok(pose(a, p).quaternion.angleTo(pose(b, q).quaternion) < 1e-7, `${a} → ${b}: rotation`);
    }
    for (const direction of [1, -1]) {
      for (const p of [0, 1]) {
        assert.ok(pose('turn', p, direction).position.distanceTo(pose('reading', 0).position) < 1e-12);
        assert.ok(pose('turn', p, direction).quaternion.angleTo(pose('reading', 0).quaternion) < 1e-7);
      }
      for (let i = 0; i <= 180; i++) {
        const p = i / 180, held = pose('turn', p, direction);
        const curve = bookMotion.turningPageCurve(p, direction);
        for (const z of [-0.1075, 0.1075]) {
          const edge = bookMotion.turningPagePoint(curve.leafRatio, curve.bendAmp, bookMotion.BOOK_PAGE_WIDTH, z).position;
          edge.applyQuaternion(held.quaternion).add(held.position);
          assert.ok(edge.y < 1.15, `turn(${direction})@${p}: raised page remains below face height`);
        }
      }
    }
  }
});

test('双向翻页的前臂旋转有界，重复播放、倒序跳进度和四元数换号得到相同姿态', () => {
  const { rig, root } = makeRig();
  const book = catalog.freshLibrary().books[0];
  root.position.fromArray(bookMotion.authoredBookStand('habitat', book, true));
  const progress = [0, 0.12, 0.23, 0.45, 0.65, 0.8, 1];
  const expected = new Map();
  try {
    for (let cycle = 0; cycle < 4; cycle++) for (const direction of [1, -1]) {
      for (const p of cycle % 2 ? [...progress].reverse() : progress) {
        const pose = bookMotion.bookPose('habitat', book, { book, phase: 'turn', direction, progress: p }, true);
        const hand = bookMotion.turningHandPose(p, direction), arm = rig.arms[hand.side];
        const contact = hand.position.clone().applyQuaternion(pose.quaternion).add(pose.position);
        const quaternion = hand.quaternion.clone().premultiply(pose.quaternion);
        if (cycle % 2) quaternion.set(-quaternion.x, -quaternion.y, -quaternion.z, -quaternion.w);
        const opts = { quaternion, blend: 1, tipWeight: hand.tipWeight, shoulderWeight: hand.shoulderWeight };
        armPose.reachPalm(rig, arm, contact, hand.side, opts);
        const joints = [arm.shoulder, arm.upper, arm.forearm, arm.hand];
        const key = `${direction}@${p}`;
        if (cycle === 0) expected.set(key, joints.map(joint => joint.quaternion.clone()));
        else joints.forEach((joint, i) => assert.ok(joint.quaternion.angleTo(expected.get(key)[i]) < 1e-6, `${key} cycle ${cycle}: joint ${i} depends on history`));
        const actual = arm.palmOffset.clone().lerp(arm.fingerTipOffset, hand.tipWeight)
          .applyQuaternion(arm.hand.getWorldQuaternion(new THREE.Quaternion())).add(arm.hand.getWorldPosition(new THREE.Vector3()));
        assert.ok(actual.distanceTo(contact) < 0.002, `${key} jump contact`);
        const shared = arm.forearm.quaternion.clone();
        armPose.reachArm(rig, arm, arm.hand.getWorldPosition(new THREE.Vector3()), hand.side);
        const roll = arm.forearm.quaternion.angleTo(shared);
        assert.ok(roll <= 1.75 + 1e-6, 'forearm pronation remains bounded');
        if (p === 0.45) assert.ok(roll > 0.15, 'forearm participates instead of leaving all twist at the wrist');
      }
    }
  } finally {
    rig.dispose();
  }
});


test('Blender low curling sweep preserves paper length and mirrors the reverse sheet', () => {
  let maxTipHeight = 0;
  for (let frame = 0; frame <= 300; frame++) {
    const p = frame / 300;
    const forward = bookMotion.turningPageCurve(p, 1);
    const reverse = bookMotion.turningPageCurve(p, -1);
    let previous, length = 0;
    for (let i = 0; i <= 96; i++) {
      const radius = bookMotion.BOOK_PAGE_WIDTH * i / 96;
      const a = bookMotion.turningPagePoint(forward.leafRatio, forward.bendAmp, radius, .085);
      const b = bookMotion.turningPagePoint(reverse.leafRatio, reverse.bendAmp, radius, .085);
      assert.ok(Math.abs(a.position.x + b.position.x) < 1e-10, 'reverse curl mirrors x');
      assert.ok(Math.abs(a.position.y - b.position.y) < 1e-10, 'both directions use the same low sweep');
      if (previous) length += a.position.distanceTo(previous);
      previous = a.position;
      if (i === 96) maxTipHeight = Math.max(maxTipHeight, a.position.y);
    }
    assert.ok(Math.abs(length - bookMotion.BOOK_PAGE_WIDTH) < .004, 'sheet length does not shrink into a rigid paddle');
  }
  assert.ok(maxTipHeight < .16, 'tip stays within 16 cm of the book plane throughout the curling sweep');
});

test('actual curled skin fingertip meets the sheet, instead of a neutral shortened proxy', () => {
  const { asset, rig, root } = makeRig();
  const book = catalog.freshLibrary().books[0];
  try {
    for (const direction of [1, -1]) for (let i = Math.round(bookMotion.PAGE_CONTACT_START * 100); i <= Math.round(bookMotion.PAGE_CONTACT_END * 100); i++) {
      const p = i / 100;
      const pose = stepPose(rig, root, book, 'turn', p, direction);
      const hand = bookMotion.turningHandPose(p, direction);
      const target = hand.position.clone().applyQuaternion(pose.quaternion).add(pose.position);
      const tip = asset.getObjectByName('mixamorig' + (direction > 0 ? 'Right' : 'Left') + 'HandMiddle4');
      const actual = tip.getWorldPosition(new THREE.Vector3());
      assert.ok(actual.distanceTo(target) < .002, direction + '@' + p + ': real finger contact error ' + actual.distanceTo(target));
    }
  } finally { rig.dispose(); }
});

test('双向扫页的真实掌面保持向下，手腕相对前臂不过折，回托后掌面向上', () => {
  const { asset, rig, root } = makeRig();
  const book = catalog.freshLibrary().books[0];
  root.position.fromArray(bookMotion.authoredBookStand('habitat', book, true));
  const skin = ['Right', 'Left'].map(side => {
    const joint = name => asset.getObjectByName(`mixamorig${side}${name}`);
    return { hand: joint('Hand'), forearm: joint('ForeArm'), middle: joint('HandMiddle1'),
      index: joint('HandIndex1'), pinky: joint('HandPinky1'), neutral: joint('Hand').quaternion.clone() };
  });
  const at = joint => joint.getWorldPosition(new THREE.Vector3());
  try {
    for (const direction of [1, -1]) {
      let previous;
      for (let frame = 0; frame <= 240; frame++) {
        const p = frame / 240, flow = { book, phase: 'turn', direction, progress: p };
        const pose = bookMotion.bookPose('habitat', book, flow, true);
        residentPose.applyLibraryPose(rig, root, 'habitat', flow, 1 / 80, true);
        rig.applyPose(0, 0);
        root.updateMatrixWorld(true);
        const palms = skin.map((s, side) => {
          const fingers = at(s.middle).sub(at(s.hand)).normalize();
          const across = at(s.index).sub(at(s.pinky)).normalize();
          // Reconstruct the signed real skin palm from the finger roots. Do not
          // reuse the IK palmBasis: a mirrored basis would mask an inverted hand.
          const normal = (side === 0 ? across.cross(fingers) : fingers.clone().cross(across)).normalize()
            .applyQuaternion(pose.quaternion.clone().invert());
          const forearm = at(s.hand).sub(at(s.forearm)).normalize();
          const flex = forearm.angleTo(fingers);
          const relativeWrist = s.hand.quaternion.clone().multiply(s.neutral.clone().invert());
          assert.ok(flex < THREE.MathUtils.degToRad(65), `${direction}@${p} arm ${side}: finger/forearm flex ${THREE.MathUtils.radToDeg(flex)}°`);
          assert.ok(relativeWrist.angleTo(new THREE.Quaternion()) < THREE.MathUtils.degToRad(70),
            `${direction}@${p} arm ${side}: static wrist reversal`);
          return normal;
        });
        const active = direction > 0 ? 0 : 1;
        assert.ok(palms[1 - active].y > 0.95, `${direction}@${p}: supporting palm faces the cover underside`);
        if (p >= bookMotion.PAGE_CONTACT_START && p <= bookMotion.PAGE_CONTACT_END) {
          assert.ok(palms[active].y < -0.8, `${direction}@${p}: actual sweep palm must face down, even after the page flips`);
        }
        if (p > bookMotion.PAGE_CONTACT_END && p <= 0.62) {
          assert.ok(palms[active].y < -0.5, `${direction}@${p}: release keeps the palm above the sheet`);
        }
        if (p <= 0.08 || p >= 0.86) assert.ok(palms[active].y > 0.9, `${direction}@${p}: palm-up support restored`);
        if (previous) palms.forEach((palm, side) => assert.ok(palm.angleTo(previous[side]) < 0.15,
          `${direction}@${p} arm ${side}: palm orientation discontinuity`));
        previous = palms;
      }
    }
  } finally { rig.dispose(); }
});

test('前臂分担扭转保留请求正负号，左右手都能旋前与旋后', () => {
  const { rig } = makeRig();
  try {
    for (const side of [0, 1]) for (const angle of [-0.8, 0.8]) {
      const arm = rig.arms[side];
      const wrist = rig.mesh.localToWorld(arm.restWrist.clone()).add(new THREE.Vector3(0, 0.05, 0.14));
      armPose.reachArm(rig, arm, wrist, side);
      const axis = arm.hand.getWorldPosition(new THREE.Vector3()).sub(arm.forearm.getWorldPosition(new THREE.Vector3())).normalize();
      const target = arm.hand.getWorldQuaternion(new THREE.Quaternion()).multiply(arm.palmBasis)
        .premultiply(new THREE.Quaternion().setFromAxisAngle(axis, angle));
      const contact = arm.palmOffset.clone().applyQuaternion(target.clone().multiply(arm.palmBasis.clone().invert())).add(wrist);
      armPose.reachPalm(rig, arm, contact, side, { quaternion: target, mode: 'palm', blend: 1 });
      const solved = arm.forearm.getWorldQuaternion(new THREE.Quaternion());
      const solvedWrist = arm.hand.getWorldPosition(new THREE.Vector3());
      armPose.reachArm(rig, arm, solvedWrist, side);
      const delta = solved.multiply(arm.forearm.getWorldQuaternion(new THREE.Quaternion()).invert());
      const projection = new THREE.Vector3(delta.x, delta.y, delta.z).dot(axis) * delta.w;
      assert.ok(projection * angle > 0.01, `arm ${side}, requested twist ${angle}: forearm turned away from palm`);
      assert.ok(delta.angleTo(new THREE.Quaternion()) <= 1.75, 'existing forearm rotation bound');
    }
  } finally { rig.dispose(); }
});

test('three-row pickup locks the spine before moving, catches upright, and hands off the real skin without a wrist jump', async () => {
  const { gltf: baked } = await load(new URL('../../../../assets/public/models/resident/luna-library.glb', import.meta.url));
  const motion = libraryMotion.readLibraryMotion(baked.animations);
  const { rig, root, asset } = makeRig();
  const play = libraryMotion.createLibraryPlayer(rig.mesh, motion);
  const joint = name => asset.getObjectByName('mixamorig' + name);
  const at = name => joint(name).getWorldPosition(new THREE.Vector3());
  const armNames = ['RightArm', 'RightForeArm', 'RightHand', 'LeftArm', 'LeftForeArm', 'LeftHand'];
  const sample = (book, phase, progress) => {
    const flow = { book, phase, progress };
    const frame = libraryMotion.libraryMotionSample(flow);
    const coverFlow = libraryMotion.libraryCoverFlow(flow, frame);
    root.position.fromArray(bookMotion.authoredBookStand('habitat', book, frame?.coverProgress !== undefined));
    root.updateMatrixWorld(true);
    armPose.resetArms(rig, 1);
    if (frame?.coverProgress !== undefined) {
      for (let n = 0; n < 40; n++) residentPose.applyLibraryPose(rig, root, 'habitat', coverFlow, .03, true);
    }
    rig.applyPose(0, 0);
    play(book, frame);
    root.updateMatrixWorld(true);
    const pose = bookMotion.bookPose('habitat', book, coverFlow, true);
    libraryMotion.applyLibraryBookMotion(motion, 'habitat', book, frame, pose.position, pose.quaternion);
    const joints = armNames.map(name => ({ position: at(name), quaternion: joint(name).getWorldQuaternion(new THREE.Quaternion()).normalize() }));
    return { pose, joints };
  };
  const byFrame = (book, frame) => frame <= 36 ? sample(book, 'reach', frame / 36)
    : frame <= 72 ? sample(book, 'extract', (frame - 36) / 36) : sample(book, 'carry', (frame - 72) / 72);
  try {
    for (let row = 0; row < 3; row++) {
      const book = { ...catalog.freshLibrary().books[0], slotId: `s${row}-2` };
      const shelf = byFrame(book, 0).pose;
      const spine = new THREE.Vector3(.026, -.00965, [.042, .020, -.037][row]);
      for (const fps of [30, 60, 120]) {
        let previous;
        for (let i = 0; i <= 6 * fps; i++) {
          const timeFrame = i * 30 / fps;
          const frame = timeFrame <= 72 ? timeFrame * .5 : timeFrame - 36;
          const { pose, joints } = byFrame(book, frame);
          const world = local => local.clone().applyQuaternion(pose.quaternion).add(pose.position);
          if (frame <= 36) assert.ok(pose.position.distanceTo(shelf.position) < .00001, 'book waits for the grip');
          if (frame <= 96) assert.ok(pose.quaternion.angleTo(bookMotion.shelfRotation('habitat').multiply(bookMotion.shelfQuaternion)) < .001, 'book stays upright through the bottom catch');
          if (frame >= 30 && frame <= 96) assert.ok(at('RightHandMiddle4').distanceTo(world(spine.clone().setZ(row === 2 ? -.037+.057*bookMotion.smooth((frame-72)/24) : spine.z))) < .002, `${row}@${frame}: middle fingertip follows the authored grip beside the spine`);
          // The final volume regression checks actual hand skin against the cover triangles.
          if (frame >= 96) for (const x of [0, .24]) for (const y of [0, .064]) for (const z of [-.11, .11]) {
            assert.ok(world(new THREE.Vector3(x, y, z)).y < 1.19, 'lower the book before turning its corner toward the face');
          }
          if (previous) joints.forEach((j, n) => {
            assert.ok(j.quaternion.angleTo(previous[n].quaternion) < .4 * 30 / fps, `${row}@${frame}: ${armNames[n]} orientation discontinuity`);
            assert.ok(j.position.distanceTo(previous[n].position) < .04 * 30 / fps, `${row}@${frame}: ${armNames[n]} position discontinuity`);
          });
          previous = joints;
        }
      }
      const held = byFrame(book, 144);
      const procedural = sample(book, 'open', .2);
      held.joints.forEach((j, i) => {
        assert.ok(j.position.distanceTo(procedural.joints[i].position) < .002, `${row}: closed-to-open ${armNames[i]} position`);
        assert.ok(j.quaternion.angleTo(procedural.joints[i].quaternion) < .004, `${row}: closed-to-open ${armNames[i]} rotation`);
      });
      for (const frame of [36, 54, 72, 84, 96, 108, 120, 132, 144]) {
        const forward = byFrame(book, frame);
        const reverse = frame <= 36 ? sample(book, 'release', 1 - frame / 36)
          : frame <= 72 ? sample(book, 'insert', 1 - (frame - 36) / 36)
          : sample(book, 'return-carry', 1 - (frame - 72) / 72);
        forward.joints.forEach((j, i) => {
          assert.ok(j.position.distanceTo(reverse.joints[i].position) < .00001, 'return reverses the same contact path');
          assert.ok(j.quaternion.angleTo(reverse.joints[i].quaternion) < .001, 'return reverses the same wrist and elbow frames');
        });
      }
    }
  } finally { rig.dispose(); }
});

// Same bounded skin-triangle test used by the independent browser runner.
// Bone centerlines cannot detect a palm or thumb cutting through a hair strand.
test('top-shelf skin clears the head and side hair during late extraction and its carry neighbors', async () => {
  const { gltf: baked } = await load(new URL('../../../../assets/public/models/resident/luna-library.glb', import.meta.url));
  const motion = libraryMotion.readLibraryMotion(baked.animations);
  const { rig, root, asset } = makeRig();
  const play = libraryMotion.createLibraryPlayer(rig.mesh, motion);
  const book = { ...catalog.freshLibrary().books[0], slotId: 's2-1' };
  const mesh = asset.getObjectByName('Luna_Surface');
  const geometry = mesh.geometry, index = geometry.index;
  const skinIndex = geometry.getAttribute('skinIndex'), skinWeight = geometry.getAttribute('skinWeight');
  const groups = Array.from({ length: geometry.getAttribute('position').count }, (_, vertex) => {
    let head = 0, arm = 0;
    for (let k = 0; k < 4; k++) {
      const name = mesh.skeleton.bones[skinIndex.getComponent(vertex, k)].name;
      const weight = skinWeight.getComponent(vertex, k);
      if (/Head|Neck/.test(name)) head += weight;
      if (/RightForeArm|RightHand/.test(name)) arm += weight;
    }
    return [head, arm];
  });
  const heads = [], arms = [];
  for (let i = 0; i < index.count; i += 3) {
    const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const head = ids.reduce((sum, v) => sum + groups[v][0], 0) / 3;
    const arm = ids.reduce((sum, v) => sum + groups[v][1], 0) / 3;
    if (head < .65 && arm < .65) continue;
    (head > .65 ? heads : arms).push({ ids, points: [], box: new THREE.Box3() });
  }
  assert.ok(heads.length && arms.length, 'actual head/hair and right-arm skin triangles must be present');
  const ray = new THREE.Ray(), hit = new THREE.Vector3();
  const edgesHit = (a, b) => {
    for (let edge = 0; edge < 3; edge++) {
      const start = a.points[edge], end = a.points[(edge + 1) % 3];
      const length = start.distanceTo(end);
      ray.set(start, end.clone().sub(start).normalize());
      if (ray.intersectTriangle(...b.points, false, hit) && start.distanceTo(hit) <= length + 1e-7) return true;
    }
    return false;
  };
  const samples = [
    ...[.5, .6, .65, .7, .775, .85, .925, 1].map(p => ['extract', p]),
    ...[0, .05, .1, .2].map(p => ['carry', p]),
  ];
  try {
    for (const [phase, progress] of samples) {
      const frame = libraryMotion.libraryMotionSample({ book, phase, progress });
      root.position.fromArray(bookMotion.authoredBookStand('habitat', book));
      armPose.resetArms(rig, 1);
      rig.applyPose(0, 0);
      play(book, frame);
      root.updateMatrixWorld(true);
      mesh.skeleton.update();
      const vertices = groups.map((_, v) => mesh.getVertexPosition(v, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld));
      for (const triangle of [...heads, ...arms]) {
        triangle.points = triangle.ids.map(v => vertices[v]);
        triangle.box.setFromPoints(triangle.points);
      }
      let intersections = 0;
      for (const arm of arms) for (const head of heads) {
        if (arm.box.intersectsBox(head.box) && (edgesHit(arm, head) || edgesHit(head, arm))) intersections++;
      }
      assert.equal(intersections, 0, `${phase}@${progress}: right hand/thumb skin intersects head or side hair`);
    }
  } finally { rig.dispose(); }
});

// Reconstruct actual skinned triangles in the moving book's local frame. Palm
// anchors alone miss the cover corner cutting through an elbow, chest or hair.
test('closed-book volume clears real torso, hair and forearms; final skin pads meet both covers', async () => {
  const { gltf: baked } = await load(new URL('../../../../assets/public/models/resident/luna-library.glb', import.meta.url));
  const motion = libraryMotion.readLibraryMotion(baked.animations);
  const { rig, root, asset } = makeRig();
  const play = libraryMotion.createLibraryPlayer(rig.mesh, motion);
  const mesh = asset.getObjectByName('Luna_Surface');
  const geometry = mesh.geometry, index = geometry.index;
  const skinIndex = geometry.getAttribute('skinIndex'), skinWeight = geometry.getAttribute('skinWeight');
  const groups = Array.from({ length: skinIndex.count }, (_, v) => {
    const weights = {};
    for (let k = 0; k < 4; k++) {
      const name = mesh.skeleton.bones[skinIndex.getComponent(v, k)].name;
      const group = /RightHand/.test(name) ? 'rightHand' : /LeftHand/.test(name) ? 'leftHand'
        : /RightArm|RightForeArm/.test(name) ? 'rightArm' : /LeftArm|LeftForeArm/.test(name) ? 'leftArm'
          : /Head|Neck/.test(name) ? 'head' : /Spine/.test(name) ? 'torso' : 'other';
      weights[group] = (weights[group] ?? 0) + skinWeight.getComponent(v, k);
    }
    return Object.entries(weights).sort((a, b) => b[1] - a[1])[0][0];
  });
  const triangles = [];
  for (let i = 0; i < index.count; i += 3) {
    const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    const cats = ids.map(v => groups[v]);
    const group = cats.find(c => cats.filter(other => other === c).length >= 2);
    if (group && group !== 'other') triangles.push({ ids, group });
  }
  // One millimetre inside the closed cover surfaces excludes tangent contact.
  const volume = new THREE.Box3(new THREE.Vector3(.001, -.004, -.109), new THREE.Vector3(.239, .063, .109));
  const at = name => asset.getObjectByName('mixamorig' + name).getWorldPosition(new THREE.Vector3());
  const covers = roundedBookSolids(0);
  const frames = [72, 90, 108, 120, ...Array.from({ length: 225 }, (_, i) => 124 + i / 4)];
  try {
    for (let row = 0; row < 3; row++) for (const frame of frames) {
      const book = { ...catalog.freshLibrary().books[0], slotId: `s${row}-1` };
      const phase = frame <= 72 ? 'reach' : frame <= 108 ? 'extract' : 'carry';
      const progress = frame <= 72 ? frame / 72 : frame <= 108 ? (frame - 72) / 36 : (frame - 108) / 72;
      const flow = { book, phase, progress };
      const sample = libraryMotion.libraryMotionSample(flow);
      root.position.fromArray(bookMotion.authoredBookStand('habitat', book));
      armPose.resetArms(rig, 1);
      rig.applyPose(0, 0);
      play(book, sample);
      root.updateMatrixWorld(true);
      mesh.skeleton.update();
      const pose = bookMotion.bookPose('habitat', book, flow, true);
      libraryMotion.applyLibraryBookMotion(motion, 'habitat', book, sample, pose.position, pose.quaternion);
      const inverse = new THREE.Matrix4().compose(pose.position, pose.quaternion, new THREE.Vector3(1, 1, 1)).invert();
      const vertices = groups.map((_, v) => mesh.getVertexPosition(v, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse));
      const hits = {};
      for (const triangle of triangles) {
        if (volume.intersectsTriangle(new THREE.Triangle(...triangle.ids.map(v => vertices[v]))))
          hits[triangle.group] = (hits[triangle.group] ?? 0) + 1;
      }
      for (const part of ['head', 'torso', 'rightArm', 'leftArm'])
        assert.equal(hits[part] ?? 0, 0, `${row}@${frame}: book corner cuts real ${part} skin`);
      if (frame >= 132) for (const side of ['Right', 'Left']) {
        const forearm = at(side + 'Hand').sub(at(side + 'ForeArm'));
        const fingers = at(side + 'HandMiddle1').sub(at(side + 'Hand'));
        assert.ok(forearm.angleTo(fingers) < THREE.MathUtils.degToRad(65), `${row}@${frame}: ${side} wrist folds back while carrying`);
      }
      if (frame >= 132) {
        const { distance: gap } = skinSurfaceContact(vertices.filter((_, v) => groups[v] === 'leftHand'), covers);
        assert.ok(gap < .002, `${row}@${frame}: actual supporting skin floats ${gap}m from book triangles`);
      }
      if (frame === 180) for (const side of ['rightHand', 'leftHand']) {
        assert.equal(hits[side] ?? 0, 0, `${row}: final ${side} skin enters closed page block`);
        const gap = Math.min(...vertices.filter((_, v) => groups[v] === side).map(v => volume.distanceToPoint(v)));
        assert.ok(gap < .003, `${row}: actual ${side} pad floats ${gap}m from cover`);
      }
    }
  } finally { rig.dispose(); }
});


test('procedural open/close keeps the actual left support skin within 2 mm of moving rounded book surfaces', async () => {
  const { gltf: baked } = await load(new URL('../../../../assets/public/models/resident/luna-library.glb', import.meta.url));
  const motion = libraryMotion.readLibraryMotion(baked.animations);
  const { rig, root, asset } = makeRig(), play = libraryMotion.createLibraryPlayer(rig.mesh, motion);
  const mesh = asset.getObjectByName('Luna_Surface');
  const skinIndex = mesh.geometry.getAttribute('skinIndex'), skinWeight = mesh.geometry.getAttribute('skinWeight');
  const left = Array.from({ length: skinIndex.count }, (_, v) => v).filter(v => {
    let weight = 0;
    for (let k = 0; k < 4; k++) if (mesh.skeleton.bones[skinIndex.getComponent(v, k)].name.includes('LeftHand')) weight += skinWeight.getComponent(v, k);
    return weight > .5;
  });
  assert.ok(left.length, 'real left-hand skin vertices must be present');
  rig.applyPose(0, 0);
  const wrists = ['Right', 'Left'].map(side => asset.getObjectByName('mixamorig' + side + 'Hand'));
  const wristNeutral = wrists.map(hand => hand.quaternion.clone());
  const progress = Array.from({ length: 41 }, (_, i) => i / 40);
  const surfaces = new Map();
  try {
    for (let row = 0; row < 3; row++) for (const phase of ['open', 'close']) for (const p of progress) {
      const book = { ...catalog.freshLibrary().books[0], slotId: `s${row}-1` };
      const flow = { book, phase, progress: p }, sample = libraryMotion.libraryMotionSample(flow);
      const coverFlow = libraryMotion.libraryCoverFlow(flow, sample);
      root.position.fromArray(bookMotion.authoredBookStand('habitat', book, true)); root.updateMatrixWorld(true);
      armPose.resetArms(rig, 1);
      for (let n = 0; n < 30; n++) residentPose.applyLibraryPose(rig, root, 'habitat', coverFlow, 1 / 60, true);
      rig.applyPose(0, 0); play(book, sample); root.updateMatrixWorld(true); mesh.skeleton.update();
      wrists.forEach((hand, side) => assert.ok(hand.quaternion.angleTo(wristNeutral[side]) < THREE.MathUtils.degToRad(70),
        `${row}/${phase}@${p}: wrist ${side} retains excessive axial turn at the cover handoff`));
      const pose = bookMotion.bookPose('habitat', book, coverFlow, true);
      libraryMotion.applyLibraryBookMotion(motion, 'habitat', book, sample, pose.position, pose.quaternion);
      const inverse = new THREE.Matrix4().compose(pose.position, pose.quaternion, new THREE.Vector3(1, 1, 1)).invert();
      const vertices = left.map(v => mesh.getVertexPosition(v, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse));
      if (!surfaces.has(pose.open)) surfaces.set(pose.open, roundedBookSolids(pose.open));
      const contact = skinSurfaceContact(vertices, surfaces.get(pose.open));
      assert.ok(contact.distance < .002, `${row}/${phase}@${p}: actual LEFT support skin floats ${contact.distance}m from book triangles`);
      assert.ok(contact.depth < .001, `${row}/${phase}@${p}: actual LEFT support skin enters book by ${contact.depth}m`);
    }
  } finally { rig.dispose(); }
});


// Use real deformed palm patches as well as joint centerlines. Quaternion
// continuity alone accepted the old reach with its fingers pointing at the elbow.
test('three-row reach and reversed release keep real skin palms aligned with the forearm throughout pickup', async () => {
  const { gltf: baked } = await load(new URL('../../../../assets/public/models/resident/luna-library.glb', import.meta.url));
  const motion = libraryMotion.readLibraryMotion(baked.animations);
  const { rig, root, asset } = makeRig(), play = libraryMotion.createLibraryPlayer(rig.mesh, motion);
  const mesh = asset.getObjectByName('Luna_Surface');
  const skinIndex = mesh.geometry.getAttribute('skinIndex'), skinWeight = mesh.geometry.getAttribute('skinWeight');
  const at = name => asset.getObjectByName('mixamorig' + name).getWorldPosition(new THREE.Vector3());
  const vertex = v => mesh.getVertexPosition(v, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
  rig.applyPose(0, 0); root.updateMatrixWorld(true); mesh.skeleton.update();
  const palms = ['Right', 'Left'].map(side => {
    const wrist = at(side + 'Hand'), middle = at(side + 'HandMiddle1');
    const across = at(side + 'HandIndex1').sub(at(side + 'HandPinky1'));
    const normal = middle.clone().sub(wrist).cross(across).normalize().multiplyScalar(side === 'Left' ? 1 : -1);
    const candidates = Array.from({ length: skinIndex.count }, (_, v) => v).filter(v => {
      let weight = 0;
      for (let k = 0; k < 4; k++) if (mesh.skeleton.bones[skinIndex.getComponent(v, k)].name.includes(side + 'Hand')) weight += skinWeight.getComponent(v, k);
      return weight > .8;
    });
    const patches = [wrist.clone().lerp(middle, .18), middle, at(side + 'HandIndex1'), at(side + 'HandPinky1')].map(point => {
      point.addScaledVector(normal, .008);
      return candidates.map(v => ({ v, d: vertex(v).distanceToSquared(point) })).sort((a, b) => a.d - b.d).slice(0, 4).map(x => x.v);
    });
    assert.ok(patches.every(patch => patch.length === 4), 'actual skinned palm patches must exist');
    return { side, patches, hand: asset.getObjectByName('mixamorig' + side + 'Hand'),
      neutral: asset.getObjectByName('mixamorig' + side + 'Hand').quaternion.clone() };
  });
  const mean = patch => patch.reduce((sum, v) => sum.add(vertex(v)), new THREE.Vector3()).multiplyScalar(1 / patch.length);
  try {
    for (let row = 0; row < 3; row++) for (const fps of [30, 60, 120]) for (const reverse of [false, true]) {
      const book = { ...catalog.freshLibrary().books[0], slotId: `s${row}-1` };
      root.position.fromArray(bookMotion.authoredBookStand('habitat', book));
      for (let i = 0; i <= 6 * fps; i++) {
        const frame = reverse ? 180 - i * 30 / fps : i * 30 / fps;
        const phase = frame <= 72 ? (reverse ? 'release' : 'reach') : frame <= 108 ? (reverse ? 'insert' : 'extract') : (reverse ? 'return-carry' : 'carry');
        const p = frame <= 72 ? frame / 72 : frame <= 108 ? (frame - 72) / 36 : (frame - 108) / 72;
        const sample = libraryMotion.libraryMotionSample({ book, phase, progress: reverse ? 1 - p : p });
        armPose.resetArms(rig, 1); rig.applyPose(0, 0); play(book, sample); root.updateMatrixWorld(true); mesh.skeleton.update();
        for (const { side, patches, hand, neutral } of palms) {
          const forearm = at(side + 'Hand').sub(at(side + 'ForeArm')).normalize();
          const fingers = at(side + 'HandMiddle1').sub(at(side + 'Hand')).normalize();
          const [heel, middle, index, pinky] = patches.map(mean);
          const skinForward = middle.sub(heel).normalize();
          const skinNormal = skinForward.clone().cross(index.sub(pinky)).normalize();
          const label = `${row}/${phase}@${frame.toFixed(2)} ${fps}Hz ${side}`;
          assert.ok(hand.quaternion.angleTo(neutral) < THREE.MathUtils.degToRad(70), `${label}: static wrist reversal despite forward fingers`);
          assert.ok(forearm.angleTo(fingers) < THREE.MathUtils.degToRad(65), `${label}: finger axis folds back toward elbow`);
          assert.ok(forearm.angleTo(skinForward) < THREE.MathUtils.degToRad(65), `${label}: actual skin palm folds back toward elbow`);
          const flexion = Math.asin(THREE.MathUtils.clamp(skinNormal.dot(forearm), -1, 1));
          assert.ok(Math.abs(flexion) < THREE.MathUtils.degToRad(65), `${label}: actual palm surface bends excessively at wrist`);
        }
      }
    }
  } finally { rig.dispose(); }
});


// Exact surface distances reuse the independent runner's edge/face definition.
// Vertex-to-surface distance alone can miss contact in a triangle interior.
const contactSurfaceCache = new WeakMap();
function handTriangleContact(vertices, ids, parts, initialDistance = Infinity) {
  if (!contactSurfaceCache.has(parts)) contactSurfaceCache.set(parts, parts.map(part => ({ box: part.box,
    triangles: part.triangles.map(triangle => ({ triangle, box: new THREE.Box3().setFromPoints([triangle.a, triangle.b, triangle.c]) })) })));
  const boxes = contactSurfaceCache.get(parts);
  const boxGapSquared = (a, b) => {
    const x = Math.max(0, a.min.x - b.max.x, b.min.x - a.max.x);
    const y = Math.max(0, a.min.y - b.max.y, b.min.y - a.max.y);
    const z = Math.max(0, a.min.z - b.max.z, b.min.z - a.max.z);
    return x * x + y * y + z * z;
  };
  function edgeDistance(a, b, c, d) {
    const u = b.clone().sub(a), v = d.clone().sub(c), w = a.clone().sub(c);
    const aa = u.lengthSq(), bb = u.dot(v), cc = v.lengthSq(), dd = u.dot(w), ee = v.dot(w), den = aa * cc - bb * bb;
    let distance = Infinity;
    for (const [p, x, y] of [[a, c, d], [b, c, d], [c, a, b], [d, a, b]])
      distance = Math.min(distance, new THREE.Line3(x, y).closestPointToPoint(p, true, new THREE.Vector3()).distanceTo(p));
    if (den > 1e-20) {
      const s = (bb * ee - cc * dd) / den, t = (aa * ee - bb * dd) / den;
      if (s >= 0 && s <= 1 && t >= 0 && t <= 1) distance = Math.min(distance, a.clone().addScaledVector(u, s).distanceTo(c.clone().addScaledVector(v, t)));
    }
    return distance;
  }
  function triangleDistance(a, b) {
    const av = [a.a, a.b, a.c], bv = [b.a, b.b, b.c];
    let distance = Infinity;
    for (const [vs, triangle] of [[av, b], [bv, a]]) for (let i = 0; i < 3; i++) {
      const p = vs[i], q = vs[(i + 1) % 3], delta = q.clone().sub(p);
      const hit = new THREE.Ray(p, delta.clone().normalize()).intersectTriangle(triangle.a, triangle.b, triangle.c, false, new THREE.Vector3());
      if (hit && hit.distanceTo(p) <= delta.length() + 1e-9) return 0;
      distance = Math.min(distance, triangle.closestPointToPoint(p, new THREE.Vector3()).distanceTo(p));
    }
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) distance = Math.min(distance, edgeDistance(av[i], av[(i + 1) % 3], bv[j], bv[(j + 1) % 3]));
    return distance;
  }
  let distance = initialDistance;
  for (const indices of ids) {
    const triangle = new THREE.Triangle(...indices.map(i => vertices[i]));
    const box = new THREE.Box3().setFromPoints([triangle.a, triangle.b, triangle.c]);
    for (const part of boxes) if (boxGapSquared(box, part.box) < distance * distance)
      for (const other of part.triangles) if (boxGapSquared(box, other.box) < distance * distance)
        distance = Math.min(distance, triangleDistance(triangle, other.triangle));
  }
  return distance;
}

test('catch bearing hand stays on real book triangles before the spine hand transfers, without thumb penetration', async () => {
  const { gltf: baked } = await load(new URL('../../../../assets/public/models/resident/luna-library.glb', import.meta.url));
  const motion = libraryMotion.readLibraryMotion(baked.animations);
  const { rig, root, asset } = makeRig(), play = libraryMotion.createLibraryPlayer(rig.mesh, motion);
  const mesh = asset.getObjectByName('Luna_Surface'), geometry = mesh.geometry;
  const skinIndex = geometry.getAttribute('skinIndex'), skinWeight = geometry.getAttribute('skinWeight');
  const groups = Array.from({ length: skinIndex.count }, (_, v) => {
    const weights = {};
    for (let k = 0; k < 4; k++) {
      const name = mesh.skeleton.bones[skinIndex.getComponent(v, k)].name;
      const category = /RightHand/.test(name) ? 'rightHand' : /LeftHand/.test(name) ? 'leftHand'
        : /RightArm|RightForeArm/.test(name) ? 'rightArm' : /LeftArm|LeftForeArm/.test(name) ? 'leftArm'
          : /Head|Neck/.test(name) ? 'head' : /Spine/.test(name) ? 'torso' : 'other';
      weights[category] = (weights[category] ?? 0) + skinWeight.getComponent(v, k);
    }
    return Object.entries(weights).sort((a, b) => b[1] - a[1])[0][0];
  });
  const hands = { leftHand: [], rightHand: [] };
  const vertexIds = Object.fromEntries(Object.keys(hands).map(side => [side, groups.flatMap((group, v) => group === side ? [v] : [])]));
  for (let i = 0; i < geometry.index.count; i += 3) {
    const ids = [0, 1, 2].map(k => geometry.index.getX(i + k));
    for (const side of Object.keys(hands)) if (ids.some(v => groups[v] === side)) hands[side].push(ids);
  }
  const covers = roundedBookSolids(0);
  try {
    for (let row = 0; row < 3; row++) for (const reverse of [false, true]) for (let quarter = 115 * 4; quarter <= 134 * 4; quarter++) {
      const frame = reverse ? 249 - quarter / 4 : quarter / 4;
      const book = { ...catalog.freshLibrary().books[0], slotId: `s${row}-1` };
      const phase = reverse ? 'return-carry' : 'carry', progress = reverse ? (180 - frame) / 72 : (frame - 108) / 72;
      const flow = { book, phase, progress }, sample = libraryMotion.libraryMotionSample(flow);
      root.position.fromArray(bookMotion.authoredBookStand('habitat', book));
      armPose.resetArms(rig, 1); rig.applyPose(0, 0); play(book, sample); root.updateMatrixWorld(true); mesh.skeleton.update();
      const pose = bookMotion.bookPose('habitat', book, flow, true);
      libraryMotion.applyLibraryBookMotion(motion, 'habitat', book, sample, pose.position, pose.quaternion);
      const inverse = new THREE.Matrix4().compose(pose.position, pose.quaternion, new THREE.Vector3(1, 1, 1)).invert();
      const vertices = groups.map((_, v) => mesh.getVertexPosition(v, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse));
      const contacts = Object.fromEntries(Object.keys(hands).map(side => {
        const vertexContact = skinSurfaceContact(vertexIds[side].map(v => vertices[v]), covers);
        return [side, { distance: handTriangleContact(vertices, hands[side], covers, vertexContact.distance), depth: vertexContact.depth }];
      }));
      // Left has acquired the load by124; right may change its spine grip only
      // after132. Require the named bearing hand, not just either proxy anchor.
      if (frame >= 124) assert.ok(contacts.leftHand.distance < .002, `${row}/${phase}@${frame}: real bearing palm floats ${contacts.leftHand.distance}m`);
      for (const side of Object.keys(hands)) assert.ok(contacts[side].depth < .001,
        `${row}/${phase}@${frame}: real ${side} skin penetrates ${contacts[side].depth}m`);
    }
  } finally { rig.dispose(); }
});

// Classify patches once in Luna's relaxed skin. The thumb opposition and the natural
// bend of each digit identify the flesh side independently of either IK implementation.
function anatomicalHand(asset, mesh, side) {
  const at = name => asset.getObjectByName(`mixamorig${side}Hand${name}`).getWorldPosition(new THREE.Vector3());
  const surfaceNormal = () => at('Middle1').sub(at('')).cross(at('Index1').sub(at('Pinky1')))
    .normalize().multiplyScalar(side === 'Right' ? -1 : 1);
  const palmar = surfaceNormal(), wrist = at('');
  assert.ok(at('Thumb4').sub(wrist).dot(palmar) > .03, `${side} opposed thumb calibrates palm sign`);
  const inward = {};
  for (const digit of ['Thumb', 'Index', 'Middle', 'Ring', 'Pinky']) {
    const first = at(digit + '2').sub(at(digit + '1')).normalize();
    const last = at(digit + '4').sub(at(digit + '3')).normalize();
    inward[digit] = last.addScaledVector(first, -last.dot(first)).normalize();
    assert.ok(inward[digit].dot(palmar) > .8, `${side} relaxed ${digit} bends toward palm`);
  }
  const indices = mesh.geometry.getAttribute('skinIndex'), weights = mesh.geometry.getAttribute('skinWeight');
  const groups = { Index: [], Middle: [], Ring: [], Pinky: [], thumb: [], palm: [], back: [] };
  for (let v = 0; v < indices.count; v++) {
    let k = 0;
    for (let j = 1; j < 4; j++) if (weights.getComponent(v, j) > weights.getComponent(v, k)) k = j;
    const prefix = `mixamorig${side}Hand`, bone = mesh.skeleton.bones[indices.getComponent(v, k)].name;
    if (!bone.startsWith(prefix)) continue;
    const joint = bone.slice(prefix.length), digit = joint.slice(0, -1), segment = Number(joint.slice(-1));
    if (segment === 4) continue;
    const axis = joint ? at(digit + (segment + 1)).sub(at(joint)).normalize() : at('Middle1').sub(wrist).normalize();
    const inwardAxis = (inward[digit] ?? palmar).clone();
    inwardAxis.addScaledVector(axis, -inwardAxis.dot(axis)).normalize();
    const p = mesh.getVertexPosition(v, new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
    const offset = p.sub(at(joint)).dot(inwardAxis);
    if (offset < -.002) groups.back.push(v);
    if (offset > .002) {
      if (!joint || digit === 'Thumb' && segment === 1) groups.palm.push(v);
      else if (digit === 'Thumb') groups.thumb.push(v);
      else groups[digit].push(v);
    }
  }
  groups.fingers = [...groups.Index, ...groups.Middle, ...groups.Ring, ...groups.Pinky];
  groups.volar = [...groups.fingers, ...groups.thumb, ...groups.palm];
  const patches = {};
  for (const [name, ids] of Object.entries(groups)) {
    const localIndex = new Map(ids.map((id, i) => [id, i]));
    const triangles = [];
    for (let i = 0; i < mesh.geometry.index.count; i += 3) {
      const corners = [0, 1, 2].map(j => localIndex.get(mesh.geometry.index.getX(i + j)));
      if (corners.every(v => v !== undefined)) triangles.push(corners);
    }
    patches[name] = { ids, triangles };
  }
  return { surfaceNormal, ...patches };
}

test('three shelf grips and their returns load anatomical finger pads and an opposed thumb, then hand off palm-first', async () => {
  const { gltf: baked } = await load(new URL('../../../../assets/public/models/resident/luna-library.glb', import.meta.url));
  const motion = libraryMotion.readLibraryMotion(baked.animations);
  const { rig, root, asset } = makeRig(), play = libraryMotion.createLibraryPlayer(rig.mesh, motion);
  const mesh = asset.getObjectByName('Luna_Surface');
  try {
    rig.applyPose(0, 0); root.updateMatrixWorld(true); mesh.skeleton.update();
    const [right, left] = ['Right', 'Left'].map(side => anatomicalHand(asset, mesh, side));
    const solids = roundedBookSolids(0), spine = solids.slice(2, 4), nearCover = [solids[0]], upperCover = [solids[4]];
    // The final sample is the procedural closed pose at open 20% / close 80%.
    for (let row = 0; row < 3; row++) for (const reverse of [false, true]) {
      const book = { ...catalog.freshLibrary().books[0], slotId: `s${row}-1` };
      const frames = Array.from({ length: (180 - 60) * 4 + 1 }, (_, i) => 60 + i / 4).concat(181);
      for (const frame of reverse ? frames.toReversed() : frames) {
        const [phase, p] = frame <= 72 ? ['reach', frame/72] : frame <= 108 ? ['extract', (frame-72)/36]
          : frame <= 180 ? ['carry', (frame-108)/72] : ['open', .2];
        const flow = { book, phase: reverse ? { reach: 'release', extract: 'insert', carry: 'return-carry', open: 'close' }[phase] : phase,
          progress: reverse ? 1-p : p };
        const sample = libraryMotion.libraryMotionSample(flow), cover = libraryMotion.libraryCoverFlow(flow, sample);
        root.position.fromArray(bookMotion.authoredBookStand('habitat', book, sample.coverProgress !== undefined));
        root.updateMatrixWorld(true); armPose.resetArms(rig, 1);
        if (sample.coverProgress !== undefined) for (let n = 0; n < 40; n++) residentPose.applyLibraryPose(rig, root, 'habitat', cover, .03, true);
        rig.applyPose(0, 0); play(book, sample); root.updateMatrixWorld(true); mesh.skeleton.update();
        const pose = bookMotion.bookPose('habitat', book, cover, true);
        libraryMotion.applyLibraryBookMotion(motion, 'habitat', book, sample, pose.position, pose.quaternion);
        const inverse = pose.quaternion.clone().invert();
        const localPoints = patch => patch.ids.map(v => mesh.getVertexPosition(v, new THREE.Vector3())
          .applyMatrix4(mesh.matrixWorld).sub(pose.position).applyQuaternion(inverse));
        const gap = (patch, parts) => {
          const points = localPoints(patch);
          const distance = skinSurfaceContact(points, parts).distance;
          // A patch vertex suffices to prove contact. At rounded edges, contact
          // sometimes lies inside a triangle whose three corners all pass calibration.
          return distance < .002 ? distance : handTriangleContact(points, patch.triangles, parts, distance);
        };
        const r = right.surfaceNormal().applyQuaternion(inverse), l = left.surfaceNormal().applyQuaternion(inverse);
        const label = `${row}/${flow.phase}@${frame}`;
        if (frame <= 132) {
          assert.ok(r.y > .95, `${label}: right palm must face the near cover (+Y), got ${r.y}`);
          for (const digit of ['Index', 'Middle', 'Ring', 'Pinky']) {
            const { distance } = skinSurfaceContact(localPoints(right[digit]), nearCover);
            assert.ok(distance < .002, `${label}: right ${digit} pad is ${distance * 1000} mm from the near cover`);
          }
          assert.ok(gap(right.thumb, spine) < .002, `${label}: opposed thumb pad must brace the wrapped spine`);
        }
        if (frame >= 124) {
          const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(bookMotion.shelfQuaternion).applyQuaternion(bookMotion.shelfRotation('habitat')).applyQuaternion(inverse);
          assert.ok(l.dot(normal) > .94, `${label}: left palm must face upward into the load`);
          const bearing = gap(left.volar, solids);
          assert.ok(bearing < .002 && bearing < gap(left.back, solids), `${label}: left volar patch must bear the book, gap ${bearing}`);
        }
        if (frame >= 180) {
          assert.ok(r.y < -.95 && l.y > .95, `${label}: palms must face opposite closed covers`);
          assert.ok(gap(right.fingers, upperCover) < .002, `${label}: right finger pads must meet the upper cover`);
        }
      }
    }
  } finally { rig.dispose(); }
});
