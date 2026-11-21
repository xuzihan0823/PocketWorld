import { CABIN_DIVIDER_X, CABIN_LEFT, CABIN_RIGHT, UPPER_DECK_OFFSET, WARDROBE_FOOTPRINT, type CabinDeck } from './cabinLayout';
import React, { Suspense, useMemo, useRef } from 'react';
import { useGLTF } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { AssetBoundary } from './ReusableAsset';
import { extractSlipperModel, isSlipperMaterial } from './slipperModel';
import { ObjectHandle } from './ObjectHandle';
import { outfitHint, readOutfit } from './wardrobe/outfit';
import type { WorldModelProps } from '../../types/world';

interface HabitatShellProps {
  world: WorldModelProps;
  deck: CabinDeck;
  onFloorClick?: (point: [number, number, number]) => void;
}

const LOWER_PARTS = ['Duplex_LowerShell', 'Floor_Parquet', 'Stationery', 'Shelf_Gallery', 'Rugs'];
const UPPER_PARTS = ['Duplex_UpperShell', 'Floor_Parquet_Upper', 'Wardrobe_Nightstand', 'Rugs_Upper'];
const OBSERVATORY_PARTS = ['Shell', 'Floor_Parquet', 'Floor_Parquet_Upper'];

function CabinModel({ world, deck }: Pick<HabitatShellProps, 'world' | 'deck'>) {
  const variant = world.sceneId;
  const { scene } = useGLTF(`${import.meta.env.BASE_URL}models/cabin/open-cabin.glb`);
  const cabin = useMemo(() => {
    const names = variant === 'observatory' ? OBSERVATORY_PARTS : deck === 'upper' ? UPPER_PARTS : LOWER_PARTS;
    const shell = new THREE.Group();
    for (const name of names) {
      const source = scene.getObjectByName(name);
      if (source) shell.add(source.clone(true));
    }
    const slippers: THREE.Object3D[] = [];
    const remountSlippers = deck === 'upper' && variant === 'habitat' && !!extractSlipperModel(scene);
    shell.traverse(node => {
      if (!(node instanceof THREE.Mesh)) return;
      node.castShadow = node.receiveShadow = true;
      if (remountSlippers && isSlipperMaterial(node.material)) slippers.push(node);
    });
    slippers.forEach(node => node.removeFromParent());
    const wardrobe = shell.getObjectByName('Wardrobe_Nightstand');
    wardrobe?.removeFromParent();
    return { shell, wardrobe };
  }, [scene, variant, deck]);

  return <>
    <primitive object={cabin.shell} dispose={null} />
    {cabin.wardrobe && <ObjectHandle id="wardrobe" action="toggle" panorama world={world}
      hint={outfitHint(readOutfit(world.objects.wardrobe?.itemId))}
      acceptsHit={point => point.x <= WARDROBE_FOOTPRINT[1] + UPPER_DECK_OFFSET[0]}
      onClick={event => event.stopPropagation()}>
      <primitive object={cabin.wardrobe} dispose={null} />
    </ObjectHandle>}
  </>;
}

export function HabitatShell({ world, deck, onFloorClick }: HabitatShellProps) {
  const root = useRef<THREE.Group>(null);
  const floorPointer = useRef<number | null>(null);
  const left = deck === 'upper' || world.sceneId === 'observatory' ? CABIN_LEFT : CABIN_DIVIDER_X;
  const right = deck === 'upper' ? CABIN_DIVIDER_X : CABIN_RIGHT;
  const fallback = <mesh name="Floor_Parquet" position={[(left + right) / 2, -.12, 0]} receiveShadow>
    <boxGeometry args={[right - left, .24, 6.38]} /><meshStandardMaterial color="#cb9c74" />
  </mesh>;
  const onFloor = (event: ThreeEvent<MouseEvent>) => {
    const startedOnFloor = floorPointer.current !== null;
    floorPointer.current = null;
    event.stopPropagation();
    if (!startedOnFloor || event.delta > 5 || !root.current || !isFloor(event.object)) return;
    const point = root.current.worldToLocal(event.point.clone());
    onFloorClick?.([point.x, 0, point.z]);
  };
  return <group ref={root} name={`${world.sceneId}-${deck}-shell`}>
    <group onPointerDown={(event: ThreeEvent<PointerEvent>) => {
      event.stopPropagation();
      floorPointer.current = isFloor(event.object) ? event.pointerId : null;
    }} onPointerCancel={() => { floorPointer.current = null; }} onClick={onFloor}>
      <AssetBoundary fallback={fallback}><Suspense fallback={fallback}><CabinModel world={world} deck={deck} /></Suspense></AssetBoundary>
    </group>
  </group>;
}

function isFloor(node: THREE.Object3D) {
  for (let part: THREE.Object3D | null = node; part; part = part.parent) {
    if (part.name.startsWith('Floor_Parquet') || part.name.startsWith('Rugs')) return true;
  }
  return false;
}
