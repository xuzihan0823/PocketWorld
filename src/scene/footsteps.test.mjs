import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { load as loadModel } from './orbital/load-for-validation.mjs';

const { gltf: residentModel } = await loadModel(new URL('../../assets/public/models/resident/luna-walk-room.glb', import.meta.url));

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
    useState: value => [typeof value === 'function' ? value() : value, next => { if (next?.objectId) actions.push(`request:${next.kind}`); }],
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
    './residentRig': load('./orbital/residentRig.ts', { three: THREE }),
    './chairPose': load('./orbital/chairPose.ts', {}),
    './chairMotion': load('./orbital/chairMotion.ts', {}),
    './drawerInteraction': load('./orbital/drawerInteraction.ts', {}),
    './scene/audioEngine': { roomAudio: audio, PRESET_MUSIC_DISCS: [] },
    './scene/orbital/OrbitalScene': { OrbitalScene: 'OrbitalScene' },
    './scene/orbital/library/useLibrary': { useLibrary: options => ({ dispatch: options.onAction, back: options.onReturn, data: { books: [] }, flow: { current: { phase: 'idle' } } }) },
    './scene/orbital/library/LibrarySurface': { LibrarySurface: 'LibrarySurface' },
    './library/residentPose': { applyLibraryPose() {}, carryResident() {}, libraryCrouch: () => 0 },
    './library/bookMotion': { residentLibraryTarget: () => [0, 0, 0] },
    './library/catalog': { readingStand: () => [-3.28, 0, -1.92], shelfOrigin: () => [-3.28, 0, -2.79] },
    './scene/orbital/useWorldController': { useWorldController: () => world },
    './scene/orbital/orbital.css': {},
  };
  const files = { orbital: './orbital/OrbitalResidents.tsx', app: '../App.tsx' };
  const names = { orbital: 'OrbitalResidents', app: 'App' };
  const props = {
    sceneId: 'habitat', objects: {}, enabled: true, reducedMotion: false, walkTarget: null,
    interaction: { current: null }, drawerEnabled: true, drawerInteraction: { current: null }, onDrawerAction() {},
    onGesture() {}, onHover() {}, onArrive() {}, onAction() {},
    ...overrides,
  };
  const component = load(files[kind], dependencies, {
    window: target, document: new EventTarget(), Element: class {}, HTMLElement: class {}, URLSearchParams,
  })[names[kind]];
  const tree = component(props);
  const groups = [];
  function attach(node) {
    if (Array.isArray(node)) { node.forEach(attach); return; }
    if (!node || typeof node !== 'object') return;
    if (node.type === 'ResidentModel') {
      const rig = dependencies['./residentRig'].createResidentRig(clone(residentModel.scene), residentModel.animations.find(clip => clip.name === 'Walk_Grounded_Loop'));
      node.props.rig.current = rig;
      cleanups.push(() => rig.dispose());
    }
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
  const root = groups.find(item => item.name === 'OrbitalResident')?.group;
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

for (const fps of [60, 120, 144, 240]) {
  test(`orbital: one landing sound per jump at ${fps} FPS`, () => {
    const view = mount('orbital');
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
    for (let i = 0; i < 120; i++) view.frame(1 / 120);
    assert.equal(view.sounds.filter(sound => sound.variant === 'land').length, 1);
    assert.ok(view.sounds.some(sound => !sound.variant));
  } finally { view.dispose(); }
});

test('bed shortcut unlocks audio before queuing the approach request', () => {
  const view = mount('app');
  try {
    view.key('KeyB');
    assert.deepEqual(view.actions, ['unlock', 'request:sleep']);
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

for (const fps of [30, 60, 144]) {
  test(`mouse interaction waits for the resident to walk close at ${fps} FPS`, () => {
    const view = mount('orbital');
    let performed = 0;
    try {
      view.props.interaction.current([-3.3, 1, -1.8], { sceneId: 'habitat', objectId: 'book-01', kind: 'read' }, () => performed++);
      assert.equal(performed, 0);
      for (let i = 0; i < fps / 2; i++) view.frame(1 / fps);
      assert.equal(performed, 0);
      for (let i = 0; i < fps * 10 && !performed; i++) view.frame(1 / fps);
      assert.equal(performed, 1);
      assert.ok(Math.hypot(view.root.position.x + 3.3, view.root.position.z + 1.8) <= 1.15);
      for (let i = 0; i < fps; i++) view.frame(1 / fps);
      assert.equal(performed, 1);
    } finally { view.dispose(); }
  });
}

test('manual movement cancels the pending mouse interaction', () => {
  const view = mount('orbital');
  let performed = 0;
  try {
    view.props.interaction.current([-3.3, 1, -1.8], { sceneId: 'habitat', objectId: 'book-01', kind: 'read' }, () => performed++);
    view.frame(1 / 60);
    view.key('KeyD');
    for (let i = 0; i < 600; i++) view.frame(1 / 60);
    assert.equal(performed, 0);
  } finally { view.dispose(); }
});

for (const yaw of [0.15, Math.PI / 2, Math.PI, -Math.PI / 2]) {
  for (const side of [0, 1, 2, 3]) {
    test(`chair accepts side ${side} and boards from its front at yaw ${yaw}`, () => {
      const view = mount('orbital');
      let performed = 0;
      try {
        Object.assign(view.chair, { x: 0.4, z: 0.3, yaw, vx: 0, vz: 0, spin: 0 });
        const a = side * Math.PI / 2;
        view.root.position.set(view.chair.x + Math.sin(a) * 1.1, 0, view.chair.z + Math.cos(a) * 1.1);
        view.props.interaction.current([view.chair.x, 0.7, view.chair.z], { sceneId: 'habitat', objectId: 'chair', kind: 'sit' }, () => {
          performed++;
          const facing = view.chair.yaw - 0.2 + Math.PI;
          const dx = view.root.position.x - view.chair.x, dz = view.root.position.z - view.chair.z;
          assert.ok(dx * Math.sin(facing) + dz * Math.cos(facing) > 0.7);
          assert.ok(Math.abs(dx * Math.cos(facing) - dz * Math.sin(facing)) < 0.06);
          view.props.objects.chair = { active: true };
        });
        for (let i = 0; i < 900 && !performed; i++) view.frame(1 / 60);
        assert.equal(performed, 1);
        for (let i = 0; i < 180; i++) view.frame(1 / 60);
        assert.equal(view.root.userData.posture, 'chair');
        const facing = view.chair.yaw - 0.2 + Math.PI;
        assert.ok(Math.abs(Math.atan2(Math.sin(view.root.rotation.y - facing), Math.cos(view.root.rotation.y - facing))) < 0.02);
      } finally { view.dispose(); }
    });
  }
}

test('default desk chair is pulled back enough to board from the front', () => {
  const view = mount('orbital');
  let performed = 0;
  try {
    const initialZ = view.chair.z;
    view.props.interaction.current([view.chair.x, 0.7, view.chair.z], { sceneId: 'habitat', objectId: 'chair', kind: 'sit' }, () => performed++);
    for (let i = 0; i < 900 && !performed; i++) view.frame(1 / 60);
    assert.equal(performed, 1);
    assert.ok(view.chair.z > initialZ);
    assert.ok(view.root.position.z >= -1.445);
  } finally { view.dispose(); }
});

test('clicking the far corner of the bed still uses its safe entry', () => {
  const view = mount('orbital');
  let performed = 0;
  try {
    view.props.interaction.current([-3.4, 0.8, -0.25], { sceneId: 'habitat', objectId: 'bed', kind: 'sleep' }, () => performed++);
    for (let i = 0; i < 900 && !performed; i++) view.frame(1 / 60);
    assert.equal(performed, 1);
    assert.ok(Math.hypot(view.root.position.x + 1.48, view.root.position.z - 0.95) < 0.06);
  } finally { view.dispose(); }
});

test('a remote drawer click approaches before retreating and opening', () => {
  let performed = 0;
  const view = mount('orbital', { onDrawerAction: () => performed++ });
  try {
    const action = { sceneId: 'habitat', objectId: 'desk-drawer', kind: 'open' };
    view.props.interaction.current([0.35, 1, -1.65], action, () => view.props.drawerInteraction.current.request(action));
    assert.equal(view.props.drawerInteraction.current.busy, false);
    for (let i = 0; i < 900 && !performed; i++) view.frame(1 / 60);
    assert.equal(performed, 1);
    assert.ok(view.root.position.z >= -0.56);
  } finally { view.dispose(); }
});

test('a newer click replaces the pending interaction', () => {
  const view = mount('orbital');
  let first = 0, second = 0;
  try {
    view.props.interaction.current([-3.3, 1, -1.8], { sceneId: 'habitat', objectId: 'book-01', kind: 'read' }, () => first++);
    view.frame(1 / 60);
    view.props.interaction.current([-0.95, 0.3, 1.95], { sceneId: 'habitat', objectId: 'pet', kind: 'pet' }, () => second++);
    for (let i = 0; i < 900; i++) view.frame(1 / 60);
    assert.equal(first, 0);
    assert.equal(second, 1);
  } finally { view.dispose(); }
});

test('Escape cancels a pending interaction before the object opens', () => {
  const view = mount('orbital');
  let performed = 0;
  try {
    view.props.interaction.current([-3.3, 1, -1.8], { sceneId: 'habitat', objectId: 'book-01', kind: 'read' }, () => performed++);
    view.frame(1 / 60);
    view.key('Escape');
    for (let i = 0; i < 900; i++) view.frame(1 / 60);
    assert.equal(performed, 0);
  } finally { view.dispose(); }
});

test('a chair with no safe front entry cannot seat the resident through furniture', () => {
  const view = mount('orbital');
  let performed = 0;
  try {
    Object.assign(view.chair, { x: 1.45, z: -0.85, yaw: 0.15 });
    view.root.position.set(1.45, 0, 0.1);
    view.props.interaction.current([view.chair.x, 0.7, view.chair.z], { sceneId: 'habitat', objectId: 'chair', kind: 'sit' }, () => performed++);
    for (let i = 0; i < 900; i++) view.frame(1 / 60);
    assert.equal(performed, 0);
    assert.equal(view.root.userData.posture, 'standing');
    assert.ok(Math.abs(view.chair.z + 0.85) < 0.001);
  } finally { view.dispose(); }
});

test('object dragging keeps the original hit point and defers the actual action', () => {
  const effects = [], requests = [], actions = [];
  const react = {
    useRef: current => ({ current }), useEffect: effect => effects.push(effect),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  };
  const component = load('./orbital/ObjectHandle.tsx', {
    react, three: THREE, '../../types/world': load('../types/world.ts', {}),
  }, { window: new EventTarget() }).ObjectHandle;
  const tree = component({ id: 'lamp', action: 'toggle', hint: '', drag: 'y', world: {
    sceneId: 'observatory', onGesture() {}, onHover() {},
    onAction: action => actions.push(action),
    onApproach: (point, action, perform) => { requests.push({ point, action, perform }); return false; },
  } });
  const cleanup = effects.map(effect => effect());
  try {
    const event = { button: 0, clientX: 100, clientY: 100, pointerId: 1,
      target: { setPointerCapture() {}, releasePointerCapture() {} }, point: { x: 16, y: 1.2, z: -2 }, stopPropagation() {} };
    tree.props.onPointerDown(event);
    tree.props.onPointerUp({ ...event, clientY: 200, point: { x: 14.25, y: 0, z: 0.5 } });
    assert.equal(actions.length, 0);
    assert.deepEqual(Array.from(requests[0].point), [2, 1.2, -2]);
    requests[0].perform();
    assert.equal(actions.length, 1);
  } finally { cleanup.forEach(cleanup => cleanup?.()); }
});

for (let side = 0; side < 8; side++) {
  test(`E around chair side ${side} walks to its front before sitting`, () => {
    const performed = [], hints = [];
    const view = mount('orbital', { onHover: (id, hint) => hints.push({ id, hint }) });
    view.props.onAction = action => {
      performed.push(action);
      if (action.objectId === 'chair' && action.kind === 'sit') {
        const facing = view.chair.yaw - 0.2 + Math.PI;
        const dx = view.root.position.x - view.chair.x, dz = view.root.position.z - view.chair.z;
        assert.ok(dx * Math.sin(facing) + dz * Math.cos(facing) > 0.7);
        assert.ok(Math.abs(dx * Math.cos(facing) - dz * Math.sin(facing)) < 0.06);
        view.props.objects.chair = { active: true };
      }
    };
    try {
      Object.assign(view.chair, { x: 0.4, z: 0.3, yaw: 0.15, vx: 0, vz: 0, spin: 0 });
      const angle = side * Math.PI / 4;
      view.root.position.set(view.chair.x + Math.sin(angle) * 1.05, 0, view.chair.z + Math.cos(angle) * 1.05);
      view.frame(1 / 60);
      view.key('KeyE');
      assert.equal(performed.length, 0);
      for (let i = 0; i < 600; i++) view.frame(1 / 60);
      assert.equal(performed.filter(action => action.objectId === 'chair' && action.kind === 'sit').length, 1);
      assert.equal(view.root.userData.posture, 'chair');
      assert.ok(hints.some(item => item.hint === 'E · 起身'));
    } finally { view.dispose(); }
  });
}

test('E at the drawer handle still selects the drawer beside the chair', () => {
  const performed = [];
  const view = mount('orbital', { onAction: action => performed.push(action) });
  try {
    view.root.position.set(0.35, 0, -1.32);
    view.frame(1 / 60);
    view.key('KeyE');
    assert.equal(performed.length, 1);
    assert.equal(performed[0].objectId, 'desk-drawer');
  } finally { view.dispose(); }
});
