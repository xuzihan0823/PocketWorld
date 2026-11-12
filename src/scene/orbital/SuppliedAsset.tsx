import React, { Component, Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { cloneSuppliedModel } from './supplied-model';

type Vector = [number, number, number];
interface Props {
  name: string;
  size: Vector;
  position?: Vector;
  rotation?: Vector;
  /** A named part from the independently exported articulation file. */
  part?: string;
  partBounds?: boolean;
  fit?: 'contain' | 'contact';
  fallback?: React.ReactNode;
}

class Boundary extends Component<{ children: React.ReactNode; fallback: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function Loaded({ name, size, position, rotation, part, partBounds, fit: fitMode = 'contain' }: Props) {
  const { scene } = useGLTF(`${import.meta.env.BASE_URL}models/replaced/${name}.glb`);
  const model = useMemo(() => cloneSuppliedModel(scene, part), [scene, part]);
  const fit = useMemo(() => {
    scene.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(partBounds && part ? scene.getObjectByName(part) ?? scene : scene);
    const extent = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const ratios = size.map((value, axis) => value / Math.max(extent.getComponent(axis), .00001));
    const factors = (fitMode === 'contact' ? ratios : ratios.map(() => Math.min(...ratios))) as Vector;
    return { factors, offset: [-center.x, -bounds.min.y, -center.z] as Vector };
  }, [scene, part, partBounds, fitMode, ...size]);
  return <group position={position} rotation={rotation} name={`Supplied_${name}${part ? '_' + part : ''}`} dispose={null}>
    <group scale={fit.factors}><group position={fit.offset}><primitive object={model} /></group></group>
  </group>;
}

/** Local loading/error fallback keeps the original object functional while loading. */
export function SuppliedAsset(props: Props) {
  const fallback = props.fallback ?? null;
  return <Boundary key={`${props.name}/${props.part ?? ''}`} fallback={fallback}><Suspense fallback={fallback}><Loaded {...props} /></Suspense></Boundary>;
}
