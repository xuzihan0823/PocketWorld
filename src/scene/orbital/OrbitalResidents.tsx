import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldAction, WorldActionKind, WorldModelProps } from '../../types/world';
import { roomAudio } from '../audioEngine';
import { ObjectHandle } from './ObjectHandle';
import { JOURNAL_POSITION } from './journalLayout';
import { Cat } from './Cat';
import { CHAIR_POSES, SEAT_DROP, SEAT_SWIVEL, chairFacing, chairFront, type ChairPose } from './chairPose';
import { applyLibraryPose, carryResident, libraryCrouch } from './library/residentPose';
import { residentLibraryTarget } from './library/bookMotion';
import { readingStand, shelfOrigin } from './library/catalog';
import { HIP_HEIGHT as HIP, ResidentModel, type ResidentLeg, type ResidentRig } from './ResidentModel';
import { WALK_SPEED } from './residentRig';
import { CHAIR_SIT_SECONDS, createChairMotion, stepChairMotion } from './chairMotion';
import { BED_ENTRY, BED_YAW, BED_DURATION, advanceBedTime, createBedPlayer, loadBedClip } from './bedMotion';
import { canReachDrawer, drawerObstacle, DRAWER_CLEAR_Z, DRAWER_TRAVEL, type DrawerInteraction } from './drawerInteraction';

type Point = [number, number];
type Box = [number, number, number, number];
type Circle = { x: number; z: number; radius: number };
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
// Leave full clearance when navigating or sitting; only the nearer body contact pushes the chair.
const CHAIR_CONTACT = 0.52;
const CHAIR_REACH = 0.95;
type NearbyAction = { id: string; kind: WorldActionKind; hint: string; point: Point; reach: number };
const CAT: Point = [-0.95, 1.95];
const clamp = THREE.MathUtils.clamp;
const ease = (t: number) => t * t * (3 - 2 * t);
const angle = (from: number, to: number, t: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * t;
// Scoot cycle: feet reach down, push the floor until the legs straighten, then lift and recover.
// The deeper seat pose leaves less clearance at the cushion lip during the foot stroke.
const CHAIR_PUSH_TRAVEL = 0.035, CHAIR_FOOT_RECOVERY = 0.023;
const KICK = 0.72, REACH_END = 0.3, PUSH_END = 0.75, SOLE_NEAR = 0.03, SOLE_FAR = 0.2, SOLE_LIFT = 0.06;
const PUSH = 3.4, ROLL_DRAG = 2.4;

function layout(observatory: boolean) {
  const [shelfX, , shelfZ] = shelfOrigin(observatory ? 'observatory' : 'habitat');
  const furniture: Box[] = [
    [-0.85, 2.95, -3.025, -1.675], // Desk, including the desktop overhang.
    [shelfX - 0.51, shelfX - 0.31, shelfZ + 1.2, shelfZ + 1.4],
    [shelfX - 0.59, shelfX + 0.59, shelfZ - 0.27, shelfZ + 0.27],
    ...(observatory ? [[-0.65, 0.15, 0.45, 1.25], [2.4, 3.1, 1.5, 2.2]] as Box[] : [[-3.46, -1.74, -0.32, 2.31], [-3.85, -3.25, 2.25, 2.85]] as Box[]),
  ];
  const grow = (by: number) => furniture.map(([a, b, c, d]) => [a - by, b + by, c - by, d + by] as Box);
  const chairRadius = observatory ? 0.55 : 0.5;
  const boxes = grow(RADIUS), chairBoxes = grow(chairRadius);
  return { seat: observatory ? 0.755 : 0.72, chairRadius,
    boxes, chairBoxes, baseBoxes: boxes, baseChairBoxes: chairBoxes,
    openBoxes: [...boxes, drawerObstacle(DRAWER_TRAVEL, RADIUS + 0.08)],
    openChairBoxes: [...chairBoxes, drawerObstacle(DRAWER_TRAVEL, chairRadius)] };
}
type Room = ReturnType<typeof layout>;
const seatYaw = chairFacing;
function obstacles(room: Room, pose: ChairPose): Box[] {
  const r = CHAIR_CONTACT;
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
    && (!blocker || Math.hypot(x - blocker[0], z - blocker[1]) >= CHAIR_CONTACT);
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
// Walk and chair roll use circular contact, including when Luna is already beside a corner
// of the square used to generate waypoints.
function distanceToSegment(x: number, z: number, p: Point, q: Point) {
  const dx = q[0] - p[0], dz = q[1] - p[1];
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared ? clamp(((x - p[0]) * dx + (z - p[1]) * dz) / lengthSquared, 0, 1) : 0;
  return Math.hypot(x - (p[0] + t * dx), z - (p[1] + t * dz));
}
function clearSegment(p: Point, q: Point, boxes: Box[], circle?: Circle) {
  if (circle && distanceToSegment(circle.x, circle.z, p, q) < circle.radius - 0.005) return false;
  const steps = Math.max(1, Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / 0.045));
  for (let i = 1; i <= steps; i++) if (!free([THREE.MathUtils.lerp(p[0], q[0], i / steps), THREE.MathUtils.lerp(p[1], q[1], i / steps)], boxes)) return false;
  return true;
}
/** A tiny visibility graph prevents a floor click behind the bed from stalling at its side. */
function route(start: Point, end: Point, boxes: Box[], circle?: Circle): Point[] {
  const target = reachable(end, boxes);
  const nodes: Point[] = [start, target];
  const corners = circle
    ? [...boxes, [circle.x - circle.radius, circle.x + circle.radius, circle.z - circle.radius, circle.z + circle.radius]]
    : boxes;
  corners.forEach(([a, b, c, d]) => {
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
      if (distance < distances[i] && clearSegment(nodes[current], nodes[i], boxes, circle)) { distances[i] = distance; previous[i] = current; }
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
function chairRoute(room: Room, pose: ChairPose, start: Point, target: Point) {
  if (!free(target, room.boxes)) return [];
  return route(start, target, room.boxes, { x: pose.x, z: pose.z, radius: CHAIR_CONTACT });
}

function chairClearance(room: Room, pose: ChairPose, start: Point) {
  const entry = chairEntry(room, pose);
  if (free(entry, room.boxes)) return { target: null, path: chairRoute(room, pose, start, entry) };

  // Keep the existing roll away from furniture when the current front is blocked.
  // If Luna is in the way, walk her out of the swept path before moving the chair.
  const facing = seatYaw(pose), dx = Math.sin(facing), dz = Math.cos(facing);
  const from: Point = [pose.x, pose.z];
  const radius = room.chairRadius + RADIUS;
  for (let distance = 0.05; distance <= 1.5; distance += 0.05) {
    const target: Point = [pose.x - dx * distance, pose.z - dz * distance];
    if (!chairOpen(room, ...target, null)) break;
    const shifted = { ...pose, x: target[0], z: target[1] };
    const front = chairEntry(room, shifted);
    if (!free(front, room.boxes)) continue;
    if (distanceToSegment(...start, from, target) >= radius) {
      if (chairRoute(room, shifted, start, front).length) return { target, path: [] };
    } else {
      const along = clamp((pose.x - start[0]) * dx + (pose.z - start[1]) * dz, 0, distance);
      const lateral = radius + 0.08;
      const nearSide = (start[0] - pose.x) * dz - (start[1] - pose.z) * dx < 0 ? -1 : 1;
      for (const side of [nearSide, -nearSide]) {
        const wait: Point = [pose.x - dx * along + dz * lateral * side, pose.z - dz * along - dx * lateral * side];
        const path = chairRoute(room, pose, start, wait);
        if (path.length && chairRoute(room, shifted, wait, front).length) return { target, path };
      }
    }
  }
  return { target: null, path: [] };
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
  const walkWeight = useRef(0), airborneMotion = useRef(0);
  const libraryNav = useRef('');
  const touch = useRef<{ id: number; x: number; y: number; target: EventTarget | null } | null>(null);
  const state = useRef({ posture: 'standing' as Posture, wanted: 'standing' as Posture, path: [] as Point[], external: false, exiting: false, blend: 0, sit: 0, lie: 0, lift: 0, velocity: 0, walkTime: 0, nearby: null as NearbyAction | null, nearbyHint: '', dismissedBed: false, dismissedChair: false,
    perch: 0, idle: Infinity, kick: 0, planted: false, plant: SOLE_NEAR, sole: SOLE_NEAR, soleLift: SOLE_LIFT });
  const bedMotion = useRef({ clip: null as THREE.AnimationClip | null, player: null as ReturnType<typeof createBedPlayer> | null, rig: null as ResidentRig | null, time: 0 });
  useEffect(() => {
    if (!props.objects.bed?.active || props.sceneId !== 'habitat') return;
    let live = true;
    void loadBedClip().then(clip => { if (live) bedMotion.current.clip = clip; }).catch(error => {
      if (live) { current.current.onHover('bed', '上床动作加载失败，请重试'); current.current.onAction({ sceneId: 'habitat', objectId: 'bed', kind: 'wake' }); }
      console.error(error);
    });
    return () => { live = false; };
  }, [props.objects.bed?.active, props.sceneId]);
  const exit = useRef({ from: new THREE.Vector3(), yaw: 0, sit: 0, lie: 0, progress: 0 });
  const chairMotion = useRef(createChairMotion());
  const movement = useMemo(() => ({ forward: new THREE.Vector3(), right: new THREE.Vector3(), step: new THREE.Vector3() }), []);

  const act = (objectId: string, kind: WorldActionKind) => {
    const p = current.current;
    const action: WorldAction = { sceneId: p.sceneId, objectId, kind };
    if (kind === 'sit' || kind === 'sleep') {
      const pose = CHAIR_POSES[p.sceneId];
      const [x, z] = kind === 'sit' ? [pose.x, pose.z] : BED_ENTRY;
      p.interaction.current?.([x, 0, z], action, () => current.current.onAction(action));
    } else p.onAction(action);
  };
  const canInteract = () => current.current.enabled && !drawerTask.current;
  const nearbyAction = () => {
    const p = current.current, root = resident.current, s = state.current;
    if (!root || !canInteract() || s.exiting || s.lift > 0 || s.velocity > 0 || p.focusedObject) return null;
    const pose = CHAIR_POSES[p.sceneId];
    const [shelfX, , shelfZ] = shelfOrigin(p.sceneId);
    const [bookX, , bookZ] = readingStand(p.sceneId);
    const drawerOpen = !!p.objects['desk-drawer']?.open;
    const targets: NearbyAction[] = [
      { id: 'computer', kind: 'inspect', hint: '使用电脑', point: [1.55, -1.36], reach: 0.64 },
      { id: 'schedule', kind: 'plan', hint: '打开日程', point: [0.57, -1.42], reach: 0.48 },
      { id: 'journal', kind: 'write', hint: '打开日记', point: [JOURNAL_POSITION[0], -1.42], reach: 0.43 },
      { id: 'music-player', kind: 'inspect', hint: '使用唱机', point: [-0.30, -1.42], reach: 0.43 },
      { id: 'book-01', kind: 'inspect', hint: '查看藏书', point: [bookX, bookZ], reach: 0.75 },
      { id: 'cabinet', kind: 'open', hint: '打开柜门', point: [shelfX + 0.55, shelfZ + 0.65], reach: 0.55 },
      { id: 'lamp', kind: 'toggle', hint: '开关灯', point: [-1.42, -2.55], reach: 0.70 },
      { id: 'plant', kind: 'water', hint: '给盆栽浇水', point: p.sceneId === 'habitat' ? [-3.55, 2.55] : [2.75, 1.85], reach: 0.85 },
      { id: 'pet', kind: 'pet', hint: '摸摸团子', point: CAT, reach: 0.85 },
      { id: 'chair', kind: 'sit', hint: '坐下', point: [pose.x, pose.z], reach: CHAIR_REACH },
    ];
    if (p.sceneId === 'habitat') targets.push({ id: 'bed', kind: 'sleep', hint: '躺下休息', point: BED_ENTRY, reach: 0.8 });
    if (p.drawerEnabled && canReachDrawer(root.position, drawerOpen)) targets.push({
      id: 'desk-drawer', kind: drawerOpen ? 'close' : 'open', hint: drawerOpen ? '推回抽屉' : '后退拉开抽屉',
      point: [0.35, drawerOpen ? -0.78 : -1.34], reach: 0.7,
    });
    let best: NearbyAction | null = null, bestDistance = Infinity;
    for (const target of targets) {
      const distance = Math.hypot(root.position.x - target.point[0], root.position.z - target.point[1]);
      if (distance < target.reach && distance < bestDistance) { best = target; bestDistance = distance; }
    }
    return best;
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
    const start: Point = [root.position.x, root.position.z];
    if (task.action.objectId === 'chair') {
      const { target, path } = chairClearance(room, pose, start);
      if (target || path.length) {
        task.chairTarget = target;
        state.current.path = path;
        return;
      }
      cancelApproach();
      p.onHover('chair', '前方空间不足，请先移开挡路的物品');
      return;
    }
    const fixed = task.action.objectId === 'bed' ? BED_ENTRY as Point
      : task.action.objectId === 'desk-drawer' ? [0.35, p.objects['desk-drawer']?.open ? -0.5 : -1.2] as Point : undefined;
    const path = approachRoute(start, task.point, obstacles(room, pose), fixed);
    if (path) state.current.path = path;
    else { cancelApproach(); p.onHover(task.action.objectId, '前方空间不足，请先移开挡路的物品'); }
  };
  useEffect(() => {
    const request: NonNullable<WorldModelProps['onApproach']> = (point, action, perform) => {
      const root = resident.current, p = current.current, s = state.current;
      if (!root || drawerTask.current || action.sceneId !== p.sceneId) return false;
      if (action.kind === 'stand' || action.kind === 'wake') { cancelApproach(); perform(); return true; }
      const pose = CHAIR_POSES[p.sceneId];
      const target: Point = action.objectId === 'chair' ? [pose.x, pose.z] : action.objectId === 'pet' ? CAT : [point[0], point[2]];
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
      if (action.objectId === 'chair') pose.vx = pose.vz = pose.spin = 0;
      p.onHover(action.objectId, action.objectId === 'chair' ? '走到椅子正面入座…' : '走近后进行交互…');
      if (!s.exiting) planApproach();
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
      if (event.code === 'Escape' && (approach.current || (state.current.posture === 'chair' && !p.focusedObject))) {
        // App's Escape handler must not restore its stale object snapshot after stand().
        event.preventDefault(); event.stopPropagation();
        if (approach.current) cancelApproach(); else stand();
        return;
      }
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
          const target = nearbyAction();
          if (target) { cancelApproach(); act(target.id, target.kind); }
        }
      } else if (event.code === 'Space') {
        const wasResting = state.current.wanted !== 'standing' || state.current.posture !== 'standing';
        if (wasResting) stand();
        jump.current = true;
      }
      else {
        const scooting = p.sceneId === 'habitat' && state.current.posture === 'chair' && !state.current.exiting && chairMotion.current.time === CHAIR_SIT_SECONDS;
        if (!scooting) stand();
        if (state.current.external) { state.current.external = false; p.onArrive(); }
        keys.current.add(event.code);
      }
    };
    const up = (event: KeyboardEvent) => { keys.current.delete(event.code); };
    const clear = () => {
      keys.current.clear(); jump.current = false; releaseTouch();
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
    if (!s.exiting && resident.current) {
      const pose = CHAIR_POSES[props.sceneId];
      const target = reachable([props.walkTarget[0], props.walkTarget[2]], obstacles(room, pose));
      s.path = chairRoute(room, pose, [resident.current.position.x, resident.current.position.z], target);
    }
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
      else if (pending.chairTarget && !s.path.length && !s.exiting) {
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
    const entry: Point = (s.posture !== 'standing' ? s.posture === 'bed' : wanted === 'bed') ? BED_ENTRY : seatEntry;
    if (wanted !== s.wanted) {
      s.wanted = wanted;
      s.path = [];
      if (s.external) { s.external = false; p.onArrive(); }
      if (s.posture !== 'standing') beginExit();
      else if (wanted !== 'standing') s.path = route([root.position.x, root.position.z], entry, obstacles(room, pose));
    }
    const scooting = p.sceneId === 'habitat' && s.posture === 'chair' && !s.exiting && s.blend >= 1;
    if (!scooting) {
      s.kick = 0; s.planted = false; s.idle = Infinity;
      s.perch = THREE.MathUtils.damp(s.perch, 0, 7, dt);
      if (s.posture === 'standing' && !s.exiting && approach.current?.action.objectId !== 'chair' && wanted !== 'chair') rollChair(room, pose, dt, false, [root.position.x, root.position.z]);
    }
    const surfaceAt = (x: number, z: number): 'wood' | 'rug' =>
      p.sceneId === 'observatory' && x >= -2.95 && x <= -0.05 && z >= -0.3 && z <= 1.9 ? 'rug' : 'wood';
    const frameX = root.position.x, frameZ = root.position.z;
    let walking = false;
    const bed = bedMotion.current;
    if (bed.clip && rig.current && bed.rig !== rig.current) {
      bed.player = createBedPlayer(rig.current.mesh, bed.clip); bed.rig = rig.current;
    }
    if (p.sceneId === 'habitat' && s.posture === 'chair') {
      const cm = chairMotion.current;
      const [dx, dz] = p.enabled && !s.exiting ? steer() : [0, 0];
      const driving = dx !== 0 || dz !== 0;
      const result = stepChairMotion(cm, dt, s.exiting, driving || Math.hypot(pose.vx, pose.vz) > .02, p.reducedMotion);
      pose.drop = 1 - cm.height / SEAT_DROP;
      s.blend = cm.time / CHAIR_SIT_SECONDS;
      s.sit = result.weight; s.lie = 0; s.perch = 0;
      if (result.canMove) {
        if (driving && !s.planted) pose.yaw = angle(pose.yaw, Math.atan2(-dx, -dz) - SEAT_SWIVEL - Math.PI, 1 - Math.exp(-dt * 5));
        if (!s.kick && driving) s.kick = 1e-4;
        if (s.kick) { s.kick += dt / KICK; if (s.kick >= 1) s.kick = driving ? Math.max(1e-4, s.kick - 1) : 0; }
        const facing = seatYaw(pose), backX = -Math.sin(facing), backZ = -Math.cos(facing);
        const pushing = s.kick >= REACH_END && s.kick < PUSH_END;
        if (pushing) {
          if (!s.planted) { s.planted = true; s.plant = 0; roomAudio.playFootstep({ variant: 'push', surface: surfaceAt(pose.x, pose.z), intensity: .75 }); }
          const speed = Math.max(0, pose.vx * backX + pose.vz * backZ) + PUSH * dt;
          pose.vx = backX * speed; pose.vz = backZ * speed;
        } else s.planted = false;
        const oldX = pose.x, oldZ = pose.z;
        rollChair(room, pose, dt, pushing, null);
        if (pushing) { s.plant += (pose.x-oldX)*backX + (pose.z-oldZ)*backZ; if (s.plant >= CHAIR_PUSH_TRAVEL) { s.plant = CHAIR_PUSH_TRAVEL; s.kick = PUSH_END; s.planted = false; } }
        if (!s.kick) { s.sole = 0; s.soleLift = 0; }
        else if (s.kick < REACH_END) { s.sole = 0; s.soleLift = .035 * Math.sin(s.kick / REACH_END * Math.PI); }
        else if (s.planted) { s.sole = s.plant; s.soleLift = 0; }
        else { const u = clamp((s.kick-PUSH_END)/(1-PUSH_END),0,1); s.sole = s.plant * (1-ease(u)); s.soleLift = CHAIR_FOOT_RECOVERY * Math.sin(u * Math.PI); }
      } else {
        pose.vx = pose.vz = pose.spin = 0;
        s.kick = 0; s.planted = false;
        s.sole = THREE.MathUtils.damp(s.sole, 0, 16, dt);
        s.soleLift = THREE.MathUtils.damp(s.soleLift, 0, 16, dt);
      }
      const start = chairFront(pose, result.offset), u = ease(cm.align);
      root.position.set(THREE.MathUtils.lerp(seatEntry[0],start[0],u), cm.height, THREE.MathUtils.lerp(seatEntry[1],start[1],u));
      root.rotation.y = seatYaw(pose);
      if (result.done) {
        s.posture = 'standing'; s.exiting = false; s.blend = 0; s.sit = 0; s.sole = 0; s.soleLift = 0;
        chairMotion.current = createChairMotion();
        if (libraryWalking && libraryTarget) s.path = route(entry, [libraryTarget[0],libraryTarget[2]], obstacles(room,pose));
        else if (approach.current) planApproach();
        else if (s.external && p.walkTarget) s.path = route(entry,[p.walkTarget[0],p.walkTarget[2]],obstacles(room,pose));
        else if (wanted !== 'standing') s.path = route(entry, wanted === 'bed' ? BED_ENTRY : seatEntry, obstacles(room, pose));
      }
    } else if (s.posture === 'bed' && bed.player) {
      // Controller owns the fixed entry transform. Clip owns all bone/root motion.
      root.position.set(BED_ENTRY[0], 0, BED_ENTRY[1]); root.rotation.set(0, BED_YAW, 0);
      bed.time = advanceBedTime(bed.time, dt, s.exiting, p.reducedMotion);
      s.sit = 0; s.lie = 0; s.blend = bed.time / BED_DURATION;
      if (s.exiting && bed.time === 0) {
        s.posture = 'standing'; s.exiting = false; s.blend = 0;
        if (libraryWalking && libraryTarget) s.path = route(BED_ENTRY, [libraryTarget[0], libraryTarget[2]], obstacles(room, pose));
        else if (approach.current) planApproach();
        else if (s.external && p.walkTarget) s.path = route(BED_ENTRY, [p.walkTarget[0], p.walkTarget[2]], obstacles(room, pose));
        else if (wanted !== 'standing') s.path = route(BED_ENTRY, wanted === 'bed' ? BED_ENTRY : seatEntry, obstacles(room, pose));
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
        else if (wanted !== 'standing') s.path = route(entry, wanted === 'bed' ? BED_ENTRY : seatEntry, obstacles(room, pose));
      }
    } else if (s.posture !== 'standing') {
      s.blend = Math.min(1, s.blend + dt / (p.reducedMotion ? 0.4 : 0.9));
      const t = ease(s.blend);
      const bed = s.posture === 'bed';
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
      const yaw = bed ? 0 : seatYaw(pose);
      const forward = 0.1 + s.perch * 0.23;
      const destination: Point = bed ? [-2.6, 0.94] : [pose.x + Math.sin(yaw) * forward, pose.z + Math.cos(yaw) * forward];
      const slide = bed ? ease(clamp((t - 0.2) / 0.8, 0, 1)) : t;
      root.position.x = THREE.MathUtils.lerp(entry[0], destination[0], slide);
      root.position.z = THREE.MathUtils.lerp(entry[1], destination[1], slide);
      root.rotation.y = scooting ? yaw : angle(root.rotation.y, yaw, 1 - Math.exp(-dt * 12));
      // Hip center sits one hip radius above the actual cushion; supine back rests on the duvet.
      root.position.y = bed ? ease(clamp(t / 0.35, 0, 1)) * (0.929 - HIP) : t * (room.seat + 0.095 - HIP) - pose.drop * SEAT_DROP;
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
          const usesChairCircle = approach.current?.action.objectId === 'chair' || (s.external && !approach.current);
          const clear = usesChairCircle
            ? clearSegment([beforeX, beforeZ], [x, z], room.boxes, { x: pose.x, z: pose.z, radius: CHAIR_CONTACT })
            : clearSegment([beforeX, beforeZ], [x, z], obstacles(room, pose));
          if (clear) { root.position.x = x; root.position.z = z; }
          else if (approach.current) planApproach();
        } else {
          if (free([x, root.position.z], room.boxes)) root.position.x = x;
          if (free([root.position.x, z], room.boxes)) root.position.z = z;
        }
        // Only a grounded step into the chair produces a shove.
        const offsetX = pose.x - root.position.x, offsetZ = pose.z - root.position.z;
        const gap = Math.hypot(offsetX, offsetZ);
        if (gap < CHAIR_CONTACT && gap > 1e-4 && s.lift === 0 && !s.path.length && !task) {
          const nx = offsetX / gap, nz = offsetZ / gap;
          const travel = (root.position.x - beforeX) * nx + (root.position.z - beforeZ) * nz;
          if (travel > 0) {
            const pushX = root.position.x + nx * CHAIR_CONTACT, pushZ = root.position.z + nz * CHAIR_CONTACT;
            if (chairOpen(room, pushX, pushZ, null)) {
              pose.x = pushX; pose.z = pushZ;
              const shove = dt > 0 ? Math.min(travel / dt, WALK_SPEED) * 0.36 : 0;
              pose.vx = nx * shove; pose.vz = nz * shove;
              pose.spin = (dx * nz - dz * nx) * shove * 0.8;
            } else { root.position.x = beforeX; root.position.z = beforeZ; }
          }
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
        const target = request?.action.objectId === 'chair' ? seatEntry : request?.action.objectId === 'bed' ? BED_ENTRY : request?.point;
        const distance = target ? Math.hypot(root.position.x - target[0], root.position.z - target[1]) : 0;
        const radius = fixed ? 0.06 : 1.15;
        cancelApproach();
        if (request && distance <= radius) request.perform();
      }
      if (!s.path.length && autonomous && s.lift <= 0) {
        if (Math.hypot(root.position.x - entry[0], root.position.z - entry[1]) < 0.06) {
          const yaw = wanted === 'chair' ? seatYaw(pose) : BED_YAW;
          root.rotation.y = angle(root.rotation.y, yaw, 1 - Math.exp(-dt * 12));
          const facingTarget = Math.abs(Math.atan2(Math.sin(yaw - root.rotation.y), Math.cos(yaw - root.rotation.y))) < 0.06;
          if (facingTarget && rig.current && (wanted !== 'bed' || bed.player)) {
            s.posture = wanted; s.blend = 0;
            if (wanted === 'chair') { chairMotion.current = createChairMotion(); s.sole = s.soleLift = 0; }
            if (wanted === 'bed') { bed.time = 0; root.rotation.y = BED_YAW; }
          }
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
    if (p.sceneId !== 'habitat') pose.drop = s.perch;
    else if (s.posture !== 'chair') pose.drop = 1;
    const distance = Math.hypot(root.position.x - frameX, root.position.z - frameZ);
    const groundedWalk = walking && s.lift === 0 && distance > .00001;
    if (groundedWalk) {
      const next = s.walkTime + distance / WALK_SPEED;
      const halfStep = Math.floor(next * 2);
      if (halfStep !== Math.floor(s.walkTime * 2))
        roomAudio.playFootstep({ foot: (halfStep & 1) as 0 | 1, surface: surfaceAt(root.position.x, root.position.z) });
      s.walkTime = next % 1;
    }
    const interactionPose = s.posture !== 'standing' || s.exiting || s.lift > 0 || (libraryActive && !libraryWalking);
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
      const sit = p.sceneId === 'habitat' && s.posture === 'chair' ? 0 : s.sit;
      const straighten = Math.max(sit, s.lie, s.perch);
      rig.current.skirtFront.rotation.x = -sit * Math.PI / 2;
      rig.current.skirtFront.position.y = HIP + s.sit * 0.05;
      rig.current.skirtFront.position.z = 0.19 + s.sit * 0.13;
      rig.current.skirtBack.rotation.x = -sit * 0.4;
      rig.current.legs.forEach((leg, side) => {
        let thigh = -sit * Math.PI / 2, knee = sit * Math.PI / 2;
        if (libraryActive && root.position.y < -.001) [thigh, knee] = legReach(leg, -leg.hipForward, root.position.y + HIP - leg.ankleHeight);
        if (s.perch > 0.001) {
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
    if (rig.current) {
      const playingBed = s.posture === 'bed' && bed.player;
      const playingChair = p.sceneId === 'habitat' && s.posture === 'chair';
      if (!playingBed) rig.current.applyPose(s.walkTime, ease(walkWeight.current));
      rig.current.applyChairPose?.(
        playingChair ? chairMotion.current.time : 0,
        playingChair ? ease(chairMotion.current.align) : 0,
        playingChair ? s.sole : 0,
        playingChair ? s.soleLift : 0,
      );
      if (playingBed) playingBed(bed.time);
    }
    if (library && rig.current) library.tick(dt);
    root.userData.posture = s.exiting ? 'standing-up' : s.posture;
    root.userData.grounded = s.lift === 0;
    root.userData.chairPhase = s.posture === 'chair' ? chairMotion.current.phase : 'idle';
    root.userData.chairHeight = chairMotion.current.height;
    root.userData.bedTime = s.posture === 'bed' ? bed.time : null;
    const nearby = nearbyAction();
    const hint = canInteract() && (s.posture !== 'standing' || wanted !== 'standing')
      ? 'E · 起身' : nearby ? `E · ${nearby.hint}` : '';
    if (!drawerTask.current && (nearby?.id !== s.nearby?.id || hint !== s.nearbyHint)) {
      s.nearby = nearby;
      s.nearbyHint = hint;
      p.onHover(nearby?.id ?? (hint ? s.posture : null), hint || undefined);
    }
  }, -1);

  const characterDown = (event: ThreeEvent<PointerEvent>) => {
    if (!props.enabled || drawerTask.current || event.pointerType !== 'touch' || touch.current) return;
    event.stopPropagation();
    touch.current = { id: event.pointerId, x: event.clientX, y: event.clientY, target: event.target };
    try { (event.target as Element).setPointerCapture?.(event.pointerId); } catch { /* Optional on touch-only browsers. */ }
    props.onGesture(true);
  };
  return <group name={`OrbitalResidents_${props.sceneId}`}>
    <group ref={resident} name="OrbitalResident" position={spawn} onPointerDown={characterDown}
    >
      <group ref={hips} position={[0, HIP, 0]}>
        <ResidentModel rig={rig} onFailure={props.library?.fail} position={[0, -HIP, 0]} />
      </group>
    </group>
    <ObjectHandle id="pet" action="pet" hint="摸摸团子" world={props} position={[CAT[0], 0, CAT[1]]} rotation={[0, 0.5, 0]}
      onClick={event => event.stopPropagation()}>
      <Cat resident={resident} value={props.objects.pet?.value ?? 0} reducedMotion={props.reducedMotion} />
    </ObjectHandle>
  </group>;
}
