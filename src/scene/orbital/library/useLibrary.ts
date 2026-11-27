import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorldAction, WorldFeatureAdapters, WorldSceneId } from '../../../types/world';
import { BOOK_SLOTS, freshLibrary, LIBRARY_KEY, makeUserBook, mutateLibrary, readLibrary, remainingBookCapacity, type LibraryBook, type TextPage } from './catalog';
import { libraryMotionDuration, type LibraryMotion } from './libraryMotion';
import { PAGE_TURN_SECONDS } from './bookMotion';
import { roomAudio, type RoomSfxType } from '../../audioEngine';
export type LibraryPhase = 'idle' | 'prepare' | 'approach' | 'catalog' | 'loading' | 'align' | 'reach' | 'extract' | 'carry' | 'open' | 'reading' | 'turn' | 'close' | 'return-carry' | 'insert' | 'release' | 'recenter' | 'form' | 'shelving';
export interface LibraryFlow { phase: LibraryPhase; book: LibraryBook | null; page: number; direction: number; targetPage: number; progress: number; pages: TextPage[]; nextId: string | null; closeRequested: boolean; exit: boolean; pending: WorldAction | null }
const initialFlow = (): LibraryFlow => ({ phase: 'idle', book: null, page: 0, targetPage: 0, direction: 1, progress: 0, pages: [], nextId: null, closeRequested: false, exit: false, pending: null });
const times: Partial<Record<LibraryPhase, number>> = { prepare: .9, reach: .74, extract: .62, carry: .96, open: 1.35, turn: PAGE_TURN_SECONDS, close: 1.35, 'return-carry': .96, insert: .62, release: .58, shelving: .6 };
const phaseSfx: Partial<Record<LibraryPhase, RoomSfxType>> = {
  extract: 'book-extract',
  open: 'book-open',
  turn: 'paper',
  close: 'book-close',
  insert: 'book-insert',
  shelving: 'book-shelf-add',
};
export function useLibrary(options: { adapter?: WorldFeatureAdapters['library']; sceneId: WorldSceneId; reducedMotion: boolean; onAction: (action: WorldAction) => void; onReturn: () => void; error: (message: string) => void }) {
  const [data, setData] = useState(() => { try { return readLibrary(localStorage); } catch { return freshLibrary(); } });
  const [view, setView] = useState(initialFlow);
  const motion = useRef<LibraryMotion | null>();
  const flow = useRef(view), live = useRef(options), dataRef = useRef(data), saving = useRef(false), mounted = useRef(true), pendingData = useRef<typeof data | null>(null), deferred = useRef<number>();
  const load = useRef<AbortController | null>(null);
  const bookmarkQueue = useRef(Promise.resolve());
  const lifetime = useRef<AbortController>();
  const remoteBook = useRef<WorldFeatureAdapters['library']>();
  live.current = options; dataRef.current = data;
  const update = useCallback((patch: Partial<LibraryFlow>) => {
    const previousPhase = flow.current.phase;
    if (previousPhase === 'loading' && patch.phase !== 'loading') {
      load.current?.abort();
      load.current = null;
    }
    if (patch.book === null && pendingData.current) {
      dataRef.current = pendingData.current;
      setData(pendingData.current);
      pendingData.current = null;
    }
    flow.current = { ...flow.current, ...patch, progress: 0 };
    if (patch.phase && patch.phase !== previousPhase) {
      const sfx = phaseSfx[patch.phase];
      if (sfx) roomAudio.playSfx(sfx);
    }
    setView({ ...flow.current });
  }, []);
  const sync = useCallback(() => { try { const next = readLibrary(localStorage); dataRef.current = next; setData(next); } catch (e) { live.current.error((e as Error).message); } }, []);
  useEffect(() => {
    mounted.current = true;
    sync();
    const storage = (event: StorageEvent) => { if (event.key !== LIBRARY_KEY && event.key !== null) return;
      try { const next = readLibrary(localStorage); const s = flow.current;
        if (s.book && !next.books.some(book => book.id === s.book!.id)) {
          pendingData.current = next;
          s.closeRequested = true;
          if (s.phase === 'reading') update({ phase: 'close' });
        } else {
          pendingData.current = null;
          dataRef.current = next;
          setData(next);
          if (s.phase === 'loading' && !next.books.some(book => book.id === s.nextId)) {
            update({ phase: 'catalog', nextId: null });
          }
        }
      } catch (e) { live.current.error((e as Error).message); }
    };
    window.addEventListener('storage', storage);
    return () => { mounted.current = false; load.current?.abort(); lifetime.current?.abort(); lifetime.current = undefined; window.clearTimeout(deferred.current); window.removeEventListener('storage', storage); };
  }, [sync, update]);
  const choose = useCallback((id: string) => {
    const s = flow.current;
    const book = dataRef.current.books.find(book => book.id === id);
    if (!book || saving.current) return;
    if (s.phase === 'reading' && s.book?.id !== id) update({ phase: 'close', nextId: id });
    if (s.phase !== 'catalog') return;
    const adapter = live.current.adapter;
    const align = (selected: LibraryBook) => {
      remoteBook.current = adapter;
      update({ book: selected, phase: 'align', page: 0, pages: [], nextId: null, exit: false, closeRequested: false });
    };
    if (!adapter) { align(book); return; }
    lifetime.current ??= new AbortController();
    const request = new AbortController();
    load.current = request;
    update({ phase: 'loading', nextId: id });
    void (async () => {
      try {
        const content = await adapter.loadBook(id, request.signal);
        if (request.signal.aborted) return;
        if (content.id !== id || !Array.isArray(content.pages) || !content.pages.length ||
            !content.pages.every(page => typeof page === 'string')) throw new Error('书籍正文无法读取。');
        align({ ...book, title: content.title, author: content.author ?? book.author, text: content.pages.join('\f'), anchor: 0 });
      } catch (error) {
        if (request.signal.aborted) return;
        update({ phase: 'catalog', nextId: null });
        live.current.error(error instanceof Error ? error.message : '书籍加载失败，请重新选书。');
      }
    })();
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
    if (s.phase === 'loading') update({ phase: 'catalog', nextId: null });
    else if (s.phase === 'reading') update({ phase: 'close' });
    else if (s.phase === 'catalog' || s.phase === 'approach' || s.phase === 'prepare') finishExit();
    else if (s.phase !== 'idle') s.closeRequested = true;
  }, [update, finishExit]);
  const dispatch = useCallback((action: WorldAction) => {
    if (action.sceneId !== live.current.sceneId) return;
    window.clearTimeout(deferred.current);
    const s = flow.current;
    if (s.phase !== 'idle') {
      if (action.objectId === 'book-01') { if (action.kind === 'turn-page') return; if (action.payload?.itemId) choose(action.payload.itemId); return; }
      if (action.kind === 'stand' && s.phase === 'approach') { live.current.onAction(action); return; }
      if (s.phase === 'form') return;
      s.pending = action; s.exit = true;
      if (s.phase === 'reading') update({ phase: 'close', pending: action, exit: true });
      else if (s.phase === 'catalog' || s.phase === 'loading') finishExit();
      return;
    }
    if (action.objectId === 'book-01') {
      update({ ...initialFlow(), phase: 'prepare', nextId: action.payload?.itemId ?? null });
      live.current.onAction({ ...action, kind: 'inspect', payload: undefined });
    } else live.current.onAction(action);
  }, [choose, finishExit, update]);
  const commitAnchor = useCallback(async () => {
    const s = flow.current; if (!s.book || !s.pages[s.page]) return;
    if (pendingData.current) return;
    const id = s.book.id, anchor = s.pages[s.page].start;
    const adapter = remoteBook.current;
    if (adapter) {
      const signal = lifetime.current?.signal;
      if (!adapter.saveBookmark || !signal) return;
      const page = s.book.text.slice(0, anchor).split('\f').length - 1;
      bookmarkQueue.current = bookmarkQueue.current.then(async () => {
        if (!signal.aborted) await adapter.saveBookmark!(id, page, signal);
      }).catch(() => { if (!signal.aborted) live.current.error('外部书签保存失败，仍可继续阅读。'); });
      return;
    }
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
    if (pages.length === s.pages.length && pages.every((page, i) => page.start === s.pages[i].start && page.end === s.pages[i].end && page.text === s.pages[i].text)) return;
    const anchor = s.pages[s.page]?.start ?? s.book?.anchor ?? 0;
    const page = Math.max(0, pages.findIndex((p, i) => anchor < p.end || i === pages.length - 1));
    s.pages = pages; s.page = page;
    if (s.phase === 'turn') { s.targetPage = page; s.phase = s.closeRequested || s.exit ? 'close' : 'reading'; s.progress = 0; }
    setView({ ...s });
  }, []);
  const tick = useCallback((dt: number) => {
    if (!Number.isFinite(dt) || dt <= 0) return;
    // The resident clock supplies visible elapsed time, independently of collision.
    // Carry the remainder across timed phases so low FPS cannot stretch each handoff.
    let remaining = dt;
    while (remaining > 0) {
      const s = flow.current, clips = motion.current;
      const duration = (clips && libraryMotionDuration(clips, s)) ?? times[s.phase];
      if (!duration) return; // Walking and reading wait for explicit input/arrival.
      // Compress the authored interaction modestly so reduced motion does not skip its foot plants and handoff.
      const rate = clips && s.book && s.phase !== 'shelving' ? .8 : .5;
      const seconds = live.current.reducedMotion ? Math.max(.28, duration * rate) : duration;
      const left = (1 - s.progress) * seconds;
      if (remaining < left) { s.progress += remaining / seconds; return; }
      remaining -= left;
      s.progress = 1;
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
          update({ phase: 'recenter', book: null, pages: [] }); break;
        }
        case 'shelving': update({ phase: 'catalog', book: null }); break;
        default: return;
      }
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
  const openForm = useCallback(() => {
    if (flow.current.phase !== 'catalog' || saving.current) return false;
    const capacity = remainingBookCapacity(dataRef.current);
    if (!capacity.canAdd) {
      live.current.error(capacity.fullReason!);
      return false;
    }
    update({ phase: 'form' });
    return true;
  }, [update]);
  const fail = useCallback(() => { live.current.error('人物加载失败，已将书籍恢复在架；请重试人物加载或刷新页面。'); update(initialFlow()); live.current.onReturn(); }, [update]);
  return { fail, data, view, flow, motion, tick, arrived, choose, turn, setPages, add, remove, openForm, closeForm: () => { if (!saving.current && flow.current.phase === 'form') update({ phase: 'catalog' }); }, back, dispatch, slots: BOOK_SLOTS };
}
export type LibraryController = ReturnType<typeof useLibrary>;
