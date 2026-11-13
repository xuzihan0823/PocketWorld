import React, { Suspense, useLayoutEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { Html, useGLTF } from '@react-three/drei';
import type { ThreeElements } from '@react-three/fiber';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type * as THREE from 'three';
import { createResidentRig } from './residentRig';

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
  pinch: {
    offset: THREE.Vector3;
    basis: THREE.Quaternion;
    apply: (amount: number) => void;
  };
}
export interface ResidentRig {
  legs: ResidentLeg[]; arms: ResidentArm[]; torso: THREE.Bone; neck: THREE.Bone;
  skirtFront: THREE.Bone; skirtBack: THREE.Bone; mesh: THREE.Group;
  applyPose: (phase: number, walkWeight: number) => void;
  dispose: () => void;
}

const MODEL = `${import.meta.env.BASE_URL}models/resident/luna-walk-room.glb`;

function LoadedResident({ rig }: { rig: MutableRefObject<ResidentRig | null> }) {
  const { scene, animations } = useGLTF(MODEL);
  const container = useRef<THREE.Group>(null);
  const resident = useMemo(() => {
    const walk = animations.find(clip => clip.name === 'Walk_Grounded_Loop');
    if (!walk) throw new Error('Luna walk animation missing');
    return createResidentRig(clone(scene), walk);
  }, [scene, animations]);
  useLayoutEffect(() => {
    const group = container.current!;
    group.add(resident.mesh);
    rig.current = resident;
    return () => {
      rig.current = null;
      group.remove(resident.mesh);
      resident.dispose();
    };
  }, [resident, rig]);
  return <group ref={container}>
    <mesh name="ResidentHitArea" position={[0, 0.725, 0.02]} visible={false}><capsuleGeometry args={[0.2, 1.05, 4, 8]} /></mesh>
  </group>;
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
    return <group onPointerDown={event => { event.stopPropagation(); useGLTF.clear(MODEL); this.setState({ failed: false }); }}><ModelStatus failed /></group>;
  }
}

export function ResidentModel({ rig, onFailure, ...props }: ThreeElements['group'] & { rig: MutableRefObject<ResidentRig | null>; onFailure?: () => void }) {
  return <group {...props}>
    <ResidentBoundary onFailure={onFailure}><Suspense fallback={<ModelStatus />}><LoadedResident rig={rig} /></Suspense></ResidentBoundary>
  </group>;
}

useGLTF.preload(MODEL);
