import React, { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react';
import { Html } from '@react-three/drei';
import { type ThreeElements } from '@react-three/fiber';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import { createResidentRig } from './residentRig';
import { applyResidentSkin } from './residentSkin';
import { createChairAnimation } from './chairAnimation';
import { createSeatedIdlePlayer } from './seatedIdle';
import { createSleeveContact } from './wardrobe/sleeveContact';
import { loadResidentAssets, loadResidentSeatContact, type ResidentAssets } from './wardrobe/residentAssets';
import { usePrewarmObject } from './ScenePrewarmer';
import type { ResidentOutfit } from './wardrobe/outfit';
import type { StairGait } from './stairGait';

export { HIP_HEIGHT } from './residentRig';
export interface ResidentLeg {
  thigh: THREE.Bone; shin: THREE.Bone; foot: THREE.Bone;
  upperLength: number; lowerLength: number; ankleHeight: number; hipForward: number;
  straighten: [number, number];
}
export interface ResidentArm {
  shoulder: THREE.Bone; upper: THREE.Bone; forearm: THREE.Bone; hand: THREE.Bone;
  restUpper: THREE.Vector3; restLower: THREE.Vector3; restWrist: THREE.Vector3;
  upperLength: number; lowerLength: number;
  palmBasis: THREE.Quaternion; palmOffset: THREE.Vector3;
  fingerTipOffset?: THREE.Vector3;
  setFingers?: (curl: number, thumbOppose?: number) => void;
}
export interface ResidentRig {
  legs: ResidentLeg[]; arms: ResidentArm[]; torso: THREE.Bone; neck: THREE.Bone; head?: THREE.Bone;
  skirtFront: THREE.Bone; skirtBack: THREE.Bone; mesh: THREE.Group;
  applyPose: (phase: number, walkWeight: number) => void;
  applyStairPose: (gait: StairGait, stairX: number, surfaceAt: (z: number, heelRun?: number) => number) => void;
  followMotion: (dt: number, enabled: boolean, yaw: number, dx: number, dz: number, phase: number) => void;
  fitted?: ResidentAssets['fitted'];
  relaxed?: ResidentAssets['relaxed'];
  updateSleeveContact?: () => void;
  applyArmCorrectives: (enabled: boolean) => void;
  applySeatedIdle?: ReturnType<typeof createSeatedIdlePlayer>;
  applyChairPose?: (time: number, weight: number) => void;
  dispose: () => void;
}

type OutfitMounted = (outfit: ResidentOutfit, ready: boolean) => void;

function LoadedResident({ assets, rig, onMounted, prefetchSeat, chairActive }: {
  assets: ResidentAssets; rig: MutableRefObject<ResidentRig | null>; onMounted?: OutfitMounted;
  prefetchSeat: boolean; chairActive: boolean;
}) {
  const container = useRef<THREE.Group>(null);
  const chairAnimation = useRef<ReturnType<typeof createChairAnimation> | null>(null);
  useLayoutEffect(() => {
    const group = container.current!;
    const asset = clone(assets.scene);
    const resident = createResidentRig(asset, assets.walk, assets.outfit === 'cardigan', assets.handMotion);
    const chair = createChairAnimation(asset, assets.sit);
    chairAnimation.current = chair;
    resident.fitted = assets.fitted;
    resident.relaxed = assets.relaxed;
    resident.applyChairPose = chair.apply;
    resident.applySeatedIdle = createSeatedIdlePlayer(resident, assets.outfit, assets.relaxed.lap, assets.relaxed.cheek);
    if (assets.outfit === 'cardigan') resident.updateSleeveContact = createSleeveContact(asset);
    resident.mesh.userData.outfit = assets.outfit;
    const restoreSkin = applyResidentSkin(resident.mesh);
    group.add(resident.mesh);
    rig.current = resident;
    onMounted?.(assets.outfit, true);
    return () => {
      if (rig.current === resident) rig.current = null;
      group.remove(resident.mesh);
      restoreSkin();
      chairAnimation.current = null;
      chair.dispose();
      resident.dispose();
    };
  }, [assets, rig, onMounted]);
  useEffect(() => {
    const chair = chairAnimation.current;
    if (!chair || (!prefetchSeat && !chairActive)) return;
    let active = true;
    let frame = 0;
    const load = () => {
      void loadResidentSeatContact(assets.outfit).then(contact => {
        if (active && chairAnimation.current === chair) chair.setContact(contact);
      }).catch(error => {
        if (active && chairAnimation.current === chair) console.warn('Luna seat contact unavailable', error);
      });
    };
    if (chairActive) load();
    else frame = requestAnimationFrame(() => { frame = requestAnimationFrame(load); });
    return () => { active = false; cancelAnimationFrame(frame); };
  }, [assets, rig, onMounted, prefetchSeat, chairActive]);
  return <group ref={container} />;
}

function ModelStatus({ failed = false }: { failed?: boolean }) {
  return <group name={failed ? 'ResidentLoadError' : 'ResidentLoading'}>
    <mesh position={[0, 0.725, 0]} castShadow><capsuleGeometry args={[0.17, 1.05, 6, 16]} /><meshStandardMaterial color="#e6edf4" roughness={0.8} /></mesh>
    <Html center position={[0, 1.65, 0]} style={{ pointerEvents: 'none', whiteSpace: 'nowrap', color: '#f6efdc', fontSize: 12 }}>
      <span role={failed ? 'alert' : 'status'}>{failed ? '人物加载失败 · 轻触重试或刷新页面' : '人物加载中…'}</span>
    </Html>
  </group>;
}

class ResidentBoundary extends React.Component<{ children: React.ReactNode; onFailure?: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure?.(); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <group onPointerDown={event => { event.stopPropagation(); this.setState({ failed: false }); }}><ModelStatus failed /></group>;
  }
}

export function ResidentModel({ rig, outfit = 'everyday', onFailure, onMounted, prefetchSeat = true, chairActive = false, ...props }: ThreeElements['group'] & {
  rig: MutableRefObject<ResidentRig | null>; outfit?: ResidentOutfit; onFailure?: () => void; onMounted?: OutfitMounted;
  prefetchSeat?: boolean; chairActive?: boolean;
}) {
  const [assets, setAssets] = useState<ResidentAssets | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const failureCallback = useRef(onFailure);
  failureCallback.current = onFailure;
  useEffect(() => {
    let active = true;
    setFailed(false);
    void loadResidentAssets(outfit).then(value => {
      if (active) setAssets(value);
    }).catch(() => {
      if (active) { setFailed(true); onMounted?.(outfit, false); failureCallback.current?.(); }
    });
    return () => { active = false; };
  }, [outfit, attempt, onMounted]);
  return <group {...props}>
    {assets && <ResidentBoundary key={assets.outfit} onFailure={() => { onMounted?.(assets.outfit, false); onFailure?.(); }}><LoadedResident assets={assets} rig={rig} onMounted={onMounted} prefetchSeat={prefetchSeat} chairActive={chairActive} /></ResidentBoundary>}
    {failed ? <group onPointerDown={event => { event.stopPropagation(); setAttempt(value => value + 1); }}><ModelStatus failed /></group>
      : !assets && <ModelStatus />}
  </group>;
}

export function ResidentPrewarmer({ active, outfit }: { active: boolean; outfit: ResidentOutfit }) {
  const [scene, setScene] = useState<THREE.Group | null>(null);
  useEffect(() => {
    if (!active) return;
    let live = true;
    void loadResidentAssets(outfit).then(value => {
      if (live) setScene(value.scene);
    }).catch(() => {});
    return () => { live = false; };
  }, [active, outfit]);
  usePrewarmObject(scene, { enabled: active && !!scene, materialsPerFrame: 2, texturesPerFrame: 1 });
  return null;
}
