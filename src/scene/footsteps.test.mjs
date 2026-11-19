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

const cabinLayout = load('./orbital/cabinLayout.ts', {});
const catalog = load('./orbital/library/catalog.ts', {});

function libraryDependencies(residentRig) {
  const authored = load('./orbital/library/pageTurnFrames.ts', {});
  const bookMotion = load('./orbital/library/bookMotion.ts', { three: THREE, './catalog': catalog, './pageTurnFrames': authored });
  const armPose = load('./orbital/library/armPose.ts', { three: THREE });
  return {
    './library/catalog': catalog,
    './library/bookMotion': bookMotion,
    './library/armPose': armPose,
    './library/residentPose': load('./orbital/library/residentPose.ts', { three: THREE, './bookMotion': bookMotion, './catalog': catalog, './armPose': armPose, './pageTurnFrames': authored }),
    './library/libraryMotion': load('./orbital/library/libraryMotion.ts', { three: THREE, './bookMotion': bookMotion, './catalog': catalog, '../residentRig': residentRig }),
  };
}

function mount(kind, overrides = {}, idleLibrary) {
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
  const residentRig = load('./orbital/residentRig.ts', { three: THREE });
  const dependencies = {
    react,
    three: THREE,
    '@react-three/drei': { Html: 'Html' },
    '@react-three/fiber': { useFrame: frame => frames.push(frame), useThree: select => select ? select({ camera }) : { camera } },
    '../audioEngine': { roomAudio: audio },
    './ObjectHandle': { ObjectHandle: 'ObjectHandle' },
    './Cat': { Cat: 'Cat' },
    './ResidentModel': { HIP_HEIGHT: 0.69, ResidentModel: 'ResidentModel' },
    './residentRig': residentRig,
    './cabinLayout': cabinLayout,
    './bedMotion': load('./orbital/bedMotion.ts', { three: THREE, './cabinLayout': cabinLayout, './residentRig': residentRig, 'three/examples/jsm/loaders/GLTFLoader.js': {} }),
    './journalLayout': load('./orbital/journalLayout.ts', {}),
    './schedule/bookLayout': load('./orbital/schedule/bookLayout.ts', {}),
    './chairPose': load('./orbital/chairPose.ts', {}),
    './chairMotion': load('./orbital/chairMotion.ts', {}),
    './drawerInteraction': load('./orbital/drawerInteraction.ts', {}),
    './scene/audioEngine': { roomAudio: audio, PRESET_MUSIC_DISCS: [] },
    './scene/orbital/OrbitalScene': { OrbitalScene: 'OrbitalScene' },
    './scene/orbital/library/useLibrary': { useLibrary: options => ({ dispatch: options.onAction, back: options.onReturn, data: { books: [] }, flow: { current: { phase: 'idle' } }, view: { phase: 'idle' }, motion: { current: null } }) },
    './scene/orbital/library/LibrarySurface': { LibrarySurface: 'LibrarySurface' },
    './library/residentPose': { applyLibraryPose() {}, carryResident() {}, libraryCrouch: () => 0 },
    './library/armPose': { resetArms() {} },
    './library/libraryMotion': { libraryCoverFlow: flow => flow },
    './library/bookMotion': { residentLibraryTarget: () => [0, 0, 0] },
    './library/catalog': catalog,
    './scene/orbital/useWorldController': { useWorldController: () => world },
    './scene/orbital/OrbitalDustPrompt': { DustPrompt: 'DustPrompt' },
    './standingIdle': load('./orbital/standingIdle.ts', { three: THREE, 'three/examples/jsm/loaders/GLTFLoader.js': { GLTFLoader: class {
      loadAsync(url) { return idleLibrary ? Promise.resolve(idleLibrary[url]) : Promise.reject(new Error('Animation offline in controller tests')); }
    } } }),
    './scene/orbital/orbital.css': {},
  };
  if (overrides.library) Object.assign(dependencies, libraryDependencies(residentRig));
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
    root, sounds, actions, props, chair: dependencies['./chairPose'].CHAIR_POSES.habitat,
    key(code, type = 'keydown') {
      const event = new Event(type, { cancelable: true });
      Object.assign(event, { code, repeat: false });
      target.dispatchEvent(event);
      return event;
    },
    frame(dt) {
      elapsed += dt;
      frames.forEach(frame => frame({ clock: { getElapsedTime: () => elapsed } }, dt));
    },
    dispose() { cleanups.forEach(cleanup => cleanup?.()); },
  };
}

test('书柜站位等待动画绑定，成功保持烘焙站位，失败平滑退回原有站位', async () => {
  const { gltf } = await loadModel(new URL('../../assets/public/models/resident/luna-library.glb', import.meta.url));
  const modules = libraryDependencies(load('./orbital/residentRig.ts', { three: THREE }));
  const motion = modules['./library/libraryMotion'].readLibraryMotion(gltf.animations);
  for (const [slotId, source] of [['s0-0', motion], ['s2-5', null]]) {
    const flow = { phase: 'align', progress: 0, direction: 1, book: { id: 'b', slotId } };
    const arrivals = [];
    const library = {
      view: { phase: 'idle' }, flow: { current: flow }, motion: { current: undefined }, tick() {},
      arrived(success = true) { arrivals.push(success); flow.phase = 'reach'; },
    };
    const view = mount('orbital', { enabled: false, focusedObject: 'book-01', library });
    try {
      const catalog = modules['./library/catalog'];
      view.root.position.fromArray(catalog.readingStand('habitat'));
      view.root.rotation.y = Math.PI + catalog.shelfYaw('habitat');
      const bookMotion = modules['./library/bookMotion'];
      const authored = new THREE.Vector3(...bookMotion.authoredBookStand('habitat', flow.book));
      for (let i = 0; i < 180; i++) view.frame(1 / 60);
      assert.deepEqual(arrivals, [], 'Luna does not reach before the animation resolves');
      assert.ok(view.root.position.distanceTo(authored) < .001);

      library.motion.current = source;
      const target = source ? authored : new THREE.Vector3(...bookMotion.bookStand('habitat', flow.book, true));
      for (let i = 0; i < 120 && !arrivals.length; i++) {
        const before = view.root.position.clone();
        view.frame(1 / 60);
        assert.ok(view.root.position.distanceTo(before) < .025, 'source selection cannot teleport Luna');
      }
      assert.deepEqual(arrivals, [true]);
      assert.ok(view.root.position.distanceTo(target) < .001);
      if (!source) continue;

      view.sounds.length = 0;
      for (const phase of ['reach', 'extract', 'carry']) {
        flow.phase = phase;
        for (let i = 0; i <= 20; i++) {
          flow.progress = i / 20;
          view.frame(1 / 60);
          assert.ok(view.root.position.distanceTo(authored) < .001, 'the clip owns pelvis travel inside its fixed scene anchor');
        }
      }
      assert.deepEqual(view.sounds, [], 'controller does not add procedural walking over baked footwork');
    } finally {
      view.dispose();
    }
  }
});

for (const sceneId of ['habitat', 'observatory']) {
  test(`${sceneId}: Space leaves Luna on the floor without consuming the key or playing a sound`, () => {
    const view = mount('orbital', { sceneId });
    try {
      const start = view.root.position.clone();
      assert.equal(view.key('Space').defaultPrevented, false);
      for (let i = 0; i < 60; i++) {
        view.frame(1 / 60);
        assert.deepEqual(view.root.position.toArray(), start.toArray());
      }
      assert.deepEqual(view.sounds, []);
      assert.deepEqual(view.actions, []);
    } finally { view.dispose(); }
  });
}

test('walking after Space advances the resident and plays footsteps', () => {
  const view = mount('orbital');
  try {
    const start = view.root.position.clone();
    view.key('Space');
    view.key('KeyD');
    for (let i = 0; i < 60; i++) {
      view.frame(1 / 60);
      assert.equal(view.root.position.y, 0);
    }
    assert.ok(view.root.position.distanceTo(start) > 0.4);
    assert.ok(view.sounds.some(sound => !sound.variant));
  } finally { view.dispose(); }
});

test('the floor sofa blocks walking from the rug only inside the habitat', () => {
  const [x, , z] = cabinLayout.FLOOR_SOFA.position;
  for (const sceneId of ['habitat', 'observatory']) {
    const view = mount('orbital', { sceneId });
    try {
      view.root.position.set(x, 0, z - 1.4);
      view.key('KeyS');
      for (let i = 0; i < 150; i++) view.frame(1 / 60);
      const end = view.root.position.z;
      if (sceneId === 'habitat') {
        const edge = z + cabinLayout.FLOOR_SOFA.footprint.back;
        assert.ok(end > z - 1.4 && end <= edge - .23);
      } else {
        assert.ok(end > z);
      }
    } finally { view.dispose(); }
  }
});

test('the old bed shortcut no longer starts room interactions', () => {
  const view = mount('app');
  try {
    view.key('KeyB');
    assert.deepEqual(view.actions, []);
  } finally { view.dispose(); }
});

test('chair pushes survive nearby walking sounds while duplicate contacts stay throttled', () => {
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
  ctx.currentTime = 0.12;
  engine.playFootstep();
  assert.deepEqual(voices.map(voice => voice.variant), ['walk', 'push', 'walk']);
  engine.setMuted(true);
  ctx.currentTime = 1;
  engine.playFootstep({ variant: 'push' });
  assert.equal(voices.length, 3);
});


for (const fps of [30, 60, 144]) {
  test(`drawer: retreat finishes before opening and ignores movement at ${fps} FPS`, () => {
    const opened = [];
    const view = mount('orbital', { onDrawerAction: action => opened.push({ kind: action.kind, z: view.root.position.z }) });
    try {
      view.root.position.set(0.35, 0, -1.32);
      view.props.drawerInteraction.current.request({ sceneId: 'habitat', objectId: 'desk-drawer', kind: 'open' });
      view.key('KeyW');
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
  test(`deferred interaction waits for the resident to walk close at ${fps} FPS`, () => {
    const view = mount('orbital');
    let performed = 0;
    try {
      view.root.position.set(.15, 0, .15);
      const target = catalog.shelfPoint('habitat', 0, 1, .87);
      view.props.interaction.current(target, { sceneId: 'habitat', objectId: 'book-01', kind: 'read' }, () => performed++);
      assert.equal(performed, 0);
      for (let i = 0; i < fps / 2; i++) view.frame(1 / fps);
      assert.equal(performed, 0);
      for (let i = 0; i < fps * 10 && !performed; i++) view.frame(1 / fps);
      assert.equal(performed, 1);
      assert.ok(Math.hypot(view.root.position.x - target[0], view.root.position.z - target[2]) <= 1.15);
      for (let i = 0; i < fps; i++) view.frame(1 / fps);
      assert.equal(performed, 1);
    } finally { view.dispose(); }
  });
}

test('manual movement cancels the pending approach', () => {
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
        assert.equal(view.key('Escape').defaultPrevented, true, 'seated Escape must not also restore App state');
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
    view.props.interaction.current([cabinLayout.BED_POSITION[0] - .8, .8, cabinLayout.BED_POSITION[2] - 1.25], { sceneId: 'habitat', objectId: 'bed', kind: 'sleep' }, () => performed++);
    for (let i = 0; i < 900 && !performed; i++) view.frame(1 / 60);
    assert.equal(performed, 1);
    assert.ok(Math.hypot(view.root.position.x - cabinLayout.BED_ENTRY[0], view.root.position.z - cabinLayout.BED_ENTRY[1]) < 0.06);
  } finally { view.dispose(); }
});

test('E selects the bed along its open side and distinguishes the lamp and plant at the table', () => {
  const actions = [];
  const view = mount('orbital', { onAction: action => actions.push(action.objectId) });
  try {
    const [x, , z] = cabinLayout.BED_POSITION;
    for (const [px, pz, id] of [
      [x + 1.12, z + .90, 'bed'],
      [cabinLayout.NIGHTSTAND_X - .11, cabinLayout.NIGHTSTAND_Z + .77, 'lamp'],
      [cabinLayout.NIGHTSTAND_X + .32, cabinLayout.NIGHTSTAND_Z + .78, 'plant'],
    ]) {
      view.root.position.set(px, 0, pz);
      view.key('KeyE');
      for (let i = 0; i < 240 && !actions.length; i++) view.frame(1 / 60);
      assert.deepEqual(actions.splice(0), [id]);
    }
  } finally { view.dispose(); }
});

test('a remote drawer approach survives Space, then retreats and opens', () => {
  let performed = 0;
  const view = mount('orbital', { onDrawerAction: () => performed++ });
  try {
    const action = { sceneId: 'habitat', objectId: 'desk-drawer', kind: 'open' };
    view.props.interaction.current([0.35, 1, -1.65], action, () => view.props.drawerInteraction.current.request(action));
    view.key('Space');
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
    assert.equal(view.key('Escape').defaultPrevented, true, 'App must not also handle this cancellation');
    for (let i = 0; i < 900; i++) view.frame(1 / 60);
    assert.equal(performed, 0);
  } finally { view.dispose(); }
});

test('a chair with no safe front entry cannot seat the resident through furniture', () => {
  const view = mount('orbital');
  let performed = 0;
  try {
    // The right wall blocks the front and the desk prevents rolling backwards.
    Object.assign(view.chair, { x: 3.48, z: -1.3, yaw: 0.2 - Math.PI / 2 });
    view.root.position.set(3.65, 0, -0.3);
    view.props.interaction.current([view.chair.x, 0.7, view.chair.z], { sceneId: 'habitat', objectId: 'chair', kind: 'sit' }, () => performed++);
    for (let i = 0; i < 900; i++) view.frame(1 / 60);
    assert.equal(performed, 0);
    assert.equal(view.root.userData.posture, 'standing');
    assert.equal(view.chair.x, 3.48);
  } finally { view.dispose(); }
});

test('mouse selection requires the matching focus and preserves the drag hit point', () => {
  const effects = [], requests = [], actions = [];
  const react = {
    useRef: current => ({ current }), useEffect: effect => effects.push(effect),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  };
  const component = load('./orbital/ObjectHandle.tsx', {
    react, three: THREE, '../../types/world': load('../types/world.ts', {}),
  }, { window: new EventTarget() }).ObjectHandle;
  const handle = focusedObject => component({ id: 'lamp', action: 'toggle', hint: '', drag: 'y', world: {
    sceneId: 'observatory', focusedObject, onGesture() {}, onHover() {},
    onAction: action => actions.push(action),
    onApproach: (point, action, perform) => { requests.push({ point, action, perform }); return false; },
  } });
  try {
    const event = { button: 0, clientX: 100, clientY: 100, pointerId: 1,
      target: { setPointerCapture() {}, releasePointerCapture() {} }, point: { x: 16, y: 1.2, z: -2 }, stopPropagation() {} };
    for (const focus of [null, 'computer']) {
      const locked = handle(focus);
      locked.props.onPointerDown(event);
      locked.props.onPointerUp(event);
    }
    assert.equal(requests.length, 0);
    const tree = handle('lamp');
    tree.props.onPointerDown(event);
    tree.props.onPointerUp({ ...event, clientY: 200, point: { x: 14.25, y: 0, z: 0.5 } });
    assert.equal(actions.length, 0);
    assert.deepEqual(Array.from(requests[0].point), [2, 1.2, -2]);
    requests[0].perform();
    assert.equal(actions.length, 1);
  } finally { effects.map(effect => effect()).forEach(cleanup => cleanup?.()); }
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
      view.root.position.set(view.chair.x + Math.sin(angle) * 0.88, 0, view.chair.z + Math.cos(angle) * 0.88);
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

test('E behind the default chair routes around it and makes room for the blocked front', () => {
  const performed = [];
  const view = mount('orbital', { onAction: action => performed.push(action) });
  try {
    const { x, z } = view.chair;
    view.root.position.set(x, 0, z + 0.78);
    view.frame(1 / 60);
    view.key('KeyE');
    for (let i = 0; i < 900 && !performed.length; i++) {
      view.frame(1 / 60);
      const { x: rx, z: rz } = view.root.position;
      assert.ok(Math.hypot(rx - view.chair.x, rz - view.chair.z) >= 0.515, 'Luna must stay outside the chair while walking');
    }
    assert.deepEqual(performed.map(action => [action.objectId, action.kind]), [['chair', 'sit']]);
    assert.ok(view.chair.z > z + 0.2, 'chair must clear the desk');
    assert.ok(view.root.position.z < view.chair.z - 0.8, 'Luna must reach its front');
  } finally { view.dispose(); }
});

test('E opens the computer from the desk even when the chair is nearby', () => {
  const performed = [];
  const view = mount('orbital', { onAction: action => performed.push(action) });
  try {
    view.root.position.set(1.55, 0, -1.34);
    view.key('KeyE');
    assert.deepEqual(performed.map(action => [action.objectId, action.kind]), [['computer', 'inspect']]);
  } finally { view.dispose(); }
});

test('walking next to an air gap does not push the chair, but a closer step does', () => {
  const view = mount('orbital');
  try {
    const { x, z } = view.chair;
    view.root.position.set(x, 0, z + 0.66);
    view.key('KeyW');
    view.frame(1 / 60);
    assert.equal(view.chair.z, z);
    for (let i = 0; i < 16; i++) view.frame(1 / 60);
    assert.ok(view.chair.z < z);
  } finally { view.dispose(); }
});


test('standing idle starts early, ignores Space and resets on movement, focus and reduced motion', () => {
  const view = mount('orbital');
  const advance = seconds => { for (let i = 0; i < seconds * 60; i++) view.frame(1 / 60); };
  try {
    advance(8);
    assert.equal(view.root.userData.standingIdle.weight, 1);
    view.key('KeyD'); view.frame(1 / 60);
    assert.equal(view.root.userData.standingIdle.elapsed, 0);
    view.key('KeyD', 'keyup'); advance(8);
    assert.equal(view.root.userData.standingIdle.weight, 1);
    const elapsedBeforeSpace = view.root.userData.standingIdle.elapsed;
    view.key('Space'); view.frame(1 / 60);
    assert.ok(view.root.userData.standingIdle.elapsed > elapsedBeforeSpace);
    assert.equal(view.root.userData.standingIdle.weight, 1);
    advance(9);
    view.props.focusedObject = 'journal'; advance(15);
    assert.equal(view.root.userData.standingIdle.elapsed, 0);
    assert.equal(view.root.userData.standingIdle.weight, 0);
    view.props.focusedObject = null;
    view.props.reducedMotion = true; advance(80);
    assert.equal(view.root.userData.standingIdle.elapsed, 0);
    assert.equal(view.root.userData.standingIdle.yawnTime, -1);
  } finally { view.dispose(); }
});

test('loaded looking gesture ignores Space and is interrupted by movement, focus, disabling and reduced motion', async () => {
  const idleLibrary = {};
  for (const name of ['luna-yawn', 'luna-looking-around']) {
    const { gltf } = await loadModel(new URL(`../../assets/public/models/resident/${name}.glb`, import.meta.url));
    idleLibrary[`./models/resident/${name}.glb`] = gltf;
  }
  for (const trigger of [view => view.key('KeyD'),
    view => { view.props.focusedObject = 'journal'; }, view => { view.props.enabled = false; },
    view => { view.props.reducedMotion = true; }]) {
    const view = mount('orbital', {}, idleLibrary);
    const advance = seconds => { for (let i = 0; i < seconds * 60; i++) view.frame(1 / 60); };
    try {
      advance(8);
      await new Promise(setImmediate);
      for (let i = 0; i < 35 * 60 && view.root.userData.standingIdle.lookTime < 1; i++) view.frame(1 / 60);
      assert(view.root.userData.standingIdle.lookTime >= 1, 'real clip must be playing before interruption');
      const lookBeforeSpace = view.root.userData.standingIdle.lookTime;
      view.key('Space'); view.frame(1 / 60);
      assert.ok(view.root.userData.standingIdle.lookTime > lookBeforeSpace);
      trigger(view); view.frame(1 / 60);
      assert.equal(view.root.userData.standingIdle.elapsed, 0);
      advance(.5);
      assert.equal(view.root.userData.standingIdle.lookTime, -1);
      assert.equal(view.root.userData.standingIdle.weight, 0);
      if (view.props.reducedMotion) {
        advance(120);
        assert.equal(view.root.userData.standingIdle.lookTime, -1);
        assert.equal(view.root.userData.standingIdle.yawnTime, -1);
        assert.equal(view.root.userData.standingIdle.elapsed, 0);
      }
    } finally { view.dispose(); }
  }
});
