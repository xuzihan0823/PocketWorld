import { paperGeometry } from './paperGeometry';
import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { paperBallPosition, type PaperBall, type SchedulePage } from './schedule';
import type { PaperPickup } from '../cabinActions';
import { SCHEDULE_BOOK_POSITION } from './bookLayout';
import { roomAudio } from '../../audioEngine';

export const GLASS_POSITION: [number, number, number] = [0.69, 2.53, -3.13];
export const BOOK_POSITION: [number, number, number] = [SCHEDULE_BOOK_POSITION[0] + 0.126, SCHEDULE_BOOK_POSITION[1] + 0.033, SCHEDULE_BOOK_POSITION[2] - 0.01];
const ease = (t: number) => 1 - (1 - t) ** 3;
export function pageTexture(page: SchedulePage, bound = false, side: 'left' | 'right' = 'right') {
  const canvas = document.createElement('canvas');
  canvas.width = 560; canvas.height = 872;
  const ctx = canvas.getContext('2d')!;
  const oat = '#e7dcc6', wheat = '#e4d9c3', paper = '#f7f1e2', ink = '#57483e';
  const box = (x: number, y: number, w: number, h: number, color: string, radius = 4) => {
    ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x, y, w, h, radius); ctx.fill();
  };
  ctx.fillStyle = bound ? '#f5f0e1' : '#d2c4a8'; ctx.fillRect(0, 0, 560, 872);
  if (!bound) box(16, 16, 528, 840, paper, 26);
  ctx.fillStyle = '#806b50'; ctx.font = 'bold italic 32px "Segoe Script", cursive'; ctx.textAlign = 'right'; ctx.fillText('Daily Planner', 520, 78);
  ctx.textAlign = 'left'; ctx.fillStyle = ink; ctx.font = 'bold 17px "Segoe Print", serif'; ctx.fillText('Date:', 40, 137);
  box(92, 116, 181, 27, oat, 14); ctx.fillStyle = ink; ctx.font = '16px Georgia, serif'; ctx.fillText(page.date, 109, 135);
  const weekday = (new Date(`${page.date}T12:00:00`).getDay() + 6) % 7;
  ['M', 'T', 'W', 'T', 'F', 'S', 'S'].forEach((day, i) => {
    if (i === weekday) box(298 + i * 30, 115, 24, 27, wheat, 14);
    ctx.fillStyle = ink; ctx.font = 'bold 14px "Segoe Print", serif'; ctx.fillText(day, 304 + i * 30, 135);
  });
  box(40, 165, 230, 634, wheat);
  box(284, 165, 236, 190, oat);
  box(284, 380, 236, 35, oat);
  box(284, 551, 236, 35, oat);
  ctx.strokeStyle = oat; ctx.lineWidth = 2; ctx.strokeRect(285, 585, 234, 214);
  ctx.fillStyle = ink; ctx.font = 'bold 18px "Segoe Print", serif';
  ctx.fillText('Schedule', 50, 190); ctx.fillText('To Do List', 295, 190); ctx.fillText('For Tomorrow', 295, 404); ctx.fillText('Notes', 295, 575);
  const text = (value: string, x: number, y: number, width: number) => {
    let shown = value;
    while (shown && ctx.measureText(shown).width > width) shown = shown.slice(0, -1);
    if (shown !== value) shown = `${shown.slice(0, -1)}…`;
    ctx.fillStyle = ink; ctx.fillText(shown, x, y);
  };
  page.entries.forEach((entry, index) => {
    const y = 240 + index * 73;
    ctx.font = '16px Georgia, serif'; text(entry.time, 50, y, 48);
    ctx.font = '19px "KaiTi", serif'; text(entry.title, 104, y, bound ? 127 : 151);
    if (bound) { ctx.fillStyle = '#a08a71'; ctx.font = '15px Georgia, serif'; ctx.fillText('···', 242, y); }
    ctx.strokeStyle = '#f7f1e2aa'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(50, y + 22); ctx.lineTo(258, y + 22); ctx.stroke();
  });
  page.todos.forEach((item, i) => {
    const y = 236 + i * 45;
    ctx.strokeStyle = '#a18b6f'; ctx.lineWidth = 2; ctx.strokeRect(296, y - 12, 16, 16);
    if (item.completed) box(299, y - 9, 10, 10, '#9b7b58', 0);
    ctx.font = '19px "KaiTi", serif'; text(item.text, 322, y, 184);
    ctx.strokeStyle = '#aa9a7d80'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(322, y + 8); ctx.lineTo(506, y + 8); ctx.stroke();
  });
  page.tomorrow.forEach((item, i) => {
    const y = 447 + i * 53;
    box(298, y - 10, 11, 11, wheat, 6);
    ctx.font = '19px "KaiTi", serif'; text(item, 320, y, 186);
  });
  ctx.font = '17px "KaiTi", serif';
  let line = '', row = 0;
  for (const char of page.notes) {
    if (char === '\n' || ctx.measureText(line + char).width > 210) {
      text(line, 297, 610 + row * 24, 210); line = ''; row++;
    }
    if (row >= 8) break;
    if (char !== '\n') line += char;
  }
  if (row < 8) text(line, 297, 610 + row * 24, 210);
  ctx.font = '14px serif'; ctx.fillStyle = '#968671'; ctx.textAlign = 'center'; ctx.fillText(`第 ${page.number} 页`, 280, 830);
  if (bound) { ctx.font = '25px Georgia, serif'; ctx.fillText(side === 'left' ? '‹' : '›', side === 'left' ? 54 : 507, 832); }
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
    {[-0.16, 0.16].map(x => <mesh key={x} position={[x, 0.431, 0.008]} rotation={[0, 0, x > 0 ? -0.1 : 0.08]}>
      <planeGeometry args={[0.16, 0.052]} /><meshStandardMaterial color="#d3c299" roughness={1} transparent opacity={0.78} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>)}
  </group>;
}
export function FloorPaperBall({ ball, pickup }: { ball: PaperBall; pickup: React.RefObject<PaperPickup | null> }) {
  const mesh = useRef<THREE.Mesh>(null);
  const start = useMemo(() => paperBallPosition(ball.seed), [ball.seed]);
  useFrame(() => {
    if (!mesh.current) return;
    if (pickup.current?.id === ball.id) mesh.current.position.copy(pickup.current.position);
    else mesh.current.position.fromArray(start);
  });
  const { geometry } = useMemo(() => paperGeometry(true), []);
  useEffect(() => () => geometry.dispose(), [geometry]);
  return <mesh ref={mesh} name={`discarded-schedule-${ball.id}`} geometry={geometry} position={start} rotation={[0.4, ball.seed, 0.3]} castShadow receiveShadow>
    <meshStandardMaterial color="#e7ddc3" roughness={1} side={THREE.DoubleSide} flatShading />
  </mesh>;
}
export interface PaperFlight { kind: 'tear' | 'discard'; page: SchedulePage; from?: [number, number, number] }
export function FlyingPaper({ flight, reducedMotion, onComplete }: { flight: PaperFlight; reducedMotion: boolean; onComplete: () => void }) {
  const mesh = useRef<THREE.Mesh>(null);
  const elapsed = useRef(0);
  const cues = useRef({ crumpled: flight.kind === 'discard', landed: false });
  const data = useMemo(() => paperGeometry(), []);
  const texture = useMemo(() => pageTexture(flight.page), [flight.page]);
  const start = useMemo(() => new THREE.Vector3(...(flight.kind === 'tear' ? flight.from ?? BOOK_POSITION : GLASS_POSITION)), [flight]);
  const end = useMemo(() => new THREE.Vector3(...paperBallPosition(flight.page.number)), [flight]);
  useEffect(() => () => data.geometry.dispose(), [data]);
  useEffect(() => () => texture.dispose(), [texture]);
  useFrame((_, delta) => {
    if (!mesh.current) return;
    const duration = reducedMotion ? 0.12 : 1.65;
    elapsed.current += Math.min(delta, 0.05);
    const progress = Math.min(1, elapsed.current / duration);
    const fold = reducedMotion ? 1 : ease(Math.min(1, progress / 0.32));
    if (!cues.current.crumpled && (reducedMotion || progress >= 0.12)) {
      cues.current.crumpled = true;
      roomAudio.playSfx('paper-crumple');
    }
    const positions = data.geometry.attributes.position;
    for (let i = 0; i < data.flat.length; i++) positions.array[i] = THREE.MathUtils.lerp(data.flat[i], data.folded[i], fold);
    positions.needsUpdate = true; data.geometry.computeVertexNormals();
    const fall = reducedMotion ? progress : Math.max(0, (progress - 0.32) / 0.68);
    if (!cues.current.landed && fall >= 0.85) {
      cues.current.landed = true;
      roomAudio.playSfx('paper-land');
    }
    mesh.current.position.lerpVectors(start, end, fall);
    mesh.current.position.y = THREE.MathUtils.lerp(start.y, end.y, fall * fall);
    if (fall > 0.85) mesh.current.position.y += Math.sin((fall - 0.85) / 0.15 * Math.PI) * 0.08;
    mesh.current.rotation.set(fall * 5, fall * 4, fall * 2);
    if (progress >= 1) onComplete();
  });
  return <mesh ref={mesh} geometry={data.geometry} castShadow receiveShadow>
    <meshStandardMaterial map={texture} color="#f6eddb" roughness={1} side={THREE.DoubleSide} flatShading />
  </mesh>;
}
