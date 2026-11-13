import { createChairMotion, advanceChairMotion, ROLLING_CHAIR_SIZE, type ChairMotion } from './chairMotion';
import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldAction, WorldActionKind, WorldModelProps } from '../../types/world';
import { roomAudio } from '../audioEngine';
import { ObjectHandle } from './ObjectHandle';
import { CHAIR_POSES, SEAT_SWIVEL, chairFacing, chairFront, type ChairPose } from './chairPose';
import { applyLibraryPose, carryResident, libraryCrouch } from './library/residentPose';
import { residentLibraryTarget } from './library/bookMotion';
import { readingStand } from './library/catalog';
import { HIP_HEIGHT as HIP, ResidentModel, type ResidentLeg, type ResidentRig } from './ResidentModel';
import { WALK_SPEED } from './residentRig';
import { canReachDrawer, drawerObstacle, DRAWER_CLEAR_Z, DRAWER_TRAVEL, type DrawerInteraction } from './drawerInteraction';

type Point = [number, number];
type Box = [number, number, number, number];
type Posture = 'standing' | 'chair' | 'bed';
type ResidentsProps = WorldModelProps & {
  walkTarget: [number, number, number] | null;
  onArrive: () => void;
  enabled: boolean;
  drawerEnabled: boolean;
  drawerInteraction: React.MutableRefObject<DrawerInteraction | null>;
  onDrawerAction: (action: WorldAction) => void;
  interaction: React.MutableRefObject<NonNullable<WorldModelProps['onApproach']> | null>;
};
type Approach = { point: Point; action: WorldAction; perform: () => void; elapsed: number; chairTarget: Point | null };
const RADIUS = 0.23;
const CAT: Point = [-0.95, 1.95];
const clamp = THREE.MathUtils.clamp;
const ease = (t: number) => t * t * (3 - 2 * t);
const angle = (from: number, to: number, t: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * t;
// Scoot cycle: feet reach down, push the floor until the legs straighten, then lift and recover.
const KICK = 0.72, REACH_END = 0.3, PUSH_END = 0.75, SOLE_NEAR = 0.03, SOLE_FAR = 0.2, SOLE_LIFT = 0.06;
const PUSH = 3.4, ROLL_DRAG = 2.4;

function layout(observatory: boolean) {
  const furniture: Box[] = [
    [-0.85, 2.95, -3.025, -1.675], // Desk, including the desktop overhang.
    [-3.96, -3.76, (observatory ? -.65 : -1.9) + 1.2, (observatory ? -.65 : -1.9) + 1.4],
    [-4.04, -2.86, observatory ? -0.92 : -2.17, observatory ? -0.38 : -1.63],
    ...(observatory ? [[-0.65, 0.15, 0.45, 1.25], [2.4, 3.1, 1.5, 2.2]] as Box[] : [[-3.46, -1.74, -0.32, 2.31], [-3.85, -3.25, 2.25, 2.85]] as Box[]),
  ];
  const grow = (by: number) => furniture.map(([a, b, c, d]) => [a - by, b + by, c - by, d + by] as Box);
  const chairRadius = observatory ? 0.55 : Math.max(ROLLING_CHAIR_SIZE[0], ROLLING_CHAIR_SIZE[2]) / 2 + .01;
  const boxes = grow(RADIUS), chairBoxes = grow(chairRadius);
  return { seat: observatory ? 0.755 : 0.72, chairRadius,
    boxes, chairBoxes, baseBoxes: boxes, baseChairBoxes: chairBoxes,
    openBoxes: [...boxes, drawerObstacle(DRAWER_TRAVEL, RADIUS + 0.08)],
    openChairBoxes: [...chairBoxes, drawerObstacle(DRAWER_TRAVEL, chairRadius)] };
}
type Room = ReturnType<typeof layout>;
const seatYaw = chairFacing;
function obstacles(room: Room, pose: ChairPose): Box[] {
  const r = room.chairRadius + RADIUS;
  return [...room.boxes, [pose.x - r, pose.x + r, pose.z - r, pose.z + r]];
}
function chairEntry(room: Room, pose: ChairPose): Point {
  const yaw = seatYaw(pose);
  const distance = (room.chairRadius + RADIUS) / Math.max(Math.abs(Math.sin(yaw)), Math.abs(Math.cos(yaw))) + 0.08;
  return chairFront(pose, distance);
}
function chairOpen(room: Room, x: number, z: number, blocker: Point | null) {
  const r = room.chairRadius;
  return Math.abs(x) <= 3.99 - r && Math.abs(z) <= 3.19 - r && !room.chairBoxes.some(([a, b, c, d]) => x > a && x < b && z > c && z < d)
    && (!blocker || Math.hypot(x - blocker[0], z - blocker[1]) >= r + RADIUS - 0.01);
}
function rollChair(room: Room, pose: ChairPose, dt: number, driven: boolean, blocker: Point | null) {
  const x = pose.x + pose.vx * dt;
  if (chairOpen(room, x, pose.z, blocker)) pose.x = x; else pose.vx = 0;
  const z = pose.z + pose.vz * dt;
  if (chairOpen(room, pose.x, z, blocker)) pose.z = z; else pose.vz = 0;
  pose.yaw += pose.spin * dt;
  pose.spin *= Math.exp(-dt * 4);
  if (!driven) { pose.vx *= Math.exp(-dt * ROLL_DRAG); pose.vz *= Math.exp(-dt * ROLL_DRAG); }
}
/** Solve the ankle target; the independent foot bone keeps the sole level. */
function legReach(leg: ResidentLeg, ahead: number, below: number): [number, number] {
  const { upperLength: thigh, lowerLength: shin } = leg;
  const reach = clamp(Math.hypot(ahead, below), Math.abs(thigh - shin) + 0.001, (thigh + shin) * 0.999);
  const hip = Math.atan2(ahead, below) + Math.acos(clamp((thigh * thigh + reach * reach - shin * shin) / (2 * thigh * reach), -1, 1));
  const knee = Math.PI - Math.acos(clamp((thigh * thigh + shin * shin - reach * reach) / (2 * thigh * shin), -1, 1));
  return [-hip, knee];
}
function free(point: Point, boxes: Box[]) {
  return point[0] >= -3.76 && point[0] <= 3.76 && point[1] >= -2.96 && point[1] <= 2.96 && !boxes.some(([a, b, c, d]) => point[0] > a && point[0] < b && point[1] > c && point[1] < d);
}
function reachable(point: Point, boxes: Box[]): Point {
  let result: Point = [clamp(point[0], -3.76, 3.76), clamp(point[1], -2.96, 2.96)];
  for (let pass = 0; pass < 8; pass++) {
    const box = boxes.find(([a, b, c, d]) => result[0] > a && result[0] < b && result[1] > c && result[1] < d);
    if (!box) break;
    const [a, b, c, d] = box;
    const candidates: Point[] = [[a - 0.015, result[1]], [b + 0.015, result[1]], [result[0], c - 0.015], [result[0], d + 0.015]];
    candidates.sort((p, q) => Math.hypot(p[0] - result[0], p[1] - result[1]) - Math.hypot(q[0] - result[0], q[1] - result[1]));
    result = candidates.find(p => free(p, boxes)) ?? candidates.find(p => p[0] >= -3.76 && p[0] <= 3.76 && p[1] >= -2.96 && p[1] <= 2.96) ?? [0.25, 0.5];
  }
  return result;
}
function clearSegment(p: Point, q: Point, boxes: Box[]) {
  const steps = Math.max(1, Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / 0.045));
  for (let i = 1; i <= steps; i++) if (!free([THREE.MathUtils.lerp(p[0], q[0], i / steps), THREE.MathUtils.lerp(p[1], q[1], i / steps)], boxes)) return false;
  return true;
}
/** A tiny visibility graph prevents a floor click behind the bed from stalling at its side. */
function route(start: Point, end: Point, boxes: Box[]): Point[] {
  const target = reachable(end, boxes);
  const nodes: Point[] = [start, target];
  boxes.forEach(([a, b, c, d]) => {
    for (const x of [a - 0.025, b + 0.025]) for (const z of [c - 0.025, d + 0.025]) if (free([x, z], boxes)) nodes.push([x, z]);
  });
  const distances = nodes.map((_, i) => i === 0 ? 0 : Infinity);
  const previous = nodes.map(() => -1);
  const visited = new Set<number>();
  for (let step = 0; step < nodes.length; step++) {
    let current = -1;
    for (let i = 0; i < nodes.length; i++) if (!visited.has(i) && (current < 0 || distances[i] < distances[current])) current = i;
    if (current < 0 || !Number.isFinite(distances[current])) break;
    if (current === 1) {
      const path: Point[] = [];
      for (let i = 1; i !== 0; i = previous[i]) path.unshift(nodes[i]);
      return path;
    }
    visited.add(current);
    for (let i = 1; i < nodes.length; i++) {
      if (visited.has(i)) continue;
      const distance = distances[current] + Math.hypot(nodes[i][0] - nodes[current][0], nodes[i][1] - nodes[current][1]);
      if (distance < distances[i] && clearSegment(nodes[current], nodes[i], boxes)) { distances[i] = distance; previous[i] = current; }
    }
  }
  return [];
}
function approachRoute(start: Point, point: Point, boxes: Box[], fixed?: Point): Point[] | null {
  if (!fixed && Math.hypot(start[0] - point[0], start[1] - point[1]) <= 1.15) return [];
  const targets: Point[] = fixed ? [fixed] : [];
  if (!fixed) for (const radius of [0.7, 0.9, 1.12]) for (let i = 0; i < 24; i++) {
    const yaw = i * Math.PI / 12;
    targets.push([point[0] + Math.sin(yaw) * radius, point[1] + Math.cos(yaw) * radius]);
  }
  let best: Point[] | null = null, bestLength = Infinity;
  for (const target of targets) {
    if (!free(target, boxes)) continue;
    const path = route(start, target, boxes);
    if (!path.length) continue;
    let length = 0, previous = start;
    for (const waypoint of path) { length += Math.hypot(waypoint[0] - previous[0], waypoint[1] - previous[1]); previous = waypoint; }
    if (length < bestLength) { best = path; bestLength = length; }
  }
  return best;
}
function Ball({ position, scale = [1, 1, 1], radius, color }: { position: [number, number, number]; scale?: [number, number, number]; radius: number; color: string }) {
  return <mesh position={position} scale={scale} castShadow receiveShadow><sphereGeometry args={[radius, 20, 14]} /><meshStandardMaterial color={color} roughness={0.7} /></mesh>;
}

/** Local coordinates belong to the mounted scene; the rendered root is the simulation position. */
export function OrbitalResidents(props: ResidentsProps) {
  const current = useRef(props);
  current.current = props;
  const { camera } = useThree();
  const room = useMemo(() => layout(props.sceneId === 'observatory'), [props.sceneId]);
  const spawn = useMemo(() => { const point = reachable([0.25, 0.5], obstacles(room, CHAIR_POSES[props.sceneId])); return [point[0], 0, point[1]] as [number, number, number]; }, [room]);
  const resident = useRef<THREE.Group>(null);
  const hips = useRef<THREE.Group>(null);
  const rig = useRef<ResidentRig | null>(null);
  const keys = useRef(new Set<string>());
  const jump = useRef(false);
  const drawerTask = useRef<{ action: WorldAction; target: Point; elapsed: number } | null>(null);
  const drawerExtension = useRef(0);
  const approach = useRef<Approach | null>(null);
  const chairMotion = useRef<ChairMotion | null>(null);
  const walkWeight = useRef(0), airborneMotion = useRef(0);
  const libraryNav = useRef('');
  const touch = useRef<{ id: number; x: number; y: number; target: EventTarget | null } | null>(null);
  const petGesture = useRef(false);
  const state = useRef({ posture: 'standing' as Posture, wanted: 'standing' as Posture, path: [] as Point[], external: false, exiting: false, blend: 0, sit: 0, lie: 0, lift: 0, velocity: 0, walkTime: 0, nearby: '', nearbyHint: '', dismissedBed: false, dismissedChair: false,
    perch: 0, idle: Infinity, kick: 0, planted: false, plant: SOLE_NEAR, sole: SOLE_NEAR, soleLift: SOLE_LIFT });
  const exit = useRef({ from: new THREE.Vector3(), yaw: 0, sit: 0, lie: 0, progress: 0 });
  const petBody = useRef<THREE.Group>(null);
  const petHead = useRef<THREE.Group>(null);
  const petTail = useRef<THREE.Group>(null);
  const sparks = useRef<THREE.Group>(null);
  const pet = useRef({ value: props.objects.pet?.value ?? 0, happy: 0, time: 0 });
  const movement = useMemo(() => ({ forward: new THREE.Vector3(), right: new THREE.Vector3(), step: new THREE.Vector3() }), []);

  const act = (objectId: string, kind: WorldActionKind) => {
    const p = current.current;
    const action: WorldAction = { sceneId: p.sceneId, objectId, kind };
    if (objectId === 'chair' && kind === 'sit') {
      const pose = CHAIR_POSES[p.sceneId];
      p.interaction.current?.([pose.x, 0, pose.z], action, () => current.current.onAction(action));
    } else p.onAction(action);
  };
  const beginExit = () => {
    const s = state.current;
    if (s.exiting || s.posture === 'standing' || !resident.current) return;
    exit.current.from.copy(resident.current.position);
    exit.current.yaw = resident.current.rotation.y;
    exit.current.sit = s.sit; exit.current.lie = s.lie; exit.current.progress = 0;
    s.exiting = true;
    const pose = CHAIR_POSES[current.current.sceneId];
    pose.vx = 0; pose.vz = 0; pose.spin = 0;
  };
  const stand = () => {
    const s = state.current;
    if (current.current.objects.bed?.active && !s.dismissedBed) { s.dismissedBed = true; act('bed', 'wake'); }
    if (current.current.objects.chair?.active && !s.dismissedChair) { s.dismissedChair = true; act('chair', 'stand'); }
    s.wanted = 'standing';
    s.path = [];
    beginExit();
  };
  const steer = (): Point => {
    const k = keys.current;
    const horizontal = Number(k.has('KeyD') || k.has('ArrowRight')) - Number(k.has('KeyA') || k.has('ArrowLeft'));
    const vertical = Number(k.has('KeyW') || k.has('ArrowUp')) - Number(k.has('KeyS') || k.has('ArrowDown'));
    if (!horizontal && !vertical) return [0, 0];
    camera.getWorldDirection(movement.forward); movement.forward.y = 0; movement.forward.normalize();
    movement.right.crossVectors(movement.forward, camera.up).normalize();
    movement.step.copy(movement.forward).multiplyScalar(vertical).addScaledVector(movement.right, horizontal).normalize();
    return [movement.step.x, movement.step.z];
  };
  const releaseTouch = () => {
    const held = touch.current;
    if (!held) return;
    touch.current = null;
    try { (held.target as Element)?.releasePointerCapture?.(held.id); } catch { /* Browser may already have released it. */ }
    current.current.onGesture(false);
  };

  const cancelApproach = () => {
    approach.current = null;
    state.current.path = [];
    state.current.external = false;
    current.current.onArrive();
  };
  const planApproach = () => {
    const task = approach.current, root = resident.current, p = current.current;
    if (!task || !root) return;
    const pose = CHAIR_POSES[p.sceneId];
    const fixed = task.action.objectId === 'chair' ? chairEntry(room, pose)
      : task.action.objectId === 'bed' ? [-1.48, 0.95] as Point
      : task.action.objectId === 'desk-drawer' ? [0.35, p.objects['desk-drawer']?.open ? -0.5 : -1.2] as Point : undefined;
    const path = approachRoute([root.position.x, root.position.z], task.point, obstacles(room, pose), fixed);
    if (path) state.current.path = path;
    else { cancelApproach(); p.onHover(task.action.objectId, '前方空间不足，请先移开挡路的物品'); }
  };
  useEffect(() => {
    const request: NonNullable<WorldModelProps['onApproach']> = (point, action, perform) => {
      const root = resident.current, p = current.current, s = state.current;
      if (!root || drawerTask.current || action.sceneId !== p.sceneId) return false;
      if (action.kind === 'stand' || action.kind === 'wake') { cancelApproach(); perform(); return true; }
      const pose = CHAIR_POSES[p.sceneId];
      const target: Point = action.objectId === 'chair' ? [pose.x, pose.z] : [point[0], point[2]];
      if (s.posture === 'standing' && !s.exiting && s.lift === 0 && s.velocity <= 0
        && action.objectId !== 'chair' && action.objectId !== 'bed'
        && Math.hypot(root.position.x - target[0], root.position.z - target[1]) <= 1.15) {
        cancelApproach(); perform(); return true;
      }
      if (!p.drawerEnabled && p.focusedObject !== 'bed') { p.onHover(action.objectId, '先返回房间，再走近这个物品'); return false; }
      cancelApproach();
      stand();
      keys.current.clear(); jump.current = false;
      approach.current = { point: target, action, perform, elapsed: 0, chairTarget: null };
      s.external = true;
      if (action.objectId === 'chair') {
        pose.vx = 0; pose.vz = 0; pose.spin = 0;
        const facing = seatYaw(pose);
        for (let distance = 0; distance <= 1.5; distance += 0.05) {
          const candidate = { ...pose, x: pose.x - Math.sin(facing) * distance, z: pose.z - Math.cos(facing) * distance };
          if (!chairOpen(room, candidate.x, candidate.z, [root.position.x, root.position.z])) break;
          if (free(chairEntry(room, candidate), obstacles(room, candidate))) {
            if (distance > 0) approach.current.chairTarget = [candidate.x, candidate.z];
            break;
          }
        }
      }
      if (!s.exiting && !approach.current.chairTarget) planApproach();
      p.onHover(action.objectId, action.objectId === 'chair' ? '走到椅子正面入座…' : '走近后进行交互…');
      return false;
    };
    props.interaction.current = request;
    return () => { approach.current = null; if (props.interaction.current === request) props.interaction.current = null; };
  }, []);

  useEffect(() => {
    const handle: DrawerInteraction = { busy: false, request: action => {
      const p = current.current, root = resident.current, s = state.current;
      if (handle.busy || action.sceneId !== p.sceneId) return;
      if (!p.drawerEnabled || !root || s.posture !== 'standing' || s.exiting || s.lift > 0 || s.velocity > 0
        || !canReachDrawer(root.position, !!p.objects['desk-drawer']?.open)) {
        p.onHover('desk-drawer', '走到抽屉正面，站稳后再操作');
        return;
      }
      if (p.objects['desk-drawer']?.open) { p.onDrawerAction({ ...action, kind: 'close' }); return; }
      const pose = CHAIR_POSES[p.sceneId];
      if (!free([pose.x, pose.z], room.openChairBoxes)) {
        p.onHover('desk-drawer', '椅子挡住了抽屉，先把椅子移开');
        return;
      }
      handle.busy = true;
      keys.current.clear(); jump.current = false; s.path = [];
      if (s.external) { s.external = false; p.onArrive(); }
      drawerTask.current = { action: { ...action, kind: 'open' }, target: [root.position.x, Math.max(DRAWER_CLEAR_Z, root.position.z + 0.12)], elapsed: 0 };
      p.onHover('desk-drawer', '后退让开抽屉…');
    } };
    props.drawerInteraction.current = handle;
    return () => { drawerTask.current = null; if (props.drawerInteraction.current === handle) props.drawerInteraction.current = null; };
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      const p = current.current;
      if (event.code === 'Escape' && approach.current) { cancelApproach(); return; }
      const target = event.target as HTMLElement | null;
      if (!p.enabled || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'))) return;
      if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'KeyE'].includes(event.code)) return;
      event.preventDefault();
      event.stopPropagation();
      void roomAudio.unlock();
      if (event.repeat || drawerTask.current) return;
      if (approach.current) cancelApproach();
      if (event.code === 'KeyE') {
        if (state.current.posture !== 'standing' || p.objects.bed?.active || p.objects.chair?.active) stand();
        else {
          const id = state.current.nearby;
          if (id) act(id, id === 'book-01' ? 'inspect' : id === 'pet' ? 'pet' : id === 'bed' ? 'sleep' : id === 'desk-drawer' ? (p.objects[id]?.open ? 'close' : 'open') : 'sit');
        }
      } else if (event.code === 'Space') {
        const wasResting = state.current.wanted !== 'standing' || state.current.posture !== 'standing';
        if (wasResting) stand();
        jump.current = true;
      }
      else {
        const scooting = p.sceneId === 'habitat' && state.current.posture === 'chair' && !state.current.exiting && chairMotion.current?.phase === 'seated';
        if (!scooting) stand();
        if (state.current.external) { state.current.external = false; p.onArrive(); }
        keys.current.add(event.code);
      }
    };
    const up = (event: KeyboardEvent) => { keys.current.delete(event.code); };
    const clear = () => {
      keys.current.clear(); jump.current = false; releaseTouch();
      if (petGesture.current) { petGesture.current = false; current.current.onGesture(false); }
    };
    const hide = () => { if (document.hidden) clear(); };
    const touchUp = (event: PointerEvent) => {
      const held = touch.current;
      if (!held || event.pointerId !== held.id) return;
      const swipe = held.y - event.clientY > 32 && Math.abs(held.x - event.clientX) < 95;
      releaseTouch();
      // onGesture temporarily disables residents while this component owns the pointer.
      if (swipe && !drawerTask.current && (!current.current.focusedObject || current.current.focusedObject === 'bed')) {
        if (state.current.wanted !== 'standing' || state.current.posture !== 'standing') stand();
        if (state.current.lift === 0) jump.current = true;
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    window.addEventListener('pointerup', touchUp);
    window.addEventListener('pointercancel', clear);
    document.addEventListener('visibilitychange', hide);
    return () => {
      clear();
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear);
      window.removeEventListener('pointerup', touchUp); window.removeEventListener('pointercancel', clear); document.removeEventListener('visibilitychange', hide);
      if (state.current.nearby) current.current.onHover(null);
    };
  }, []);

  useEffect(() => {
    if (!props.enabled) { keys.current.clear(); if (!touch.current) jump.current = false; }
    if (props.focusedObject && props.focusedObject !== 'bed') releaseTouch();
  }, [props.enabled, props.focusedObject]);
  useEffect(() => {
    if (!props.walkTarget || !props.enabled || drawerTask.current) return;
    approach.current = null;
    stand();
    const s = state.current;
    s.external = true;
    if (!s.exiting && resident.current) s.path = route([resident.current.position.x, resident.current.position.z], [props.walkTarget[0], props.walkTarget[2]], obstacles(room, CHAIR_POSES[props.sceneId]));
  }, [props.walkTarget]);

  useFrame((_, rawDelta) => {
    const root = resident.current;
    const pivot = hips.current;
    if (!root || !pivot) return;
    const dt = Math.min(Math.max(rawDelta, 0), 0.04);
    const p = current.current;
    const s = state.current;
    const drawerOpen = !!p.objects['desk-drawer']?.open;
    drawerExtension.current = p.reducedMotion ? (drawerOpen ? DRAWER_TRAVEL : 0) : THREE.MathUtils.damp(drawerExtension.current, drawerOpen ? DRAWER_TRAVEL : 0, 8, dt);
    const blocking = drawerOpen || drawerExtension.current > 0.001;
    room.boxes = blocking ? room.openBoxes : room.baseBoxes;
    room.chairBoxes = blocking ? room.openChairBoxes : room.baseChairBoxes;
    if (drawerTask.current && !p.drawerEnabled) {
      drawerTask.current = null;
      if (p.drawerInteraction.current) p.drawerInteraction.current.busy = false;
    }
    const library = p.library, flow = library?.flow.current;
    const libraryActive = !!flow && flow.phase !== 'idle';
    const libraryWalking = !!flow && ['approach', 'align', 'recenter'].includes(flow.phase);
    const libraryTarget = flow ? residentLibraryTarget(p.sceneId, flow) : null;
    if (libraryWalking && libraryTarget) {
      const key = `${flow!.phase}/${flow!.book?.id ?? ''}`;
      if (libraryNav.current !== key) {
        libraryNav.current = key; keys.current.clear(); jump.current = false; stand();
        const end: Point = [libraryTarget[0], libraryTarget[2]], boxes = obstacles(room, CHAIR_POSES[p.sceneId]);
        if (!free(end, boxes)) { library!.arrived(false); return; }
        if (!s.exiting) {
          s.path = route([root.position.x, root.position.z], end, boxes);
          if (!s.path.length && Math.hypot(root.position.x - end[0], root.position.z - end[1]) > .05) { library!.arrived(false); return; }
        }
      }
    } else { if (!libraryActive && libraryNav.current) s.path = []; libraryNav.current = ''; }
    if (!p.objects.bed?.active) s.dismissedBed = false;
    if (!p.objects.chair?.active) s.dismissedChair = false;
    const wanted: Posture = p.sceneId === 'habitat' && p.objects.bed?.active && !s.dismissedBed ? 'bed' : p.objects.chair?.active && !s.dismissedChair ? 'chair' : 'standing';
    const pose = CHAIR_POSES[p.sceneId];
    const pending = approach.current;
    if (pending) {
      pending.elapsed += dt;
      if (pending.elapsed > 15 || (p.focusedObject && p.focusedObject !== 'bed')) cancelApproach();
      else if (pending.chairTarget && !s.exiting) {
        const [x, z] = pending.chairTarget;
        const distance = Math.hypot(x - pose.x, z - pose.z);
        const fraction = distance > 0 ? Math.min(1, dt * 0.75 / distance) : 1;
        const nextX = THREE.MathUtils.lerp(pose.x, x, fraction), nextZ = THREE.MathUtils.lerp(pose.z, z, fraction);
        if (chairOpen(room, nextX, nextZ, [root.position.x, root.position.z])) {
          pose.x = nextX; pose.z = nextZ;
          if (fraction === 1) { pending.chairTarget = null; planApproach(); }
        } else { cancelApproach(); p.onHover('chair', '椅子后方空间不足，请先移开挡路的物品'); }
      }
    }
    const seatEntry = chairEntry(room, pose);
    const entry: Point = (s.posture !== 'standing' ? s.posture === 'bed' : wanted === 'bed') ? [-1.48, 0.95] : seatEntry;
    if (wanted !== s.wanted) {
      s.wanted = wanted;
      s.path = [];
      if (s.external) { s.external = false; p.onArrive(); }
      if (s.posture !== 'standing') beginExit();
      else if (wanted !== 'standing') s.path = route([root.position.x, root.position.z], entry, obstacles(room, pose));
    }
    const scooting = p.sceneId === 'habitat' && s.posture === 'chair' && !s.exiting && chairMotion.current?.phase === 'seated';
    if (!scooting) {
      s.kick = 0; s.planted = false; s.idle = Infinity;
      s.perch = THREE.MathUtils.damp(s.perch, 0, 7, dt);
      if (s.posture === 'standing' && !s.exiting && approach.current?.action.objectId !== 'chair' && wanted !== 'chair') rollChair(room, pose, dt, false, [root.position.x, root.position.z]);
    }
    const surfaceAt = (x: number, z: number): 'wood' | 'rug' =>
      p.sceneId === 'observatory' && x >= -2.95 && x <= -0.05 && z >= -0.3 && z <= 1.9 ? 'rug' : 'wood';
    const frameX = root.position.x, frameZ = root.position.z;
    let walking = false;
    if (s.posture === 'chair' && p.sceneId === 'habitat') {
      const motion = chairMotion.current ??= createChairMotion(Math.hypot(root.position.x - pose.x, root.position.z - pose.z));
      const step = advanceChairMotion(motion, dt, s.exiting, p.reducedMotion, WALK_SPEED * .65);
      s.blend = motion.phase === 'seated' ? 1 : 0;
      if (scooting) {
        const [dx, dz] = p.enabled ? steer() : [0, 0];
        const driving = dx !== 0 || dz !== 0;
        s.idle = driving ? 0 : s.idle + dt;
        s.perch = THREE.MathUtils.damp(s.perch, s.idle < 1.2 ? 1 : 0, 7, dt);
        // The resident faces away from travel so both feet can push against the floor in front.
        if (driving && !s.planted) pose.yaw = angle(pose.yaw, Math.atan2(-dx, -dz) - SEAT_SWIVEL - Math.PI, 1 - Math.exp(-dt * 5));
        if (!s.kick && driving && s.perch > 0.9) s.kick = 1e-4;
        if (s.kick) { s.kick += dt / KICK; if (s.kick >= 1) s.kick = driving ? Math.max(1e-4, s.kick - 1) : 0; }
        const facing = seatYaw(pose), backX = -Math.sin(facing), backZ = -Math.cos(facing);
        const pushing = s.kick >= REACH_END && s.kick < PUSH_END;
        if (pushing) {
          if (!s.planted) {
            s.planted = true;
            s.plant = SOLE_NEAR;
            roomAudio.playFootstep({ variant: 'push', surface: surfaceAt(pose.x, pose.z), intensity: 0.85 });
          }
          const speed = Math.max(0, pose.vx * backX + pose.vz * backZ) + PUSH * dt;
          pose.vx = backX * speed; pose.vz = backZ * speed;
        } else s.planted = false;
        const fromX = pose.x, fromZ = pose.z;
        rollChair(room, pose, dt, pushing, null);
        if (pushing) {
          // Planted soles stay put in the world: the chair's travel is exactly how far the legs extend.
          s.plant += (pose.x - fromX) * backX + (pose.z - fromZ) * backZ;
          if (s.plant >= SOLE_FAR) { s.plant = SOLE_FAR; s.kick = PUSH_END; s.planted = false; }
        }
        if (!s.kick) { s.sole = SOLE_NEAR; s.soleLift = SOLE_LIFT; }
        else if (s.kick < REACH_END) { s.sole = SOLE_NEAR; s.soleLift = SOLE_LIFT * (1 - ease(s.kick / REACH_END)); }
        else if (s.planted) { s.sole = s.plant; s.soleLift = 0; }
        else {
          const u = clamp((s.kick - PUSH_END) / (1 - PUSH_END), 0, 1);
          s.sole = THREE.MathUtils.lerp(s.plant, SOLE_NEAR, ease(u));
          s.soleLift = SOLE_LIFT * ease(u) + Math.sin(u * Math.PI) * 0.05;
        }
      }
      const [x, z] = chairFront(pose, motion.offset);
      root.position.set(x, 0, z);
      root.rotation.y = seatYaw(pose);
      s.sit = step.crouch; s.lie = 0;
      walking = Math.abs(step.travel) > .00001;
      if (motion.phase === 'done') {
        root.position.set(entry[0], 0, entry[1]);
        s.posture = 'standing'; s.exiting = false; s.blend = 0; s.sit = 0; s.lie = 0;
        chairMotion.current = null;
        if (libraryWalking && libraryTarget) s.path = route(entry, [libraryTarget[0], libraryTarget[2]], obstacles(room, pose));
        else if (approach.current) planApproach();
        else if (s.external && p.walkTarget) s.path = route(entry, [p.walkTarget[0], p.walkTarget[2]], obstacles(room, pose));
        else if (wanted !== 'standing') s.path = route(entry, wanted === 'bed' ? [-1.48, 0.95] : seatEntry, obstacles(room, pose));
      }
    } else if (s.exiting) {
      // Move off the support before lowering the pelvis; preserve the actual in-flight pose.
      const transition = exit.current;
      transition.progress = Math.min(1, transition.progress + dt / 0.85);
      const t = transition.progress;
      const move = ease(clamp(t / 0.8, 0, 1));
      const lower = ease(clamp((t - 0.45) / 0.55, 0, 1));
      root.position.x = THREE.MathUtils.lerp(transition.from.x, entry[0], move);
      root.position.z = THREE.MathUtils.lerp(transition.from.z, entry[1], move);
      root.position.y = THREE.MathUtils.lerp(transition.from.y, 0, lower);
      s.lie = transition.lie * (1 - ease(clamp(t / 0.55, 0, 1)));
      s.sit = transition.sit * (1 - lower) + transition.lie * Math.sin(t * Math.PI);
      root.rotation.y = angle(transition.yaw, s.posture === 'bed' ? Math.PI / 2 : seatYaw(pose), move);
      if (t === 1) {
        root.position.set(entry[0], 0, entry[1]);
        s.posture = 'standing'; s.exiting = false; s.blend = 0; s.sit = 0; s.lie = 0;
        roomAudio.playFootstep({ surface: surfaceAt(entry[0], entry[1]), intensity: 0.78 });
        if (libraryWalking && libraryTarget) s.path = route(entry, [libraryTarget[0], libraryTarget[2]], obstacles(room, pose));
        else if (approach.current) planApproach();
        else if (s.external && p.walkTarget) s.path = route(entry, [p.walkTarget[0], p.walkTarget[2]], obstacles(room, pose));
        else if (wanted !== 'standing') s.path = route(entry, wanted === 'bed' ? [-1.48, 0.95] : seatEntry, obstacles(room, pose));
      }
    } else if (s.posture !== 'standing') {
      s.blend = Math.min(1, s.blend + dt / (p.reducedMotion ? 0.4 : 0.9));
      const t = ease(s.blend);
      const bed = s.posture === 'bed';
      const yaw = bed ? 0 : seatYaw(pose);
      const forward = 0.1 + s.perch * 0.23;
      const destination: Point = bed ? [-2.6, 0.94] : [pose.x + Math.sin(yaw) * forward, pose.z + Math.cos(yaw) * forward];
      const slide = bed ? ease(clamp((t - 0.2) / 0.8, 0, 1)) : t;
      root.position.x = THREE.MathUtils.lerp(entry[0], destination[0], slide);
      root.position.z = THREE.MathUtils.lerp(entry[1], destination[1], slide);
      root.rotation.y = scooting ? yaw : angle(root.rotation.y, yaw, 1 - Math.exp(-dt * 12));
      // Hip center sits one hip radius above the actual cushion; supine back rests on the duvet.
      root.position.y = bed ? ease(clamp(t / 0.35, 0, 1)) * (0.929 - HIP) : t * (room.seat + 0.095 - HIP);
      s.sit = bed ? Math.sin(t * Math.PI) * 0.65 : t;
      s.lie = bed ? ease(clamp((t - 0.25) / 0.75, 0, 1)) : 0;
    } else {
      const task = drawerTask.current;
      let [dx, dz] = p.enabled && !task ? steer() : [0, 0];
      let speed = WALK_SPEED;
      if (task) {
        task.elapsed += dt;
        root.rotation.y = angle(root.rotation.y, Math.PI, 1 - Math.exp(-dt * 14));
        if (Math.abs(Math.atan2(Math.sin(root.rotation.y - Math.PI), Math.cos(root.rotation.y - Math.PI))) < 0.08) {
          const distance = Math.hypot(task.target[0] - root.position.x, task.target[1] - root.position.z);
          speed = dt > 0 ? Math.min(WALK_SPEED, distance / dt) : 0;
          if (distance > 0.001) { dx = (task.target[0] - root.position.x) / distance; dz = (task.target[1] - root.position.z) / distance; }
        }
      }
      const autonomous = wanted !== 'standing';
      if (!task && !dx && !dz && (p.enabled || autonomous || libraryWalking) && s.path.length) {
        const waypoint = s.path[0];
        const distance = Math.hypot(waypoint[0] - root.position.x, waypoint[1] - root.position.z);
        if (distance <= WALK_SPEED * dt) {
          root.position.x = waypoint[0]; root.position.z = waypoint[1];
          walking = distance > 0.00001; s.path.shift();
        }
        else { dx = (waypoint[0] - root.position.x) / distance; dz = (waypoint[1] - root.position.z) / distance; }
      }
      if (dx || dz) {
        const beforeX = root.position.x, beforeZ = root.position.z;
        const x = root.position.x + dx * dt * speed, z = root.position.z + dz * dt * speed;
        if (s.path.length) {
          if (clearSegment([beforeX, beforeZ], [x, z], obstacles(room, pose))) { root.position.x = x; root.position.z = z; }
          else if (approach.current) planApproach();
        } else {
          if (free([x, root.position.z], room.boxes)) root.position.x = x;
          if (free([root.position.x, z], room.boxes)) root.position.z = z;
        }
        // Walking into the chair shoves it ahead; if it is pinned against something, the resident stops at contact.
        const offsetX = pose.x - root.position.x, offsetZ = pose.z - root.position.z, gap = Math.hypot(offsetX, offsetZ), contact = room.chairRadius + RADIUS;
        if (gap < contact && gap > 1e-4) {
          const nx = offsetX / gap, nz = offsetZ / gap;
          const pushX = root.position.x + nx * contact, pushZ = root.position.z + nz * contact;
          if (chairOpen(room, pushX, pose.z, null)) pose.x = pushX;
          if (chairOpen(room, pose.x, pushZ, null)) pose.z = pushZ;
          const shove = Math.max(0, dx * nx + dz * nz) * 1.5;
          pose.vx = nx * shove; pose.vz = nz * shove;
          pose.spin = (dx * nz - dz * nx) * 1.6;
          if (Math.hypot(pose.x - root.position.x, pose.z - root.position.z) < contact - 0.005) { root.position.x = beforeX; root.position.z = beforeZ; }
        }
        walking = Math.hypot(root.position.x - beforeX, root.position.z - beforeZ) > 0.001;
        if (!task) root.rotation.y = angle(root.rotation.y, Math.atan2(dx, dz), 1 - Math.exp(-dt * 14));
      }
      if (task && (Math.hypot(task.target[0] - root.position.x, task.target[1] - root.position.z) < 0.005 || task.elapsed > 2.5)) {
        drawerTask.current = null;
        if (p.drawerInteraction.current) p.drawerInteraction.current.busy = false;
        if (!free([pose.x, pose.z], room.openChairBoxes)) p.onHover('desk-drawer', '椅子挡住了抽屉，先把椅子移开');
        else if (Math.hypot(task.target[0] - root.position.x, task.target[1] - root.position.z) < 0.005 && root.position.z >= DRAWER_CLEAR_Z - 0.005) p.onDrawerAction(task.action);
        else p.onHover('desk-drawer', '身后空间不足，换个位置再拉开抽屉');
      }
      if (!s.path.length && s.external && p.enabled && !s.exiting && s.lift === 0 && !approach.current?.chairTarget) {
        const request = approach.current;
        const fixed = request?.action.objectId === 'chair' || request?.action.objectId === 'bed';
        const target = request?.action.objectId === 'chair' ? seatEntry : request?.action.objectId === 'bed' ? [-1.48, 0.95] : request?.point;
        const distance = target ? Math.hypot(root.position.x - target[0], root.position.z - target[1]) : 0;
        const radius = fixed ? 0.06 : 1.15;
        cancelApproach();
        if (request && distance <= radius) request.perform();
      }
      if (!s.path.length && autonomous && s.lift <= 0) {
        if (Math.hypot(root.position.x - entry[0], root.position.z - entry[1]) < 0.06) {
          const yaw = wanted === 'chair' ? seatYaw(pose) : root.rotation.y;
          root.rotation.y = angle(root.rotation.y, yaw, 1 - Math.exp(-dt * 12));
          if (Math.abs(Math.atan2(Math.sin(yaw - root.rotation.y), Math.cos(yaw - root.rotation.y))) < 0.06) { s.posture = wanted; s.blend = 0; }
        }
        else s.path = route([root.position.x, root.position.z], entry, obstacles(room, pose));
      }
      const wasLift = s.lift;
      if (jump.current && p.enabled) {
        if (s.lift === 0) {
          s.velocity = 4.0;
          roomAudio.playFootstep({ variant: 'push', surface: surfaceAt(root.position.x, root.position.z), intensity: 0.88 });
        }
        jump.current = false;
      }
      if (s.lift > 0 || s.velocity > 0) {
        s.velocity -= 10.5 * dt;
        s.lift = Math.max(0, s.lift + s.velocity * dt);
        if (!s.lift) {
          s.velocity = 0;
          if (wasLift > 0) roomAudio.playFootstep({ variant: 'land', surface: surfaceAt(root.position.x, root.position.z), intensity: 1.15 });
        }
      }
      root.position.y = s.lift;
      s.sit = 0; s.lie = 0;
      if (libraryWalking && libraryTarget && !s.path.length && !s.lift && Math.hypot(root.position.x - libraryTarget[0], root.position.z - libraryTarget[2]) < .055) {
        root.rotation.y = angle(root.rotation.y, Math.PI, 1 - Math.exp(-dt * 10));
        if (Math.abs(Math.atan2(Math.sin(root.rotation.y - Math.PI), Math.cos(root.rotation.y - Math.PI))) < .025) library!.arrived();
      }
      if (libraryActive && !libraryWalking && flow) {
        root.rotation.y = angle(root.rotation.y, Math.PI, 1 - Math.exp(-dt * 10));
        carryResident(root, p.sceneId, flow); root.position.y -= libraryCrouch(flow);
        if (['carry', 'return-carry'].includes(flow.phase) && flow.progress > .08 && flow.progress < .92) walking = true;
      }
    }
    pose.drop = 0;
    const distance = Math.hypot(root.position.x - frameX, root.position.z - frameZ);
    const groundedWalk = walking && s.lift === 0 && distance > .00001;
    if (groundedWalk) {
      const next = s.walkTime + (chairMotion.current?.phase === 'backing' ? -1 : 1) * distance / WALK_SPEED;
      const halfStep = Math.floor(next * 2);
      if (halfStep !== Math.floor(s.walkTime * 2))
        roomAudio.playFootstep({ foot: (halfStep & 1) as 0 | 1, surface: surfaceAt(root.position.x, root.position.z) });
      s.walkTime = (next % 1 + 1) % 1;
    }
    const chairWalking = chairMotion.current && ['backing', 'leaving'].includes(chairMotion.current.phase);
    const interactionPose = (s.posture !== 'standing' || s.exiting) && !chairWalking || s.lift > 0 || (libraryActive && !libraryWalking);
    walkWeight.current = interactionPose || p.reducedMotion ? 0
      : clamp(walkWeight.current + (groundedWalk ? 1 : -1) * dt / .14, 0, 1);
    const airborne = walking && s.lift > 0 && !p.reducedMotion;
    airborneMotion.current = airborne ? airborneMotion.current + dt : 0;
    const stride = airborne ? Math.sin(airborneMotion.current * 10) * .28
      : groundedWalk && libraryActive && !libraryWalking && !p.reducedMotion ? Math.sin(s.walkTime * Math.PI * 2) * .2 : 0;
    pivot.position.y = HIP;
    pivot.rotation.x = -s.lie * Math.PI / 2;
    pivot.rotation.z = airborne ? stride * .12 : 0;
    if (rig.current) {
      const straighten = Math.max(s.sit, s.lie, s.perch);
      rig.current.skirtFront.rotation.x = -s.sit * Math.PI / 2;
      rig.current.skirtFront.position.y = HIP + s.sit * 0.05;
      rig.current.skirtFront.position.z = 0.19 + s.sit * 0.13;
      rig.current.skirtBack.rotation.x = -s.sit * 0.4;
      rig.current.legs.forEach((leg, side) => {
        let thigh = -s.sit * Math.PI / 2, knee = s.sit * Math.PI / 2;
        if (libraryActive && root.position.y < -.001) [thigh, knee] = legReach(leg, -leg.hipForward, root.position.y + HIP - leg.ankleHeight);
        if (s.perch > 0.001 && !chairMotion.current) {
          const [reachThigh, reachKnee] = legReach(leg, s.sole - leg.hipForward, root.position.y + HIP - s.soleLift - leg.ankleHeight);
          thigh = THREE.MathUtils.lerp(thigh, reachThigh, s.perch);
          knee = THREE.MathUtils.lerp(knee, reachKnee, s.perch);
        }
        const swing = side ? -stride : stride;
        leg.thigh.rotation.x = thigh + swing + leg.straighten[0] * straighten;
        leg.shin.rotation.x = knee + Math.max(0, -swing) * 0.5 + leg.straighten[1] * straighten;
        leg.foot.rotation.x = -(leg.thigh.rotation.x + leg.shin.rotation.x);
      });
    }
    if (rig.current && library && flow) applyLibraryPose(rig.current, root, p.sceneId, flow, dt);
    if (rig.current) rig.current.applyPose(s.walkTime, ease(walkWeight.current),
      chairMotion.current ? { time: chairMotion.current.time, weight: chairMotion.current.weight, perch: s.perch, sole: s.sole, soleLift: s.soleLift } : undefined);
    if (library && rig.current) library.tick(dt);
    root.userData.posture = s.exiting ? 'standing-up' : s.posture;
    root.userData.grounded = s.lift === 0;
    root.userData.chairMotion = chairMotion.current ? { ...chairMotion.current } : null;
    const candidates: { id: string; point: Point; distance: number }[] = [{ id: 'book-01', point: [readingStand(p.sceneId)[0], readingStand(p.sceneId)[2]], distance: 1.0 }, { id: 'pet', point: CAT, distance: 1.1 }, { id: 'chair', point: [pose.x, pose.z], distance: 1.35 }];
    if (p.sceneId === 'habitat') candidates.push({ id: 'bed', point: [-1.48, 0.95], distance: 1.0 });
    if (p.drawerEnabled && s.posture === 'standing' && canReachDrawer(root.position, drawerOpen)) candidates.push({ id: 'desk-drawer', point: [0.35, drawerOpen ? -0.935 : -1.575], distance: 1.2 });
    const nearby = p.enabled && !drawerTask.current ? candidates.map(item => {
      const distance = Math.hypot(root.position.x - item.point[0], root.position.z - item.point[1]);
      return { id: item.id, reachable: distance < item.distance, gap: distance - (item.id === 'chair' ? room.chairRadius : 0) };
    }).filter(item => item.reachable).sort((a, b) => a.gap - b.gap)[0]?.id ?? '' : '';
    const hint = nearby ? `E · ${s.posture !== 'standing' ? '起身' : nearby === 'book-01' ? '查看藏书' : nearby === 'pet' ? '摸摸团子' : nearby === 'bed' ? '躺下休息' : nearby === 'desk-drawer' ? (drawerOpen ? '推回抽屉' : '后退拉开抽屉') : '坐下'}` : '';
    if (!drawerTask.current && (nearby !== s.nearby || hint !== s.nearbyHint)) { s.nearby = nearby; s.nearbyHint = hint; p.onHover(nearby || null, hint || undefined); }

    const cat = pet.current;
    cat.time += dt;
    const value = p.objects.pet?.value ?? 0;
    if (value > cat.value) cat.happy = 2.2;
    cat.value = value; cat.happy = Math.max(0, cat.happy - dt);
    const happy = cat.happy > 0;
    if (petBody.current) petBody.current.position.y = 0.09 + (happy && !p.reducedMotion ? Math.sin((2.2 - cat.happy) * 9) ** 2 * 0.08 : 0);
    if (petHead.current) {
      petHead.current.rotation.z = happy && !p.reducedMotion ? Math.sin(cat.time * 9) * 0.12 : 0;
      const direction = Math.atan2(root.position.x - CAT[0], root.position.z - CAT[1]) - 0.5;
      petHead.current.rotation.y = THREE.MathUtils.damp(petHead.current.rotation.y, clamp(Math.atan2(Math.sin(direction), Math.cos(direction)), -0.7, 0.7), 5, dt);
    }
    if (petTail.current) petTail.current.rotation.z = p.reducedMotion ? 0.15 : Math.sin(cat.time * (happy ? 10 : 2.2)) * (happy ? 0.5 : 0.2);
    if (sparks.current) {
      sparks.current.visible = happy;
      sparks.current.children.forEach((child, i) => { child.position.set(Math.sin(i * 2.1) * 0.22, 0.7 + (p.reducedMotion ? 0.1 : ((2.2 - cat.happy + i * 0.25) % 1.1) * 0.45), Math.cos(i * 2.1) * 0.15); child.scale.setScalar(Math.min(1, cat.happy * 3) * 0.7); });
    }
  });

  const characterDown = (event: ThreeEvent<PointerEvent>) => {
    if (!props.enabled || drawerTask.current || event.pointerType !== 'touch' || touch.current) return;
    event.stopPropagation();
    touch.current = { id: event.pointerId, x: event.clientX, y: event.clientY, target: event.target };
    try { (event.target as Element).setPointerCapture?.(event.pointerId); } catch { /* Optional on touch-only browsers. */ }
    props.onGesture(true);
  };
  const petWorld: WorldModelProps = { ...props,
    onAction: action => { if (current.current.enabled || petGesture.current) current.current.onAction(action); petGesture.current = false; },
    onGesture: active => {
      if (active) petGesture.current = current.current.enabled;
      if (petGesture.current) current.current.onGesture(active);
    },
    onHover: (id, hint) => { if (current.current.enabled || !id) current.current.onHover(id, hint); },
  };
  return <group name={`OrbitalResidents_${props.sceneId}`}>
    <group ref={resident} name="OrbitalResident" position={spawn} onPointerDown={characterDown}
      onPointerOver={e => { if (props.enabled) { e.stopPropagation(); props.onHover('resident', 'WASD 移动 · 空格跳跃 · 上划人物跳跃'); } }}
      onPointerOut={() => { if (props.enabled) props.onHover(null); }}>
      <group ref={hips} position={[0, HIP, 0]}>
        <ResidentModel rig={rig} onFailure={props.library?.fail} position={[0, -HIP, 0]} />
      </group>
    </group>
    <ObjectHandle id="pet" action="pet" hint="团子 · 轻抚 / 靠近按 E" world={petWorld} position={[CAT[0], 0, CAT[1]]} rotation={[0, 0.5, 0]}>
      <mesh position={[0, 0.04, 0]} castShadow receiveShadow><cylinderGeometry args={[0.37, 0.41, 0.08, 28]} /><meshStandardMaterial color="#d5c3aa" roughness={0.9} /></mesh>
      <mesh position={[0, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]}><torusGeometry args={[0.34, 0.045, 12, 28]} /><meshStandardMaterial color="#c4ad90" /></mesh>
      <group ref={petBody} position={[0, 0.09, 0]}>
        <Ball position={[0, 0.16, -0.02]} radius={0.21} scale={[0.8, 0.67, 1.15]} color="#e79748" />
        {[-0.12, 0, 0.1].map(z => <Ball key={z} position={[0, 0.29, z]} radius={0.08} scale={[1.6, 0.13, 0.25]} color="#b9662c" />)}
        {[-0.1, 0.1].flatMap(x => [-0.14, 0.17].map(z => <Ball key={`${x}/${z}`} position={[x, 0.035, z]} radius={0.058} scale={[1, 0.65, 1.25]} color="#fff3dc" />))}
        <Ball position={[0, 0.16, 0.17]} radius={0.13} scale={[0.88, 0.92, 0.55]} color="#fff3dc" />
        <group ref={petHead} position={[0, 0.32, 0.18]}>
          <Ball position={[0, 0, 0]} radius={0.165} scale={[1.06, 0.95, 0.98]} color="#e79748" />
          {[-1, 1].map(side => <React.Fragment key={side}>
            <Ball position={[side * 0.055, -0.035, 0.13]} radius={0.057} scale={[1.1, 0.85, 0.8]} color="#fff3dc" />
            <Ball position={[side * 0.068, 0.028, 0.145]} radius={0.028} color="#679c74" />
            <Ball position={[side * 0.068, 0.028, 0.163]} radius={0.018} scale={[0.45, 0.9, 0.5]} color="#172c29" />
            <group position={[side * 0.1, 0.14, 0.01]} rotation={[0.15, 0, -side * 0.35]}>
              <mesh castShadow><coneGeometry args={[0.068, 0.14, 4]} /><meshStandardMaterial color="#d17a36" /></mesh>
              <mesh position={[0, -0.01, 0.025]} scale={[0.65, 0.72, 0.5]}><coneGeometry args={[0.055, 0.11, 4]} /><meshStandardMaterial color="#e8aaa1" /></mesh>
            </group>
          </React.Fragment>)}
          <Ball position={[0, -0.012, 0.172]} radius={0.02} color="#dd8d8d" />
        </group>
        <group ref={petTail} position={[0, 0.16, -0.22]}>
          <mesh position={[0, 0.11, -0.08]} rotation={[-0.55, 0, 0]} castShadow><capsuleGeometry args={[0.032, 0.24, 5, 12]} /><meshStandardMaterial color="#e79748" /></mesh>
          <Ball position={[0, 0.24, -0.16]} radius={0.035} color="#fff3dc" />
        </group>
      </group>
      <group ref={sparks} visible={false}>{[0, 1, 2].map(i => <mesh key={i}><octahedronGeometry args={[0.045, 1]} /><meshBasicMaterial color="#e5ac9e" /></mesh>)}</group>
    </ObjectHandle>
  </group>;
}
