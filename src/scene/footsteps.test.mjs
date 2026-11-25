import * as paperGrip from './orbital/schedule/paperGrip.ts';
import * as plushCarry from './orbital/plushCarry.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { load as loadModel } from './orbital/load-for-validation.mjs';
import * as cabinActions from './orbital/cabinActions.ts';
import * as stairGait from './orbital/stairGait.ts';

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
const cabinStairs = load('./orbital/cabinStairs.ts', { './cabinLayout.ts': cabinLayout });
const catalog = load('./orbital/library/catalog.ts', {});
const scheduleModel = load('./orbital/schedule/schedule.ts', {});

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
    './Slippers': { SlipperPair: 'SlipperPair' },
    './PlushDolls': { PlushDolls: 'PlushDolls' },
    './schedule/paperGrip': paperGrip,
    './plushCarry': plushCarry,
    './plushMotion': load('./orbital/plushMotion.ts', {}),
    './ResidentModel': { HIP_HEIGHT: 0.69, ResidentModel: 'ResidentModel' },
    './residentRig': residentRig,
    './cabinLayout': cabinLayout,
    './cabinStairs': cabinStairs,
    './stairGait': stairGait,
    './cabinActions': { ...cabinActions, loadCabinActions: async () => undefined },
    './wardrobe/inspectPose': load('./orbital/wardrobe/inspectPose.ts', { three: THREE }),
    './sofaMotion': load('./orbital/sofaMotion.ts', { three: THREE, './cabinLayout': cabinLayout, './residentRig': residentRig, 'three/examples/jsm/loaders/GLTFLoader.js': {} }),
    './journalLayout': load('./orbital/journalLayout.ts', {}),
    './schedule/bookLayout': load('./orbital/schedule/bookLayout.ts', {}),
    './schedule/schedule': scheduleModel,
    './schedule/paperBallLitter': { usePaperBallLitter: () => overrides.paperBalls ?? [] },
    './chairPose': load('./orbital/chairPose.ts', {}),
    './chairMotion': load('./orbital/chairMotion.ts', {}),
    './seatedIdle': load('./orbital/seatedIdle.ts', { three: THREE,
      './seatedIdleFrames': load('./orbital/seatedIdleFrames.ts', {}),
    }),
    './scene/audioEngine': { roomAudio: audio, PRESET_MUSIC_DISCS: [] },
    './scene/orbital/OrbitalScene': { OrbitalScene: 'OrbitalScene' },
    './scene/orbital/library/useLibrary': { useLibrary: options => ({ dispatch: options.onAction, back: options.onReturn, data: { books: [] }, flow: { current: { phase: 'idle' } }, view: { phase: 'idle' }, motion: { current: null } }) },
    './scene/orbital/library/LibrarySurface': { LibrarySurface: 'LibrarySurface' },
    './library/residentPose': { applyLibraryPose() {}, carryResident() {}, libraryCrouch: () => 0 },
    './library/armPose': { resetArms() {} },
    './library/libraryMotion': { libraryCoverFlow: flow => flow },
    './library/bookMotion': { residentLibraryTarget: () => [0, 0, 0] },
    './library/catalog': catalog,
    './scene/orbital/wardrobe/WardrobeSurface': { WardrobeSurface: 'WardrobeSurface' },
    './scene/orbital/wardrobe/outfit': load('./orbital/wardrobe/outfit.ts', {}),
    './scene/orbital/useWorldController': { useWorldController: () => world },
    './scene/orbital/OrbitalDustPrompt': { DustPrompt: 'DustPrompt' },
    './scene/orbital/spacecraftFlight': { readInitialViewMode: () => 'cabin' },
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
    sofaTime: { current: null }, paperPickup: { current: null }, interaction: { current: null }, approachEnabled: true,
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

test('the pedal trash can blocks walking only inside the habitat', () => {
  const [x, , z] = cabinLayout.TRASH_CAN.position;
  const foot = cabinLayout.TRASH_CAN.footprint;
  for (const sceneId of ['habitat', 'observatory']) {
    // 1. Resident walking straight east (+X) into the front pedal side of the trash can.
    const viewX = mount('orbital', { sceneId });
    try {
      viewX.root.position.set(x - 1.1, 0, z);
      viewX.key('KeyD');
      for (let i = 0; i < 150; i++) viewX.frame(1 / 60);
      const endX = viewX.root.position.x;
      if (sceneId === 'habitat') {
        assert.ok(endX > x - 1.1 && endX <= x + foot.left - 0.23 + 1e-4, `habitat +X walk stopped at ${endX}`);
      } else {
        assert.ok(endX > x + foot.left, `observatory should not collide with habitat trash can (${endX})`);
      }
    } finally { viewX.dispose(); }

    // 2. Resident walking straight south (+Z) into the north side of the trash can.
    const viewZ = mount('orbital', { sceneId });
    try {
      viewZ.root.position.set(x - 0.1, 0, z - 1.1);
      viewZ.key('KeyS');
      for (let i = 0; i < 150; i++) viewZ.frame(1 / 60);
      const endZ = viewZ.root.position.z;
      if (sceneId === 'habitat') {
        assert.ok(endZ > z - 1.1 && endZ <= z + foot.back - 0.23 + 1e-4, `habitat +Z walk stopped at ${endZ}`);
      } else {
        assert.ok(endZ > z + foot.back, `observatory should not collide with habitat trash can (${endZ})`);
      }
    } finally { viewZ.dispose(); }
  }
});

test('floor paper balls block walking only inside the habitat', () => {
  const ball = { id: 'ball-1', seed: 1 };
  const [x, , z] = scheduleModel.paperBallPosition(ball.seed);
  for (const sceneId of ['habitat', 'observatory']) {
    const view = mount('orbital', { sceneId, paperBalls: [ball] });
    try {
      view.root.position.set(x - 1.1, 0, z);
      view.key('KeyD');
      for (let i = 0; i < 150; i++) view.frame(1 / 60);
      const endX = view.root.position.x;
      if (sceneId === 'habitat') {
        assert.ok(endX > x - 1.1 && endX <= x - 0.33 + 1e-4, `habitat walk stopped at ${endX}`);
      } else {
        assert.ok(endX > x + 0.33, `observatory should not collide with habitat paper balls (${endX})`);
      }
    } finally { view.dispose(); }
  }
});

test('a paper ball stays pickable while its collider blocks walking', () => {
  const ball = { id: 'paper-1', seed: 3 };
  const [x, , z] = scheduleModel.paperBallPosition(ball.seed);
  const hints = [];
  const view = mount('orbital', { paperBalls: [ball], onHover: (_id, hint) => hints.push(hint) });
  try {
    const request = { sceneId: 'habitat', objectId: 'schedule-paper-paper-1', kind: 'select' };
    view.root.position.set(2.52, 0, 1.10);
    view.props.interaction.current([x, 0.105, z], request, () => {});
    let walked = 0;
    for (let i = 0; i < 1200; i++) {
      const before = view.root.position.clone();
      view.frame(1 / 60);
      if (view.root.position.distanceTo(before) > 0.001) walked = i;
      if (Math.hypot(view.root.position.x - x, view.root.position.z - z) <= .44) break;
    }
    const gap = Math.hypot(view.root.position.x - x, view.root.position.z - z);
    assert.ok(walked > 0, 'the approach actually walks instead of teleporting');
    assert.ok(gap <= .44, `Luna must reach pickup range, gap=${gap}`);
    assert.ok(gap >= .33 - 1e-3, `the ball still keeps Luna outside its body, gap=${gap}`);
    assert.ok(!hints.some(hint => hint?.includes('前方空间不足')));
  } finally { view.dispose(); }
});

test('trash-can.glb bounds fit cleanly inside TRASH_CAN.footprint after scaling and rotation', async () => {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const raw = fs.readFileSync(new URL('../../assets/public/models/furniture/trash-can.glb', import.meta.url));
  const jsonLen = raw.readUInt32LE(12);
  const doc = JSON.parse(raw.subarray(20, 20 + jsonLen).toString('utf8'));
  doc.materials = doc.materials.map(m => ({ name: m.name, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }));
  doc.images = [];
  doc.textures = [];
  const json = Buffer.from(JSON.stringify(doc));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const binary = raw.subarray(20 + jsonLen);
  const buffer = Buffer.alloc(20 + padded.length + binary.length);
  buffer.writeUInt32LE(0x46546c67, 0);
  buffer.writeUInt32LE(2, 4);
  buffer.writeUInt32LE(buffer.length, 8);
  buffer.writeUInt32LE(padded.length, 12);
  buffer.writeUInt32LE(0x4e4f534a, 16);
  padded.copy(buffer, 20);
  binary.copy(buffer, 20 + padded.length);

  const gltf = await new GLTFLoader().parseAsync(buffer.buffer, '');
  const model = gltf.scene.clone(true);
  model.updateMatrixWorld(true);
  const rawBox = new THREE.Box3().setFromObject(model);
  const rawSize = rawBox.getSize(new THREE.Vector3());
  const scale = cabinLayout.TRASH_CAN.height / rawSize.y;
  model.scale.setScalar(scale);
  model.position.set(-(rawBox.min.x + rawSize.x / 2) * scale, -rawBox.min.y * scale, -(rawBox.min.z + rawSize.z / 2) * scale);
  const placed = new THREE.Group();
  placed.rotation.set(0, cabinLayout.TRASH_CAN.yaw, 0);
  placed.add(model);
  placed.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(placed);
  const foot = cabinLayout.TRASH_CAN.footprint;
  assert.ok(box.min.x >= foot.left && box.max.x <= foot.right, `X bounds [${box.min.x}, ${box.max.x}] must fit inside [${foot.left}, ${foot.right}]`);
  assert.ok(box.min.z >= foot.back && box.max.z <= foot.front, `Z bounds [${box.min.z}, ${box.max.z}] must fit inside [${foot.back}, ${foot.front}]`);
  assert.ok(Math.abs(box.min.y) < 1e-4 && Math.abs(box.max.y - cabinLayout.TRASH_CAN.height) < 1e-4);
});

test('the three sitting plush dolls can be kicked around and block solidly when pinned only inside the habitat', () => {
  const kickChecks = [
    // Bunny beside floor sofa: kick south (+Z) into open front floor.
    { id: 'plush-bunny', startOffset: [0, -0.85], key: 'KeyS', deltaSign: 1, testPinned: true },
    // Bear beside the bed: kick north (-Z) toward the back wall and keep pushing once pinned.
    { id: 'plush-bear', startOffset: [0, 0.85], key: 'KeyW', deltaSign: -1, testPinned: true },
    // Penguin near cat corner: kick south (+Z) into the front wall and keep pushing once pinned!
    { id: 'plush-penguin', startOffset: [0, -0.85], key: 'KeyS', deltaSign: 1, testPinned: true },
  ];
  for (const check of kickChecks) {
    const dollSpec = cabinLayout.PLUSH_DOLLS.find(item => item.id === check.id);
    assert.ok(dollSpec, `Missing plush doll spec: ${check.id}`);
    const [x, , z] = dollSpec.position;

    // 1. Habitat: walking into the plush doll kicks it away and keeps solid non-clipping separation even when pinned.
    const view = mount('orbital', { sceneId: 'habitat' });
    try {
      view.root.position.set(x + check.startOffset[0], 0, z + check.startOffset[1]);
      view.key(check.key);
      for (let i = 0; i < 150; i++) {
        view.frame(1 / 60);
        const live = view.root.userData.plushBodies.find(b => b.id === check.id);
        const gap = Math.hypot(live.x - view.root.position.x, live.z - view.root.position.z);
        assert.ok(gap >= cabinLayout.RESIDENT_RADIUS + live.radius - 0.01, `${check.id} solid separation violated: gap=${gap}`);
      }
      const live = view.root.userData.plushBodies.find(b => b.id === check.id);
      if (check.deltaSign > 0) {
        assert.ok(live.z > z + 0.15, `${check.id} should be kicked south from ${z}, got ${live.z}`);
      } else {
        assert.ok(live.z < z - 0.15, `${check.id} should be kicked north from ${z}, got ${live.z}`);
      }
      if (check.testPinned) {
        // Keep walking until pinned against wall/wardrobe; Luna must stay cleanly outside the doll's solid volume.
        for (let i = 0; i < 180; i++) {
          view.frame(1 / 60);
          const gap = Math.hypot(live.x - view.root.position.x, live.z - view.root.position.z);
          assert.ok(gap >= cabinLayout.RESIDENT_RADIUS + live.radius - 0.01, `${check.id} pinned solid check failed: gap=${gap}`);
        }
      }
    } finally { view.dispose(); }

    // 2. Observatory: no habitat plush dolls exist or interfere.
    const obsView = mount('orbital', { sceneId: 'observatory' });
    try {
      obsView.frame(1 / 60);
      assert.equal(obsView.root.userData.plushBodies.length, 0);
    } finally { obsView.dispose(); }
  }
});

test('all three plush doll GLBs fit cleanly inside their PLUSH_DOLLS footprints after scaling and rotation', async () => {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  for (const doll of cabinLayout.PLUSH_DOLLS) {
    const raw = fs.readFileSync(new URL(`../../assets/public/models/${doll.path}`, import.meta.url));
    const jsonLen = raw.readUInt32LE(12);
    const doc = JSON.parse(raw.subarray(20, 20 + jsonLen).toString('utf8'));
    doc.materials = doc.materials.map(m => ({ name: m.name, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1] } }));
    doc.images = [];
    doc.textures = [];
    const json = Buffer.from(JSON.stringify(doc));
    const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
    json.copy(padded);
    const binary = raw.subarray(20 + jsonLen);
    const buffer = Buffer.alloc(20 + padded.length + binary.length);
    buffer.writeUInt32LE(0x46546c67, 0);
    buffer.writeUInt32LE(2, 4);
    buffer.writeUInt32LE(buffer.length, 8);
    buffer.writeUInt32LE(padded.length, 12);
    buffer.writeUInt32LE(0x4e4f534a, 16);
    padded.copy(buffer, 20);
    binary.copy(buffer, 20 + padded.length);

    const gltf = await new GLTFLoader().parseAsync(buffer.buffer, '');
    const model = gltf.scene.clone(true);
    model.updateMatrixWorld(true);
    const rawBox = new THREE.Box3().setFromObject(model);
    const rawSize = rawBox.getSize(new THREE.Vector3());
    const scale = doll.height / rawSize.y;
    model.scale.setScalar(scale);
    model.position.set(-(rawBox.min.x + rawSize.x / 2) * scale, -rawBox.min.y * scale, -(rawBox.min.z + rawSize.z / 2) * scale);
    const placed = new THREE.Group();
    placed.rotation.set(0, doll.yaw, 0);
    placed.add(model);
    placed.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(placed);
    const foot = doll.footprint;
    assert.ok(box.min.x >= foot.left && box.max.x <= foot.right, `${doll.id} X bounds [${box.min.x}, ${box.max.x}] must fit inside [${foot.left}, ${foot.right}]`);
    assert.ok(box.min.z >= foot.back && box.max.z <= foot.front, `${doll.id} Z bounds [${box.min.z}, ${box.max.z}] must fit inside [${foot.back}, ${foot.front}]`);
    assert.ok(Math.abs(box.min.y) < 1e-4 && Math.abs(box.max.y - doll.height) < 1e-4, `${doll.id} height bounds [${box.min.y}, ${box.max.y}] must match [0, ${doll.height}]`);
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
  const engine = load('./audioEngine.ts', {
    '../../assets/audio/records/sweden.mp3': 'sweden.mp3',
    '../../assets/audio/records/aria-math.mp3': 'aria-math.mp3',
    '../../assets/audio/records/subwoofer-lullaby.mp3': 'subwoofer-lullaby.mp3',
  }).roomAudio;
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
    view.props.interaction.current(cabinLayout.CLOCK_POSITION, { sceneId: 'habitat', objectId: 'clock', kind: 'inspect' }, () => performed++);
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
        Object.assign(view.chair, { x: 0.4, z: 0.3, yaw });
        const a = side * Math.PI / 2;
        view.root.position.set(view.chair.x + Math.sin(a) * 1.1, 0, view.chair.z + Math.cos(a) * 1.1);
        view.props.interaction.current([view.chair.x, 0.7, view.chair.z], { sceneId: 'habitat', objectId: 'chair', kind: 'sit' }, () => {
          performed++;
          const facing = view.chair.yaw;
          const dx = view.root.position.x - view.chair.x, dz = view.root.position.z - view.chair.z;
          assert.ok(dx * Math.sin(facing) + dz * Math.cos(facing) > 0.7);
          assert.ok(Math.abs(dx * Math.cos(facing) - dz * Math.sin(facing)) < 0.06);
          view.props.objects.chair = { active: true };
        });
        for (let i = 0; i < 900 && !performed; i++) view.frame(1 / 60);
        assert.equal(performed, 1);
        for (let i = 0; i < 180; i++) view.frame(1 / 60);
        assert.equal(view.root.userData.posture, 'chair');
        const facing = view.chair.yaw;
        assert.ok(Math.abs(Math.atan2(Math.sin(view.root.rotation.y - facing), Math.cos(view.root.rotation.y - facing))) < 0.02);
        assert.equal(view.key('Escape').defaultPrevented, true, 'seated Escape must not also restore App state');
      } finally { view.dispose(); }
    });
  }
}

test('the fixed desk chair has room to board from the front', () => {
  const view = mount('orbital');
  let performed = 0;
  try {
    const placement = { ...view.chair };
    view.props.interaction.current([view.chair.x, 0.7, view.chair.z], { sceneId: 'habitat', objectId: 'chair', kind: 'sit' }, () => performed++);
    for (let i = 0; i < 900 && !performed; i++) view.frame(1 / 60);
    assert.equal(performed, 1);
    assert.deepEqual({ ...view.chair }, placement);
    assert.ok(view.root.position.z >= -1.445);
  } finally { view.dispose(); }
});

test('clicking the wardrobe leads to its doors and E opens the wardrobe at the same spot', () => {
  const actions = [];
  const view = mount('orbital', { onAction: action => actions.push([action.objectId, action.kind]) });
  try {
    const [x, z] = cabinLayout.WARDROBE_STAND;
    // Approach from the bedroom deck: clicking from below now waits at the stairs for E.
    view.root.position.set(-4.08, 0, 1.65);
    const request = { sceneId: 'habitat', objectId: 'wardrobe', kind: 'open' };
    let reached = false;
    view.props.interaction.current([cabinLayout.WARDROBE_FOOTPRINT[0], 1.45, z], request, () => { reached = true; });
    for (let i = 0; i < 1800 && !reached; i++) view.frame(1 / 60);
    assert.ok(reached);
    assert.ok(Math.hypot(view.root.position.x - x, view.root.position.z - z) < .06);
    view.key('KeyE');
    assert.deepEqual(actions, [['wardrobe', 'open']]);
  } finally { view.dispose(); }
});

test('outfit inspection finishes once, keeps Luna planted and skips motion when requested', () => {
  for (const hz of [30, 120]) {
    let completed = 0;
    const view = mount('orbital', { enabled: false, focusedObject: 'wardrobe', inspectionId: 12,
      onInspectionEnd: () => completed++ });
    try {
      const [x, z] = cabinLayout.WARDROBE_STAND;
      view.root.position.set(x, 0, z);
      for (let i = 0; i < 2 * hz; i++) view.frame(1 / hz);
      assert.equal(completed, 0);
      for (let i = 0; i < hz; i++) view.frame(1 / hz);
      assert.equal(completed, 1);
      assert.deepEqual(view.root.position.toArray(), [x, 0, z]);
      assert.deepEqual(view.sounds, []);
      view.props.reducedMotion = true;
      view.props.inspectionId++;
      view.frame(1 / hz);
      assert.equal(completed, 2);
    } finally { view.dispose(); }
  }
});

test('the static bed blocks walking without offering keyboard interaction, and nightstand controls are reachable', () => {
  const actions = [];
  const view = mount('orbital', { onAction: action => actions.push(action.objectId) });
  try {
    const [x, , z] = cabinLayout.BED_POSITION;
    view.root.position.set(x + 1.12, 0, z + .90);
    for (const key of ['KeyE', 'KeyQ', 'KeyR']) view.key(key);
    for (let i = 0; i < 240; i++) view.frame(1 / 60);
    assert.deepEqual(actions, []);
    assert.equal(view.root.userData.posture, 'standing');
    assert.equal(view.root.position.x, x + 1.12);
    assert.equal(view.root.position.z, z + .90);
    view.key('KeyA');
    for (let i = 0; i < 60; i++) view.frame(1 / 60);
    view.key('KeyA', 'keyup');
    assert.ok(view.root.position.x >= x + .86 + cabinLayout.RESIDENT_RADIUS, 'the bed remains a solid obstacle');

    for (const [px, pz, id] of [
      [cabinLayout.NIGHTSTAND_X - .11, cabinLayout.NIGHTSTAND_Z + .77, 'lamp'],
      [cabinLayout.NIGHTSTAND_X + .22, cabinLayout.NIGHTSTAND_Z + .64, 'clock'],
    ]) {
      view.root.position.set(px, 0, pz);
      view.key('KeyE');
      for (let i = 0; i < 240 && !actions.length; i++) view.frame(1 / 60);
      assert.deepEqual(actions.splice(0), [id]);
    }
  } finally { view.dispose(); }
});

test('walking into the stair mouth stays on the deck; only E climbs, and E descends again', () => {
  const deckView = { current: { deck: 'lower', stairAscent: null } };
  const hints = [];
  const view = mount('orbital', { deckView, onHover: (id, hint) => hints.push([id, hint]) });
  try {
    const [x, z] = cabinStairs.stairLanding('lower');
    view.root.position.set(x, 0, z);
    view.key('KeyA');
    for (let i = 0; i < 180; i++) view.frame(1 / 60);
    assert.equal(deckView.current.stairAscent, null, 'walking into the stairs must not climb');
    assert.equal(deckView.current.deck, 'lower');
    assert.ok(view.root.position.x >= cabinLayout.DECK_WALK_BOUNDS.lower.left);
    view.key('KeyA', 'keyup');
    for (let i = 0; i < 10; i++) view.frame(1 / 60);
    assert.ok(hints.some(([id, hint]) => id === 'stairs' && hint === 'E · 上楼'));
    view.key('KeyQ');
    for (let i = 0; i < 30; i++) view.frame(1 / 60);
    assert.equal(deckView.current.stairAscent, null, 'only E is listed and only E climbs');

    const ascent = [];
    view.key('KeyE');
    for (let i = 0; i < 1400; i++) {
      view.frame(1 / 60);
      if (deckView.current.stairAscent !== null) ascent.push(deckView.current.stairAscent);
      if (deckView.current.deck === 'upper') break;
    }
    assert.equal(deckView.current.deck, 'upper');
    assert.ok(ascent.length > 30 && ascent[0] === 0 && ascent.at(-1) === 1);
    assert.ok(ascent.every((value, index) => index === 0 || value >= ascent[index - 1]));
    assert.equal(deckView.current.stairAscent, null);
    const [ux, uz] = cabinStairs.stairLanding('upper');
    assert.ok(Math.hypot(view.root.position.x - ux, view.root.position.z - uz) < .01);

    view.key('KeyE');
    for (let i = 0; i < 1400 && deckView.current.deck !== 'lower'; i++) view.frame(1 / 60);
    assert.equal(deckView.current.deck, 'lower');
    assert.equal(deckView.current.stairAscent, null);
  } finally { view.dispose(); }
});

test('a click on the other deck walks to the stair landing and waits for E instead of crossing', () => {
  const [lx, lz] = cabinStairs.stairLanding('lower');
  assert.deepEqual([...cabinStairs.stairApproachPoint('lower', [-3.05, .8])], [lx, 0, lz]);
  assert.deepEqual([...cabinStairs.stairApproachPoint('lower', [1.1, .4])], [1.1, 0, .4]);
  const deckView = { current: { deck: 'lower', stairAscent: null } };
  const view = mount('orbital', { deckView, walkTarget: [lx, 0, lz] });
  try {
    for (let i = 0; i < 900; i++) view.frame(1 / 60);
    assert.equal(deckView.current.deck, 'lower');
    assert.equal(deckView.current.stairAscent, null);
    assert.ok(Math.hypot(view.root.position.x - lx, view.root.position.z - lz) < .06);

    view.key('KeyE');
    for (let i = 0; i < 1400 && deckView.current.deck !== 'upper'; i++) view.frame(1 / 60);
    assert.equal(deckView.current.deck, 'upper');
    view.key('KeyE');
    for (let i = 0; i < 1400 && deckView.current.deck !== 'lower'; i++) view.frame(1 / 60);
    assert.equal(deckView.current.deck, 'lower');
    assert.equal(deckView.current.stairAscent, null);
  } finally { view.dispose(); }
});

test('an object on the other deck is refused from below until the resident uses the stairs', () => {
  const deckView = { current: { deck: 'lower', stairAscent: null } };
  const hints = [];
  const view = mount('orbital', { deckView, onHover: (id, hint) => hints.push([id, hint]) });
  let acted = false;
  try {
    view.props.interaction.current(cabinLayout.CLOCK_POSITION, { sceneId: 'habitat', objectId: 'clock', kind: 'inspect' }, () => { acted = true; });
    for (let i = 0; i < 600; i++) view.frame(1 / 60);
    assert.equal(acted, false);
    assert.equal(deckView.current.deck, 'lower');
    assert.equal(deckView.current.stairAscent, null);
    assert.ok(hints.some(([, hint]) => hint === '先在楼梯口按 E 上楼'));
    assert.ok(Math.hypot(view.root.position.x - cabinLayout.HABITAT_SPAWN[0], view.root.position.z - cabinLayout.HABITAT_SPAWN[1]) < .05);
  } finally { view.dispose(); }
});

test('crowded nightstand items map E, Q and R to the three nearest props', () => {
  const performed = [];
  const view = mount('orbital', { onAction: action => performed.push(action.objectId) });
  try {
    for (const [key, id] of [['KeyE', 'clock'], ['KeyQ', 'lamp']]) {
      performed.length = 0;
      view.root.position.set(cabinLayout.NIGHTSTAND_X + .22, 0, cabinLayout.NIGHTSTAND_Z + .70);
      view.key(key);
      assert.deepEqual(performed, [id], `${key} selects ${id}`);
    }
    performed.length = 0;
    view.root.position.set(cabinLayout.NIGHTSTAND_X + .22, 0, cabinLayout.NIGHTSTAND_Z + .70);
    view.key('KeyR');
    assert.deepEqual(performed, [], 'R selects nothing without the plant interaction');
  } finally { view.dispose(); }
});

test('desk interaction range keeps the next prop reachable without cross-room selection', () => {
  const performed = [];
  const view = mount('orbital', { onAction: action => performed.push(action.objectId) });
  try {
    view.root.position.set(0.77, 0, -0.92);
    view.key('KeyE');
    assert.deepEqual(performed, [], 'a step outside the schedule reach selects nothing');
    view.root.position.set(1.05, 0, -1.42);
    view.key('KeyQ');
    assert.deepEqual(performed, [], 'standing beside the desk cannot select the computer');
    performed.length = 0;
    view.key('KeyE');
    assert.deepEqual(performed, ['schedule'], 'E still takes the nearest prop');
  } finally { view.dispose(); }
});

test('Space leaves a pending walk-to-object interaction in place', () => {
  const view = mount('orbital');
  let performed = 0;
  try {
    view.props.interaction.current([cabinLayout.CAT_HOME[0], .3, cabinLayout.CAT_HOME[1]], { sceneId: 'habitat', objectId: 'pet', kind: 'pet' }, () => performed++);
    assert.equal(view.key('Space').defaultPrevented, false);
    for (let i = 0; i < 2100 && !performed; i++) view.frame(1 / 60);
    assert.equal(performed, 1);
  } finally { view.dispose(); }
});

test('a newer click replaces the pending interaction', () => {
  const view = mount('orbital');
  let first = 0, second = 0;
  try {
    view.props.interaction.current(cabinLayout.CLOCK_POSITION, { sceneId: 'habitat', objectId: 'clock', kind: 'inspect' }, () => first++);
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
    view.props.interaction.current([cabinLayout.CAT_HOME[0], .3, cabinLayout.CAT_HOME[1]], { sceneId: 'habitat', objectId: 'pet', kind: 'pet' }, () => performed++);
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
    // The right wall blocks the fixed boarding point.
    Object.assign(view.chair, { x: 3.48, z: -1.3, yaw: Math.PI / 2 });
    view.root.position.set(3.65, 0, -0.3);
    view.props.interaction.current([view.chair.x, 0.7, view.chair.z], { sceneId: 'habitat', objectId: 'chair', kind: 'sit' }, () => performed++);
    for (let i = 0; i < 900; i++) view.frame(1 / 60);
    assert.equal(performed, 0);
    assert.equal(view.root.userData.posture, 'standing');
    assert.equal(view.chair.x, 3.48);
  } finally { view.dispose(); }
});

test('mouse selection requires the matching focus and preserves the drag hit point', () => {  const effects = [], requests = [], actions = [];
  const react = {
    useRef: current => ({ current }), useEffect: effect => effects.push(effect),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  };
  const component = load('./orbital/ObjectHandle.tsx', {
    react, three: THREE, './cabinLayout': cabinLayout, '../../types/world': load('../types/world.ts', {}),
  }, { window: new EventTarget() }).ObjectHandle;
  const handle = (focusedObject, extra = {}) => component({ id: 'lamp', action: 'toggle', hint: '', drag: 'y', ...extra, world: {
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
    const overviewOnly = handle(null, { panoramaOnly: true });
    overviewOnly.props.onPointerDown(event);
    overviewOnly.props.onPointerUp(event);
    assert.equal(requests.length, 2, 'the overview wrapper accepts clicks in the room');
    const focusedWrapper = handle('lamp', { panoramaOnly: true });
    focusedWrapper.props.onPointerDown(event);
    focusedWrapper.props.onPointerUp(event);
    assert.equal(requests.length, 2, 'the overview wrapper yields to close-up handles when focused');
  } finally { effects.map(effect => effect()).forEach(cleanup => cleanup?.()); }
});

for (let side = 0; side < 8; side++) {
  test(`E around chair side ${side} walks to its front before sitting`, () => {
    const performed = [], hints = [];
    const view = mount('orbital', { onHover: (id, hint) => hints.push({ id, hint }) });
    view.props.onAction = action => {
      performed.push(action);
      if (action.objectId === 'chair' && action.kind === 'sit') {
        const facing = view.chair.yaw;
        const dx = view.root.position.x - view.chair.x, dz = view.root.position.z - view.chair.z;
        assert.ok(dx * Math.sin(facing) + dz * Math.cos(facing) > 0.7);
        assert.ok(Math.abs(dx * Math.cos(facing) - dz * Math.sin(facing)) < 0.06);
        view.props.objects.chair = { active: true };
      }
    };
    try {
      Object.assign(view.chair, { x: 0.4, z: 0.3, yaw: Math.PI - .05 });
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

test('the desk front is walkable up to the tabletop and has no drawer interaction', () => {
  const performed = [], hints = [];
  const view = mount('orbital', {
    onAction: action => performed.push(action),
    onHover: (_, hint) => hints.push(hint),
  });
  try {
    view.root.position.set(0.35, 0, -0.555);
    view.key('KeyW');
    for (let i = 0; i < 120; i++) view.frame(1 / 60);
    view.key('KeyW', 'keyup');
    assert.ok(view.root.position.z < -1.3, 'Luna can cross the former drawer clearance');
    assert.ok(view.root.position.z >= -1.675 + cabinLayout.RESIDENT_RADIUS, 'the tabletop still blocks walking');

    view.root.position.set(0.35, 0, -1.32);
    view.frame(1 / 60);
    for (const key of ['KeyE', 'KeyQ', 'KeyR']) view.key(key);
    for (let i = 0; i < 60; i++) view.frame(1 / 60);
    assert.deepEqual(performed, []);
    assert.ok(!hints.some(hint => hint?.includes('抽屉')));
    assert.equal(view.root.position.z, -1.32);
  } finally { view.dispose(); }
});

test('E behind the fixed chair routes around it without moving it', () => {
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
    assert.equal(view.chair.z, z);
    assert.ok(view.root.position.z < view.chair.z - 0.8, 'Luna must reach its front');
  } finally { view.dispose(); }
});

test('clicking the computer while standing boards the desk chair, then opens it', () => {
  const performed = [], hints = [];
  const view = mount('orbital', { onHover: (_, hint) => hints.push(hint) });
  view.props.onAction = action => {
    performed.push([action.objectId, action.kind]);
    if (action.objectId === 'chair') view.props.objects.chair = { active: action.kind === 'sit' };
  };
  try {
    view.root.position.set(1.55, 0, -1.34);
    const accepted = view.props.interaction.current([1.55, 1.5, -2.6], { sceneId: 'habitat', objectId: 'computer', kind: 'inspect' },
      () => view.props.onAction({ sceneId: 'habitat', objectId: 'computer', kind: 'inspect' }));
    assert.equal(accepted, false);
    assert.deepEqual(performed, [], 'the computer must wait for the walk and seating');
    assert.ok(hints.some(hint => hint?.includes('走到电脑椅前坐下')));
    for (let i = 0; i < 1800 && !performed.some(([id]) => id === 'computer'); i++) view.frame(1 / 60);
    assert.deepEqual(performed, [['chair', 'sit'], ['computer', 'inspect']]);
    assert.equal(view.root.userData.posture, 'chair');
  } finally { view.dispose(); }
});

test('moving cancels a queued computer session before the chair is reached', () => {
  const performed = [];
  const view = mount('orbital');
  view.props.onAction = action => {
    performed.push([action.objectId, action.kind]);
    if (action.objectId === 'chair') view.props.objects.chair = { active: action.kind === 'sit' };
  };
  try {
    view.root.position.set(1.55, 0, -1.34);
    view.props.interaction.current([1.55, 1.5, -2.6], { sceneId: 'habitat', objectId: 'computer', kind: 'inspect' },
      () => view.props.onAction({ sceneId: 'habitat', objectId: 'computer', kind: 'inspect' }));
    view.frame(1 / 60);
    view.key('KeyD');
    for (let i = 0; i < 900; i++) view.frame(1 / 60);
    assert.deepEqual(performed, []);
    assert.notEqual(view.root.userData.posture, 'chair');
  } finally { view.dispose(); }
});

test('room clicks walk to each prop stand point before acting', () => {
  const performed = [];
  const view = mount('orbital', { onAction: action => performed.push(action) });
  try {
    for (const [objectId, kind, stand] of [
      ['journal', 'write', [-1.34, -1.42]],
      ['music-player', 'inspect', [-0.30, -1.42]],
    ]) {
      performed.length = 0;
      const accepted = view.props.interaction.current([stand[0], 1.5, stand[1]], { sceneId: 'habitat', objectId, kind },
        () => view.props.onAction({ sceneId: 'habitat', objectId, kind }));
      assert.equal(accepted, false);
      assert.deepEqual(performed, [], `${objectId} must not act before Luna arrives`);
      for (let i = 0; i < 1200 && !performed.length; i++) view.frame(1 / 60);
      assert.deepEqual(performed.map(action => action.objectId), [objectId]);
      const gap = Math.hypot(view.root.position.x - stand[0], view.root.position.z - stand[1]);
      assert.ok(gap <= .9, `${objectId} should stand at its usable side, gap=${gap}`);
      view.root.position.set(2.52, 0, 1.10);
      view.frame(1 / 60);
    }
  } finally { view.dispose(); }
});

for (const reducedMotion of [false, true]) {
  test(`computer input requires a fully seated desk-chair pose (reduced motion: ${reducedMotion})`, () => {
    const performed = [], hints = [];
    const view = mount('orbital', { reducedMotion, onHover: (_, hint) => hints.push(hint) });
    view.props.onAction = action => {
      performed.push([action.objectId, action.kind]);
      if (action.objectId === 'chair') view.props.objects.chair = { active: action.kind === 'sit' };
    };
    const computer = { sceneId: 'habitat', objectId: 'computer', kind: 'inspect' };
    const open = () => view.props.interaction.current([1.55, 1.5, -2.6], computer, () => view.props.onAction(computer));
    try {
      view.root.position.set(view.chair.x, 0, view.chair.z + .78);
      view.key('KeyE');
      for (let i = 0; i < 720 && view.root.userData.chairPhase !== 'seated'; i++) {
        view.frame(1 / 60);
        if (view.root.userData.chairPhase !== 'seated' && view.props.objects.chair?.active) view.key('KeyQ');
      }
      assert.equal(view.root.userData.chairPhase, 'seated');
      assert.deepEqual(performed, [['chair', 'sit']], 'keyboard access waits for the seated pose');
      assert.ok(hints.includes('E · 起身　Q · 使用电脑'));
      const seated = view.root.position.clone();
      assert.equal(open(), true);
      view.key('KeyQ');
      assert.deepEqual(performed.slice(1), [['computer', 'inspect'], ['computer', 'inspect']]);
      view.props.focusedObject = 'computer'; view.props.enabled = false;
      for (let i = 0; i < 120; i++) view.frame(1 / 60);
      assert.equal(view.root.userData.chairPhase, 'seated');
      assert.ok(view.root.position.distanceTo(seated) < .001, 'computer focus must not move Luna out of the chair');
      view.props.focusedObject = null; view.props.enabled = true;
      view.frame(1 / 60);
      view.key('KeyE');
      assert.equal(open(), false, 'standing up blocks computer input immediately');
      view.key('KeyQ');
      for (let i = 0; i < 400; i++) view.frame(1 / 60);
      assert.equal(view.root.userData.posture, 'standing');
      assert.equal(open(), false);
      assert.deepEqual(performed, [['chair', 'sit'], ['computer', 'inspect'], ['computer', 'inspect'], ['chair', 'stand']]);
    } finally { view.dispose(); }
  });
}

test('clicking the computer from the sofa stands Luna up and walks her to the desk chair', () => {
  const performed = [];
  const view = mount('orbital');
  view.props.onAction = action => {
    performed.push([action.objectId, action.kind]);
    if (action.objectId === 'chair') view.props.objects.chair = { active: action.kind === 'sit' };
    if (action.objectId === 'sofa') view.props.objects.sofa = { active: action.kind === 'sit' };
  };
  try {
    view.props.objects.sofa = { active: true };
    for (let i = 0; i < 60; i++) view.frame(1 / 60);
    let opened = 0;
    const accepted = view.props.interaction.current([1.55, 1.5, -2.6], { sceneId: 'habitat', objectId: 'computer', kind: 'inspect' }, () => { opened++; performed.push(['computer', 'inspect']); });
    assert.equal(accepted, false);
    assert.equal(opened, 0, 'the sofa does not grant immediate access');
    for (let i = 0; i < 2400 && !opened; i++) view.frame(1 / 60);
    assert.equal(opened, 1);
    assert.deepEqual(performed.map(([id, kind]) => [id, kind]), [['sofa', 'stand'], ['chair', 'sit'], ['computer', 'inspect']]);
    assert.equal(view.root.userData.posture, 'chair');
  } finally { view.dispose(); }
});

test('walking into the mounted chair stops Luna at its edge', () => {
  const view = mount('orbital');
  try {
    const placement = { ...view.chair };
    const { x, z } = placement;
    view.root.position.set(x, 0, z + .66);
    view.key('KeyW');
    for (let i = 0; i < 90; i++) view.frame(1 / 60);
    assert.deepEqual({ ...view.chair }, placement);
    assert.ok(view.root.position.z >= z + .515 && view.root.position.z < z + .55);
  } finally { view.dispose(); }
});

for (const reducedMotion of [false, true]) {
  test(`WASD stands Luna up from the fixed chair (reduced motion: ${reducedMotion})`, () => {
    const view = mount('orbital', { reducedMotion });
    view.props.onAction = action => {
      if (action.objectId === 'chair') view.props.objects.chair = { active: action.kind === 'sit' };
    };
    try {
      const placement = { ...view.chair };
      view.root.position.set(placement.x, 0, placement.z + .78);
      view.key('KeyE');
      for (let i = 0; i < 720; i++) view.frame(1 / 60);
      assert.equal(view.root.userData.chairPhase, 'seated');
      assert.equal(view.root.position.y, 0);
      view.key('KeyD');
      view.frame(1 / 60);
      assert.equal(view.root.userData.posture, 'standing-up');
      for (let i = 0; i < 400; i++) view.frame(1 / 60);
      assert.equal(view.root.userData.posture, 'standing');
      assert.ok(view.root.position.x > placement.x + .5);
      assert.deepEqual({ ...view.chair }, placement);
    } finally { view.dispose(); }
  });
}

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
