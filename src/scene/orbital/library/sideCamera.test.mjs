import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';

function load(path, dependencies = {}) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const context = { exports: {}, require: name => dependencies[name] };
  vm.runInNewContext(compiled, context);
  return context.exports;
}

const catalog = load('./catalog.ts');
const { bookPose } = load('./bookMotion.ts', { './catalog': catalog, './pageTurnFrames': load('./pageTurnFrames.ts'), three: THREE });
const { sideLibraryCamera } = load('./sideCamera.ts', { './catalog': catalog });

const displays = [
  { width: 1440, height: 860, pickupRight: 1042, readingRight: 992, pickupBottom: 860, readingBottom: 860 },
  { width: 900, height: 680, pickupRight: 566, readingRight: 548, pickupBottom: 680, readingBottom: 680 },
  { width: 390, height: 844, pickupRight: 390, readingRight: 390, pickupBottom: 469, readingBottom: 435 },
  { width: 844, height: 390, pickupRight: 442, readingRight: 442, pickupBottom: 390, readingBottom: 390 },
];

test('侧面视角把取书站位和翻页完整投影到阅读面板以外', () => {
  for (const display of displays) {
    const { width, height } = display;
    for (const slot of catalog.BOOK_SLOTS) {
      const book = { id: 'book', slotId: slot.id };
      for (const reading of [false, true]) {
        const right = reading ? display.readingRight : display.pickupRight;
        const bottom = reading ? display.readingBottom : display.pickupBottom;
        const frame = sideLibraryCamera('habitat', slot.id, reading, width, height, 34);
        const camera = new THREE.PerspectiveCamera(34, width / height, .08, 2000);
        const target = new THREE.Vector3(...frame.target);
        camera.position.fromArray(frame.offset).add(target);
        camera.lookAt(target);
        camera.setViewOffset(width, height, ...frame.lensOffset, width, height);
        camera.updateMatrixWorld();
        const phase = reading ? 'reading' : 'reach';
        const pose = bookPose('habitat', book, { book, phase, progress: 0 }, true);
        const points = [];
        for (const x of reading ? [-.24, .24] : [0, .24]) for (const z of [-.11, .11]) {
          points.push(new THREE.Vector3(x, 0, z).applyQuaternion(pose.quaternion).add(pose.position));
        }
        if (reading) {
          points.push(new THREE.Vector3(0, .24, -.08).applyQuaternion(pose.quaternion).add(pose.position));
        } else {
          points.push(new THREE.Vector3(...catalog.shelfPoint('habitat', slot.position[0], .01, 1.04)));
          points.push(new THREE.Vector3(...catalog.shelfPoint('habitat', slot.position[0], 1.68, .70)));
        }
        for (const point of points) {
          const projected = point.project(camera);
          const x = (projected.x + 1) * width / 2, y = (1 - projected.y) * height / 2;
          assert.ok(x > 12 && x < right - 12 && y > 12 && y < bottom - 12,
            `${width}×${height} ${slot.id} ${phase} projected to (${x.toFixed(1)}, ${y.toFixed(1)})`);
        }
      }
    }
  }
});
