import * as assetQueue from '../assetQueue.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { webcrypto } from 'node:crypto';

const catalogSource = fs.readFileSync(new URL('./catalog.ts', import.meta.url), 'utf8');
const useLibrarySource = fs.readFileSync(new URL('./useLibrary.ts', import.meta.url), 'utf8');
const surfaceSource = fs.readFileSync(new URL('./LibrarySurface.tsx', import.meta.url), 'utf8');

function transpile(source) {
  return ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true, target: ts.ScriptTarget.ES2020 },
  }).outputText;
}

function mountLibrarySurface({ initialUserBooks = [], userBookByteFiller = false } = {}) {
  const memory = new Map();
  let lockTail = Promise.resolve();
  const storage = {
    getItem: key => memory.get(key) ?? null,
    setItem: (key, value) => memory.set(key, value),
  };
  const globals = {
    TextEncoder,
    TextDecoder,
    crypto: webcrypto,
    localStorage: storage,
    navigator: {
      locks: {
        request: (_, fn) => {
          const next = lockTail.then(fn);
          lockTail = next.catch(() => {});
          return next;
        },
      },
    },
  };

  const catalog = {};
  vm.runInNewContext(transpile(catalogSource), { exports: catalog, ...globals });

  if (initialUserBooks.length || userBookByteFiller) {
    const data = catalog.freshLibrary();
    for (const item of initialUserBooks) {
      data.books.push(catalog.makeUserBook(data, item.title, item.author ?? '', item.text));
    }
    if (userBookByteFiller) {
      for (let i = 0; i < 4; i++) {
        data.books.push(catalog.makeUserBook(data, `大卷 ${i}`, '', `${i}` + 'x'.repeat(131071)));
      }
    }
    storage.setItem(catalog.LIBRARY_KEY, JSON.stringify(data));
  }

  const slots = [];
  let cursor = 0, dirty = true, tree = null;
  const effects = [];
  const errors = [];

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
    useMemo(factory, deps) {
      const index = cursor++;
      if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: factory() };
      return slots[index].value;
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
    useLayoutEffect() {},
  };
  const react = {
    ...hooks,
    Fragment: Symbol.for('react.fragment'),
    createElement: (type, props, ...children) => ({ type, props: { ...props, children } }),
  };

  const windowTarget = new EventTarget();
  Object.assign(windowTarget, {
    setTimeout: fn => { fn(); return 1; },
    clearTimeout() {},
  });
  const docTarget = new EventTarget();

  const deps = {
    react,
    three: THREE,
    '../assetQueue.ts': assetQueue,
    './catalog': catalog,
    '../../audioEngine': { roomAudio: { playSfx() {} } },
    './library.css': {},
  };
  const load = source => {
    const exports = {};
    vm.runInNewContext(transpile(source), {
      exports,
      ...globals,
      window: windowTarget,
      document: docTarget,
      require(name) {
        if (name in deps) return deps[name];
        throw new Error(`Unexpected dependency: ${name}`);
      },
    });
    return exports;
  };
  deps['../residentRig'] = load(fs.readFileSync(new URL('../residentRig.ts', import.meta.url), 'utf8'));
  deps['./pageTurnFrames'] = load(fs.readFileSync(new URL('./pageTurnFrames.ts', import.meta.url), 'utf8'));
  deps['./bookMotion'] = load(fs.readFileSync(new URL('./bookMotion.ts', import.meta.url), 'utf8'));
  deps['./cardiganPickup'] = load(fs.readFileSync(new URL('./cardiganPickup.ts', import.meta.url), 'utf8'));
  deps['./libraryMotion'] = load(fs.readFileSync(new URL('./libraryMotion.ts', import.meta.url), 'utf8'));
  const { useLibrary } = load(useLibrarySource);
  const { LibrarySurface } = load(surfaceSource);

  let controllerRef;
  function Harness() {
    controllerRef = useLibrary({
      sceneId: 'habitat',
      reducedMotion: true,
      onAction() {},
      onReturn() {},
      error: msg => errors.push(msg),
    });
    return LibrarySurface({ library: controllerRef });
  }

  function nodes(node = tree) {
    if (!node || typeof node !== 'object') return [];
    if (Array.isArray(node)) return node.flatMap(nodes);
    return [node, ...nodes(node.props?.children)];
  }
  function textContent(node) {
    if (node == null || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(textContent).join('');
    return textContent(node.props?.children);
  }
  function attachInputRef() {
    const fileInput = nodes().find(n => n.type === 'input' && n.props?.type === 'file');
    if (fileInput?.props?.ref && !fileInput.props.ref.current) {
      fileInput.props.ref.current = { value: '', click() {} };
    }
  }
  function render() {
    for (let round = 0; dirty; round++) {
      assert.ok(round < 25, 'effects must settle');
      dirty = false;
      cursor = 0;
      tree = Harness();
      attachInputRef();
      effects.splice(0).forEach(effect => effect());
    }
    return tree;
  }

  render();
  // 进入书柜目录界面
  controllerRef.dispatch({ sceneId: 'habitat', objectId: 'book-01', kind: 'read' });
  for (let i = 0; i < 60 && controllerRef.flow.current.phase !== 'approach'; i++) controllerRef.tick(0.05);
  controllerRef.arrived();
  render();
  assert.equal(controllerRef.flow.current.phase, 'catalog');

  const find = predicate => nodes().find(predicate);
  const findAll = predicate => nodes().filter(predicate);
  const makeFile = (name, content) => {
    const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(content);
    return {
      name,
      size: bytes.byteLength,
      async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); },
    };
  };

  return {
    catalog,
    storage,
    errors,
    controller: () => controllerRef,
    render,
    nodes,
    find,
    findAll,
    textContent,
    makeFile,
    async chooseFile(file) {
      const input = find(n => n.type === 'input' && n.props?.type === 'file');
      assert.ok(input, 'file input must exist in form');
      input.props.onChange({ target: { files: [file] } });
      await new Promise(resolve => setImmediate(resolve));
      render();
    },
    async dropFiles(files) {
      const section = find(n => n.type === 'section');
      section.props.onDragEnter({
        stopPropagation() {},
        preventDefault() {},
        dataTransfer: { types: ['Files'] },
      });
      render();
      section.props.onDrop({
        preventDefault() {},
        stopPropagation() {},
        dataTransfer: { files, types: ['Files'] },
      });
      await new Promise(resolve => setImmediate(resolve));
      render();
    },
    dispose() { slots.forEach(slot => slot.cleanup?.()); },
  };
}

test('书柜添加改为纯本地文件上传表单，不含正文 textarea 且支持 .md 上传上架', async () => {
  const ui = mountLibrarySurface();
  try {
    const capText = ui.textContent(ui.find(n => n.type === 'p' && n.props?.className === 'library-capacity'));
    assert.match(capText, /已放 3 \/ 18 本/);
    assert.match(capText, /自添 0 \/ 15 本/);

    const openBtn = ui.find(n => n.type === 'button' && n.props?.className === 'library-primary');
    assert.equal(openBtn.props.disabled, false);
    openBtn.props.onClick();
    ui.render();
    assert.equal(ui.controller().flow.current.phase, 'form');

    // 表单为纯文件上传，不应存在手打/粘贴正文的 textarea
    assert.equal(ui.findAll(n => n.type === 'textarea').length, 0);
    const fileInput = ui.find(n => n.type === 'input' && n.props?.type === 'file');
    assert.match(fileInput.props.accept, /\.txt/);
    assert.match(fileInput.props.accept, /\.md/);

    // 上传一份本地 .md 文件
    await ui.chooseFile(ui.makeFile('轨道观测日志.md', '# 第一节\r\n\r\n今晚看见极光。'));
    const titleInput = ui.findAll(n => n.type === 'input' && n.props?.type === 'text')[0];
    assert.equal(titleInput.props.value, '轨道观测日志');
    const excerpt = ui.textContent(ui.find(n => n.props?.className === 'library-file-excerpt'));
    assert.match(excerpt, /今晚看见极光/);

    // 允许修改作者后确认放入书柜
    const authorInput = ui.findAll(n => n.type === 'input' && n.props?.type === 'text')[1];
    authorInput.props.onChange({ target: { value: '小鱼' } });
    ui.render();

    const form = ui.find(n => n.type === 'form');
    await form.props.onSubmit({ preventDefault() {} });
    ui.render();

    assert.equal(ui.controller().flow.current.phase, 'shelving');
    const saved = ui.catalog.readLibrary(ui.storage);
    assert.equal(saved.books.length, 4);
    assert.equal(saved.books[3].title, '轨道观测日志');
    assert.equal(saved.books[3].author, '小鱼');
    assert.equal(saved.books[3].text, '# 第一节\n\n今晚看见极光。');
  } finally {
    ui.dispose();
  }
});

test('目录页拖入合法 .txt 文件自动进入上传表单，拖入非法格式或多文件被拦截', async () => {
  const ui = mountLibrarySurface();
  try {
    // 拖入多文件被拦截
    await ui.dropFiles([ui.makeFile('a.txt', '一'), ui.makeFile('b.txt', '二')]);
    assert.equal(ui.controller().flow.current.phase, 'catalog');
    assert.match(ui.textContent(ui.find(n => n.props?.role === 'alert')), /一次仅支持上传一本书/);

    // 拖入不支持格式被拦截
    await ui.dropFiles([ui.makeFile('ebook.epub', 'zipdata')]);
    assert.equal(ui.controller().flow.current.phase, 'catalog');
    assert.match(ui.textContent(ui.find(n => n.props?.role === 'alert')), /\.txt 或 \.md/);

    // 拖入合法 .txt 文件自动进入上传表单并带入内容
    await ui.dropFiles([ui.makeFile('夜间短篇.txt', '窗边有微光。')]);
    assert.equal(ui.controller().flow.current.phase, 'form');
    const titleInput = ui.findAll(n => n.type === 'input' && n.props?.type === 'text')[0];
    assert.equal(titleInput.props.value, '夜间短篇');
  } finally {
    ui.dispose();
  }
});

test('18 槽满柜和 512 KiB 空间上限均禁用按钮并拦截拖拽上传', async () => {
  const fullSlots = Array.from({ length: 15 }, (_, i) => ({ title: `藏书 ${i}`, text: `第 ${i} 本正文` }));
  const uiSlotsFull = mountLibrarySurface({ initialUserBooks: fullSlots });
  try {
    const addBtn = uiSlotsFull.find(n => n.type === 'button' && n.props?.className === 'library-primary');
    assert.equal(addBtn.props.disabled, true);
    assert.match(uiSlotsFull.textContent(addBtn), /书柜已满（18\/18）/);

    await uiSlotsFull.dropFiles([uiSlotsFull.makeFile('extra.txt', '第 19 本')]);
    assert.equal(uiSlotsFull.controller().flow.current.phase, 'catalog');
    assert.match(uiSlotsFull.textContent(uiSlotsFull.find(n => n.props?.role === 'alert')), /18\/18/);
    assert.equal(uiSlotsFull.catalog.readLibrary(uiSlotsFull.storage).books.length, 18);
  } finally {
    uiSlotsFull.dispose();
  }

  const uiBytesFull = mountLibrarySurface({ userBookByteFiller: true });
  try {
    const addBtn = uiBytesFull.find(n => n.type === 'button' && n.props?.className === 'library-primary');
    assert.equal(addBtn.props.disabled, true);
    assert.match(uiBytesFull.textContent(addBtn), /自添空间已满（512 KiB）/);

    await uiBytesFull.dropFiles([uiBytesFull.makeFile('tiny.md', '加不进去了')]);
    assert.equal(uiBytesFull.controller().flow.current.phase, 'catalog');
    assert.match(uiBytesFull.textContent(uiBytesFull.find(n => n.props?.role === 'alert')), /512 \/ 512 KiB/);
    assert.equal(uiBytesFull.catalog.readLibrary(uiBytesFull.storage).books.length, 7);
  } finally {
    uiBytesFull.dispose();
  }
});
