import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as computerLayout from './computerLayout.ts';
import { recordShooterHighScore } from '../../../types/shooterHighScore.ts';
import * as cartridgeMotion from './cartridge-motion.ts';
import { HIGHSCORE_KEY as fishingScoreKey } from '../../../games/mario/storage.ts';

const source = fs.readFileSync(process.env.MEDIA_EXIT_SOURCE ?? new URL('./MediaObjects.tsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source.replace(/const gameModules = .*;/, 'const gameModules = globalThis.gameModules;'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;

function mount({ game = null, modules = {}, focusedObject = 'computer', width = 1280, height = 720, localStorage } = {}) {
  const slots = [];
  let cursor = 0, dirty = true, tree;
  const effects = [];
  const target = new class extends EventTarget {
    removeEventListener(type, listener, options) {
      super.removeEventListener(type, listener, { capture: options === true || !!options?.capture });
    }
  }();
  Object.assign(target, { innerWidth: width, innerHeight: height });
  const changes = [], returns = [], errors = [];
  let blurred = 0;
  const same = (a, b) => a && b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]));
  const hooks = {
    useRef(value) {
      const index = cursor++;
      return slots[index] ??= { current: value };
    },
    useState(value) {
      const index = cursor++;
      const slot = slots[index] ??= { value: typeof value === 'function' ? value() : value };
      slot.set ??= next => {
        const value = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; }
      };
      return [slot.value, slot.set];
    },
    useCallback(callback, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, callback };
      return slots[index].callback;
    },
    useEffect(effect, deps) {
      const index = cursor++;
      const slot = slots[index] ??= {};
      if (!same(slot.deps, deps)) effects.push(() => {
        slot.cleanup?.();
        slot.deps = deps;
        slot.cleanup = effect();
      });
    },
  };
  const react = {
    ...hooks,
    Component: class {},
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  };
  const document = Object.assign(new EventTarget(), { hidden: false, activeElement: { blur() { blurred++; } } });
  const context = {
    exports: {}, gameModules: modules, window: target, document, localStorage,
    require(name) {
      if (name === 'react') return react;
      if (name === '@react-three/drei') return { Html: 'Html' };
      if (name === '@react-three/fiber') return { useFrame() {} };
      if (name === 'three') return {};
      if (name === '../../audioEngine') return { roomAudio: { cancelPreparedMusic() {} } };
      if (name === '../ObjectHandle') return { ObjectHandle: 'ObjectHandle' };
      if (name === '../Primitives') return { SoftBox: 'SoftBox' };
      if (name === '../../../types/shooterHighScore') return { recordShooterHighScore: score => recordShooterHighScore(score, () => localStorage) };
      if (name === '../SuppliedAsset') return { SuppliedAsset: 'SuppliedAsset' };
      if (name === './RecordPlayer') return { RecordPlayer: 'RecordPlayer' };
      if (name === './ComputerScreen') return { ComputerScreen: 'ComputerScreen' };
      if (name === './CartridgePickup') return { CartridgePickup: 'CartridgePickup' };
      if (name === './CartridgeHardware') return { GameCartridgeModel: 'GameCartridgeModel', CartridgeStandModel: 'CartridgeStandModel', CartridgeDockModel: 'CartridgeDockModel', PauseToggleLever: 'PauseToggleLever' };
      if (name === './computerLayout') return computerLayout;
      if (name === './cartridge-motion') return cartridgeMotion;
      if (name === '../cabinLayout') return { COMPUTER_STAND: [1.55, -1.36] };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(compiled, context);
  const disc = { id: 'test-disc', title: 'Test', discThemeColor: ['#fff', '#000'] };
  const props = {
    sceneId: 'habitat', focusedObject, activeGame: game, discs: [disc], activeDisc: disc,
    transition: { id: 0, phase: 'active', toScene: 'habitat', fromScene: 'habitat' }, reducedMotion: true,
    onGameChange: value => changes.push(value), onReturn: () => returns.push(true),
    onFeatureError: message => errors.push(message), onGesture() {}, onAction() {},
  };
  function render() {
    for (let round = 0; dirty; round++) {
      assert.ok(round < 20, 'effects must settle');
      dirty = false; cursor = 0;
      tree = context.exports.MediaObjects(props);
      effects.splice(0).forEach(effect => effect());
    }
    return tree;
  }
  function nodes(node = tree) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  render();
  return {
    props, target, document, changes, returns, errors,
    get blurred() { return blurred; },
    find: predicate => nodes().find(predicate),
    render() { dirty = true; return render(); },
    async settle() { await Promise.resolve(); await Promise.resolve(); render(); },
    key(code = 'Escape') {
      const event = new Event('keydown', { cancelable: true });
      Object.assign(event, { code });
      target.dispatchEvent(event);
      render();
      return event;
    },
    dispose() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

for (const [name, options] of [
  ['empty computer', {}],
  ['missing cartridge module', { game: 'mario' }],
  ['loading cartridge', { game: 'mario', modules: { '../../../games/mario/index.tsx': () => new Promise(() => {}) } }],
  ['failed cartridge import', { game: 'mario', modules: { '../../../games/mario/index.tsx': () => Promise.reject(new Error('load failed')) } }],
]) {
  test(`Escape leaves the ${name} and clears game selection`, async () => {
    const view = mount(options);
    try {
      await view.settle();
      let bubbled = 0;
      view.target.addEventListener('keydown', () => bubbled++);
      const event = view.key();
      assert.equal(event.defaultPrevented, true);
      assert.equal(bubbled, 0, 'outer Escape handler must not start a second return');
      assert.deepEqual(view.changes, [null]);
      assert.equal(view.returns.length, 1);
      assert.equal(view.blurred, 1);
    } finally { view.dispose(); }
  });
}

test('a mounted game retains Escape for its own pause menu; the physical exit still works', async () => {
  const view = mount({ game: 'mario', modules: { '../../../games/mario/index.tsx': () => Promise.resolve({ default: () => null }) } });
  try {
    await view.settle();
    let gameEscapes = 0;
    view.target.addEventListener('keydown', () => gameEscapes++);
    assert.equal(view.key().defaultPrevented, false);
    assert.equal(gameEscapes, 1);
    assert.equal(view.returns.length, 0);
    view.find(node => node.props?.id === 'computer-exit').props.world.onAction({ objectId: 'computer-exit' });
    assert.deepEqual(view.changes, [null]);
    assert.equal(view.returns.length, 1);
  } finally { view.dispose(); }
});

for (const action of ['game-pause', 'game-slot']) {
  test(`Escape leaves a mounted game after the physical ${action} control disables its input`, async () => {
    const view = mount({ game: 'mario', modules: { '../../../games/mario/index.tsx': () => Promise.resolve({ default: () => null }) } });
    try {
      await view.settle();
      view.find(node => node.props?.id === action).props.world.onAction({ objectId: action });
      view.render();
      assert.equal(view.key().defaultPrevented, true);
      assert.deepEqual(view.changes, [null]);
      assert.equal(view.returns.length, 1);
    } finally { view.dispose(); }
  });
}

test('resuming with the physical pause control hands Escape back to the game', async () => {
  const view = mount({ game: 'mario', modules: { '../../../games/mario/index.tsx': () => Promise.resolve({ default: () => null }) } });
  try {
    await view.settle();
    for (let i = 0; i < 2; i++) {
      view.find(node => node.props?.id === 'game-pause').props.world.onAction({ objectId: 'game-pause' });
      view.render();
    }
    assert.equal(view.key().defaultPrevented, false);
    assert.equal(view.returns.length, 0);
  } finally { view.dispose(); }
});

test('a cartridge render failure restores the Escape exit', async () => {
  const view = mount({ game: 'mario', modules: { '../../../games/mario/index.tsx': () => Promise.resolve({ default: () => null }) } });
  try {
    await view.settle();
    view.find(node => node.type?.name === 'ScreenBoundary').props.onError();
    view.render();
    assert.equal(view.key().defaultPrevented, true);
    assert.equal(view.returns.length, 1);
    assert.deepEqual(view.changes, [null]);
  } finally { view.dispose(); }
});

test('leaving during insertion cancels the transfer and ignores its stale completion', () => {
  const view = mount();
  try {
    const pickup = view.find(node => node.props?.id === 'game-cartridge-mario');
    assert.ok(pickup.props.onGrab());
    pickup.props.onDrop([...cartridgeMotion.CARTRIDGE_SLOT], true);
    view.render();
    const transfer = view.find(node => node.type?.name === 'TransferObject');
    assert.ok(transfer);
    view.key();
    transfer.props.onDone();
    assert.deepEqual(view.changes, [null]);
    assert.equal(view.returns.length, 1);
    assert.equal(view.find(node => node.type?.name === 'TransferObject'), undefined);
  } finally { view.dispose(); }
});

test('a rejected approach request leaves both cartridges on the rack without delayed insertion', () => {
  const view = mount({ focusedObject: null });
  const requests = [], actions = [];
  try {
    view.props.onApproach = (_point, action) => { requests.push(action.objectId); return false; };
    view.props.onAction = action => actions.push(action);
    view.render();
    for (const game of ['mario', 'shooter']) {
      view.find(node => node.props?.id === `game-cartridge-${game}`).props.onSelect();
      view.render();
      assert.equal(view.find(node => node.type?.name === 'TransferObject'), undefined);
    }
    assert.deepEqual(requests, ['computer', 'computer']);
    assert.deepEqual(actions, []);
    view.props.focusedObject = 'computer';
    view.props.transition = { ...view.props.transition, id: 1 };
    view.render();
    assert.equal(view.find(node => node.type?.name === 'TransferObject'), undefined, 'rejected selections cannot insert after sitting later');
    assert.deepEqual(view.changes, []);
  } finally { view.dispose(); }
});

test('one cartridge selection from the room waits for the computer, then inserts the chosen game', () => {
  const view = mount({ focusedObject: null });
  try {
    let arrive;
    view.props.onApproach = (_point, action, proceed) => {
      assert.equal(action.objectId, 'computer');
      arrive = proceed;
      return false;
    };
    let opening;
    view.props.onAction = action => { opening = action; };
    const transfer = () => view.find(node => node.type?.name === 'TransferObject');
    const pickup = () => view.find(node => node.props?.id === 'game-cartridge-shooter');
    view.props.focusedObject = 'music-player';
    view.render();
    assert.equal(pickup().props.enabled, false, 'leave the cartridge inactive in other close-ups');
    pickup().props.onSelect();
    assert.equal(arrive, undefined);
    view.props.focusedObject = null;
    view.render();
    assert.equal(pickup().props.enabled, true, 'allow direct selection from the room');
    pickup().props.onSelect();
    assert.equal(transfer(), undefined, 'leave the cartridge on the rack until seated access is granted');
    arrive();
    view.render();
    assert.equal(transfer(), undefined, 'wait for world props to reach the Canvas');
    view.props.transition = { ...view.props.transition, id: 1, phase: 'preparing', action: opening };
    view.render();
    assert.equal(transfer(), undefined, 'wait for computer focus to settle');
    view.props.focusedObject = 'computer';
    view.props.transition = { ...view.props.transition, phase: 'active' };
    view.render();
    assert.equal(transfer().props.transfer.game, 'shooter');
    assert.deepEqual(transfer().props.transfer.from, cartridgeMotion.cartridgePosition('shooter'));
    transfer().props.onDone();
    assert.deepEqual(view.changes, ['shooter']);
  } finally { view.dispose(); }
});

test('mario loads only on selection and ignores a late import after leaving', async () => {
  const Game = () => null;
  let loads = 0, finish;
  const view = mount({ modules: { '../../../games/mario/index.tsx': () => {
    loads++;
    return loads === 1 ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ default: Game });
  } } });
  try {
    await view.settle();
    assert.equal(loads, 0);
    assert.match(view.find(node => node.props?.id === 'game-cartridge-mario').props.hint, /潮汐小馆/);
    view.props.activeGame = 'mario';
    view.render();
    assert.equal(loads, 1);
    view.key();
    assert.deepEqual(view.changes, [null]);
    view.props.activeGame = null;
    view.props.focusedObject = null;
    view.render();
    finish({ default: Game });
    await view.settle();
    assert.equal(view.find(node => node.type === Game), undefined);
    view.props.activeGame = 'mario';
    view.props.focusedObject = 'computer';
    view.render();
    await view.settle();
    assert.equal(loads, 2);
    assert.equal(view.find(node => node.type === Game).props.isActive, true);
  } finally { view.dispose(); }
});

test('room score callbacks keep fishing, legacy ski and shooter records separate', async () => {
  const Game = () => null;
  const legacy = 'pocketworld:mario:highscore', shooter = 'pocketworld:shooter:highscore';
  const data = new Map([[legacy, '99999'], [fishingScoreKey, '1e3'], [shooter, '12']]);
  const reads = [], writes = [];
  const localStorage = {
    getItem(key) { reads.push(key); return data.get(key) ?? null; },
    setItem(key, value) { writes.push(key); data.set(key, value); },
  };
  const view = mount({ game: 'mario', localStorage, modules: {
    '../../../games/mario/index.tsx': () => Promise.resolve({ default: Game }),
    '../../../games/shooter/index.tsx': () => Promise.resolve({ default: Game }),
  } });
  try {
    await view.settle();
    const fishing = view.find(node => node.type === Game).props;
    fishing.onScoreChange(5, 5);
    fishing.onGameOver({ score: 4, highScore: 4, victory: false });
    assert.equal(data.get(fishingScoreKey), '5');
    assert.equal(data.get(legacy), '99999');
    assert.equal(data.get(shooter), '12');
    assert.deepEqual(reads, [fishingScoreKey, fishingScoreKey]);
    assert.deepEqual(writes, [fishingScoreKey]);
    view.props.activeGame = 'shooter';
    view.render();
    await view.settle();
    view.find(node => node.type === Game).props.onScoreChange(15, 15);
    assert.equal(data.get(shooter), '15');
    assert.equal(data.get(fishingScoreKey), '5');
    assert.deepEqual(reads, [fishingScoreKey, fishingScoreKey, shooter, shooter]);
    assert.deepEqual(writes, [fishingScoreKey, shooter]);
  } finally { view.dispose(); }
});

test('other keys, other focused objects and disposal do not retain the computer Escape handler', () => {
  const view = mount();
  try {
    assert.equal(view.key('KeyW').defaultPrevented, false);
    view.props.focusedObject = 'music-player'; view.render();
    assert.equal(view.key().defaultPrevented, false);
    assert.equal(view.returns.length, 0);
    view.props.focusedObject = 'computer'; view.render();
    view.dispose();
    assert.equal(view.key().defaultPrevented, false);
    assert.equal(view.returns.length, 0);
  } finally { view.dispose(); }
});

test('narrow cartridge uses one stable game through collapse, expand, rotation and visibility changes', async () => {
  const Game = () => null;
  const view = mount({ game: 'shooter', width: 390, height: 844, modules: { '../../../games/shooter/index.tsx': () => Promise.resolve({ default: Game }) } });
  try {
    await view.settle();
    const host = () => view.find(node => node.type === 'ComputerScreen');
    const game = () => view.find(node => node.type === Game);
    assert.equal(host().props.expanded, true); assert.equal(game().props.isActive, true);
    host().props.onCollapse(); view.render();
    assert.equal(host().props.expanded, false); assert.equal(game().props.isActive, false);
    assert.equal(view.changes.length, 0); assert.equal(view.returns.length, 0);
    host().props.onExpand(); view.render();
    assert.equal(host().props.expanded, true); assert.equal(game().props.isActive, true);
    view.target.innerWidth = 844; view.target.innerHeight = 390; view.target.dispatchEvent(new Event('resize')); view.render();
    assert.equal(host().props.expanded, true); assert.equal(game().props.width, 800); assert.equal(game().props.height, 600);
    view.target.dispatchEvent(new Event('blur')); view.render(); assert.equal(game().props.isActive, false);
    view.target.dispatchEvent(new Event('focus')); view.render(); assert.equal(game().props.isActive, true);
    view.document.hidden = true; view.document.dispatchEvent(new Event('visibilitychange')); view.render(); assert.equal(game().props.isActive, false);
    view.document.hidden = false; view.document.dispatchEvent(new Event('visibilitychange')); view.render(); assert.equal(game().props.isActive, true);
    host().props.onEject(); view.render(); assert.equal(game().props.isActive, false);
    view.find(node => node.type?.name === 'TransferObject').props.onDone();
    assert.deepEqual(view.changes, [null]);
  } finally { view.dispose(); }
});

test('desktop explicitly expands and resumes embedded without replacing the cartridge component', async () => {
  const Game = () => null;
  const view = mount({ game: 'shooter', modules: { '../../../games/shooter/index.tsx': () => Promise.resolve({ default: Game }) } });
  try {
    await view.settle();
    const host = () => view.find(node => node.type === 'ComputerScreen');
    assert.equal(host().props.expanded, false);
    host().props.onExpand(); view.render(); assert.equal(host().props.expanded, true);
    host().props.onCollapse(); view.render(); assert.equal(view.find(node => node.type === Game).props.isActive, false);
    host().props.onResume(); view.render(); assert.equal(host().props.expanded, false); assert.equal(view.find(node => node.type === Game).props.isActive, true);
  } finally { view.dispose(); }
});

test('computer overview handles yield to close-up interaction so focused clicks cannot re-inspect', () => {
  const view = mount();
  try {
    const computerHandle = view.find(node => node.props?.id === 'computer');
    assert.equal(computerHandle.props.panoramaOnly, true);
    const deskSource = fs.readFileSync(new URL('../FurnitureDesk.tsx', import.meta.url), 'utf8');
    assert.match(deskSource, /<ObjectHandle\s+id="computer"\s+action="inspect"\s+panoramaOnly\b/);
  } finally { view.dispose(); }
});

test('collapsed ComputerScreen captures clicks on the CRT display to resume or re-expand', () => {
  const screenSource = fs.readFileSync(new URL('./ComputerScreen.tsx', import.meta.url), 'utf8');
  const compiledScreen = ts.transpileModule(screenSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const hooks = {
    useRef: value => ({ current: value }),
    useMemo: fn => fn(),
  };
  const react = {
    ...hooks,
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  };
  const ctx = {
    exports: {},
    require(name) {
      if (name === 'react') return react;
      if (name === '@react-three/drei') return { Html: 'Html' };
      if (name === '@react-three/fiber') return { useFrame() {} };
      if (name === 'three') return { Vector3: class { constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; } } };
      if (name === './computerLayout') return computerLayout;
      if (name === './screen-layout') return { fitComputerDisplay() {}, fitExpandedDisplay() {} };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(compiledScreen, ctx);
  const collect = node => {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(collect);
    return [node, ...collect(node.props?.children)];
  };
  const renderScreen = props => collect(ctx.exports.ComputerScreen({
    visible: true, interactive: false, controls: true, children: null, ...props,
  }));

  let resumed = 0, expanded = 0, stopped = 0;
  const desktopNodes = renderScreen({
    collapsed: true, allowEmbeddedResume: true,
    onResume: () => resumed++, onExpand: () => expanded++,
  });
  const desktopSurface = desktopNodes.find(n => n.props?.['data-computer-display'] === 'native');
  assert.equal(desktopSurface.props.style.pointerEvents, 'auto');
  const resumeBtn = desktopNodes.find(n => n.props?.className === 'computer-game-resume-surface');
  assert.ok(resumeBtn);
  resumeBtn.props.onClick({ stopPropagation() { stopped++; } });
  assert.equal(resumed, 1);
  assert.equal(expanded, 0);
  assert.equal(stopped, 1);

  const narrowNodes = renderScreen({
    collapsed: true, allowEmbeddedResume: false,
    onResume: () => resumed++, onExpand: () => expanded++,
  });
  narrowNodes.find(n => n.props?.className === 'computer-game-resume-surface')
    .props.onClick({ stopPropagation() { stopped++; } });
  assert.equal(resumed, 1);
  assert.equal(expanded, 1);
  assert.equal(stopped, 2);

  const expandedNodes = renderScreen({ expanded: true, collapsed: true, interactive: true });
  assert.equal(expandedNodes.find(n => n.props?.className === 'computer-game-resume-surface'), undefined);

  const idleNodes = renderScreen({ controls: false, collapsed: false, interactive: false });
  assert.equal(idleNodes.find(n => n.props?.['data-computer-display'] === 'native').props.style.pointerEvents, 'none');
  assert.equal(idleNodes.find(n => n.props?.className === 'computer-game-resume-surface'), undefined);
});

test('useWorldController ignores duplicate inspect on an already-active focused object', async () => {
  const controllerSource = fs.readFileSync(new URL('../useWorldController.ts', import.meta.url), 'utf8');
  const compiledCtrl = ts.transpileModule(controllerSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
  }).outputText;
  const slots = [];
  let cursor = 0, dirty = true, value;
  const same = (a, b) => a && b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]));
  const hooks = {
    useRef: init => { const i = cursor++; return slots[i] ??= { current: init }; },
    useState: init => {
      const i = cursor++;
      const slot = slots[i] ??= { value: typeof init === 'function' ? init() : init };
      slot.set ??= next => {
        const v = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(v, slot.value)) { slot.value = v; dirty = true; }
      };
      return [slot.value, slot.set];
    },
    useCallback: (cb, deps) => { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, cb }; return slots[i].cb; },
    useEffect: () => {},
  };
  const ctx = {
    exports: {},
    AbortController,
    require(name) {
      if (name === 'react') return hooks;
      if (name === 'gsap') return { __esModule: true, default: { timeline: ({ onComplete }) => ({ to() { onComplete?.(); return this; }, call() { return this; }, kill() {} }) } };
      if (name === '../audioEngine') return { roomAudio: { playSfx() {} } };
      if (name === './wardrobe/outfit') return { initialOutfit: () => 'everyday', isOutfit: () => false, rememberOutfit() {} };
      if (name === '../../types/world') return { CLOSED_OBJECT: { open: false, active: false, page: 0, value: 0 } };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(compiledCtrl, ctx);
  const pump = () => { while (dirty) { dirty = false; cursor = 0; value = ctx.exports.useWorldController(); } };
  pump();
  await value.onAction({ sceneId: 'habitat', objectId: 'computer', kind: 'inspect' });
  pump();
  assert.equal(value.focusedObject, 'computer');
  assert.equal(value.transition.phase, 'active');
  const settledId = value.transition.id;
  await value.onAction({ sceneId: 'habitat', objectId: 'computer', kind: 'inspect' });
  pump();
  assert.equal(value.transition.id, settledId);
  assert.equal(value.transition.phase, 'active');
});
