import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { ScheduleTask, StripPlacement } from './schedule';
import { tornEdge, type StripGesture } from './stripState';

export const STRIP_WIDTH = 0.184;
export const STRIP_HEIGHT = 0.098;
export interface MovingStrip {
  gesture: StripGesture;
  task: ScheduleTask;
  date: string;
  position: THREE.Vector3;
  rotation: number;
  lift: number;
  target: 'book' | 'desk' | 'glass' | null;
}
export function stripGeometry(seed = 0) {
  const geometry = new THREE.PlaneGeometry(STRIP_WIDTH, STRIP_HEIGHT, 64, 8);
  const positions = geometry.attributes.position;
  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i), y = positions.getY(i);
    if (Math.abs(y) > STRIP_HEIGHT * 0.49) positions.setY(i, y + tornEdge((x / STRIP_WIDTH + 0.5), seed) * 0.32);
  }
  const flat = new Float32Array(positions.array);
  (positions as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
  return { geometry, flat };
}
function shadowTexture() {
  const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.filter = 'blur(5px)'; ctx.fillStyle = '#594530'; ctx.fillRect(8, 8, 112, 48);
  return new THREE.CanvasTexture(canvas);
}
const priorityLabels = { low: '从容', normal: '日常', high: '优先' };
export function stripTexture(task: ScheduleTask, date: string) {
  const canvas = document.createElement('canvas'); canvas.width = 920; canvas.height = 490;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#f5efdf'; ctx.fillRect(0, 0, 920, 490);
  for (let i = 0; i < 8500; i++) {
    ctx.fillStyle = i % 3 ? '#9b81550b' : '#ffffff50'; ctx.fillRect(i * 173.9 % 920, i * 97.7 % 490, 1.4, 1.4);
  }
  const wrap = (text: string, width: number) => {
    const rows: string[] = []; let row = '';
    for (const char of Array.from(text)) {
      if (char === '\n' || ctx.measureText(row + char).width > width) { rows.push(row); row = char === '\n' ? '' : char; } else row += char;
    }
    rows.push(row); return rows;
  };
  let titleSize = 51, title: string[] = [];
  do { ctx.font = `${titleSize}px "Songti SC", serif`; title = wrap(task.title, 828); if (title.length <= 2) break; titleSize--; } while (titleSize > 28);
  ctx.fillStyle = '#414b3c'; title.forEach((row, i) => ctx.fillText(row, 46, 70 + i * (titleSize + 7)));
  const timeY = 85 + title.length * (titleSize + 7);
  ctx.font = '36px "Songti SC", serif'; ctx.fillStyle = '#675e49';
  ctx.fillText([task.time, task.endTime].filter(Boolean).join('    —    '), 46, timeY);
  const bodyTop = timeY + 57;
  ctx.fillStyle = '#414b3c';
  let bodySize = 36, body: string[] = [];
  do { ctx.font = `${bodySize}px "Songti SC", serif`; body = wrap(task.content ?? '', 828); if (body.length * (bodySize + 6) <= 410 - bodyTop) break; bodySize--; } while (bodySize > 9);
  body.forEach((row, i) => ctx.fillText(row, 46, bodyTop + i * (bodySize + 6)));
  ctx.strokeStyle = '#c9bda280'; ctx.beginPath(); ctx.moveTo(46, 438); ctx.lineTo(874, 438); ctx.stroke();
  ctx.font = '33px "Songti SC", serif'; ctx.fillStyle = task.priority === 'high' ? '#9b523a' : '#675e49';
  ctx.fillText(priorityLabels[task.priority ?? 'normal'], 46, 469);
  ctx.textAlign = 'right'; ctx.fillText(task.category ?? '', 874, 469);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  return texture;
}

export function TaskStrip({ task, date, placement, motion, initialPosition, reducedMotion, onPointerDown, onReturn }: {
  task: ScheduleTask; date: string; placement?: StripPlacement; initialPosition?: THREE.Vector3; motion?: MutableRefObject<MovingStrip | null>; reducedMotion: boolean;
  onPointerDown?: (event: ThreeEvent<PointerEvent>) => void; onReturn?: () => void;
}) {
  const group = useRef<THREE.Group>(null), shadow = useRef<THREE.Mesh>(null);
  const age = useRef(0), lastBend = useRef(-1);
  const data = useMemo(() => stripGeometry(task.id.length), [task.id]);
  const texture = useMemo(() => stripTexture(task, date), [task, date]);
  const softShadow = useMemo(shadowTexture, []);
  useEffect(() => () => softShadow.dispose(), [softShadow]);
  useEffect(() => () => { data.geometry.dispose(); }, [data]);
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => { age.current = 0; }, [placement]);
  useFrame((_, delta) => {
    if (!group.current) return;
    const moving = motion?.current;
    const glass = placement?.surface === 'glass';
    let bend = 0.0006;
    if (moving) {
      group.current.position.copy(moving.position);
      group.current.rotation.set(-Math.PI / 2, 0, moving.rotation);
      bend = reducedMotion ? 0.001 : 0.009 * moving.lift;
    } else if (placement) {
      age.current = Math.min(1, age.current + Math.min(delta, 0.05) / 0.36);
      const bounce = reducedMotion ? 0 : Math.sin(age.current * Math.PI * 2) * (1 - age.current) * 0.004;
      group.current.position.set(...placement.position);
      if (initialPosition && !reducedMotion) group.current.position.lerp(initialPosition, (1 - age.current) ** 3);
      if (glass) group.current.position.z += bounce; else group.current.position.y += bounce;
      group.current.rotation.set(glass ? 0 : -Math.PI / 2, 0, placement.rotation);
      bend = 0.0006 + Math.abs(bounce) * 0.4;
    }
    if (bend === lastBend.current) return;
    lastBend.current = bend;
    // The writing area stays planar. Only the outer fibre margin bends.
    const positions = data.geometry.attributes.position;
    for (let i = 0; i < positions.count; i++) {
      const x = data.flat[i * 3], y = data.flat[i * 3 + 1];
      const edge = Math.max(0, (Math.abs(x) / (STRIP_WIDTH / 2) - 0.82) / 0.18);
      positions.setZ(i, edge * edge * bend + Math.sin(y / STRIP_HEIGHT * Math.PI) * edge * bend * 0.15);
    }
    positions.needsUpdate = true; data.geometry.computeVertexNormals();
    if (shadow.current) shadow.current.scale.setScalar(moving ? 1.06 : 1);
  });
  return <group ref={group} name={`Schedule_Strip_${task.id}`}>
    <mesh ref={shadow} position={[0.002, -0.002, -0.001]}>
      <planeGeometry args={[STRIP_WIDTH * 1.03, STRIP_HEIGHT * 1.04]} />
      <meshBasicMaterial map={softShadow} transparent opacity={motion ? 0.22 : 0.18} depthWrite={false} />
    </mesh>
    <mesh geometry={data.geometry} onPointerDown={onPointerDown} onDoubleClick={event => { event.stopPropagation(); onReturn?.(); }} castShadow receiveShadow>
      <meshBasicMaterial map={texture} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
  </group>;
}
