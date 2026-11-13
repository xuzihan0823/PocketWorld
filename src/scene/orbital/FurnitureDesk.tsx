import { SuppliedAsset } from './SuppliedAsset';
import React from 'react';
import { CLOSED_OBJECT, type WorldModelProps } from '../../types/world';
import { ObjectHandle } from './ObjectHandle';
import { SoftBox, Tube } from './Primitives';
import { ReactiveKeyboard } from './media/ReactiveKeyboard';
import { FurnitureCylinder as Cylinder, FurnitureMotion, FURNITURE as C } from './FurnitureParts';
import { ScheduleBook } from './FurnitureBooks';
import { DRAWER_TRAVEL } from './drawerInteraction';

function FurnitureComputer({ world }: { world: WorldModelProps }) {
  const state = world.objects.computer ?? CLOSED_OBJECT;
  return <ObjectHandle id="computer" action="inspect" hint="打开电脑 · 游戏与终端" world={world} position={[1.55, 1.12, -2.6]}>
    <SuppliedAsset name="computer.fitted" size={[1.25, 1.05, .65]} fit="contact" position={[0, 0, -.07]} fallback={<>    <SoftBox dims={[0.55, 0.065, 0.42]} position={[0, 0.0325, 0.01]} color="#c2c0aa" radius={0.045} />
    <Cylinder radius={0.12} height={0.09} position={[0, 0.1, -0.04]} color="#aeae9b" />
    <SoftBox dims={[1.15, 0.91, 0.57]} position={[0, 0.55, -0.08]} radius={0.085} color="#ddd9bf" />
    <SoftBox dims={[1.03, 0.8, 0.06]} position={[0, 0.56, 0.207]} radius={0.045} color="#92998a" />
    <SoftBox dims={[0.94, 0.71, 0.02]} position={[0, 0.56, 0.235]} radius={0.025} color="#243e3d">
      <meshStandardMaterial color={state.active ? '#507f73' : '#243e3d'} emissive="#76b5a1" emissiveIntensity={state.active ? 0.25 : 0.08} roughness={0.24} />
    </SoftBox>
    <Cylinder radius={0.015} height={0.009} position={[0.46, 0.15, 0.216]} rotation={[Math.PI / 2, 0, 0]} color="#78a884" />
    {Array.from({ length: 8 }, (_, i) => <SoftBox key={i} dims={[0.003, 0.012, 0.22]} position={[0.576, 0.39 + i * 0.035, -0.11]} color="#a9aa97" radius={0.001} />)}
</>} />
    <group position={[0, 0.045, 0.62]} rotation={[0.06, 0, 0]}>
      <SoftBox dims={[0.80, 0.06, 0.36]} position={[0, 0.004, -0.012]} color="#d1cdb5" radius={0.022} />
      <ReactiveKeyboard reducedMotion={world.reducedMotion} active={world.focusedObject === 'computer'} />
    </group>
    <Tube points={[[0.2, 0.03, 0.59], [0.36, 0.025, 0.47], [0.33, 0.025, 0.25], [0.1, 0.08, -0.24]]} radius={0.008} color={C.ink} />
  </ObjectHandle>;
}

export function FurnitureDesk({ world }: { world: WorldModelProps }) {
  const drawer = world.objects['desk-drawer'] ?? CLOSED_OBJECT;
  return <group name="Furniture_Workbench">
    <SuppliedAsset name="desk.parts" part="body" size={[3.8, 1.12, 1.35]} fit="contact" position={[1.05, 0, -2.35]} fallback={<>    <SoftBox dims={[3.8, 0.12, 1.35]} position={[1.05, 1.06, -2.35]} color={C.wood} radius={0.045} />
    <SoftBox dims={[3.62, 0.07, 0.055]} position={[1.05, 1.155, -2.98]} color={C.edge} radius={0.012} />
    {[-0.67, 2.77].flatMap(x => [-2.84, -1.86].map(z => <SoftBox key={`${x}/${z}`} dims={[0.09, 1, 0.09]} position={[x, 0.5, z]} color={C.ink} radius={0.018} />))}
    <SoftBox dims={[3.45, 0.09, 0.08]} position={[1.05, 0.23, -2.82]} color={C.ink} />
    {[-0.67, 2.77].map(x => <SoftBox key={x} dims={[0.07, 0.06, 1.04]} position={[x, 0.23, -2.35]} color={C.ink} />)}
    <SoftBox dims={[1.1, 0.28, 0.055]} position={[0.35, 0.85, -2.77]} color={C.edge} />
    {[-0.21, 0.91].map(x => <group key={x}>
      <SoftBox dims={[0.045, 0.29, 0.96]} position={[x, 0.85, -2.27]} color={C.edge} />
      <SoftBox dims={[0.018, 0.035, 0.84]} position={[x + (x < 0 ? 0.03 : -0.03), 0.78, -2.2]} color="#a5a49b" metalness={0.6} />
    </group>)}
</>} />
    <ObjectHandle id="desk-drawer" action={drawer.open ? 'close' : 'open'} hint={drawer.open ? '靠近抽屉 · 点击 / E 推回' : '靠近抽屉 · 点击 / E 后退拉开'} world={world}>
      <FurnitureMotion mode="position" axis="z" target={drawer.open ? DRAWER_TRAVEL : 0} reducedMotion={world.reducedMotion}>
        {/* Keep the open drawer's lining; generated source only supplies its closed outer shell. */}
        <SoftBox dims={[1.02, .035, .88]} position={[.35, .725, -2.15]} color="#bc996b" />
        {[-.145, .845].map(x => <SoftBox key={x} dims={[.035, .21, .87]} position={[x, .83, -2.15]} color="#bd9668" />)}
        <SoftBox dims={[1.02, .21, .035]} position={[.35, .83, -2.575]} color="#bd9668" />
        <SuppliedAsset name="desk.parts" part="drawer" partBounds size={[1.08, .28, .96]} fit="contact" position={[.35, .71, -2.15]} fallback={<>        <SoftBox dims={[1.08, 0.28, 0.065]} position={[0.35, 0.85, -1.69]} color={C.wood} radius={0.018} />
        <SoftBox dims={[1.02, 0.035, 0.88]} position={[0.35, 0.725, -2.15]} color="#bc996b" />
        {[-0.145, 0.845].map(x => <SoftBox key={x} dims={[0.035, 0.21, 0.87]} position={[x, 0.83, -2.15]} color="#bd9668" />)}
        <SoftBox dims={[1.02, 0.21, 0.035]} position={[0.35, 0.83, -2.575]} color="#bd9668" />
        <Tube points={[[0.19, 0.87, -1.65], [0.19, 0.87, -1.59], [0.51, 0.87, -1.59], [0.51, 0.87, -1.65]]} radius={0.015} color={C.brass} />
</>} />
        <SoftBox dims={[0.31, 0.025, 0.4]} position={[0.19, 0.76, -2.12]} color={C.paper} />
      </FurnitureMotion>
    </ObjectHandle>
    <FurnitureComputer world={world} />
    <ScheduleBook world={world} position={[0.55, 1.121, -1.96]} color="#7b9184" scale={0.76} rotation={[0, 0.08, 0]} />
  </group>;
}
