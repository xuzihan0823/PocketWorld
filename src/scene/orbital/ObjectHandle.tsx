import React, { useEffect, useRef } from 'react';
import type { ThreeElements, ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { SCENE_ORIGINS, type WorldAction, type WorldActionKind, type WorldModelProps } from '../../types/world';

interface ObjectHandleProps extends Omit<ThreeElements['group'], 'id' | 'onPointerDown' | 'onPointerUp' | 'onPointerMove'> {
  id: string;
  action: WorldActionKind;
  hint: string;
  world: WorldModelProps;
  drag?: 'x' | 'y' | 'z';
  payload?: WorldAction['payload'];
}
function belongsToFocus(id: string, focused: string | null) {
  if (!focused) return false;
  if (id === focused) return true;
  if (focused === 'computer') return id.startsWith('game-') || id === 'computer-exit' || id === 'music-mute';
  if (focused === 'music-player') return id.startsWith('music-');
  if (focused === 'cabinet') return id === 'cabinet-item';
  return false;
}

/** A real object's input ownership, not an invisible menu hotspot. */
export function ObjectHandle({ id, action, hint, world, drag, payload, children, onClick, ...props }: ObjectHandleProps) {
  const held = useRef<{ x: number; y: number; pointerId: number; target: EventTarget | null; point: [number, number, number] } | null>(null);
  const movable = useRef<THREE.Group>(null);
  const callbacks = useRef(world);
  callbacks.current = world;
  const release = () => {
    if (!held.current) return;
    const { target, pointerId } = held.current;
    try { (target as Element)?.releasePointerCapture?.(pointerId); } catch { /* Pointer already released by browser. */ }
    held.current = null;
    if (movable.current) movable.current.position.set(0, 0, 0);
    callbacks.current.onGesture(false);
  };
  useEffect(() => {
    const cancel = () => release();
    window.addEventListener('blur', cancel);
    window.addEventListener('pointercancel', cancel);
    return () => { cancel(); window.removeEventListener('blur', cancel); window.removeEventListener('pointercancel', cancel); };
  }, []);
  const enabled = belongsToFocus(id, world.focusedObject);
  useEffect(() => { if (!enabled) release(); }, [enabled]);
  const down = (event: ThreeEvent<PointerEvent>) => {
    if (!enabled || event.button !== 0 || held.current) return;
    event.stopPropagation();
    const origin = SCENE_ORIGINS[world.sceneId];
    const point: [number, number, number] = [event.point.x - origin[0], event.point.y - origin[1], event.point.z - origin[2]];
    held.current = { x: event.clientX, y: event.clientY, pointerId: event.pointerId, target: event.target, point };
    (event.target as Element).setPointerCapture?.(event.pointerId);
    world.onGesture(true);
    world.onHover(id, hint);
  };
  const up = (event: ThreeEvent<PointerEvent>) => {
    if (!held.current || event.pointerId !== held.current.pointerId) return;
    event.stopPropagation();
    const distance = Math.hypot(event.clientX - held.current.x, event.clientY - held.current.y);
    const direction = event.clientX >= held.current.x ? 1 : -1;
    const point = held.current.point;
    release();
    if (enabled && (distance < 9 || drag)) {
      const request: WorldAction = { sceneId: world.sceneId, objectId: id, kind: action, payload: { ...payload, ...(distance > 9 ? { direction } : {}) } };
      const perform = () => callbacks.current.onAction(request);
      if (world.onApproach) world.onApproach(point, request, perform); else perform();
    }
  };
  return <group {...props} name={`Interactable_${id}`} userData={{ objectId: id, action, sceneId: world.sceneId }}
    onPointerOver={e => { if (enabled) { e.stopPropagation(); world.onHover(id, hint); } }}
    onPointerOut={() => { if (enabled && !held.current) world.onHover(null); }}
    onClick={enabled ? onClick : undefined}
    onPointerDown={down} onPointerUp={up}
    onPointerMove={event => {
      if (!held.current || !drag || !movable.current) return;
      event.stopPropagation();
      movable.current.position[drag] = THREE.MathUtils.clamp((drag === 'y' ? held.current.y - event.clientY : event.clientX - held.current.x) * 0.002, -0.15, 0.15);
    }}>
    <group ref={movable}>{children}</group>
  </group>;
}
