import test from 'node:test';
import assert from 'node:assert/strict';
import { CARTRIDGE_HEIGHT, CARTRIDGE_SLOT, cartridgePosition, clampCartridgeDrag, isCartridgeDrop, cartridgeDragState, cartridgeTransferPoint } from './cartridge-motion.ts';

const monitor = { min: [.975, 1.215, -2.965], max: [2.125, 2.125, -2.335] };
const halfSize = [.11, CARTRIDGE_HEIGHT / 2, .051];
const overlapsMonitor = point => point.every((value, axis) => value + halfSize[axis] > monitor.min[axis] && value - halfSize[axis] < monitor.max[axis]);

test('only the slot accepts a cartridge, including a forgiving approach from the front', () => {
  for (const point of [CARTRIDGE_SLOT, [2.06, 1.44, -2.05], [2.46, 1.65, -2.05]]) assert.ok(isCartridgeDrop(point));
  for (const point of [cartridgePosition('mario'), cartridgePosition('shooter'), [1.55, 1.68, -2.05], [2.26, 2, -2.05], [2.26, 1.1, -2.05], [2.26, 1.44, -2.56], [NaN, 1.44, -2.05]]) assert.equal(isCartridgeDrop(point), false);
});

test('desk collision cannot accept a release far below the slot', () => {
  for (const y of [-10, 0, .5, 1.1]) {
    const drag = cartridgeDragState([CARTRIDGE_SLOT[0], y, CARTRIDGE_SLOT[2]]);
    assert.ok(drag.point[1] > 1.4);
    assert.equal(drag.nearSlot, false);
  }
  assert.equal(cartridgeDragState([2.26, 1.27, -2.05]).nearSlot, true);
});

test('held cartridges stay in front of the entire monitor and above the keyboard', () => {
  for (let x = -1; x <= 4; x += .1) for (let y = 0; y <= 4; y += .1) {
    const point = clampCartridgeDrag([x, y, -2.56]);
    assert.equal(overlapsMonitor(point), false);
    assert.ok(point[1] - halfSize[1] > 1.2);
  }
});

test('both shelf positions and all insertion, ejection and return paths clear the CRT', () => {
  for (const game of ['mario', 'shooter']) {
    const shelf = cartridgePosition(game);
    const other = cartridgePosition(game === 'mario' ? 'shooter' : 'mario');
    assert.ok(Math.abs(shelf[1] - halfSize[1] - 1.12) < 1e-9, 'cartridge rests on the desk');
    const paths = [[shelf, CARTRIDGE_SLOT], [CARTRIDGE_SLOT, shelf], [[1.55, 1.7, -2.05], shelf], [[2.8, 2.7, -2.05], shelf], [[2.1, 1.44, -2.05], CARTRIDGE_SLOT]];
    assert.equal(overlapsMonitor(shelf), false);
    for (const [from, to] of paths) {
      assert.deepEqual(cartridgeTransferPoint(from, to, 0), from);
      assert.deepEqual(cartridgeTransferPoint(from, to, 1), to);
      for (let step = 0; step <= 1000; step++) {
        const point = cartridgeTransferPoint(from, to, step / 1000);
        assert.equal(overlapsMonitor(point), false, `${game} crossed monitor at ${point}`);
        assert.ok(point[1] - halfSize[1] >= 1.12 - 1e-9, 'cartridge crossed desk');
        assert.ok(point.some((value, axis) => Math.abs(value - other[axis]) >= 2 * halfSize[axis]), 'cartridge crossed the other cartridge');
      }
    }
  }
});
