import { SuppliedAsset } from './SuppliedAsset';
import React, { useEffect, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { LibraryBooks } from './library/LibraryBooks';
import { useSchedule } from './schedule/ScheduleContext';
import { upholstery } from './Materials';
import { CLOSED_OBJECT, type WorldModelProps } from '../../types/world';
import { ObjectHandle } from './ObjectHandle';
import { SoftBox, Tube } from './Primitives';
import { FurnitureMotion, FURNITURE as C, type FurnitureVector } from './FurnitureParts';

export function FurnitureBook({ world, id, position, rotation = [0, 0, 0], color = '#8b5744', kind = 'read', scale = 1 }: {
  world: WorldModelProps; id: string; position: FurnitureVector; rotation?: FurnitureVector; color?: string; kind?: 'read' | 'write' | 'plan'; scale?: number;
}) {
  const state = world.objects[id] ?? CLOSED_OBJECT;
  const notebook = useSchedule();
  const planner = kind === 'plan';
  const opened = state.open || state.active;
  const label = kind === 'write' ? '翻开日记 · 写下今天' : kind === 'plan' ? '展开日程 · 安排计划' : opened ? '翻动书页' : '取阅书籍';
  return <group position={position} rotation={rotation} scale={scale}>
    <ObjectHandle id={id} action={opened && kind === 'read' ? 'turn-page' : kind} hint={label} world={world} drag="x" payload={kind === 'read' && opened ? { direction: 1 } : undefined}>
      <SuppliedAsset name={planner ? "planner.parts" : "journal.parts"} part="body" size={[.36, .1125, .47]} fit="contact" position={[.18, 0, 0]} fallback={<>      <SoftBox dims={[0.36, 0.025, 0.47]} position={[0.18, 0.0125, 0]} radius={0.009} color={color} material={planner ? upholstery(color) : undefined} />
      <SoftBox dims={[0.325, 0.065, 0.435]} position={[0.185, 0.057, 0]} radius={0.006} color={C.paper} />
      {planner && Array.from({ length: 12 }, (_, i) => <SoftBox key={i} dims={[0.322, 0.0009, 0.433]} position={[0.185, 0.029 + i * 0.005, 0]} radius={0.0003} color={i % 3 === 0 ? '#bcb092' : '#d5c9ac'} />)}
      <SoftBox dims={[0.025, 0.11, 0.47]} position={[0, 0.055, 0]} radius={0.009} color={color} material={planner ? upholstery(color) : undefined} />
</>} />
      <FurnitureMotion axis="z" target={opened ? Math.PI * 0.94 : 0} reducedMotion={world.reducedMotion} position={[0, 0.1, 0]}>
        {/* The generated shell has no authored inner binding; retain a solid inner cover. */}
        <SoftBox dims={[0.35, 0.012, 0.46]} position={[0.18, -0.008, 0]} radius={0.005} color={planner ? '#8e6344' : '#637d67'} />
        <SuppliedAsset name={planner ? "planner.parts" : "journal.parts"} part="cover" size={[.36, .1125, .47]} fit="contact" position={[.18, -.1, 0]} fallback={<>        <SoftBox dims={[0.36, 0.025, 0.47]} position={[0.18, 0, 0]} radius={0.009} color={color} material={planner ? upholstery(color) : undefined} />
        <SoftBox dims={[0.24, 0.003, 0.34]} position={[0.18, 0.014, 0]} radius={0.001} color={kind === 'plan' ? '#b8c5ae' : '#be9c61'} />
        {[0, 1, 2].map(i => <SoftBox key={i} dims={[0.12 - i * 0.02, 0.002, 0.006]} position={[0.18, 0.016, -0.06 + i * 0.025]} radius={0.0005} color={C.edge} />)}
        {planner && <>
          <SoftBox dims={[0.325, 0.002, 0.433]} position={[0.18, -0.014, 0]} radius={0.002} color="#b7bfa5" material={upholstery('#b7bfa5')} />
          <SoftBox dims={[0.008, 0.002, 0.42]} position={[0.027, -0.016, 0]} radius={0.001} color="#71816b" />
          {[-0.195, 0.195].map(z => <Tube key={z} points={[[0.04, -0.016, z], [0.18, -0.016, z], [0.32, -0.016, z]]} radius={0.0008} color="#d7dcc1" />)}
        </>}
</>} />
      </FurnitureMotion>
      <FurnitureMotion axis="z" target={opened && !planner ? (state.page % 2 === 0 ? 0 : 2.92) : 0} reducedMotion={world.reducedMotion} position={[0.015, 0.095, 0]}>
        <SoftBox dims={[0.32, 0.004, 0.43]} position={[0.16, 0, 0]} radius={0.001} color="#fff3d6" />
      </FurnitureMotion>
      {planner && <ScheduleTurningLeaf pageId={notebook.state.current.id} reducedMotion={world.reducedMotion} />}
      {planner && <Tube points={[[0.013, 0.091, -0.205], [0.008, 0.093, 0], [0.013, 0.091, 0.205]]} radius={0.002} color="#c2b18e" />}
      <SoftBox dims={[0.024, 0.003, 0.13]} position={[0.27, 0.093, 0.22]} radius={0.001} color="#c5774b" />
    </ObjectHandle>
  </group>;
}

function ScheduleTurningLeaf({ pageId, reducedMotion }: { pageId: string; reducedMotion: boolean }) {
  const leaf = useRef<THREE.Group>(null);
  const previous = useRef(pageId);
  const elapsed = useRef(2);
  useEffect(() => {
    if (previous.current !== pageId) { elapsed.current = 0; previous.current = pageId; }
  }, [pageId]);
  useFrame((_, delta) => {
    if (!leaf.current) return;
    elapsed.current += Math.min(delta, 0.05);
    const t = Math.min(1, elapsed.current / 0.9);
    leaf.current.visible = !reducedMotion && t < 1;
    leaf.current.rotation.z = (1 - (1 - t) ** 3) * Math.PI;
  });
  return <group ref={leaf} position={[0.015, 0.101, 0]} visible={false}>
    <SoftBox dims={[0.32, 0.002, 0.43]} position={[0.16, 0, 0]} radius={0.0006} color="#f5ead0" />
  </group>;
}

export function FurnitureBookcase({ world, observatory = false }: { world: WorldModelProps; observatory?: boolean }) {
  const cabinet = world.objects.cabinet ?? CLOSED_OBJECT;
  const item = world.objects['cabinet-item'] ?? CLOSED_OBJECT;
  return <><LibraryBooks world={world} /><group position={observatory ? [-3.45, 0, -0.65] : [-3.45, 0, -1.9]} name="Furniture_OpenBookcase">
    <ObjectHandle id="book-01" action="inspect" hint="查看书柜 · 靠近按 E" world={world}>
    <SuppliedAsset name="cabinet.parts" part="body" size={[1.18, 1.59, .54]} fit="contact" fallback={<>    <SoftBox dims={[1.18, 0.08, 0.54]} position={[0, 0.12, 0]} color={C.edge} />
    {[-0.47, 0.47].flatMap(x => [-0.17, 0.17].map(z => <SoftBox key={`${x}/${z}`} dims={[0.09, 0.1, 0.09]} position={[x, 0.05, z]} color={C.edge} radius={0.012} />))}
    <SoftBox dims={[1.18, 0.08, 0.54]} position={[0, 1.55, 0]} color={C.wood} />
    {[-0.55, 0.55].map(x => <SoftBox key={x} dims={[0.08, 1.42, 0.54]} position={[x, .83, 0]} color={C.wood} />)}
    <SoftBox dims={[1.08, 1.42, 0.035]} position={[0, .83, -0.255]} color="#8a654b" />
    {[0.64, .93, 1.22].map(y => <SoftBox key={y} dims={[1.08, 0.055, 0.52]} position={[0, y, 0]} color={C.wood} />)}
</>} />
    </ObjectHandle>
    {/* Retain the original functional cavity: the supplied closed shell has no interior. */}
    <SoftBox dims={[1.08, .45, .025]} position={[0, .38, -.255]} color="#8a654b" />
    <SoftBox dims={[1.08, .04, .52]} position={[0, .14, 0]} color={C.wood} />
    {[-.535,.535].map(x => <SoftBox key={x} dims={[.03,.45,.50]} position={[x,.38,0]} color={C.wood} />)}
    <ObjectHandle id="cabinet" action={cabinet.open ? 'close' : 'open'} hint={cabinet.open ? '关上柜门' : '拉开柜门'} world={world} drag="x">
      <FurnitureMotion target={cabinet.open ? -1.75 : 0} reducedMotion={world.reducedMotion} position={[-0.52, 0.38, 0.286]}>
        <SoftBox dims={[1.04, .45, .025]} position={[.52, 0, -.025]} color={C.wood} />
        <SuppliedAsset name="cabinet.parts" part="door" size={[1.18, 1.59, .54]} fit="contact" position={[.52, -.38, -.286]} fallback={<>        <SoftBox dims={[1.04, 0.45, 0.045]} position={[0.52, 0, 0]} color={C.wood} />
        <Tube points={[[0.9, -0.06, 0.03], [0.9, -0.06, 0.07], [0.9, 0.06, 0.07], [0.9, 0.06, 0.03]]} radius={0.012} color={C.brass} />
</>} />
        {[-0.13, 0.13].map(y => <mesh key={y} position={[0, y, -0.01]} castShadow><cylinderGeometry args={[0.018, 0.018, 0.06, 12]} /><meshStandardMaterial color={C.brass} metalness={0.6} roughness={0.4} /></mesh>)}
      </FurnitureMotion>
    </ObjectHandle>
    <ObjectHandle id="cabinet-item" action={item.active ? 'eject' : 'select'} hint={item.active ? '放回收纳盒' : '取出收纳盒'} world={world} drag="z" payload={{ itemId: 'storage-box' }}>
      <FurnitureMotion mode="position" axis="z" target={item.active ? 0.62 : 0} reducedMotion={world.reducedMotion}>
        <SuppliedAsset name="storage-box" size={[.36, .2675, .36]} fit="contact" position={[-.2, .16, 0]} fallback={<>        <SoftBox dims={[0.34, 0.23, 0.34]} position={[-0.2, 0.275, 0]} color="#8a9b8f" />
        <SoftBox dims={[0.36, 0.035, 0.36]} position={[-0.2, 0.405, 0]} color="#acb7a3" radius={0.012} />
</>} />
      </FurnitureMotion>
    </ObjectHandle>
  </group></>;
}
