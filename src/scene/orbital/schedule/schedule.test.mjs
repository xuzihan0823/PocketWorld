import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import ts from 'typescript';

const source = fs.readFileSync(new URL('./schedule.ts', import.meta.url), 'utf8');
const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const context = { exports: {}, crypto: webcrypto };
vm.runInNewContext(output, context);
const { migrateSchedule, openSchedulePage, updateSchedulePage, turnSchedulePage, tearSchedulePage, discardSchedulePage, clearDiscardedPaper, createSchedulePage, isScheduleNotebook, flattenSchedule, readScheduleNotebook, SCHEDULE_KEY, PAPER_BALL_RADIUS, paperBallPosition, paperBallBoxes } = context.exports;
const entry = (id, time = '09:00') => ({ id, title: `任务 ${id}`, time, completed: false, content: `正文 ${id}` });

test('editing the turned left sheet updates its queued record without switching or overwriting the right sheet', () => {
  const first = migrateSchedule([entry('left')]);
  let state = turnSchedulePage(first, 1);
  state = updateSchedulePage(state, { ...state.current, notes: '右页备注' });
  state = updateSchedulePage(state, { ...state.queued[0], notes: '左页备注' });
  assert.equal(state.current.number, 2);
  assert.equal(state.current.notes, '右页备注');
  assert.equal(state.queued[0].id, first.current.id);
  assert.equal(state.queued[0].notes, '左页备注');
  assert.equal(turnSchedulePage(state, -1).current.notes, '左页备注');
});

test('reopening selects the first draft and tearing it advances to the next queued sheet', () => {
  let state = migrateSchedule([entry('first')]);
  const firstId = state.current.id;
  state = turnSchedulePage(state, 1);
  state.current.notes = '第二页的正文';
  const secondId = state.current.id;
  state = turnSchedulePage(state, 1);
  state.current.todos[2].text = '第三页待办';
  const lastId = state.current.id;
  const opened = openSchedulePage(state);
  assert.equal(opened.current.id, firstId);
  assert.equal(opened.queued.find(page => page.id === secondId).notes, '第二页的正文');
  assert.equal(opened.queued.find(page => page.id === lastId).todos[2].text, '第三页待办');
  assert.equal(openSchedulePage(opened), opened);
  const torn = tearSchedulePage(opened);
  assert.equal(torn.current.id, secondId);
  assert.equal(torn.discarded[0].id, firstId);
  assert.equal([torn.current, ...torn.queued].some(page => page.id === firstId), false);
});

test('turning forward and back preserves drafts and revisits the same next page', () => {
  const first = migrateSchedule([entry('first')]);
  first.current.todos[0].text = '今天的待办';
  first.current.notes = '第一页备注';
  assert.equal(turnSchedulePage(first, -1), first);
  const next = turnSchedulePage(first, 1);
  assert.equal(next.current.number, 2);
  assert.equal(next.current.notes, '');
  next.current.notes = '第二页备注';
  const previous = turnSchedulePage(next, -1);
  assert.equal(previous.current.id, first.current.id);
  assert.equal(previous.current.notes, '第一页备注');
  assert.equal(previous.current.todos[0].text, '今天的待办');
  assert.equal(turnSchedulePage(previous, 1).current.id, next.current.id);
  assert.equal(turnSchedulePage(previous, 1).current.notes, '第二页备注');
  const torn = tearSchedulePage(previous);
  assert.equal(torn.discarded[0].id, first.current.id);
  assert.equal(torn.current.id, next.current.id);
});

test('legacy schedules retain every task and completion when a planner fills up', () => {
  const legacy = Array.from({ length: 9 }, (_, i) => ({ ...entry(String(i)), completed: i === 1 }));
  let state = migrateSchedule(legacy);
  assert.equal(state.current.entries.length, 8);
  assert.equal(state.queued[0].entries[0].id, '8');
  state = tearSchedulePage(state);
  assert.equal(state.discarded[0].seed, 1);
  assert.equal(state.current.entries[0].content, '正文 8');
  assert.equal(state.current.number, 2);
  assert.equal(legacy.length, 9);
});

test('tearing removes the current sheet into a paper ball and keeps drafts moving forward', () => {
  let state = migrateSchedule(Array.from({ length: 9 }, (_, i) => entry(`t${i}`)));
  const firstId = state.current.id;
  const secondId = state.queued[0].id;
  state = tearSchedulePage(state);
  assert.equal(state.discarded.length, 1);
  assert.equal(state.discarded[0].id, firstId);
  assert.equal(state.discarded[0].seed, 1);
  assert.equal(state.current.id, secondId);
  assert.equal(state.queued.length, 0);
  assert.equal([state.current, ...state.queued].some(page => page.id === firstId), false);
  const tornId = state.current.id;
  state = tearSchedulePage(state);
  assert.equal(state.discarded.length, 2);
  assert.equal(state.current.number, 3);
  assert.equal(state.current.id !== tornId, true);
  assert.equal(state.current.entries.every(item => !item.title), true);
  assert.equal(isScheduleNotebook(JSON.parse(JSON.stringify(state))), true);
});

test('tearing leaves legacy glass posters untouched and bounds the paper-ball litter', () => {
  let state = migrateSchedule([entry('a')]);
  state.posted = Array.from({ length: 6 }, (_, i) => createSchedulePage(10 + i));
  const posters = JSON.stringify(state.posted);
  for (let i = 0; i < 30; i++) state = tearSchedulePage(state);
  assert.equal(JSON.stringify(state.posted), posters);
  assert.equal(state.discarded.length, 24);
  assert.equal(state.current.number > 15, true);
  assert.equal(isScheduleNotebook(JSON.parse(JSON.stringify(state))), true);
});

test('cleaning sweeps all loose paper balls but keeps the notebook sheets', () => {
  let state = migrateSchedule([entry('clean')]);
  state.posted = [createSchedulePage(4)];
  state = tearSchedulePage(state);
  state = discardSchedulePage(state, state.posted[0].id);
  assert.equal(state.discarded.length, 2);
  const currentId = state.current.id;
  const postedCount = state.posted.length;
  const cleared = clearDiscardedPaper(state);
  assert.equal(cleared.discarded.length, 0);
  assert.equal(cleared.current.id, currentId);
  assert.equal(cleared.posted.length, postedCount);
  assert.equal(clearDiscardedPaper(cleared), cleared);
});

test('v1 notebook migration preserves page identity, old text and the original storage value', () => {
  const oldPage = { id: 'old-page', number: 3, date: '2026-11-15', entries: [entry('old-a'), { ...entry('old-b'), completed: true }] };
  const old = { version: 1, current: oldPage, posted: [{ ...oldPage, id: 'posted-page' }], queued: [], discarded: [{ id: 'ball', seed: 2 }], syncPending: true, syncRemovedIds: ['removed'] };
  const original = JSON.stringify(old);
  const values = new Map([['pocketworld:schedule:notebook:v1', original]]);
  const upgraded = readScheduleNotebook({ getItem: key => values.get(key) ?? null });
  assert.equal(upgraded.version, 3);
  assert.equal(upgraded.current.id, 'old-page');
  assert.equal(upgraded.current.entries[0].content, '正文 old-a');
  assert.equal(upgraded.current.entries[1].completed, true);
  assert.equal(upgraded.posted[0].id, 'posted-page');
  assert.equal(upgraded.current.todos.length, 3);
  assert.equal(upgraded.current.tomorrow.length, 2);
  assert.equal(upgraded.discarded[0].id, 'ball');
  assert.equal(upgraded.syncRemovedIds[0], 'removed');
  assert.equal(values.get('pocketworld:schedule:notebook:v1'), original);
  assert.equal(isScheduleNotebook(upgraded), true);
  values.set(SCHEDULE_KEY, JSON.stringify({ ...upgraded, current: { ...upgraded.current, notes: '新版草稿' } }));
  assert.equal(readScheduleNotebook({ getItem: key => values.get(key) ?? null }).current.notes, '新版草稿');
});

test('reducing planner density moves filled overflow to queued pages without losing old content', () => {
  const oldPage = {
    id: 'busy-page', number: 4, date: '2026-11-15',
    entries: Array.from({ length: 17 }, (_, i) => entry(`busy-${i}`)),
    todos: Array.from({ length: 8 }, (_, i) => ({ text: `旧待办${i}`, completed: i === 7 })),
    tomorrow: ['明日一', '明日二', '明日三', '明日四'], notes: '原来的备注',
  };
  const original = JSON.stringify({ version: 2, current: oldPage, posted: [], queued: [], discarded: [] });
  const values = new Map([['pocketworld:schedule:notebook:v2', original]]);
  const state = readScheduleNotebook({ getItem: key => values.get(key) ?? null });
  assert.equal(state.current.id, 'busy-page');
  assert.equal(state.current.entries.length, 8);
  assert.equal(state.current.todos.length, 3);
  assert.equal(state.current.tomorrow.length, 2);
  assert.equal(state.current.notes, '原来的备注');
  const pages = JSON.parse(JSON.stringify([state.current, ...state.queued]));
  for (const oldEntry of oldPage.entries) assert.deepEqual(pages.flatMap(page => page.entries).find(item => item.id === oldEntry.id), oldEntry);
  for (const todo of oldPage.todos) assert.deepEqual(pages.flatMap(page => page.todos).find(item => item.text === todo.text), todo);
  assert.equal(pages.flatMap(page => page.tomorrow).filter(Boolean).length, 4);
  assert.equal(state.queued[0].number, 5);
  assert.equal(state.queued[1].number, 6);
  assert.equal(values.get('pocketworld:schedule:notebook:v2'), original);
  assert.equal(isScheduleNotebook(state), true);
});

test('empty legacy rows are removed when reducing density rather than creating empty overflow pages', () => {
  const original = JSON.stringify({ version: 2, current: {
    id: 'empty-old', number: 1, date: '2026-11-15',
    entries: Array.from({ length: 17 }, (_, i) => ({ id: `empty-${i}`, title: '', content: '', completed: false, time: `${String(i + 6).padStart(2, '0')}:00` })),
    todos: Array.from({ length: 8 }, () => ({ text: '', completed: false })), tomorrow: ['', '', '', ''], notes: '',
  }, posted: [], queued: [], discarded: [] });
  const state = readScheduleNotebook({ getItem: key => key === 'pocketworld:schedule:notebook:v2' ? original : null });
  assert.equal(state.current.entries.length, 8);
  assert.equal(state.current.todos.length, 3);
  assert.equal(state.queued.length, 0);
  assert.equal(state.current.entries.every(item => !item.title && !item.content), true);
});

test('corrupt new planner storage does not silently fall back and overwrite saved content', () => {
  const storage = { getItem: key => key === SCHEDULE_KEY ? '{broken' : null };
  assert.throws(() => readScheduleNotebook(storage));
  const state = migrateSchedule();
  state.current.todos = [];
  assert.equal(isScheduleNotebook(state), false);
});

test('older over-capacity glass saves remain readable and survive tearing', () => {
  let state = migrateSchedule([entry('current')]);
  state.posted = Array.from({ length: 10 }, (_, i) => migrateSchedule([entry(`old-${i}`)]).current);
  assert.equal(isScheduleNotebook(JSON.parse(JSON.stringify(state))), true);
  const posters = JSON.stringify(state.posted);
  state = tearSchedulePage(state);
  assert.equal(JSON.stringify(state.posted), posters);
  assert.equal(isScheduleNotebook(JSON.parse(JSON.stringify(state))), true);
});

test('discard targets one poster, retains the current draft and bounds physical litter', () => {
  let state = migrateSchedule([entry('a')]);
  for (let i = 0; i < 30; i++) {
    const poster = { ...createSchedulePage(i + 10), id: `poster-${i}` };
    state = { ...state, posted: [poster] };
    const currentId = state.current.id;
    state = discardSchedulePage(state, poster.id);
    assert.equal(state.current.id, currentId);
    assert.equal(state.posted.length, 0);
    assert.equal(discardSchedulePage(state, poster.id), state);
  }
  assert.equal(state.discarded.length, 24);
});

test('storage rejects malformed pages and duplicate identities without truncating long text', () => {
  const state = migrateSchedule([entry('a')]);
  state.current.entries[0].content = '长正文'.repeat(200);
  assert.equal(isScheduleNotebook(JSON.parse(JSON.stringify(state))), true);
  assert.equal(flattenSchedule(state)[0].content.length, 600);
  assert.equal(isScheduleNotebook({ ...state, current: { ...state.current, entries: [] } }), false);
  assert.equal(isScheduleNotebook({ ...state, posted: [state.current] }), false);
  assert.equal(isScheduleNotebook({ ...state, discarded: [{ id: 'bad', seed: NaN }] }), false);
  assert.equal(isScheduleNotebook({ ...state, syncRemovedIds: ['removed-task'] }), true);
  assert.equal(isScheduleNotebook({ ...state, syncRemovedIds: [123] }), false);
});

test('paper-ball colliders sit on the same floor spot as the rendered crumples', () => {
  const seed = 9;
  const [x, y, z] = paperBallPosition(seed);
  assert.equal(y, 0.105);
  assert.deepEqual(JSON.parse(JSON.stringify(paperBallBoxes([{ id: 'ball', seed }]))),
    [[x - PAPER_BALL_RADIUS, x + PAPER_BALL_RADIUS, z - PAPER_BALL_RADIUS, z + PAPER_BALL_RADIUS]]);
  assert.equal(PAPER_BALL_RADIUS, 0.08);
  assert.deepEqual(JSON.parse(JSON.stringify(paperBallBoxes([{ id: 'ball', seed }], 0.23)[0])), [x - 0.31, x + 0.31, z - 0.31, z + 0.31]);
  assert.deepEqual(paperBallBoxes([]), []);
});
