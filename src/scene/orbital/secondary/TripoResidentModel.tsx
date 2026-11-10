import { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import { SecondaryMotion } from './SecondaryMotion';
import { TRIPO_SCALE, TRIPO_SPEED } from './residentMode';
import type { ChairSeating } from '../chair/ChairSeating';
import { TurnFootPlant } from '../chair/TurnFootPlant';
import { ChairContact } from '../chair/ChairContact';
import { ImportedPose } from '../chair/ImportedPose';

export { TRIPO_SCALE, TRIPO_SPEED, tripoRoomTest } from './residentMode';
const MODEL = `${import.meta.env.BASE_URL}models/resident/luna-tripo-transitions.glb`;
const CHAIR_MOTION = `${import.meta.env.BASE_URL}models/resident/luna-chair-motion.glb`;
interface RoomAudit {
  snapshot: () => { position: number[]; clipTime: number; moving: boolean; bones: number; modelScale: number; clipSpeed: number };
}
declare global { interface Window { tripoRoomAudit?: RoomAudit } }

function Loaded({ root }: { root: RefObject<THREE.Group> }) {
  const gltf = useGLTF(MODEL);
  const chairMotion = useGLTF(CHAIR_MOTION);
  const asset = useMemo(() => clone(gltf.scene), [gltf.scene]);
  const state = useRef<{ mixer: THREE.AnimationMixer; walk: THREE.AnimationAction; idle: THREE.AnimationAction;
    chair: THREE.AnimationAction[]; motion: SecondaryMotion; body: ImportedPose; turn: TurnFootPlant; contact: ChairContact; previous: THREE.Vector3; phase: number; moving: boolean; walkWeight: number }>();
  useEffect(() => {
    asset.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = o.receiveShadow = true; o.frustumCulled = false; } });
    // Construct capsule references at bind pose before sampling a clip.
    asset.updateWorldMatrix(true, true);
    const motion = new SecondaryMotion(asset), mixer = new THREE.AnimationMixer(asset);
    const walk = mixer.clipAction(gltf.animations.find(a => a.name === 'Walk')!);
    const idle = mixer.clipAction(gltf.animations.find(a => a.name === 'SitCycle')!);
    const chair = ['ChairSitDown', 'ChairSeatedIdle', 'ChairStandUp'].map(name => {
      const action = mixer.clipAction(chairMotion.animations.find(a => a.name === name)!);
      action.play(); action.paused = true; action.weight = 0; return action;
    });
    walk.play(); idle.play(); idle.time = 9; idle.paused = true; walk.paused = true;
    walk.weight = 0; idle.weight = 1; mixer.update(0);
    asset.updateWorldMatrix(true, true);
    let mesh!: THREE.SkinnedMesh;
    asset.traverse(o => { if (o instanceof THREE.SkinnedMesh) mesh = o; });
    const contact = new ChairContact(mesh, root.current!);
    state.current = { mixer, walk, idle, chair, motion, contact, body: new ImportedPose(asset), turn: new TurnFootPlant(asset, root.current!), previous: root.current!.position.clone(), phase: 0, moving: false, walkWeight: 0 };
    let bones = 0;
    asset.traverse(o => { if (o instanceof THREE.Bone) bones++; });
    const api: RoomAudit = { snapshot: () => ({ position: root.current!.position.toArray(), clipTime: state.current!.phase,
      moving: state.current!.moving, bones, modelScale: TRIPO_SCALE, clipSpeed: TRIPO_SPEED }) };
    if (root.current?.parent?.name.endsWith('habitat')) window.tripoRoomAudit = api;
    return () => {
      contact.dispose(); motion.dispose(); mixer.stopAllAction(); mixer.uncacheRoot(asset); state.current = undefined;
      asset.traverse(o => { if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose(); });
      if (window.tripoRoomAudit === api) delete window.tripoRoomAudit;
    };
  }, [asset, gltf.animations, chairMotion.animations, root]);
  // Parent controller runs first; measure actual travel after obstacle handling.
  useFrame((_, delta) => {
    const s = state.current, actor = root.current;
    if (!s || !actor) return;
    const distance = Math.hypot(actor.position.x-s.previous.x, actor.position.z-s.previous.z);
    s.previous.copy(actor.position);
    const seating = actor.userData.chairSeating as ChairSeating | undefined;
    const walkingPhase = !seating?.phase || ['APPROACH', 'ALIGN', 'EXIT'].includes(seating.phase);
    s.moving = walkingPhase && actor.userData.posture === 'standing' && distance > .00001 && actor.userData.grounded !== false;
    if (s.moving) s.phase = (s.phase + distance / TRIPO_SPEED) % 1.2;
    s.walkWeight = THREE.MathUtils.damp(s.walkWeight, s.moving ? 1 : 0, 18, Math.min(delta, .05));
    if (s.walkWeight < .0001) s.walkWeight = 0;
    if (s.walkWeight > .9999) s.walkWeight = 1;
    if (seating?.sitting) s.walkWeight = 0;
    s.motion.advance(Math.min(delta, .05), () => {
      s.walk.time = s.phase;
      s.walk.weight = s.walkWeight;
      s.idle.weight = seating?.sitting ? 0 : 1 - s.walkWeight;
      s.idle.time = 9;
      const active = seating?.phase === 'SIT_DOWN' ? 0 : seating?.phase === 'SEATED_IDLE' ? 1 : seating?.phase === 'STAND_UP' ? 2 : -1;
      s.chair.forEach((action, i) => {
        action.weight = active === i ? 1 : 0;
        action.time = active === i ? (i === 1 ? seating!.elapsed % 4 : Math.min(seating!.elapsed, i === 0 ? 1.8 : 1.7)) : 0;
      });
      s.body.sample(() => s.mixer.update(0));
      s.turn.apply(seating);
      // Chair clips already own the arm path and dress support pose. The old fixed
      // hand IK must not pull the authored side/settling gestures towards its lap target.
      if (!seating?.sitting && actor.userData.grounded !== false && s.walkWeight < .999) s.turn.keepSolesAboveFloor();
      const contact = seating?.phase === 'SIT_DOWN' ? THREE.MathUtils.smoothstep(seating.elapsed, .82, 1.24) : seating?.phase === 'STAND_UP' ? 1 - THREE.MathUtils.smoothstep(seating.elapsed, .2, .7) : seating?.phase === 'SEATED_IDLE' ? 1 : 0;
      s.motion.setRotationAllowance(seating?.sitting ? .30 : s.moving ? .32 : 1, seating?.sitting ? .20 : s.moving ? .12 : 1);
      for (const prefix of ['Dress_Back', 'Dress_Left', 'Dress_Right']) s.motion.setChainAllowance(prefix, THREE.MathUtils.lerp(1, .45, contact));
      s.motion.setChainAllowance('Hair_Back', THREE.MathUtils.lerp(1, .76, contact));
    });
    s.contact.update(seating);
  });
  return <primitive object={asset} scale={TRIPO_SCALE} />;
}

export function TripoResidentModel({ root }: { root: RefObject<THREE.Group> }) {
  return <Suspense fallback={null}><Loaded root={root} /></Suspense>;
}
