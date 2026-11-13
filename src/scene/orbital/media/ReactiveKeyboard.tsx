import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { KEYBOARD_KEYS, subscribePhysicalKeyboard } from './keyboard-input';
import type { KeyboardPressState } from './keyboard-input';
import { surface } from '../Primitives';

const REST = .042, TRAVEL = .012, CAP_HEIGHT = .022;
function createLegends() {
  const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  const positions = new Float32Array(KEYBOARD_KEYS.length * 12), uvs = new Float32Array(KEYBOARD_KEYS.length * 8), indices: number[] = [];
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#353936';
  KEYBOARD_KEYS.forEach((key, i) => {
    const cx = (i % 16) * 64 + 32, cy = Math.floor(i / 16) * 64 + 32;
    const width = Math.min(.068, key.width - .008), height = Math.min(.03, key.depth * .8), atlasWidth = width / height * 24;
    ctx.font = `600 ${key.label.length > 3 ? 14 : key.label.length > 1 ? 16 : 22}px Arial, "Microsoft YaHei", sans-serif`;
    ctx.fillText(key.label, cx, cy, atlasWidth - 3);
    const x0 = key.x - width / 2, x1 = key.x + width / 2, z0 = key.z - height / 2, z1 = key.z + height / 2;
    positions.set([x0, REST + CAP_HEIGHT / 2 + .0008, z0, x1, REST + CAP_HEIGHT / 2 + .0008, z0, x1, REST + CAP_HEIGHT / 2 + .0008, z1, x0, REST + CAP_HEIGHT / 2 + .0008, z1], i * 12);
    const u0 = (cx - atlasWidth / 2) / canvas.width, u1 = (cx + atlasWidth / 2) / canvas.width, v0 = 1 - (cy - 12) / canvas.height, v1 = 1 - (cy + 12) / canvas.height;
    uvs.set([u0, v0, u1, v0, u1, v1, u0, v1], i * 8);
    const n = i * 4; indices.push(n, n + 3, n + 2, n, n + 2, n + 1);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); geometry.setIndex(indices);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false });
  return { geometry, material, texture, positions };
}

/** Two draw calls: instanced moving caps and one atlas for all printed legends. */
export function ReactiveKeyboard({ reducedMotion, active }: { reducedMotion: boolean; active: boolean }): React.ReactElement {
  const caps = useRef<THREE.InstancedMesh>(null), input = useRef<KeyboardPressState | null>(null);
  const geometry = useMemo(() => new RoundedBoxGeometry(1, 1, 1, 2, .12), []);
  const legends = useMemo(createLegends, []), levels = useMemo(() => new Float32Array(KEYBOARD_KEYS.length), []);
  const baseColors = useMemo(() => KEYBOARD_KEYS.map(key => new THREE.Color(key.accent ? '#b8d1bd' : key.units > 1 || key.code === 'Escape' ? '#d9c7a0' : '#ece5cd')), []);
  const matrix = useMemo(() => new THREE.Matrix4(), []), color = useMemo(() => new THREE.Color(), []), pressedColor = useMemo(() => new THREE.Color('#f4b85f'), []);
  const position = useMemo(() => new THREE.Vector3(), []), scale = useMemo(() => new THREE.Vector3(), []), rotation = useMemo(() => new THREE.Quaternion(), []);
  useEffect(() => {
    if (!active) return;
    const subscription = subscribePhysicalKeyboard(); input.current = subscription.state;
    return () => { input.current = null; subscription.dispose(); };
  }, [active]);
  useEffect(() => () => { geometry.dispose(); legends.geometry.dispose(); legends.material.dispose(); legends.texture.dispose(); }, [geometry, legends]);
  useLayoutEffect(() => {
    const mesh = caps.current; if (!mesh) return;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    KEYBOARD_KEYS.forEach((key, i) => {
      matrix.compose(position.set(key.x, REST, key.z), rotation, scale.set(key.width, CAP_HEIGHT, key.depth));
      mesh.setMatrixAt(i, matrix); mesh.setColorAt(i, baseColors[i]);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) { mesh.instanceColor.setUsage(THREE.DynamicDrawUsage); mesh.instanceColor.needsUpdate = true; }
  }, [matrix, position, rotation, scale, baseColors]);
  useFrame((_, delta) => {
    const mesh = caps.current; if (!mesh) return;
    const state = active ? input.current : null;
    let changed = false; const now = performance.now(), dt = Math.min(delta, .05);
    KEYBOARD_KEYS.forEach((key, i) => {
      const target = state && state.active(key.code, now) ? 1 : 0, before = levels[i];
      let value = reducedMotion ? target : THREE.MathUtils.damp(before, target, target ? 45 : 24, dt);
      if (Math.abs(value - target) < .001) value = target;
      if (Math.abs(value - before) < .00001) return;
      levels[i] = value; changed = true;
      const y = REST - TRAVEL * value;
      matrix.compose(position.set(key.x, y, key.z), rotation, scale.set(key.width, CAP_HEIGHT, key.depth)); mesh.setMatrixAt(i, matrix);
      color.copy(baseColors[i]).lerp(pressedColor, value); mesh.setColorAt(i, color);
      for (let v = 0; v < 4; v++) legends.positions[i * 12 + v * 3 + 1] = y + CAP_HEIGHT / 2 + .0008;
    });
    if (changed) { mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true; legends.geometry.attributes.position.needsUpdate = true; }
  });
  return <group name="PhysicalKeyboard">
    <instancedMesh ref={caps} args={[geometry, surface('#ffffff'), KEYBOARD_KEYS.length]} castShadow receiveShadow frustumCulled={false} dispose={null} />
    <mesh geometry={legends.geometry} material={legends.material} frustumCulled={false} dispose={null} />
  </group>;
}
