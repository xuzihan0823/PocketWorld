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
  type LibraryBook,
  type ParsedBookFile,
} from './catalog';
import type { LibraryController } from './useLibrary';
import './library.css';

const SPINE_COLORS = ['#617e79', '#aa7c48', '#815e70', '#697c9d', '#a45f48', '#78834f'] as const;
const SHELF_ROWS_DESC = [2, 1, 0] as const;

function readingProgressLabel(book: LibraryBook): string | null {
  if (!book.anchor || !book.text.length) return null;
  const pct = Math.round((book.anchor / book.text.length) * 100);
  if (pct >= 98) return '将读完';
  return `已读 ${Math.max(1, pct)}%`;
}

function IconBack() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9.5 3.5 5 8l4.5 4.5" />
      <path d="M5.5 8H13" />
    </svg>
  );
}

function IconUpload() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 10.5V3" />
      <path d="M5 5.8 8 2.8l3 3" />
      <path d="M3 10.8v1.7A1.5 1.5 0 0 0 4.5 14h7a1.5 1.5 0 0 0 1.5-1.5v-1.7" />
    </svg>
  );
}

function IconRemove() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 4.5h9" />
      <path d="M6 4.5V3.2A1 1 0 0 1 7 2.2h2a1 1 0 0 1 1 1v1.3" />
      <path d="M4.8 4.5l.6 8.2a1 1 0 0 0 1 .9h3.2a1 1 0 0 0 1-.9l.6-8.2" />
    </svg>
  );
}

function IconChevron({ direction }: { direction: 'left' | 'right' }) {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {direction === 'left' ? <path d="M9.8 3.5 5.2 8l4.6 4.5" /> : <path d="M6.2 3.5 10.8 8l-4.6 4.5" />}
    </svg>
  );
}

function IconCloseBook() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3.5 3.5A1.5 1.5 0 0 1 5 2h7.5v11H5a1.5 1.5 0 0 0-1.5 1.5V3.5Z" />
      <path d="M3.5 12.5A1.5 1.5 0 0 1 5 11h7.5" />
    </svg>
  );
}

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
  const [hoveredBookId, setHoveredBookId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<'discard' | string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const multi = useRef(false);
  const current = useRef({ library, uploaded, title, author, busy });
  current.current = { library, uploaded, title, author, busy };

  const active = view.phase !== 'idle';
  const isCatalog = view.phase === 'catalog';
  const isLoading = view.phase === 'loading';
  const isCatalogView = isCatalog || isLoading;
  const form = view.phase === 'form';
  const readingVisible = !!view.book && (view.phase === 'reading' || view.phase === 'turn');
  const readingMount = !!view.book && (view.phase === 'open' || view.phase === 'reading' || view.phase === 'turn');
  const readingPreloading = !!view.book && view.phase === 'open';
  const surfaceVisible = isCatalogView || form || readingVisible;
  const canDropFile = (isCatalog || form) && !busy;

  const firstSlot = BOOK_SLOTS.find(slot => !data.books.some(book => book.slotId === slot.id));
  const capacity = useMemo(() => remainingBookCapacity(data), [data]);
  const preview = useMemo(() => paginate(uploaded?.text ?? '', 300, 12, () => 16), [uploaded?.text]);
  const booksBySlot = useMemo(() => new Map(data.books.map(book => [book.slotId, book])), [data.books]);

  useEffect(() => {
    if (!active) {
      dragDepth.current = 0;
      setDragging(false);
      setHoveredBookId(null);
      setUploaded(null);
      setTitle('');
      setAuthor('');
      setConfirm(null);
      setError('');
      if (previousFocus.current?.isConnected) previousFocus.current.focus();
      previousFocus.current = null;
      return;
    }
    if (!previousFocus.current) previousFocus.current = document.activeElement as HTMLElement;
  }, [active]);

  useEffect(() => {
    if (surfaceVisible) panel.current?.focus();
    else setHoveredBookId(null);
  }, [surfaceVisible]);

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
      } else if (event.code === 'Tab' && panel.current && (s.phase === 'form' || readingVisible || confirm)) {
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
  }, [active, confirm, readingVisible]);

  useLayoutEffect(() => {
    const element = textArea.current;
    const book = view.book;
    if (!element || !book || !readingMount) return;
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
  }, [view.book?.id, readingMount]);

  if (!active) return null;

  // 过渡阶段（走近、对准、取书、合书、还书、上架）不显示面板，把 3D 演出完整让给画面；
  // 仅保留零占地隐形锚点以维持顶栏快捷提示隐藏与 Esc 取消监听。
  if (!isCatalogView && !form && !readingMount) {
    return <div className="library-surface is-transit" aria-hidden="true" />;
  }

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
  const totalPages = Math.max(1, view.pages.length);
  const readingRatio = ((view.page + 1) / totalPages) * 100;
  const userBooksCount = data.books.filter(b => b.source === 'user').length;
  const bytesRatio = Math.min(100, (capacity.usedBytes / TOTAL_LIMIT) * 100);
  const previewSpineColor = firstSlot ? SPINE_COLORS[firstSlot.column % SPINE_COLORS.length] : SPINE_COLORS[0];
  const addDisabledLabel = capacity.slotsLeft === 0
    ? `添加书籍 · 书柜已满（${CAPACITY}/${CAPACITY}）`
    : capacity.bytesLeft === 0
      ? '添加书籍 · 自添空间已满（512 KiB）'
      : '上传本地书籍';

  const surfaceClassName = [
    'library-surface',
    isCatalogView ? 'library-catalog-panel' : '',
    readingMount ? 'library-reading' : '',
    readingPreloading ? 'is-preloading' : '',
    form ? 'library-adding' : '',
    dragging ? 'is-dragging' : '',
  ].filter(Boolean).join(' ');

  return (
    <section
      ref={panel}
      tabIndex={-1}
      className={surfaceClassName}
      aria-hidden={readingPreloading || undefined}
      aria-label={form ? '上传本地书籍' : readingMount ? `阅读《${view.book!.title}》` : '书柜藏书'}
      onPointerDown={e => e.stopPropagation()}
      onWheel={e => e.stopPropagation()}
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
      }}
    >
      {isCatalogView && <>
        <div className="library-topbar">
          <p className="library-capacity">
            <strong>已放 {data.books.length} / {CAPACITY} 本</strong>
            <span>{isLoading ? '正在读取外部书籍…' : (capacity.fullReason ?? `自添 ${userBooksCount} / ${USER_BOOK_LIMIT} 本 · 已用 ${formatBookBytes(capacity.usedBytes)} / ${formatBookBytes(TOTAL_LIMIT)}`)}</span>
          </p>
          <button type="button" className="library-ghost-btn" onClick={library.back} aria-label={isLoading ? '取消读取书籍' : '离开书柜'}>
            <IconBack />
            <span>{isLoading ? '取消读取' : '返回房间'}</span>
          </button>
        </div>

        <div className="library-shelf-card" aria-label="书柜三层十八格藏书分布">
          <div className="library-shelf-map">
            {SHELF_ROWS_DESC.map(row => (
              <div key={row} className="library-shelf-row">
                <span className="library-shelf-row-label">{row + 1} 层</span>
                <div className="library-shelf-slots">
                  {BOOK_SLOTS.filter(slot => slot.row === row).map(slot => {
                    const occupant = booksBySlot.get(slot.id);
                    if (occupant) {
                      const highlighted = hoveredBookId === occupant.id;
                      return (
                        <button
                          key={slot.id}
                          type="button"
                          disabled={isLoading}
                          className={`library-slot-pip is-filled${highlighted ? ' is-highlighted' : ''}`}
                          style={{ '--spine-color': occupant.color } as React.CSSProperties}
                          title={`第 ${row + 1} 层 ${slot.column + 1} 格：《${occupant.title}》`}
                          aria-label={`取阅第 ${row + 1} 层第 ${slot.column + 1} 格《${occupant.title}》`}
                          onMouseEnter={() => setHoveredBookId(occupant.id)}
                          onMouseLeave={() => setHoveredBookId(null)}
                          onFocus={() => setHoveredBookId(occupant.id)}
                          onBlur={() => setHoveredBookId(null)}
                          onClick={() => library.choose(occupant.id)}
                        />
                      );
                    }
                    return (
                      <span
                        key={slot.id}
                        className="library-slot-pip is-empty"
                        title={`第 ${row + 1} 层 ${slot.column + 1} 格（空位）`}
                        aria-hidden="true"
                      />
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
          {(capacity.usedBytes > 0 || !capacity.canAdd) && (
            <div className="library-quota-bar" aria-hidden="true">
              <div
                className={`library-quota-fill${!capacity.canAdd || bytesRatio >= 85 ? ' is-warn' : ''}`}
                style={{ width: `${Math.max(bytesRatio, capacity.usedBytes > 0 ? 3 : 0)}%` }}
              />
            </div>
          )}
        </div>

        <ol className="library-catalog">
          {data.books.map(book => {
            const slot = BOOK_SLOTS.find(s => s.id === book.slotId)!;
            const progress = readingProgressLabel(book);
            const highlighted = hoveredBookId === book.id;
            return (
              <li
                key={book.id}
                className={highlighted ? 'is-highlighted' : undefined}
                onMouseEnter={() => setHoveredBookId(book.id)}
                onMouseLeave={() => setHoveredBookId(null)}
              >
                <button
                  type="button"
                  disabled={isLoading}
                  className="library-title"
                  onFocus={() => setHoveredBookId(book.id)}
                  onBlur={() => setHoveredBookId(null)}
                  onClick={() => library.choose(book.id)}
                >
                  <i className="library-spine-mini" style={{ '--spine-color': book.color } as React.CSSProperties} aria-hidden="true" />
                  <span className="library-book-meta">
                    <span className="library-book-head">
                      <span className="library-book-name">{book.title}</span>
                      {progress && <em className="library-book-progress">{progress}</em>}
                    </span>
                    <small>{book.author} · {slot.row + 1} 层 {slot.column + 1} 格</small>
                  </span>
                  <span className="library-book-cue" aria-hidden="true">
                    <IconChevron direction="right" />
                  </span>
                </button>
                {book.source === 'user' && (
                  <button
                    type="button"
                    disabled={isLoading}
                    className="library-remove"
                    aria-label={`移除《${book.title}》`}
                    title={`移除《${book.title}》`}
                    onClick={() => setConfirm(book.id)}
                  >
                    <IconRemove />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
        {error && <p className="library-error" role="alert">{error}</p>}

        <div className="library-catalog-footer">
          <button
            type="button"
            className="library-primary"
            onClick={() => { setError(''); library.openForm(); }}
            disabled={!capacity.canAdd || isLoading}
          >
            <IconUpload />
            <span>{addDisabledLabel}</span>
          </button>
          {capacity.canAdd && !isLoading && <p className="library-drop-hint">也可直接将 UTF-8 .txt / .md 文件拖入此处</p>}
        </div>
      </>}

      {readingMount && <>
        <header className="library-reading-header">
          <div className="library-reading-title">
            <h2>{view.book!.title}</h2>
            <p>{view.book!.author}</p>
          </div>
          <button
            type="button"
            className="library-ghost-btn"
            onClick={library.back}
            disabled={!readingVisible}
          >
            <IconCloseBook />
            <span>合书归位</span>
          </button>
        </header>

        <div
          ref={textArea}
          className="library-text"
          onPointerDown={event => {
            if (event.pointerType !== 'touch') return;
            if (pointers.current.size) multi.current = true; else multi.current = !event.isPrimary;
            pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerUp={event => {
            const start = pointers.current.get(event.pointerId);
            pointers.current.delete(event.pointerId);
            if (start && !multi.current && Math.abs(event.clientX - start.x) > 45 && Math.abs(event.clientY - start.y) < 45) library.turn(event.clientX < start.x ? 1 : -1);
            if (!pointers.current.size) multi.current = false;
          }}
          onPointerCancel={() => { pointers.current.clear(); multi.current = false; }}
        >
          <span>{page?.text ?? ''}</span>
        </div>

        <div className="library-reading-progress" aria-hidden="true">
          <div className="library-reading-progress-fill" style={{ width: `${readingRatio}%` }} />
        </div>

        <footer className="library-reading-footer">
          <button
            type="button"
            className="library-page-btn"
            disabled={view.phase !== 'reading' || view.page === 0}
            onClick={() => library.turn(-1)}
          >
            <IconChevron direction="left" />
            <span>上一页</span>
          </button>
          <span className="library-page-count" aria-live="polite">{view.page + 1} / {totalPages}</span>
          <button
            type="button"
            className="library-page-btn"
            disabled={view.phase !== 'reading' || view.page >= view.pages.length - 1}
            onClick={() => library.turn(1)}
          >
            <span>下一页</span>
            <IconChevron direction="right" />
          </button>
        </footer>

        <p className="library-help library-shortcuts">
          <span>翻页 <kbd className="orbital-keycap">←</kbd><kbd className="orbital-keycap">→</kbd></span>
          <span>单指横划</span>
          <span>合书 <kbd className="orbital-keycap">Esc</kbd></span>
        </p>
      </>}

      {form && (
        <form
          aria-label="上传本地书籍表单"
          onSubmit={async e => {
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
          }}
        >
          <div className="library-topbar library-form-topbar">
            <span className="library-form-slot-note">
              {firstSlot && capacity.canAdd
                ? `空位 · 第 ${firstSlot.row + 1} 层 ${firstSlot.column + 1} 格`
                : (capacity.fullReason ?? '书柜已满')}
            </span>
            <button type="button" className="library-ghost-btn" onClick={cancelForm} disabled={busy}>
              <IconBack />
              <span>返回目录</span>
            </button>
          </div>

          <div className={`library-dropzone ${uploaded ? 'has-file' : ''}`}>
            <button
              type="button"
              className="library-dropzone-trigger"
              disabled={busy || !capacity.canAdd}
              onClick={() => fileInput.current?.click()}
            >
              {uploaded ? (
                <span className="library-uploaded-preview">
                  <i className="library-spine-preview" style={{ '--spine-color': previewSpineColor } as React.CSSProperties} aria-hidden="true" />
                  <span className="library-uploaded-info">
                    <strong>{uploaded.fileName}</strong>
                    <small>{formatBookBytes(uploaded.bytes)} · 预计 {preview.length} 页 · 点击或拖入更换</small>
                  </span>
                </span>
              ) : (
                <span className="library-dropzone-empty">
                  <IconUpload />
                  <strong>选择或拖入 .txt / .md 文件</strong>
                  <small>UTF-8 纯文本 · 单本 ≤ 128 KiB</small>
                  <small>还可添 {capacity.slotsLeft} 本 · 剩余 {formatBookBytes(capacity.bytesLeft)}</small>
                </span>
              )}
            </button>
            {uploaded && (
              <p className="library-file-excerpt" aria-label="正文摘要">
                {uploaded.text.slice(0, 90)}{uploaded.text.length > 90 ? '…' : ''}
              </p>
            )}
            <input
              ref={fileInput}
              type="file"
              accept=".txt,.md,text/plain,text/markdown"
              hidden
              disabled={busy || !capacity.canAdd}
              onChange={event => { void handleFiles(event.target.files); }}
            />
          </div>

          <div className="library-fields">
            <label>
              <span>书名</span>
              <input
                type="text"
                value={title}
                onChange={e => setTitle(e.target.value)}
                maxLength={80}
                required
                disabled={busy || !uploaded}
                placeholder="上传文件后自动填入"
              />
            </label>
            <label>
              <span>作者（选填）</span>
              <input
                type="text"
                value={author}
                onChange={e => setAuthor(e.target.value)}
                maxLength={60}
                disabled={busy || !uploaded}
                placeholder="默认记作访客"
              />
            </label>
          </div>

          {uploaded && firstSlot && capacity.canAdd && (
            <p className="library-preview">
              上架后自添已用 {formatBookBytes(capacity.usedBytes + uploaded.bytes)} / {formatBookBytes(TOTAL_LIMIT)}
            </p>
          )}

          {error && <p className="library-error" role="alert">{error}</p>}

          <button
            className="library-primary"
            type="submit"
            disabled={busy || !firstSlot || !capacity.canAdd || !uploaded || !title.trim()}
          >
            {busy ? '正在上架…' : '确认放入书柜'}
          </button>

          <p className="library-help library-storage-note">仅保存在当前浏览器本机数据中，清除站点数据会一并移除。</p>
        </form>
      )}

      {dragging && canDropFile && (
        <div className={`library-drop-overlay ${!capacity.canAdd ? 'is-full' : ''}`} aria-hidden="true">
          <div className="library-drop-overlay-inner">
            <IconUpload />
            {capacity.fullReason
              ? <><strong>无法继续添加</strong><span>{capacity.fullReason}</span></>
              : <><strong>松手上传本地书籍</strong><span>UTF-8 .txt / .md · 还可添 {capacity.slotsLeft} 本（剩 {formatBookBytes(capacity.bytesLeft)}）</span></>}
          </div>
        </div>
      )}

      {confirm && (
        <div className="library-confirm" role="alertdialog" aria-modal="true" aria-label={confirm === 'discard' ? '放弃上传' : '确认移除书籍'}>
          <div className="library-confirm-card">
            <p>{confirm === 'discard' ? '放弃当前尚未放入书柜的本地书籍？' : `移除《${data.books.find(b => b.id === confirm)?.title ?? ''}》并释放书位？`}</p>
            <div className="library-confirm-actions">
              <button type="button" onClick={() => setConfirm(null)}>继续保留</button>
              <button
                type="button"
                className="library-confirm-danger"
                onClick={() => {
                  if (confirm === 'discard') { resetDraft(); library.closeForm(); }
                  else void library.remove(confirm);
                  setConfirm(null);
                }}
              >
                {confirm === 'discard' ? '确认放弃' : '确认移除'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
