import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function controller() {
  const states = [], transitions = [], timelines = [];
  const react = {
    useState(initial) {
      const index = states.length;
      states.push(initial);
      return [initial, value => {
        states[index] = typeof value === 'function' ? value(states[index]) : value;
        if (index === 3) transitions.push(states[index]);
      }];
    },
    useRef: value => ({ current: value }),
    useCallback: callback => callback,
    useEffect() {},
  };
  const gsap = { timeline(options) { timelines.push(options); return { to() {}, call() {}, kill() {} }; } };
  const source = fs.readFileSync(new URL('./useWorldController.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const context = { exports: {}, AbortController, Date, require(name) {
    if (name === 'react') return react;
    if (name === 'gsap') return gsap;
    if (name === '../../types/world') return { CLOSED_OBJECT: { open: false, active: false, page: 0, value: 0 } };
    throw new Error(`Unexpected import: ${name}`);
  } };
  vm.runInNewContext(compiled, context);
  return { world: context.exports.useWorldController(), states, transitions, timelines };
}

test('petting completes without a camera transition or a movement lock', async () => {
  const { world, states, transitions, timelines } = controller();
  await world.onAction({ sceneId: 'habitat', objectId: 'pet', kind: 'pet' });
  assert.equal(states[1].habitat.pet.value, 1);
  assert.equal(transitions.at(-1).phase, 'active');
  assert.equal(timelines.length, 0);
});

test('camera-focused actions retain their transition', async () => {
  const { world, timelines } = controller();
  await world.onAction({ sceneId: 'habitat', objectId: 'computer', kind: 'inspect' });
  assert.equal(timelines.length, 1);
});
