import { SOFA_ENTRY, SOFA_STEPS, loadSofaClip, sofaPlayer } from './sofaMotion';
import { CABIN_DIVIDER_X, DECK_WALK_BOUNDS, UPPER_DECK_OFFSET, deckFromAuthoredX, BED_POSITION, CAT_HOME, CAT_MAT_Y, COMPUTER_STAND, FLOOR_SOFA, PLUSH_DOLLS, PLUSH_FLOOR_BOUNDS, TRASH_CAN, HABITAT_SPAWN, WARDROBE_FOOTPRINT, WARDROBE_STAND, NIGHTSTAND_X, NIGHTSTAND_Z, RESIDENT_RADIUS, WALK_BOUNDS } from './cabinLayout';
import { STAIR_DISTANCE, atStairEntrance, otherDeck, sampleCabinStairs, stairDestination, stairLanding, type CabinResidentView } from './cabinStairs';
import type { CabinDeck } from './cabinLayout';
import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldAction, WorldActionKind, WorldModelProps } from '../../types/world';
import { roomAudio } from '../audioEngine';
import { ObjectHandle } from './ObjectHandle';
import { outfitHint, type ResidentOutfit } from './wardrobe/outfit';
import { JOURNAL_POSITION } from './journalLayout';
import { SCHEDULE_BOOK_POSITION } from './schedule/bookLayout';
import { Cat } from './Cat';
import { CHAIR_POSES, chairFront, type ChairPose } from './chairPose';
import { applyLibraryPose, carryResident, libraryCrouch } from './library/residentPose';
import { resetArms } from './library/armPose';
import { authoredBookStand, libraryHeldBalance, residentLibraryTarget } from './library/bookMotion';
import { createLibraryPlayer, libraryCoverFlow, libraryMotionSample, loadLibraryMotion, type LibraryMotion } from './library/libraryMotion';
import { readingStand, shelfOrigin, shelfPoint, shelfYaw } from './library/catalog';
import { HIP_HEIGHT as HIP, ResidentModel, type ResidentLeg, type ResidentRig } from './ResidentModel';
import { WALK_SPEED } from './residentRig';
import { createIdlePlayer, createIdleState, loadYawn, loadLookingAround, stepIdle, STANDING_IDLE } from './standingIdle';
import { CHAIR_SIT_SECONDS, createChairMotion, stepChairMotion } from './chairMotion';
import { SlipperPair } from './Slippers';
import { PlushDolls } from './PlushDolls';
import { createPlushBodies, isValidPlushBody, plushObstacleBoxes, resolveMoverAgainstPlush, stepPlushDolls, type PlushBody } from './plushMotion';

type Point = [number, number];
type Box = [number, number, number, number];
type Circle = { x: number; z: number; radius: number };
type StairTravel = { from: CabinDeck; distance: number };
type Posture = 'standing' | 'chair' | 'sofa';
type ResidentsProps = WorldModelProps & {
  outfit: ResidentOutfit;
  walkTarget: [number, number, number] | null;
  onArrive: () => void;
  enabled: boolean;
  approachEnabled: boolean;
  catMenuOpen: boolean;
  deckView?: React.MutableRefObject<CabinResidentView>;
  upperVisible?: boolean;
  showNearbyHints?: boolean;
  sofaTime: React.MutableRefObject<number | null>;
  interaction: React.MutableRefObject<NonNullable<WorldModelProps['onApproach']> | null>;
};
type Approach = { point: Point; action: WorldAction; perform: () => void; elapsed: number };
const RADIUS = RESIDENT_RADIUS;
const STAIR_SPEED = WALK_SPEED * 1.2;
const CHAIR_CONTACT = 0.52;
const CHAIR_REACH = 0.95;
const PET_REACH = 0.70;
type NearbyAction = { id: string; kind: WorldActionKind; hint: string; point: Point; reach: number };
// E is the nearest prop; Q/R reach the next-closest ones when furniture crowds the same spot.
const INTERACT_KEYS = ['KeyE', 'KeyQ', 'KeyR'];
const INTERACT_LABELS = ['E', 'Q', 'R'];
const clamp = THREE.MathUtils.clamp;
const ease = (t: number) => t * t * (3 - 2 * t);
const angle = (from: number, to: number, t: number) => from + Math.atan2(Math.sin(to - from), Math.cos(to - from)) * t;
function layout(observatory: boolean) {
  const [shelfX, , shelfZ] = shelfOrigin(observatory ? 'observatory' : 'habitat');
  const [sofaX, , sofaZ] = FLOOR_SOFA.position;
  const { left, right, back, front } = FLOOR_SOFA.footprint;
  const [trashX, , trashZ] = TRASH_CAN.position;
  const trashFoot = TRASH_CAN.footprint;
  const furniture: Box[] = [
    [-0.85, 2.95, -3.025, -1.675], // Desk, including the desktop overhang.
    observatory ? [shelfX - .59, shelfX + .59, shelfZ - .27, shelfZ + .27]
      : [shelfX - .27, shelfX + .31, shelfZ - .65, shelfZ + .65],
    ...(observatory ? [[-0.65, 0.15, 0.45, 1.25], [2.4, 3.1, 1.5, 2.2]] as Box[] : [
      [BED_POSITION[0] - .86, BED_POSITION[0] + .86, BED_POSITION[2] - 1.3, BED_POSITION[2] + 1.3],
      [sofaX + left, sofaX + right, sofaZ + back, sofaZ + front],
      [trashX + trashFoot.left, trashX + trashFoot.right, trashZ + trashFoot.back, trashZ + trashFoot.front],
      WARDROBE_FOOTPRINT,
      [NIGHTSTAND_X - .61, NIGHTSTAND_X + .61, NIGHTSTAND_Z - .355, NIGHTSTAND_Z + .397],
      [-1.81, -.85, -3.03, -1.75],
    ] as Box[]),
  ];
  const grow = (by: number) => furniture.map(([a, b, c, d]) => [a - by, b + by, c - by, d + by] as Box);
  const chairRadius = observatory ? 0.55 : 0.5;
  // Keep kicked plush dolls out of static furniture, the fixed desk chair, and Tuanzi's cat mat.
  const chair = CHAIR_POSES.habitat;
  const plushBoxes: Box[] = observatory ? furniture : [
    ...furniture,
    [chair.x - 0.38, chair.x + 0.38, chair.z - 0.38, chair.z + 0.38],
    [2.58, 3.46, 1.98, 2.78],
  ];
  return { observatory, seat: observatory ? 0.755 : 0.72, chairRadius, boxes: grow(RADIUS), plushBoxes };
}
type Room = ReturnType<typeof layout>;
function obstacles(room: Room, pose: ChairPose): Box[] {
  const r = CHAIR_CONTACT;
  return [...room.boxes, [pose.x - r, pose.x + r, pose.z - r, pose.z + r]];
}
function chairEntry(room: Room, pose: ChairPose): Point {
  const yaw = pose.yaw;
  const distance = (room.chairRadius + RADIUS) / Math.max(Math.abs(Math.sin(yaw)), Math.abs(Math.cos(yaw))) + 0.08;
  return chairFront(pose, distance);
}
/** Solve the ankle target; the independent foot bone keeps the sole level. */
function legReach(leg: ResidentLeg, ahead: number, below: number): [number, number] {
  const { upperLength: thigh, lowerLength: shin } = leg;
  const reach = clamp(Math.hypot(ahead, below), Math.abs(thigh - shin) + 0.001, (thigh + shin) * 0.999);
  const hip = Math.atan2(ahead, below) + Math.acos(clamp((thigh * thigh + reach * reach - shin * shin) / (2 * thigh * reach), -1, 1));
  const knee = Math.PI - Math.acos(clamp((thigh * thigh + shin * shin - reach * reach) / (2 * thigh * shin), -1, 1));
  return [-hip, knee];
}
function free(point: Point, boxes: Box[], bounds = WALK_BOUNDS) {
  return point[0] >= bounds.left && point[0] <= bounds.right && point[1] >= bounds.back && point[1] <= bounds.front && !boxes.some(([a, b, c, d]) => point[0] > a && point[0] < b && point[1] > c && point[1] < d);
}
function reachable(point: Point, boxes: Box[], bounds = WALK_BOUNDS): Point {
  let result: Point = [clamp(point[0], bounds.left, bounds.right), clamp(point[1], bounds.back, bounds.front)];
  for (let pass = 0; pass < 8; pass++) {
    const box = boxes.find(([a, b, c, d]) => result[0] > a && result[0] < b && result[1] > c && result[1] < d);
    if (!box) break;
    const [a, b, c, d] = box;
    const candidates: Point[] = [[a - 0.015, result[1]], [b + 0.015, result[1]], [result[0], c - 0.015], [result[0], d + 0.015]];
    candidates.sort((p, q) => Math.hypot(p[0] - result[0], p[1] - result[1]) - Math.hypot(q[0] - result[0], q[1] - result[1]));
    result = candidates.find(p => free(p, boxes, bounds)) ?? candidates.find(p => free(p, [], bounds)) ?? [(bounds.left + bounds.right) / 2, .5];
  }
  return result;
}
// Chair clearance uses circular contact around the fixed floor mount.
function distanceToSegment(x: number, z: number, p: Point, q: Point) {
  const dx = q[0] - p[0], dz = q[1] - p[1];
  const lengthSquared = dx * dx + dz * dz;
  const t = lengthSquared ? clamp(((x - p[0]) * dx + (z - p[1]) * dz) / lengthSquared, 0, 1) : 0;
  return Math.hypot(x - (p[0] + t * dx), z - (p[1] + t * dz));
}
function clearSegment(p: Point, q: Point, boxes: Box[], circle?: Circle, bounds = WALK_BOUNDS) {
  if (circle && distanceToSegment(circle.x, circle.z, p, q) < circle.radius - 0.005) return false;
  const steps = Math.max(1, Math.ceil(Math.hypot(p[0] - q[0], p[1] - q[1]) / 0.045));
  for (let i = 1; i <= steps; i++) if (!free([THREE.MathUtils.lerp(p[0], q[0], i / steps), THREE.MathUtils.lerp(p[1], q[1], i / steps)], boxes, bounds)) return false;
  return true;
}
/** A tiny visibility graph prevents a floor click behind the bed from stalling at its side. */
function route(start: Point, end: Point, boxes: Box[], circle?: Circle, bounds = WALK_BOUNDS): Point[] {
  const target = reachable(end, boxes, bounds);
  const nodes: Point[] = [start, target];
  const corners = circle
    ? [...boxes, [circle.x - circle.radius, circle.x + circle.radius, circle.z - circle.radius, circle.z + circle.radius]]
    : boxes;
  corners.forEach(([a, b, c, d]) => {
    for (const x of [a - 0.025, b + 0.025]) for (const z of [c - 0.025, d + 0.025]) if (free([x, z], boxes, bounds)) nodes.push([x, z]);
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
      if (distance < distances[i] && clearSegment(nodes[current], nodes[i], boxes, circle, bounds)) { distances[i] = distance; previous[i] = current; }
    }
  }
  return [];
}
function approachRoute(start: Point, point: Point, boxes: Box[], bounds: typeof WALK_BOUNDS, fixed?: Point, reach = 1.15): Point[] | null {
  if (!fixed && Math.hypot(start[0] - point[0], start[1] - point[1]) <= reach) return [];
  const targets: Point[] = fixed ? [fixed] : [];
  if (!fixed) for (const radius of [0.36, 0.58, 0.85].filter(radius => radius < reach)) for (let i = 0; i < 24; i++) {
    const yaw = i * Math.PI / 12;
    targets.push([point[0] + Math.sin(yaw) * radius, point[1] + Math.cos(yaw) * radius]);
  }
  let best: Point[] | null = null, bestLength = Infinity;
  for (const target of targets) {
    if (!free(target, boxes, bounds)) continue;
    const path = route(start, target, boxes, undefined, bounds);
    if (!path.length) continue;
    let length = 0, previous = start;
    for (const waypoint of path) { length += Math.hypot(waypoint[0] - previous[0], waypoint[1] - previous[1]); previous = waypoint; }
    if (length < bestLength) { best = path; bestLength = length; }
  }
  return best;
}
function walkBounds(room: Room, x: number) {
  return room.observatory ? WALK_BOUNDS : DECK_WALK_BOUNDS[deckFromAuthoredX(x)];
}

function residentRoute(room: Room, start: Point, end: Point, boxes: Box[], circle?: Circle): Point[] {
  const from = deckFromAuthoredX(start[0]), to = deckFromAuthoredX(end[0]);
  if (room.observatory || from === to) return route(start, end, boxes, circle, walkBounds(room, start[0]));
  const landing = stairLanding(to);
  const first = route(start, stairLanding(from), boxes, circle, DECK_WALK_BOUNDS[from]);
  const last = route(landing, end, boxes, circle, DECK_WALK_BOUNDS[to]);
  return first.length && last.length ? [...first, landing, ...last] : [];
}

function chairRoute(room: Room, pose: ChairPose, start: Point, target: Point) {
  return residentRoute(room, start, target, room.boxes, { x: pose.x, z: pose.z, radius: CHAIR_CONTACT });
}

/** Keep authored prop coordinates for seating, collision and interaction. The parent places Luna in the stack. */
export function OrbitalResidents(props: ResidentsProps) {
  const current = useRef(props);
  current.current = props;
  const { camera } = useThree();
  const room = useMemo(() => layout(props.sceneId === 'observatory'), [props.sceneId]);
  const spawn = useMemo(() => { const start = props.sceneId === 'habitat' ? HABITAT_SPAWN : [0.25, 0.5] as Point; const point = reachable(start, obstacles(room, CHAIR_POSES[props.sceneId]), walkBounds(room, start[0])); return [point[0], 0, point[1]] as [number, number, number]; }, [room]);
  const resident = useRef<THREE.Group>(null);
  const deckFrame = useRef<THREE.Group>(null);
  const rig = useRef<ResidentRig | null>(null);
  const plushBodies = useRef<PlushBody[]>(props.sceneId === 'habitat' ? createPlushBodies(PLUSH_DOLLS) : []);
  const slipperRoom = useRef<{ boxes: Box[] }>({ boxes: room.boxes });
  useEffect(() => {
    plushBodies.current = props.sceneId === 'habitat' ? createPlushBodies(PLUSH_DOLLS) : [];
    slipperRoom.current.boxes = room.boxes;
  }, [props.sceneId, room]);
  const idle = useRef(createIdleState());
  const idleMotion = useRef({ rig: null as ResidentRig | null, player: null as ReturnType<typeof createIdlePlayer> | null,
    clip: null as THREE.AnimationClip | null, loading: false, retryAt: 0,
    lookClip: null as THREE.AnimationClip | null, lookLoading: false, lookRetryAt: 0 });
  const idleInput = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const keys = useRef(new Set<string>());
  const approach = useRef<Approach | null>(null);
  const catLocation = useRef<Point>([...CAT_HOME]);
  const walkWeight = useRef(0);
  const libraryNav = useRef('');
  const libraryAsset = props.library?.motion;
  const libraryOpen = props.library ? props.library.view.phase !== 'idle' : false;
  const libraryPlayer = useRef<{ motion: LibraryMotion; rig: ResidentRig; apply: ReturnType<typeof createLibraryPlayer> }>();
  useEffect(() => {
    if (!libraryOpen || !libraryAsset) return;
    if (rig.current?.fitted) {
      libraryAsset.current = rig.current.fitted.library;
      return;
    }
    let live = true;
    libraryAsset.current = undefined;
    void loadLibraryMotion().then(motion => {
      if (live) libraryAsset.current = motion;
    }).catch(error => {
      if (live) libraryAsset.current = null;
      console.warn('Luna book animation could not be loaded; using the existing pose.', error);
    });
    return () => { live = false; };
  }, [libraryAsset, libraryOpen, props.outfit]);
  const state = useRef({ posture: 'standing' as Posture, wanted: 'standing' as Posture, path: [] as Point[], stairs: null as StairTravel | null, external: false, exiting: false, blend: 0, sit: 0, walkTime: 0, nearby: null as NearbyAction | null, nearbyHint: '', dismissedChair: false, dismissedSofa: false });
  const sofaMotion = useRef({ time: 0, clip: null as THREE.AnimationClip | null,
    apply: null as ReturnType<typeof sofaPlayer> | null, rig: null as ResidentRig | null });
  useEffect(() => {
    if (!props.objects.sofa?.active || props.sceneId !== 'habitat' || rig.current?.fitted) return;
    let live = true;
    void loadSofaClip().then(clip => { if (live) sofaMotion.current.clip = clip; }).catch(() => {
      if (live) {
        current.current.onHover('sofa', '沙发动作加载失败，请重试');
        current.current.onAction({ sceneId: 'habitat', objectId: 'sofa', kind: 'stand' });
      }
    });
    return () => { live = false; };
  }, [props.objects.sofa?.active, props.sceneId]);
  const exit = useRef({ from: new THREE.Vector3(), yaw: 0, sit: 0, progress: 0 });
  const chairMotion = useRef(createChairMotion());
  const movement = useMemo(() => ({ forward: new THREE.Vector3(), right: new THREE.Vector3(), step: new THREE.Vector3() }), []);

  const act = (objectId: string, kind: WorldActionKind) => {
    const p = current.current;
    const action: WorldAction = { sceneId: p.sceneId, objectId, kind };
    if (kind === 'sit') {
      const pose = CHAIR_POSES[p.sceneId];
      const [x, z] = objectId === 'sofa' ? SOFA_ENTRY : [pose.x, pose.z];
      p.interaction.current?.([x, 0, z], action, () => current.current.onAction(action));
    } else p.onAction(action);
  };
  const nearbyActions = (): NearbyAction[] => {
    const p = current.current, root = resident.current, s = state.current;
    if (!root || !p.enabled || s.exiting || s.stairs || p.focusedObject) return [];
    const pose = CHAIR_POSES[p.sceneId];
    const [cabinetX, , cabinetZ] = shelfPoint(p.sceneId, .55, 0, .65);
    const [bookX, , bookZ] = readingStand(p.sceneId);
    const targets: NearbyAction[] = [
      // The desk chair occupies the nearest ring, so reach the free floor beside it.
      { id: 'computer', kind: 'inspect', hint: '使用电脑', point: COMPUTER_STAND, reach: 0.88 },
      { id: 'schedule', kind: 'plan', hint: '打开日程', point: [SCHEDULE_BOOK_POSITION[0] + 0.02, -1.42], reach: 0.42 },
      { id: 'journal', kind: 'write', hint: '打开日记', point: [JOURNAL_POSITION[0], -1.42], reach: 0.40 },
      { id: 'music-player', kind: 'inspect', hint: '使用唱机', point: [-0.30, -1.42], reach: 0.40 },
      { id: 'book-01', kind: 'inspect', hint: '查看藏书', point: [bookX, bookZ], reach: 0.70 },
      { id: 'cabinet', kind: 'open', hint: '打开柜门', point: [cabinetX, cabinetZ], reach: 0.55 },
      { id: 'lamp', kind: 'toggle', hint: '开关灯', point: p.sceneId === 'habitat' ? [NIGHTSTAND_X - .11, NIGHTSTAND_Z + .77] : [-1.42, -2.55], reach: 0.46 },
      { id: 'plant', kind: 'water', hint: '给盆栽浇水', point: p.sceneId === 'habitat' ? [NIGHTSTAND_X + .32, NIGHTSTAND_Z + .78] : [2.75, 1.85], reach: 0.55 },
      { id: 'pet', kind: 'pet', hint: '和团子互动', point: catLocation.current, reach: PET_REACH },
      { id: 'chair', kind: 'sit', hint: '坐下', point: [pose.x, pose.z], reach: CHAIR_REACH },
    ];
    if (p.sceneId === 'habitat') {
      targets.push({ id: 'wardrobe', kind: 'toggle', hint: outfitHint(p.outfit), point: WARDROBE_STAND, reach: .75 });
      targets.push({ id: 'sofa', kind: 'sit', hint: '坐进懒人沙发', point: SOFA_ENTRY, reach: .85 });
      targets.push({ id: 'clock', kind: 'inspect', hint: '设置闹钟', point: [NIGHTSTAND_X + .22, NIGHTSTAND_Z + .64], reach: 0.46 });
    }
    const deck = deckFromAuthoredX(root.position.x);
    const found = targets
      .filter(target => room.observatory || deckFromAuthoredX(target.point[0]) === deck)
      .map(target => ({ target, distance: Math.hypot(root.position.x - target.point[0], root.position.z - target.point[1]) }))
      .filter(({ target, distance }) => distance < target.reach)
      .sort((a, b) => a.distance - b.distance);
    return found.slice(0, INTERACT_KEYS.length).map(({ target }) => target);
  };
  const beginExit = () => {
    const s = state.current;
    if (s.exiting || s.posture === 'standing' || !resident.current) return;
    exit.current.from.copy(resident.current.position);
    exit.current.yaw = resident.current.rotation.y;
    exit.current.sit = s.sit; exit.current.progress = 0;
    s.exiting = true;
  };
  const stand = () => {
    const s = state.current;
    if (current.current.objects.sofa?.active && !s.dismissedSofa) { s.dismissedSofa = true; act('sofa', 'stand'); }
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
  const cancelApproach = () => {
    approach.current = null;
    state.current.path = [];
    state.current.external = false;
    current.current.onArrive();
  };
  const nextWalkStart = (root: THREE.Group): Point => {
    const stairs = state.current.stairs;
    return stairs ? stairLanding(otherDeck(stairs.from)) : [root.position.x, root.position.z];
  };
  const planApproach = () => {
    const task = approach.current, root = resident.current, p = current.current;
    if (!task || !root) return;
    const pose = CHAIR_POSES[p.sceneId];
    const start = nextWalkStart(root);
    if (task.action.objectId === 'chair') {
      const path = chairRoute(room, pose, start, chairEntry(room, pose));
      if (path.length) {
        state.current.path = path;
        return;
      }
      cancelApproach();
      p.onHover('chair', '前方空间不足，请先移开挡路的物品');
      return;
    }
    const fixed = task.action.objectId === 'wardrobe' ? WARDROBE_STAND : task.action.objectId === 'sofa' ? SOFA_ENTRY : undefined;
    const boxes = obstacles(room, pose);
    const from = deckFromAuthoredX(start[0]), to = deckFromAuthoredX((fixed ?? task.point)[0]);
    const crossing = !room.observatory && from !== to;
    const landing = crossing ? stairLanding(to) : start;
    const local = approachRoute(landing, task.point, boxes, walkBounds(room, landing[0]), fixed,
      task.action.objectId === 'pet' ? PET_REACH : undefined);
    const first = crossing ? route(start, stairLanding(from), boxes, undefined, DECK_WALK_BOUNDS[from]) : [];
    if (local && (!crossing || first.length)) {
      state.current.path = crossing ? [...first, landing, ...local] : local;
    } else { cancelApproach(); p.onHover(task.action.objectId, '前方空间不足，请先移开挡路的物品'); }
  };
  useEffect(() => {
    const request: NonNullable<WorldModelProps['onApproach']> = (point, action, perform) => {
      const root = resident.current, p = current.current, s = state.current;
      if (!root || action.sceneId !== p.sceneId) return false;
      if (action.kind === 'stand') { cancelApproach(); perform(); return true; }
      const pose = CHAIR_POSES[p.sceneId];
      const target: Point = action.objectId === 'chair' ? [pose.x, pose.z] : action.objectId === 'pet' ? [...catLocation.current] : action.objectId === 'wardrobe' ? WARDROBE_STAND : [point[0], point[2]];
      if (s.posture === 'standing' && !s.exiting && !s.stairs
        && (room.observatory || deckFromAuthoredX(root.position.x) === deckFromAuthoredX(target[0]))
        && action.objectId !== 'chair' && action.objectId !== 'sofa'
        && Math.hypot(root.position.x - target[0], root.position.z - target[1]) <= (action.objectId === 'pet' ? PET_REACH : action.objectId === 'wardrobe' ? .75 : 1.15)) {
        cancelApproach(); perform(); return true;
      }
      if (!p.approachEnabled) { p.onHover(action.objectId, '先返回房间，再走近这个物品'); return false; }
      cancelApproach();
      stand();
      keys.current.clear();
      approach.current = { point: target, action, perform, elapsed: 0 };
      s.external = true;
      p.onHover(action.objectId, action.objectId === 'chair' ? '走到椅子正面入座…' : '走近后进行交互…');
      if (!s.exiting) planApproach();
      return false;
    };
    props.interaction.current = request;
    return () => { approach.current = null; if (props.interaction.current === request) props.interaction.current = null; };
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space') return;
      idleInput.current = true;
      const p = current.current;
      if (event.code === 'Escape' && (approach.current || ((state.current.posture === 'chair' || state.current.posture === 'sofa' || p.objects.sofa?.active) && !p.focusedObject))) {
        // App's Escape handler must not restore its stale object snapshot after stand().
        event.preventDefault(); event.stopPropagation();
        if (approach.current) cancelApproach(); else stand();
        return;
      }
      const target = event.target as HTMLElement | null;
      if (!p.enabled || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]'))) return;
      if (!['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ...INTERACT_KEYS].includes(event.code)) return;
      event.preventDefault();
      event.stopPropagation();
      void roomAudio.unlock();
      if (event.repeat) return;
      if (approach.current) cancelApproach();
      const interactIndex = INTERACT_KEYS.indexOf(event.code);
      if (interactIndex >= 0) {
        if (state.current.posture !== 'standing' || p.objects.chair?.active || p.objects.sofa?.active) {
          if (event.code === 'KeyE') stand();
        } else {
          const target = nearbyActions()[interactIndex];
          if (target) { cancelApproach(); act(target.id, target.kind); }
        }
      } else {
        stand();
        if (state.current.external) { state.current.external = false; p.onArrive(); }
        keys.current.add(event.code);
      }
    };
    const up = (event: KeyboardEvent) => { keys.current.delete(event.code); };
    const clear = () => {
      idleInput.current = true;
      keys.current.clear();
    };
    const hide = () => { if (document.hidden) clear(); };
    const activity = () => { idleInput.current = true; };
    const dragging = (event: PointerEvent) => { if (event.buttons) activity(); };
    window.addEventListener('pointerdown', activity);
    window.addEventListener('pointermove', dragging);
    window.addEventListener('wheel', activity, { passive: true });
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', clear);
    document.addEventListener('visibilitychange', hide);
    return () => {
      clear();
      window.removeEventListener('pointerdown', activity);
      window.removeEventListener('pointermove', dragging);
      window.removeEventListener('wheel', activity);
      window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', clear);
      document.removeEventListener('visibilitychange', hide);
      if (state.current.nearby) current.current.onHover(null);
    };
  }, []);

  useEffect(() => {
    if (!props.enabled) keys.current.clear();
  }, [props.enabled]);
  useEffect(() => {
    if (!props.walkTarget || !props.enabled) return;
    idleInput.current = true;
    approach.current = null;
    stand();
    const s = state.current;
    s.external = true;
    if (!s.exiting && resident.current) {
      const pose = CHAIR_POSES[props.sceneId];
      const point: Point = [props.walkTarget[0], props.walkTarget[2]];
      const target = reachable(point, obstacles(room, pose), walkBounds(room, point[0]));
      s.path = chairRoute(room, pose, nextWalkStart(resident.current), target);
    }
  }, [props.walkTarget]);

  useFrame((_, rawDelta) => {
    const root = resident.current;
    if (!root) return;
    const dt = Math.min(Math.max(rawDelta, 0), 0.04);
    const p = current.current;
    const s = state.current;
    const library = p.library, flow = library?.flow.current;
    const readerYaw = Math.PI + shelfYaw(p.sceneId);
    const libraryActive = !!flow && flow.phase !== 'idle';
    const libraryWalking = !!flow && ['approach', 'align', 'recenter'].includes(flow.phase);
    const motion = libraryActive ? (rig.current?.fitted?.library ?? library?.motion.current) : undefined;
    if (motion && rig.current && (libraryPlayer.current?.motion !== motion || libraryPlayer.current.rig !== rig.current)) {
      try {
        libraryPlayer.current = { motion, rig: rig.current, apply: createLibraryPlayer(rig.current.mesh, motion) };
      } catch (error) {
        library!.motion.current = null;
        libraryPlayer.current = undefined;
        console.warn('Luna book animation does not match the resident rig; using the existing pose.', error);
      }
    }
    const authored = !!library?.motion.current && !!libraryPlayer.current;
    const authoredTarget = library?.motion.current !== null;
    const librarySample = authored && flow ? libraryMotionSample(flow) : null;
    const heldBalance = authored && flow ? libraryHeldBalance(libraryCoverFlow(flow, librarySample)) : { back: 0, drop: 0 };
    const libraryTarget = flow ? residentLibraryTarget(p.sceneId, flow, authoredTarget) : null;
    if (libraryWalking && libraryTarget) {
      const key = `${flow!.phase}/${libraryTarget[0]}/${libraryTarget[2]}`;
      if (libraryNav.current !== key) {
        libraryNav.current = key; keys.current.clear(); stand();
        const end: Point = [libraryTarget[0], libraryTarget[2]], boxes = obstacles(room, CHAIR_POSES[p.sceneId]);
        if (!free(end, boxes, walkBounds(room, end[0]))) { library!.arrived(false); return; }
        if (!s.exiting) {
          s.path = residentRoute(room, nextWalkStart(root), end, boxes);
          if (!s.path.length && Math.hypot(root.position.x - end[0], root.position.z - end[1]) > .05) { library!.arrived(false); return; }
        }
      }
    } else { if (!libraryActive && libraryNav.current) s.path = []; libraryNav.current = ''; }
    if (!p.objects.chair?.active) s.dismissedChair = false;
    if (!p.objects.sofa?.active) s.dismissedSofa = false;
    const wanted: Posture = p.sceneId === 'habitat' && p.objects.sofa?.active && !s.dismissedSofa ? 'sofa' : p.objects.chair?.active && !s.dismissedChair ? 'chair' : 'standing';
    const pose = CHAIR_POSES[p.sceneId];
    const pending = approach.current;
    if (pending) {
      pending.elapsed += dt;
      if (pending.elapsed > 8 || p.focusedObject) cancelApproach();
    }
    const seatEntry = chairEntry(room, pose);
    const destination = (posture: Posture): Point => posture === 'sofa' ? SOFA_ENTRY : seatEntry;
    const entry = destination(s.posture === 'standing' ? wanted : s.posture);
    if (wanted !== s.wanted) {
      s.wanted = wanted;
      s.path = [];
      if (s.external) { s.external = false; p.onArrive(); }
      if (s.posture !== 'standing') beginExit();
      else if (wanted !== 'standing') s.path = residentRoute(room, nextWalkStart(root), entry, obstacles(room, pose));
    }
    const surfaceAt = (x: number, z: number): 'wood' | 'rug' =>
      p.sceneId === 'observatory' && x >= -2.95 && x <= -0.05 && z >= -0.3 && z <= 1.9 ? 'rug' : 'wood';
    const frameX = root.position.x, frameZ = root.position.z;
    let walking = false;
    let stairSample: ReturnType<typeof sampleCabinStairs> | null = null;
    let stairStep: Point | null = null;
    const sofa = sofaMotion.current;
    const sofaClip = rig.current?.fitted?.sofa ?? sofa.clip;
    if (sofa.rig !== rig.current || (sofaClip && !sofa.apply && rig.current)) {
      sofa.apply = rig.current && sofaClip ? sofaPlayer(rig.current.mesh, sofaClip) : null;
      sofa.rig = rig.current;
    }
    if (p.sceneId === 'habitat' && s.posture === 'chair') {
      const cm = chairMotion.current;
      const result = stepChairMotion(cm, dt, s.exiting, p.reducedMotion);
      s.blend = cm.time / CHAIR_SIT_SECONDS;
      s.sit = result.weight;
      const start = chairFront(pose, result.offset), u = ease(cm.align);
      root.position.set(THREE.MathUtils.lerp(seatEntry[0], start[0], u), 0, THREE.MathUtils.lerp(seatEntry[1], start[1], u));
      root.rotation.y = pose.yaw;
      if (result.done) {
        s.posture = 'standing'; s.exiting = false; s.blend = 0; s.sit = 0;
        chairMotion.current = createChairMotion();
        if (libraryWalking && libraryTarget) s.path = residentRoute(room, entry, [libraryTarget[0],libraryTarget[2]], obstacles(room,pose));
        else if (approach.current) planApproach();
        else if (s.external && p.walkTarget) s.path = residentRoute(room, entry,[p.walkTarget[0],p.walkTarget[2]],obstacles(room,pose));
        else if (wanted !== 'standing') s.path = residentRoute(room, entry, destination(wanted), obstacles(room, pose));
      }
    } else if (s.posture === 'sofa' && sofaClip) {
      const previous = sofa.time;
      const speed = sofa.time < SOFA_STEPS ? 1 : p.reducedMotion ? 4 : 1;
      sofa.time = clamp(previous + dt * speed * (s.exiting ? -1 : 1), 0, SOFA_STEPS + sofaClip.duration);
      const retreat = Math.min(sofa.time, SOFA_STEPS) * WALK_SPEED;
      root.position.set(SOFA_ENTRY[0] - Math.sin(FLOOR_SOFA.yaw) * retreat, 0,
        SOFA_ENTRY[1] - Math.cos(FLOOR_SOFA.yaw) * retreat);
      root.rotation.y = FLOOR_SOFA.yaw;
      walking = Math.min(previous, SOFA_STEPS) !== Math.min(sofa.time, SOFA_STEPS);
      if (s.exiting && sofa.time === 0) {
        s.posture = 'standing'; s.exiting = false;
        if (libraryWalking && libraryTarget) s.path = residentRoute(room, entry, [libraryTarget[0], libraryTarget[2]], obstacles(room, pose));
        else if (approach.current) planApproach();
        else if (s.external && p.walkTarget) s.path = residentRoute(room, entry, [p.walkTarget[0], p.walkTarget[2]], obstacles(room, pose));
        else if (wanted !== 'standing') s.path = residentRoute(room, entry, destination(wanted), obstacles(room, pose));
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
      s.sit = transition.sit * (1 - lower);
      root.rotation.y = angle(transition.yaw, pose.yaw, move);
      if (t === 1) {
        root.position.set(entry[0], 0, entry[1]);
        s.posture = 'standing'; s.exiting = false; s.blend = 0; s.sit = 0;
        roomAudio.playFootstep({ surface: surfaceAt(entry[0], entry[1]), intensity: 0.78 });
        if (libraryWalking && libraryTarget) s.path = residentRoute(room, entry, [libraryTarget[0], libraryTarget[2]], obstacles(room, pose));
        else if (approach.current) planApproach();
        else if (s.external && p.walkTarget) s.path = residentRoute(room, entry, [p.walkTarget[0], p.walkTarget[2]], obstacles(room, pose));
        else if (wanted !== 'standing') s.path = residentRoute(room, entry, destination(wanted), obstacles(room, pose));
      }
    } else if (s.posture !== 'standing') {
      s.blend = Math.min(1, s.blend + dt / (p.reducedMotion ? 0.4 : 0.9));
      const t = ease(s.blend);
      const yaw = pose.yaw;
      const forward = 0.1;
      const seat: Point = [pose.x + Math.sin(yaw) * forward, pose.z + Math.cos(yaw) * forward];
      root.position.x = THREE.MathUtils.lerp(entry[0], seat[0], t);
      root.position.z = THREE.MathUtils.lerp(entry[1], seat[1], t);
      root.rotation.y = angle(root.rotation.y, yaw, 1 - Math.exp(-dt * 12));
      root.position.y = t * (room.seat + 0.095 - HIP);
      s.sit = t;
    } else {
      const deck = deckFromAuthoredX(root.position.x);
      const waypoint = s.path[0];
      if (!room.observatory && !s.stairs && waypoint && deck !== deckFromAuthoredX(waypoint[0])) {
        // Paths visit the near landing first; the other landing is reached by the stairs.
        s.stairs = { from: deck, distance: deck === 'lower' ? 0 : STAIR_DISTANCE };
        s.path.shift();
      }
      if (s.stairs) {
        const stairs = s.stairs;
        const ascending = stairs.from === 'lower';
        const before = sampleCabinStairs(stairs.distance).position;
        stairs.distance = clamp(stairs.distance + dt * STAIR_SPEED * (ascending ? 1 : -1), 0, STAIR_DISTANCE);
        stairSample = sampleCabinStairs(stairs.distance);
        const [x, , z] = stairSample.position;
        stairStep = [x - before[0], z - before[2]];
        walking = Math.hypot(...stairStep) > .00001;
        if (walking) root.rotation.y = angle(root.rotation.y, Math.atan2(...stairStep), 1 - Math.exp(-dt * 14));
        if (stairs.distance === (ascending ? STAIR_DISTANCE : 0)) {
          const end = stairLanding(otherDeck(stairs.from));
          root.position.set(end[0], 0, end[1]);
          s.stairs = null;
        }
      } else {
        let [dx, dz] = p.enabled ? steer() : [0, 0];
        if (!dx && !dz && (p.enabled || wanted !== 'standing' || libraryWalking) && s.path.length) {
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
          const x = root.position.x + dx * dt * WALK_SPEED, z = root.position.z + dz * dt * WALK_SPEED;
          const bounds = walkBounds(room, beforeX);
          if (p.enabled && !room.observatory && !s.path.length && dx < 0 && atStairEntrance(deck, [beforeX, z], x)) {
            const [targetX, , targetZ] = stairDestination(deck);
            s.path = chairRoute(room, pose, [beforeX, beforeZ], [targetX, targetZ]);
            keys.current.clear();
          } else if (s.path.length) {
            const usesChairCircle = approach.current?.action.objectId === 'chair' || (s.external && !approach.current);
            const clear = usesChairCircle
              ? clearSegment([beforeX, beforeZ], [x, z], room.boxes, { x: pose.x, z: pose.z, radius: CHAIR_CONTACT }, bounds)
              : clearSegment([beforeX, beforeZ], [x, z], obstacles(room, pose), undefined, bounds);
            if (clear) { root.position.x = x; root.position.z = z; }
            else if (approach.current) planApproach();
          } else {
            const circle = { x: pose.x, z: pose.z, radius: CHAIR_CONTACT };
            if (clearSegment([beforeX, beforeZ], [x, beforeZ], room.boxes, circle, bounds)) root.position.x = x;
            if (clearSegment([root.position.x, beforeZ], [root.position.x, z], room.boxes, circle, bounds)) root.position.z = z;
          }
          walking = Math.hypot(root.position.x - beforeX, root.position.z - beforeZ) > 0.001;
          root.rotation.y = angle(root.rotation.y, Math.atan2(dx, dz), 1 - Math.exp(-dt * 14));
        }
      }
      if (!s.stairs && !s.path.length && s.external && p.enabled && !s.exiting) {
        const request = approach.current;
        const fixed = request?.action.objectId === 'chair' || request?.action.objectId === 'sofa';
        const target = request?.action.objectId === 'sofa' ? SOFA_ENTRY : request?.action.objectId === 'chair' ? seatEntry : request?.point;
        const distance = target ? Math.hypot(root.position.x - target[0], root.position.z - target[1]) : 0;
        const radius = fixed ? 0.06 : request?.action.objectId === 'pet' ? PET_REACH : 1.15;
        cancelApproach();
        if (request && distance <= radius) request.perform();
      }
      if (!s.stairs && !s.path.length && wanted !== 'standing') {
        if (Math.hypot(root.position.x - entry[0], root.position.z - entry[1]) < 0.06) {
          const yaw = wanted === 'sofa' ? FLOOR_SOFA.yaw : pose.yaw;
          root.rotation.y = angle(root.rotation.y, yaw, 1 - Math.exp(-dt * 12));
          const facingTarget = Math.abs(Math.atan2(Math.sin(yaw - root.rotation.y), Math.cos(yaw - root.rotation.y))) < 0.06;
          if (facingTarget && rig.current && (wanted !== 'sofa' || sofa.apply)) {
            s.posture = wanted; s.blend = 0;
            if (wanted === 'sofa') sofa.time = 0;
            if (wanted === 'chair') chairMotion.current = createChairMotion();
          }
        }
        else s.path = residentRoute(room, [root.position.x, root.position.z], entry, obstacles(room, pose));
      }
      root.position.y = 0;
      s.sit = 0;
      if (libraryWalking && libraryTarget && !s.stairs && !s.path.length && Math.hypot(root.position.x - libraryTarget[0], root.position.z - libraryTarget[2]) < .055) {
        root.rotation.y = angle(root.rotation.y, readerYaw, 1 - Math.exp(-dt * 10));
        const aligning = flow!.phase === 'align';
        const ready = !aligning || authored || library!.motion.current === null;
        if (ready && Math.abs(Math.atan2(Math.sin(root.rotation.y - readerYaw), Math.cos(root.rotation.y - readerYaw))) < (aligning && authored ? .006 : .025)) {
          if (aligning && authored) root.rotation.y = readerYaw;
          library!.arrived();
        }
      }
      if (libraryActive && !libraryWalking && flow) {
        root.rotation.y = angle(root.rotation.y, readerYaw, 1 - Math.exp(-dt * 10));
        if (authored && flow.book && (librarySample || flow.phase === 'reading' || flow.phase === 'turn')) {
          const held = !librarySample || librarySample.coverProgress !== undefined;
          root.position.fromArray(authoredBookStand(p.sceneId, flow.book, held, held ? heldBalance.back : 0));
          if (held) root.position.y -= heldBalance.drop;
          root.rotation.y = readerYaw;
        } else {
          carryResident(root, p.sceneId, flow); root.position.y -= libraryCrouch(flow);
          if ((['carry', 'return-carry'].includes(flow.phase) && flow.progress > .08 && flow.progress < .92)
            || Math.hypot(root.position.x - frameX, root.position.z - frameZ) > .0004) walking = true;
        }
      }
    }
    if (p.sceneId === 'habitat') {
      if (plushBodies.current.length !== PLUSH_DOLLS.length || !plushBodies.current.every(isValidPlushBody)) {
        plushBodies.current = createPlushBodies(PLUSH_DOLLS);
      }
      const deck = deckFromAuthoredX(root.position.x);
      const floorDolls = {
        lower: plushBodies.current.filter(body => deckFromAuthoredX(body.x) === 'lower'),
        upper: plushBodies.current.filter(body => deckFromAuthoredX(body.x) === 'upper'),
      };
      const mover = {
        x: root.position.x, z: root.position.z,
        vx: dt > 0 && !stairSample ? (root.position.x - frameX) / dt : 0,
        vz: dt > 0 && !stairSample ? (root.position.z - frameZ) / dt : 0,
        radius: RADIUS, active: !stairSample && (s.posture === 'standing' || s.exiting),
      };
      stepPlushDolls(floorDolls.lower, dt, deck === 'lower' ? [mover] : [], room.plushBoxes,
        { ...PLUSH_FLOOR_BOUNDS, left: CABIN_DIVIDER_X + .05 }, p.reducedMotion);
      stepPlushDolls(floorDolls.upper, dt, deck === 'upper' ? [mover] : [], room.plushBoxes,
        { ...PLUSH_FLOOR_BOUNDS, right: CABIN_DIVIDER_X - .05 }, p.reducedMotion);
      if (s.posture === 'standing' && !s.exiting && !libraryActive && !stairSample) {
        resolveMoverAgainstPlush(root.position, RADIUS, floorDolls[deck], (x, z) => free([x, z], room.boxes, DECK_WALK_BOUNDS[deck]));
      }
      slipperRoom.current.boxes = [...room.boxes, ...plushObstacleBoxes(floorDolls.upper)];
    } else {
      slipperRoom.current.boxes = room.boxes;
    }
    const deck = room.observatory ? 'lower' : deckFromAuthoredX(root.position.x);
    if (deckFrame.current) {
      deckFrame.current.visible = p.upperVisible !== false || deck === 'lower' || !!stairSample;
      if (stairSample) {
        const [x, y, z] = stairSample.position;
        deckFrame.current.position.set(x - root.position.x, y, z - root.position.z);
      } else if (deck === 'upper') deckFrame.current.position.fromArray(UPPER_DECK_OFFSET);
      else deckFrame.current.position.set(0, 0, 0);
    }
    if (p.deckView) {
      p.deckView.current.deck = deck;
      p.deckView.current.stairAscent = s.stairs ? stairSample?.ascent ?? null : null;
    }
    const [frameDx, frameDz] = stairStep ?? [root.position.x - frameX, root.position.z - frameZ];
    const distance = Math.hypot(frameDx, frameDz);
    if (pending && distance > .0004) pending.elapsed = 0;
    const stepping = walking && distance > .00001;
    if (stepping) {
      const next = s.walkTime + distance / WALK_SPEED * (s.posture === 'sofa' && !s.exiting ? -1 : 1);
      const halfStep = Math.floor(next * 2);
      if (halfStep !== Math.floor(s.walkTime * 2))
        roomAudio.playFootstep({ foot: (halfStep & 1) as 0 | 1, surface: surfaceAt(root.position.x, root.position.z) });
      s.walkTime = (next + 1) % 1;
    }
    const sofaSteps = s.posture === 'sofa' && sofa.time < SOFA_STEPS;
    const interactionPose = s.posture !== 'standing' || s.exiting || (libraryActive && !libraryWalking);
    walkWeight.current = (interactionPose && !sofaSteps) || p.reducedMotion ? 0
      : clamp(walkWeight.current + (stepping ? 1 : -1) * dt / .14, 0, 1);
    if (sofaSteps) walkWeight.current = Math.min(walkWeight.current, (SOFA_STEPS - sofa.time) / .16);
    const stride = stepping && libraryActive && !libraryWalking && !p.reducedMotion
      ? Math.sin(s.walkTime * Math.PI * 2) * .2 : 0;
    if (rig.current) {
      const sit = p.sceneId === 'habitat' && s.posture === 'chair' ? 0 : s.sit;
      rig.current.skirtFront.rotation.x = -sit * Math.PI / 2;
      rig.current.skirtFront.position.y = HIP + s.sit * 0.05;
      rig.current.skirtFront.position.z = 0.19 + s.sit * 0.13;
      rig.current.skirtBack.rotation.x = -sit * 0.4;
      rig.current.legs.forEach((leg, side) => {
        let thigh = -sit * Math.PI / 2, knee = sit * Math.PI / 2;
        if (libraryActive && root.position.y < -.0005) {
          const footZ = leg.thigh.position.z + leg.shin.position.z + leg.foot.position.z;
          const [crouchThigh, crouchKnee] = legReach(leg, footZ - leg.hipForward + heldBalance.back, leg.thigh.position.y - leg.ankleHeight + root.position.y);
          thigh = crouchThigh + leg.straighten[0];
          knee = crouchKnee + leg.straighten[1];
        }
        const swing = side ? -stride : stride;
        leg.thigh.rotation.x = thigh + swing + leg.straighten[0] * sit;
        leg.shin.rotation.x = knee + Math.max(0, -swing) * 0.5 + leg.straighten[1] * sit;
        leg.foot.rotation.x = -(leg.thigh.rotation.x + leg.shin.rotation.x);
      });
    }
    if (rig.current && flow) {
      if (librarySample && librarySample.coverProgress === undefined) resetArms(rig.current, 1);
      else applyLibraryPose(rig.current, root, p.sceneId, libraryCoverFlow(flow, librarySample), dt, authored);
    }
    const standingAtRest = !!rig.current && p.enabled && !p.focusedObject
      && !document.hidden && s.posture === 'standing' && wanted === 'standing' && !s.exiting
      && !walking && distance < .00001 && walkWeight.current === 0
      && !keys.current.size && !idleInput.current && !s.path.length && !s.stairs && !s.external
      && !approach.current && !libraryActive;
    const im = idleMotion.current;
    const fittedIdle = rig.current?.fitted?.idle;
    const yawnClip = fittedIdle?.yawn ?? im.clip;
    const lookClip = fittedIdle?.look ?? im.lookClip;
    stepIdle(idle.current, rawDelta, standingAtRest && !p.reducedMotion, yawnClip?.duration ?? 0,
      Math.random, lookClip?.duration ?? 0, standingAtRest);
    idleInput.current = false;
    if (idle.current.elapsed >= STANDING_IDLE.delay && !lookClip && !im.lookLoading && idle.current.elapsed >= im.lookRetryAt) {
      im.lookLoading = true;
      void loadLookingAround().then(clip => { if (mounted.current) { im.lookClip = clip; im.rig = null; } })
        .catch(() => { im.lookRetryAt = idle.current.elapsed + 30; })
        .finally(() => { im.lookLoading = false; });
    }
    if (idle.current.elapsed >= STANDING_IDLE.delay && !yawnClip && !im.loading && idle.current.elapsed >= im.retryAt) {
      im.loading = true;
      void loadYawn().then(clip => { if (mounted.current) { im.clip = clip; im.rig = null; } })
        .catch(() => { im.retryAt = idle.current.elapsed + 30; })
        .finally(() => { im.loading = false; });
    }
    if (rig.current && im.rig !== rig.current) {
      im.rig = rig.current;
      im.player = createIdlePlayer(rig.current.mesh, yawnClip ?? undefined, lookClip ?? undefined);
    }
    if (rig.current) {
      const playingChair = p.sceneId === 'habitat' && s.posture === 'chair';
      rig.current.applyPose(s.walkTime, ease(walkWeight.current));
      if (!playingChair && flow?.book && librarySample) libraryPlayer.current!.apply(flow.book, librarySample);
      if (!interactionPose && !libraryActive) im.player?.(idle.current, !p.reducedMotion);
      rig.current.applyChairPose?.(
        playingChair ? chairMotion.current.time : 0,
        playingChair ? ease(chairMotion.current.align) : 0,
      );
      if (s.posture === 'sofa' && !sofaSteps) sofa.apply?.(sofa.time - SOFA_STEPS);
      // Add the offsets after authored animation, only when there is no contact pose to preserve.
      rig.current.followMotion(rawDelta,
        !interactionPose && !libraryActive && !p.focusedObject && !p.reducedMotion && !document.hidden,
        root.rotation.y, frameDx, frameDz, s.walkTime);
      rig.current.applyArmCorrectives(!interactionPose && !libraryActive);
    }
    if (library && rig.current) library.tick(dt);
    rig.current?.updateSleeveContact?.();
    root.userData.onStairs = !!stairSample;
    root.userData.posture = s.exiting ? 'standing-up' : s.posture;
    root.userData.standingIdle = { elapsed: idle.current.elapsed, weight: idle.current.weight, yawnTime: idle.current.yawnTime,
      nextYawn: idle.current.nextYawn, lookTime: idle.current.lookTime, nextLook: idle.current.nextLook,
      shortTime: idle.current.shortTime, shortKind: idle.current.shortKind };
    root.userData.chairPhase = s.posture === 'chair' ? chairMotion.current.phase : 'idle';
    p.sofaTime.current = s.posture === 'sofa' ? sofa.time - SOFA_STEPS : null;
    root.userData.sofaTime = p.sofaTime.current;
    root.userData.plushBodies = plushBodies.current;
    const nearbyList = p.showNearbyHints === false ? [] : nearbyActions();
    const nearby = nearbyList[0] ?? null;
    const hint = p.enabled && p.showNearbyHints !== false && (s.posture !== 'standing' || wanted !== 'standing')
      ? 'E · 起身'
      : nearbyList.map((target, index) => `${INTERACT_LABELS[index]} · ${target.hint}`).join('　');
    if (nearby?.id !== s.nearby?.id || hint !== s.nearbyHint) {
      s.nearby = nearby;
      s.nearbyHint = hint;
      p.onHover(nearby?.id ?? (hint ? s.posture : null), hint || undefined);
    }
  }, -1);

  const canCatWalk = (x: number, z: number) => {
    const luna = resident.current?.position;
    return !props.catMenuOpen && approach.current?.action.objectId !== 'pet'
      && free([x, z], room.boxes, DECK_WALK_BOUNDS.lower)
      && (!luna || state.current.stairs || deckFromAuthoredX(luna.x) === 'upper'
        || Math.hypot(x - luna.x, z - luna.z) > RADIUS + .28)
      && plushBodies.current.every(plush => Math.hypot(x - plush.x, z - plush.z) > plush.radius + .28);
  };
  return <group name={`OrbitalResidents_${props.sceneId}`}>
    <group ref={deckFrame} name="Resident_DeckPlacement">
      <group ref={resident} name="OrbitalResident" position={spawn} rotation-y={-.78}>
        <ResidentModel rig={rig} outfit={props.outfit} onFailure={props.library?.fail} />
      </group>
    </group>
    {props.sceneId === 'habitat' && <Suspense fallback={null}><SlipperPair resident={resident} room={slipperRoom.current} reducedMotion={props.reducedMotion} /></Suspense>}
    {props.sceneId === 'habitat' && <PlushDolls bodies={plushBodies} />}
    <ObjectHandle id="pet" action="pet" hint="和团子互动" world={props} panorama position={[CAT_HOME[0], CAT_MAT_Y, CAT_HOME[1]]}
      onClick={event => event.stopPropagation()}>
      <Cat resident={resident} value={props.objects.pet?.value ?? 0} command={props.objects.pet?.itemId} reducedMotion={props.reducedMotion}
        location={catLocation} canWalk={props.sceneId === 'habitat' ? canCatWalk : undefined} />
    </ObjectHandle>
  </group>;
}
