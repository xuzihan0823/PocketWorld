import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';
import { surface } from './Primitives';
import { createPillowGeometry } from '../geometry';
import { timber, upholstery } from './Materials';

export const FURNITURE = {
  wood: '#b27c4e', edge: '#75503a', cream: '#e7d8bc', ink: '#293c42',
  brass: '#ba9357', cloth: '#7c9c96', paper: '#f2e8cc', dark: '#303333',
};
export type FurnitureVector = [number, number, number];

export function FurnitureMotion({ children, axis = 'y', target, mode = 'rotation', reducedMotion = false, drive, ...props }: Omit<ThreeElements['group'], 'ref'> & {
  axis?: 'x' | 'y' | 'z'; target: number; mode?: 'rotation' | 'position'; reducedMotion?: boolean;
  /** Returns a value that something else (e.g. the resident's hand) is holding the part at, if any. */
  drive?: () => number | undefined;
}) {
  const group = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (!group.current) return;
    const transform = group.current[mode];
    const held = drive?.();
    transform[axis] = held !== undefined ? held : reducedMotion ? target : THREE.MathUtils.damp(transform[axis], target, 8, Math.min(dt, 0.05));
  });
  return <group {...props} ref={group}>{children}</group>;
}

export function FurnitureCylinder({ radius, height, color = FURNITURE.ink, topRadius = radius, metalness = 0, ...props }: Omit<ThreeElements['mesh'], 'args' | 'color'> & {
  radius: number; topRadius?: number; height: number; color?: string; metalness?: number;
}) {
  return <mesh {...props} castShadow receiveShadow material={color === FURNITURE.wood || color === FURNITURE.edge ? timber(color) : surface(color, metalness ? 0.35 : 0.7, metalness)}>
    <cylinderGeometry args={[topRadius, radius, height, 32]} />
  </mesh>;
}

export function FurnitureOrb({ scale, color = FURNITURE.cloth, ...props }: Omit<ThreeElements['mesh'], 'args' | 'color'> & { color?: string }) {
  return <mesh {...props} scale={scale} castShadow receiveShadow material={surface(color, 0.88)}><sphereGeometry args={[1, 24, 16]} /></mesh>;
}

export function FurnitureCushion({ dims, color, ...props }: Omit<ThreeElements['mesh'], 'args' | 'color'> & { dims: [number, number, number]; color: string }) {
  const [width, thickness, depth] = dims;
  const geometry = useMemo(() => createPillowGeometry(width, thickness, depth), [width, thickness, depth]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh {...props} geometry={geometry} material={upholstery(color)} castShadow receiveShadow dispose={null} />;
}
