import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { PLUSH_DOLLS, deckFromAuthoredX, type PlushDollPlacement } from './cabinLayout';
import { CabinUpperDeck } from './CabinUpperDeck';
import { AssetBoundary } from './ReusableAsset';
import { isValidPlushBody, plushFloorY, plushSupportHeight, type PlushBody } from './plushMotion';

interface PlushDollItemProps {
  doll: PlushDollPlacement;
  index: number;
  bodies: React.MutableRefObject<PlushBody[]>;
}

function LoadedPlushDoll({ doll, index, bodies }: PlushDollItemProps) {
  const gltf = useGLTF(`${import.meta.env.BASE_URL}models/${doll.path}`);
  const group = useRef<THREE.Group>(null);

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
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = doll.height / size.y;
    clone.scale.setScalar(scale);
    // Center all three axes at the mesh volume center so wobble and toppling pivot cleanly.
    clone.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
    return {
      model: clone,
      halfWidth: size.x * scale * 0.5,
      halfHeight: size.y * scale * 0.5,
      halfDepth: size.z * scale * 0.5,
    };
  }, [gltf.scene, doll.height]);

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
    const floor = plushFloorY(body.x, body.z);
    const support = plushSupportHeight(body.roll, body.pitch, prepared.halfWidth, prepared.halfHeight, prepared.halfDepth);
    root.position.set(body.x, floor + support + body.y, body.z);
    root.rotation.order = 'YXZ';
    root.rotation.set(body.pitch, body.yaw, body.roll);
  });

  return <group ref={group} name={doll.name}
    position={[doll.position[0], plushFloorY(doll.position[0], doll.position[2]) + prepared.halfHeight, doll.position[2]]}
    rotation={[0, doll.yaw, 0]} dispose={null}>
    <primitive object={prepared.model} />
  </group>;
}

export function PlushDolls({ bodies }: { bodies: React.MutableRefObject<PlushBody[]> }) {
  return <>
    {PLUSH_DOLLS.map((doll, index) => {
      const item = <AssetBoundary>
        <Suspense fallback={null}>
          <LoadedPlushDoll doll={doll} index={index} bodies={bodies} />
        </Suspense>
      </AssetBoundary>;
      return deckFromAuthoredX(doll.position[0]) === 'upper'
        ? <CabinUpperDeck key={doll.id}>{item}</CabinUpperDeck>
        : <React.Fragment key={doll.id}>{item}</React.Fragment>;
    })}
  </>;
}
