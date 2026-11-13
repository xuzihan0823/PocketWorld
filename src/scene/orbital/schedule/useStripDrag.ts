import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import gsap from 'gsap';
import { BOOK_POSITION } from './bookLayout';
import { finishStripGesture, moveStripGesture, startStripGesture, type StripGesture } from './stripState';
import { scheduleTaskError, type ScheduleTask, type StripPlacement } from './schedule';
import { STRIP_WIDTH, STRIP_HEIGHT, type MovingStrip } from './TaskStrip';

interface HeldStrip {
  pointerId: number; x: number; y: number; gesture: StripGesture; task: ScheduleTask; date: string;
  element?: HTMLElement; capture?: Element; original?: StripPlacement; center: THREE.Vector3; offset: THREE.Vector3;
}
export function useStripDrag({ root, targets, enabled, reducedMotion, onGesture, onError, onPlace }: {
  root: RefObject<THREE.Group>; targets: RefObject<THREE.Group>; enabled: boolean; reducedMotion: boolean;
  onGesture: (value: boolean) => void; onError: (text: string) => void;
  onPlace: (id: string, placement: StripPlacement | null) => boolean;
}) {
  const { camera, gl, scene } = useThree();
  const blockers = useRef<THREE.Object3D[]>([]);
  const [active, setActive] = useState<{ id: string; phase: string } | null>(null);
  const moving = useRef<MovingStrip | null>(null), held = useRef<HeldStrip | null>(null);
  const latest = useRef({ enabled, onGesture, onError, onPlace, reducedMotion }); latest.current = { enabled, onGesture, onError, onPlace, reducedMotion };
  const math = useMemo(() => ({ ray: new THREE.Raycaster(), obstruction: new THREE.Raycaster(), pointer: new THREE.Vector2(), plane: new THREE.Plane(), point: new THREE.Vector3(), world: new THREE.Vector3() }), []);
  const ray = (x: number, y: number) => {
    const rect = gl.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    math.pointer.set((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2);
    math.ray.setFromCamera(math.pointer, camera); return true;
  };
  const onPlane = (x: number, y: number) => {
    if (!root.current || !ray(x, y)) return null;
    math.world.set(0, BOOK_POSITION[1] + 0.035, 0); root.current.localToWorld(math.world);
    math.plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 1, 0), math.world);
    if (!math.ray.ray.intersectPlane(math.plane, math.point)) return null;
    return root.current.worldToLocal(math.point).clone();
  };
  const detect = (x: number, y: number): { kind: 'book' | 'desk' | 'glass'; placement?: StripPlacement } | null => {
    if (!targets.current || !root.current || !ray(x, y)) return null;
    targets.current.updateWorldMatrix(true, true);
    const hits = math.ray.intersectObjects(targets.current.children, false);
    for (const hit of hits) {
      const kind = hit.object.userData.surface as 'book' | 'desk' | 'glass';
      const p = root.current.worldToLocal(hit.point.clone());
      if (kind === 'book') return { kind };
      if (kind === 'desk') {
        // Keep the complete slip on the desk; avoid the computer/keyboard area.
        if (p.x < -0.70 + STRIP_WIDTH / 2 || p.x > 0.93 - STRIP_WIDTH / 2 || p.z < -2.93 + STRIP_HEIGHT / 2 || p.z > -1.70 - STRIP_HEIGHT / 2) continue;
        // A slip must not land half under the open book.
        if (Math.abs(p.x - 0.55) < 0.36 && Math.abs(p.z + 1.96) < 0.23) return { kind: 'book' };
        p.y = 1.126;
        for (const [dx, dz] of [[0, 0], [-STRIP_WIDTH / 2, -STRIP_HEIGHT / 2], [STRIP_WIDTH / 2, -STRIP_HEIGHT / 2], [-STRIP_WIDTH / 2, STRIP_HEIGHT / 2], [STRIP_WIDTH / 2, STRIP_HEIGHT / 2]]) {
          const probe = root.current.localToWorld(new THREE.Vector3(p.x + dx, p.y + 0.4, p.z + dz));
          math.obstruction.set(probe, new THREE.Vector3(0, -1, 0)); math.obstruction.far = 0.398;
          if (math.obstruction.intersectObjects(blockers.current, true).some(h => h.object.visible)) return null;
        }
      } else p.z = -3.375;
      return { kind, placement: { surface: kind, position: p.toArray() as [number, number, number], rotation: moving.current?.rotation ?? 0 } };
    }
    return null;
  };
  const clean = (rollback: boolean) => {
    const h = held.current; held.current = null;
    if (h?.element) {
      const element = h.element;
      gsap.killTweensOf(element);
      if (rollback) gsap.to(element, { '--peel': 0, x: 0, y: 0, rotateX: 0, rotateY: 0, rotateZ: 0, duration: latest.current.reducedMotion ? 0 : 0.3, ease: 'power3.out', onComplete: () => { element.style.transform = ''; element.dataset.peeling = 'false'; } });
      else { element.style.transform = ''; element.style.setProperty('--peel', '0'); element.dataset.peeling = 'false'; }
      element.style.visibility = '';
    }
    if (h?.capture?.hasPointerCapture(h.pointerId)) h.capture.releasePointerCapture(h.pointerId);
    moving.current = null; setActive(null); latest.current.onGesture(false);
  };
  const start = (event: PointerEvent, task: ScheduleTask, date: string, element?: HTMLElement, original?: StripPlacement) => {
    if (!latest.current.enabled || event.button !== 0 || !event.isPrimary || held.current) return;
    const error = scheduleTaskError(task); if (error) { latest.current.onError(error); return; }
    event.preventDefault(); event.stopPropagation();
    blockers.current = [...scene.getObjectsByProperty('name', 'MediaObjects'), ...scene.getObjectsByProperty('name', 'Furniture_Workbench')];
    (document.activeElement as HTMLElement)?.blur?.();
    const center = original ? new THREE.Vector3(...original.position) : (() => {
      const rect = element!.getBoundingClientRect(); return onPlane(rect.x + rect.width / 2, rect.y + rect.height / 2) ?? new THREE.Vector3(...BOOK_POSITION);
    })();
    const point = onPlane(event.clientX, event.clientY) ?? center;
    const capture = event.target instanceof Element ? event.target : undefined;
    const gesture = startStripGesture(task.id, !!original);
    held.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, gesture, task, date, element, capture, original, center, offset: center.clone().sub(point) };
    moving.current = { gesture, task, date, position: center.clone(), rotation: original?.rotation ?? 0, lift: 0, target: null };
    capture?.setPointerCapture(event.pointerId);
    latest.current.onGesture(true); setActive({ id: task.id, phase: gesture.phase });
    if (element) { gsap.killTweensOf(element); element.dataset.peeling = 'true'; }
  };
  const detectMoving = () => {
    if (!moving.current || !root.current) return null;
    const screen = root.current.localToWorld(moving.current.position.clone()).project(camera);
    const rect = gl.domElement.getBoundingClientRect();
    return detect(rect.left + (screen.x + 1) * rect.width / 2, rect.top + (1 - screen.y) * rect.height / 2);
  };
  const callbacks = useRef({ clean, detectMoving, onPlane }); callbacks.current = { clean, detectMoving, onPlane };
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const h = held.current, model = moving.current;
      if (!h || !model || h.pointerId !== event.pointerId) return;
      event.preventDefault();
      const dx = event.clientX - h.x, dy = event.clientY - h.y;
      const previous = h.gesture.phase;
      h.gesture = moveStripGesture(h.gesture, Math.hypot(dx, dy)); model.gesture = h.gesture;
      if (h.gesture.phase !== previous) setActive({ id: h.task.id, phase: h.gesture.phase });
      if (h.gesture.phase === 'peeling' && h.element) {
        const p = h.gesture.progress, rect = h.element.getBoundingClientRect();
        h.element.style.setProperty('--peel', String(p));
        const scale = h.element.offsetWidth / Math.max(rect.width, 1);
        h.element.style.transform = `translate(${dx * scale * 0.18}px, ${dy * scale * 0.22}px) rotateY(${latest.current.reducedMotion ? 0 : -p * 16}deg) rotateX(${latest.current.reducedMotion ? 0 : p * 12}deg) rotateZ(${dx * 0.012}deg)`;
        return;
      }
      if (previous === 'peeling' && h.element) {
        const rect = h.element.getBoundingClientRect();
        const center = callbacks.current.onPlane(rect.x + rect.width / 2, rect.y + rect.height / 2);
        const pointer = callbacks.current.onPlane(event.clientX, event.clientY);
        if (center && pointer) h.offset.copy(center).sub(pointer);
      }
      if (h.element) h.element.style.visibility = 'hidden';
      const point = callbacks.current.onPlane(event.clientX, event.clientY);
      if (point) model.position.copy(point).add(h.offset);
      model.rotation = (h.original?.rotation ?? 0) + THREE.MathUtils.clamp(dx * 0.0007, -0.12, 0.12);
      model.lift = 1;
      model.target = callbacks.current.detectMoving()?.kind ?? null;
    };
    const finish = (event: PointerEvent) => {
      const h = held.current; if (!h || event.pointerId !== h.pointerId) return;
      const target = callbacks.current.detectMoving();
      const phase = finishStripGesture(h.gesture, target?.kind === 'book' ? 'book' : target ? 'surface' : null, event.type === 'pointercancel');
      let saved = false;
      if (h.gesture.phase !== 'peeling' && event.type !== 'pointercancel' && target) {
        saved = latest.current.onPlace(h.task.id, phase === 'attached' ? null : target.placement!);
      }
      if (!target && h.gesture.phase !== 'peeling' && event.type !== 'pointercancel') latest.current.onError('请放在桌面的空处，或拖回原书页。');
      callbacks.current.clean(!saved);
    };
    const cancel = () => { if (held.current) callbacks.current.clean(true); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && held.current) { event.preventDefault(); event.stopPropagation(); cancel(); } };
    const visibility = () => { if (document.hidden) cancel(); };
    window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('pointerup', finish); window.addEventListener('pointercancel', finish);
    window.addEventListener('lostpointercapture', cancel); window.addEventListener('blur', cancel); window.addEventListener('keydown', key, true); document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish);
      window.removeEventListener('lostpointercapture', cancel); window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key, true); document.removeEventListener('visibilitychange', visibility);
      const element = held.current?.element; cancel(); if (element) gsap.killTweensOf(element);
    };
  }, []);
  useEffect(() => { if (!enabled && held.current) clean(true); }, [enabled]);
  return { active, moving, start, cancel: () => clean(true) };
}
