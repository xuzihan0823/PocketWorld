import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  BOOK_SLOTS,
  CAPACITY,
  TOTAL_LIMIT,
  USER_BOOK_LIMIT,
  formatBookBytes,
  paginate,
  parseBookFileBytes,
  remainingBookCapacity,
  validateBookFileMeta,
  type ParsedBookFile,
} from './catalog';
import type { LibraryController } from './useLibrary';
import './library.css';

export function LibrarySurface({ library }: { library: LibraryController }) {
  const { view, data } = library;
  const textArea = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const confirmFocus = useRef<HTMLElement | null>(null);
  const dragDepth = useRef(0);
  const [uploaded, setUploaded] = useState<ParsedBookFile | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [confirm, setConfirm] = useState<'discard' | string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const multi = useRef(false);
  const current = useRef({ library, uploaded, title, author, busy });
  current.current = { library, uploaded, title, author, busy };

  const active = view.phase !== 'idle';
  const form = view.phase === 'form';
  const reading = !!view.book && ['open', 'reading', 'turn', 'close'].includes(view.phase);
  const canDropFile = (view.phase === 'catalog' || view.phase === 'form') && !busy;
  const firstSlot = BOOK_SLOTS.find(slot => !data.books.some(book => book.slotId === slot.id));
  const capacity = useMemo(() => remainingBookCapacity(data), [data]);
  const preview = useMemo(() => paginate(uploaded?.text ?? '', 300, 12, () => 16), [uploaded?.text]);

  useEffect(() => {
    if (!active) {
      dragDepth.current = 0;
      setDragging(false);
      setUploaded(null);
      setTitle('');
      setAuthor('');
      setConfirm(null);
      setError('');
      return;
    }
    previousFocus.current = document.activeElement as HTMLElement;
    panel.current?.focus();
    return () => { if (previousFocus.current?.isConnected) previousFocus.current.focus(); };
  }, [active]);

  useEffect(() => {
    if (!confirm) return;
    confirmFocus.current = document.activeElement as HTMLElement;
    panel.current?.querySelector<HTMLButtonElement>('.library-confirm button')?.focus();
    return () => { if (confirmFocus.current?.isConnected) confirmFocus.current.focus(); };
  }, [confirm]);

  useEffect(() => {
    if (form) {
      setConfirm(null);
      if (uploaded) panel.current?.querySelector<HTMLInputElement>('input[type="text"]')?.focus();
      else panel.current?.querySelector<HTMLButtonElement>('.library-dropzone-trigger')?.focus();
    }
  }, [form]);

  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      const c = current.current;
      const s = c.library.flow.current;
      if (event.code === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (c.busy) return;
        if (confirm) { setConfirm(null); return; }
        if (s.phase === 'form') {
          if (c.uploaded || c.title.trim() || c.author.trim()) setConfirm('discard');
          else { setError(''); c.library.closeForm(); }
        } else {
          c.library.back();
        }
      } else if (['ArrowLeft', 'ArrowRight'].includes(event.code) && s.phase !== 'form') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!event.repeat) c.library.turn(event.code === 'ArrowRight' ? 1 : -1);
      } else if (event.code === 'Tab' && panel.current && (s.phase === 'form' || reading || confirm)) {
        const scope = confirm ? panel.current.querySelector<HTMLElement>('.library-confirm')! : panel.current;
        const fields = [...scope.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([type="file"])')];
        const first = fields[0];
        const last = fields[fields.length - 1];
        if (event.shiftKey && (document.activeElement === first || !scope.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !scope.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [active, confirm, reading]);

  useLayoutEffect(() => {
    const element = textArea.current;
    const book = view.book;
    if (!element || !book || !reading) return;
    let cancelled = false;
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    const layout = () => {
      if (cancelled) return;
      const style = getComputedStyle(element);
      context.font = `${style.fontSize} ${style.fontFamily}`;
      const cache = new Map<string, number>();
      const measure = (c: string) => { if (!cache.has(c)) cache.set(c, context.measureText(c).width); return cache.get(c)!; };
      library.setPages(paginate(book.text, Math.max(24, element.clientWidth - 2), Math.max(1, Math.floor((element.clientHeight - 2) / parseFloat(style.lineHeight))), measure));
    };
    const observer = new ResizeObserver(layout);
    observer.observe(element);
    layout();
    void document.fonts.ready.then(layout);
    return () => { cancelled = true; observer.disconnect(); };
  }, [view.book?.id, reading]);

  if (!active) return null;

  const phaseLabel: Record<string, string> = {
    prepare: '正在整理书柜',
    loading: '正在读取书籍',
    approach: '正在走向书柜',
    align: '正在对准书位',
    reach: '正在伸手取书',
    extract: '正在抽出书籍',
    carry: '正在调整持书姿势',
    open: '正在打开书籍',
    turn: '正在翻页',
    close: '正在合书',
    'return-carry': '正在送回书位',
    insert: '正在放回书籍',
    release: '正在松手',
    recenter: '正在回到选书位置',
    shelving: '正在放入书柜',
  };

  const resetDraft = () => {
    setUploaded(null);
    setTitle('');
    setAuthor('');
    setError('');
    if (fileInput.current) fileInput.current.value = '';
  };

  const cancelForm = () => {
    if (busy) return;
    if (uploaded || title.trim() || author.trim()) setConfirm('discard');
    else { resetDraft(); library.closeForm(); }
  };

  const handleFiles = async (files: FileList | readonly File[] | null | undefined) => {
    if (!files || files.length === 0 || busy) return;
    if (files.length > 1) {
      setError('一次仅支持上传一本书，请单个选择或拖入。');
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    const file = files[0];
    const latestData = library.data;
    const metaError = validateBookFileMeta({ name: file.name, size: file.size }, latestData);
    if (metaError) {
      setError(metaError);
      if (library.flow.current.phase === 'form') { setUploaded(null); setTitle(''); }
      if (fileInput.current) fileInput.current.value = '';
      return;
    }
    setError('');
    setBusy(true);
    try {
      const buffer = await file.arrayBuffer();
      const phase = library.flow.current.phase;
      if (phase !== 'catalog' && phase !== 'form') return;
      const parsed = parseBookFileBytes({ name: file.name, buffer }, latestData);
      if (phase === 'catalog' && !library.openForm()) return;
      setUploaded(parsed);
      setTitle(parsed.title);
    } catch (err) {
      setError((err as Error).message || '文件读取失败，请重新选择。');
      if (library.flow.current.phase === 'form') { setUploaded(null); setTitle(''); }
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const page = view.pages[view.page];
  const userBooksCount = data.books.filter(b => b.source === 'user').length;
  const addDisabledLabel = capacity.slotsLeft === 0
    ? `添加书籍 · 书柜已满（${CAPACITY}/${CAPACITY}）`
    : capacity.bytesLeft === 0
      ? '添加书籍 · 自添空间已满（512 KiB）'
      : '上传本地书籍';

  return <section ref={panel} tabIndex={-1} className={`library-surface ${reading ? 'library-reading' : ''} ${form ? 'library-adding' : ''} ${dragging ? 'is-dragging' : ''}`} aria-label={form ? '上传本地书籍' : reading ? `阅读《${view.book!.title}》` : '书柜藏书'}
    onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}
    onDragEnter={e => {
      e.stopPropagation();
      if (!canDropFile || !e.dataTransfer?.types?.includes('Files')) return;
      e.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    }}
    onDragOver={e => {
      e.stopPropagation();
      if (e.dataTransfer?.types?.includes('Files')) e.preventDefault();
    }}
    onDragLeave={e => {
      e.stopPropagation();
      if (!dragging) return;
      e.preventDefault();
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    }}
    onDrop={e => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth.current = 0;
      setDragging(false);
      if (canDropFile) void handleFiles(e.dataTransfer?.files);
    }}>
    {!form && !reading && <>
      <header><h2>这一柜，慢慢读。</h2><button onClick={library.back} disabled={!['catalog', 'approach', 'loading'].includes(view.phase)}>{view.phase === 'loading' ? '取消读取' : '返回房间'}</button></header>
      <p className="library-capacity">已放 {data.books.length} / {CAPACITY} 本<span>{capacity.fullReason ?? `自添 ${userBooksCount} / ${USER_BOOK_LIMIT} 本 · 已用 ${formatBookBytes(capacity.usedBytes)} / ${formatBookBytes(TOTAL_LIMIT)} · 支持拖入 .txt / .md`}</span></p>
      {view.phase === 'catalog' ? <>
        <ol className="library-catalog">{data.books.map(book => <li key={book.id}><button className="library-title" onClick={() => library.choose(book.id)}><i style={{ background: book.color }} /><span>{book.title}<small>{book.author} · {BOOK_SLOTS.find(s => s.id === book.slotId)!.row + 1} 层</small></span></button>{book.source === 'user' && <button className="library-remove" aria-label={`移除《${book.title}》`} onClick={() => setConfirm(book.id)}>移除</button>}</li>)}</ol>
        {error && <p className="library-error" role="alert">{error}</p>}
        <button className="library-primary" onClick={() => { setError(''); library.openForm(); }} disabled={!capacity.canAdd}>{addDisabledLabel}</button>
      </> : <p role="status" className="library-motion-status">{phaseLabel[view.phase] ?? '正在整理书籍'}…</p>}
    </>}
    {reading && <>
      <header><div><h2>{view.book!.title}</h2><p>{view.book!.author}</p></div><button onClick={library.back} disabled={!['reading', 'turn'].includes(view.phase)}>合书归位</button></header>
      <div ref={textArea} className="library-text" onPointerDown={event => {
        if (event.pointerType !== 'touch') return;
        if (pointers.current.size) multi.current = true; else multi.current = !event.isPrimary;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerUp={event => {
        const start = pointers.current.get(event.pointerId);
        pointers.current.delete(event.pointerId);
        if (start && !multi.current && Math.abs(event.clientX - start.x) > 45 && Math.abs(event.clientY - start.y) < 45) library.turn(event.clientX < start.x ? 1 : -1);
        if (!pointers.current.size) multi.current = false;
      }} onPointerCancel={() => { pointers.current.clear(); multi.current = false; }}><span>{page?.text ?? '正在展开书页…'}</span></div>
      <footer><button disabled={view.phase !== 'reading' || view.page === 0} onClick={() => library.turn(-1)}>上一页</button><span aria-live="polite">{view.page + 1} / {Math.max(1, view.pages.length)}</span><button disabled={view.phase !== 'reading' || view.page >= view.pages.length - 1} onClick={() => library.turn(1)}>下一页</button></footer>
      <p className="library-help library-shortcuts">
        <span>翻页 <kbd className="orbital-keycap">←</kbd><kbd className="orbital-keycap">→</kbd></span>
        <span>也可单指横划</span>
        <span>合书 <kbd className="orbital-keycap">Esc</kbd></span>
      </p>
    </>}
    {form && <form aria-label="上传本地书籍表单" onSubmit={async e => {
      e.preventDefault();
      if (busy || !uploaded) return;
      setBusy(true);
      setError('');
      try {
        await library.add(title, author, uploaded.text);
        resetDraft();
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
    }}>
      <header><h2>上传本地书籍</h2><button type="button" onClick={cancelForm} disabled={busy}>取消</button></header>
      <p className="library-help">仅支持上传本地 UTF-8 .txt / .md 文件 · 单本 ≤ 128 KiB，全部自添 ≤ 512 KiB。</p>
      <div className={`library-dropzone ${uploaded ? 'has-file' : ''}`}>
        <button type="button" className="library-dropzone-trigger" disabled={busy || !capacity.canAdd} onClick={() => fileInput.current?.click()}>
          {uploaded ? <>
            <strong>{uploaded.fileName}</strong>
            <small>{formatBookBytes(uploaded.bytes)} · 预计 {preview.length} 页 · 点击或拖入替换文件</small>
          </> : <>
            <strong>点击选择本地 .txt / .md 文件</strong>
            <small>也可直接将文件拖入此处 · 还可添 {capacity.slotsLeft} 本，剩余 {formatBookBytes(capacity.bytesLeft)}</small>
          </>}
        </button>
        {uploaded && <p className="library-file-excerpt" aria-label="正文摘要">{uploaded.text.slice(0, 90)}{uploaded.text.length > 90 ? '…' : ''}</p>}
        <input ref={fileInput} type="file" accept=".txt,.md,text/plain,text/markdown" hidden disabled={busy || !capacity.canAdd} onChange={event => { void handleFiles(event.target.files); }} />
      </div>
      <label>书名<input type="text" value={title} onChange={e => setTitle(e.target.value)} maxLength={80} required disabled={busy || !uploaded} placeholder="上传文件后自动填入" /></label>
      <label>作者（选填）<input type="text" value={author} onChange={e => setAuthor(e.target.value)} maxLength={60} disabled={busy || !uploaded} placeholder="默认记作访客" /></label>
      <p className="library-preview">
        {firstSlot && capacity.canAdd
          ? `将放入第 ${firstSlot.row + 1} 层、第 ${firstSlot.column + 1} 格 · 上架后自添总计 ${formatBookBytes(capacity.usedBytes + (uploaded?.bytes ?? 0))} / ${formatBookBytes(TOTAL_LIMIT)}`
          : (capacity.fullReason ?? '书柜已满')}
      </p>
      {error && <p className="library-error" role="alert">{error}</p>}
      <button className="library-primary" type="submit" disabled={busy || !firstSlot || !capacity.canAdd || !uploaded || !title.trim()}>{busy ? '正在上架…' : '确认放入书柜'}</button>
      <p className="library-help">只保存在当前浏览器与站点；清除站点数据会移除自添书籍，不会云同步。</p>
    </form>}
    {dragging && canDropFile && <div className={`library-drop-overlay ${!capacity.canAdd ? 'is-full' : ''}`} aria-hidden="true">
      {capacity.fullReason
        ? <><strong>无法继续添加</strong><span>{capacity.fullReason}</span></>
        : <><strong>松手上传本地书籍</strong><span>支持 UTF-8 .txt / .md · 还可添 {capacity.slotsLeft} 本（剩余 {formatBookBytes(capacity.bytesLeft)}）</span></>}
    </div>}
    {confirm && <div className="library-confirm" role="alertdialog" aria-modal="true" aria-label={confirm === 'discard' ? '放弃上传' : '确认移除书籍'}><p>{confirm === 'discard' ? '放弃当前尚未放入书柜的本地书籍？' : `移除《${data.books.find(b => b.id === confirm)?.title ?? ''}》并释放书位？`}</p><button onClick={() => setConfirm(null)}>继续保留</button><button onClick={() => { if (confirm === 'discard') { resetDraft(); library.closeForm(); } else void library.remove(confirm); setConfirm(null); }}>{confirm === 'discard' ? '确认放弃' : '确认移除'}</button></div>}
  </section>;
}
