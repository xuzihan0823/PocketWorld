import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Execute the actual frame callback, with scene refs supplied as its closure.
const source = await readFile(new URL('./AlarmClock.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('AlarmClock.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const callbacks = [];
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(tree) === 'useFrame') callbacks.push(node.arguments[0]);
  ts.forEachChild(node, visit);
}
visit(tree);
assert.equal(callbacks.length, 1);
const compiled = ts.transpile(`const frame = ${callbacks[0].getText(tree)};`, { target: ts.ScriptTarget.ES2022 });

test('alarm animation reads the R3F clock without consuming the next scene delta', () => {
  const ref = () => ({ current: { rotation: { z: 0 }, visible: true } });
  const hourHand = ref(), minuteHand = ref(), secondHand = ref(), targetHand = ref(), hammer = ref(), clockGroup = ref();
  const frame = new Function('hourHand', 'minuteHand', 'secondHand', 'targetHand', 'hammer', 'clockGroup',
    'snapshot', 'world', 'ringing', 'clockHandAngles', `${compiled}; return frame;`)(
    hourHand, minuteHand, secondHand, targetHand, hammer, clockGroup,
    { state: {} }, { reducedMotion: false }, true,
    () => ({ hourAngle: 1, minuteAngle: 2, secondAngle: 3, targetAngle: null }));
  const clock = { elapsedTime: 2.5,
    getElapsedTime() { assert.fail('getElapsedTime advances the shared clock through getDelta'); },
    getDelta() { assert.fail('only the renderer may advance the shared clock'); } };
  frame({ clock });
  assert.equal(clock.elapsedTime, 2.5);
  assert.equal(hourHand.current.rotation.z, 1);
  assert.equal(minuteHand.current.rotation.z, 2);
  assert.equal(secondHand.current.rotation.z, 3);
  assert.equal(targetHand.current.visible, false);
  assert.equal(hammer.current.rotation.z, Math.sin(2.5 * 54) * .42);
  assert.equal(clockGroup.current.rotation.z, Math.sin(2.5 * 46) * .035);
});
