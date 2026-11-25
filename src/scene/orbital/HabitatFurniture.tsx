import { BED_POSITION, LAMP_POSITION, PLANT_POSITION, TRASH_CAN } from './cabinLayout';
import React, { Suspense, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { CLOSED_OBJECT, type WorldModelProps } from '../../types/world';
import { ObjectHandle } from './ObjectHandle';
import { SoftBox, Tube } from './Primitives';
import { FurnitureCylinder as Cylinder, FurnitureOrb as Orb, FurnitureMotion, FurnitureCushion, FURNITURE as C } from './FurnitureParts';
import { FurnitureDesk } from './FurnitureDesk';
import { FurnitureBookcase } from './FurnitureBooks';
import { SuppliedAsset } from './SuppliedAsset';
import { Bedding } from './Bedding';
import { FloorSofa } from './FloorSofa';
import { AssetBoundary, ReusableAsset } from './ReusableAsset';
import { cloneSuppliedModel } from './supplied-model';
import { CHAIR_POSES } from './chairPose';

function FurnitureBed() {
  return <group position={BED_POSITION}>
    <SuppliedAsset name="bed" size={[1.72, 1.4, 2.6]} fit="contact" fallback={<>    {[-0.64, 0.64].flatMap(x => [-1.06, 1.06].map(z => <SoftBox key={`${x}/${z}`} dims={[0.1, 0.32, 0.1]} position={[x, 0.16, z]} color={C.edge} />))}
    <SoftBox dims={[1.7, 0.19, 2.6]} position={[0, 0.365, 0]} color={C.wood} radius={0.04} />
    <SoftBox dims={[1.6, 0.25, 2.5]} position={[0, 0.595, 0]} color="#e5decb" radius={0.105} />
    <SoftBox dims={[1.72, 0.85, 0.11]} position={[0, 0.635, -1.27]} color={C.wood} radius={0.055} />
    <SoftBox dims={[1.52, 0.44, 0.08]} position={[0, 0.76, -1.2]} color="#96aaa0" radius={0.07} />
    <Bedding />
</>} />
  </group>;
}

function FixedChairModel() {
  const { scene } = useGLTF(import.meta.env.BASE_URL + 'models/furniture/fixed-desk-chair.glb');
  const model = useMemo(() => cloneSuppliedModel(scene), [scene]);
  return <primitive object={model} dispose={null} />;
}

function FurnitureChair({ world }: { world: WorldModelProps }) {
  const state = world.objects.chair ?? CLOSED_OBJECT;
  const { x, z, yaw } = CHAIR_POSES[world.sceneId];
  const fallback = <>
    {[-1, 1].flatMap(side => [-1, 1].map(end => <SoftBox key={side + '/' + end}
      dims={[.07, .42, .075]} position={[side * .31, .21, end * .24 + .035]}
      color="#6c4936" rotation={[end * .15, 0, side * .15]} />))}
    <SoftBox dims={[.68, .065, .62]} position={[0, .421, .062]} color="#80583e" />
    <FurnitureCushion dims={[.65, .12, .61]} position={[0, .47, .061]} color="#cbbba1" />
    <SoftBox dims={[.64, .64, .09]} position={[0, .81, -.28]} rotation={[-.29, 0, 0]} color="#80523c" />
    {[-.38, .38].map(side => <group key={side}>
      <SoftBox dims={[.05, .32, .07]} position={[side, .60, -.13]} color="#6c4936" />
      <SoftBox dims={[.11, .04, .44]} position={[side, .766, .065]} color="#cbbba1" />
    </group>)}
  </>;
  return <ObjectHandle id="chair" action={state.active ? 'stand' : 'sit'} panorama hint={state.active ? '起身' : '坐下歇一会'}
    world={world} position={[x, 0, z]} rotation={[0, yaw, 0]}>
    {world.sceneId === 'habitat' ? <AssetBoundary fallback={fallback}><Suspense fallback={fallback}><FixedChairModel /></Suspense></AssetBoundary> : <>
      <SuppliedAsset name="lounge-chair.parts" part="base" size={[1.04, 1.40, 1]} fit="contact" rotation={[0, .2, 0]}
        fallback={[-.39, .39].flatMap(x => [-.36, .36].map(z => <SoftBox key={x + '/' + z} dims={[.08, .49, .08]} position={[x, .255, z]} color={C.edge} rotation={[0, 0, -x * .12]} />))} />
      <SuppliedAsset name="lounge-chair.parts" part="seat" size={[1.04, 1.40, 1]} fit="contact"
        fallback={<group rotation={[0, Math.PI, 0]}>
          <SoftBox dims={[1.04, .18, 1]} position={[0, .54, 0]} color={C.edge} radius={.07} />
          <FurnitureCushion dims={[.94, .24, .9]} position={[0, .65, 0]} color="#bc9770" />
          <FurnitureCushion dims={[1.02, .24, .72]} position={[0, 1.03, .35]} rotation={[Math.PI / 2 - .12, 0, 0]} color="#bc9770" />
          {[-1, 1].map(side => <group key={side}>
            <Tube points={[[side * .29, .56, .22], [side * .30, .82, .35], [side * .29, 1.15, .35]]} radius={.026} color={C.ink} />
            <Tube points={[[side * .38, .55, -.22], [side * .41, .84, -.2], [side * .41, .88, .24], [side * .34, .59, .29]]} radius={.025} color={C.ink} />
            <SoftBox dims={[.17, .07, .52]} position={[side * .48, .89, .02]} color="#bc9770" radius={.035} />
          </group>)}
        </group>} />
    </>}
  </ObjectHandle>;
}

function FurnitureLamp({ world }: { world: WorldModelProps }) {
  const state = world.objects.lamp ?? CLOSED_OBJECT;
  const bedside = world.sceneId === 'habitat';
  return <ObjectHandle id="lamp" action="toggle" panoramaOnly hint={state.active ? '轻触台灯 · 关灯' : '轻触台灯 · 开灯'} world={world}
    position={bedside ? LAMP_POSITION : [-1.1, 0, -2.85]} scale={bedside ? .48 : 1}>
    <mesh position={[.22, 1.02, 0]}><boxGeometry args={[.82, 2.12, .52]} /><meshBasicMaterial visible={false} /></mesh>
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
  </ObjectHandle>;
}

function FurniturePlant({ observatory }: { observatory: boolean }) {
  return <group position={observatory ? [2.75, 0, 1.85] : PLANT_POSITION}>
    <SuppliedAsset name="plant" loadingFallback={null} size={observatory ? [1, 1.02, 1] : [.54, .88, .54]} fallback={<ReusableAsset path="plants/potted_plant_04.glb" height={observatory ? 1.02 : 0.85} />} />
  </group>;
}

function FurnitureHatch() {
  return <group position={[3.98, 0, -1.6]} rotation={[0, -Math.PI / 2, 0]} name="Furniture_Hatch">
    <SuppliedAsset name="hatch" size={[1.58, 2.89, .23]} fit="contact" fallback={<>    {[-0.57, 0.57].map(x => <SoftBox key={x} dims={[0.12, 2.35, 0.18]} position={[x, 1.175, 0]} color="#6f8986" radius={0.06} />)}
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

export function HabitatBedroom({ world, sofaTime }: { world: WorldModelProps; sofaTime: React.RefObject<number | null> }) {
  return <>
    <FurnitureBed />
    <ObjectHandle id="sofa" panorama onClick={event => event.stopPropagation()} action={world.objects.sofa?.active ? 'stand' : 'sit'}
      hint={world.objects.sofa?.active ? '起身' : '坐进懒人沙发'} world={world}>
      <AssetBoundary><Suspense fallback={null}><FloorSofa sample={sofaTime} /></Suspense></AssetBoundary>
    </ObjectHandle>
    <FurnitureLamp world={world} />
    <FurniturePlant observatory={false} />
  </>;
}

export const HabitatFurniture: React.FC<WorldModelProps> = world => {
  const observatory = world.sceneId === 'observatory';
  return <group name={`Furniture_${world.sceneId}`}>
    <FurnitureDesk world={world} />
    <FurnitureBookcase world={world} />
    {observatory ? <>
      <SoftBox dims={[2.9, 0.025, 2.2]} position={[-1.5, 0.013, 0.8]} radius={0.01} color="#748f8a" />
      <FurnitureChair world={world} />
      <ReusableAsset path="furniture/throw_pillows_01.glb" width={0.52} position={[-1.65, 0.76, 0.9]} rotation={[0, 0.42, 0]} />
      <group position={[-0.25, 0, 0.85]}>
        <Cylinder radius={0.4} height={0.075} position={[0, 0.64, 0]} color={C.wood} />
        <Cylinder radius={0.045} height={0.59} position={[0, 0.31, 0]} color={C.brass} />
        <Cylinder radius={0.25} height={0.035} position={[0, 0.018, 0]} color={C.ink} />
      </group>
    </> : <>
      <FurnitureChair world={world} />
      <ReusableAsset name="Furniture_TrashCan" path="furniture/trash-can.glb"
        height={TRASH_CAN.height} position={TRASH_CAN.position} rotation={[0, TRASH_CAN.yaw, 0]} />
    </>}
    {observatory && <><FurnitureLamp world={world} /><FurniturePlant observatory /></>}
    <FurnitureHatch />
  </group>;
};
