import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { WorldFeatureAdapters } from '../../../types/world';
import { flattenSchedule, allSchedulePages, isScheduleEntry, migrateSchedule, upgradeSchedule, LEGACY_SCHEDULE_KEY, SCHEDULE_KEY, type ScheduleNotebook } from './schedule';

interface ScheduleContextValue {
  state: ScheduleNotebook;
  ready: boolean;
  error: string;
  commit: (next: ScheduleNotebook | ((current: ScheduleNotebook) => ScheduleNotebook), options?: { retainDraftOnError?: boolean }) => boolean;
  retry: () => void;
}
const ScheduleContext = createContext<ScheduleContextValue | null>(null);
export function useSchedule() {
  const value = useContext(ScheduleContext);
  if (!value) throw new Error('ScheduleProvider is required');
  return value;
}
export function ScheduleProvider({ adapters, children }: { adapters?: WorldFeatureAdapters; children: React.ReactNode }) {
  const [state, setState] = useState(migrateSchedule);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(state);
  const loaded = useRef(false);
  const remoteUnread = useRef(true);
  const remoteQueue = useRef(Promise.resolve());
  const lifetime = useRef<AbortController>();
  const remote = adapters?.schedule;
  const sync = useCallback((next: ScheduleNotebook) => {
    if (!remote) return;
    if (remoteUnread.current) {
      setError('远程日程暂时无法读取，本机记录已保存。请重试同步。');
      return;
    }
    const signal = lifetime.current?.signal;
    if (!signal) return;
    remoteQueue.current = remoteQueue.current.then(async () => {
      if (signal.aborted || next !== latest.current) return;
      try {
        await remote.save(flattenSchedule(next), signal);
        if (!signal.aborted && next === latest.current) {
          const saved = { ...next, syncPending: false, syncRemovedIds: [] };
          localStorage.setItem(SCHEDULE_KEY, JSON.stringify(saved));
          latest.current = saved; setState(saved);
          setError('');
        }
      } catch {
        if (!signal.aborted) setError('远程同步未完成，本机记录仍在。请重试同步。');
      }
    });
  }, [remote]);
  useEffect(() => {
    const abort = new AbortController();
    lifetime.current = abort;
    remoteUnread.current = !!remote;
    setReady(false);
    setError('');
    void (async () => {
      try {
        const raw = localStorage.getItem(SCHEDULE_KEY) ?? localStorage.getItem(LEGACY_SCHEDULE_KEY);
        const saved: unknown = raw ? JSON.parse(raw) : null;
        if (raw && !upgradeSchedule(saved)) throw new Error('日程存档格式无法读取，原始存档已保留。');
        let next = loaded.current ? latest.current : upgradeSchedule(saved);
        const legacyRaw = !next && !remote ? localStorage.getItem('pocketworld:schedule') : null;
        let entries: unknown = [];
        let offline = false;
        try {
          entries = remote ? await remote.load(abort.signal) : legacyRaw ? JSON.parse(legacyRaw) : [];
        } catch (failure) { if (!next) throw failure; offline = true; }
        if (!Array.isArray(entries) || !entries.every(isScheduleEntry)) throw new Error('旧日程无法读取，原始记录已保留。');
        if (abort.signal.aborted) return;
        remoteUnread.current = offline;
        if (!next) next = migrateSchedule(entries);
        else if (remote && !offline) {
          const byId = new Map(entries.map(entry => [entry.id, entry]));
          const merge = (page: ScheduleNotebook['current']) => ({ ...page, entries: page.entries.map(entry => ({ ...entry, ...byId.get(entry.id) })) as ScheduleNotebook['current']['entries'] });
          if (!next.syncPending) next = { ...next, current: merge(next.current), posted: next.posted.map(merge), queued: next.queued.map(merge), archive: next.archive.map(merge) };
          const known = new Set([...flattenSchedule(next).map(entry => entry.id), ...(next.syncRemovedIds ?? [])]);
          const extras = entries.filter(entry => !known.has(entry.id));
          if (extras.length) {
            const recovered = migrateSchedule(extras);
            const number = Math.max(...allSchedulePages(next).map(p => p.number));
            const recoveredPages = [recovered.current, ...recovered.queued].map((page, index) => ({ ...page, number: number + index + 1 }));
            next = { ...next, queued: [...next.queued, ...recoveredPages] };
          }
        }
        latest.current = next;
        loaded.current = true;
        setState(next);
        setReady(true);
        try { localStorage.setItem(SCHEDULE_KEY, JSON.stringify(next)); }
        catch { setError('本机保存失败，草稿暂存在当前页面。请重试保存后再离开。'); return; }
        if (offline) setError('远程日程暂时无法读取，已恢复本机记录。');
        else if (next.syncPending) sync(next);
      } catch (failure) {
        if (!abort.signal.aborted) setError(failure instanceof SyntaxError ? '日程存档格式无法读取，原始存档已保留。' : failure instanceof Error ? failure.message : '日程暂时无法读取，请重试。');
      }
    })();
    return () => abort.abort();
  }, [remote, attempt, sync]);
  const commit = useCallback((next: ScheduleNotebook | ((current: ScheduleNotebook) => ScheduleNotebook), options?: { retainDraftOnError?: boolean }) => {
    if (!ready) return false;
    next = { ...(typeof next === 'function' ? next(latest.current) : next), syncPending: !!remote };
    if (remote) {
      const remaining = new Set(flattenSchedule(next).map(entry => entry.id));
      const removed = flattenSchedule(latest.current).filter(entry => !remaining.has(entry.id)).map(entry => entry.id);
      next.syncRemovedIds = [...new Set([...(latest.current.syncRemovedIds ?? []), ...removed])];
    }
    try { localStorage.setItem(SCHEDULE_KEY, JSON.stringify(next)); }
    catch {
      if (options?.retainDraftOnError) { latest.current = next; setState(next); }
      setError('本机保存失败，草稿暂存在当前页面。请重试保存后再离开。');
      return false;
    }
    latest.current = next;
    setState(next);
    setError('');
    sync(next);
    return true;
  }, [ready, sync]);
  const retry = () => ready && !remote ? commit(latest.current) : setAttempt(value => value + 1);
  return <ScheduleContext.Provider value={{ state, ready, error, commit, retry }}>{children}</ScheduleContext.Provider>;
}
