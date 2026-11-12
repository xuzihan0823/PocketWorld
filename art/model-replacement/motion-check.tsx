import React, { Suspense, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { HabitatFurniture } from '../../src/scene/orbital/HabitatFurniture';
import { ScheduleProvider } from '../../src/scene/orbital/schedule/ScheduleContext';
import { CHAIR_POSES } from '../../src/scene/orbital/chairPose';
import { CLOSED_OBJECT, type WorldModelProps } from '../../src/types/world';
import { SuppliedAsset } from '../../src/scene/orbital/SuppliedAsset';
import { FurnitureBookcase } from '../../src/scene/orbital/FurnitureBooks';
import { FurnitureDesk } from '../../src/scene/orbital/FurnitureDesk';
const views = {
  Room: { position: [9,7,10], target: [0,.7,0] },
  Desk: { position: [2.5,2.6,.8], target: [1,1,-2.3] },
  Cabinet: { position: [-2.2,1.8,.4], target: [-3.45,.75,-1.9] },
  Chair: { position: [3,1.8,1], target: [1.45,.55,-.85] },
  Lounge: { position: [.1,1.8,2.5], target: [-1.65,.6,.75] },
  Lamp: { position: [.7,2.2,.2], target: [-.9,1.25,-2.85] },
};
function Review() {
  const [open,setOpen]=useState(false), [sceneId,setScene]=useState<'habitat'|'observatory'>('habitat');
  const [view,setView]=useState<keyof typeof views>('Room');
  const [failed,setFailed]=useState(false);
  const [drop,setDrop]=useState(false);
  CHAIR_POSES[sceneId].drop=drop?1:0;
  const world:WorldModelProps={sceneId,books:[],focusedObject:null,reducedMotion:false,
    objects:Object.fromEntries(['cabinet','desk-drawer','journal','schedule','cabinet-item','lamp','bed','chair'].map(id=>[id,{...CLOSED_OBJECT,open,active:open}])),
    onAction:()=>setOpen(v=>!v),onHover:()=>{},onGesture:()=>{}};
  return <><nav style={{padding:10,background:'#eee',display:'flex',gap:10}}>
    {Object.keys(views).map(v=><button key={v} onClick={()=>setView(v as keyof typeof views)}>{v}</button>)}
    <button onClick={()=>setOpen(!open)}>{open?'Close all':'Open all'}</button>
    <button onClick={()=>setScene(sceneId==='habitat'?'observatory':'habitat')}>{sceneId}</button>
    <button onClick={()=>setDrop(!drop)}>Seat drop {drop?'on':'off'}</button>
    <button onClick={()=>setFailed(!failed)}>Missing asset fallback</button>
  </nav><div style={{height:'calc(100vh - 64px)'}}><Canvas key={view} camera={{position:views[view].position as [number,number,number],fov:38}} shadows>
    <color attach="background" args={['#58616a']} /><ambientLight intensity={1.7}/><directionalLight position={[2,6,4]} intensity={3} castShadow/>
    <ScheduleProvider><Suspense fallback={null}>{view==='Cabinet'?<FurnitureBookcase world={world}/>:view==='Desk'?<FurnitureDesk world={world}/>:<HabitatFurniture {...world}/>}</Suspense></ScheduleProvider>
    {failed&&<SuppliedAsset name="intentional-missing-test" size={[1,1,1]} fallback={<mesh position={[0,1,0]}><boxGeometry/><meshStandardMaterial color="#ff8040"/></mesh>}/>}
    <gridHelper args={[10,20]}/><OrbitControls target={views[view].target as [number,number,number]}/>
  </Canvas></div></>;
}
createRoot(document.getElementById('root')!).render(<Review/>);
