import * as assetQueue from '../assetQueue.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { webcrypto } from 'node:crypto';
function fixture({ fail = false } = {}) {
  const memory = new Map(); let tail = Promise.resolve();
  const storage = { getItem: k => memory.get(k) ?? null, setItem(k, v) { if (fail) throw new Error('QuotaExceededError'); memory.set(k, v); } };
  const globals = { TextEncoder, TextDecoder, crypto: webcrypto, localStorage: storage, navigator: { locks: { request: (_, fn) => { const next = tail.then(fn); tail = next.catch(() => {}); return next; } } } };
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL('./catalog.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports, ...globals });
  return { ...exports, globals, memory, storage };
}
test('十八个标准书位具有独立受支撑空间，不越过层板和柜壁', () => {
  const m = fixture(); assert.equal(m.BOOK_SLOTS.length, 18); assert.equal(new Set(m.BOOK_SLOTS.map(s => s.id)).size, 18);
  for (const s of m.BOOK_SLOTS) { assert.ok(Math.abs(s.position[0]) + m.BOOK_SIZE.thickness / 2 < .51); assert.ok(s.position[1] + m.BOOK_SIZE.height / 2 < [ .9025, 1.1925, 1.51 ][s.row]); }
});
test('三本内置书各至少六页，页码间与书籍间正文各异', () => {
  const m = fixture(), books = m.BUILTIN_BOOKS.map(b => m.paginate(b.text, 330, 16, () => 16)), pages = books.flat();
  assert.ok(books.every(pages => pages.length >= 6));
  assert.equal(new Set(pages.map(p => p.text)).size, pages.length);
});
test('最后一片叶子内置完整中文正文，保留三本书的身份和书位', () => {
  const m = fixture(), books = m.BUILTIN_BOOKS, book = books[0];
  assert.equal(books.length, 3);
  assert.equal(books.map(b => b.id).join(), 'book-01,book-02,book-03');
  assert.equal(books.map(b => b.title).join(), '最后一片叶子,窗外的地球,微光旅行札记');
  assert.equal(book.author, '欧·亨利 · 中文自译');
  assert.equal(book.slotId, 's1-1');
  assert.equal(book.source, 'builtin');
  assert.ok(book.text.startsWith('华盛顿广场以西'));
  assert.ok(book.text.includes('画那不勒斯湾'));
  assert.ok(book.text.includes('一架被挪过地方的梯子'));
  assert.ok(book.text.endsWith('在最后一片叶子落下的那个夜晚，他把它画在了那里。”'));
  assert.equal(book.text.split('\n\n').length, 55);
  for (const width of [180, 330, 600]) {
    const pages = m.paginate(book.text, width, 16, () => 16);
    assert.equal(pages.map(page => page.text).join(''), book.text);
    assert.equal(pages.at(-1).end, book.text.length);
  }
});
test('已有存档更新内置正文，只重置被换书的书签，读取不覆盖存储', async () => {
  const m = fixture(), data = m.freshLibrary();
  Object.assign(data.books[0], { title: '轨道上的日常', author: 'PocketWorld · 原创', text: '旧版内置正文'.repeat(40), anchor: 120 });
  data.books[1].anchor = 60; data.books[2].anchor = 90;
  data.books.push({ ...m.makeUserBook(data, '轨道上的日常', '访客', '自添书正文，不应因同名而被替换。'), anchor: 5 });
  data.revision = 8;
  const saved = JSON.stringify(data); m.storage.setItem(m.LIBRARY_KEY, saved);
  const next = m.readLibrary(m.storage);
  assert.equal(JSON.stringify(next.books[0]), JSON.stringify(m.BUILTIN_BOOKS[0]));
  assert.equal(JSON.stringify(next.books.slice(1)), JSON.stringify(data.books.slice(1)));
  assert.equal(next.revision, 8);
  assert.equal(m.storage.getItem(m.LIBRARY_KEY), saved);
  const persisted = await m.mutateLibrary(value => ({ ...value, books: value.books.map(book => book.id === 'book-01' ? { ...book, anchor: 300 } : book) }));
  assert.equal(persisted.revision, 9);
  assert.equal(m.readLibrary(m.storage).books[0].anchor, 300);
  assert.equal(JSON.stringify(m.readLibrary(m.storage)), JSON.stringify(persisted));
});
test('内置书仅署名变化时更新元数据但保留阅读锚点', () => {
  const m = fixture(), data = m.freshLibrary();
  data.books[0].author = '旧署名'; data.books[0].anchor = 300;
  m.storage.setItem(m.LIBRARY_KEY, JSON.stringify(data));
  const next = m.readLibrary(m.storage);
  assert.equal(next.books[0].author, m.BUILTIN_BOOKS[0].author);
  assert.equal(next.books[0].anchor, 300);
});
test('默认书在中间层相邻摆放，旧存档保留正文和书签且读取不写存储', () => {
  const m = fixture(), data = m.freshLibrary();
  for (const [i, book] of data.books.entries()) { book.slotId = `s${i}-2`; book.anchor = 20 + i; }
  data.revision = 7;
  const saved = JSON.stringify(data); m.storage.setItem(m.LIBRARY_KEY, saved);
  const next = m.readLibrary(m.storage);
  assert.equal(next.books.map(book => book.slotId).join(), 's1-1,s1-2,s1-3');
  assert.equal(next.revision, 7);
  for (const [i, book] of next.books.entries()) { assert.equal(book.anchor, 20 + i); assert.equal(book.text, data.books[i].text); }
  assert.equal(m.storage.getItem(m.LIBRARY_KEY), saved);
  assert.equal(m.freshLibrary().books.map(book => book.slotId).join(), 's1-1,s1-2,s1-3');
});
test('满柜迁移只挪动占用默认新书位的自添书，不丢书且保存后布局稳定', async () => {
  const m = fixture(), data = m.freshLibrary();
  data.books.forEach((book, i) => { book.slotId = `s${i}-2`; });
  for (let i = 0; i < 15; i++) data.books.push({ ...m.makeUserBook(data, `自添 ${i}`, '访客', `正文 ${i}`), anchor: 2 });
  m.storage.setItem(m.LIBRARY_KEY, JSON.stringify(data));
  const migrated = m.readLibrary(m.storage);
  assert.equal(migrated.books.length, 18);
  assert.equal(new Set(migrated.books.map(book => book.slotId)).size, 18);
  for (const previous of data.books.filter(book => book.source === 'user')) {
    const next = migrated.books.find(book => book.id === previous.id);
    assert.equal(JSON.stringify({ ...next, slotId: previous.slotId }), JSON.stringify(previous));
    if (!['s1-1', 's1-3'].includes(previous.slotId)) assert.equal(next.slotId, previous.slotId);
  }
  const saved = await m.mutateLibrary(value => value);
  assert.equal(saved.revision, data.revision + 1);
  assert.equal(JSON.stringify(m.readLibrary(m.storage)), JSON.stringify(saved));
});
test('长段落、英文长词、换行和代理对重新分页不丢字，书签锚点可重定位', () => {
  const m = fixture(), text = '开头\n\n' + 'abc无空格🙂'.repeat(500) + '\n结尾';
  for (const width of [30, 150, 420]) { const pages = m.paginate(text, width, 5, () => 16); assert.equal(pages.map(p => p.text).join(''), text); assert.equal(pages[0].start, 0); assert.equal(pages.at(-1).end, text.length); assert.ok(pages.every(p => !/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(p.text))); }
  const a = m.paginate(text, 150, 5, () => 16)[12].start, next = m.paginate(text, 300, 5, () => 16); assert.equal(next.filter(p => p.start <= a && p.end > a).length, 1);
});
test('最后一个空位同时提交：只成功一本，无覆盖、无重复书位', async () => {
  const m = fixture(); let data = m.freshLibrary();
  for (let i = 0; i < 14; i++) data.books.push(m.makeUserBook(data, `书 ${i}`, '', `正文 ${i}`));
  m.storage.setItem(m.LIBRARY_KEY, JSON.stringify(data));
  const add = name => m.mutateLibrary(d => ({ ...d, books: [...d.books, m.makeUserBook(d, name, '', name)] }));
  const results = await Promise.allSettled([add('甲'), add('乙')]); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const actual = m.readLibrary(m.storage); assert.equal(actual.books.length, 18); assert.equal(new Set(actual.books.map(b => b.slotId)).size, 18); assert.equal(actual.books.slice(0, 17).map(b => b.title).join(), data.books.map(b => b.title).join());
});
test('拒绝空正文、重复内容、超字节上限和超合计，失败不占书位', () => {
  const m = fixture(), d = m.freshLibrary();
  assert.throws(() => m.makeUserBook(d, '空', '', ' \n ')); assert.throws(() => m.makeUserBook(d, '重复', '', d.books[0].text)); assert.throws(() => m.makeUserBook(d, '大', '', '字'.repeat(45000)));
  for (let i = 0; i < 4; i++) d.books.push(m.makeUserBook(d, `长文${i}`, '', `${i}` + 'x'.repeat(131070)));
  assert.throws(() => m.makeUserBook(d, '超合计', '', '长'.repeat(5))); assert.equal(d.books.length, 7);
});
test('存储异常、坏数据和未授权状态都保留原始记录', async () => {
  const m = fixture({ fail: true }); await assert.rejects(m.mutateLibrary(d => d), /存储/); assert.equal(m.memory.size, 0);
  const n = fixture(); n.memory.set(n.LIBRARY_KEY, '{broken'); await assert.rejects(n.mutateLibrary(d => d), /解析/); assert.equal(n.memory.get(n.LIBRARY_KEY), '{broken');
  const p = fixture(); await assert.rejects(p.mutateLibrary(d => d, () => false), /选书状态/); assert.equal(p.memory.size, 0);
});
test('移除用户书释放原书位，其他内容、进度及刷新恢复保持一致', async () => {
  const m = fixture(); let d = m.freshLibrary(); const b = m.makeUserBook(d, '一本', '', '第一段\n\n第二段'); d.books.push({ ...b, anchor: 5 }); d.books[0].anchor = 50; m.storage.setItem(m.LIBRARY_KEY, JSON.stringify(d));
  assert.equal(m.readLibrary(m.storage).books.at(-1).anchor, 5);
  await m.mutateLibrary(d => ({ ...d, books: d.books.filter(x => x.id !== b.id) }));
  const next = await m.mutateLibrary(d => ({ ...d, books: [...d.books, m.makeUserBook(d, '另一本', '', '另一段')] }));
  assert.equal(next.books.at(-1).slotId, b.slotId); assert.equal(next.books[0].anchor, 50); assert.equal(next.books.filter(x => x.id === b.id).length, 0);
});
function controller(reducedMotion = false) {
  const m = fixture(), effects = [], errors = [], actions = [], frames = [], sfx = [];
  const react = { useRef: current => ({ current }), useState: v => [typeof v === 'function' ? v() : v, () => {}], useCallback: fn => fn, useEffect: fn => effects.push(fn) };
  const dependencies = { react, three: THREE, '../assetQueue.ts': assetQueue, './catalog': m, '../../audioEngine': { roomAudio: { playSfx: type => sfx.push(type) } } };
  const loadModule = filename => {
    const exports = {};
    const require = name => {
      if (!(name in dependencies)) throw new Error('Missing controller fixture dependency: ' + name);
      return dependencies[name];
    };
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(new URL(filename, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText, { exports, ...m.globals, require, window: { addEventListener() {}, removeEventListener() {}, setTimeout: fn => fn(), clearTimeout() {} } });
    return exports;
  };
  dependencies['../residentRig'] = loadModule('../residentRig.ts');
  dependencies['./pageTurnFrames'] = loadModule('./pageTurnFrames.ts');
  dependencies['./bookMotion'] = loadModule('./bookMotion.ts');
  dependencies['./cardiganPickup'] = loadModule('./cardiganPickup.ts');
  dependencies['./libraryMotion'] = loadModule('./libraryMotion.ts');
  const c = loadModule('./useLibrary.ts').useLibrary({ sceneId: 'habitat', reducedMotion, onAction: a => actions.push(a), onReturn: () => actions.push('return'), error: s => errors.push(s) }); effects.forEach(fn => fn());
  const advance = () => { for (let i = 0; i < 250; i++) { if (['approach', 'reading', 'catalog', 'align', 'recenter', 'idle'].includes(c.flow.current.phase)) break; c.tick(.04); } };
  const enter = (itemId) => {
    c.dispatch({ sceneId: 'habitat', objectId: 'book-01', kind: 'read', payload: { itemId } });
    advance();
    assert.equal(c.flow.current.phase, 'approach');
    c.arrived();
  };
  const open = id => { c.choose(id); c.arrived(); c.setPages([{ start: 0, end: 10, text: '首页' }, { start: 10, end: 20, text: '末页' }]); advance(); };
  return { c, m, errors, actions, sfx, advance, enter, open };
}
test('直接触发添加不能绕过状态校验；表单保存成功才生成实体书', async () => {
  const { c, enter } = controller(); await assert.rejects(c.add('绕过', '', '正文'), /表单/); enter(); assert.equal(c.flow.current.phase, 'catalog'); c.openForm(); await c.add('新书', '', '正文'); assert.equal(c.flow.current.phase, 'shelving');
});
test('抵达书柜即开始取指定书，归还后可退出并继续待处理的动作', () => {
  const { c, enter, advance, actions } = controller();
  enter('book-01');
  assert.equal(c.flow.current.phase, 'align');
  assert.equal(c.flow.current.book.id, 'book-01');
  c.arrived();
  advance();
  assert.equal(c.flow.current.phase, 'reading');
  const nextAction = { sceneId: 'habitat', objectId: 'lamp', kind: 'toggle' };
  c.dispatch(nextAction);
  advance();
  assert.equal(c.flow.current.phase, 'recenter');
  c.arrived();
  assert.equal(c.flow.current.phase, 'idle');
  assert.deepEqual(actions.slice(-2), ['return', nextAction]);
  enter();
  assert.equal(c.flow.current.phase, 'catalog');
  c.back();
  assert.equal(c.flow.current.phase, 'idle');
});
for (const reducedMotion of [false, true]) test(`翻页边界、连点、动画中 Esc 不跳页，换书先还后取且记住独立锚点（${reducedMotion ? '减少动态效果' : '普通'}）`, async () => {
  const { c, m, enter, open, advance, actions } = controller(reducedMotion); enter(); open('book-01'); assert.equal(c.flow.current.phase, 'reading'); c.turn(-1); assert.equal(c.flow.current.phase, 'reading');
  c.turn(1); for (let i = 0; i < 20; i++) c.turn(i % 2 ? 1 : -1); assert.equal(c.flow.current.phase, 'turn'); advance(); assert.equal(c.flow.current.page, 1); c.turn(1); assert.equal(c.flow.current.phase, 'reading');
  c.turn(-1); c.back(); advance(); assert.equal(c.flow.current.phase, 'recenter'); c.arrived(); assert.equal(c.flow.current.phase, 'catalog'); assert.equal(actions.includes('return'), false);
  open('book-01'); c.choose('book-02'); assert.equal(c.flow.current.book.id, 'book-01'); advance(); c.arrived(); assert.equal(c.flow.current.book.id, 'book-02'); assert.equal(c.flow.current.phase, 'align');
});

test('书柜取书、展开、翻页、合书、插回及新书上架按阶段触发对应音效', async () => {
  const { c, sfx, enter, open, advance } = controller();
  enter();
  open('book-01');
  c.turn(1);
  advance();
  c.back();
  advance();
  c.arrived();
  assert.deepEqual(sfx, ['book-extract', 'book-open', 'paper', 'book-close', 'book-insert']);
  sfx.length = 0;
  c.openForm();
  await c.add('有声藏书', '测试', '正文内容');
  assert.deepEqual(sfx, ['book-shelf-add']);
  assert.deepEqual(sfx, ['book-shelf-add']);
});

test('本地上传解析支持 UTF-8 .txt 与 .md，并严格拦截格式、编码、容量及满柜', () => {
  const m = fixture();
  let d = m.freshLibrary();
  const cap0 = m.remainingBookCapacity(d);
  assert.equal(cap0.slotsLeft, 15);
  assert.equal(cap0.bytesLeft, m.TOTAL_LIMIT);
  assert.equal(cap0.canAdd, true);

  const mdBytes = new TextEncoder().encode('\uFEFF# 第一章\r\n\r\n窗外的星海。');
  const parsedMd = m.parseBookFileBytes({ name: '星海手记.MD', buffer: mdBytes }, d);
  assert.equal(parsedMd.title, '星海手记');
  assert.equal(parsedMd.text, '# 第一章\n\n窗外的星海。');
  assert.equal(parsedMd.bytes, m.byteLength('# 第一章\n\n窗外的星海。'));

  const parsedTxt = m.parseBookFileBytes({ name: '短篇.txt', buffer: new TextEncoder().encode('一页故事。') }, d);
  assert.equal(parsedTxt.title, '短篇');

  assert.match(m.validateBookFileMeta({ name: 'book.pdf', size: 120 }, d), /\.txt 或 \.md/);
  assert.match(m.validateBookFileMeta({ name: 'empty.txt', size: 0 }, d), /空/);
  assert.match(m.validateBookFileMeta({ name: 'huge.txt', size: m.INPUT_LIMIT * 4 + 1 }, d), /128 KiB/);

  assert.throws(() => m.parseBookFileBytes({ name: 'bad.md', buffer: new Uint8Array([0xff, 0xfe]) }, d), /UTF-8/);
  assert.throws(() => m.parseBookFileBytes({ name: 'nul.txt', buffer: new TextEncoder().encode('abc\0def') }, d), /UTF-8/);
  assert.throws(() => m.parseBookFileBytes({ name: 'blank.md', buffer: new TextEncoder().encode('  \n\t ') }, d), /空/);
  assert.throws(() => m.parseBookFileBytes({ name: 'dup.txt', buffer: new TextEncoder().encode(d.books[0].text) }, d), /已在书柜中/);
  assert.throws(() => m.parseBookFileBytes({ name: 'over.txt', buffer: new TextEncoder().encode('a'.repeat(m.INPUT_LIMIT + 1)) }, d), /128 KiB/);

  // 18 槽满柜拦截
  for (let i = 0; i < 15; i++) d.books.push(m.makeUserBook(d, `自添 ${i}`, '', `自添正文 ${i}`));
  const fullSlots = m.remainingBookCapacity(d);
  assert.equal(fullSlots.slotsLeft, 0);
  assert.equal(fullSlots.canAdd, false);
  assert.match(m.validateBookFileMeta({ name: 'next.txt', size: 16 }, d), /书柜已满（18\/18）/);
  assert.throws(() => m.parseBookFileBytes({ name: 'next.md', buffer: new TextEncoder().encode('第 19 本') }, d), /18\/18/);

  // 512 KiB 空间上限拦截
  let dSpace = m.freshLibrary();
  for (let i = 0; i < 4; i++) dSpace.books.push(m.makeUserBook(dSpace, `大书 ${i}`, '', `${i}` + 'x'.repeat(131071)));
  const fullSpace = m.remainingBookCapacity(dSpace);
  assert.equal(fullSpace.bytesLeft, 0);
  assert.equal(fullSpace.canAdd, false);
  assert.match(m.validateBookFileMeta({ name: 'more.md', size: 16 }, dSpace), /512 \/ 512 KiB/);
});

test('书柜满槽后 openForm 被拦截并报告满柜原因', async () => {
  const { c, m, errors, enter } = controller();
  enter();
  for (let i = 0; i < 15; i++) {
    assert.equal(c.openForm(), true);
    await c.add(`自添 ${i}`, '', `内容 ${i}`);
    // 手动回到 catalog 阶段以继续下一本
    c.flow.current.phase = 'catalog';
  }
  assert.equal(c.openForm(), false);
  assert.equal(c.flow.current.phase, 'catalog');
  assert.match(errors.at(-1), /18\/18/);
  assert.equal(m.readLibrary(m.storage).books.length, 18);
});
