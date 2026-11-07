import { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { CLOSED_OBJECT, type SleepSession, type WorldAction, type WorldActionContext, type WorldFeatureAdapters, type WorldMotion, type WorldObjectState, type WorldSceneId, type WorldTransition } from '../../types/world';

export function nextObjectState(previous: WorldObjectState, action: WorldAction): WorldObjectState {
  switch (action.kind) {
    case 'open': return { ...previous, open: !previous.open };
    case 'close': return { ...previous, open: false, active: false };
    case 'write': case 'plan': case 'read': return { ...previous, open: true, active: true, page: action.kind === 'read' && action.payload?.itemId && action.payload.itemId !== previous.itemId ? 0 : previous.page, itemId: action.payload?.itemId ?? action.objectId };
    case 'turn-page': return { ...previous, open: true, active: true, page: Math.max(0, action.payload?.value ?? previous.page + (action.payload?.direction ?? 1)) };
    case 'sleep': case 'sit': return { ...previous, active: !previous.active };
    case 'wake': case 'stand': return { ...previous, active: false };
    case 'toggle': return { ...previous, active: !previous.active, value: previous.active ? 0 : 1 };
    case 'insert': case 'select': return { ...previous, active: true, itemId: action.payload?.itemId };
    case 'eject': return { ...previous, active: false, itemId: undefined };
    case 'water': case 'pet': return { ...previous, value: previous.value + 1 };
    case 'travel': return { ...previous, open: true };
    default: return { ...previous };
  }
}
const FOCUS_ACTIONS: Record<string, true | undefined> = { inspect: true, read: true, write: true, plan: true, sleep: true, 'turn-page': true };
const EMPTY_TRANSITION: WorldTransition = { id: 0, phase: 'idle', action: null, fromScene: 'habitat', toScene: 'habitat' };
export function useWorldController(adapters?: WorldFeatureAdapters) {
  const [sceneId, setSceneId] = useState<WorldSceneId>('habitat');
  const [sceneObjects, setSceneObjects] = useState<Record<WorldSceneId, Record<string, WorldObjectState>>>({ habitat: { lamp: { ...CLOSED_OBJECT, active: true } }, observatory: { lamp: { ...CLOSED_OBJECT, active: true } } });
  const [focusedObject, setFocusedObject] = useState<string | null>(null);
  const [transition, setTransition] = useState<WorldTransition>(EMPTY_TRANSITION);
  const [error, setError] = useState<string | null>(null);
  const [gestureActive, setGestureActive] = useState(false);
  const [hover, setHover] = useState<{ id: string; hint: string } | null>(null);
  const motion = useRef<WorldMotion>({ progress: 0, sceneProgress: 0 });
  const live = useRef({ sceneId, sceneObjects, focusedObject });
  live.current = { sceneId, sceneObjects, focusedObject };
  const sequence = useRef(0);
  const pending = useRef<{ abort: AbortController; context: WorldActionContext; timeline?: gsap.core.Timeline; rollback: () => void } | null>(null);
  const adapterRef = useRef(adapters);
  adapterRef.current = adapters;
  const sleepSession = useRef<SleepSession | null>(null);
  const reducedMotion = useRef(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  const cancelPending = useCallback(() => {
    const current = pending.current;
    if (!current) return;
    pending.current = null;
    current.abort.abort();
    current.timeline?.kill();
    current.rollback();
    adapterRef.current?.actions?.[current.context.action.kind]?.cancel?.(current.context);
  }, []);
  useEffect(() => () => { cancelPending(); }, [cancelPending]);

  const onAction = useCallback(async (request: WorldAction) => {
    if (request.sceneId !== live.current.sceneId) return;
    const displayed = live.current;
    cancelPending();
    setGestureActive(false);
    setError(null);
    const snapshot = live.current;
    const previousSleep = sleepSession.current;
    const previous = snapshot.sceneObjects[request.sceneId][request.objectId] ?? { ...CLOSED_OBJECT };
    const visiblePrevious = displayed.sceneObjects[request.sceneId][request.objectId] ?? previous;
    let action = request;
    if (request.kind === 'sleep' && visiblePrevious.active) action = { ...request, kind: 'wake' };
    if ((request.kind === 'write' || request.kind === 'read') && visiblePrevious.open && displayed.focusedObject === request.objectId && (request.kind !== 'read' || !request.payload?.itemId || request.payload.itemId === visiblePrevious.itemId)) {
      action = { ...request, kind: 'turn-page', payload: { ...request.payload, direction: request.payload?.direction ?? 1 } };
    }
    const id = ++sequence.current;
    const abort = new AbortController();
    const context: WorldActionContext = { action, signal: abort.signal, transitionId: id, previous };
    const destination = action.kind === 'travel' ? action.payload?.destination ?? snapshot.sceneId : snapshot.sceneId;
    const rollback = () => {
      live.current = snapshot;
      sleepSession.current = previousSleep;
      setSceneObjects(snapshot.sceneObjects);
      setSceneId(snapshot.sceneId);
      setFocusedObject(snapshot.focusedObject);
      motion.current = { progress: 0, sceneProgress: 0 };
    };
    const transaction = { abort, context, rollback, timeline: undefined as gsap.core.Timeline | undefined };
    pending.current = transaction;
    setTransition({ id, phase: 'preparing', action, fromScene: snapshot.sceneId, toScene: destination });
    try {
      await adapterRef.current?.actions?.[action.kind]?.prepare?.(context);
      if (abort.signal.aborted) return;
      const followsVisibleState = ['toggle', 'open', 'sleep', 'sit', 'turn-page'].includes(action.kind);
      const next = nextObjectState(followsVisibleState ? visiblePrevious : previous, action);
      setSceneObjects(current => {
        const updated = { ...current[action.sceneId], [action.objectId]: next };
        if (action.kind === 'sleep' && next.active) updated.chair = { ...(updated.chair ?? CLOSED_OBJECT), active: false };
        if (action.kind === 'sit' && next.active) updated.bed = { ...(updated.bed ?? CLOSED_OBJECT), active: false };
        if (action.kind === 'travel') {
          for (const objectId of ['bed', 'chair']) if (updated[objectId]) updated[objectId] = { ...updated[objectId], active: false };
        }
        if (action.objectId === 'cabinet' && !next.open && updated['cabinet-item']) updated['cabinet-item'] = { ...updated['cabinet-item'], active: false, itemId: undefined };
        if (action.objectId === 'cabinet-item' && next.active) updated.cabinet = { ...(updated.cabinet ?? CLOSED_OBJECT), open: true };
        return { ...current, [action.sceneId]: updated };
      });
      if (FOCUS_ACTIONS[action.kind]) setFocusedObject(action.objectId);
      if (action.kind === 'wake' || action.kind === 'travel' || action.kind === 'sit' || (action.kind === 'close' && snapshot.focusedObject === action.objectId)) setFocusedObject(null);
      motion.current.progress = 0;
      motion.current.sceneProgress = 0;
      setTransition({ id, phase: action.kind === 'travel' ? 'leaving' : 'entering', action, fromScene: snapshot.sceneId, toScene: destination });
      const finish = async () => {
        try {
          await adapterRef.current?.actions?.[action.kind]?.commit?.(context);
          if (abort.signal.aborted) return;
          if (action.kind === 'sleep') {
            sleepSession.current = { startedAt: new Date().toISOString(), sceneId: action.sceneId };
            await adapterRef.current?.sleep?.onFallAsleep?.(sleepSession.current, abort.signal);
          } else if ((action.kind === 'wake' || action.kind === 'sit' || action.kind === 'travel') && sleepSession.current) {
            await adapterRef.current?.sleep?.onWake?.({ ...sleepSession.current, endedAt: new Date().toISOString() }, abort.signal);
            if (!abort.signal.aborted) sleepSession.current = null;
          }
          if (abort.signal.aborted) return;
          setSceneId(destination);
          setTransition({ id, phase: 'active', action, fromScene: destination, toScene: destination });
          pending.current = null;
        } catch (failure) {
          if (abort.signal.aborted) return;
          rollback();
          pending.current = null;
          setError(failure instanceof Error ? failure.message : '这次操作没有完成，请再试一次。');
          setTransition({ id, phase: 'error', action: null, fromScene: snapshot.sceneId, toScene: snapshot.sceneId });
        }
      };
      const duration = reducedMotion.current ? 0.12 : action.kind === 'travel' ? 1.8 : 0.9;
      transaction.timeline = gsap.timeline({ onComplete: () => { void finish(); } });
      transaction.timeline.to(motion.current, { progress: 1, sceneProgress: 1, duration, ease: 'power2.inOut' });
      if (action.kind === 'travel') transaction.timeline.call(() => {
        if (!abort.signal.aborted) setTransition(current => ({ ...current, phase: 'entering' }));
      }, [], duration * 0.52);
    } catch (failure) {
      if (abort.signal.aborted) return;
      rollback();
      pending.current = null;
      setError(failure instanceof Error ? failure.message : '暂时无法打开这个物品。');
      setTransition({ id, phase: 'error', action: null, fromScene: snapshot.sceneId, toScene: snapshot.sceneId });
    }
  }, [cancelPending]);

  const onReturn = useCallback(() => {
    cancelPending();
    const current = live.current;
    if (current.focusedObject === 'bed' && current.sceneObjects[current.sceneId].bed?.active) {
      void onAction({ sceneId: current.sceneId, objectId: 'bed', kind: 'wake' });
      return;
    }
    if (current.focusedObject) setSceneObjects(all => ({ ...all, [current.sceneId]: { ...all[current.sceneId], [current.focusedObject!]: { ...(all[current.sceneId][current.focusedObject!] ?? CLOSED_OBJECT), open: false, active: false } } }));
    setFocusedObject(null);
    setGestureActive(false);
    const id = ++sequence.current;
    const abort = new AbortController();
    const action: WorldAction = { sceneId: current.sceneId, objectId: current.focusedObject ?? 'room', kind: 'close' };
    const context = { action, signal: abort.signal, transitionId: id, previous: { ...CLOSED_OBJECT } };
    motion.current.progress = 0;
    setTransition({ id, phase: 'returning', action, fromScene: current.sceneId, toScene: current.sceneId });
    const timeline = gsap.timeline({ onComplete: () => { pending.current = null; setTransition({ id, phase: 'idle', action: null, fromScene: current.sceneId, toScene: current.sceneId }); } });
    pending.current = { abort, context, timeline, rollback: () => {} };
    timeline.to(motion.current, { progress: 1, duration: reducedMotion.current ? 0.1 : 0.8, ease: 'power2.inOut' });
  }, [cancelPending, onAction]);

  const onHover = useCallback((id: string | null, hint = '') => setHover(id ? { id, hint } : null), []);
  return { sceneId, sceneObjects, objects: sceneObjects[sceneId], focusedObject, transition, motion, onAction, onReturn, onHover, hover, gestureActive, onGesture: setGestureActive, error, setError, reducedMotion: reducedMotion.current };
}
