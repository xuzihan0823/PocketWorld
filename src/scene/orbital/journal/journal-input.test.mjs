import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import * as bookModel from './bookModel.ts';
import { journalPages, todayDate } from './journalStorage.ts';

const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
const texture = () => ({ dispose() {} });
class HTMLElement {
  constructor(tagName, isContentEditable = false) { this.tagName = tagName; this.isContentEditable = isContentEditable; this.blurs = 0; }
  blur() { this.blurs++; }
}
function load(path, modules, globals = {}) {
  const exports = {};
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  vm.runInNewContext(compiled, {
    exports, ...globals,
    require: name => { if (!(name in modules)) throw new Error(`Unexpected import: ${name}`); return modules[name]; },
  });
  return exports;
}
function editor() {
  const effects = [], listeners = new Map();
  const book = { current: { ready: true, cursor: 0, spread: 0, textures: new Map(), revision: 0 } };
  const document = { activeElement: new HTMLElement('BODY') };
  const { JournalEditor } = load('./JournalEditor.tsx', {
    react: {
      useState: value => [typeof value === 'function' ? value() : value, () => {}],
      useRef: current => ({ current }), useLayoutEffect() {}, useEffect: effect => effects.push(effect),
    },
    'react/jsx-runtime': jsx, three: THREE,
    '@react-three/drei': { Html: 'Html' },
    '@react-three/fiber': { useFrame() {}, useThree: select => select({ size: { width: 1200 } }) },
    './bookModel': bookModel, './weather': { JOURNAL_WEATHER: [] }, './journalStorage': { journalPages, todayDate },
    './pageTexture': { journalPageTexture: texture, paintJournalPage: () => ({ carets: [{ x: 0, y: 102, offset: 0 }] }) },
    './textLayout': {}, '../../audioEngine': { roomAudio: { playSfx() {} } },
  }, {
    HTMLElement, document,
    window: {
      setInterval() { return 1; }, clearInterval() {},
      addEventListener: (name, callback) => listeners.set(name, callback),
      removeEventListener: name => listeners.delete(name),
    },
  });
  JournalEditor({ entry: { text: '', date: '2026-11-27' }, book, leafCount: 3, saveState: '', onChange() {}, onGesture() {} });
  const cleanups = effects.map(effect => effect());
  return {
    book,
    key(target, key = 'ArrowRight') {
      document.activeElement = target;
      const event = { target, key, preventDefault() { this.defaultPrevented = true; } };
      listeners.get('keydown')(event);
      return event;
    },
    cleanup: () => cleanups.forEach(cleanup => cleanup?.()),
  };
}

test('journal editing arrows preserve input, textarea, select and contenteditable focus', () => {
  const fixture = editor();
  try {
    for (const target of [new HTMLElement('INPUT'), new HTMLElement('TEXTAREA'), new HTMLElement('SELECT'), new HTMLElement('DIV', true)]) {
      for (const key of ['ArrowLeft', 'ArrowRight']) {
        const event = fixture.key(target, key);
        assert.equal(event.defaultPrevented, undefined);
        assert.equal(fixture.book.current.spread, 0);
        assert.equal(target.blurs, 0);
      }
    }
  } finally { fixture.cleanup(); }
});

test('journal arrows outside editable controls still turn the book', () => {
  const fixture = editor();
  try {
    const event = fixture.key(new HTMLElement('BODY'));
    assert.equal(event.defaultPrevented, true);
    assert.equal(fixture.book.current.spread, 1);
    assert.equal(fixture.book.current.ready, false);
  } finally { fixture.cleanup(); }
});

function appKeyboard(focusedObject = 'journal') {
  const source = ts.createSourceFile('App.tsx', readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  const visit = node => {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'down' && node.initializer) handler = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(handler, 'App keyboard handler must exist');
  const target = new HTMLElement('TEXTAREA');
  let returns = 0;
  const down = vm.runInNewContext(ts.transpileModule(`(${handler})`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, {
    HTMLElement, document: { activeElement: target }, cleaningRef: { current: 'idle' }, viewMode: 'cabin', activeGame: null,
    world: { focusedObject, onReturn() { returns++; } }, library: { flow: { current: { phase: 'idle' } } },
    roomAudio: { getSnapshot: () => ({ isMuted: false }), setMuted() { throw new Error('Typing must not toggle mute'); } },
  });
  return {
    target,
    get returns() { return returns; },
    key(code, options = {}) {
      const event = { target, code, preventDefault() { this.defaultPrevented = true; }, ...options };
      down(event);
      return event;
    },
  };
}

test('Escape returns from focused journal text and date fields', () => {
  for (const tagName of ['TEXTAREA', 'INPUT']) {
    const fixture = appKeyboard();
    fixture.target.tagName = tagName;
    assert.equal(fixture.key('Escape').defaultPrevented, true);
    assert.equal(fixture.returns, 1);
    assert.equal(fixture.target.blurs, 1);
  }
});

test('journal composition and ordinary editing retain their keyboard events', () => {
  const fixture = appKeyboard();
  for (const [code, options] of [['Escape', { isComposing: true }], ['Escape', { keyCode: 229 }], ['ArrowLeft', {}], ['ArrowRight', {}], ['KeyM', {}], ['KeyE', {}]]) {
    assert.equal(fixture.key(code, options).defaultPrevented, undefined);
  }
  assert.equal(fixture.returns, 0);
  assert.equal(fixture.target.blurs, 0);
  assert.equal(fixture.key('Escape', { defaultPrevented: true }).defaultPrevented, true);
  assert.equal(fixture.returns, 0);
});

test('journal Escape exception does not change other feature input handling', () => {
  const fixture = appKeyboard('schedule');
  assert.equal(fixture.key('Escape').defaultPrevented, undefined);
  assert.equal(fixture.returns, 0);
});

function descendants(node) {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!node || typeof node !== 'object') return [];
  return [node, ...descendants(node.props?.children)];
}

test('handled book wheel stops native bubbling while unhandled schedule wheel remains available', () => {
  const effects = [];
  const { BoundJournal } = load('./BoundJournal.tsx', {
    react: { useRef: current => ({ current }), useMemo: fn => fn(), useEffect: effect => effects.push(effect) },
    'react/jsx-runtime': jsx, three: THREE,
    '@react-three/fiber': { useFrame() {} },
    'three/examples/jsm/geometries/RoundedBoxGeometry.js': { RoundedBoxGeometry },
    './bookModel': bookModel, './coverTexture': { clothTexture: texture },
    '../../audioEngine': { roomAudio: { playSfx() {} } },
  });
  let handled, received;
  const control = { current: { ready: true, onPaperPointer: (...args) => { received = args; return handled; } } };
  const tree = BoundJournal({ opened: true, control, reducedMotion: true, leafCount: 1 });
  const leaf = descendants(tree).find(node => node.type === 'primitive');
  const cleanups = effects.map(effect => effect());
  try {
    for (handled of [undefined, false]) {
      let nativeStops = 0, sceneStops = 0;
      leaf.props.onWheel({
        uv: { x: 0.5, y: 0.5 }, face: { materialIndex: 4 }, shiftKey: false,
        nativeEvent: { deltaY: 120, stopPropagation() { nativeStops++; } },
        stopPropagation() { sceneStops++; },
      });
      assert.equal(received[3], 'wheel');
      assert.equal(received[5], 120);
      assert.equal(nativeStops, handled === false ? 0 : 1);
      assert.equal(sceneStops, handled === false ? 0 : 1);
    }
  } finally { cleanups.forEach(cleanup => cleanup?.()); }
});

test('BoundJournal preserves assigned page textures when cabin fade restores original materials', () => {
  const effects = [];
  let frame;
  const { createCabinGroupFade } = load('../cabinCutaway.ts', { three: THREE });
  const { BoundJournal } = load('./BoundJournal.tsx', {
    react: {
      useRef: initial => ({ current: initial === null ? { position: { set() {} }, rotation: { z: 0 } } : initial }),
      useMemo: fn => fn(),
      useEffect: effect => effects.push(effect),
    },
    'react/jsx-runtime': jsx, three: THREE,
    '@react-three/fiber': { useFrame: fn => { frame = fn; } },
    'three/examples/jsm/geometries/RoundedBoxGeometry.js': { RoundedBoxGeometry },
    './bookModel': bookModel, './coverTexture': { clothTexture: texture },
    '../../audioEngine': { roomAudio: { playSfx() {} } },
  });
  const front = new THREE.Texture(), back = new THREE.Texture();
  const control = { current: { spread: 0, cursor: 0, ready: false, revision: 1, textures: new Map([[0, front], [1, back]]) } };
  const tree = BoundJournal({ opened: false, control, reducedMotion: true, leafCount: 1 });
  const cleanups = effects.map(effect => effect());
  const leaf = descendants(tree).find(node => node.type === 'primitive').props.object;
  const group = new THREE.Group();
  group.add(leaf);
  const fade = createCabinGroupFade();
  try {
    fade.set(group, 0.35);
    assert.notEqual(leaf.material[4].map, front);
    frame({}, 0.016);
    assert.equal(leaf.material[4].map, front);
    assert.equal(leaf.material[5].map, back);
    fade.set(group, 1);
    assert.equal(leaf.material[4].map, front);
    assert.equal(leaf.material[5].map, back);
  } finally {
    fade.restore();
    front.dispose();
    back.dispose();
    cleanups.forEach(cleanup => cleanup?.());
  }
});
