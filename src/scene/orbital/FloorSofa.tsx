import React, { useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Box3, Mesh, Vector3 } from 'three';
import { FLOOR_SOFA } from './cabinLayout';
import { sofaPressure } from './sofaMotion';
import type { ResidentOutfit } from './wardrobe/outfit';

export function FloorSofa({ sample, outfit }: { sample: React.RefObject<number | null>; outfit: ResidentOutfit }) {
  const { scene } = useGLTF(`${import.meta.env.BASE_URL}models/furniture/floor-sofa.glb`);
  const { model, cushions } = useMemo(() => {
    const model = scene.clone(true);
    // Use the unloaded surface for fitting. Morph bounds also include the
    // displaced cushion and would put the base above the floor.
    const bounds = new Box3().setFromObject(model, true);
    const scale = FLOOR_SOFA.width / (bounds.max.x - bounds.min.x);
    const center = bounds.getCenter(new Vector3());
    model.scale.setScalar(scale);
    model.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    const cushions: { weights: number[]; index: number }[] = [];
    model.traverse(part => {
      if (!(part instanceof Mesh)) return;
      part.castShadow = part.receiveShadow = true;
      const index = part.morphTargetDictionary?.Seated;
      if (index !== undefined && part.morphTargetInfluences) cushions.push({ weights: part.morphTargetInfluences, index });
    });
    return { model, cushions };
  }, [scene]);
  useFrame(() => {
    const weight = sofaPressure(sample.current, outfit);
    for (const cushion of cushions) cushion.weights[cushion.index] = weight;
  });
  return <group name="Furniture_FloorSofa" position={FLOOR_SOFA.position} rotation-y={FLOOR_SOFA.yaw} dispose={null}>
    <primitive object={model} />
  </group>;
}
