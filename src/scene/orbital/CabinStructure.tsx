import React, { useEffect, useMemo, useRef } from 'react';
import { Group, MathUtils } from 'three';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { BEDROOM_LEFT, CABIN_DIVIDER_X, UPPER_DECK_OFFSET } from './cabinLayout';
import { CABIN_STAIRS, STAIR_RISE, STAIR_RUN, STAIR_TREAD_RUN, STAIR_UPPER_PLATFORM_BACK, STAIR_UPPER_ENTRY_FRONT, type CabinResidentView } from './cabinStairs';
import { timber } from './Materials';
import { SoftBox, surface } from './Primitives';

const TREAD_WOOD = '#73503c';
const RISER_CREAM = '#ece6da';
const IRON_FRAME = '#333d46';
const HANDRAIL = '#624231';
const [, upperY] = UPPER_DECK_OFFSET;
const GUARD_HEIGHT = .76;

function Guard({ from, to }: { from: [number, number]; to: [number, number] }) {
  const dx = to[0] - from[0], dz = to[1] - from[1];
  const length = Math.hypot(dx, dz);
  const spans = Math.ceil(length / .68);
  return <>
    <SoftBox dims={[.064, .055, length + .04]} position={[(from[0] + to[0]) / 2, GUARD_HEIGHT, (from[1] + to[1]) / 2]}
      rotation-y={Math.atan2(dx, dz)} color={HANDRAIL} radius={.018} />
    {Array.from({ length: spans + 1 }, (_, index) => {
      const t = index / spans;
      return <SoftBox key={index} dims={[.035, GUARD_HEIGHT, .035]} radius={.008} metalness={.52} roughness={.42} color={IRON_FRAME}
        position={[from[0] + dx * t, GUARD_HEIGHT / 2, from[1] + dz * t]} />;
    })}
  </>;
}

/** Keep the left landing open between the two runs of bedroom railing. */
export function BedroomGuard() {
  const left = BEDROOM_LEFT + .035;
  const right = CABIN_DIVIDER_X - .035;
  const front = 3.10;
  return <group name="Bedroom_Guardrail">
    <Guard from={[left, front]} to={[right, front]} />
    <Guard from={[left, front]} to={[left, STAIR_UPPER_ENTRY_FRONT]} />
    <Guard from={[left, STAIR_UPPER_PLATFORM_BACK]} to={[left, -3.18]} />
  </group>;
}

export function CabinStaircase({ onWalkToStairs, residentView }: { onWalkToStairs: () => void; residentView: React.MutableRefObject<CabinResidentView> }) {
  const nearRail = useRef<Group>(null);
  // The follow camera is outside this rail. Fade only its own materials so foot contacts stay visible.
  const railMaterials = useMemo(() => [timber(HANDRAIL).clone(), surface(IRON_FRAME, .42, .52).clone()], []);
  useEffect(() => () => { railMaterials.forEach(material => material.dispose()); }, [railMaterials]);
  useFrame(({ camera }, delta) => {
    if (!nearRail.current) return;
    const cutaway = residentView.current.stairAscent !== null && camera.position.x < CABIN_STAIRS.x;
    const target = cutaway ? 0 : 1;
    if (railMaterials[0].opacity === target) return;
    const next = MathUtils.damp(railMaterials[0].opacity, target, 18, delta);
    const opacity = Math.abs(next - target) < .008 ? target : next;
    nearRail.current.visible = opacity > 0;
    for (const material of railMaterials) {
      material.transparent = opacity < 1;
      material.depthWrite = opacity === 1;
      material.opacity = opacity;
    }
  });
  const { x, width, lowerZ, upperZ, steps } = CABIN_STAIRS;
  const flightAngle = Math.atan2(upperY, STAIR_RUN);
  const flightLength = Math.hypot(upperY, STAIR_RUN);
  const centerZ = (lowerZ + upperZ) / 2;
  const guardX = x - width / 2 + .045;
  const insideX = x + width / 2 - .045;
  const outerEdge = x - width / 2;
  const platformWidth = CABIN_DIVIDER_X - outerEdge + .08;
  const platformCenter = outerEdge + platformWidth / 2;
  // The platform overlaps the deck in plan. Keep its top just below the parquet.
  const threshold = .006;
  const click = (event: ThreeEvent<MouseEvent>) => {
    event.stopPropagation();
    if (event.delta <= 5) onWalkToStairs();
  };
  return <group name="Cabin_Staircase" onClick={click} onPointerDown={event => event.stopPropagation()}>
    <SoftBox name="Stair_Lower_Landing" dims={[platformWidth, .21, width]} color={TREAD_WOOD} radius={.026}
      position={[platformCenter, -.105 - threshold, lowerZ]} />
    <SoftBox name="Stair_Upper_Landing" dims={[platformWidth, .23, width]} color={TREAD_WOOD} radius={.026}
      position={[platformCenter, upperY - .115 - threshold, STAIR_UPPER_PLATFORM_BACK + width / 2]} />
    <group position-y={upperY}>
      <Guard from={[guardX, upperZ]} to={[guardX, STAIR_UPPER_PLATFORM_BACK]} />
      <Guard from={[guardX, STAIR_UPPER_PLATFORM_BACK]} to={[CABIN_DIVIDER_X + .035, STAIR_UPPER_PLATFORM_BACK]} />
    </group>
    {[guardX, insideX].map(side => <SoftBox key={side} dims={[.12, .23, flightLength]} radius={.026} color={IRON_FRAME} metalness={.42} roughness={.48}
      position={[side, upperY / 2 - .15, centerZ]} rotation-x={flightAngle} />)}
    {Array.from({ length: steps }, (_, index) => {
      const y = (index + 1) * STAIR_RISE;
      const z = lowerZ - (index + .5) * STAIR_TREAD_RUN;
      return <group key={index} name={`Stair_Tread_${index + 1}`}>
        <SoftBox dims={[width - .04, .07, STAIR_TREAD_RUN + .024]} radius={.014} color={TREAD_WOOD} position={[x, y - .035, z]} />
        <SoftBox dims={[width - .11, STAIR_RISE, .044]} radius={.01} color={RISER_CREAM}
          position={[x, y - .07 - STAIR_RISE / 2, z + STAIR_TREAD_RUN / 2 - .035]} />
      </group>;
    })}
    {[guardX, insideX].map(side => {
      // The inside rail stops short at both platforms, leaving the turn into each room open.
      const inset = side === insideX ? .14 : 0;
      const outside = side === guardX;
      return <group key={side} ref={outside ? nearRail : undefined}>
        <SoftBox dims={[.065, .052, flightLength * (1 - 2 * inset) + .06]} position={[side, upperY / 2 + GUARD_HEIGHT, centerZ]}
          rotation-x={flightAngle} radius={.018} color={HANDRAIL} material={outside ? railMaterials[0] : undefined} />
        {Array.from({ length: 7 }, (_, index) => {
          const t = inset + index * (1 - 2 * inset) / 6;
          return <SoftBox key={index} dims={[.035, GUARD_HEIGHT, .035]} radius={.008} metalness={.52} roughness={.42} color={IRON_FRAME}
            position={[side, t * upperY + GUARD_HEIGHT / 2, lowerZ - STAIR_RUN * t]} material={outside ? railMaterials[1] : undefined} />;
        })}
      </group>;
    })}
  </group>;
}
