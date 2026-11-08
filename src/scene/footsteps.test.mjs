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
    useState: value => [typeof value === 'function' ? value() : value, () => {}],
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
    './drawerInteraction': load('./orbital/drawerInteraction.ts', {}),
    './bedClimb': load('./orbital/bedClimb.ts', {}),
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
    drawerEnabled: true, drawerInteraction: { current: null }, onDrawerAction() {},
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
    root, pivot: groups[1]?.group, sounds, actions, props, chair: dependencies['./chairPose'].CHAIR_POSES.habitat,
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

for (const kind of ['orbital', 'legacy']) {
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

test('moving through a jump keeps the gait animated without airborne walking sounds', () => {
  const view = mount('orbital');
  try {
    view.key('KeyD');
    view.key('Space');
    const swings = [];
    for (let i = 0; i < 60; i++) {
      view.frame(1 / 120);
      assert.ok(view.root.position.y > 0);
      if (i >= 36) swings.push(view.pivot.rotation.z);
    }
    assert.ok(Math.max(...swings) - Math.min(...swings) > 0.02);
    assert.equal(view.sounds.filter(sound => !sound.variant).length, 0);
    for (let i = 0; i < 60; i++) view.frame(1 / 120);
    assert.equal(view.sounds.filter(sound => sound.variant === 'land').length, 1);
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

test('bed shortcut unlocks audio synchronously before dispatching the action', () => {
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


for (const fps of [30, 60, 144]) {
  test(`drawer: retreat finishes before opening and ignores movement/jump at ${fps} FPS`, () => {
    const opened = [];
    const view = mount('orbital', { onDrawerAction: action => opened.push({ kind: action.kind, z: view.root.position.z }) });
    try {
      view.root.position.set(0.35, 0, -1.32);
      view.props.drawerInteraction.current.request({ sceneId: 'habitat', objectId: 'desk-drawer', kind: 'open' });
      view.key('KeyW'); view.key('Space');
      view.props.drawerInteraction.current.request({ sceneId: 'habitat', objectId: 'desk-drawer', kind: 'open' });
      for (let i = 0; i < fps * 2; i++) {
        view.frame(1 / fps);
        assert.equal(view.root.position.y, 0);
        if (view.root.position.z < -0.56) assert.equal(opened.length, 0);
      }
      assert.equal(opened.length, 1);
      assert.equal(opened[0].kind, 'open');
      assert.ok(opened[0].z >= -0.56);
      assert.equal(view.props.drawerInteraction.current.busy, false);
      assert.ok(view.sounds.some(sound => !sound.variant));
    } finally { view.dispose(); }
  });
}

test('drawer: distance, front side and grounded posture are required', () => {
  const opened = [];
  const view = mount('orbital', { onDrawerAction: action => opened.push(action) });
  try {
    const action = { sceneId: 'habitat', objectId: 'desk-drawer', kind: 'open' };
    for (const point of [[0.35, 0, 1], [1.6, 0, -1.32], [0.35, 0, -2], [0.35, 0.2, -1.32]]) {
      view.root.position.set(...point);
      view.props.drawerInteraction.current.request(action);
      assert.equal(view.props.drawerInteraction.current.busy, false);
    }
    assert.equal(opened.length, 0);
  } finally { view.dispose(); }
});

test('drawer: walking is blocked while open and resumes after it retracts', () => {
  const view = mount('orbital', { objects: { 'desk-drawer': { open: true } } });
  try {
    view.root.position.set(0.35, 0, -0.555);
    view.key('KeyW');
    for (let i = 0; i < 90; i++) view.frame(1 / 60);
    assert.ok(view.root.position.z >= -0.625);
    view.props.objects['desk-drawer'].open = false;
    for (let i = 0; i < 120; i++) view.frame(1 / 60);
    assert.ok(view.root.position.z < -1.3);
  } finally { view.dispose(); }
});

test('drawer: a parked chair blocks opening and remains free to roll away', () => {
  const opened = [];
  const hints = [];
  const view = mount('orbital', { onDrawerAction: action => opened.push(action), onHover: (_, hint) => hints.push(hint) });
  try {
    Object.assign(view.chair, { x: 0.8, z: -1.16 });
    view.root.position.set(-0.35, 0, -1.32);
    const action = { sceneId: 'habitat', objectId: 'desk-drawer', kind: 'open' };
    view.props.drawerInteraction.current.request(action);
    assert.equal(view.props.drawerInteraction.current.busy, false);
    assert.equal(opened.length, 0);
    assert.ok(hints.some(hint => hint?.includes('椅子挡住')));
    view.chair.vz = 1;
    view.frame(1 / 60);
    assert.ok(view.chair.z > -1.16);
    Object.assign(view.chair, { x: 1.45, z: -0.85, vx: 0, vz: 0 });
    view.props.drawerInteraction.current.request(action);
    for (let i = 0; i < 180; i++) view.frame(1 / 60);
    assert.equal(opened.length, 1);
  } finally { view.dispose(); }
});

test('drawer: a chair rolling into the opening during retreat cancels the action', () => {
  const opened = [];
  const view = mount('orbital', { onDrawerAction: action => opened.push(action) });
  try {
    view.root.position.set(-0.35, 0, -1.32);
    view.props.drawerInteraction.current.request({ sceneId: 'habitat', objectId: 'desk-drawer', kind: 'open' });
    assert.equal(view.props.drawerInteraction.current.busy, true);
    Object.assign(view.chair, { x: 0.8, z: -1.16 });
    for (let i = 0; i < 180; i++) view.frame(1 / 60);
    assert.equal(opened.length, 0);
    assert.equal(view.props.drawerInteraction.current.busy, false);
  } finally { view.dispose(); }
});

test('bed: the resident climbs in over seconds and gets out along the same path', () => {
  const view = mount('orbital', { objects: { bed: { active: true } } });
  try {
    view.root.position.set(-1.2, 0, 1.5);
    const trace = [];
    for (let i = 0; i < 60 * 6; i++) { view.frame(1 / 60); trace.push({ ...view.root.position, lie: view.pivot.rotation.x, posture: view.root.userData.posture }); }
    const start = trace.findIndex(frame => frame.posture === 'bed');
    const lying = trace.findIndex(frame => Math.abs(frame.lie + Math.PI / 2) < 1e-6);
    assert.ok(start > 0 && (lying - start) / 60 > 2.5, `climb lasted ${(lying - start) / 60}s`);
    for (let i = 1; i < trace.length; i++) assert.ok(Math.hypot(trace[i].x - trace[i - 1].x, trace[i].y - trace[i - 1].y, trace[i].z - trace[i - 1].z) < 0.045, `jump at frame ${i}`);
    const seated = trace.slice(start).find(frame => frame.y > 0.18 && frame.lie > -0.3);
    assert.ok(seated && seated.x > -2.2, 'sits on the bed edge before lying back');
    assert.ok(Math.abs(trace.at(-1).x + 2.6) < 1e-6 && Math.abs(trace.at(-1).z - 0.94) < 1e-6);
    view.props.objects.bed.active = false;
    const exit = [];
    for (let i = 0; i < 60 * 4; i++) { view.frame(1 / 60); exit.push({ ...view.root.position, posture: view.root.userData.posture }); }
    const standing = exit.findIndex(frame => frame.posture === 'standing');
    assert.ok(standing / 60 > 2.5, `got up in ${standing / 60}s`);
    assert.ok(exit.slice(0, standing).some(frame => frame.y > 0.18 && frame.x > -2.2), 'sits on the edge before stepping down');
    assert.deepEqual([exit[standing].x, exit[standing].y, exit[standing].z], [-1.48, 0, 0.95]);
  } finally { view.dispose(); }
});
