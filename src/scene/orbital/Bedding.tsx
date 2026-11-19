import React, { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { createPillowGeometry } from '../geometry';
import { upholstery } from './Materials';

export function Bedding() {
  const { quilt, pillow, fold } = useMemo(() => {
    const quilt = new THREE.PlaneGeometry(2.1, 1.94, 52, 48);
    const p = quilt.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const rawX = p.getX(i); const z = p.getY(i) + 0.3;
      const edge = Math.max(0, Math.abs(rawX) - 0.73);
      const x = Math.sign(rawX) * (Math.min(Math.abs(rawX), 0.73) + 0.08 * Math.sin(Math.min(edge / 0.08, Math.PI / 2)));
      const sag = edge > 0 ? Math.max(0, edge - 0.025) * 0.9 : 0;
      const puff = 0.035 * Math.cos(Math.min(Math.abs(rawX) / 0.75, 1) * Math.PI / 2);
      const ripple = Math.sin(rawX * 21 + z * 5) * 0.008 + Math.sin(z * 17 + rawX * 7) * 0.006;
      p.setXYZ(i, x, 0.76 + puff - sag + ripple, z);
    }
    quilt.computeVertexNormals();
    const fold = new THREE.PlaneGeometry(1.6, 0.24, 40, 10);
    const f = fold.attributes.position;
    for (let i = 0; i < f.count; i++) { const x = f.getX(i); const z = f.getY(i); f.setXYZ(i, x, 0.80 + Math.cos(z / 0.24 * Math.PI) * 0.017 + Math.sin(x * 20) * 0.006, z - 0.57); }
    fold.computeVertexNormals();
    return { quilt, pillow: createPillowGeometry(1.16, 0.23, 0.59), fold };
  }, []);
  useEffect(() => () => { quilt.dispose(); pillow.dispose(); fold.dispose(); }, [quilt, pillow, fold]);
  return <>
    <mesh geometry={pillow} material={upholstery('#e8ddc5')} position={[0, 0.83, -0.93]} rotation={[0, 0.06, 0]} castShadow receiveShadow dispose={null} />
    <mesh geometry={quilt} material={upholstery('#d79695')} castShadow receiveShadow dispose={null} />
    <mesh geometry={fold} material={upholstery('#edcbb8')} castShadow receiveShadow dispose={null} />
  </>;
}
