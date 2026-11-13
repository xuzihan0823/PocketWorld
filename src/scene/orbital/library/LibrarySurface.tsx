import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { BOOK_SLOTS, CAPACITY, INPUT_LIMIT, byteLength, paginate } from './catalog';
import type { LibraryController } from './useLibrary';
import './library.css';
export function LibrarySurface({ library }: { library: LibraryController }) {
  const { view, data } = library;
  const textArea = useRef<HTMLDivElement>(null), panel = useRef<HTMLElement>(null), previousFocus = useRef<HTMLElement | null>(null);
  const [title, setTitle] = useState(''), [author, setAuthor] = useState(''), [text, setText] = useState('');
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [confirm, setConfirm] = useState<'discard' | string | null>(null);
  const confirmFocus = useRef<HTMLElement | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>()), multi = useRef(false);
  const current = useRef({ library, title, author, text, busy }); current.current = { library, title, author, text, busy };
  const active = view.phase !== 'idle', form = view.phase === 'form';
  const reading = !!view.book && ['open', 'reading', 'turn', 'close'].includes(view.phase);
  const firstSlot = BOOK_SLOTS.find(slot => !data.books.some(book => book.slotId === slot.id));
  const preview = useMemo(() => paginate(text, 300, 12, () => 16), [text]);
  useEffect(() => {
    if (!active) return;
    previousFocus.current = document.activeElement as HTMLElement;
    panel.current?.focus();
    return () => { if (previousFocus.current?.isConnected) previousFocus.current.focus(); };
  }, [active]);
  useEffect(() => { if (!confirm) return; confirmFocus.current = document.activeElement as HTMLElement; panel.current?.querySelector<HTMLButtonElement>('.library-confirm button')?.focus(); return () => { if (confirmFocus.current?.isConnected) confirmFocus.current.focus(); }; }, [confirm]);
  useEffect(() => { if (form) { setError(''); setConfirm(null); panel.current?.querySelector<HTMLInputElement>('input[type="text"]')?.focus(); } }, [form]);
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      const c = current.current, s = c.library.flow.current;
      if (event.code === 'Escape') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (c.busy) return;
        if (confirm) { setConfirm(null); return; }
        if (s.phase === 'form') { if (c.title || c.author || c.text) setConfirm('discard'); else c.library.closeForm(); }
        else c.library.back();
      } else if (['ArrowLeft', 'ArrowRight'].includes(event.code) && s.phase !== 'form') {
        event.preventDefault(); event.stopImmediatePropagation();
        if (!event.repeat) c.library.turn(event.code === 'ArrowRight' ? 1 : -1);
      } else if (event.code === 'Tab' && panel.current && (s.phase === 'form' || reading || confirm)) {
        const scope = confirm ? panel.current.querySelector<HTMLElement>('.library-confirm')! : panel.current;
        const fields = [...scope.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)')];
        const first = fields[0], last = fields[fields.length - 1];
        if (event.shiftKey && (document.activeElement === first || !scope.contains(document.activeElement))) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !scope.contains(document.activeElement))) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [active, confirm, reading]);
  useLayoutEffect(() => {
    const element = textArea.current, book = view.book;
    if (!element || !book || !reading) return;
    let cancelled = false;
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
    const layout = () => {
      if (cancelled) return;
      const style = getComputedStyle(element);
      context.font = `${style.fontSize} ${style.fontFamily}`;
      const cache = new Map<string, number>();
      const measure = (c: string) => { if (!cache.has(c)) cache.set(c, context.measureText(c).width); return cache.get(c)!; };
      library.setPages(paginate(book.text, Math.max(24, element.clientWidth - 2), Math.max(1, Math.floor((element.clientHeight - 2) / parseFloat(style.lineHeight))), measure));
    };
    const observer = new ResizeObserver(layout); observer.observe(element); layout();
    void document.fonts.ready.then(layout);
    return () => { cancelled = true; observer.disconnect(); };
  }, [view.book?.id, reading]);
  if (!active) return null;
  const phaseLabel: Record<string, string> = { prepare: '正在整理书柜', approach: '正在走向书柜', align: '正在对准书位', reach: '正在伸手取书', extract: '正在抽出书籍', carry: '正在调整持书姿势', open: '正在打开书籍', turn: '正在翻页', close: '正在合书', 'return-carry': '正在送回书位', insert: '正在放回书籍', release: '正在松手', recenter: '正在回到选书位置', shelving: '正在放入书柜' };
  const cancelForm = () => { if (!busy) { if (title || author || text) setConfirm('discard'); else library.closeForm(); } };
  const page = view.pages[view.page];
  const views = <nav className="library-views" aria-label="书柜视角">{([['shelf', '书柜'], ['close', '近景'], ['side', '侧面']] as const).map(([id, label]) => <button key={id} aria-pressed={library.cameraView === id} onClick={() => library.setCameraView(id)}>{label}</button>)}</nav>;
  return <section ref={panel} tabIndex={-1} className={`library-surface ${reading ? 'library-reading' : ''} ${form ? 'library-adding' : ''}`} aria-label={form ? '添加书籍' : reading ? `阅读《${view.book!.title}》` : '书柜藏书'}
    onPointerDown={e => e.stopPropagation()} onWheel={e => e.stopPropagation()}
    onDragEnter={e => e.stopPropagation()} onDragOver={e => { e.stopPropagation(); if (form) e.preventDefault(); }} onDrop={e => { e.preventDefault(); e.stopPropagation(); }}>
    {!form && !reading && <>
      <header><h2>这一柜，慢慢读。</h2><button onClick={library.back} disabled={!['catalog', 'approach'].includes(view.phase)} aria-label="离开书柜">返回房间</button></header>
      {views}
      <p className="library-capacity">已放 {data.books.length} / {CAPACITY} 本<span>{data.books.length === CAPACITY ? '书柜已满' : '三层书位 · 点击书脊也可取阅'}</span></p>
      {view.phase === 'catalog' ? <>
        <ol className="library-catalog">{data.books.map(book => <li key={book.id}><button className="library-title" onClick={() => library.choose(book.id)}><i style={{ background: book.color }} /><span>{book.title}<small>{book.author} · {BOOK_SLOTS.find(s => s.id === book.slotId)!.row + 1} 层</small></span></button>{book.source === 'user' && <button className="library-remove" aria-label={`移除《${book.title}》`} onClick={() => setConfirm(book.id)}>移除</button>}</li>)}</ol>
        <button className="library-primary" onClick={library.openForm} disabled={!firstSlot}>添加书籍{!firstSlot ? ' · 书柜已满' : ''}</button>
      </> : <p role="status" className="library-motion-status">{phaseLabel[view.phase] ?? '正在整理书籍'}…</p>}
    </>}
    {reading && <>
      <header><div><h2>{view.book!.title}</h2><p>{view.book!.author}</p></div><button onClick={library.back} disabled={!['reading', 'turn'].includes(view.phase)}>合书归位</button></header>
      {views}
      <div ref={textArea} className="library-text" onPointerDown={event => {
        if (event.pointerType !== 'touch') return;
        if (pointers.current.size) multi.current = true; else multi.current = !event.isPrimary;
        pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); event.currentTarget.setPointerCapture(event.pointerId);
      }} onPointerUp={event => {
        const start = pointers.current.get(event.pointerId); pointers.current.delete(event.pointerId);
        if (start && !multi.current && Math.abs(event.clientX - start.x) > 45 && Math.abs(event.clientY - start.y) < 45) library.turn(event.clientX < start.x ? 1 : -1);
        if (!pointers.current.size) multi.current = false;
      }} onPointerCancel={() => { pointers.current.clear(); multi.current = false; }}><span>{page?.text ?? '正在展开书页…'}</span></div>
      <footer><button disabled={view.phase !== 'reading' || view.page === 0} onClick={() => library.turn(-1)}>上一页</button><span aria-live="polite">{view.page + 1} / {Math.max(1, view.pages.length)}</span><button disabled={view.phase !== 'reading' || view.page >= view.pages.length - 1} onClick={() => library.turn(1)}>下一页</button></footer>
      <p className="library-help">{view.phase === 'turn' ? '纸页翻动中…' : '左右键或单指横划翻页 · Esc 合书'}</p>
    </>}
    {form && <form aria-label="添加书籍表单" onSubmit={async e => { e.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await library.add(title, author, text); setTitle(''); setAuthor(''); setText(''); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}>
      <header><h2>留一本自己的书</h2><button type="button" onClick={cancelForm} disabled={busy}>取消</button></header>
      <p className="library-help">UTF-8 .txt 或粘贴正文 · 单本 ≤128 KiB，全部自添正文 ≤512 KiB。</p>
      <label className="library-file">导入文本文件<input type="file" accept=".txt,text/plain" disabled={busy} onChange={async event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; setError(''); setBusy(true);
        try { if (!/\.txt$/i.test(file.name)) throw new Error('仅支持 .txt 文本文件。'); if (file.size > INPUT_LIMIT) throw new Error('文件超过 128 KiB，请缩短正文。'); const value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); if (!value.trim()) throw new Error('文件为空，请选择有正文的文件。'); if (value.includes('\0')) throw new Error('文件不是有效的 UTF-8 纯文本，请重新导出。'); setText(value.replace(/^\uFEFF/, '')); setTitle(file.name.replace(/\.txt$/i, '').slice(0, 80)); }
        catch (e) { setError((e as Error).message || '文件读取失败，请重新选择。'); } finally { setBusy(false); }
      }} /></label>
      <label>书名<input type="text" value={title} onChange={e => setTitle(e.target.value)} maxLength={80} required disabled={busy} /></label>
      <label>作者（选填）<input type="text" value={author} onChange={e => setAuthor(e.target.value)} maxLength={60} disabled={busy} /></label>
      <label className="library-body-label">正文<textarea value={text} onChange={e => setText(e.target.value)} required disabled={busy} spellCheck={false} placeholder="把故事留在这里，段落和换行会保留。" /></label>
      <p className="library-preview">{byteLength(text)} 字节 · 预计 {preview.length} 页（随阅读区域调整）<br />{firstSlot ? `将放入第 ${firstSlot.row + 1} 层、第 ${firstSlot.column + 1} 格` : '书柜已满'}{text && <span>{text.slice(0, 70)}</span>}</p>
      {(error || byteLength(text) > INPUT_LIMIT) && <p className="library-error" role="alert">{error || '正文超过 128 KiB，请缩短后重试。'}</p>}
      <button className="library-primary" type="submit" disabled={busy || !firstSlot || !title.trim() || !text.trim() || byteLength(text) > INPUT_LIMIT}>{busy ? '正在处理…' : '保存并放入书柜'}</button>
      <p className="library-help">只保存在当前浏览器与站点；清除站点数据会移除自添书籍，不会云同步。</p>
    </form>}
    {confirm && <div className="library-confirm" role="alertdialog" aria-modal="true" aria-label={confirm === 'discard' ? '放弃输入' : '确认移除书籍'}><p>{confirm === 'discard' ? '放弃尚未保存的书籍内容？' : `移除《${data.books.find(b => b.id === confirm)?.title ?? ''}》并释放书位？`}</p><button onClick={() => setConfirm(null)}>继续保留</button><button onClick={() => { if (confirm === 'discard') { setTitle(''); setAuthor(''); setText(''); library.closeForm(); } else void library.remove(confirm); setConfirm(null); }}>{confirm === 'discard' ? '放弃输入' : '确认移除'}</button></div>}
  </section>;
}
