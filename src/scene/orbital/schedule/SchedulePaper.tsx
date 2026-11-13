import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { PaperBall, SchedulePage } from './schedule';
import { BOOK_POSITION } from './bookLayout';

export const GLASS_POSITION: [number, number, number] = [0.69, 2.3, -3.39];
const ease = (t: number) => 1 - (1 - t) ** 3;
export function paperBallPosition(seed: number): [number, number, number] {
  return [0.25 + Math.sin(seed * 2.4) * 0.65, 0.105, -0.68 + Math.cos(seed * 1.8) * 0.45];
}
export function paperGeometry(crumpled = false) {
  const geometry = new THREE.PlaneGeometry(0.56, 0.74, 20, 26).toNonIndexed();
  const attribute = geometry.attributes.position;
  const flat = attribute.array.slice() as Float32Array;
  const folded = new Float32Array(flat.length);
  for (let i = 0; i < attribute.count; i++) {
    const x = flat[i * 3], y = flat[i * 3 + 1];
    const u = (x + 0.28) / 0.56, v = (y + 0.37) / 0.74;
    const longitude = u * Math.PI * 2, latitude = v * Math.PI;
    const radius = 0.083 + Math.sin(u * 23 + v * 17) * Math.cos(v * 29) * 0.009;
    folded.set([Math.cos(longitude) * Math.sin(latitude) * radius, Math.cos(latitude) * radius, Math.sin(longitude) * Math.sin(latitude) * radius], i * 3);
    flat[i * 3 + 2] = 0.012 * (u ** 6) + Math.sin(v * Math.PI) * 0.003;
  }
  attribute.array.set(crumpled ? folded : flat);
  geometry.computeVertexNormals();
  return { geometry, flat, folded };
}
function pageTexture(page: SchedulePage) {
  const canvas = document.createElement('canvas');
  canvas.width = 560; canvas.height = 740;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f4ead3'; ctx.fillRect(0, 0, 560, 740);
  for (let i = 0; i < 6500; i++) {
    const x = (i * 137.7) % 560, y = (i * 97.3) % 740;
    ctx.fillStyle = i % 2 ? '#8a704009' : '#ffffff38'; ctx.fillRect(x, y, 1, 1);
  }
  ctx.fillStyle = '#454b3d'; ctx.font = '32px "Songti SC", serif'; ctx.fillText('今天的安排', 48, 76);
  ctx.fillStyle = '#6c614b'; ctx.font = '17px serif'; ctx.textAlign = 'right'; ctx.fillText(page.date, 512, 36); ctx.textAlign = 'left';
  page.entries.forEach((entry, index) => {
    const y = 168 + index * 244;
    ctx.font = '20px serif'; ctx.fillStyle = '#775b38'; ctx.fillText(entry.time, 48, y);
    ctx.font = '25px "Songti SC", serif'; ctx.fillStyle = '#454b3d';
    const lines = (text: string, length: number) => Array.from(text).reduce<string[]>((rows, char, i) => { const row = Math.floor(i / length); rows[row] = (rows[row] || '') + char; return rows; }, []);
    lines(entry.title, 17).slice(0, 2).forEach((line, i) => ctx.fillText(line, 48, y + 42 + i * 32));
    ctx.font = '19px "Songti SC", serif';
    lines(entry.content ?? '', 23).slice(0, 3).forEach((line, i) => ctx.fillText(line, 48, y + 110 + i * 30));
    ctx.strokeStyle = '#cbbd9f'; ctx.beginPath(); ctx.moveTo(48, y + 212); ctx.lineTo(512, y + 212); ctx.stroke();
  });
  ctx.font = '16px serif'; ctx.fillStyle = '#6c614b'; ctx.textAlign = 'right'; ctx.fillText(String(page.number).padStart(2, '0'), 512, 710);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
export function PostedPaper({ page, position, onSelect }: { page: SchedulePage; position: [number, number, number]; onSelect: () => void }) {
  const { geometry } = useMemo(() => paperGeometry(), []);
  const texture = useMemo(() => pageTexture(page), [page]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <group position={position}>
    <mesh geometry={geometry} onClick={event => { event.stopPropagation(); onSelect(); }} castShadow receiveShadow>
      <meshStandardMaterial map={texture} roughness={0.96} side={THREE.DoubleSide} />
    </mesh>
    {[-0.16, 0.16].map(x => <mesh key={x} position={[x, 0.365, 0.008]} rotation={[0, 0, x > 0 ? -0.1 : 0.08]}>
      <planeGeometry args={[0.16, 0.052]} /><meshStandardMaterial color="#d3c299" roughness={1} transparent opacity={0.78} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>)}
  </group>;
}
export function FloorPaperBall({ ball }: { ball: PaperBall }) {
  const { geometry } = useMemo(() => paperGeometry(true), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh name={`discarded-schedule-${ball.id}`} geometry={geometry} position={paperBallPosition(ball.seed)} rotation={[0.4, ball.seed, 0.3]} castShadow receiveShadow>
    <meshStandardMaterial color="#e7ddc3" roughness={1} side={THREE.DoubleSide} flatShading />
  </mesh>;
}
export interface PaperFlight { kind: 'post' | 'discard'; page: SchedulePage; from?: [number, number, number] }
export function FlyingPaper({ flight, reducedMotion, onComplete }: { flight: PaperFlight; reducedMotion: boolean; onComplete: () => void }) {
  const mesh = useRef<THREE.Mesh>(null);
  const elapsed = useRef(0);
  const data = useMemo(() => paperGeometry(), []);
  const texture = useMemo(() => pageTexture(flight.page), [flight.page]);
  const start = useMemo(() => new THREE.Vector3(...(flight.kind === 'post' ? flight.from ?? BOOK_POSITION : GLASS_POSITION)), [flight]);
  const end = useMemo(() => new THREE.Vector3(...(flight.kind === 'post' ? GLASS_POSITION : paperBallPosition(flight.page.number))), [flight]);
  useEffect(() => () => data.geometry.dispose(), [data]);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame((_, delta) => {
    if (!mesh.current) return;
    const duration = reducedMotion ? 0.12 : flight.kind === 'post' ? 1.25 : 1.65;
    elapsed.current += Math.min(delta, 0.05);
    const progress = Math.min(1, elapsed.current / duration);
    if (flight.kind === 'post') {
      const t = ease(progress);
      mesh.current.position.lerpVectors(start, end, t);
      if (!reducedMotion) { mesh.current.position.y += Math.sin(progress * Math.PI) * 0.25; mesh.current.position.z += Math.sin(progress * Math.PI) * 0.16; }
      mesh.current.rotation.set(-Math.PI / 2 * (1 - t), 0, 0.08 * (1 - t));
      mesh.current.scale.setScalar(0.45 + 0.55 * t);
    } else {
      const fold = reducedMotion ? 1 : ease(Math.min(1, progress / 0.32));
      const positions = data.geometry.attributes.position;
      for (let i = 0; i < data.flat.length; i++) positions.array[i] = THREE.MathUtils.lerp(data.flat[i], data.folded[i], fold);
      positions.needsUpdate = true; data.geometry.computeVertexNormals();
      const fall = reducedMotion ? progress : Math.max(0, (progress - 0.32) / 0.68);
      mesh.current.position.lerpVectors(start, end, fall);
      mesh.current.position.y = THREE.MathUtils.lerp(start.y, end.y, fall * fall);
      if (fall > 0.85) mesh.current.position.y += Math.sin((fall - 0.85) / 0.15 * Math.PI) * 0.08;
      mesh.current.rotation.set(fall * 5, fall * 4, fall * 2);
    }
    if (progress >= 1) onComplete();
  });
  return <mesh ref={mesh} geometry={data.geometry} castShadow receiveShadow>
    <meshStandardMaterial map={texture} color="#f6eddb" roughness={1} side={THREE.DoubleSide} flatShading={flight.kind === 'discard'} />
  </mesh>;
}
