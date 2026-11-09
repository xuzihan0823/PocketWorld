import { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import { SecondaryMotion } from './SecondaryMotion';

export const TRIPO_SCALE = 1.45;
export const TRIPO_SPEED = .2 * TRIPO_SCALE;
const roomTest = new URLSearchParams(window.location.search).get('resident') === 'tripo';
export const tripoRoomTest = () => roomTest;
const MODEL = `${import.meta.env.BASE_URL}models/resident/luna-tripo-transitions.glb`;
interface RoomAudit {
  snapshot: () => { position: number[]; clipTime: number; moving: boolean; bones: number; modelScale: number; clipSpeed: number };
}
declare global { interface Window { tripoRoomAudit?: RoomAudit } }

function Loaded({ root }: { root: RefObject<THREE.Group> }) {
  const gltf = useGLTF(MODEL);
  const asset = useMemo(() => clone(gltf.scene), [gltf.scene]);
  const state = useRef<{ mixer: THREE.AnimationMixer; walk: THREE.AnimationAction; idle: THREE.AnimationAction;
    motion: SecondaryMotion; previous: THREE.Vector3; phase: number; moving: boolean }>();
  useEffect(() => {
    asset.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } });
    // Construct capsule references at bind pose before sampling a clip.
    asset.updateWorldMatrix(true, true);
    const motion = new SecondaryMotion(asset), mixer = new THREE.AnimationMixer(asset);
    const walk = mixer.clipAction(gltf.animations.find(a => a.name === 'Walk')!);
    const idle = mixer.clipAction(gltf.animations.find(a => a.name === 'SitCycle')!);
    walk.play(); idle.play(); idle.time = 9; idle.paused = true; walk.paused = true;
    walk.weight = 0; idle.weight = 1; mixer.update(0);
    state.current = { mixer, walk, idle, motion, previous: root.current!.position.clone(), phase: 0, moving: false };
    let bones = 0;
    asset.traverse(o => { if (o instanceof THREE.Bone) bones++; });
    const api: RoomAudit = { snapshot: () => ({ position: root.current!.position.toArray(), clipTime: state.current!.phase,
      moving: state.current!.moving, bones, modelScale: TRIPO_SCALE, clipSpeed: TRIPO_SPEED }) };
    if (root.current?.parent?.name.endsWith('habitat')) window.tripoRoomAudit = api;
    return () => {
      motion.dispose(); mixer.stopAllAction(); mixer.uncacheRoot(asset); state.current = undefined;
      asset.traverse(o => { if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose(); });
      if (window.tripoRoomAudit === api) delete window.tripoRoomAudit;
    };
  }, [asset, gltf.animations, root]);
  // Parent controller runs first; measure actual travel after obstacle handling.
  useFrame((_, delta) => {
    const s = state.current, actor = root.current;
    if (!s || !actor) return;
    const distance = Math.hypot(actor.position.x-s.previous.x, actor.position.z-s.previous.z);
    s.previous.copy(actor.position);
    s.moving = distance > .00001 && actor.userData.grounded !== false;
    if (s.moving) s.phase = (s.phase + distance / TRIPO_SPEED) % 1.2;
    s.motion.advance(Math.min(delta, .05), () => {
      s.walk.time = s.phase;
      s.walk.weight = s.moving ? 1 : 0;
      s.idle.weight = s.moving ? 0 : 1;
      s.idle.time = 9;
      s.mixer.update(0);
      s.motion.setRotationAllowance(1, s.moving ? .12 : 1);
    });
  });
  return <primitive object={asset} scale={TRIPO_SCALE} />;
}

export function TripoResidentModel({ root }: { root: RefObject<THREE.Group> }) {
  return <Suspense fallback={null}><Loaded root={root} /></Suspense>;
}
