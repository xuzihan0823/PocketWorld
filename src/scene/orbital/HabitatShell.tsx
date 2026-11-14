import React, { useEffect, useMemo, useRef } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { SoftBox } from './Primitives';
import { applyOakGrain } from './shaders/oak';
import { useWallVisibility } from './walls/useWallVisibility';
import type { Vec3, WallTag } from './walls/wallVisibility';

export interface HabitatShellProps {
  variant: 'habitat' | 'observatory';
  /** Floor hit in this shell's local coordinate system, with y fixed at zero. */
  onFloorClick?: (p: [number, number, number]) => void;
}

function roundedPath(width: number, height: number, radius: number, cx = 0, cy = 0): THREE.Shape {
  const s = new THREE.Shape();
  const x = cx - width / 2, y = cy - height / 2;
  s.moveTo(x + radius, y);
  s.lineTo(x + width - radius, y);
  s.quadraticCurveTo(x + width, y, x + width, y + radius);
  s.lineTo(x + width, y + height - radius);
  s.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  s.lineTo(x + radius, y + height);
  s.quadraticCurveTo(x, y + height, x, y + height - radius);
  s.lineTo(x, y + radius);
  s.quadraticCurveTo(x, y, x + radius, y);
  s.closePath();
  return s;
}

function frameShape(width: number, height: number, apertureWidth: number, apertureHeight: number, radius: number, apertureOffset = 0): THREE.Shape {
  const shape = roundedPath(width, height, radius, 0, height / 2);
  shape.holes.push(roundedPath(apertureWidth, apertureHeight, Math.min(radius, 0.42), apertureOffset, 1.94));
  return shape;
}

function doorwayShape(width: number, height: number, doorWidth: number, doorHeight: number, doorOffset: number, radius: number): THREE.Shape {
  const shape = roundedPath(width, height, radius, 0, height / 2);
  shape.holes.push(roundedPath(doorWidth, doorHeight - 0.06, 0.06, doorOffset, 0.06 + (doorHeight - 0.06) / 2));
  return shape;
}

function windowRing(width: number, height: number, border: number, radius: number): THREE.Shape {
  const ring = roundedPath(width, height, radius);
  ring.holes.push(roundedPath(width - border * 2, height - border * 2, radius - border));
  return ring;
}

const NO_RAYCAST = () => undefined;

const EXTRUDE = { depth: 0.2, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: 0.045, bevelThickness: 0.035, curveSegments: 16 };

/** userData tags read by useWallVisibility; normals point out of the room. */
const WALL = {
  back: { wall: { id: 'back', normal: [0, 0, -1] } },
  front: { wall: { id: 'front', normal: [0, 0, 1] } },
  left: { wall: { id: 'left', normal: [-1, 0, 0] } },
  right: { wall: { id: 'right', normal: [1, 0, 0] } },
} satisfies Record<string, { wall: WallTag }>;

/** Interior sight-line targets: the room centre plus low and high points near each corner. */
const ROOM_SAMPLES: readonly Vec3[] = [[0, 1.2, 0],
  ...[-3.5, 3.5].flatMap(x => [-2.7, 2.7].flatMap(z => [[x, 0.3, z], [x, 2.2, z]] as Vec3[]))];

/** Architecture only. A closed shell whose walls fade out of the camera's way; the right wall holds the hatch. */
export const HabitatShell: React.FC<HabitatShellProps> = ({ variant, onFloorClick }) => {
  const root = useRef<THREE.Group>(null);
  useWallVisibility(root, ROOM_SAMPLES);
  const shapes = useMemo(() => ({
    floor: roundedPath(8.4, 6.8, 0.55),
    base: roundedPath(8.8, 7.2, 0.72),
    edge: windowRing(8.75, 7.15, 0.12, 0.7),
    back: frameShape(8.7, 3.5, 7.7, 2.3, 0.58),
    front: roundedPath(8.7, 3.5, 0.58, 0, 1.75),
    // Side walls run the full depth (z −3.39/−3.58 → 3.39); openings keep their original world positions.
    side: frameShape(6.78, 3.5, 3.48, 2.3, 0.58, 1.14),
    hatchWall: doorwayShape(6.97, 3.5, 1.26, 2.38, -1.505, 0.58),
    backCollar: windowRing(8.02, 2.64, 0.2, 0.55),
    backSeal: windowRing(7.72, 2.34, 0.044, 0.4),
    sideCollar: windowRing(3.8, 2.64, 0.2, 0.55),
    sideSeal: windowRing(3.5, 2.34, 0.044, 0.4),
    backGlass: roundedPath(7.68, 2.3, 0.39),
    sideGlass: roundedPath(3.46, 2.3, 0.39),
  }), []);
  const boards = useMemo(() => {
    const result: THREE.Shape[] = [];
    for (let row = 0; row < 17; row++) {
      const y0 = -3.36 + row * (6.72 / 17) + 0.003;
      const y1 = y0 + 6.72 / 17 - 0.006;
      const stagger = row % 2 ? 0.64 : -0.64;
      const edges = [-4.16, -2.6 + stagger, stagger, 2.6 + stagger, 4.16];
      for (let column = 0; column < edges.length - 1; column++) {
        const points: THREE.Vector2[] = [];
        for (let side = 0; side < 2; side++) {
          for (let sample = 0; sample <= 8; sample++) {
            const t = (side ? 8 - sample : sample) / 8;
            const y = THREE.MathUtils.lerp(y0, y1, t);
            const corner = Math.max(0, Math.abs(y) - 2.81);
            const halfWidth = 3.61 + Math.sqrt(Math.max(0, 0.55 ** 2 - corner ** 2));
            const x = THREE.MathUtils.clamp(edges[column + side] + (side ? -0.003 : 0.003), -halfWidth, halfWidth);
            points.push(new THREE.Vector2(x, y));
          }
        }
        result.push(new THREE.Shape(points));
      }
    }
    return result;
  }, []);
  const floorGeometry = useMemo(() => {
    const palette = variant === 'habitat' ? ['#d5c3a5', '#d8c7aa', '#d3c1a3', '#d7c5a8'] : ['#ccc5b0', '#d1c9b6', '#c9c2ae', '#cfc7b3'];
    const pieces = boards.map((board, index) => {
      const geometry = new THREE.ExtrudeGeometry(board, { depth: 0.012, bevelEnabled: false, steps: 1 });
      const color = new THREE.Color(palette[index % palette.length]);
      const colors = new Float32Array(geometry.attributes.position.count * 3);
      for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
      geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return geometry;
    });
    const merged = mergeGeometries(pieces);
    pieces.forEach(piece => piece.dispose());
    if (!merged) throw new Error('Floor geometry could not be merged');
    return merged;
  }, [boards, variant]);
  useEffect(() => () => floorGeometry.dispose(), [floorGeometry]);
  const floorPress = useRef(false);
  useEffect(() => {
    const reset = () => { floorPress.current = false; };
    window.addEventListener('pointerdown', reset, true);
    window.addEventListener('pointercancel', reset);
    return () => { window.removeEventListener('pointerdown', reset, true); window.removeEventListener('pointercancel', reset); };
  }, []);
  const onClick = (event: ThreeEvent<MouseEvent>) => {
    const startedOnFloor = floorPress.current; floorPress.current = false;
    if (!startedOnFloor || !onFloorClick || event.delta > 5 || !root.current) return;
    event.stopPropagation();
    const point = root.current.worldToLocal(event.point.clone());
    onFloorClick([point.x, 0, point.z]);
  };
  const cream = variant === 'habitat' ? '#eee9dd' : '#e5e7e2';
  return (
    <group ref={root} name={`${variant}-shell`}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.4, 0]} castShadow receiveShadow>
        <extrudeGeometry args={[shapes.base, { ...EXTRUDE, depth: 0.3 }]} />
        <meshStandardMaterial color="#555d60" metalness={0.72} roughness={0.38} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.108, 0]} receiveShadow onPointerDown={() => { floorPress.current = true; }} onClick={onClick}>
        <extrudeGeometry args={[shapes.floor, { ...EXTRUDE, depth: 0.055, bevelThickness: 0.035 }]} />
        <meshStandardMaterial color="#a69883" roughness={0.85} />
      </mesh>
      {/* Separate 12 mm boards with 6 mm open joints above the recessed substrate. */}
      <mesh geometry={floorGeometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.012, 0]} receiveShadow onPointerDown={() => { floorPress.current = true; }} onClick={onClick}>
        <meshStandardMaterial vertexColors roughness={0.68} onBeforeCompile={applyOakGrain} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.11, 0]} castShadow>
        <extrudeGeometry args={[shapes.edge, { ...EXTRUDE, depth: 0.025, bevelSize: 0.015, bevelThickness: 0.012 }]} />
        <meshStandardMaterial color={cream} roughness={0.38} metalness={0.15} />
      </mesh>
      <mesh position={[0, 0, -3.58]} userData={WALL.back} castShadow receiveShadow>
        <extrudeGeometry args={[shapes.back, EXTRUDE]} />
        <meshStandardMaterial color={cream} roughness={0.44} />
      </mesh>
      <mesh position={[-4.38, 0, 0]} rotation={[0, Math.PI / 2, 0]} userData={WALL.left} castShadow receiveShadow>
        <extrudeGeometry args={[shapes.side, EXTRUDE]} />
        <meshStandardMaterial color={cream} roughness={0.44} />
      </mesh>
      <mesh position={[0, 0, 3.38]} userData={WALL.front} castShadow receiveShadow>
        <extrudeGeometry args={[shapes.front, EXTRUDE]} />
        <meshStandardMaterial color={cream} roughness={0.44} />
      </mesh>
      {/* A deep ceramic collar, inset dark pressure seal, and a restrained pane:
          the aperture is physically empty, never a black rectangle or backdrop. */}
      {[{ side: false, collar: shapes.backCollar, seal: shapes.backSeal, glass: shapes.backGlass },
        { side: true, collar: shapes.sideCollar, seal: shapes.sideSeal, glass: shapes.sideGlass }].map(({ side, collar, seal, glass }) => (
        <group key={side ? 'port-window' : 'panorama-window'} userData={side ? WALL.left : WALL.back}
          position={side ? [-4.14, 1.94, -1.14] : [0, 1.94, -3.34]}
          rotation={[0, side ? Math.PI / 2 : 0, 0]}>
          <mesh castShadow receiveShadow>
            <extrudeGeometry args={[collar, { ...EXTRUDE, depth: 0.08, bevelSize: 0.025, bevelThickness: 0.025 }]} />
            <meshStandardMaterial color={cream} roughness={0.4} metalness={0.07} />
          </mesh>
          <mesh position={[0, 0, -0.055]}>
            <extrudeGeometry args={[seal, { ...EXTRUDE, depth: 0.045, bevelSize: 0.009, bevelThickness: 0.009 }]} />
            <meshStandardMaterial color="#5a6465" roughness={0.55} metalness={0.3} />
          </mesh>
          <mesh position={[0, 0, -0.075]} raycast={NO_RAYCAST}>
            <shapeGeometry args={[glass, 24]} />
            <meshPhysicalMaterial color="#b7d4d6" transparent opacity={0.035} roughness={0.12}
              metalness={0} clearcoat={0.5} clearcoatRoughness={0.1} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        </group>
      ))}
      <SoftBox dims={[8.15, 0.1, 0.19]} position={[0, 0.12, -3.25]} radius={0.025} color="#d4d1c5" metalness={0.25} />
      <SoftBox dims={[0.2, 0.1, 4.28]} position={[-4.08, 0.12, -1.14]} radius={0.025} color="#d4d1c5" metalness={0.25} />
      <SoftBox dims={[0.33, 0.12, 4.12]} position={[-4.07, 0.65, -1.14]} radius={0.04} color="#d3be99" />
      {/* Ceiling-height cornice and its light line belong to the back wall and fade with it. */}
      <SoftBox dims={[7.8, 0.14, 0.23]} position={[0, 3.31, -3.27]} radius={0.045} color={cream} userData={WALL.back} />
      <mesh position={[0, 3.245, -3.21]} rotation={[Math.PI / 2, 0, 0]} userData={WALL.back} raycast={NO_RAYCAST}>
        <planeGeometry args={[7.45, 0.04]} />
        <meshBasicMaterial color="#ffe8c6" toneMapped={false} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[-3.965, 0.18, -1.14]} raycast={NO_RAYCAST}>
        <boxGeometry args={[0.016, 0.027, 4.04]} />
        <meshBasicMaterial color="#ffe5b1" toneMapped={false} />
      </mesh>
      <SoftBox dims={[7.95, 0.13, 0.36]} position={[0, 0.65, -3.26]} radius={0.045} color="#d3be99" roughness={0.6} />
      <mesh position={[0, 0.15, -3.31]}>
        <boxGeometry args={[7.9, 0.035, 0.025]} />
        <meshBasicMaterial color="#ffe5b1" toneMapped={false} />
      </mesh>
      {[-3.4, 0, 3.4].map((x) => (
        <mesh key={x} position={[x, -0.52, 0]} castShadow>
          <boxGeometry args={[0.18, 0.2, 6.4]} />
          <meshStandardMaterial color="#48545b" metalness={0.8} roughness={0.32} />
        </mesh>
      ))}
      <mesh position={[4.38, 0, -0.095]} rotation={[0, -Math.PI / 2, 0]} userData={WALL.right} castShadow receiveShadow>
        <extrudeGeometry args={[shapes.hatchWall, EXTRUDE]} />
        <meshStandardMaterial color={cream} roughness={0.44} />
      </mesh>
      <SoftBox dims={[8.32, 0.17, 0.13]} position={[0, -0.27, 3.53]} radius={0.045} color={cream} roughness={0.38} metalness={0.12} />
      <SoftBox dims={[0.13, 0.17, 6.48]} position={[4.33, -0.27, 0]} radius={0.045} color={cream} roughness={0.38} metalness={0.12} />
      {[-3.45, -2.3, -1.15, 0, 1.15, 2.3, 3.45].map((x) => (
        <mesh key={`fastener-${x}`} position={[x, -0.27, 3.605]} raycast={NO_RAYCAST}>
          <cylinderGeometry args={[0.022, 0.022, 0.009, 12]} />
          <meshStandardMaterial color="#7d8584" metalness={0.8} roughness={0.3} />
        </mesh>
      ))}
    </group>
  );
};
