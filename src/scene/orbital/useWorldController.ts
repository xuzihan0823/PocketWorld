import { useCallback, useEffect, useRef, useState } from 'react';
import gsap from 'gsap';
import { roomAudio } from '../audioEngine';
import { initialOutfit, isOutfit, rememberOutfit, type ResidentOutfit } from './wardrobe/outfit';
import { CLOSED_OBJECT, type WorldAction, type WorldActionContext, type WorldFeatureAdapters, type WorldMotion, type WorldObjectState, type WorldSceneId, type WorldTransition } from '../../types/world';

export function nextObjectState(previous: WorldObjectState, action: WorldAction): WorldObjectState {
  switch (action.kind) {
    case 'open': return { ...previous, open: !previous.open };
    case 'close': return { ...previous, open: false, active: false };
    case 'write': case 'plan': case 'read': return { ...previous, open: true, active: true, page: action.kind === 'read' && action.payload?.itemId && action.payload.itemId !== previous.itemId ? 0 : previous.page, itemId: action.payload?.itemId ?? action.objectId };
    case 'turn-page': return { ...previous, open: true, active: true, page: Math.max(0, action.payload?.value ?? previous.page + (action.payload?.direction ?? 1)) };
    case 'sit': return { ...previous, active: !previous.active };
    case 'stand': return { ...previous, active: false };
    case 'toggle': return { ...previous, active: !previous.active, value: previous.active ? 0 : 1 };
    case 'insert': case 'select': return { ...previous, active: true, itemId: action.payload?.itemId };
    case 'eject': return { ...previous, active: false, itemId: undefined };
    case 'pet': return { ...previous, value: previous.value + 1, itemId: action.payload?.itemId };
    case 'travel': return { ...previous, open: true };
    default: return { ...previous };
  }
}
const FOCUS_ACTIONS: Record<string, true | undefined> = { inspect: true, read: true, write: true, plan: true, 'turn-page': true };
const EMPTY_TRANSITION: WorldTransition = { id: 0, phase: 'idle', action: null, fromScene: 'habitat', toScene: 'habitat' };
export function useWorldController(adapters?: WorldFeatureAdapters) {
  const [sceneId, setSceneId] = useState<WorldSceneId>('habitat');
  const [sceneObjects, setSceneObjects] = useState<Record<WorldSceneId, Record<string, WorldObjectState>>>(() => ({
    habitat: { lamp: { ...CLOSED_OBJECT, active: true }, wardrobe: { ...CLOSED_OBJECT, itemId: initialOutfit() } },
    observatory: { lamp: { ...CLOSED_OBJECT, active: true } },
  }));
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
  const mountingOutfit = useRef<{ outfit: ResidentOutfit; resolve: (ready: boolean) => void } | null>(null);
  const onOutfitMounted = useCallback((outfit: ResidentOutfit, ready: boolean) => {
    if (mountingOutfit.current?.outfit === outfit) mountingOutfit.current.resolve(ready);
  }, []);
  const adapterRef = useRef(adapters);
  adapterRef.current = adapters;
  const reducedMotion = useRef(typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches);

  const cancelPending = useCallback(() => {
    const current = pending.current;
    if (!current) return;
    pending.current = null;
    mountingOutfit.current?.resolve(false);
    mountingOutfit.current = null;
    current.abort.abort();
    current.timeline?.kill();
    current.rollback();
    adapterRef.current?.actions?.[current.context.action.kind]?.cancel?.(current.context);
  }, []);
  useEffect(() => () => { cancelPending(); }, [cancelPending]);

  const onAction = useCallback(async (request: WorldAction) => {
    if (request.sceneId !== live.current.sceneId) return;
    const displayed = live.current;
    const wardrobe = request.sceneId === 'habitat' && request.objectId === 'wardrobe';
    const choice = request.payload?.itemId;
    const outfit = wardrobe && request.kind === 'select' && isOutfit(choice) ? choice : null;
    if (wardrobe) {
      if (request.kind === 'open' && displayed.focusedObject === 'wardrobe') return;
      if (request.kind === 'select' && (!outfit || displayed.focusedObject !== 'wardrobe'
        || !displayed.sceneObjects.habitat.wardrobe.open || outfit === displayed.sceneObjects.habitat.wardrobe.itemId
        || pending.current)) return;
    }
    cancelPending();
    setGestureActive(false);
    setError(null);
    const snapshot = live.current;
    const previous = snapshot.sceneObjects[request.sceneId][request.objectId] ?? { ...CLOSED_OBJECT };
    const visiblePrevious = displayed.sceneObjects[request.sceneId][request.objectId] ?? previous;
    let action = request;
    if ((request.kind === 'write' || request.kind === 'read') && visiblePrevious.open && displayed.focusedObject === request.objectId && (request.kind !== 'read' || !request.payload?.itemId || request.payload.itemId === visiblePrevious.itemId)) {
      action = { ...request, kind: 'turn-page', payload: { ...request.payload, direction: request.payload?.direction ?? 1 } };
    }
    const id = ++sequence.current;
    const abort = new AbortController();
    const context: WorldActionContext = { action, signal: abort.signal, transitionId: id, previous };
    const destination = action.kind === 'travel' ? action.payload?.destination ?? snapshot.sceneId : snapshot.sceneId;
    const rollback = () => {
      live.current = snapshot;
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
      // ResidentModel owns loading and reports after the new rig has actually mounted.
      const mounted = outfit && new Promise<boolean>(resolve => { mountingOutfit.current = { outfit, resolve }; });
      const followsVisibleState = ['toggle', 'open', 'sit', 'turn-page'].includes(action.kind);
      const next = outfit ? { ...visiblePrevious, open: false, itemId: outfit } : nextObjectState(followsVisibleState ? visiblePrevious : previous, action);
      if (action.objectId === 'lamp' && action.kind === 'toggle') {
        roomAudio.playSfx(next.active ? 'lamp-on' : 'lamp-off');
      }
      setSceneObjects(current => {
        const updated = { ...current[action.sceneId], [action.objectId]: next };
        const takingSeat = action.kind === 'sit' && next.active;
        if (takingSeat || action.kind === 'travel' || action.objectId === 'book-01') {
          for (const id of ['chair', 'sofa']) {
            if (id !== action.objectId && updated[id]?.active) updated[id] = { ...updated[id], active: false };
          }
        }
        if (action.objectId === 'book-01') { updated.cabinet = { ...(updated.cabinet ?? CLOSED_OBJECT), open: false }; if (updated['cabinet-item']) updated['cabinet-item'] = { ...updated['cabinet-item'], active: false }; }
        if (action.objectId === 'cabinet' && !next.open && updated['cabinet-item']) updated['cabinet-item'] = { ...updated['cabinet-item'], active: false, itemId: undefined };
        if (action.objectId === 'cabinet-item' && next.active) updated.cabinet = { ...(updated.cabinet ?? CLOSED_OBJECT), open: true };
        return { ...current, [action.sceneId]: updated };
      });
      if (FOCUS_ACTIONS[action.kind] || ((wardrobe || action.objectId === 'cabinet') && action.kind === 'open' && next.open)) setFocusedObject(action.objectId);
      if (action.kind === 'travel' || action.kind === 'sit' || (action.kind === 'close' && snapshot.focusedObject === action.objectId)) setFocusedObject(null);
      motion.current.progress = 0;
      motion.current.sceneProgress = 0;
      setTransition({ id, phase: action.kind === 'travel' ? 'leaving' : 'entering', action, fromScene: snapshot.sceneId, toScene: destination });
      const finish = async () => {
        try {
          if (mounted) {
            const ready = await mounted;
            if (abort.signal.aborted) return;
            mountingOutfit.current = null;
            if (!ready) throw new Error('这套衣服加载失败，请再试一次。');
          }
          await adapterRef.current?.actions?.[action.kind]?.commit?.(context);
          if (abort.signal.aborted) return;
          if (outfit) rememberOutfit(outfit);
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
      const duration = outfit ? .95 : reducedMotion.current ? 0.12 : action.kind === 'travel' ? 1.8 : 0.9;
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
    if (current.focusedObject === 'wardrobe') setError(null);
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
  }, [cancelPending]);

  const onHover = useCallback((id: string | null, hint = '') => setHover(id ? { id, hint } : null), []);
  return { sceneId, sceneObjects, objects: sceneObjects[sceneId], focusedObject, transition, motion, onAction, onReturn, onHover, hover, onOutfitMounted, gestureActive, onGesture: setGestureActive, error, setError, reducedMotion: reducedMotion.current };
}
