import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';

function load(path, dependencies, globals = {}) {
  const source = fs.readFileSync(new URL(path, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const context = { exports: {}, ...globals, require(name) {
    assert.ok(name in dependencies, `Unexpected dependency: ${name}`);
    return dependencies[name];
  } };
  vm.runInNewContext(compiled, context);
  return context.exports;
}

function mount(kind, overrides = {}) {
  const effects = [], cleanups = [], frames = [], sounds = [], actions = [];
  const target = Object.assign(new EventTarget(), { location: { search: '' }, clearTimeout });
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 3, 5);
  camera.lookAt(0, 0, 0);
  let elapsed = 0;
  const react = {
    useRef: value => ({ current: value }),
    useMemo: fn => fn(), useCallback: fn => fn,
    useState: value => [typeof value === 'function' ? value() : value, next => { if (next && typeof next === 'object' && next.objectId) actions.push(next.kind); }],
    useSyncExternalStore: (_, snapshot) => snapshot(),
    useEffect: effect => effects.push(effect),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  };
  const audio = {
    playFootstep: (options = {}) => sounds.push({ ...options }),
    unlock() { actions.push('unlock'); return Promise.resolve(true); },
    getSnapshot: () => ({ disc: {}, isPlaying: false }),
    subscribe() {}, stopMusic() {},
  };
  const world = {
    sceneId: 'habitat', focusedObject: null, transition: { phase: 'idle' },
    onAction: action => actions.push(action.kind), onReturn() {},
  };
  const dependencies = {
    react,
    three: THREE,
    '@react-three/drei': { Html: 'Html' },
    '@react-three/fiber': { useFrame: frame => frames.push(frame), useThree: select => select ? select({ camera }) : { camera } },
    '../audioEngine': { roomAudio: audio },
    './ObjectHandle': { ObjectHandle: 'ObjectHandle' },
    './ResidentModel': { HIP_HEIGHT: 0.69, ResidentModel: 'ResidentModel' },
    './chairPose': load('./orbital/chairPose.ts', {}),
    '../interactables': { ROOM_OBSTACLES: [], INTERACTABLE_ITEMS: [] },
    './scene/audioEngine': { roomAudio: audio, PRESET_MUSIC_DISCS: [] },
    './scene/orbital/OrbitalScene': { OrbitalScene: 'OrbitalScene' },
    './scene/orbital/library': { PRESET_BOOKS: [], loadLocalBooks: () => [] },
    './scene/orbital/useWorldController': { useWorldController: () => world },
    './scene/orbital/orbital.css': {},
  };
  const files = { orbital: './orbital/OrbitalResidents.tsx', legacy: './models/Protagonist.tsx', app: '../App.tsx' };
  const names = { orbital: 'OrbitalResidents', legacy: 'Protagonist', app: 'App' };
  const props = {
    sceneId: 'habitat', objects: {}, enabled: true, reducedMotion: false, walkTarget: null,
    onGesture() {}, onHover() {}, onArrive() {}, onAction() {},
    controlsEnabled: true, posture: 'standing', onPostureChange() {}, onClearWalkTarget() {},
    onNearbyChange() {}, onInteract() {}, onPositionUpdate() {}, ...overrides,
  };
  const component = load(files[kind], dependencies, {
    window: target, document: new EventTarget(), Element: class {}, HTMLElement: class {}, URLSearchParams,
  })[names[kind]];
  const tree = component(props);
  const groups = [];
  function attach(node) {
    if (Array.isArray(node)) { node.forEach(attach); return; }
    if (!node || typeof node !== 'object') return;
    if (node.type === 'group' && node.props.ref) {
      const group = new THREE.Group();
      if (node.props.position) group.position.set(...node.props.position);
      node.props.ref.current = group;
      groups.push({ group, name: node.props.name });
    }
    attach(node.props?.children);
  }
  attach(tree);
  effects.forEach(effect => cleanups.push(effect()));
  const root = groups.find(item => ['OrbitalResident', 'Protagonist_Character'].includes(item.name))?.group;
  return {
    root, pivot: groups[1]?.group, sounds, actions,
    key(code, type = 'keydown') {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { code, repeat: false });
      target.dispatchEvent(event);
    },
    frame(dt) {
      elapsed += dt;
      frames.forEach(frame => frame({ clock: { getElapsedTime: () => elapsed } }, dt));
    },
    dispose() { cleanups.forEach(cleanup => cleanup?.()); },
  };
}

for (const kind of ['legacy']) {
  for (const fps of [60, 120, 144, 240]) {
    test(`${kind}: one landing sound per jump at ${fps} FPS`, () => {
      const view = mount(kind);
      try {
        view.key('Space');
        for (let i = 0; i < fps; i++) view.frame(1 / fps);
        assert.equal(view.root.position.y, 0);
        assert.equal(view.sounds.filter(sound => sound.variant === 'push').length, 1);
        assert.equal(view.sounds.filter(sound => sound.variant === 'land').length, 1);
        for (let i = 0; i < fps / 2; i++) view.frame(1 / fps);
        assert.equal(view.sounds.filter(sound => sound.variant === 'land').length, 1);
      } finally { view.dispose(); }
    });
  }
}

test('orbital: Space does not make the resident jump or play jump sounds', () => {
  const view = mount('orbital');
  try {
    view.key('Space');
    for (let i = 0; i < 120; i++) view.frame(1 / 120);
    assert.equal(view.root.position.y, 0);
    assert.equal(view.sounds.filter(sound => sound.variant === 'push' || sound.variant === 'land').length, 0);
    view.key('KeyD');
    for (let i = 0; i < 60; i++) view.frame(1 / 60);
    assert.ok(view.sounds.some(sound => !sound.variant));
  } finally { view.dispose(); }
});

test('legacy: holding movement against a wall stops footsteps until movement resumes', () => {
  const view = mount('legacy');
  try {
    view.key('KeyD');
    for (let i = 0; i < 90; i++) view.frame(1 / 60);
    assert.equal(view.root.position.x, 3.55);
    const stoppedCount = view.sounds.length;
    assert.ok(stoppedCount > 0);
    for (let i = 0; i < 60; i++) view.frame(1 / 60);
    assert.equal(view.sounds.length, stoppedCount);
    view.key('KeyD', 'keyup');
    view.key('KeyA');
    for (let i = 0; i < 30; i++) view.frame(1 / 60);
    assert.ok(view.sounds.length > stoppedCount);
  } finally { view.dispose(); }
});

test('bed shortcut unlocks audio synchronously before queuing the approach', () => {
  const view = mount('app');
  try {
    view.key('KeyB');
    assert.deepEqual(view.actions, ['unlock', 'sleep']);
  } finally { view.dispose(); }
});

test('push and landing survive nearby walking sounds while duplicate contacts stay throttled', () => {
  const engine = load('./audioEngine.ts', {}).roomAudio;
  const ctx = { currentTime: 0, state: 'running' };
  const voices = [];
  engine.ensureContext = () => ctx;
  engine.triggerBarefootStep = (_, time, foot, surface, variant) => voices.push({ time, foot, surface, variant });
  engine.playFootstep();
  ctx.currentTime = 0.02;
  engine.playFootstep({ variant: 'push' });
  engine.playFootstep({ variant: 'push' });
  engine.playFootstep();
  assert.deepEqual(voices.map(voice => voice.variant), ['walk', 'push']);
  ctx.currentTime = 0.5;
  engine.playFootstep();
  ctx.currentTime = 0.52;
  engine.playFootstep({ variant: 'land' });
  engine.playFootstep({ variant: 'land' });
  engine.playFootstep();
  assert.deepEqual(voices.map(voice => voice.variant), ['walk', 'push', 'walk', 'land', 'land']);
  assert.equal(voices.at(-1).foot, 1);
  assert.ok(Math.abs(voices.at(-1).time - voices.at(-2).time - 0.024) < 1e-10);
  engine.setMuted(true);
  ctx.currentTime = 1;
  engine.playFootstep({ variant: 'push' });
  assert.equal(voices.length, 5);
});


test('a distant object is activated only after the resident approaches it', () => {
  let performed = 0, reached = 0;
  const point = [-3.3, 1, -1.8];
  const view = mount('orbital', { approach: { point, action: { sceneId: 'habitat', objectId: 'book-01', kind: 'read' }, perform: () => performed++ }, onArrive: () => reached++ });
  try {
    assert.equal(performed, 0);
    for (let i = 0; i < 30; i++) view.frame(1 / 60);
    assert.equal(performed, 0);
    for (let i = 0; i < 600 && !performed; i++) view.frame(1 / 60);
    assert.equal(performed, 1);
    assert.equal(reached, 1);
    assert.ok(Math.hypot(view.root.position.x - point[0], view.root.position.z - point[2]) <= 1.15);
  } finally { view.dispose(); }
});

test('manual movement cancels a pending distant interaction', () => {
  let performed = 0, cancelled = 0;
  const view = mount('orbital', { approach: { point: [-3.3, 1, -1.8], action: { sceneId: 'habitat', objectId: 'book-01', kind: 'read' }, perform: () => performed++ }, onArrive: () => cancelled++ });
  try {
    view.frame(1 / 60);
    view.key('KeyD');
    for (let i = 0; i < 300; i++) view.frame(1 / 60);
    assert.equal(performed, 0);
    assert.equal(cancelled, 1);
  } finally { view.dispose(); }
});
