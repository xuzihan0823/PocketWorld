import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CLOSED_OBJECT, type WorldModelProps } from '../../types/world';
import { ObjectHandle } from './ObjectHandle';
import { SoftBox, Tube } from './Primitives';
import { FurnitureCylinder as Cylinder, FurnitureOrb as Orb, FurnitureMotion, FurnitureCushion, FURNITURE as C } from './FurnitureParts';
import { FurnitureDesk } from './FurnitureDesk';
import { FurnitureBookcase } from './FurnitureBooks';
import { SuppliedAsset } from './SuppliedAsset';
import { Bedding } from './Bedding';
import { ReusableAsset } from './ReusableAsset';
import { CHAIR_POSES, SEAT_DROP, SEAT_SWIVEL } from './chairPose';

function FurnitureBed({ world }: { world: WorldModelProps }) {
  const state = world.objects.bed ?? CLOSED_OBJECT;
  return <ObjectHandle id="bed" action={state.active ? 'wake' : 'sleep'} hint={state.active ? '醒来 · 离开被窝' : '躺下休息'} world={world} position={[-2.6, 0, 1]}>
    <SuppliedAsset name="bed" size={[1.72, 1.4, 2.6]} fit="contact" fallback={<>    {[-0.64, 0.64].flatMap(x => [-1.06, 1.06].map(z => <SoftBox key={`${x}/${z}`} dims={[0.1, 0.32, 0.1]} position={[x, 0.16, z]} color={C.edge} />))}
    <SoftBox dims={[1.7, 0.19, 2.6]} position={[0, 0.365, 0]} color={C.wood} radius={0.04} />
    <SoftBox dims={[1.6, 0.25, 2.5]} position={[0, 0.595, 0]} color="#e5decb" radius={0.105} />
    <SoftBox dims={[1.72, 0.85, 0.11]} position={[0, 0.635, -1.27]} color={C.wood} radius={0.055} />
    <SoftBox dims={[1.52, 0.44, 0.08]} position={[0, 0.76, -1.2]} color="#96aaa0" radius={0.07} />
    <Bedding />
</>} />
  </ObjectHandle>;
}

function FurnitureChair({ world, lounge = false }: { world: WorldModelProps; lounge?: boolean }) {
  const state = world.objects.chair ?? CLOSED_OBJECT;
  const rig = useRef<THREE.Group>(null);
  const seat = useRef<THREE.Group>(null);
  useFrame(() => {
    const pose = CHAIR_POSES[world.sceneId];
    rig.current?.position.set(pose.x, 0, pose.z);
    if (rig.current) rig.current.rotation.y = pose.yaw;
    if (seat.current) seat.current.position.y = -pose.drop * SEAT_DROP;
  });
  return <ObjectHandle id="chair" action={state.active ? 'stand' : 'sit'} hint={state.active ? (lounge ? '起身' : '起身 · WASD 蹬地滑行') : '坐下歇一会'} world={world}><group ref={rig}>
    <SuppliedAsset name={lounge ? "lounge-chair.parts" : "rolling-chair.parts"} part="base" size={lounge ? [1.04, 1.40, 1] : [.90, 1.40, .90]} fit="contact" rotation={[0, Math.PI, 0]} fallback={<>    {lounge ? [-0.39, 0.39].flatMap(x => [-0.36, 0.36].map(z => <SoftBox key={`${x}/${z}`} dims={[0.08, 0.49, 0.08]} position={[x, 0.255, z]} color={C.edge} rotation={[0, 0, -x * 0.12]} />)) : <>
      <Cylinder radius={0.06} height={0.12} position={[0, 0.15, 0]} color="#9b9e94" metalness={0.7} />
      {[0, 1, 2, 3, 4].map(i => <group key={i} rotation={[0, i * Math.PI * 2 / 5, 0]}>
        <SoftBox dims={[0.075, 0.065, 0.46]} position={[0, 0.13, 0.2]} rotation={[0.08, 0, 0]} color={C.ink} />
        <Cylinder radius={0.065} height={0.085} position={[0, 0.065, 0.43]} rotation={[0, 0, Math.PI / 2]} color={C.dark} />
      </group>)}
    </>}
</>} />
    <group ref={seat}>

      <FurnitureMotion target={SEAT_SWIVEL} reducedMotion={world.reducedMotion}>
        <SuppliedAsset name={lounge ? "lounge-chair.parts" : "rolling-chair.parts"} part="seat" size={lounge ? [1.04, 1.40, 1] : [.90, 1.40, .90]} fit="contact" rotation={[0, Math.PI, 0]} fallback={<>{!lounge && <Cylinder radius={0.042} height={0.3} position={[0, 0.325, 0]} color="#b9bbb2" metalness={0.8} />}        <SoftBox dims={lounge ? [1.04, 0.18, 1.0] : [0.77, 0.13, 0.75]} position={[0, 0.54, 0]} color={C.edge} radius={0.07} />
        <FurnitureCushion dims={lounge ? [0.94, 0.24, 0.9] : [0.74, 0.18, 0.71]} position={[0, 0.65, 0]} color={lounge ? '#bc9770' : C.cloth} />
        <Tube points={[[-0.29, 0.56, 0.22], [-0.3, 0.82, 0.35], [-0.29, 1.15, 0.35]]} radius={0.026} color={C.ink} />
        <Tube points={[[0.29, 0.56, 0.22], [0.3, 0.82, 0.35], [0.29, 1.15, 0.35]]} radius={0.026} color={C.ink} />
        <FurnitureCushion dims={lounge ? [1.02, 0.24, 0.72] : [0.76, 0.19, 0.53]} position={[0, lounge ? 1.03 : 1.07, 0.35]} rotation={[Math.PI / 2 - 0.12, 0, 0]} color={lounge ? '#bc9770' : C.cloth} />
        {[-1, 1].map(side => <group key={side}>
          <Tube points={[[side * 0.38, 0.55, -0.22], [side * 0.41, 0.84, -0.2], [side * 0.41, 0.88, 0.24], [side * 0.34, 0.59, 0.29]]} radius={0.025} color={C.ink} />
          <SoftBox dims={[lounge ? 0.17 : 0.1, 0.07, 0.52]} position={[side * (lounge ? 0.48 : 0.41), 0.89, 0.02]} color={lounge ? '#bc9770' : C.edge} radius={0.035} />
        </group>)}
</>} />
      </FurnitureMotion>
    </group>
  </group></ObjectHandle>;
}

function FurnitureLamp({ world }: { world: WorldModelProps }) {
  const state = world.objects.lamp ?? CLOSED_OBJECT;
  return <group position={[-1.1, 0, -2.85]}>
    <SuppliedAsset name="lamp.parts" part="body" size={[.72, 2.02, .48]} fit="contact" position={[.22, 0, 0]} rotation={[0, Math.PI, 0]} fallback={<>    <Cylinder radius={0.23} height={0.065} position={[0, 0.0325, 0]} color={C.ink} />
    <Tube points={[[0, 0.06, 0], [0, 1.5, 0], [0.03, 1.88, 0], [0.22, 2.01, 0], [0.37, 1.97, 0]]} radius={0.022} color={C.brass} />
    <mesh position={[0.37, 1.8, 0]} castShadow><cylinderGeometry args={[0.13, 0.26, 0.32, 32, 1, true]} /><meshStandardMaterial color="#ecd8a3" roughness={0.8} side={2} /></mesh>
</>} />
    <Orb position={[0.37, 1.76, 0]} scale={[0.06, 0.09, 0.06]} color={state.active ? '#fff4cd' : '#c9b988'} />
    {state.active && <pointLight position={[0.37, 1.66, 0]} color="#ffd59b" intensity={1.7} distance={3.5} decay={2} />}
    <ObjectHandle id="lamp" action="toggle" hint="拉动灯绳 · 开关台灯" world={world} drag="y">
      <FurnitureMotion mode="position" target={state.active ? -0.035 : 0} reducedMotion={world.reducedMotion}>
        <Tube points={[[0.55, 1.85, 0], [0.55, 1.56, 0], [0.55, 1.4, 0]]} radius={0.008} color={C.brass} />
        <Orb position={[0.55, 1.39, 0]} scale={[0.029, 0.05, 0.029]} color={C.edge} />
      </FurnitureMotion>
    </ObjectHandle>
  </group>;
}

function FurniturePlant({ world, observatory }: { world: WorldModelProps; observatory: boolean }) {
  const state = world.objects.plant ?? CLOSED_OBJECT;
  return <ObjectHandle id="plant" action="water" hint="照料盆栽 · 浇水" world={world} position={observatory ? [2.75, 0, 1.85] : [-3.55, 0, 2.55]}>
    <SuppliedAsset name="plant" size={[1, observatory ? 1.02 : .85, 1]} fallback={<ReusableAsset path="plants/potted_plant_04.glb" height={observatory ? 1.02 : 0.85} />} />
    {state.value > 0 && <Orb position={[0.03, 0.31, 0.02]} scale={[0.028, 0.012, 0.028]} color="#83b9b1" />}
  </ObjectHandle>;
}

function FurnitureHatch() {
  return <group position={[4.28, 0, -1.6]} rotation={[0, -Math.PI / 2, 0]} name="Furniture_Hatch">
    <SuppliedAsset name="hatch" size={[1.22, 2.38, .23]} fit="contact" fallback={<>    {[-0.57, 0.57].map(x => <SoftBox key={x} dims={[0.12, 2.35, 0.18]} position={[x, 1.175, 0]} color="#6f8986" radius={0.06} />)}
    <SoftBox dims={[1.22, 0.13, 0.18]} position={[0, 2.32, 0]} color="#6f8986" radius={0.055} />
    <SoftBox dims={[1.2, 0.055, 0.23]} position={[0, 0.0275, 0]} color={C.brass} radius={0.02} />
    <group position={[0, 1.16, 0]}>
      <SoftBox dims={[1.01, 2.19, 0.1]} color="#abc2b5" radius={0.09} />
      <SoftBox dims={[0.81, 1.92, 0.025]} position={[0, 0, 0.06]} color="#c5d2bd" radius={0.09} />
      <Cylinder radius={0.255} height={0.045} position={[0, 0.47, 0.09]} rotation={[Math.PI / 2, 0, 0]} color={C.brass} metalness={0.5} />
      <Cylinder radius={0.208} height={0.05} position={[0, 0.47, 0.115]} rotation={[Math.PI / 2, 0, 0]} color="#3e686d" />
      <Tube points={[[0.36, -0.25, 0.08], [0.36, -0.25, 0.17], [0.36, 0.04, 0.17], [0.36, 0.04, 0.08]]} radius={0.025} color={C.brass} />
      {[-0.8, 0.8].map(y => <Cylinder key={y} radius={0.035} height={0.17} position={[-0.5, y, 0.03]} color={C.brass} metalness={0.6} />)}
    </group>
</>} />
  </group>;
}

export const HabitatFurniture: React.FC<WorldModelProps> = world => {
  const observatory = world.sceneId === 'observatory';
  return <group name={`Furniture_${world.sceneId}`}>
    <FurnitureDesk world={world} />
    <FurnitureBookcase world={world} observatory={observatory} />
    {observatory ? <>
      <SoftBox dims={[2.9, 0.025, 2.2]} position={[-1.5, 0.013, 0.8]} radius={0.01} color="#748f8a" />
      <FurnitureChair world={world} lounge />
      <ReusableAsset path="furniture/throw_pillows_01.glb" width={0.52} position={[-1.65, 0.76, 0.9]} rotation={[0, 0.42, 0]} />
      <group position={[-0.25, 0, 0.85]}>
        <Cylinder radius={0.4} height={0.075} position={[0, 0.64, 0]} color={C.wood} />
        <Cylinder radius={0.045} height={0.59} position={[0, 0.31, 0]} color={C.brass} />
        <Cylinder radius={0.25} height={0.035} position={[0, 0.018, 0]} color={C.ink} />
      </group>
    </> : <><FurnitureBed world={world} /><FurnitureChair world={world} /></>}
    <FurnitureLamp world={world} />
    <FurniturePlant world={world} observatory={observatory} />
    <FurnitureHatch />
  </group>;
};
