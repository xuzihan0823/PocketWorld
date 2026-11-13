import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateSchedule, upgradeSchedule, isScheduleNotebook, patchScheduleTask, placeScheduleTask, turnSchedulePage, flattenSchedule } from './schedule.ts';
import { startStripGesture, moveStripGesture, finishStripGesture } from './stripState.ts';
const placement = { surface: 'desk', position: [0.4, 1.126, -2.6], rotation: 0.04 };

test('one slip peels continuously, cancels, detaches, drags and pastes without moving its neighbour', () => {
  const initial = migrateSchedule(), [first, second] = initial.current.entries;
  const filled = patchScheduleTask(initial, first.id, { title: '中文任务', time: '09:00', endTime: '09:30', priority: 'high', category: '生活' });
  let gesture = startStripGesture(first.id);
  gesture = moveStripGesture(gesture, 47);
  assert.equal(gesture.phase, 'peeling'); assert.equal(gesture.progress, 0.5);
  assert.equal(finishStripGesture(gesture, 'surface'), 'attached');
  gesture = moveStripGesture(gesture, 94); assert.equal(gesture.phase, 'detached');
  gesture = moveStripGesture(gesture, 110); assert.equal(gesture.phase, 'dragging');
  assert.equal(finishStripGesture(gesture, 'surface'), 'pasted');
  const pasted = placeScheduleTask(filled, first.id, placement);
  assert.deepEqual(pasted.current.entries[1], second);
  assert.deepEqual(pasted.current.entries[0], filled.current.entries[0]);
  assert.equal(flattenSchedule(pasted).filter(e => e.id === first.id).length, 1);
  assert.equal(isScheduleNotebook(JSON.parse(JSON.stringify(pasted))), true);
  assert.equal(finishStripGesture(startStripGesture(first.id, true), null), 'pasted');
  assert.equal(finishStripGesture(startStripGesture(first.id, true), 'book'), 'attached');
  const returned = placeScheduleTask(pasted, first.id, null);
  assert.deepEqual(returned.current.entries, filled.current.entries); assert.deepEqual(returned.placements, {});
});

test('moving a pasted slip replaces its location atomically, and cancel preserves the last saved position', () => {
  const state = migrateSchedule(), id = state.current.entries[0].id;
  const pasted = placeScheduleTask(state, id, placement);
  assert.equal(finishStripGesture(moveStripGesture(startStripGesture(id, true), 300), 'surface', true), 'pasted');
  const moved = placeScheduleTask(pasted, id, { ...placement, position: [0.1, 1.126, -2.5] });
  assert.equal(Object.keys(moved.placements).length, 1);
  assert.deepEqual(pasted.placements[id], placement);
  assert.strictEqual(placeScheduleTask(moved, 'missing-task', placement), moved);
  assert.strictEqual(placeScheduleTask(moved, id, { ...placement, position: [NaN, 0, 0] }), moved);
});

test('old whole-page saves migrate without removing content, and malformed or duplicate task references are rejected', () => {
  const old = migrateSchedule([{ id: 'legacy', title: '旧中文', time: '9:00', completed: true, content: '原内容' }]);
  const legacy = { ...old, version: 1 }; delete legacy.placements; delete legacy.archive;
  const next = upgradeSchedule(legacy);
  assert.equal(next.version, 2); assert.deepEqual(next.current.entries, old.current.entries);
  assert.equal(legacy.version, 1); assert.ok(!('placements' in legacy));
  assert.equal(upgradeSchedule({ ...legacy, current: null }), null);
  assert.equal(isScheduleNotebook({ ...next, placements: { unknown: placement } }), false);
  assert.equal(isScheduleNotebook({ ...next, current: { ...next.current, entries: [next.current.entries[0], next.current.entries[0]] } }), false);
});

test('page navigation retains original slots and all task data exactly once', () => {
  let state = migrateSchedule(); const original = state.current;
  for (const entry of state.current.entries) state = placeScheduleTask(state, entry.id, placement);
  state = turnSchedulePage(state, 1); assert.notEqual(state.current.id, original.id);
  assert.equal(state.archive[0].id, original.id);
  state = turnSchedulePage(state, -1); assert.equal(state.current.id, original.id);
  assert.equal(new Set(flattenSchedule(state).map(e => e.id)).size, 4);
  assert.ok(isScheduleNotebook(state));
});
