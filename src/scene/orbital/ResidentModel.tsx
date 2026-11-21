import React, { useEffect, useLayoutEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { Html } from '@react-three/drei';
import type { ThreeElements } from '@react-three/fiber';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import { createResidentRig } from './residentRig';
import { applyResidentSkin } from './residentSkin';
import { createChairAnimation, readSeatContactCache } from './chairAnimation';
import { initialOutfit, type ResidentOutfit } from './wardrobe/outfit';
import {
  clearResidentBundle,
  getCachedResidentBundle,
  loadResidentBundle,
  preloadResidentBundle,
  type ResidentBundle,
} from './wardrobe/residentAssets';

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
  applyPose: (phase: number, walkWeight: number, uprightWeight?: number) => void;
  followMotion: (dt: number, enabled: boolean, yaw: number, dx: number, dz: number, phase: number) => void;
  applyArmCorrectives: (enabled: boolean) => void;
  applyChairPose?: (time: number, weight: number) => void;
  dispose: () => void;
}

function MountedResident({
  bundle,
  rig,
  onReady,
}: {
  bundle: ResidentBundle;
  rig: MutableRefObject<ResidentRig | null>;
  onReady?: (outfit: ResidentOutfit) => void;
}) {
  const container = useRef<THREE.Group>(null);
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const resident = useMemo(() => {
    const asset = clone(bundle.scene);
    const result = createResidentRig(asset, bundle.walk);
    const chair = createChairAnimation(asset, bundle.sit, readSeatContactCache(bundle.contact));
    const dispose = result.dispose;
    result.applyChairPose = chair.apply;
    result.dispose = () => { chair.dispose(); dispose(); };
    return result;
  }, [bundle]);

  useLayoutEffect(() => {
    const group = container.current!;
    const restoreSkin = applyResidentSkin(resident.mesh);
    group.add(resident.mesh);
    rig.current = resident;
    readyRef.current?.(bundle.outfit);
    return () => {
      if (rig.current === resident) rig.current = null;
      group.remove(resident.mesh);
      restoreSkin();
      resident.dispose();
    };
  }, [bundle.outfit, resident, rig]);

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

class ResidentBoundary extends React.Component<{ children: React.ReactNode; onFailure?: () => void; onRetry: () => void }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch() { this.props.onFailure?.(); }
  render() {
    if (!this.state.failed) return this.props.children;
    return <group onPointerDown={event => { event.stopPropagation(); this.props.onRetry(); this.setState({ failed: false }); }}><ModelStatus failed /></group>;
  }
}

export type ResidentModelProps = ThreeElements['group'] & {
  rig: MutableRefObject<ResidentRig | null>;
  outfit?: ResidentOutfit;
  onFailure?: () => void;
  onOutfitLoading?: (outfit: ResidentOutfit) => void;
  onOutfitReady?: (outfit: ResidentOutfit) => void;
  onOutfitError?: (failed: ResidentOutfit, fallback: ResidentOutfit) => void;
};

export function ResidentModel({
  rig,
  outfit = 'everyday',
  onFailure,
  onOutfitLoading,
  onOutfitReady,
  onOutfitError,
  ...props
}: ResidentModelProps) {
  const [bundle, setBundle] = useState<ResidentBundle | null>(() => getCachedResidentBundle(outfit));
  const [initialFailed, setInitialFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const bundleRef = useRef(bundle);
  bundleRef.current = bundle;
  const callbacks = useRef({ onFailure, onOutfitLoading, onOutfitReady, onOutfitError });
  callbacks.current = { onFailure, onOutfitLoading, onOutfitReady, onOutfitError };

  useEffect(() => {
    const cached = getCachedResidentBundle(outfit);
    if (cached) {
      setInitialFailed(false);
      if (bundleRef.current === cached) callbacks.current.onOutfitReady?.(cached.outfit);
      else setBundle(cached);
      return;
    }
    let live = true;
    setInitialFailed(false);
    if (bundleRef.current) callbacks.current.onOutfitLoading?.(outfit);
    void loadResidentBundle(outfit).then(next => {
      if (!live) return;
      setInitialFailed(false);
      setBundle(next);
    }).catch(() => {
      if (!live) return;
      clearResidentBundle(outfit);
      const current = bundleRef.current;
      if (current) {
        callbacks.current.onOutfitError?.(outfit, current.outfit);
      } else {
        setInitialFailed(true);
        callbacks.current.onFailure?.();
      }
    });
    return () => { live = false; };
  }, [outfit, attempt]);

  const retry = () => {
    clearResidentBundle(outfit);
    setInitialFailed(false);
    setAttempt(count => count + 1);
  };

  return <group {...props}>
    <ResidentBoundary onFailure={onFailure} onRetry={retry}>
      {bundle
        ? <MountedResident bundle={bundle} rig={rig} onReady={onOutfitReady} />
        : initialFailed
          ? <group onPointerDown={event => { event.stopPropagation(); retry(); }}><ModelStatus failed /></group>
          : <ModelStatus />}
    </ResidentBoundary>
  </group>;
}

if (typeof window !== 'undefined') {
  preloadResidentBundle(initialOutfit());
}
