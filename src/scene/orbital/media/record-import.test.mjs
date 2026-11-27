import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as recordMotion from './record-motion.ts';

const appSource = fs.readFileSync(new URL('../../../App.tsx', import.meta.url), 'utf8');
const compiledApp = ts.transpileModule(appSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true },
}).outputText;

function mountApp({ presetCount = 4, focusedObject = 'music-player', initialViewMode = 'cabin', blockedAutoplay = false } = {}) {
  const slots = [];
  let cursor = 0, dirty = true, tree;
  const effects = [];
  const createdUrls = [];
  const revokedUrls = [];
  const preparedDiscs = [];
  let inputClicks = 0;
  const timers = new Map();
  const starts = [];
  let timerId = 0;

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
        const resolved = typeof next === 'function' ? next(slot.value) : next;
        if (!Object.is(resolved, slot.value)) { slot.value = resolved; dirty = true; }
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
    useSyncExternalStore(_sub, getSnapshot) {
      return getSnapshot();
    },
  };
  const react = {
    ...hooks,
    Fragment: Symbol.for('react.fragment'),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  };

  const presetDiscs = Array.from({ length: presetCount }, (_, i) => ({
    id: `preset-${i}`,
    title: `Preset ${i}`,
    artist: 'Preset',
    audioUrl: `synth:preset-${i}`,
    discThemeColor: ['#fff', '#000'],
  }));
  const audioSnapshot = { disc: presetDiscs[0], isPlaying: false, isMuted: false, status: 'idle', error: null };
  const roomAudio = {
    subscribe: () => () => {},
    getSnapshot: () => audioSnapshot,
    unlock: async () => true,
    prepareMusic: disc => preparedDiscs.push(disc),
    async startMusic(disc, options) {
      starts.push({ disc, options });
      audioSnapshot.status = 'starting';
      await Promise.resolve();
      Object.assign(audioSnapshot, { disc, status: blockedAutoplay ? 'idle' : 'playing', isPlaying: !blockedAutoplay });
      dirty = true;
      return !blockedAutoplay;
    },
    pauseMusic() { audioSnapshot.status = 'paused'; audioSnapshot.isPlaying = false; dirty = true; },
    resumeMusic: async () => true,
    stopMusic() {},
    setMuted() {},
  };
  const world = {
    sceneId: 'habitat',
    objects: {},
    focusedObject,
    hover: null,
    error: null,
    reducedMotion: true,
    transition: { id: 0, phase: 'active', action: null, fromScene: 'habitat', toScene: 'habitat' },
    motion: { current: { progress: 1, sceneProgress: 1 } },
    onAction() {},
    onReturn() {},
    onHover() {},
    onGesture() {},
  };
  const target = new EventTarget();
  Object.assign(target, {
    location: { search: '?view=cabin' },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const URLMock = {
    createObjectURL(file) {
      const url = `blob:mock-${createdUrls.length + 1}-${file.name}`;
      createdUrls.push(url);
      return url;
    },
    revokeObjectURL(url) { revokedUrls.push(url); },
  };
  const context = {
    exports: {},
    window: target,
    document: new EventTarget(),
    HTMLElement: class {},
    URLSearchParams,
    URL: URLMock,
    require(name) {
      if (name === 'react') return react;
      if (name === './scene/audioEngine') {
        return {
          PRESET_MUSIC_DISCS: presetDiscs,
          generateDiscColorsFromName: () => ['#111', '#222'],
          roomAudio,
        };
      }
      if (name === './scene/orbital/media/record-motion') return recordMotion;
      if (name === './scene/orbital/OrbitalScene') return { OrbitalScene: 'OrbitalScene' };
      if (name === './scene/orbital/library/useLibrary') {
        return { useLibrary: options => ({ dispatch: options.onAction, back: options.onReturn, data: { books: [] }, flow: { current: { phase: 'idle' } } }) };
      }
      if (name === './scene/orbital/library/LibrarySurface') return { LibrarySurface: 'LibrarySurface' };
      if (name === './scene/orbital/useWorldController') return { useWorldController: () => world };
      if (name === './scene/orbital/wardrobe/WardrobeSurface') return { WardrobeSurface: 'WardrobeSurface' };
      if (name === './scene/orbital/wardrobe/outfit') return { readOutfit: () => 'everyday' };
      if (name === './scene/orbital/cleaning') return { cleaningTiming: () => ({ fadeIn: 0, sweep: 0, fadeOut: 0, sweepInterval: 1 }), cleaningSweepCount: () => 1 };
      if (name === './scene/orbital/OrbitalDustPrompt') return { DustPrompt: 'DustPrompt' };
      if (name === './scene/orbital/spacecraftFlight') return { readInitialViewMode: () => initialViewMode };
      if (name === './scene/orbital/orbital.css') return {};
      if (name === '../assets/brand/pocketworld-wordmark.webp') return 'wordmark.webp';
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(compiledApp, context);

  function nodes(node = tree) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  function attachInputRef() {
    const input = nodes().find(n => n.type === 'input');
    if (input?.props?.ref && !input.props.ref.current) {
      input.props.ref.current = { value: '', click() { inputClicks += 1; } };
    }
  }
  function render() {
    for (let round = 0; dirty; round++) {
      assert.ok(round < 20, 'effects must settle');
      dirty = false;
      cursor = 0;
      tree = context.exports.App({});
      attachInputRef();
      effects.splice(0).forEach(effect => effect());
    }
    return tree;
  }
  render();

  const find = predicate => nodes().find(predicate);
  return {
    get inputClicks() { return inputClicks; },
    createdUrls,
    revokedUrls,
    preparedDiscs,
    starts,
    audioSnapshot,
    pauseMusic: roomAudio.pauseMusic,
    set blocked(value) { blockedAutoplay = value; },
    view(mode) { find(n => n.type === 'OrbitalScene').props.onViewModeChange(mode); render(); },
    gesture(type) { target.dispatchEvent(new Event(type)); render(); },
    async settle() { await Promise.resolve(); await Promise.resolve(); render(); },
    async flushAutoplay() {
      for (const [id, timer] of [...timers]) if (timer.delay === 0) { timers.delete(id); timer.fn(); }
      await Promise.resolve(); await Promise.resolve(); render();
    },
    scene: () => find(n => n.type === 'OrbitalScene'),
    promptText: () => find(n => n.type === 'DustPrompt')?.props?.text ?? '',
    main: () => find(n => n.type === 'main'),
    input: () => find(n => n.type === 'input'),
    clickImport() {
      find(n => n.type === 'OrbitalScene').props.onImportMusic();
      render();
    },
    chooseFile(file) {
      find(n => n.type === 'input').props.onChange({ target: { files: [file] } });
      render();
    },
    dropFile(file) {
      find(n => n.type === 'main').props.onDrop({
        preventDefault() {},
        dataTransfer: { files: [file] },
      });
      render();
    },
    dispose() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

test('App caps local music imports at the 6 vinyl rack slots for both click and drag-and-drop', () => {
  const app = mountApp({ presetCount: 4 });
  try {
    assert.equal(app.scene().props.discs.length, 4);

    // Slot 5: file picker opens and imports cleanly
    app.clickImport();
    assert.equal(app.inputClicks, 1);
    app.chooseFile({ name: '01-morning.mp3', type: 'audio/mpeg', size: 2048 });
    assert.equal(app.scene().props.discs.length, 5);
    assert.equal(app.createdUrls.length, 1);
    assert.match(app.promptText(), /《01-morning》已放进唱片架（5\/6）/);

    // Oversized file does not consume the remaining slot
    app.dropFile({ name: 'too-big.wav', type: 'audio/wav', size: recordMotion.MAX_IMPORT_AUDIO_BYTES + 1 });
    assert.equal(app.scene().props.discs.length, 5);
    assert.equal(app.createdUrls.length, 1);
    assert.match(app.promptText(), /100 MB/);

    // Slot 6: drag-and-drop fills the final slot
    app.dropFile({ name: '02-waltz.ogg', type: 'audio/ogg', size: 4096 });
    assert.equal(app.scene().props.discs.length, 6);
    assert.equal(app.createdUrls.length, 2);
    assert.match(app.promptText(), /《02-waltz》已放进唱片架（6\/6）/);

    // Clicking blank disc when full does NOT open file picker and shows rack-full notice
    app.clickImport();
    assert.equal(app.inputClicks, 1, 'file picker must not open once all 6 rack slots are occupied');
    assert.equal(app.promptText(), recordMotion.RACK_FULL_MESSAGE);

    // Dropping another file when full is rejected without creating a blob URL or adding a 7th disc
    app.dropFile({ name: '03-extra.mp3', type: 'audio/mpeg', size: 1024 });
    assert.equal(app.scene().props.discs.length, 6);
    assert.equal(app.createdUrls.length, 2);
    assert.equal(app.preparedDiscs.length, 2);
    assert.equal(app.promptText(), recordMotion.RACK_FULL_MESSAGE);
  } finally {
    app.dispose();
  }
});

test('cabin entry autoplays the default record once and respects a later manual pause across reentry', async () => {
  const app = mountApp({ initialViewMode: 'orbit' });
  try {
    await app.flushAutoplay();
    app.gesture('pointerdown');
    assert.equal(app.starts.length, 0);
    app.view('cabin');
    await app.flushAutoplay();
    assert.equal(app.starts.length, 1);
    assert.equal(app.starts[0].disc.id, 'preset-0');
    assert.equal(app.starts[0].options.autoplay, true);
    assert.equal(app.scene().props.isMusicPlaying, true);
    app.pauseMusic();
    app.gesture('keydown');
    app.view('orbit'); app.view('cabin');
    await app.flushAutoplay();
    assert.equal(app.starts.length, 1);
    assert.equal(app.scene().props.isMusicPlaying, false);
  } finally { app.dispose(); }
});

test('blocked autoplay retries on pointer and keyboard gestures without overlapping requests', async () => {
  const app = mountApp({ blockedAutoplay: true });
  try {
    await app.flushAutoplay();
    assert.equal(app.starts.length, 1);
    app.gesture('pointerdown'); app.gesture('keydown');
    assert.equal(app.starts.length, 2);
    await app.settle();
    app.blocked = false;
    app.gesture('keydown');
    await app.settle();
    assert.equal(app.starts.length, 3);
    assert.equal(app.scene().props.isMusicPlaying, true);
    app.gesture('pointerdown');
    assert.equal(app.starts.length, 3);
  } finally { app.dispose(); }
});

test('manual pause or another selected record cancels pending autoplay and unmount removes retries', async () => {
  for (const status of ['paused', 'playing']) {
    const app = mountApp({ blockedAutoplay: true });
    await app.flushAutoplay();
    Object.assign(app.audioSnapshot, { status, isPlaying: status === 'playing', disc: { id: 'manual-record' } });
    app.gesture('pointerdown');
    await app.settle();
    assert.equal(app.starts.length, 1);
    app.dispose();
    app.gesture('keydown');
    assert.equal(app.starts.length, 1);
  }
  const app = mountApp();
  app.dispose();
  await app.flushAutoplay();
  assert.equal(app.starts.length, 0);
});
