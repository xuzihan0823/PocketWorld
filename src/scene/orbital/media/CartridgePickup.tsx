import React, { useEffect, useMemo, useRef } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldModelProps } from '../../../types/world';
import { CARTRIDGE_SLOT, cartridgeDragState, type CartridgePoint } from './cartridge-motion';

interface Props {
  id: string;
  position: CartridgePoint;
  enabled: boolean;
  world: WorldModelProps;
  onGrab: () => boolean;
  onNearSlot: (near: boolean) => void;
  onDrop: (point: CartridgePoint, insert: boolean) => void;
  onInspect: () => void;
  children: React.ReactNode;
}

/** Own the pointer until release, including when it crosses the HTML game screen. */
export function CartridgePickup(props: Props) {
  const { camera, gl } = useThree();
  const root = useRef<THREE.Group>(null), movable = useRef<THREE.Group>(null);
  const latest = useRef(props); latest.current = props;
  const held = useRef<{ id: number; x: number; y: number; offset: THREE.Vector3; point: CartridgePoint; moved: boolean; near: boolean; release: () => void } | null>(null);
  const math = useMemo(() => ({ ray: new THREE.Raycaster(), pointer: new THREE.Vector2(), plane: new THREE.Plane(), hit: new THREE.Vector3(), origin: new THREE.Vector3() }), []);
  const project = (x: number, y: number) => {
    const parent = root.current?.parent;
    if (!parent) return null;
    parent.updateWorldMatrix(true, false);
    math.origin.set(0, 0, CARTRIDGE_SLOT[2]).applyMatrix4(parent.matrixWorld);
    math.plane.setFromNormalAndCoplanarPoint(new THREE.Vector3(0, 0, 1).transformDirection(parent.matrixWorld), math.origin);
    const rect = gl.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    math.pointer.set((x - rect.left) / rect.width * 2 - 1, 1 - (y - rect.top) / rect.height * 2);
    camera.updateMatrixWorld();
    math.ray.setFromCamera(math.pointer, camera);
    if (!math.ray.ray.intersectPlane(math.plane, math.hit)) return null;
    return parent.worldToLocal(math.hit);
  };
  const move = (event: PointerEvent) => {
    const current = held.current;
    if (!current || current.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - current.x, event.clientY - current.y) >= 9) current.moved = true;
    if (!current.moved) return;
    const point = project(event.clientX, event.clientY);
    if (!point) return;
    const intended = point.add(current.offset).toArray() as CartridgePoint;
    intended[2] = CARTRIDGE_SLOT[2];
    const placement = cartridgeDragState(intended);
    current.point = placement.point;
    movable.current?.position.set(...current.point.map((value, axis) => value - latest.current.position[axis]) as CartridgePoint);
    const near = placement.nearSlot;
    if (near !== current.near) { current.near = near; latest.current.onNearSlot(near); }
  };
  const finish = (cancelled: boolean, event?: PointerEvent) => {
    if (!held.current || (event && event.pointerId !== held.current.id)) return;
    if (!cancelled && event) move(event);
    const current = held.current;
    held.current = null;
    current.release();
    movable.current?.position.set(0, 0, 0);
    latest.current.world.onGesture(false);
    latest.current.onDrop(current.point, !cancelled && current.moved && current.near);
    if (!cancelled && !current.moved) latest.current.onInspect();
  };
  const handlers = useRef({ move, finish }); handlers.current = { move, finish };
  useEffect(() => {
    const move = (event: PointerEvent) => handlers.current.move(event);
    const up = (event: PointerEvent) => handlers.current.finish(false, event);
    const cancel = (event: PointerEvent) => handlers.current.finish(true, event);
    const blur = () => handlers.current.finish(true);
    window.addEventListener('pointermove', move, true);
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', cancel, true);
    window.addEventListener('blur', blur);
    gl.domElement.addEventListener('lostpointercapture', cancel);
    return () => {
      window.removeEventListener('pointermove', move, true);
      window.removeEventListener('pointerup', up, true);
      window.removeEventListener('pointercancel', cancel, true);
      window.removeEventListener('blur', blur);
      gl.domElement.removeEventListener('lostpointercapture', cancel);
      handlers.current.finish(true);
    };
  }, []);
  useEffect(() => { if (!props.enabled) handlers.current.finish(true); }, [props.enabled]);
  const down = (event: ThreeEvent<PointerEvent>) => {
    if (event.button !== 0 || held.current || !props.enabled) return;
    event.stopPropagation();
    if (props.world.onApproach) {
      const focused = props.world.focusedObject === 'computer';
      const ready = props.world.onApproach(props.position, { sceneId: props.world.sceneId, objectId: 'computer', kind: 'inspect' }, focused ? () => {} : props.onInspect);
      if (!focused || !ready) return;
    }
    const hit = project(event.clientX, event.clientY);
    if (!hit || !props.onGrab()) return;
    const target = event.target as Element;
    target.setPointerCapture?.(event.pointerId);
    held.current = { id: event.pointerId, x: event.clientX, y: event.clientY, point: [...props.position], moved: false, near: false,
      offset: new THREE.Vector3(...props.position).sub(hit),
      release: () => { try { target.releasePointerCapture?.(event.pointerId); } catch { /* Already released. */ } } };
    props.world.onGesture(true);
  };
  return <group ref={root} position={props.position} name={`Interactable_${props.id}`} userData={{ objectId: props.id, action: 'insert', sceneId: props.world.sceneId }}
    onPointerDown={down}
    onPointerOver={event => { if (props.enabled) { event.stopPropagation(); props.world.onHover(props.id, '按住卡带，拖到右侧卡槽后松手'); } }}
    onPointerOut={() => { if (!held.current) props.world.onHover(null); }}>
    <group ref={movable}>{props.children}</group>
  </group>;
}
