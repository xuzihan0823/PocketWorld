import { SuppliedAsset } from './SuppliedAsset';
import React from 'react';
import { LibraryBooks } from './library/LibraryBooks';
import { shelfOrigin } from './library/catalog';
import { CLOSED_OBJECT, type WorldModelProps } from '../../types/world';
import { ObjectHandle } from './ObjectHandle';
import { SoftBox, Tube } from './Primitives';
import { FurnitureMotion, FURNITURE as C } from './FurnitureParts';

export function FurnitureBookcase({ world, observatory = false }: { world: WorldModelProps; observatory?: boolean }) {
  const cabinet = world.objects.cabinet ?? CLOSED_OBJECT;
  const item = world.objects['cabinet-item'] ?? CLOSED_OBJECT;
  return <><LibraryBooks world={world} /><group position={shelfOrigin(observatory ? 'observatory' : 'habitat')} name="Furniture_OpenBookcase">
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
