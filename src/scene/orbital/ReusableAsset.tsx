import React, { Component, Suspense, useEffect, useMemo } from 'react';
import { useGLTF } from '@react-three/drei';
import type { ThreeElements } from '@react-three/fiber';
import * as THREE from 'three';

export class AssetBoundary extends Component<{ children: React.ReactNode; fallback?: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback ?? null : this.props.children; }
}
function LoadedAsset({ path, width, height, tint, ...props }: ThreeElements['group'] & { path: string; width?: number; height?: number; tint?: string }) {
  const gltf = useGLTF(`${import.meta.env.BASE_URL}models/${path}`);
  const model = useMemo(() => {
    const clone = gltf.scene.clone(true);
    clone.traverse(object => {
      if (!(object instanceof THREE.Mesh)) return;
      object.castShadow = object.receiveShadow = true;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      object.material = materials.map(material => {
        const copy = material.clone() as THREE.MeshStandardMaterial;
        if (copy.isMeshStandardMaterial) {
          copy.roughness = Math.max(copy.roughness, 0.55);
          if (tint && /fabric|leather|cushion|pillow/i.test(copy.name + object.name)) copy.color.multiply(new THREE.Color(tint));
        }
        return copy;
      });
      if (object.material.length === 1) object.material = object.material[0];
    });
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const scale = height ? height / size.y : (width ?? 1) / size.x;
    clone.scale.setScalar(scale);
    clone.position.set(-(box.min.x + size.x / 2) * scale, -box.min.y * scale, -(box.min.z + size.z / 2) * scale);
    return clone;
  }, [gltf.scene, width, height, tint]);
  useEffect(() => () => { model.traverse(object => { if (object instanceof THREE.Mesh) { for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose(); } }); }, [model]);
  return <group {...props} dispose={null}><primitive object={model} /></group>;
}
export function ReusableAsset({ fallback, ...props }: React.ComponentProps<typeof LoadedAsset> & { fallback?: React.ReactNode }) {
  return <AssetBoundary fallback={fallback}><Suspense fallback={fallback ?? null}><LoadedAsset {...props} /></Suspense></AssetBoundary>;
}
