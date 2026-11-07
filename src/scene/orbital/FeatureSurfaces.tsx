import React, { useEffect, useRef, useState } from 'react';
import { Html } from '@react-three/drei';
import type { BookContent, JournalEntry, WorldSceneProps } from '../../types/world';
import { PRESET_BOOKS } from './library';
export function FeatureSurfaces(props: WorldSceneProps) {
  const id = props.focusedObject;
  const [journal, setJournal] = useState<JournalEntry>({ id: 'today', date: new Date().toLocaleDateString('sv-SE'), text: '', updatedAt: '' });
  const [book, setBook] = useState<BookContent>(PRESET_BOOKS[0]);
  const [bookView, setBookView] = useState<'reading' | 'catalog' | 'add'>('reading');
  const [bookTitle, setBookTitle] = useState('');
  const [bookAuthor, setBookAuthor] = useState('');
  const [bookText, setBookText] = useState('');
  const bookId = props.objects['book-01']?.itemId ?? 'book-01';
  const selectedBook = props.books.find(entry => entry.id === bookId) ?? PRESET_BOOKS[0];
  const [saveState, setSaveState] = useState('');
  const [loaded, setLoaded] = useState(false);
  const changed = useRef(false);
  const swipeStart = useRef<{ id: number; x: number; y: number; multi: boolean } | null>(null);
  const onError = useRef(props.onFeatureError);
  onError.current = props.onFeatureError;
  useEffect(() => { if (id !== 'book-01') setBookView('reading'); }, [id]);
  useEffect(() => {
    const abort = new AbortController();
    setLoaded(false);
    changed.current = false;
    setSaveState('');
    const load = async () => {
      try {
        if (id === 'journal') {
          const stored = props.adapters?.journal ? null : localStorage.getItem('pocketworld:journal:today');
          const entry = props.adapters?.journal ? await props.adapters.journal.load(abort.signal) : stored ? JSON.parse(stored) as JournalEntry : journal;
          if (!abort.signal.aborted && entry && typeof entry.text === 'string') setJournal(entry);
        } else if (id === 'book-01') {
          const content = props.adapters?.library && !bookId.startsWith('visitor-') ? await props.adapters.library.loadBook(bookId, abort.signal) : selectedBook;
          if (!abort.signal.aborted) setBook(content);
        }
        if (!abort.signal.aborted) setLoaded(true);
      } catch { if (!abort.signal.aborted) { if (id === 'book-01') setBook(selectedBook); setLoaded(true); onError.current('内容暂时无法读取，原有记录仍会保留。'); } }
    };
    void load();
    return () => abort.abort();
  }, [id, props.adapters, bookId, selectedBook]);
  useEffect(() => {
    if (!loaded || !changed.current || id !== 'journal') return;
    const abort = new AbortController();
    setSaveState('正在记录');
    const timer = window.setTimeout(async () => {
      try {
        if (id === 'journal') {
          const entry = { ...journal, updatedAt: new Date().toISOString() };
          if (props.adapters?.journal) await props.adapters.journal.save(entry, abort.signal);
          else localStorage.setItem('pocketworld:journal:today', JSON.stringify(entry));
        }
        if (!abort.signal.aborted) setSaveState('已记下');
      } catch { if (!abort.signal.aborted) { setSaveState('尚未保存'); onError.current('内容没有保存成功，请暂时保留这一页。'); } }
    }, 450);
    return () => { window.clearTimeout(timer); abort.abort(); };
  }, [journal, id, loaded, props.adapters]);
  const page = Math.min(Math.max(0, props.objects['book-01']?.page ?? 0), Math.max(0, book.pages.length - 1));
  useEffect(() => {
    if (id !== 'book-01' || !loaded || bookId.startsWith('visitor-') || !props.adapters?.library?.saveBookmark) return;
    const abort = new AbortController();
    void props.adapters.library.saveBookmark(book.id, page, abort.signal).catch(() => { if (!abort.signal.aborted) onError.current('阅读位置暂时未能保存。'); });
    return () => abort.abort();
  }, [page, book.id, bookId, loaded, id, props.adapters]);
  useEffect(() => {
    if (id !== 'book-01' || bookView !== 'reading') return;
    const key = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLElement && ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) return;
      if (event.code !== 'ArrowRight' && event.code !== 'ArrowLeft') return;
      event.preventDefault();
      const direction = event.code === 'ArrowRight' ? 1 : -1;
      if (page + direction < 0 || page + direction >= book.pages.length) return;
      props.onAction({ sceneId: props.sceneId, objectId: 'book-01', kind: 'turn-page', payload: { direction, value: page + direction } });
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [id, bookView, page, book.pages.length, props.sceneId, props.onAction]);
  const openBook = (nextId: string) => {
    setBookView('reading');
    if (nextId !== bookId) props.onAction({ sceneId: props.sceneId, objectId: 'book-01', kind: 'read', payload: { itemId: nextId } });
  };
  if (!id || !['journal', 'book-01'].includes(id) || !loaded || !props.objects[id]?.open) return null;
  const placement: Record<string, [number, number, number]> = { journal: [-0.482, 1.225, -1.92], 'book-01': [-3.40, 0.79, props.sceneId === 'observatory' ? -0.61 : -1.86] };
  return <Html transform position={placement[id]} rotation={[-Math.PI / 2 + 0.01, 0, 0]} distanceFactor={0.32} zIndexRange={[20, 10]} className="world-page-anchor">
    <article className="world-page" style={{ touchAction: id === 'book-01' ? 'pan-y' : 'auto' }} onPointerDown={event => {
      event.stopPropagation();
      if (swipeStart.current) { swipeStart.current.multi = true; return; }
      swipeStart.current = { id: event.pointerId, x: event.clientX, y: event.clientY, multi: !event.isPrimary };
    }} onPointerUp={event => {
      event.stopPropagation();
      const start = swipeStart.current;
      swipeStart.current = null;
      if (!start || start.multi || start.id !== event.pointerId || id !== 'book-01' || bookView !== 'reading' || Math.abs(event.clientX - start.x) < 25 || Math.abs(event.clientY - start.y) > Math.abs(event.clientX - start.x)) return;
      const direction = event.clientX < start.x ? 1 : -1;
      if (page + direction >= 0 && page + direction < book.pages.length) props.onAction({ sceneId: props.sceneId, objectId: id, kind: 'turn-page', payload: { direction, value: page + direction } });
    }} onPointerCancel={() => { swipeStart.current = null; }} onWheel={event => event.stopPropagation()}>
      {id === 'book-01' && <nav className="world-book-nav" aria-label="书柜导航">
        <button type="button" onClick={() => setBookView('catalog')}>书目</button>
        <button type="button" onClick={() => setBookView('add')}>添加书籍</button>
      </nav>}
      <small>{id === 'journal' ? journal.date : bookView === 'reading' ? book.author : '书柜 · 我的阅读角'}</small>
      <h2>{id === 'journal' ? '今天，记住什么' : bookView === 'reading' ? book.title : bookView === 'catalog' ? '书柜藏书' : '添一本自己的书'}</h2>
      {id === 'journal' && <textarea aria-label="日记正文" placeholder="写下此刻的想法……" value={journal.text} onFocus={() => props.onGesture(true)} onBlur={() => props.onGesture(false)} onChange={event => {
        changed.current = true;
        const entry = { ...journal, text: event.target.value, updatedAt: new Date().toISOString() };
        setJournal(entry);
        if (!props.adapters?.journal) { try { localStorage.setItem('pocketworld:journal:today', JSON.stringify(entry)); } catch { onError.current('本地存储暂时不可用。'); } }
      }} />}
      {id === 'book-01' && bookView === 'reading' && <p className="world-book-text">{book.pages[page] ?? '这一页暂时空着。'}</p>}
      {id === 'book-01' && bookView === 'catalog' && <div className="world-book-list">{props.books.map(entry => <button type="button" key={entry.id} onClick={() => openBook(entry.id)}>
        <strong>{entry.title}</strong><small>{entry.author || '佚名'} · {entry.id.startsWith('visitor-') ? '我的书' : '舱室藏书'}</small>
      </button>)}</div>}
      {id === 'book-01' && bookView === 'add' && <form className="world-book-form" onSubmit={event => {
        event.preventDefault();
        const added = props.onAddBook(bookTitle, bookAuthor, bookText);
        if (!added) return;
        setBookTitle(''); setBookAuthor(''); setBookText('');
        openBook(added.id);
      }}>
        <input aria-label="书名" placeholder="书名" required maxLength={80} value={bookTitle} onChange={event => setBookTitle(event.target.value)} />
        <input aria-label="作者" placeholder="作者（可不填）" maxLength={60} value={bookAuthor} onChange={event => setBookAuthor(event.target.value)} />
        <textarea aria-label="书籍正文" placeholder="在这里写下正文，空一行分隔书页……" required maxLength={10000} value={bookText} onFocus={() => props.onGesture(true)} onBlur={() => props.onGesture(false)} onChange={event => setBookText(event.target.value)} />
        <button type="submit">放进书柜</button>
      </form>}
      <footer>{id === 'book-01' ? bookView === 'reading' ? `${page + 1} / ${book.pages.length} · 滑动书页` : bookView === 'catalog' ? `${props.books.length} 本藏书 · 点击书名阅读` : '只保存在当前浏览器，空一行分隔书页' : saveState || '纸上的时间，慢一点'}</footer>
    </article>
  </Html>;
}
