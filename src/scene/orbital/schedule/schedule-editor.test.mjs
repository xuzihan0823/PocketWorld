import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as model from '../journal/bookModel.ts';
import { migrateSchedule } from './schedule.ts';

function mount({ left = false, leaf = 0 } = {}) {
  const hooks = [], changes = [], sfx = [];
  let cursor = 0, current = migrateSchedule().current;
  const element = (type, props) => ({ type, props });
  const dependencies = {
    react: { useState: value => [value, () => {}], useRef: value => hooks[cursor++] ?? (hooks[cursor - 1] = { current: value }) },
    'react/jsx-runtime': { jsx: element, jsxs: element },
    '@react-three/drei': { Html: 'Html' }, '../journal/bookModel': model,
    '../../audioEngine': { roomAudio: { playSfx: type => sfx.push(type) } },
  };
  const source = fs.readFileSync(new URL('./SchedulePageEditor.tsx', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const context = { exports: {}, require: name => dependencies[name] };
  vm.runInNewContext(compiled, context);
  const render = () => {
    cursor = 0;
    const tree = context.exports.SchedulePageEditor({ page: current, left, leaf, book: { current: { spread: left ? leaf + 1 : leaf } }, leafCount: 32, onGesture() {}, onChange: page => { current = page; changes.push(page); } });
    const fields = new Map();
    const visit = node => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!node?.props) return;
      if (node.props['aria-label']) fields.set(node.props['aria-label'], node.props);
      visit(node.props.children);
    };
    visit(tree);
    return fields;
  };
  return { render, changes, sfx, surfacePoint: context.exports.scheduleSurfacePoint, get current() { return current; } };
}
const valueEvent = value => ({ currentTarget: { value }, target: { value } });

test('each sheet exposes only its outward page-turn button and the current page can be torn', () => {
  const right = mount().render(), left = mount({ left: true }).render();
  assert.equal(right.has('日程上一页'), false);
  assert.equal(right.has('日程下一页'), true);
  assert.equal(right.has('撕掉这页'), true);
  assert.equal(left.has('左页日程上一页'), true);
  assert.equal(left.has('左页日程下一页'), false);
  assert.equal(left.has('左页撕掉这页'), false);
});

test('turned left-page fields follow the back surface and remain upright in printed reading order', () => {
  const { surfacePoint } = mount();
  for (const leaf of [0, 7, 30]) {
    const first = surfacePoint(leaf, true, 40, 240, leaf + 1, 32);
    const last = surfacePoint(leaf, true, 520, 240, leaf + 1, 32);
    assert.ok(first.position[0] < last.position[0]);
    assert.ok(last.position[0] < 0);
    assert.ok(Math.cos(first.angle) > 0 && Math.cos(last.angle) > 0);
    const right = surfacePoint(leaf + 1, false, 40, 240, leaf + 1, 32);
    assert.ok(right.position[0] > 0);
  }
});

test('left-page fields expose separate names and preserve Chinese edits across sections', () => {
  const editor = mount({ left: true }), fields = editor.render();
  const title = fields.get('左页第1项标题');
  title.onCompositionStart();
  title.onChange(valueEvent('zuoye'));
  assert.equal(editor.changes.length, 0);
  title.onCompositionEnd(valueEvent('左页任务'));
  fields.get('左页日程备注').onChange(valueEvent('保留在原页'));
  assert.equal(editor.current.entries[0].title, '左页任务');
  assert.equal(editor.current.notes, '保留在原页');
  assert.equal(fields.has('第1项标题'), false);
});

test('rapid edits across schedule fields retain each update before the next scene render', () => {
  const editor = mount(), fields = editor.render();
  fields.get('第1项标题').onChange(valueEvent('写完报告'));
  fields.get('待办1').onChange(valueEvent('买书'));
  fields.get('明日计划1').onChange(valueEvent('散步'));
  fields.get('日程备注').onChange(valueEvent('别忘了带伞'));
  assert.equal(editor.current.entries[0].title, '写完报告');
  assert.equal(editor.current.todos[0].text, '买书');
  assert.equal(editor.current.tomorrow[0], '散步');
  assert.equal(editor.current.notes, '别忘了带伞');
});

test('Chinese composition stays native until confirmed in every text section', () => {
  for (const label of ['第1项标题', '待办1', '明日计划1', '日程备注']) {
    const editor = mount(), field = editor.render().get(label);
    field.onCompositionStart();
    field.onChange(valueEvent('zhongwen'));
    assert.equal(editor.changes.length, 0, `${label} saved unconfirmed pinyin`);
    let stopped = false;
    field.onKeyDown({ nativeEvent: { isComposing: true }, keyCode: 229, stopPropagation() { stopped = true; } });
    assert.equal(stopped, true, `${label} leaked an IME key to scene shortcuts`);
    field.onCompositionEnd(valueEvent('中文'));
    assert.equal(editor.changes.length, 1);
    assert.ok(JSON.stringify(editor.current).includes('中文'));
    assert.ok(!JSON.stringify(editor.current).includes('zhongwen'));
  }
});

test('toggling a schedule todo checkbox plays paper-check SFX', () => {
  const editor = mount(), fields = editor.render();
  fields.get('完成待办1').onChange({ currentTarget: { checked: true } });
  assert.equal(editor.current.todos[0].completed, true);
  assert.deepEqual(editor.sfx, ['paper-check']);
});
