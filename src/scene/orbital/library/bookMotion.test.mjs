import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { load } from '../load-for-validation.mjs';

function loadTS(relativePath, deps = {}) {
  const source = fs.readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod = { exports: {}, require: id => id === 'three' ? THREE : deps[id] };
  vm.runInNewContext(compiled, mod);
  return mod.exports;
}

const catalog = loadTS('./catalog.ts');
const bookMotion = loadTS('./bookMotion.ts', { './catalog': catalog });
const armPose = loadTS('./armPose.ts');
const residentPose = loadTS('./residentPose.ts', { './bookMotion': bookMotion, './catalog': catalog, './armPose': armPose });
const rigMod = loadTS('../residentRig.ts');
const { gltf } = await load(new URL('../../../../assets/public/models/resident/luna-walk-room.glb', import.meta.url));

function makeRig() {
  const asset = clone(gltf.scene);
  const rig = rigMod.createResidentRig(asset, gltf.animations[0]);
  const root = new THREE.Group();
  root.add(rig.mesh);
  root.rotation.y = Math.PI;
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
      for (let i = 22; i <= 66; i += 4) {
        const p = i / 100;
        const pose = stepPose(rig, root, book, 'turn', p, dir);
        const curve = bookMotion.turningPageCurve(p, dir);
        const pt = bookMotion.turningPagePoint(curve.leafRatio, curve.bendAmp);
        const expected = pt.position.clone().addScaledVector(pt.normal, dir > 0 ? -0.002 : 0.002).applyQuaternion(pose.quaternion).add(pose.position);
        const arm = rig.arms[dir > 0 ? 1 : 0];
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
