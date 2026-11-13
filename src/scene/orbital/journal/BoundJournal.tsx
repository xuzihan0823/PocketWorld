import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { BOOK as B, clamp, coverPose, leafPose, paperHalfThickness, smooth } from './bookModel';
import { clothTexture } from './coverTexture';
import type { BoundBookControl } from './bookControl';

function leafGeometry(leafCount: number) {
  const geometry = new THREE.BoxGeometry(B.width, B.height, B.thickness * 0.72, B.segments, 1, 1);
  geometry.translate(B.width / 2, 0, 0);
  const position = geometry.attributes.position, indexes: number[] = [], weights: number[] = [];
  for (let i = 0; i < position.count; i++) {
    // Signatures compress at the sewn edge and fan out towards the fore-edge.
    position.setZ(i, Math.sign(position.getZ(i)) * paperHalfThickness(position.getX(i) / B.width, leafCount));
    const at = clamp(position.getX(i) / B.width) * B.segments;
    const bone = Math.min(B.segments - 1, Math.floor(at));
    indexes.push(bone, bone + 1, 0, 0); weights.push(1 - (at - bone), at - bone, 0, 0);
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(indexes, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
  return geometry;
}

function ribbonGeometry() { return new THREE.PlaneGeometry(1, B.height + 0.05, 40, 1); }

function ribbon(geometry: THREE.PlaneGeometry, points: { x: number; y: number }[]) {
  for (let row = 0; row < 2; row++) for (let i = 0; i < points.length; i++) {
    geometry.attributes.position.setXYZ(row * points.length + i, points[i].x, points[i].y, (row - 0.5) * (B.height + 0.05));
  }
  geometry.attributes.position.needsUpdate = true;
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
}

function paperEdges(geometry: THREE.BufferGeometry, leaves: ReturnType<typeof leafPose>[], cursor: number) {
  const attribute = geometry.attributes.position;
  let vertex = 0;
  const triangle = (a: number[], b: number[], c: number[]) => { for (const point of [a, b, c]) attribute.setXYZ(vertex++, point[0], point[1], point[2]); };
  const quad = (a: number[], b: number[], c: number[], d: number[]) => { triangle(a, b, c); triangle(b, d, c); };
  const ranges = [[0, Math.floor(cursor)], [Math.ceil(cursor), leaves.length]];
  for (const [first, end] of ranges) for (let i = first + 1; i < end; i++) {
    const lower = leaves[i - 1].points, upper = leaves[i].points;
    for (const sign of [-1, 1]) for (let column = 0; column < B.segments; column++) {
      const z = sign * (B.height / 2 + 0.0006), a = lower[column], b = lower[column + 1], c = upper[column], d = upper[column + 1];
      quad([a.x, a.y, z], [b.x, b.y, z], [c.x, c.y, z], [d.x, d.y, z]);
    }
    const a = lower[B.segments], b = upper[B.segments], z = B.height / 2 + 0.0006;
    const offset = i < cursor ? -0.008 : 0.008;
    quad([a.x + offset, a.y, -z], [a.x + offset, a.y, z], [b.x + offset, b.y, -z], [b.x + offset, b.y, z]);
  }
  attribute.needsUpdate = true; geometry.setDrawRange(0, vertex);
  geometry.computeVertexNormals(); geometry.computeBoundingSphere();
}

export function BoundJournal({ opened, control, reducedMotion, leafCount, coverColor = '#45534a', coverLabel = '日  记', coverSubtitle = 'M O M E N T S', turnSpeed = 1.6 }: {
  opened: boolean; control: MutableRefObject<BoundBookControl>; reducedMotion: boolean; leafCount: number;
  coverColor?: string; coverLabel?: string; coverSubtitle?: string; turnSpeed?: number;
}) {
  const cover = useRef<THREE.Group>(null);
  const bookmark = useMemo(() => {
    const ribbon = new THREE.Shape();
    ribbon.moveTo(-0.065, 0.12);
    ribbon.lineTo(-0.065, -0.12);
    ribbon.lineTo(0, -0.083);
    ribbon.lineTo(0.065, -0.12);
    ribbon.lineTo(0.065, 0.12);
    ribbon.closePath();
    return ribbon;
  }, []);
  const state = useRef({ opening: 0, cursor: 0 });
  const drawn = useRef({ opening: -1, cursor: -1, leafCount: 0 });
  const textureRevision = useRef(-1);
  const cloth = useMemo(() => clothTexture(false, coverColor), [coverColor]);
  const title = useMemo(() => clothTexture(true, coverColor, coverLabel, coverSubtitle), [coverColor, coverLabel, coverSubtitle]);
  useEffect(() => () => { cloth.dispose(); title.dispose(); }, [cloth, title]);
  const data = useMemo(() => {
    const geometry = leafGeometry(leafCount);
    const sheets = Array.from({ length: leafCount }, (_, index) => {
      const bones = Array.from({ length: B.segments + 1 }, () => new THREE.Bone());
      for (let i = 1; i < bones.length; i++) { bones[i].position.x = B.width / B.segments; bones[i - 1].add(bones[i]); }
      const edge = new THREE.MeshStandardMaterial({ color: '#eee8d9', roughness: 0.95 });
      const materials = [edge, edge, edge, edge,
        new THREE.MeshStandardMaterial({ color: '#f5f0e1', roughness: 0.94 }),
        new THREE.MeshStandardMaterial({ color: '#f5f0e1', roughness: 0.94 }),
      ];
      const mesh = new THREE.SkinnedMesh(geometry, materials);
      for (const material of materials.slice(4)) {
        // Keep ink legible under the room's bright lamps while the paper still receives light.
        material.onBeforeCompile = shader => {
          shader.fragmentShader = shader.fragmentShader.replace('#include <colorspace_fragment>', `
            #ifdef USE_MAP
              vec3 ink = texture2D(map, vMapUv).rgb;
              float coverage = 1.0 - smoothstep(0.45, 0.75, max(max(ink.r, ink.g), ink.b));
              gl_FragColor.rgb = mix(gl_FragColor.rgb, ink, coverage);
            #endif
            #include <colorspace_fragment>
          `);
        };
        material.customProgramCacheKey = () => 'journal-printed-ink';
      }
      mesh.add(bones[0]); mesh.bind(new THREE.Skeleton(bones));
      mesh.rotation.x = -Math.PI / 2;
      mesh.frustumCulled = false;
      mesh.name = `Journal_Leaf_${index}`;
      mesh.raycast = (raycaster, hits) => {
        if (mesh.visible) THREE.SkinnedMesh.prototype.raycast.call(mesh, raycaster, hits);
      };
      return mesh;
    });
    const edges = new THREE.BufferGeometry();
    edges.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(leafCount * (B.segments * 2 + 1) * 6 * 3), 3));
    return {
      geometry, sheets,
      board: new RoundedBoxGeometry(1.49, B.board, 2.08, 3, 0.009),
      spine: ribbonGeometry(), lining: ribbonGeometry(), edges,
    };
  }, [leafCount]);
  useEffect(() => () => {
    data.geometry.dispose(); data.board.dispose(); data.spine.dispose(); data.lining.dispose(); data.edges.dispose();
    data.sheets.forEach(mesh => {
      mesh.skeleton.dispose();
      new Set(mesh.material as THREE.MeshStandardMaterial[]).forEach(material => material.dispose());
    });
  }, [data]);

  useFrame((_, delta) => {
    const current = state.current;
    const book = control.current;
    const targetCursor = opened ? book.spread : 0;
    if (textureRevision.current !== book.revision || drawn.current.leafCount !== leafCount) {
      textureRevision.current = book.revision;
      data.sheets.forEach((mesh, i) => {
        for (let side = 0; side < 2; side++) {
          const material = (mesh.material as THREE.MeshStandardMaterial[])[4 + side];
          const texture = book.textures.get(i * 2 + side) ?? null;
          if (texture !== material.map) { material.map = texture; material.color.set(texture ? '#ffffff' : '#f5f0e1'); material.needsUpdate = true; }
        }
      });
    }
    const move = (from: number, to: number, speed: number) => (
      from + Math.sign(to - from) * Math.min(Math.abs(to - from), Math.min(delta, 0.05) * speed)
    );
    const openingTarget = Number(opened);
    if (reducedMotion) {
      current.opening = openingTarget;
      current.cursor = targetCursor;
    } else {
      if (opened || current.cursor === 0) current.opening = move(current.opening, openingTarget, 2);
      if (current.opening === 1) current.cursor = move(current.cursor, targetCursor, opened ? turnSpeed : Math.max(5, book.spread * 3));
    }
    const ready = current.cursor === targetCursor && current.opening === openingTarget;
    const justSettled = ready && !book.ready;
    book.cursor = current.cursor;
    book.ready = ready;
    if (justSettled) book.onSettled?.();
    if (drawn.current.opening === current.opening && drawn.current.cursor === current.cursor && drawn.current.leafCount === leafCount) return;
    drawn.current = { ...current, leafCount };
    const pose = coverPose(current.opening);
    cover.current!.position.set(pose.x, pose.y, 0); cover.current!.rotation.z = pose.angle;
    const leaves = [];
    for (let index = 0; index < data.sheets.length; index++) {
      const turn = clamp(current.cursor - index), leaf = leafPose(index, turn, current.opening, current.cursor, leafCount);
      leaves.push(leaf);
      const mesh = data.sheets[index];
      // The edge mesh fills each stack, so only the exposed sheets need skinning.
      mesh.visible = index >= Math.floor(current.cursor) - 1 && index <= Math.ceil(current.cursor);
      if (!mesh.visible) continue;
      mesh.position.set(leaf.points[0].x, leaf.points[0].y, 0);
      const bones = mesh.skeleton.bones;
      for (let j = 0; j < bones.length; j++) {
        bones[j].rotation.y = -(leaf.angles[j] - (j ? leaf.angles[j - 1] : 0));
      }
      // Raycasting must use the new deformed bounds after a sheet changes sides.
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const point of leaf.points) {
        minX = Math.min(minX, point.x); maxX = Math.max(maxX, point.x);
        minY = Math.min(minY, point.y); maxY = Math.max(maxY, point.y);
      }
      if (!mesh.boundingSphere) mesh.boundingSphere = new THREE.Sphere();
      mesh.boundingSphere.center.set((minX + maxX) / 2 - leaf.points[0].x, 0, (minY + maxY) / 2 - leaf.points[0].y);
      mesh.boundingSphere.radius = Math.hypot(maxX - minX, B.height, maxY - minY) / 2 + B.thickness;
      mesh.receiveShadow = true;
      mesh.castShadow = true;
    }
    paperEdges(data.edges, leaves, current.cursor);
    const amount = smooth(current.opening);
    ribbon(data.spine, Array.from({ length: 41 }, (_, i) => {
      const u = i / 40;
      return { x: 0.045 * (1 - u) + pose.x * u - 0.075 * Math.sin(Math.PI * u) * (1 - amount), y: B.board / 2 * (1 - u) + pose.y * u - 0.003 * amount * Math.sin(Math.PI * u) };
    }));
    const relaxed = smooth((current.opening - 0.25) / 0.75);
    ribbon(data.lining, Array.from({ length: 41 }, (_, i) => {
      const angle = Math.PI * i / 40;
      return { x: (0.06 - 0.018 * Math.sin(angle)) * (1 - relaxed) + B.spineRadius * Math.cos(angle) * relaxed, y: (B.base + B.leaves * B.thickness * i / 40) * (1 - relaxed) + (B.base + B.spineRadius * Math.sin(angle)) * relaxed - 0.002 };
    }));
  });

  const boardMaterial = <meshStandardMaterial map={cloth} roughness={0.9} />;
  const pointer = (leaf: number, event: ThreeEvent<PointerEvent | WheelEvent>, kind: 'down' | 'move' | 'up' | 'wheel') => {
    if (!opened) return;
    if (!control.current.onPaperPointer) { event.stopPropagation(); return; }
    if (!control.current.ready || !event.uv || !event.face || event.face.materialIndex < 4) { event.stopPropagation(); return; }
    const page = leaf * 2 + (event.face.materialIndex === 5 ? 1 : 0);
    const native = event.nativeEvent;
    const handled = 'deltaY' in native
      ? control.current.onPaperPointer(page, event.uv.x, 1 - event.uv.y, kind, event.shiftKey, native.deltaY)
      : control.current.onPaperPointer(page, event.uv.x, 1 - event.uv.y, kind, event.shiftKey, undefined, native);
    if (handled !== false) event.stopPropagation();
  };
  return <group name="Journal_Binding">
    <mesh position={[0.045 + 1.49 / 2, B.board / 2, 0]} geometry={data.board} castShadow receiveShadow>{boardMaterial}</mesh>
    <mesh position={[0.78, B.board + 0.001, 0]} rotation-x={-Math.PI / 2} receiveShadow>
      <planeGeometry args={[1.43, 2.01]} /><meshStandardMaterial color="#d7d8bc" roughness={1} />
    </mesh>
    <mesh position={[0, B.board / 2, 0]} castShadow receiveShadow>
      <boxGeometry args={[0.10, B.board, 2.08]} />
      {boardMaterial}
    </mesh>
    <mesh geometry={data.spine} castShadow><meshStandardMaterial map={cloth} roughness={0.95} side={THREE.DoubleSide} /></mesh>
    <mesh geometry={data.lining}><meshStandardMaterial color="#b8b8a1" side={THREE.DoubleSide} roughness={1} /></mesh>
    {data.sheets.map((mesh, i) => <primitive key={mesh.name} object={mesh} onPointerDown={(event: ThreeEvent<PointerEvent>) => pointer(i, event, 'down')} onPointerMove={(event: ThreeEvent<PointerEvent>) => pointer(i, event, 'move')} onPointerUp={(event: ThreeEvent<PointerEvent>) => pointer(i, event, 'up')} onWheel={(event: ThreeEvent<WheelEvent>) => pointer(i, event, 'wheel')} />)}
    <mesh name="Journal_PageEdges" geometry={data.edges} receiveShadow><meshStandardMaterial color="#e9e2d0" roughness={0.97} side={THREE.DoubleSide} /></mesh>
    <mesh position={[0.61, B.base + 0.001, 1.02]} rotation={[-Math.PI / 2, 0, 0.08]} receiveShadow>
      <shapeGeometry args={[bookmark]} />
      <meshStandardMaterial color="#91402b" roughness={0.9} side={THREE.DoubleSide} />
    </mesh>
    <group ref={cover} name="Journal_Cover">
      <mesh geometry={data.board} position={[1.49 / 2, 0, 0]} castShadow receiveShadow>{boardMaterial}</mesh>
      <mesh position={[1.49 / 2, B.board / 2 + 0.0003, 0]} rotation-x={-Math.PI / 2}>
        <planeGeometry args={[1.475, 2.064]} /><meshStandardMaterial map={title} roughness={0.86} />
      </mesh>
      <mesh position={[0.75, -B.board / 2 - 0.0005, 0]} rotation-x={Math.PI / 2} receiveShadow>
        <planeGeometry args={[1.43, 2.01]} /><meshStandardMaterial color="#d7d8bc" roughness={1} />
      </mesh>
    </group>
  </group>;
}
