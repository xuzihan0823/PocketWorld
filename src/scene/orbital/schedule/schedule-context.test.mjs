import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

function load(file, dependencies = {}, globals = {}) {
  const source = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const context = { exports: {}, crypto: webcrypto, AbortController, ...globals, require: name => dependencies[name] };
  vm.runInNewContext(compiled, context);
  return context.exports;
}

const schedule = load('./schedule.ts');
const entry = id => ({ id, title: `任务 ${id}`, time: '09:00', completed: false });

function storageFor(state) {
  const values = new Map(state ? [[schedule.SCHEDULE_KEY, JSON.stringify(state)]] : []);
  return {
    fail: false,
    getItem: key => values.get(key) ?? null,
    setItem(key, value) {
      if (this.fail) throw new Error('QuotaExceededError');
      values.set(key, value);
    },
    read: () => JSON.parse(values.get(schedule.SCHEDULE_KEY)),
  };
}

function mount(storage, remote) {
  const hooks = [];
  let cursor = 0, dirty = false, effects = [], tree;
  const same = (before, after) => before && before.length === after.length && before.every((value, index) => Object.is(value, after[index]));
  const react = {
    createContext: () => ({ Provider: 'Provider' }),
    createElement: (type, props) => ({ type, props }),
    useState(initial) {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks[index], next => {
        hooks[index] = typeof next === 'function' ? next(hooks[index]) : next;
        dirty = true;
      }];
    },
    useRef(initial) {
      const index = cursor++;
      return hooks[index] ?? (hooks[index] = { current: initial });
    },
    useCallback(callback, dependencies) {
      const index = cursor++;
      if (!same(hooks[index]?.dependencies, dependencies)) hooks[index] = { callback, dependencies };
      return hooks[index].callback;
    },
    useEffect(effect, dependencies) {
      const index = cursor++;
      const previous = hooks[index];
      if (same(previous?.dependencies, dependencies)) return;
      const current = { dependencies };
      hooks[index] = current;
      effects.push(() => { previous?.cleanup?.(); current.cleanup = effect(); });
    },
  };
  react.default = react;
  const { ScheduleProvider } = load('./ScheduleContext.tsx', { react, './schedule': schedule }, { localStorage: storage });
  function render() {
    cursor = 0; dirty = false;
    tree = ScheduleProvider({ adapters: remote ? { schedule: remote } : undefined, children: null });
    const pending = effects;
    effects = [];
    pending.forEach(effect => effect());
  }
  render();
  return {
    get value() { return tree.props.value; },
    async flush() {
      for (let iteration = 0; iteration < 20; iteration++) {
        await new Promise(resolve => setImmediate(resolve));
        if (!dirty) return;
        render();
      }
      assert.fail('ScheduleProvider did not settle');
    },
    dispose() { hooks.forEach(hook => hook?.cleanup?.()); },
  };
}

test('failed draft writes retain input, block posting and can retry without another edit', async () => {
  const storage = storageFor(schedule.migrateSchedule([entry('local')]));
  const view = mount(storage);
  try {
    await view.flush();
    storage.fail = true;
    const edited = structuredClone(view.value.state);
    edited.current.entries[0].title = '刚输入的内容';
    assert.equal(view.value.commit(edited, { retainDraftOnError: true }), false);
    await view.flush();
    assert.equal(view.value.state.current.entries[0].title, '刚输入的内容');
    assert.equal(storage.read().current.entries[0].title, '任务 local');
    assert.equal(view.value.commit(schedule.postSchedulePage(view.value.state)), false);
    await view.flush();
    assert.equal(view.value.state.posted.length, 0);
    storage.fail = false;
    view.value.retry();
    await view.flush();
    assert.equal(storage.read().current.entries[0].title, '刚输入的内容');
    assert.equal(view.value.error, '');
  } finally { view.dispose(); }
});

test('retry reloads the server and preserves remote additions alongside offline edits', async () => {
  const local = schedule.migrateSchedule([entry('local')]);
  const storage = storageFor(local);
  let offline = true, loads = 0, saves = 0;
  let server = [...schedule.flattenSchedule(local), entry('remote-new')];
  const view = mount(storage, {
    async load() { loads++; if (offline) throw new Error('offline'); return server; },
    async save(entries) { saves++; server = entries; },
  });
  try {
    await view.flush();
    const edited = structuredClone(view.value.state);
    edited.current.entries[0].title = '离线修改';
    assert.equal(view.value.commit(edited, { retainDraftOnError: true }), true);
    await view.flush();
    assert.equal(saves, 0);
    view.value.retry();
    await view.flush();
    assert.equal(saves, 0);
    offline = false;
    view.value.retry();
    await view.flush();
    assert.equal(loads, 3);
    assert.equal(saves, 1);
    assert.equal(server.find(item => item.id === 'local').title, '离线修改');
    assert.ok(server.some(item => item.id === 'remote-new'));
    assert.equal(view.value.state.syncPending, false);
  } finally { view.dispose(); }
});

test('retry after a read failure with no local edits only reads and merges remote tasks', async () => {
  const local = schedule.migrateSchedule([entry('local')]);
  let offline = true, saves = 0;
  const view = mount(storageFor(local), {
    async load() { if (offline) throw new Error('offline'); return [...schedule.flattenSchedule(local), entry('remote-new')]; },
    async save() { saves++; },
  });
  try {
    await view.flush();
    offline = false;
    view.value.retry();
    await view.flush();
    assert.ok(schedule.flattenSchedule(view.value.state).some(item => item.id === 'remote-new'));
    assert.equal(saves, 0);
  } finally { view.dispose(); }
});

test('offline page removals survive refresh and are not recovered as remote additions', async () => {
  const local = schedule.postSchedulePage(schedule.migrateSchedule([entry('removed')]));
  const storage = storageFor(local);
  let server = schedule.flattenSchedule(local);
  const offlineView = mount(storage, { load: async () => { throw new Error('offline'); }, save: async () => assert.fail('must read before saving') });
  await offlineView.flush();
  assert.equal(offlineView.value.commit(schedule.discardSchedulePage(offlineView.value.state, local.posted[0].id)), true);
  await offlineView.flush();
  offlineView.dispose();
  server = [...server, entry('remote-new')];
  const restored = mount(storage, { load: async () => server, save: async entries => { server = entries; } });
  try {
    await restored.flush();
    assert.ok(!server.some(item => item.id === 'removed'));
    assert.ok(server.some(item => item.id === 'remote-new'));
    assert.equal(restored.value.state.syncRemovedIds.length, 0);
  } finally { restored.dispose(); }
});

test('retry preserves an unsaved in-memory draft while reloading remote entries', async () => {
  const local = schedule.migrateSchedule([entry('local')]);
  const storage = storageFor(local);
  let offline = true;
  let server = [...schedule.flattenSchedule(local), entry('remote-new')];
  const view = mount(storage, {
    async load() { if (offline) throw new Error('offline'); return server; },
    async save(entries) { server = entries; },
  });
  try {
    await view.flush();
    storage.fail = true;
    const edited = structuredClone(view.value.state);
    edited.current.entries[0].content = '未能落盘的正文';
    view.value.commit(edited, { retainDraftOnError: true });
    await view.flush();
    storage.fail = false; offline = false;
    view.value.retry();
    await view.flush();
    assert.equal(server.find(item => item.id === 'local').content, '未能落盘的正文');
    assert.ok(server.some(item => item.id === 'remote-new'));
  } finally { view.dispose(); }
});

test('a failed remote save retries after loading remote additions', async () => {
  const local = schedule.migrateSchedule([entry('local')]);
  let failSave = true;
  let server = schedule.flattenSchedule(local);
  const view = mount(storageFor(local), {
    load: async () => server,
    async save(entries) { if (failSave) throw new Error('offline'); server = entries; },
  });
  try {
    await view.flush();
    const edited = structuredClone(view.value.state);
    edited.current.entries[0].title = '待同步修改';
    view.value.commit(edited, { retainDraftOnError: true });
    await view.flush();
    server = [...server, entry('remote-new')]; failSave = false;
    view.value.retry();
    await view.flush();
    assert.equal(server.find(item => item.id === 'local').title, '待同步修改');
    assert.ok(server.some(item => item.id === 'remote-new'));
  } finally { view.dispose(); }
});

test('consecutive native input commits merge against the latest draft, not a stale render', async () => {
  const storage = storageFor(schedule.migrateSchedule([entry('ime')]));
  const view = mount(storage);
  try {
    await view.flush();
    view.value.commit(current => schedule.patchScheduleTask(current, 'ime', { title: '中文输入' }), { retainDraftOnError: true });
    view.value.commit(current => schedule.patchScheduleTask(current, 'ime', { category: '生活' }), { retainDraftOnError: true });
    view.value.commit(current => ({ ...current, current: { ...current.current, date: '2027-05-06' } }), { retainDraftOnError: true });
    await view.flush();
    assert.equal(storage.read().current.entries[0].title, '中文输入');
    assert.equal(storage.read().current.entries[0].category, '生活');
    assert.equal(storage.read().current.date, '2027-05-06');
  } finally { view.dispose(); }
});

test('a failed placement write retains the paper at its original location', async () => {
  const state = schedule.migrateSchedule([entry('paper')]);
  const storage = storageFor(state), view = mount(storage);
  try {
    await view.flush(); storage.fail = true;
    const placement = { surface: 'desk', position: [0.6, 1.126, -2.3], rotation: 0 };
    assert.equal(view.value.commit(current => schedule.placeScheduleTask(current, 'paper', placement)), false);
    await view.flush();
    assert.equal(view.value.state.placements.paper, undefined);
    assert.equal(storage.read().placements.paper, undefined);
    assert.equal(view.value.state.current.entries[0].title, '任务 paper');
  } finally { view.dispose(); }
});
