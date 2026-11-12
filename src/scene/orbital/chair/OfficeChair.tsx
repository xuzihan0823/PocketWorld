import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group } from 'three';
import type { WorldModelProps } from '../../../types/world';
import { ObjectHandle } from '../ObjectHandle';
import { SoftBox, Tube } from '../Primitives';
import { FurnitureCylinder as Cylinder } from '../FurnitureParts';
import { CHAIR_POSES, chairFacing } from '../chairPose';
import { OFFICE_CHAIR as C } from './ChairSeating';

/** The cushion top is the contact plane; the five casters have separate swivel/axle pivots. */
export function OfficeChair({ world }: { world: WorldModelProps }) {
  const rig = useRef<Group>(null);
  useFrame(() => {
    const p = CHAIR_POSES[world.sceneId];
    rig.current?.position.set(p.x, 0, p.z);
    if (rig.current) rig.current.rotation.y = chairFacing(p);
  });
  const active = world.objects.chair?.active;
  return <ObjectHandle id="chair" action={active ? 'stand' : 'sit'} hint={active ? 'E · 自然起身' : '坐下歇一会'} world={world}>
    <group ref={rig} name="OfficeChair">
      {[0, 1, 2, 3, 4].map(i => <group key={i} name={`CasterArm_${i}`} rotation={[0, (i + .5) * Math.PI * 2 / 5, 0]}>
        <Tube points={[[0, .16, 0], [0, .13, .15], [0, .09, .30]]} radius={.024} color="#3d5156" />
        <group name={`CasterPivot_${i}`} position={[0, .065, .30]}>
          <Cylinder radius={.018} height={.065} position={[0, .025, 0]} color="#a5b1ae" metalness={.8} />
          <SoftBox dims={[.068, .032, .055]} position={[0, .009, .018]} color="#526063" radius={.01} />
          <group name={`WheelAxle_${i}`} position={[0, -.017, .024]}>
            <Cylinder radius={.048} height={.071} rotation={[0, 0, Math.PI / 2]} color="#273639" />
            {[-1, 1].map(side => <Cylinder key={side} radius={.022} height={.003} position={[side * .037, 0, 0]} rotation={[0, 0, Math.PI / 2]} color="#aabbb5" metalness={.7} />)}
          </group>
        </group>
      </group>)}
      <Cylinder radius={.047} height={.13} position={[0, .19, 0]} color="#3d5156" />
      <Cylinder radius={.027} height={.12} position={[0, .275, 0]} color="#acb9b4" metalness={.85} />
      <SoftBox dims={[.40, .035, .35]} position={[0, C.seatHeight - .078, 0]} color="#33464b" radius={.014} />
      <SoftBox name="SeatContact" dims={[C.seatWidth, .075, C.seatDepth]} position={[0, C.seatHeight - .0375, 0]} color="#9bb4ad" radius={.024} roughness={.95} />
      <group name="SeatAnchor" position={[0, C.seatHeight, 0]} />
      <group name="ApproachAnchor" position={[0, 0, C.approachAhead]} />
      <group name="SitRootAnchor" position={[0, 0, C.rootAhead]} />
      <Tube points={[[0, .29, -.13], [0, .43, -.245], [0, .75, -.28]]} radius={.022} color="#3d5156" />
      <SoftBox name="BackContact" dims={[.43, .36, .055]} position={[0, .64, -.265]} rotation={[-.07, 0, 0]} color="#8da8a1" radius={.023} roughness={.92} />
      {[-1, 1].map(side => <group key={side}>
        <Tube points={[[side * .20, .30, -.12], [side * .285, .44, -.12], [side * .285, .56, -.10]]} radius={.016} color="#3d5156" />
        <SoftBox dims={[.065, .035, .25]} position={[side * .285, .56, -.02]} color="#526866" radius={.015} />
      </group>)}
      <Cylinder radius={.014} height={.14} position={[.19, .29, .02]} rotation={[0, 0, Math.PI / 2]} color="#657977" />
      <SoftBox dims={[.065, .024, .04]} position={[.27, .29, .02]} color="#33464b" radius={.01} />
    </group>
  </ObjectHandle>;
}
