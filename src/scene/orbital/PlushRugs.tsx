import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { LOWER_PLUSH_RUG, UPPER_PLUSH_RUG } from './cabinLayout';
import {
  createPlushRugShellGeometry,
  createPlushRugShellMaterial,
  PLUSH_SHELL_COUNT,
  type PlushRugSpec,
} from './shaders/plushRug';

const NO_RAYCAST = () => null;
const IDENTITY_MATRIX = new THREE.Matrix4();

export const LOWER_PLUSH_RUG_SPEC: PlushRugSpec = {
  shape: {
    kind: 'rounded-rect',
    halfSize: LOWER_PLUSH_RUG.halfSize,
    cornerRadius: LOWER_PLUSH_RUG.cornerRadius,
  },
  baseY: LOWER_PLUSH_RUG.baseY,
  pileHeight: LOWER_PLUSH_RUG.pileHeight,
  edgeFluff: 0.028,
  tuftFreq: 37.0,
  napLean: 0.026,
  normalStrength: 0.68,
  sheenStrength: 0.38,
  tipLift: 0.30,
  patternMode: 0,
  mainColor: '#527896',
  rootTint: [0.42, 0.40, 0.38],
  tipColor: '#f8f3ea',
  borderColor: '#f4ede2',
  accentColor: '#d9b167',
  borderWidth: 0.165,
  accentWidth: 0.10,
};

export const UPPER_PLUSH_RUG_SPEC: PlushRugSpec = {
  shape: {
    kind: 'oval',
    radii: UPPER_PLUSH_RUG.radii,
  },
  baseY: UPPER_PLUSH_RUG.baseY,
  pileHeight: UPPER_PLUSH_RUG.pileHeight,
  edgeFluff: 0.032,
  tuftFreq: 31.0,
  napLean: 0.030,
  normalStrength: 0.74,
  sheenStrength: 0.46,
  tipLift: 0.36,
  patternMode: 1,
  mainColor: '#f4ece0',
  rootTint: [0.50, 0.44, 0.37],
  tipColor: '#fffdf8',
};

export const OBSERVATORY_PLUSH_RUG_SPEC: PlushRugSpec = {
  shape: {
    kind: 'rounded-rect',
    halfSize: [1.45, 1.10],
    cornerRadius: 0.22,
  },
  baseY: 0.024,
  pileHeight: 0.020,
  edgeFluff: 0.020,
  tuftFreq: 40.0,
  napLean: 0.022,
  normalStrength: 0.60,
  sheenStrength: 0.32,
  tipLift: 0.26,
  patternMode: 2,
  mainColor: '#76918b',
  rootTint: [0.46, 0.45, 0.43],
  tipColor: '#f5f0e7',
  borderColor: '#efe9de',
  borderWidth: 0.13,
};

interface PlushRugPileProps {
  name: string;
  position: [number, number, number];
  spec: PlushRugSpec;
}

function PlushRugPile({ name, position, spec }: PlushRugPileProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const geometry = useMemo(() => createPlushRugShellGeometry(spec, PLUSH_SHELL_COUNT), [spec]);
  const material = useMemo(() => createPlushRugShellMaterial(spec), [spec]);

  useLayoutEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    for (let i = 0; i < PLUSH_SHELL_COUNT; i++) {
      mesh.setMatrixAt(i, IDENTITY_MATRIX);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [geometry]);

  useEffect(() => () => {
    geometry.dispose();
    material.dispose();
  }, [geometry, material]);

  return (
    <instancedMesh
      ref={meshRef}
      name={name}
      position={position}
      args={[geometry, material, PLUSH_SHELL_COUNT]}
      receiveShadow
      castShadow={false}
      frustumCulled={false}
      raycast={NO_RAYCAST}
    />
  );
}

export function LowerPlushRugPile() {
  return (
    <PlushRugPile
      name="PlushRug_LowerPile"
      position={[LOWER_PLUSH_RUG.center[0], 0, LOWER_PLUSH_RUG.center[1]]}
      spec={LOWER_PLUSH_RUG_SPEC}
    />
  );
}

export function UpperPlushRugPile() {
  return (
    <PlushRugPile
      name="PlushRug_UpperPile"
      position={[UPPER_PLUSH_RUG.center[0], 0, UPPER_PLUSH_RUG.center[1]]}
      spec={UPPER_PLUSH_RUG_SPEC}
    />
  );
}

export function ObservatoryPlushRugPile() {
  return (
    <PlushRugPile
      name="PlushRug_ObservatoryPile"
      position={[-1.5, 0, 0.8]}
      spec={OBSERVATORY_PLUSH_RUG_SPEC}
    />
  );
}
