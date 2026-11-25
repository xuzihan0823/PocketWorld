import { createPlushPose, dropSpot, gripPlush, plushBounds, plushLabels, type PlushGrip, type PlushShape } from './plushCarry';
import { createPaperPose } from './schedule/paperGrip';
import { RUG_SEAT, RUG_TOP, RUG_YAW, PICKUP_GRIP_TIME, PAPER_PICKUP_REACH, PAPER_PICKUP_PREFIX, advanceCabinPerformance, applyCabinPerformance, createCabinActionPlayer, isPaperPickup, isRugSeat, leaveCabinPerformance, loadCabinActions, newRugPerformance, type CabinPerformance, type PaperPickup } from './cabinActions';
import { SOFA_ENTRY, SOFA_STEPS, loadSofaClip, sofaPlayer } from './sofaMotion';
import { DECK_WALK_BOUNDS, UPPER_DECK_OFFSET, deckFromAuthoredX, BED_POSITION, CAT_HOME, CAT_MAT_Y, COMPUTER_STAND, FLOOR_SOFA, PLUSH_DOLLS, TRASH_CAN, HABITAT_SPAWN, WARDROBE_FOOTPRINT, WARDROBE_STAND, NIGHTSTAND_X, NIGHTSTAND_Z, RESIDENT_RADIUS, WALK_BOUNDS } from './cabinLayout';
import { CABIN_STAIRS, STAIR_DISTANCE, STAIR_TREAD_RUN, otherDeck, sampleCabinStairs, stairLanding, type CabinResidentView } from './cabinStairs';
import type { CabinDeck } from './cabinLayout';
import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldAction, WorldActionKind, WorldModelProps } from '../../types/world';
import { roomAudio } from '../audioEngine';
import { ObjectHandle } from './ObjectHandle';
import { INSPECTION_SECONDS, inspectOutfit } from './wardrobe/inspectPose';
import type { ResidentOutfit } from './wardrobe/outfit';
import { JOURNAL_POSITION } from './journalLayout';
import { SCHEDULE_BOOK_POSITION } from './schedule/bookLayout';
import { paperBallBoxes } from './schedule/schedule';
import { usePaperBallLitter } from './schedule/paperBallLitter';
import { Cat } from './Cat';
import { CHAIR_POSES, chairFront, type ChairPose } from './chairPose';
import { applyLibraryPose, carryResident, libraryCrouch } from './library/residentPose';
import { resetArms } from './library/armPose';
import { authoredBookStand, libraryHeldBalance, residentLibraryTarget } from './library/bookMotion';
import { createLibraryPlayer, libraryCoverFlow, libraryMotionSample, loadLibraryMotion, type LibraryMotion } from './library/libraryMotion';
import { readingStand, shelfOrigin, shelfPoint, shelfYaw, slotFor } from './library/catalog';
import { HIP_HEIGHT as HIP, ResidentModel, type ResidentLeg, type ResidentRig } from './ResidentModel';
import { WALK_SPEED } from './residentRig';
import { sampleStairGait, stairFootfall, stairTreadSurface, type StairGait } from './stairGait';
import { createIdlePlayer, createIdleState, loadYawn, loadLookingAround, stepIdle, STANDING_IDLE } from './standingIdle';
import { CHAIR_SIT_SECONDS, createChairMotion, stepChairMotion } from './chairMotion';
import { createSeatedIdle, seatedIdleWeight, stepSeatedIdle } from './seatedIdle';
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
  inspectionId?: number;
  onInspectionEnd: () => void;
  onOutfitMounted: (outfit: ResidentOutfit, ready: boolean) => void;
  walkTarget: [number, number, number] | null;
  onArrive: () => void;
  enabled: boolean;
  approachEnabled: boolean;
  catMenuOpen: boolean;
  deckView?: React.MutableRefObject<CabinResidentView>;
  upperVisible?: boolean;
  showNearbyHints?: boolean;
  prefetchSeat?: boolean;
  loadPlush?: boolean;
  loadCat?: boolean;
  sofaTime: React.MutableRefObject<number | null>;
  paperPickup: React.MutableRefObject<PaperPickup | null>;
  interaction: React.MutableRefObject<NonNullable<WorldModelProps['onApproach']> | null>;
};
type Approach = { point: Point; height: number; action: WorldAction; perform: () => void; elapsed: number };
const RADIUS = RESIDENT_RADIUS;
const STAIR_SPEED = STAIR_TREAD_RUN / .60;
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
function obstacles(room: Room, pose: ChairPose, extra: Box[] = []): Box[] {
  const r = CHAIR_CONTACT;
  return [...room.boxes, ...extra, [pose.x - r, pose.x + r, pose.z - r, pose.z + r]];
}
function chairEntry(room: Room, pose: ChairPose): Point {
  const yaw = pose.yaw;
  const distance = (room.chairRadius + RADIUS) / Math.max(Math.abs(Math.sin(yaw)), Math.abs(Math.cos(yaw))) + 0.08;
  return chairFront(pose, distance);
}
/** Floor stand point for a clicked prop, so Luna approaches from the usable side instead of walking into its table. */
function interactionAnchor(sceneId: string, objectId: string, point: Point): Point {
  if (objectId === 'schedule') return [SCHEDULE_BOOK_POSITION[0] + .02, -1.42];
  if (objectId === 'journal') return [JOURNAL_POSITION[0], -1.42];
  if (objectId.startsWith('music-')) return [-.30, -1.42];
  if (objectId === 'book-01') { const [x, , z] = readingStand(sceneId); return [x, z]; }
  if (objectId === 'cabinet' || objectId === 'cabinet-item') { const [x, , z] = shelfPoint(sceneId, .55, 0, .65); return [x, z]; }
  if (objectId === 'lamp') return sceneId === 'habitat' ? [NIGHTSTAND_X - .11, NIGHTSTAND_Z + .77] : [-1.42, -2.55];
  if (objectId === 'clock') return [NIGHTSTAND_X + .22, NIGHTSTAND_Z + .64];
  return point;
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
function approachRoute(start: Point, point: Point, boxes: Box[], bounds: typeof WALK_BOUNDS, fixed?: Point, reach = 1.15, minReach = reach === PAPER_PICKUP_REACH ? .29 : 0): Point[] | null {
  const distance = Math.hypot(start[0] - point[0], start[1] - point[1]);
  if (!fixed && distance <= reach && distance >= minReach) return [];
  const targets: Point[] = fixed ? [fixed] : [];
  if (!fixed) for (const radius of [Math.max(.36, minReach + .02), .58, .85].filter(radius => radius < reach && radius >= minReach)) for (let i = 0; i < 24; i++) {
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

// Routes never cross a deck on their own; the stairs only run on an explicit E press.
function residentRoute(room: Room, start: Point, end: Point, boxes: Box[], circle?: Circle): Point[] {
  const from = deckFromAuthoredX(start[0]), to = deckFromAuthoredX(end[0]);
  return room.observatory || from === to ? route(start, end, boxes, circle, walkBounds(room, start[0])) : [];
}

function chairRoute(room: Room, pose: ChairPose, start: Point, target: Point, extra: Box[] = []) {
  return residentRoute(room, start, target, [...room.boxes, ...extra], { x: pose.x, z: pose.z, radius: CHAIR_CONTACT });
}

/** Keep authored prop coordinates for seating, collision and interaction. The parent places Luna in the stack. */
export function OrbitalResidents(props: ResidentsProps) {
  const current = useRef(props);
  current.current = props;
  const { camera } = useThree();
  const cabinPerformance = useRef<CabinPerformance | null>(null);
  const cabinMotion = useRef<{ clips?: Awaited<ReturnType<typeof loadCabinActions>>; apply?: ReturnType<typeof createCabinActionPlayer>; rig?: ResidentRig; failed?: boolean }>({});
  useEffect(() => {
    if (props.sceneId !== 'habitat') return;
    cabinMotion.current = {};
    const motion = cabinMotion.current;
    let live = true;
    void loadCabinActions(props.outfit).then(clips => { if (live) motion.clips = clips; })
      .catch(error => { if (live) motion.failed = true; console.warn('Luna cabin actions:', error); });
    return () => { live = false; props.paperPickup.current = null; };
  }, [props.outfit, props.sceneId, props.paperPickup]);
  const room = useMemo(() => layout(props.sceneId === 'observatory'), [props.sceneId]);
  const spawn = useMemo(() => { const start = props.sceneId === 'habitat' ? HABITAT_SPAWN : [0.25, 0.5] as Point; const point = reachable(start, obstacles(room, CHAIR_POSES[props.sceneId]), walkBounds(room, start[0])); return [point[0], 0, point[1]] as [number, number, number]; }, [room]);
  const resident = useRef<THREE.Group>(null);
  const litter = usePaperBallLitter();
  const ballBoxes = useMemo(() => props.sceneId === 'habitat' ? paperBallBoxes(litter, RADIUS) : [], [litter, props.sceneId]);
  const ballBoxesRef = useRef(ballBoxes);
  ballBoxesRef.current = ballBoxes;
  // A ball that landed under Luna's feet is skipped so she can step off instead of getting stuck.
  const ballObstacles = () => {
    const root = resident.current;
    if (!root) return ballBoxesRef.current;
    const { x, z } = root.position;
    return ballBoxesRef.current.filter(([a, b, c, d]) => !(x > a && x < b && z > c && z < d));
  };
  const deckFrame = useRef<THREE.Group>(null);
  const rig = useRef<ResidentRig | null>(null);
  const plushBodies = useRef<PlushBody[]>(props.sceneId === 'habitat' ? createPlushBodies(PLUSH_DOLLS) : []);
  const plushShapes = useMemo(() => new Map<string, PlushShape>(), []);
  const plushGrip = useRef<PlushGrip | null>(null);
  const paperPose = useRef<{ mesh: THREE.Object3D; apply: ReturnType<typeof createPaperPose> }>();
  const plushPose = useRef<{ mesh: THREE.Object3D; apply: ReturnType<typeof createPlushPose> }>();
  const catalogThink = useRef({ time: 0, weight: 0 });
  const findDoll = (id: string) => plushBodies.current.find(body => body.id === id);
  const slipperRoom = useRef<{ boxes: Box[] }>({ boxes: room.boxes });
  useEffect(() => {
    plushBodies.current = props.sceneId === 'habitat' ? createPlushBodies(PLUSH_DOLLS) : [];
    plushGrip.current = null;
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
  const pendingComputer = useRef<{ action: WorldAction; perform: () => void; at: number } | null>(null);
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
    if (!props.objects.sofa?.active || props.sceneId !== 'habitat' || props.outfit !== 'everyday') return;
    let live = true;
    void loadSofaClip().then(clip => { if (live) sofaMotion.current.clip = clip; }).catch(() => {
      if (live) {
        current.current.onHover('sofa', '沙发动作加载失败，请重试');
        current.current.onAction({ sceneId: 'habitat', objectId: 'sofa', kind: 'stand' });
      }
    });
    return () => { live = false; };
  }, [props.objects.sofa?.active, props.sceneId, props.outfit]);
  const exit = useRef({ from: new THREE.Vector3(), yaw: 0, sit: 0, progress: 0 });
  const chairMotion = useRef(createChairMotion());
  const seatedIdle = useRef(createSeatedIdle());
  const inspection = useRef({ id: 0, elapsed: 0, finished: false });
  const movement = useMemo(() => ({ forward: new THREE.Vector3(), right: new THREE.Vector3(), step: new THREE.Vector3() }), []);

  const act = (objectId: string, kind: WorldActionKind) => {
    const p = current.current;
    const action: WorldAction = { sceneId: p.sceneId, objectId, kind };
    const doll = findDoll(objectId);
    if (doll) {
      p.interaction.current?.([doll.x, 0, doll.z], action, () => {});
    } else if (kind === 'sit' || objectId === 'wardrobe') {
      const pose = CHAIR_POSES[p.sceneId];
      const [x, z] = objectId === 'wardrobe' ? WARDROBE_STAND : objectId === 'sofa' ? SOFA_ENTRY : isRugSeat(objectId) ? RUG_SEAT : [pose.x, pose.z];
      p.interaction.current?.([x, 0, z], action, () => current.current.onAction(action));
    } else p.onAction(action);
  };
  const canUseComputer = () => {
    const p = current.current, s = state.current;
    return p.sceneId === 'habitat' && p.objects.chair?.active && !p.objects.sofa?.active
      && s.posture === 'chair' && !s.exiting && !s.dismissedChair && chairMotion.current.phase === 'seated';
  };
  const nearbyActions = (): NearbyAction[] => {
    const p = current.current, root = resident.current, s = state.current;
    if (!root || !p.enabled || s.exiting || s.stairs || p.focusedObject || cabinPerformance.current || plushGrip.current) return [];
    const pose = CHAIR_POSES[p.sceneId];
    const [cabinetX, , cabinetZ] = shelfPoint(p.sceneId, .55, 0, .65);
    const [bookX, , bookZ] = readingStand(p.sceneId);
    const deck = deckFromAuthoredX(root.position.x);
    const targets: NearbyAction[] = [
      { id: 'schedule', kind: 'plan', hint: '打开日程', point: [SCHEDULE_BOOK_POSITION[0] + 0.02, -1.42], reach: 0.42 },
      { id: 'journal', kind: 'write', hint: '打开日记', point: [JOURNAL_POSITION[0], -1.42], reach: 0.40 },
      { id: 'music-player', kind: 'inspect', hint: '使用唱机', point: [-0.30, -1.42], reach: 0.40 },
      { id: 'book-01', kind: 'inspect', hint: '查看藏书', point: [bookX, bookZ], reach: 0.70 },
      { id: 'cabinet', kind: 'open', hint: '打开柜门', point: [cabinetX, cabinetZ], reach: 0.55 },
      { id: 'lamp', kind: 'toggle', hint: '开关灯', point: p.sceneId === 'habitat' ? [NIGHTSTAND_X - .11, NIGHTSTAND_Z + .77] : [-1.42, -2.55], reach: 0.46 },
      { id: 'chair', kind: 'sit', hint: '坐下', point: [pose.x, pose.z], reach: CHAIR_REACH },
    ];
    if (p.loadCat !== false) targets.push({ id: 'pet', kind: 'pet', hint: '和团子互动', point: catLocation.current, reach: PET_REACH });
    if (p.sceneId === 'habitat') {
      for (const body of plushBodies.current) {
        if (!plushShapes.has(body.id)) continue;
        targets.push({ id: body.id, kind: 'inspect', hint: '捡起' + plushLabels[body.id], point: [body.x, body.z], reach: .78 });
      }
      targets.push({ id: 'wardrobe', kind: 'open', hint: '打开衣柜', point: WARDROBE_STAND, reach: .75 });
      targets.push({ id: 'sofa', kind: 'sit', hint: '坐进懒人沙发', point: SOFA_ENTRY, reach: .85 });
      targets.push({ id: 'rug-seat', kind: 'sit', hint: '坐在地毯上', point: RUG_SEAT, reach: .72 });
      targets.push({ id: 'clock', kind: 'inspect', hint: '设置闹钟', point: [NIGHTSTAND_X + .22, NIGHTSTAND_Z + .64], reach: 0.46 });
      targets.push({ id: 'stairs', kind: 'inspect', hint: deck === 'lower' ? '上楼' : '下楼', point: stairLanding(deck), reach: .62 });
    }
    const found = targets
      .filter(target => room.observatory || deckFromAuthoredX(target.point[0]) === deck)
      .map(target => ({ target, distance: Math.hypot(root.position.x - target.point[0], root.position.z - target.point[1]) }))
      .filter(({ target, distance }) => distance < target.reach)
      .sort((a, b) => a.distance - b.distance);
    // Climbing is E-only, so the stairs never ride along as a Q/R alternate.
    const listed = found[0]?.target.id === 'stairs' ? found.slice(0, 1) : found.filter(({ target }) => target.id !== 'stairs');
    return listed.slice(0, INTERACT_KEYS.length).map(({ target }) => target);
  };
  const beginExit = () => {
    const s = state.current;
    if (cabinPerformance.current) leaveCabinPerformance(cabinPerformance.current);
    if (s.exiting || s.posture === 'standing' || !resident.current) return;
    exit.current.from.copy(resident.current.position);
    exit.current.yaw = resident.current.rotation.y;
    exit.current.sit = s.sit; exit.current.progress = 0;
    s.exiting = true;
  };
  const stand = () => {
    const s = state.current;
    pendingComputer.current = null;
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
    pendingComputer.current = null;
    state.current.path = [];
    state.current.external = false;
    current.current.onArrive();
  };
  /** Stairs are a deliberate E action at the landing, never an automatic crossing. */
  const stairReady = (): CabinDeck | null => {
    const p = current.current, s = state.current, root = resident.current;
    if (!root || s.stairs || s.posture !== 'standing' || s.exiting || cabinPerformance.current || !p.enabled || p.focusedObject) return null;
    const deck = deckFromAuthoredX(root.position.x);
    const [x, z] = stairLanding(deck);
    return Math.hypot(root.position.x - x, root.position.z - z) <= .72 ? deck : null;
  };
  const beginStairs = (): boolean => {
    const s = state.current;
    const deck = stairReady();
    if (!deck) return false;
    cancelApproach();
    keys.current.clear();
    idleInput.current = true;
    s.walkTime = 0;
    s.stairs = { from: deck, distance: deck === 'lower' ? 0 : STAIR_DISTANCE };
    return true;
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
    const fixed = task.action.objectId === 'wardrobe' ? WARDROBE_STAND : task.action.objectId === 'sofa' ? SOFA_ENTRY : isRugSeat(task.action.objectId) ? RUG_SEAT : undefined;
    const target: Point = task.action.objectId === 'chair' ? [pose.x, pose.z] : fixed ?? task.point;
    const from = deckFromAuthoredX(start[0]), to = deckFromAuthoredX(target[0]);
    if (!room.observatory && from !== to) {
      cancelApproach();
      p.onHover(task.action.objectId, '先在楼梯口按 E 上楼');
      return;
    }
    if (task.action.objectId === 'chair') {
      const path = chairRoute(room, pose, start, chairEntry(room, pose), ballObstacles());
      if (path.length) {
        state.current.path = path;
        return;
      }
      cancelApproach();
      p.onHover('chair', '前方空间不足，请先移开挡路的物品');
      return;
    }
    const boxes = obstacles(room, pose, ballObstacles());
    const doll = findDoll(task.action.objectId);
    const local = approachRoute(start, task.point, boxes, walkBounds(room, start[0]), fixed,
      task.action.objectId === 'pet' ? PET_REACH : isPaperPickup(task.action.objectId) ? PAPER_PICKUP_REACH : doll ? .52 : undefined,
      doll ? RADIUS + doll.radius + .012 : undefined);
    if (local) state.current.path = local;
    else { cancelApproach(); p.onHover(task.action.objectId, '前方空间不足，请先移开挡路的物品'); }
  };
  const putDown = () => {
    const grip = plushGrip.current, root = resident.current, s = state.current;
    const clips = cabinMotion.current.clips;
    if (!grip || !root || !clips || !current.current.enabled || s.stairs || cabinPerformance.current) return;
    const spot = dropSpot(grip.body, root.position.x, root.position.z, root.rotation.y, room.plushBoxes, plushBodies.current);
    if (!spot) { current.current.onHover(grip.body.id, '这里放不下娃娃，走到空地再试'); return; }
    cancelApproach();
    keys.current.clear();
    grip.floorX = spot.x; grip.floorZ = spot.z;
    Object.assign(grip.body, { y: 0, pitch: 0, roll: 0, yaw: spot.yaw });
    cabinPerformance.current = { kind: 'plush', placing: true, leaving: false, time: clips.pickUp.duration };
  };
  useEffect(() => {
    const request: NonNullable<WorldModelProps['onApproach']> = (point, action, perform) => {
      const root = resident.current, p = current.current, s = state.current;
      if (!root || action.sceneId !== p.sceneId) return false;
      const rug = isRugSeat(action.objectId), paper = isPaperPickup(action.objectId);
      const doll = findDoll(action.objectId);
      if (plushGrip.current) {
        if (doll === plushGrip.current.body) putDown();
        else p.onHover(plushGrip.current.body.id, '先放下手里的娃娃');
        return true;
      }
      if ((rug || paper || doll) && (!p.approachEnabled || cabinMotion.current.failed)) return false;
      if (rug && cabinPerformance.current?.kind === 'floor') {
        stand();
        return true;
      }
      if (action.kind === 'stand') { cancelApproach(); perform(); return true; }
      const pose = CHAIR_POSES[p.sceneId];
      if (action.objectId === 'computer') {
        if (!p.approachEnabled) { p.onHover('computer', '先返回房间，再使用电脑'); return false; }
        if (canUseComputer()) { cancelApproach(); keys.current.clear(); perform(); return true; }
        if (p.sceneId !== 'habitat' || p.objects.chair?.active || s.posture === 'chair') {
          p.onHover('computer', '请先在电脑椅上坐稳，再使用电脑'); return false;
        }
        if (s.exiting || cabinPerformance.current) { p.onHover('computer', '请先结束当前动作，再使用电脑'); return false; }
        // Stand up if needed, then board the desk chair; clicking again cancels the queued session.
        pendingComputer.current = null;
        cancelApproach();
        stand();
        keys.current.clear();
        const chairAction: WorldAction = { ...action, objectId: 'chair', kind: 'sit' };
        approach.current = { point: [pose.x, pose.z], height: point[1], action: chairAction, elapsed: 0,
          perform: () => { pendingComputer.current = { action, perform, at: Date.now() }; current.current.onAction(chairAction); } };
        s.external = true;
        p.onHover('computer', '走到电脑椅前坐下…');
        if (!s.exiting && !cabinPerformance.current) planApproach();
        return false;
      }
      const target: Point = doll ? [doll.x, doll.z] : action.objectId === 'pet' ? [...catLocation.current]
        : action.objectId === 'wardrobe' ? WARDROBE_STAND : action.objectId === 'chair' ? [pose.x, pose.z]
        : interactionAnchor(p.sceneId, action.objectId, [point[0], point[2]]);
      if (s.posture === 'standing' && !s.exiting && !s.stairs && !cabinPerformance.current && !rug && !paper && !doll
        && (room.observatory || deckFromAuthoredX(root.position.x) === deckFromAuthoredX(target[0]))
        && action.objectId !== 'chair' && action.objectId !== 'sofa'
        && Math.hypot(root.position.x - target[0], root.position.z - target[1]) <= (action.objectId === 'pet' ? PET_REACH : action.objectId === 'wardrobe' ? .06 : 1.15)) {
        cancelApproach(); perform(); return true;
      }
      if (!p.approachEnabled) { p.onHover(action.objectId, '先返回房间，再走近这个物品'); return false; }
      cancelApproach();
      stand();
      keys.current.clear();
      approach.current = { point: target, height: point[1], action, perform, elapsed: 0 };
      s.external = true;
      p.onHover(action.objectId, action.objectId === 'chair' ? '走到椅子正面入座…' : '走近后进行交互…');
      if (!s.exiting && !cabinPerformance.current) planApproach();
      return false;
    };
    props.interaction.current = request;
    return () => { approach.current = null; pendingComputer.current = null; if (props.interaction.current === request) props.interaction.current = null; };
  }, []);

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.code === 'Space') return;
      idleInput.current = true;
      const p = current.current;
      if (event.code === 'Escape' && (approach.current || ((state.current.posture === 'chair' || state.current.posture === 'sofa' || p.objects.sofa?.active || cabinPerformance.current) && !p.focusedObject))) {
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
      pendingComputer.current = null;
      if (approach.current) cancelApproach();
      const interactIndex = INTERACT_KEYS.indexOf(event.code);
      if (interactIndex >= 0) {
        const performance = cabinPerformance.current;
        if (performance) {
          if (event.code === 'KeyE') stand();
          return;
        }
        if (plushGrip.current) {
          // At the landing E climbs with the doll in hand; away from it E puts the doll down.
          if (event.code === 'KeyE' && !beginStairs()) putDown();
          return;
        }
        if (state.current.posture !== 'standing' || p.objects.chair?.active || p.objects.sofa?.active) {
          if (event.code === 'KeyE') stand();
          else if (event.code === 'KeyQ' && canUseComputer()) {
            const action: WorldAction = { sceneId: p.sceneId, objectId: 'computer', kind: 'inspect' };
            p.interaction.current?.([COMPUTER_STAND[0], 0, COMPUTER_STAND[1]], action, () => current.current.onAction(action));
          }
        } else {
          const target = nearbyActions()[interactIndex];
          if (target?.id === 'stairs') { if (event.code === 'KeyE') beginStairs(); }
          else if (target) { cancelApproach(); act(target.id, target.kind); }
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
      pendingComputer.current = null;
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
    if (!s.exiting && !cabinPerformance.current && resident.current) {
      const pose = CHAIR_POSES[props.sceneId];
      const point: Point = [props.walkTarget[0], props.walkTarget[2]];
      const target = reachable(point, obstacles(room, pose, ballObstacles()), walkBounds(room, point[0]));
      s.path = chairRoute(room, pose, nextWalkStart(resident.current), target, ballObstacles());
    }
  }, [props.walkTarget]);

  useFrame((_, rawDelta) => {
    const root = resident.current;
    if (!root) return;
    const dt = Math.min(Math.max(rawDelta, 0), 0.04);
    const p = current.current;
    const s = state.current;
    const cabin = cabinMotion.current;
    if (cabin.clips && rig.current?.mesh.userData.outfit === p.outfit && rig.current && cabin.rig !== rig.current) {
      cabin.rig = rig.current;
      cabin.apply = createCabinActionPlayer(rig.current.mesh, cabin.clips);
      idleMotion.current.rig = null;
    }
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
        const end: Point = [libraryTarget[0], libraryTarget[2]], boxes = obstacles(room, CHAIR_POSES[p.sceneId], ballObstacles());
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
    if (pending && !cabinPerformance.current) {
      const doll = findDoll(pending.action.objectId);
      if (doll && Math.hypot(doll.x - pending.point[0], doll.z - pending.point[1]) > .065) {
        pending.point = [doll.x, doll.z]; planApproach();
      }
      pending.elapsed += dt;
      if (pending.elapsed > 8 || p.focusedObject) cancelApproach();
    }
    const queued = pendingComputer.current;
    if (queued) {
      if (p.focusedObject || Date.now() - queued.at > 15000) pendingComputer.current = null;
      else if (canUseComputer() && p.approachEnabled) { pendingComputer.current = null; queued.perform(); }
    }
    const seatEntry = chairEntry(room, pose);
    const destination = (posture: Posture): Point => posture === 'sofa' ? SOFA_ENTRY : seatEntry;
    const entry = destination(s.posture === 'standing' ? wanted : s.posture);
    if (wanted !== s.wanted) {
      s.wanted = wanted;
      s.path = [];
      if (s.external) { s.external = false; p.onArrive(); }
      if (s.posture !== 'standing') beginExit();
      else if (wanted !== 'standing') s.path = residentRoute(room, nextWalkStart(root), entry, obstacles(room, pose, ballObstacles()));
    }
    const surfaceAt = (x: number, z: number): 'wood' | 'rug' =>
      p.sceneId === 'observatory' && x >= -2.95 && x <= -0.05 && z >= -0.3 && z <= 1.9 ? 'rug' : 'wood';
    const frameX = root.position.x, frameZ = root.position.z;
    let walking = false;
    let stairSample: ReturnType<typeof sampleCabinStairs> | null = null;
    let stairStep: Point | null = null;
    let stairGait: StairGait | null = null;
    let onStairContact = false;
    const sofa = sofaMotion.current;
    const sofaClip = rig.current?.fitted?.sofa ?? sofa.clip;
    if (sofa.rig !== rig.current || (sofaClip && !sofa.apply && rig.current)) {
      sofa.apply = rig.current && sofaClip ? sofaPlayer(rig.current.mesh, sofaClip) : null;
      sofa.rig = rig.current;
    }
    const seatIdle = seatedIdle.current;
    const floor = cabinPerformance.current;
    const settledFloor = floor?.kind === 'floor' && (floor.phase === 'seated'
      || (floor.phase === 'rise' && floor.time === 0 && seatIdle.seat === 'floor'));
    const settledChair = s.posture === 'chair' && chairMotion.current.phase === 'seated';
    const settledSofa = s.posture === 'sofa' && sofaClip && sofa.time >= SOFA_STEPS + sofaClip.duration;
    const seat = settledFloor && p.approachEnabled ? 'floor' : settledChair ? 'chair' : settledSofa ? 'sofa' : null;
    const canIdle = p.sceneId === 'habitat' && !!rig.current && !p.reducedMotion && !document.hidden;
    const pauseIdle = !p.enabled || !!p.focusedObject;
    const activeSeat = canIdle && (!pauseIdle || (seatIdle.seat === seat && seatIdle.weight > 0)) ? seat : null;
    const holdSeat = stepSeatedIdle(seatIdle, dt, activeSeat,
      s.exiting || (settledFloor && floor.leaving) || pauseIdle, cabin.clips);
    if (!p.approachEnabled && cabinPerformance.current) {
      if (cabinPerformance.current.kind === 'plush' && !cabinPerformance.current.placing) plushGrip.current = null;
      cabinPerformance.current = null;
      p.paperPickup.current = null;
    }
    if (cabinPerformance.current && cabin.apply && cabin.clips) {
      const performance = cabinPerformance.current;
      if (performance.kind === 'plush' && performance.placing && plushGrip.current) {
        const grip = plushGrip.current;
        const yaw = Math.atan2(grip.floorX - root.position.x, grip.floorZ - root.position.z);
        root.rotation.y = angle(root.rotation.y, yaw, 1 - Math.exp(-dt * 10));
      }
      if (!holdSeat && advanceCabinPerformance(performance, document.hidden ? 0 : dt * (p.reducedMotion ? 4 : 1), cabin.clips)) {
        cabinPerformance.current = null;
        p.paperPickup.current = null;
        if (performance.kind === 'plush' && plushGrip.current && performance.placing !== performance.leaving) {
          const { body, floorX, floorZ } = plushGrip.current;
          if (performance.placing) Object.assign(body, { x: floorX, z: floorZ, yaw: root.rotation.y,
            y: 0, roll: 0, pitch: 0, vx: 0, vz: 0, vy: 0, rollVel: 0, pitchVel: 0, spin: 0, toppled: false });
          plushGrip.current = null;
        }
        if (performance.kind === 'paper' && !performance.leaving) performance.complete();
        if (approach.current) planApproach();
        else if (s.external && p.walkTarget) {
          s.path = chairRoute(room, pose, [root.position.x, root.position.z], [p.walkTarget[0], p.walkTarget[2]], ballObstacles());
        }
      }
      root.position.y = cabinPerformance.current?.kind === 'floor' ? RUG_TOP : 0;
    } else if (p.sceneId === 'habitat' && s.posture === 'chair') {
      const cm = chairMotion.current;
      const result = stepChairMotion(cm, dt, s.exiting && !holdSeat, p.reducedMotion);
      s.blend = cm.time / CHAIR_SIT_SECONDS;
      s.sit = result.weight;
      const start = chairFront(pose, result.offset), u = ease(cm.align);
      root.position.set(THREE.MathUtils.lerp(seatEntry[0], start[0], u), 0, THREE.MathUtils.lerp(seatEntry[1], start[1], u));
      root.rotation.y = pose.yaw;
      if (result.done) {
        s.posture = 'standing'; s.exiting = false; s.blend = 0; s.sit = 0;
        chairMotion.current = createChairMotion();
        if (libraryWalking && libraryTarget) s.path = residentRoute(room, entry, [libraryTarget[0],libraryTarget[2]], obstacles(room, pose, ballObstacles()));
        else if (approach.current) planApproach();
        else if (s.external && p.walkTarget) s.path = residentRoute(room, entry,[p.walkTarget[0],p.walkTarget[2]],obstacles(room, pose, ballObstacles()));
        else if (wanted !== 'standing') s.path = residentRoute(room, entry, destination(wanted), obstacles(room, pose, ballObstacles()));
      }
    } else if (s.posture === 'sofa' && sofaClip) {
      const previous = sofa.time;
      const speed = sofa.time < SOFA_STEPS ? 1 : p.reducedMotion ? 4 : 1;
      sofa.time = clamp(previous + dt * speed * (holdSeat ? 0 : s.exiting ? -1 : 1), 0, SOFA_STEPS + sofaClip.duration);
      const retreat = Math.min(sofa.time, SOFA_STEPS) * WALK_SPEED;
      root.position.set(SOFA_ENTRY[0] - Math.sin(FLOOR_SOFA.yaw) * retreat, 0,
        SOFA_ENTRY[1] - Math.cos(FLOOR_SOFA.yaw) * retreat);
      root.rotation.y = FLOOR_SOFA.yaw;
      walking = Math.min(previous, SOFA_STEPS) !== Math.min(sofa.time, SOFA_STEPS);
      if (s.exiting && sofa.time === 0) {
        s.posture = 'standing'; s.exiting = false;
        if (libraryWalking && libraryTarget) s.path = residentRoute(room, entry, [libraryTarget[0], libraryTarget[2]], obstacles(room, pose, ballObstacles()));
        else if (approach.current) planApproach();
        else if (s.external && p.walkTarget) s.path = residentRoute(room, entry, [p.walkTarget[0], p.walkTarget[2]], obstacles(room, pose, ballObstacles()));
        else if (wanted !== 'standing') s.path = residentRoute(room, entry, destination(wanted), obstacles(room, pose, ballObstacles()));
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
        if (libraryWalking && libraryTarget) s.path = residentRoute(room, entry, [libraryTarget[0], libraryTarget[2]], obstacles(room, pose, ballObstacles()));
        else if (approach.current) planApproach();
        else if (s.external && p.walkTarget) s.path = residentRoute(room, entry, [p.walkTarget[0], p.walkTarget[2]], obstacles(room, pose, ballObstacles()));
        else if (wanted !== 'standing') s.path = residentRoute(room, entry, destination(wanted), obstacles(room, pose, ballObstacles()));
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
      if (s.stairs) {
        const stairs = s.stairs;
        const ascending = stairs.from === 'lower';
        const before = sampleCabinStairs(stairs.distance);
        stairs.distance = clamp(stairs.distance + dt * (before.tread === null ? WALK_SPEED : STAIR_SPEED) * (ascending ? 1 : -1), 0, STAIR_DISTANCE);
        stairSample = sampleCabinStairs(stairs.distance);
        const [x, , z] = stairSample.position;
        stairStep = [x - before.position[0], z - before.position[2]];
        if (stairSample.tread !== null) {
          stairGait = sampleStairGait(stairSample.tread, ascending, p.reducedMotion);
          onStairContact = before.tread !== null && stairGait.footfall !== stairFootfall(before.tread, ascending);
        }
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
          if (s.path.length) {
            const usesChairCircle = approach.current?.action.objectId === 'chair' || (s.external && !approach.current);
            const clear = usesChairCircle
              ? clearSegment([beforeX, beforeZ], [x, z], [...room.boxes, ...ballObstacles()], { x: pose.x, z: pose.z, radius: CHAIR_CONTACT }, bounds)
              : clearSegment([beforeX, beforeZ], [x, z], obstacles(room, pose, ballObstacles()), undefined, bounds);
            if (clear) { root.position.x = x; root.position.z = z; }
            else if (approach.current) planApproach();
          } else {
            const circle = { x: pose.x, z: pose.z, radius: CHAIR_CONTACT };
            const boxes = [...room.boxes, ...ballObstacles()];
            if (clearSegment([beforeX, beforeZ], [x, beforeZ], boxes, circle, bounds)) root.position.x = x;
            if (clearSegment([root.position.x, beforeZ], [root.position.x, z], boxes, circle, bounds)) root.position.z = z;
          }
          walking = Math.hypot(root.position.x - beforeX, root.position.z - beforeZ) > 0.001;
          root.rotation.y = angle(root.rotation.y, Math.atan2(dx, dz), 1 - Math.exp(-dt * 14));
        }
      }
      if (!s.stairs && !s.path.length && s.external && p.enabled && !s.exiting) {
        const request = approach.current;
        const id = request?.action.objectId ?? '';
        const rug = isRugSeat(id), paper = isPaperPickup(id), doll = findDoll(id);
        const fixed = id === 'chair' || id === 'sofa' || rug;
        const target = id === 'sofa' ? SOFA_ENTRY : id === 'chair' ? seatEntry : rug ? RUG_SEAT : request?.point;
        const distance = target ? Math.hypot(root.position.x - target[0], root.position.z - target[1]) : 0;
        const radius = fixed ? .06 : id === 'pet' ? PET_REACH : paper ? PAPER_PICKUP_REACH : doll ? .53 : 1.15;
        if (request && (rug || paper || doll) && distance <= radius && !cabin.failed) {
          const yaw = rug ? RUG_YAW : Math.atan2(request.point[0] - root.position.x, request.point[1] - root.position.z) + (doll ? 0 : .08);
          root.rotation.y = angle(root.rotation.y, yaw, 1 - Math.exp(-dt * 14));
          if (cabin.apply && Math.abs(angle(root.rotation.y, yaw, 1) - root.rotation.y) < .045) {
            root.rotation.y = yaw;
            if (rug) {
              root.position.set(RUG_SEAT[0], RUG_TOP, RUG_SEAT[1]);
              cabinPerformance.current = newRugPerformance();
            } else if (doll) {
              const shape = plushShapes.get(doll.id);
              if (!shape) { cancelApproach(); return; }
              plushGrip.current = gripPlush(doll, shape);
              cabinPerformance.current = { kind: 'plush', placing: false, leaving: false, time: 0 };
            } else cabinPerformance.current = { kind: 'paper', time: 0, leaving: false, id: id.slice(PAPER_PICKUP_PREFIX.length),
              point: new THREE.Vector3(request.point[0], request.height, request.point[1]), complete: request.perform };
            cancelApproach();
          }
        } else {
          cancelApproach();
          if (request && !rug && !paper && !doll && distance <= radius) request.perform();
        }
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
        else s.path = residentRoute(room, [root.position.x, root.position.z], entry, obstacles(room, pose, ballObstacles()));
      }
      root.position.y = cabinPerformance.current?.kind === 'floor' ? RUG_TOP : 0;
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
      const loose = plushBodies.current.filter(body => body !== plushGrip.current?.body);
      const floorDolls = {
        lower: loose.filter(body => deckFromAuthoredX(body.x) === 'lower'),
        upper: loose.filter(body => deckFromAuthoredX(body.x) === 'upper'),
      };
      const mover = {
        x: root.position.x, z: root.position.z,
        vx: dt > 0 && !stairSample ? (root.position.x - frameX) / dt : 0,
        vz: dt > 0 && !stairSample ? (root.position.z - frameZ) / dt : 0,
        radius: RADIUS, active: !stairSample && !cabinPerformance.current && (s.posture === 'standing' || s.exiting),
      };
      stepPlushDolls(floorDolls.lower, dt, deck === 'lower' ? [mover] : [], room.plushBoxes,
        plushBounds(false), p.reducedMotion);
      stepPlushDolls(floorDolls.upper, dt, deck === 'upper' ? [mover] : [], room.plushBoxes,
        plushBounds(true), p.reducedMotion);
      if (s.posture === 'standing' && !s.exiting && !libraryActive && !stairSample && !cabinPerformance.current) {
        resolveMoverAgainstPlush(root.position, RADIUS, floorDolls[deck], (x, z) => free([x, z], [...room.boxes, ...ballObstacles()], DECK_WALK_BOUNDS[deck]));
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
      if (stairGait ? onStairContact : halfStep !== Math.floor(s.walkTime * 2)) {
        const foot = stairGait ? Number(stairGait.feet[0].swing) : halfStep & 1;
        roomAudio.playFootstep({ foot: foot as 0 | 1, surface: surfaceAt(root.position.x, root.position.z), intensity: stairGait?.descent ? .58 : 1 });
      }
      s.walkTime = (next + 1) % 1;
    }
    const sofaSteps = s.posture === 'sofa' && sofa.time < SOFA_STEPS;
    const interactionPose = s.posture !== 'standing' || s.exiting || !!cabinPerformance.current || (libraryActive && !libraryWalking);
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
    if (p.focusedObject === 'wardrobe') {
      const yaw = p.objects.wardrobe?.open ? Math.PI / 2 : -.63;
      root.rotation.y = angle(root.rotation.y, yaw, p.reducedMotion ? 1 : 1 - Math.exp(-dt * 9));
    }
    if (p.inspectionId && rig.current) {
      const take = inspection.current;
      if (take.id !== p.inspectionId) {
        take.id = p.inspectionId; take.elapsed = 0; take.finished = false;
      }
      if (!take.finished) {
        take.elapsed = p.reducedMotion ? INSPECTION_SECONDS : Math.min(INSPECTION_SECONDS, take.elapsed + Math.min(rawDelta, .1));
        inspectOutfit(rig.current, take.elapsed);
        if (take.elapsed === INSPECTION_SECONDS) { take.finished = true; p.onInspectionEnd(); }
      }
    } else if (inspection.current.id) {
      if (rig.current) inspectOutfit(rig.current, 0);
      inspection.current.id = 0;
    }
    const standingAtRest = !!rig.current && p.enabled && !p.focusedObject
      && !document.hidden && s.posture === 'standing' && wanted === 'standing' && !s.exiting
      && !walking && distance < .00001 && walkWeight.current === 0
      && !keys.current.size && !idleInput.current && !s.path.length && !s.stairs && !s.external
      && !approach.current && !libraryActive && !cabinPerformance.current && !plushGrip.current;
    const im = idleMotion.current;
    const fittedIdle = rig.current?.fitted?.idle;
    const yawnClip = fittedIdle?.yawn ?? im.clip;
    const lookClip = fittedIdle?.look ?? im.lookClip;
    stepIdle(idle.current, rawDelta, standingAtRest && !p.reducedMotion, yawnClip?.duration ?? 0,
      Math.random, lookClip?.duration ?? 0, standingAtRest, cabin.clips);
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
      im.player = createIdlePlayer(rig.current.mesh, yawnClip ?? undefined, lookClip ?? undefined, cabin.apply);
    }
    if (rig.current) {
      const playingChair = p.sceneId === 'habitat' && s.posture === 'chair';
      rig.current.applyPose(stairGait?.phase ?? s.walkTime, ease(walkWeight.current) * (1 - (stairGait?.weight ?? 0)));
      if (stairGait) rig.current.applyStairPose(stairGait, CABIN_STAIRS.x, stairTreadSurface);
      if (!playingChair && flow?.book && librarySample) libraryPlayer.current!.apply(flow.book, librarySample);
      if (!p.reducedMotion && flow?.phase === 'reach' && flow.book && librarySample
        && slotFor(flow.book).row === 2 && cabin.apply && cabin.clips) {
        // Use the source's rising arm during the approach. The keyed grip
        // takes back full control before any finger or book contact.
        const progress = flow.progress;
        const weight = .68 * THREE.MathUtils.smoothstep(progress, 0, .26)
          * (1 - THREE.MathUtils.smoothstep(progress, .4, .70));
        if (weight > 0) cabin.apply('reachHigh', .17 + progress * .82, weight);
      }
      if (!interactionPose && !libraryActive) im.player?.(idle.current, !p.reducedMotion);
      rig.current.applyChairPose?.(
        playingChair ? chairMotion.current.time : 0,
        playingChair ? ease(chairMotion.current.align) : 0,
      );
      if (s.posture === 'sofa' && !sofaSteps) sofa.apply?.(sofa.time - SOFA_STEPS);
      const performance = cabinPerformance.current;
      if (performance && cabin.apply && cabin.clips) {
        applyCabinPerformance(performance, cabin.clips, cabin.apply);
        if (performance.kind === 'paper') {
          const mesh = rig.current.mesh;
          if (paperPose.current?.mesh !== mesh) paperPose.current = { mesh, apply: createPaperPose(mesh) };
          const held = p.paperPickup.current ?? { id: performance.id, position: new THREE.Vector3() };
          paperPose.current.apply(performance.point, performance.time, held.position);
          p.paperPickup.current = performance.time >= PICKUP_GRIP_TIME ? held : null;
        }
      }
      const thought = catalogThink.current;
      const choosing = flow?.phase === 'catalog' && !p.reducedMotion;
      if (choosing) thought.time = Math.min(thought.time + dt, 1.55);
      thought.weight = clamp(thought.weight + (choosing ? 1 : -1) * dt * 4, 0, 1);
      if (!thought.weight) thought.time = 0;
      else if (choosing || !librarySample) cabin.apply?.('think', thought.time, ease(thought.weight));
      if (plushGrip.current && cabin.clips) {
        if (plushPose.current?.mesh !== rig.current.mesh) {
          plushPose.current = { mesh: rig.current.mesh, apply: createPlushPose(rig.current.mesh) };
        }
        plushGrip.current.visible = deckFrame.current?.visible ?? true;
        plushPose.current.apply(root, plushGrip.current, performance?.kind === 'plush' ? performance.time : cabin.clips.pickUp.duration, PICKUP_GRIP_TIME);
      }
      if (seatIdle.overlay) {
        const weight = seatedIdleWeight(seatIdle);
        if (weight > 0) cabin.apply?.(seatIdle.overlay, seatIdle.time, weight);
      } else {
        rig.current.applySeatedIdle?.(seatIdle);
      }
      // Add the offsets after authored animation, only when there is no contact pose to preserve.
      rig.current.followMotion(rawDelta,
        !interactionPose && !libraryActive && !p.focusedObject && !p.reducedMotion && !document.hidden,
        root.rotation.y, frameDx, frameDz, stairGait?.phase ?? s.walkTime);
      rig.current.applyArmCorrectives(!interactionPose && !libraryActive && !plushGrip.current);
    }
    if (library && rig.current) library.tick(dt);
    rig.current?.updateSleeveContact?.();
    root.userData.onStairs = !!stairSample;
    root.userData.posture = s.exiting ? 'standing-up' : s.posture;
    root.userData.cabinAction = cabinPerformance.current?.kind === 'floor' ? cabinPerformance.current.phase : cabinPerformance.current?.kind;
    root.userData.standingIdle = { elapsed: idle.current.elapsed, weight: idle.current.weight, yawnTime: idle.current.yawnTime,
      nextYawn: idle.current.nextYawn, lookTime: idle.current.lookTime, nextLook: idle.current.nextLook,
      shortTime: idle.current.shortTime, shortKind: idle.current.shortKind };
    root.userData.chairPhase = s.posture === 'chair' ? chairMotion.current.phase : 'idle';
    p.sofaTime.current = s.posture === 'sofa' ? sofa.time - SOFA_STEPS : null;
    root.userData.sofaTime = p.sofaTime.current;
    root.userData.plushBodies = plushBodies.current;
    const nearbyList = p.showNearbyHints === false ? [] : nearbyActions();
    const nearby = nearbyList[0] ?? null;
    const rugHint = cabinPerformance.current?.kind === 'floor' && !cabinPerformance.current.leaving
      && p.enabled && p.showNearbyHints !== false ? 'E · 起身' : '';
    const carrying = plushGrip.current;
    const carryStairs = carrying && !cabinPerformance.current && !s.stairs && p.enabled && p.showNearbyHints !== false ? stairReady() : null;
    const carryHint = carrying && !cabinPerformance.current && !s.stairs && p.enabled && p.showNearbyHints !== false
      ? carryStairs ? `E · ${carryStairs === 'lower' ? '上楼' : '下楼'}` : 'E · 放下' + plushLabels[carrying.body.id] : '';
    const hint = carryHint || rugHint || (p.enabled && p.showNearbyHints !== false && (s.posture !== 'standing' || wanted !== 'standing')
      ? canUseComputer() ? 'E · 起身　Q · 使用电脑' : 'E · 起身'
      : nearbyList.map((target, index) => `${INTERACT_LABELS[index]} · ${target.hint}`).join('　'));
    if (nearby?.id !== s.nearby?.id || hint !== s.nearbyHint) {
      s.nearby = nearby;
      s.nearbyHint = hint;
      p.onHover(nearby?.id ?? (hint ? s.posture : null), hint || undefined);
    }
  }, -1);

  const canCatWalk = (x: number, z: number) => {
    const luna = resident.current?.position;
    return !props.catMenuOpen && approach.current?.action.objectId !== 'pet'
      && free([x, z], [...room.boxes, ...ballObstacles()], DECK_WALK_BOUNDS.lower)
      && (!luna || state.current.stairs || deckFromAuthoredX(luna.x) === 'upper'
        || Math.hypot(x - luna.x, z - luna.z) > RADIUS + .28)
      && plushBodies.current.every(plush => plush === plushGrip.current?.body || Math.hypot(x - plush.x, z - plush.z) > plush.radius + .28);
  };
  return <group name={`OrbitalResidents_${props.sceneId}`}>
    <group ref={deckFrame} name="Resident_DeckPlacement">
      <group ref={resident} name="OrbitalResident" position={spawn} rotation-y={-.78}>
        <ResidentModel rig={rig} outfit={props.outfit} onMounted={props.onOutfitMounted}
          onFailure={props.focusedObject === 'wardrobe' ? undefined : props.library?.fail}
          prefetchSeat={props.sceneId === 'habitat' && props.prefetchSeat !== false}
          chairActive={props.sceneId === 'habitat' && !!props.objects.chair?.active} />
      </group>
    </group>
    {props.sceneId === 'habitat' && <Suspense fallback={null}><SlipperPair resident={resident} room={slipperRoom.current} reducedMotion={props.reducedMotion} /></Suspense>}
    {props.sceneId === 'habitat' && props.loadPlush !== false && <PlushDolls shapes={plushShapes} bodies={plushBodies} grip={plushGrip} world={props} />}
    {props.loadCat !== false && <ObjectHandle id="pet" action="pet" hint="和团子互动" world={props} panorama position={[CAT_HOME[0], CAT_MAT_Y, CAT_HOME[1]]}
      onClick={event => event.stopPropagation()}>
      <Cat resident={resident} value={props.objects.pet?.value ?? 0} command={props.objects.pet?.itemId} reducedMotion={props.reducedMotion}
        location={catLocation} canWalk={props.sceneId === 'habitat' ? canCatWalk : undefined} />
    </ObjectHandle>}
  </group>;
}
