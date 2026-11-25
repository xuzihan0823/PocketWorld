import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as paperGeometry from './paperGeometry.ts';
import * as schedule from './schedule.ts';
import { BOOK } from '../journal/bookModel.ts';

function load(file, dependencies, globals = {}) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { exports: {}, require: name => { assert.ok(name in dependencies, `Unexpected dependency: ${name}`); return dependencies[name]; }, ...globals };
  vm.runInNewContext(compiled, context);
  return context.exports;
}
const element = (type, props) => ({ type, props });
const jsx = { jsx: element, jsxs: element };

function print(side) {
  const calls = [];
  const ctx = new Proxy({ measureText: value => ({ width: value.length * 8 }) }, {
    get: (target, name) => name in target ? target[name] : name === 'fillText'
      ? (text, x, y) => calls.push({ text, x, y, font: target.font, align: target.textAlign }) : () => {},
  });
  const canvas = { getContext: () => ctx };
  const { pageTexture } = load('./SchedulePaper.tsx', {
    './paperGeometry': paperGeometry, react: {}, 'react/jsx-runtime': jsx, '@react-three/fiber': {}, './bookLayout': { SCHEDULE_BOOK_POSITION: [0, 0, 0] }, './schedule': schedule,
    three: { CanvasTexture: class { constructor(image) { this.image = image; } }, SRGBColorSpace: 'srgb' },
  }, { document: { createElement: () => canvas } });
  pageTexture(schedule.migrateSchedule().current, true, side);
  return calls;
}

test('the Daily Planner heading is small and aligned to the upper-right paper margin', () => {
  const title = print('right').find(call => call.text === 'Daily Planner');
  assert.equal(title.align, 'right');
  assert.ok(parseFloat(title.font.match(/[\d.]+px/)[0]) <= 34);
  assert.ok(title.x >= 500 && title.x <= 520 && title.y < 100);
});

test('printed left and right faces each carry only the outward arrow', () => {
  for (const [side, arrow] of [['left', '‹'], ['right', '›']]) {
    assert.deepEqual(print(side).filter(call => ['‹', '›'].includes(call.text)).map(call => call.text), [arrow]);
  }
});

test('forward turning retains ink on the old left sheet until the turning sheet lands', () => {
  const state = schedule.turnSchedulePage(schedule.turnSchedulePage(schedule.migrateSchedule(Array.from({ length: 40 }, (_, i) => ({ id: `task-${i}`, title: `任务${i}`, time: '09:00', completed: false }))), 1), 1);
  const effects = [], textures = [], book = { current: { spread: 2, cursor: 1, ready: false, textures: new Map(), revision: 0 } };
  const { ScheduleBoundBook } = load('./ScheduleBoundBook.tsx', {
    react: { useMemo: fn => fn(), useRef: value => ({ current: value }), useState: value => [value, () => {}], useEffect: effect => effects.push(effect) },
    'react/jsx-runtime': jsx, '@react-three/fiber': { useFrame() {} }, '../ObjectHandle': { ObjectHandle: 'ObjectHandle' },
    '../journal/BoundJournal': { BoundJournal: 'BoundJournal' }, '../journal/bookControl': { createBookControl: () => ({}) }, '../journal/bookModel': { BOOK },
    './ScheduleContext': { useSchedule: () => ({ state, book, ready: true }) }, './schedule': schedule,
    './SchedulePageEditor': { SchedulePageEditor: 'SchedulePageEditor' },
    './SchedulePaper': { pageTexture: (page, _bound, side) => { const texture = { id: page.id, side, disposed: false, dispose() { this.disposed = true; } }; textures.push(texture); return texture; } },
  });
  ScheduleBoundBook({ world: { sceneId: 'habitat', focusedObject: null, objects: {} }, position: [0, 0, 0] });
  const cleanups = effects.map(effect => effect());
  for (const leaf of [0, 1, 2]) {
    assert.ok(book.current.textures.has(leaf * 2), `front of visible leaf ${leaf} lost its ink`);
    assert.ok(book.current.textures.has(leaf * 2 + 1), `back of visible leaf ${leaf} lost its ink`);
    assert.equal(book.current.textures.get(leaf * 2).side, 'right');
    assert.equal(book.current.textures.get(leaf * 2 + 1).side, 'left');
  }
  assert.ok(textures.length <= 8);
  cleanups.forEach(cleanup => cleanup?.());
  assert.equal(book.current.textures.size, 0);
  assert.ok(textures.every(texture => texture.disposed));
});
