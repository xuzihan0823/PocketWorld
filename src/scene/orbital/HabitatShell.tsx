import { CABIN_LEFT, CABIN_RIGHT, CABIN_CENTER_X } from './cabinLayout';
import React, { Suspense, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { AssetBoundary } from './ReusableAsset';

interface HabitatShellProps {
  variant: 'habitat' | 'observatory';
  onFloorClick?: (point: [number, number, number]) => void;
}

function CabinModel({ variant }: Pick<HabitatShellProps, 'variant'>) {
  const { scene } = useGLTF(`${import.meta.env.BASE_URL}models/cabin/open-cabin.glb`);
  const cabin = useMemo(() => {
    const copy = scene.clone(true);
    copy.traverse(node => {
      if (node instanceof THREE.Mesh) node.castShadow = node.receiveShadow = true;
    });
    if (variant === 'observatory') {
      for (const part of ['Wardrobe_Nightstand', 'Stationery', 'Shelf_Gallery', 'Rugs']) copy.getObjectByName(part)?.removeFromParent();
    }
    return copy;
  }, [scene, variant]);

  return <primitive object={cabin} />;
}

/** A soft contact shadow sits beneath the plinth and is culled when seen from below. */
function PlinthShadow() {
  return <mesh position={[CABIN_CENTER_X + .05, -.285, .03]} rotation={[-Math.PI / 2, 0, 0]} raycast={() => undefined}>
    <planeGeometry args={[CABIN_RIGHT - CABIN_LEFT + 3, 9.6]} />
    <shaderMaterial transparent depthWrite={false} vertexShader={`
      varying vec2 local;
      void main() {
        local = position.xy;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`} fragmentShader={`
      varying vec2 local;
      void main() {
        vec2 edge = abs(local) - vec2(${(CABIN_RIGHT - CABIN_LEFT) / 2 - .27}, 3.03);
        float d = max(0.0, length(max(edge, 0.0)) + min(max(edge.x, edge.y), 0.0) - .24);
        gl_FragColor = vec4(.23, .21, .29, .24 * exp(-4.6 * d * d) + .15 * exp(-18.0 * d));
      }`} />
  </mesh>;
}

export function HabitatShell({ variant, onFloorClick }: HabitatShellProps) {
  const root = useRef<THREE.Group>(null);
  const floorPointer = useRef<number | null>(null);
  const fallback = <mesh name="Floor_Parquet" position={[CABIN_CENTER_X, -.12, 0]} receiveShadow>
    <boxGeometry args={[CABIN_RIGHT - CABIN_LEFT, .24, 6.45]} /><meshStandardMaterial color="#cb9c74" />
  </mesh>;
  const onFloor = (event: ThreeEvent<MouseEvent>) => {
    const startedOnFloor = floorPointer.current !== null;
    floorPointer.current = null;
    event.stopPropagation();
    if (!startedOnFloor || event.delta > 5 || !root.current || !isFloor(event.object)) return;
    const point = root.current.worldToLocal(event.point.clone());
    onFloorClick?.([point.x, 0, point.z]);
  };
  return <group ref={root} name={`${variant}-shell`}>
    <PlinthShadow />
    <group onPointerDown={(event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      floorPointer.current = isFloor(event.object) ? event.pointerId : null;
    }} onPointerCancel={() => { floorPointer.current = null; }} onClick={onFloor}>
      <AssetBoundary fallback={fallback}><Suspense fallback={fallback}><CabinModel variant={variant} /></Suspense></AssetBoundary>
    </group>
    <mesh position={[.45, 2.62, -3.31]} renderOrder={-200} raycast={() => undefined}>
      <planeGeometry args={[5.69, 1.65]} />
      <meshBasicMaterial colorWrite={false} depthWrite={false} stencilWrite stencilRef={1}
        stencilFunc={THREE.AlwaysStencilFunc} stencilZPass={THREE.ReplaceStencilOp} />
    </mesh>
  </group>;
}

function isFloor(node: THREE.Object3D) {
  while (node.parent && node.name !== 'Floor_Parquet' && node.name !== 'Rugs') node = node.parent;
  return node.name === 'Floor_Parquet' || node.name === 'Rugs';
}
