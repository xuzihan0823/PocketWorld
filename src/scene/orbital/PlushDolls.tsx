import React, { Suspense, useContext, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { PLUSH_DOLLS, UPPER_DECK_OFFSET, deckFromAuthoredX, type PlushDollPlacement } from './cabinLayout';
import { UpperDeckVisibility } from './CabinUpperDeck';
import { AssetBoundary } from './ReusableAsset';
import { isValidPlushBody, plushFloorY, plushSupportHeight, type PlushBody } from './plushMotion';
import { ObjectHandle } from './ObjectHandle';
import type { WorldModelProps } from '../../types/world';
import { createPlushShape, plushLabels, type PlushGrip, type PlushShape } from './plushCarry';

interface PlushDollItemProps {
  shapes: Map<string, PlushShape>;
  grip: React.RefObject<PlushGrip | null>;
  world: WorldModelProps;
  doll: PlushDollPlacement;
  index: number;
  bodies: React.MutableRefObject<PlushBody[]>;
}

function LoadedPlushDoll({ doll, index, bodies, grip, shapes, world }: PlushDollItemProps) {
  const gltf = useGLTF(`${import.meta.env.BASE_URL}models/${doll.path}`);
  const group = useRef<THREE.Group>(null);

  const upperVisible = useContext(UpperDeckVisibility);
  const hand = useMemo(() => new THREE.Vector3(), []);
  const prepared = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      object.material = materials.map(material => {
        const copy = material.clone() as THREE.MeshStandardMaterial;
        if (copy.isMeshStandardMaterial) copy.roughness = Math.max(copy.roughness, 0.55);
        return copy;
      });
      if (object.material.length === 1) object.material = object.material[0];
    });
    const shape = createPlushShape(gltf.scene, doll.height);
    clone.scale.setScalar(shape.scale);
    clone.position.copy(shape.origin).multiplyScalar(-shape.scale);
    return { model: clone, shape };
  }, [gltf.scene, doll.height]);

  useLayoutEffect(() => {
    shapes.set(doll.id, prepared.shape);
    return () => { shapes.delete(doll.id); };
  }, [shapes, doll.id, prepared]);

  useEffect(() => () => {
    prepared.model.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
        material.dispose();
      }
    });
  }, [prepared]);

  useFrame(() => {
    const root = group.current;
    const body = bodies.current[index];
    if (!root || !isValidPlushBody(body)) return;
    const held = grip.current?.body === body ? grip.current : null;
    const x = held?.floorX ?? body.x, z = held?.floorZ ?? body.z;
    const upper = deckFromAuthoredX(x) === 'upper';
    const support = plushSupportHeight(body.roll, body.pitch, prepared.shape.half.x, prepared.shape.half.y, prepared.shape.half.z);
    root.position.set(x + (upper ? UPPER_DECK_OFFSET[0] : 0),
      plushFloorY(x, z) + support + body.y + (upper ? UPPER_DECK_OFFSET[1] : 0), z);
    if (held && held.lift > 0) root.position.copy(root.parent!.worldToLocal(hand.copy(held.center)));
    root.visible = held ? held.visible : !upper || upperVisible;
    if (held) root.rotation.copy(held.rotation);
    else root.rotation.set(body.pitch, body.yaw, body.roll, 'YXZ');

  });

  return <group ref={group} name={doll.name}
    position={[doll.position[0], plushFloorY(doll.position[0], doll.position[2]) + prepared.shape.half.y, doll.position[2]]}
    rotation={[0, doll.yaw, 0]} dispose={null}>
    <ObjectHandle id={doll.id} action="inspect" hint={`拿起或放下${plushLabels[doll.id]}`} panorama world={world}
      acceptsHit={() => !!group.current?.visible} onClick={event => event.stopPropagation()}>
      <primitive object={prepared.model} />
    </ObjectHandle>
  </group>;
}

export function PlushDolls(props: Omit<PlushDollItemProps, 'doll' | 'index'>) {
  return <>{PLUSH_DOLLS.map((doll, index) => <AssetBoundary key={doll.id}>
    <Suspense fallback={null}><LoadedPlushDoll {...props} doll={doll} index={index} /></Suspense>
  </AssetBoundary>)}</>;
}
