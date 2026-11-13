import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorldAction, WorldSceneId } from '../../../types/world';
import { BOOK_SLOTS, CAPACITY, freshLibrary, LIBRARY_KEY, makeUserBook, mutateLibrary, readLibrary, type LibraryBook, type TextPage } from './catalog';
export type LibraryPhase = 'idle' | 'prepare' | 'approach' | 'catalog' | 'align' | 'reach' | 'extract' | 'carry' | 'open' | 'reading' | 'turn' | 'close' | 'return-carry' | 'insert' | 'release' | 'recenter' | 'form' | 'shelving';
export interface LibraryFlow { phase: LibraryPhase; book: LibraryBook | null; page: number; direction: number; targetPage: number; progress: number; pages: TextPage[]; nextId: string | null; closeRequested: boolean; exit: boolean; pending: WorldAction | null }
const initialFlow = (): LibraryFlow => ({ phase: 'idle', book: null, page: 0, targetPage: 0, direction: 1, progress: 0, pages: [], nextId: null, closeRequested: false, exit: false, pending: null });
const times: Partial<Record<LibraryPhase, number>> = { prepare: .9, reach: .65, extract: .7, carry: 1.05, open: .75, turn: .8, close: .75, 'return-carry': 1.05, insert: .7, release: .6, shelving: .6 };
export function useLibrary(options: { sceneId: WorldSceneId; reducedMotion: boolean; onAction: (action: WorldAction) => void; onReturn: () => void; error: (message: string) => void }) {
  const [cameraView, setCameraView] = useState<'shelf' | 'close' | 'side'>('shelf');
  const [data, setData] = useState(() => { try { return readLibrary(localStorage); } catch { return freshLibrary(); } });
  const [view, setView] = useState(initialFlow);
  const flow = useRef(view), live = useRef(options), dataRef = useRef(data), saving = useRef(false), mounted = useRef(true), pendingData = useRef<typeof data | null>(null), deferred = useRef<number>();
  live.current = options; dataRef.current = data;
  const update = useCallback((patch: Partial<LibraryFlow>) => { flow.current = { ...flow.current, ...patch, progress: 0 }; setView({ ...flow.current }); }, []);
  const sync = useCallback(() => { try { const next = readLibrary(localStorage); dataRef.current = next; setData(next); } catch (e) { live.current.error((e as Error).message); } }, []);
  useEffect(() => {
    mounted.current = true; sync();
    const storage = (event: StorageEvent) => { if (event.key !== LIBRARY_KEY && event.key !== null) return;
      try { const next = readLibrary(localStorage); const s = flow.current;
        if (s.book && !next.books.some(b => b.id === s.book!.id)) { pendingData.current = next; if (s.phase === 'reading') update({ phase: 'close' }); }
        else { dataRef.current = next; setData(next); }
      } catch (e) { live.current.error((e as Error).message); }
    };
    window.addEventListener('storage', storage);
    return () => { mounted.current = false; window.clearTimeout(deferred.current); window.removeEventListener('storage', storage); };
  }, [sync, update]);
  const choose = useCallback((id: string) => {
    const s = flow.current;
    const book = dataRef.current.books.find(book => book.id === id);
    if (!book || saving.current) return;
    if (s.phase === 'catalog') update({ book, phase: 'align', page: 0, pages: [], nextId: null, exit: false, closeRequested: false });
    else if (s.phase === 'reading' && s.book?.id !== id) update({ phase: 'close', nextId: id });
  }, [update]);
  const finishExit = useCallback(() => {
    const pending = flow.current.pending;
    update(initialFlow());
    live.current.onReturn();
    if (pending) deferred.current = window.setTimeout(() => live.current.onAction(pending), live.current.reducedMotion ? 120 : 850);
  }, [update]);
  const back = useCallback(() => {
    const s = flow.current;
    if (saving.current || s.phase === 'form') return;
    if (s.phase === 'reading') update({ phase: 'close' });
    else if (s.phase === 'catalog' || s.phase === 'approach' || s.phase === 'prepare') finishExit();
    else if (s.phase !== 'idle') s.closeRequested = true;
  }, [update, finishExit]);
  const dispatch = useCallback((action: WorldAction) => {
    if (action.sceneId !== live.current.sceneId) return;
    window.clearTimeout(deferred.current);
    const s = flow.current;
    if (s.phase !== 'idle') {
      if (action.objectId === 'book-01') { if (action.kind === 'turn-page') return; if (action.payload?.itemId) choose(action.payload.itemId); return; }
      if (['wake', 'stand'].includes(action.kind) && s.phase === 'approach') { live.current.onAction(action); return; }
      if (s.phase === 'form') return;
      s.pending = action; s.exit = true;
      if (s.phase === 'reading') update({ phase: 'close', pending: action, exit: true });
      else if (s.phase === 'catalog') finishExit();
      return;
    }
    if (action.objectId === 'book-01') {
      update({ ...initialFlow(), phase: 'prepare', nextId: action.payload?.itemId ?? null });
      live.current.onAction({ ...action, kind: 'inspect', payload: undefined });
    } else live.current.onAction(action);
  }, [choose, finishExit, update]);
  const commitAnchor = useCallback(async () => {
    const s = flow.current; if (!s.book || !s.pages[s.page]) return;
    const id = s.book.id, anchor = s.pages[s.page].start;
    try {
      const next = await mutateLibrary(data => ({ ...data, books: data.books.map(b => b.id === id ? { ...b, anchor } : b) }));
      if (mounted.current) { dataRef.current = next; setData(next); }
    } catch (e) { live.current.error(`阅读仍可继续。${(e as Error).message}`); }
  }, []);
  const turn = useCallback((direction: number) => {
    const s = flow.current, next = s.page + direction;
    if (s.phase !== 'reading' || next < 0 || next >= s.pages.length) return;
    update({ phase: 'turn', direction, targetPage: next });
  }, [update]);
  const setPages = useCallback((pages: TextPage[]) => {
    const s = flow.current;
    const anchor = s.pages[s.page]?.start ?? s.book?.anchor ?? 0;
    const page = Math.max(0, pages.findIndex((p, i) => anchor < p.end || i === pages.length - 1));
    s.pages = pages; s.page = page;
    if (s.phase === 'turn') { s.targetPage = page; s.phase = 'reading'; s.progress = 0; }
    setView({ ...s });
  }, []);
  const tick = useCallback((dt: number) => {
    const s = flow.current, duration = times[s.phase];
    if (!duration) return;
    s.progress = Math.min(1, s.progress + Math.min(dt, .04) / (live.current.reducedMotion ? Math.max(.28, duration * .5) : duration));
    if (s.progress < 1) return;
    switch (s.phase) {
      case 'prepare': if (s.exit) finishExit(); else update({ phase: 'approach' }); break;
      case 'reach': update({ phase: 'extract' }); break;
      case 'extract': update({ phase: 'carry' }); break;
      case 'carry': update({ phase: 'open' }); break;
      case 'open': update({ phase: s.exit || s.closeRequested ? 'close' : 'reading' }); break;
      case 'turn': update({ page: s.targetPage, phase: s.exit || s.closeRequested ? 'close' : 'reading' }); void commitAnchor(); break;
      case 'close': update({ phase: 'return-carry' }); break;
      case 'return-carry': update({ phase: 'insert' }); break;
      case 'insert': update({ phase: 'release' }); break;
      case 'release': {
        if (pendingData.current) { dataRef.current = pendingData.current; setData(pendingData.current); pendingData.current = null; }
        update({ phase: 'recenter', book: null, pages: [] }); break;
      }
      case 'shelving': update({ phase: 'catalog', book: null }); break;
    }
  }, [commitAnchor, update, finishExit]);
  const arrived = useCallback((success = true) => {
    const s = flow.current;
    if (!success) { live.current.error('无法安全到达书柜，请先移开挡路的椅子后重试。'); if (s.phase === 'approach') finishExit(); else update({ phase: 'catalog', book: null, pending: null, exit: false }); return; }
    if (s.phase === 'approach' || s.phase === 'recenter') {
      if (s.exit) finishExit();
      else { const id = s.nextId; update({ phase: 'catalog', nextId: null }); if (id) choose(id); }
    } else if (s.phase === 'align') update({ phase: 'reach' });
  }, [choose, finishExit, update]);
  const add = useCallback(async (title: string, author: string, text: string) => {
    if (flow.current.phase !== 'form' || saving.current) throw new Error('请在书柜添加表单中操作。');
    saving.current = true;
    try {
      let added: LibraryBook | null = null;
      const next = await mutateLibrary(data => { added = makeUserBook(data, title, author, text); return { ...data, books: [...data.books, added] }; }, () => flow.current.phase === 'form');
      dataRef.current = next; setData(next); update({ phase: 'shelving', book: added }); return added!;
    } finally { saving.current = false; }
  }, [update]);
  const remove = useCallback(async (id: string) => {
    if (flow.current.phase !== 'catalog' || saving.current) return;
    saving.current = true;
    try {
      const next = await mutateLibrary(data => { const book = data.books.find(b => b.id === id); if (!book || book.source !== 'user') throw new Error('仅可移除自添书籍。'); return { ...data, books: data.books.filter(b => b.id !== id) }; }, () => flow.current.phase === 'catalog');
      dataRef.current = next; setData(next);
    } catch (e) { live.current.error((e as Error).message); } finally { saving.current = false; }
  }, []);
  const openForm = useCallback(() => { if (flow.current.phase === 'catalog' && dataRef.current.books.length < CAPACITY && !saving.current) update({ phase: 'form' }); }, [update]);
  const fail = useCallback(() => { live.current.error('人物加载失败，已将书籍恢复在架；请重试人物加载或刷新页面。'); update(initialFlow()); live.current.onReturn(); }, [update]);
  return { fail, cameraView, setCameraView, data, view, flow, tick, arrived, choose, turn, setPages, add, remove, openForm, closeForm: () => { if (!saving.current && flow.current.phase === 'form') update({ phase: 'catalog' }); }, back, dispatch, slots: BOOK_SLOTS };
}
export type LibraryController = ReturnType<typeof useLibrary>;
