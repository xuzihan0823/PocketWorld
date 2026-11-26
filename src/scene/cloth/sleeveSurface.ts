import * as T from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { sleeveSurfaceMask } from './sleeveMask';

/** Ribbon asset adapter. Pose/morph matrices must be current before measuring a step. */
export function createSleeveAudit(mesh: T.SkinnedMesh) {
  const { sleeve, torso, skin } = sleeveSurfaceMask(mesh);
  const facing = mesh.parent?.children.find(o => o instanceof T.SkinnedMesh &&
    ([] as T.Material[]).concat(o.material).some(m => m.name.includes('Ivory underarm facing'))) as T.SkinnedMesh | undefined;
  if (!facing) throw new Error('缺少 Ivory underarm facing');
  const p = mesh.geometry.attributes.position, lining = facing.geometry.attributes.position, n = p.count;
  const position = new T.Float32BufferAttribute(new Float32Array((n + lining.count) * 3), 3);
  const weld = new Uint32Array(position.count), keyIds = new Map<string,number>();
  const fromLining = new T.Matrix4();
  const v = new T.Vector3(), a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  function transformLining() { fromLining.copy(mesh.matrixWorld).invert().multiply(facing!.matrixWorld); }
  transformLining();
  for (let i = 0; i < position.count; i++) {
    if (i < n) v.fromBufferAttribute(p,i);
    else v.fromBufferAttribute(lining,i-n).applyMatrix4(fromLining);
    position.setXYZ(i,v.x,v.y,v.z);
    const key = `${Math.round(v.x*1e5)},${Math.round(v.y*1e5)},${Math.round(v.z*1e5)}`;
    if (!keyIds.has(key)) keyIds.set(key,keyIds.size);
    weld[i] = keyIds.get(key)!;
  }
  const ids = mesh.geometry.index!, facingIds = facing.geometry.index!;
  const sleeveIndices: number[] = [], obstacleIndices: number[] = [];
  const counts = { outer: 0, inward: 0, rim: 0, torso: 0, facing: 0, skin: 0, boundary: 0 };
  const faceClass = new Uint8Array(ids.count / 3);
  const shoulder = new T.Vector3(0.068,0.744,0.019);
  const axis = new T.Vector3(0.208,0.555,0.027).sub(shoulder).normalize();
  const center = new T.Vector3();
  for (let i = 0; i < ids.count; i += 3) {
    const x = ids.getX(i), y = ids.getX(i+1), z = ids.getX(i+2);
    if (sleeve.has(x) && sleeve.has(y) && sleeve.has(z)) {
      sleeveIndices.push(x,y,z);
      a.fromBufferAttribute(p,x); b.fromBufferAttribute(p,y); c.fromBufferAttribute(p,z);
      center.copy(a).add(b).add(c).multiplyScalar(1/3).sub(shoulder);
      center.addScaledVector(axis,-center.dot(axis)).normalize();
      const orientation = v.crossVectors(b.sub(a),c.sub(a)).normalize().dot(center);
      const label = orientation < -0.25 ? 'inward' : orientation > 0.25 ? 'outer' : 'rim';
      counts[label]++;
      faceClass[i / 3] = label === 'outer' ? 1 : label === 'inward' ? 2 : 3;
    } else if (torso.has(x) && torso.has(y) && torso.has(z)) {
      obstacleIndices.push(x,y,z); counts.torso++;
      faceClass[i / 3] = 4;
    } else if (skin.has(x) && skin.has(y) && skin.has(z)) { counts.skin++; faceClass[i / 3] = 5; }
    else if (sleeve.has(x) || sleeve.has(y) || sleeve.has(z)) counts.boundary++;
  }
  const leftFacingFaces: number[] = [];
  for (let i = 0; i < facingIds.count; i += 3) {
    const x = facingIds.getX(i), y = facingIds.getX(i+1), z = facingIds.getX(i+2);
    if (Math.min(lining.getX(x),lining.getX(y),lining.getX(z)) <= 0) continue;
    obstacleIndices.push(n+x,n+y,n+z); counts.facing++;
    leftFacingFaces.push(i / 3);
  }
  const used = [...new Set([...sleeveIndices,...obstacleIndices])];
  const base = new Float32Array(position.array.length), identity = new T.Matrix4();
  function tree(indices: number[]) {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position',position); geometry.setIndex(indices);
    const bvh = new MeshBVH(geometry, { maxLeafTris: 4 });
    // BVH construction permutes the index. This order is stable for all refits in this audit.
    return { bvh, index: geometry.index!.array };
  }
  let legacyTrees: { cloth: ReturnType<typeof tree>; obstacle: ReturnType<typeof tree> } | undefined;
  function intersections(offset?: Float32Array) {
    for (const id of used) {
      const k = 3 * id;
      v.fromArray(base,k);
      if (offset && id < n) v.add(a.fromArray(offset,k));
      position.setXYZ(id,v.x,v.y,v.z);
    }
    const { cloth, obstacle } = legacyTrees ??= { cloth: tree(sleeveIndices), obstacle: tree(obstacleIndices) };
    cloth.bvh.refit(); obstacle.bvh.refit();
    const pairs = new Set<number>();
    let liningPairs = 0;
    cloth.bvh.bvhcast(obstacle.bvh,identity,{intersectsTriangles(t1,t2,i,j) {
      for (let u = 0; u < 3; u++) for (let w = 0; w < 3; w++)
        if (weld[cloth.index[3*i+u]] === weld[obstacle.index[3*j+w]]) return false;
      if (t1.intersectsTriangle(t2)) {
        if (obstacle.index[3*j] >= n) liningPairs++;
        else pairs.add(i * obstacleIndices.length + j);
      }
      return false;
    }});
    return { pairs, liningPairs };
  }
  // Distal boundary of the sleeve selection and split render edges at identical bind positions.
  const cuffEdges = new Map<string, { a: number; b: number; count: number; split: boolean }>();
  for (let i = 0; i < sleeveIndices.length; i += 3) for (let j = 0; j < 3; j++) {
    const a = sleeveIndices[i+j], b = sleeveIndices[i+(j+1)%3];
    if (Math.max(p.getY(a),p.getY(b)) > 0.58) continue;
    const key = `${Math.min(weld[a],weld[b])},${Math.max(weld[a],weld[b])}`;
    const edge = cuffEdges.get(key);
    if (!edge) cuffEdges.set(key,{a,b,count:1,split:false});
    else { edge.count++; edge.split ||= (a !== edge.a && a !== edge.b) || (b !== edge.a && b !== edge.b); }
  }
  const cuffBoundary = [...cuffEdges.values()].filter(e => e.count === 1 || e.split);
  function markedPose(offset?: Float32Array) {
    const xyz: number[] = [], rgb: number[] = [];
    const colors = ['#000000','#56bdcb','#9a68ba','#dcaa42','#6885aa','#edb290','#bfd17a'].map(s => new T.Color(s));
    function triangle(source: T.SkinnedMesh, index: T.BufferAttribute, k: number, label: number) {
      const color = colors[label];
      for (let j = 0; j < 3; j++) {
        const id = index.getX(k+j);
        source.getVertexPosition(id,v);
        if (source === mesh && offset) v.add(a.fromArray(offset,3*id));
        v.applyMatrix4(source.matrixWorld);
        xyz.push(v.x,v.y,v.z); rgb.push(color.r,color.g,color.b);
      }
    }
    for (let i = 0; i < faceClass.length; i++) if (faceClass[i]) triangle(mesh, ids, 3*i, faceClass[i]);
    for (let i = 0; i < facingIds.count; i += 3) {
      if ([0,1,2].every(j => lining.getX(facingIds.getX(i+j)) > 0)) triangle(facing!, facingIds, i, 6);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.Float32BufferAttribute(xyz,3));
    geometry.setAttribute('color', new T.Float32BufferAttribute(rgb,3));
    const marked = new T.Mesh(geometry,new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide }));
    const linePositions: number[] = [];
    for (const edge of cuffBoundary) for (const id of [edge.a,edge.b]) {
      mesh.getVertexPosition(id,v);
      if (offset) v.add(a.fromArray(offset,3*id));
      v.applyMatrix4(mesh.matrixWorld); linePositions.push(v.x,v.y,v.z);
    }
    const lines = new T.BufferGeometry();
    lines.setAttribute('position',new T.Float32BufferAttribute(linePositions,3));
    const seam = new T.LineSegments(lines,new T.LineBasicMaterial({color:0xef414c,depthTest:false}));
    seam.renderOrder = 2; marked.add(seam);
    return marked;
  }
  let detailed: ReturnType<typeof createClassifiedSleeveAudit> | undefined;
  function stages() {
    return detailed ??= createClassifiedSleeveAudit(mesh, facing!, faceClass, leftFacingFaces);
  }
  return { counts, markedPose, facing, cuffBoundary,
    get mapping() { return stages().mapping; },
    measureStages(input: SleeveAuditInput, options?: SleeveAuditOptions) {
      return stages().measureStages(input, options);
    },
    measure(raw: Float32Array, final: Float32Array) {
    transformLining();
    for (const id of used) {
      if (id < n) mesh.getVertexPosition(id,v);
      else facing.getVertexPosition(id-n,v).applyMatrix4(fromLining);
      v.toArray(base,3*id);
    }
    const original = intersections(), mapped = intersections(raw), visible = intersections(final);
    let retained = 0;
    for (const pair of visible.pairs) if (mapped.pairs.has(pair)) retained++;
    return { skinned: original.pairs.size, raw: mapped.pairs.size, final: visible.pairs.size,
      added: visible.pairs.size - retained, removed: mapped.pairs.size - retained,
      facing: [original.liningPairs,mapped.liningPairs,visible.liningPairs], counts };
  }};
}

export const sleeveStages = ['skinned', 'proxy', 'raw', 'blend', 'shell', 'final'] as const;
export type SleeveStage = typeof sleeveStages[number];
type Region = 'shoulder' | 'upperArm' | 'elbow' | 'forearm' | 'cuff' | 'underarm' | 'torso' | 'wristHand' | 'unmapped';
type Surface = 'outer' | 'inward' | 'rim' | 'torso' | 'facing' | 'skin' | 'proxy';
type XYZ = [number, number, number];

export interface SleeveAuditInput {
  /** Absolute displacements from the same posed main vertices, in post-skin mesh-local space. */
  raw: Float32Array;
  blend: Float32Array;
  shell: Float32Array;
  final: Float32Array;
  limited?: Float32Array;
  /** Optional bind-pose main vertex for each proxy particle, as supplied by Region.sleeveLayers. */
  driverVertices?: ArrayLike<number>;
  /** Particle coordinates are world metres. Reuse topology across calls and treat it as immutable. */
  proxy: T.Mesh | { positions: Float32Array; triangles: ArrayLike<number>; driverVertices?: ArrayLike<number> };
}
export interface SleeveAuditOptions {
  /** Deepest witnesses per contact class and stage. Infinity returns every pair. Counts are always complete. */
  recordLimit?: number;
}

interface Vertex {
  id: number;
  weld: number;
  bind: T.Vector3;
  base: T.Vector3;
  point: T.Vector3;
  uv?: T.Vector2;
  dirty: boolean;
}
interface Face {
  id: number; // Original primitive triangle number, independent of BVH order.
  mesh: string;
  material: string;
  surface: Surface;
  region: Region;
  hasBind: boolean;
  vertices: [Vertex, Vertex, Vertex];
  triangle: T.Triangle;
  bounds: T.Box3;
  normal: T.Vector3;
}
function makeFace(id: number, mesh: string, material: string, surface: Surface, vertices: Face['vertices']): Face {
  return { id, mesh, material, surface, region: 'unmapped', hasBind: surface !== 'proxy', vertices,
    triangle: new T.Triangle(vertices[0].point, vertices[1].point, vertices[2].point),
    bounds: new T.Box3(), normal: new T.Vector3() };
}
function newVertex(id: number): Vertex {
  return { id, weld: -1, bind: new T.Vector3(), base: new T.Vector3(), point: new T.Vector3(), dirty: true };
}
function materialOf(mesh: T.Mesh, face: number) {
  if (!Array.isArray(mesh.material)) return mesh.material.name;
  const group = mesh.geometry.groups.find(g => 3 * face >= g.start && 3 * face < g.start + g.count);
  return mesh.material[group?.materialIndex ?? 0]?.name ?? '';
}

/** Private non-indexed triangle soup keeps the immutable source face number through the BVH permutation. */
function faceTree(faces: Face[]) {
  const geometry = new T.BufferGeometry();
  const values = new Float32Array(faces.length * 9);
  geometry.setAttribute('position', new T.BufferAttribute(values, 3));
  let bvh: MeshBVH | undefined;
  let order: Face[] = [];
  function refit() {
    let changed = false;
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i], [a, b, c] = f.vertices;
      if (bvh && !a.dirty && !b.dirty && !c.dirty) continue;
      changed = true;
      a.point.toArray(values, 9*i); b.point.toArray(values, 9*i+3); c.point.toArray(values, 9*i+6);
      f.bounds.makeEmpty().expandByPoint(a.point).expandByPoint(b.point).expandByPoint(c.point);
      f.triangle.getNormal(f.normal);
    }
    if (!changed) return;
    if (bvh) bvh.refit();
    else {
      bvh = new MeshBVH(geometry, { maxLeafTris: 4, setBoundingBox: false });
      order = Array.from({ length: faces.length }, (_, i) => faces[geometry.index!.getX(3*i) / 3]);
    }
  }
  return { refit, get bvh() { return bvh; }, get order() { return order; } };
}
type FaceTree = ReturnType<typeof faceTree>;

// For open sheets a solid inside and a unique volumetric penetration do not exist. At a proper
// crossing, clip the source triangle to the target's finite triangular prism. Depth is the farthest
// clipped source point behind the wound target plane in metres. Changing target winding changes it.
const crossingEpsilon = 1e-8; // metres; coplanar overlap, isolated point and edge-only touch are excluded.
function crossingWitness() {
  const buffers = Array.from({ length: 2 }, () => Array.from({ length: 8 }, () => new T.Vector3()));
  const cutNormal = new T.Vector3(), edge = new T.Vector3(), hit = new T.Vector3();
  const first = new T.Vector3(), last = new T.Vector3(), intersection = new T.Vector3(), deepest = new T.Vector3();
  const distances = new Float64Array(8);
  function straddles(triangle: T.Triangle, normal: T.Vector3, plane: number) {
    const a = normal.dot(triangle.a) - plane, b = normal.dot(triangle.b) - plane, c = normal.dot(triangle.c) - plane;
    return Math.min(a,b,c) < -crossingEpsilon && Math.max(a,b,c) > crossingEpsilon;
  }
  function measure(source: Face, target: Face) {
    const normal = target.normal, plane = normal.dot(target.triangle.a);
    if (!straddles(source.triangle, normal, plane) ||
        !straddles(target.triangle, source.normal, source.normal.dot(source.triangle.a))) return 0;
    let polygon = buffers[0], clipped = buffers[1], count = 3;
    for (let i = 0; i < 3; i++) polygon[i].copy(source.vertices[i].point);
    for (let side = 0; side < 3; side++) {
      const a = target.vertices[side].point, b = target.vertices[(side+1)%3].point;
      cutNormal.crossVectors(normal, edge.subVectors(b,a));
      const boundary = cutNormal.dot(a);
      let length = 0, previous = polygon[count-1], before = cutNormal.dot(previous) - boundary;
      for (let i = 0; i < count; i++) {
        const current = polygon[i], after = cutNormal.dot(current) - boundary;
        if (before * after < 0) clipped[length++].lerpVectors(previous, current, before / (before-after));
        if (after >= 0) clipped[length++].copy(current);
        previous = current; before = after;
      }
      if (length < 3) return 0;
      count = length;
      const swap = polygon; polygon = clipped; clipped = swap;
    }
    let minimum = Infinity, maximum = -Infinity;
    for (let i = 0; i < count; i++) {
      const d = distances[i] = normal.dot(polygon[i]) - plane;
      if (d < minimum) { minimum = d; deepest.copy(polygon[i]); }
      maximum = Math.max(maximum, d);
    }
    if (minimum >= -crossingEpsilon || maximum <= crossingEpsilon) return 0;
    let found = false, lengthSq = 0;
    for (let i = 0; i < count; i++) {
      const j = (i+1)%count, a = distances[i], b = distances[j];
      if (a === 0) hit.copy(polygon[i]);
      else if (a * b < 0) hit.lerpVectors(polygon[i], polygon[j], a/(a-b));
      else continue;
      if (!found) { first.copy(hit); found = true; }
      const distance = hit.distanceToSquared(first);
      if (distance > lengthSq) { lengthSq = distance; last.copy(hit); }
    }
    if (lengthSq <= crossingEpsilon * crossingEpsilon) return 0;
    intersection.lerpVectors(first,last,0.5);
    return -minimum;
  }
  return { measure, intersection, deepest };
}

interface FaceLocation {
  mesh: string; face: number; material: string; surface: Surface; region: Region; uv: [number, number] | null;
  /** Original main-mesh bind coordinates at this same barycentric point, in asset units. */
  bindPosition: XYZ | null;
}
export interface SleeveContact {
  source: FaceLocation;
  target: FaceLocation;
  position: XYZ; // World midpoint of the actual intersection segment.
  deepestPosition: XYZ; // World point on the clipped source giving this pair's depth.
  depth: number;
}
export interface SleeveContactStats {
  pairs: number;
  maxDepth: number;
  byRegion: Partial<Record<Region, number>>;
  records: SleeveContact[];
}
function contactStats(): SleeveContactStats { return { pairs: 0, maxDepth: 0, byRegion: {}, records: [] }; }
export interface SleeveStageResult {
  torso: SleeveContactStats;
  facing: SleeveContactStats;
  skin: SleeveContactStats;
  innerOuter: SleeveContactStats | null;
}

const shoulder = new T.Vector3(0.068, 0.744, 0.019), elbow = new T.Vector3(0.13, 0.647, 0.024);
const wrist = new T.Vector3(0.208, 0.555, 0.027);
/** Nearest bind segment and its normalized longitudinal coordinate survive articulation. */
function armRegion(p: T.Vector3, upper: T.Line3, lower: T.Line3, tmp: T.Vector3): Region {
  const u = upper.closestPointToPointParameter(p,true), l = lower.closestPointToPointParameter(p,true);
  const upperDistance = upper.at(u,tmp).distanceToSquared(p), lowerDistance = lower.at(l,tmp).distanceToSquared(p);
  if (upperDistance <= lowerDistance) return u < 0.22 ? 'shoulder' : u < 0.78 ? 'upperArm' : 'elbow';
  return l < 0.22 ? 'elbow' : l < 0.78 ? 'forearm' : 'cuff';
}
function adjacent(a: Face, b: Face) {
  for (const v of a.vertices) for (const w of b.vertices) if (v.weld === w.weld) return true;
  return false;
}

/** Indexed or triangle-soup meshes, with source primitive face labels 0 ignored, 1 outer, 2 inward,
 * 3 rim, 4 torso, 5 actual skin. Facing indices are primitive triangle IDs. The default landmarks
 * are for the current left ribbon sleeve. The geometry and its UV/topology must stay fixed. */
export function createClassifiedSleeveAudit(mesh: T.Mesh, facing: T.Mesh, labels: Uint8Array,
  facingFaces: readonly number[], landmarks = { shoulder, elbow, wrist }) {
  const vertices = new Map<number, Vertex>(), weldIds = new Map<string, number>();
  const mainCount = mesh.geometry.attributes.position.count;
  const tmp = new T.Vector3(), centroid = new T.Vector3(), origin = new T.Vector3();
  const upper = new T.Line3(landmarks.shoulder,landmarks.elbow), lower = new T.Line3(landmarks.elbow,landmarks.wrist);
  const inverseMain = mesh.matrixWorld.clone().invert(), facingToMain = inverseMain.clone().multiply(facing.matrixWorld);
  const faced = ['outer','inward','rim','torso','skin'] as const;
  function readFace(source: T.Mesh, id: number, surface: Surface) {
    const { geometry } = source, indices = geometry.index, p = geometry.attributes.position, uv = geometry.attributes.uv;
    const corners = [0,1,2].map(k => {
      const local = indices ? indices.getX(3*id+k) : 3*id+k;
      const key = local + (source === mesh ? 0 : mainCount);
      let v = vertices.get(key);
      if (!v) {
        v = newVertex(key);
        v.bind.fromBufferAttribute(p,local);
        if (source === facing) v.bind.applyMatrix4(facingToMain);
        const weld = [v.bind.x,v.bind.y,v.bind.z].map(x => Math.round(x*1e5)).join(',');
        if (!weldIds.has(weld)) weldIds.set(weld,weldIds.size);
        v.weld = weldIds.get(weld)!;
        if (uv) v.uv = new T.Vector2(uv.getX(local), uv.getY(local));
        vertices.set(key,v);
      }
      return v;
    }) as Face['vertices'];
    const face = makeFace(id, source.name, materialOf(source,id), surface, corners);
    centroid.copy(corners[0].bind).add(corners[1].bind).add(corners[2].bind).multiplyScalar(1/3);
    if (surface === 'torso') face.region = 'torso';
    else if (surface === 'facing') face.region = 'underarm';
    else {
      face.region = armRegion(centroid,upper,lower,tmp);
      if (surface === 'skin' && face.region === 'cuff') face.region = 'wristHand';
    }
    return face;
  }
  const cloth: Face[] = [], obstacles: Face[] = [];
  const faceCount = (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count)/3;
  if (labels.length !== faceCount) throw new Error('Sleeve audit labels must match the main primitive face count');
  for (let i = 0; i < labels.length; i++) {
    if (!labels[i]) continue;
    const surface = faced[labels[i]-1];
    if (!surface) throw new Error('Unknown sleeve face class');
    (labels[i] <= 3 ? cloth : obstacles).push(readFace(mesh,i,surface));
  }
  const facingCount = (facing.geometry.index?.count ?? facing.geometry.attributes.position.count)/3;
  for (const id of facingFaces) {
    if (!Number.isInteger(id) || id < 0 || id >= facingCount) throw new Error('Facing triangle index out of range');
    obstacles.push(readFace(facing,id,'facing'));
  }
  const clothTree = faceTree(cloth), obstacleTree = faceTree(obstacles);
  const outerTree = faceTree(cloth.filter(f => f.surface === 'outer'));
  const innerTree = faceTree(cloth.filter(f => f.surface === 'inward'));
  const inventory = (mesh.parent?.children ?? [mesh, facing]).filter((o): o is T.Mesh => o instanceof T.Mesh).map(o => ({
    name: o.name, materials: ([] as T.Material[]).concat(o.material).map(m => m.name),
    vertices: o.geometry.attributes.position.count, triangles: (o.geometry.index?.count ?? o.geometry.attributes.position.count)/3,
    texcoord0: !!o.geometry.attributes.uv,
  }));
  const regionCoverage: Partial<Record<Surface, { triangles: number; uvFaces: number; materials: string[];
    byRegion: Partial<Record<Region,number>>; bindMin: XYZ; bindMax: XYZ }>> = {};
  for (const f of [...cloth,...obstacles]) {
    const row = regionCoverage[f.surface] ??= { triangles: 0, uvFaces: 0, materials: [], byRegion: {},
      bindMin: [Infinity,Infinity,Infinity], bindMax: [-Infinity,-Infinity,-Infinity] };
    row.triangles++;
    row.byRegion[f.region] = (row.byRegion[f.region] ?? 0) + 1;
    if (f.vertices.every(v => v.uv && Number.isFinite(v.uv.x) && Number.isFinite(v.uv.y))) row.uvFaces++;
    if (!row.materials.includes(f.material)) row.materials.push(f.material);
    for (const v of f.vertices) for (let axis = 0; axis < 3; axis++) {
      row.bindMin[axis] = Math.min(row.bindMin[axis], v.bind.getComponent(axis));
      row.bindMax[axis] = Math.max(row.bindMax[axis], v.bind.getComponent(axis));
    }
  }
  const mapping = { inventory, regionCoverage, bindLandmarks: [upper.start,upper.end,lower.end].map(p => p.toArray()),
    regionCuts: [0.22,0.78], depthUnit: 'world metres',
    depthDefinition: 'Maximum clipped source distance behind the target face normal among proper crossings. Open-sheet local depth, winding dependent.',
    selfDefinition: 'Outer-facing source vs inward-facing target in bind pose. Shared bind-position vertices (including UV seams) excluded.',
  };
  const identity = new T.Matrix4(), linear = new T.Matrix3(), witness = crossingWitness(), bary = new T.Vector3();
  function describe(f: Face): FaceLocation {
    const [a,b,c] = f.vertices;
    let uv: FaceLocation['uv'] = null;
    f.triangle.getBarycoord(witness.intersection,bary);
    if (a.uv && b.uv && c.uv) {
      uv = [a.uv.x*bary.x+b.uv.x*bary.y+c.uv.x*bary.z, a.uv.y*bary.x+b.uv.y*bary.y+c.uv.y*bary.z];
    }
    const bindPosition = f.hasBind ? tmp.copy(a.bind).multiplyScalar(bary.x)
      .addScaledVector(b.bind,bary.y).addScaledVector(c.bind,bary.z).toArray() as XYZ : null;
    return { mesh: f.mesh, material: f.material, face: f.id, surface: f.surface, region: f.region, uv, bindPosition };
  }
  function cast(source: FaceTree, target: FaceTree, result: SleeveStageResult, self: boolean, proxy: boolean, limit: number) {
    if (!source.bvh || !target.bvh) return;
    const sourceFaces = source.order, targetFaces = target.order;
    source.bvh.bvhcast(target.bvh,identity,{ intersectsRanges(offsetA,countA,offsetB,countB) {
      for (let i = offsetA; i < offsetA+countA; i++) for (let j = offsetB; j < offsetB+countB; j++) {
        const a = sourceFaces[i], b = targetFaces[j];
        if (!a.bounds.intersectsBox(b.bounds) || (!proxy && adjacent(a,b))) continue;
        const depth = witness.measure(a,b);
        if (depth === 0) continue;
        const stats = self ? result.innerOuter! : result[b.surface as 'torso' | 'skin' | 'facing'];
        stats.pairs++; stats.maxDepth = Math.max(stats.maxDepth, depth);
        stats.byRegion[a.region] = (stats.byRegion[a.region] ?? 0)+1;
        const records = stats.records;
        if (limit === 0 || (records.length >= limit && depth <= records[records.length-1].depth)) continue;
        const record = { source: describe(a), target: describe(b), position: tmp.copy(witness.intersection).add(origin).toArray() as XYZ,
          deepestPosition: tmp.copy(witness.deepest).add(origin).toArray() as XYZ, depth };
        if (limit === Infinity) records.push(record);
        else {
          const before = records.findIndex(r => r.depth < depth);
          records.splice(before < 0 ? records.length : before,0,record);
          if (records.length > limit) records.pop();
        }
      }
      return false;
    } });
  }
  function updatePoint(v: Vertex, p: T.Vector3) {
    // Match the Float32 BVH coordinates; use a common character-relative origin to preserve precision.
    p.set(Math.fround(p.x),Math.fround(p.y),Math.fround(p.z));
    if (!Number.isFinite(p.x+p.y+p.z)) throw new Error('Non-finite sleeve audit vertex');
    v.dirty = !v.point.equals(p); v.point.copy(p);
  }
  function updateCloth(offset?: Float32Array) {
    for (const v of vertices.values()) {
      if (offset && v.id < mainCount) tmp.fromArray(offset,3*v.id).applyMatrix3(linear).add(v.base);
      else tmp.copy(v.base);
      updatePoint(v,tmp);
    }
    clothTree.refit(); outerTree.refit(); innerTree.refit(); obstacleTree.refit();
  }
  let cachedProxy: { key: object; vertices: Vertex[]; faces: Face[]; tree: FaceTree; mesh?: T.Mesh } | undefined;
  function updateProxy(proxy: SleeveAuditInput['proxy'], layerDrivers?: ArrayLike<number>) {
    const proxyMesh = proxy instanceof T.Mesh ? proxy : undefined;
    const particles = proxy instanceof T.Mesh ? undefined : proxy;
    const index = proxyMesh?.geometry.index;
    const key = particles?.triangles ?? index ?? proxyMesh!.geometry;
    const count = particles ? particles.positions.length/3 : proxyMesh!.geometry.attributes.position.count;
    const cornerCount = particles?.triangles.length ?? index?.count ?? count;
    const drivers = particles?.driverVertices ?? layerDrivers;
    if (!Number.isInteger(count) || cornerCount%3 || (drivers && drivers.length !== count))
      throw new Error('Invalid proxy position/topology length');
    if (!cachedProxy || cachedProxy.key !== key || cachedProxy.vertices.length !== count || cachedProxy.mesh !== proxyMesh) {
      const proxyVertices = Array.from({ length: count }, (_,id) => newVertex(id));
      const faces: Face[] = [], uv = proxyMesh?.geometry.attributes.uv;
      if (uv) for (const v of proxyVertices) v.uv = new T.Vector2(uv.getX(v.id),uv.getY(v.id));
      for (let j = 0; j < cornerCount; j += 3) {
        const corners = [0,1,2].map(k => proxyVertices[particles ? particles.triangles[j+k] : index ? index.getX(j+k) : j+k]) as Face['vertices'];
        if (corners.some(v => !v)) throw new Error('Proxy triangle index out of range');
        faces.push(makeFace(j/3,proxyMesh?.name || 'proxy',proxyMesh ? materialOf(proxyMesh,j/3) : '', 'proxy', corners));
      }
      cachedProxy = { key, mesh: proxyMesh, vertices: proxyVertices, faces, tree: faceTree(faces) };
    }
    for (const v of cachedProxy.vertices) {
      if (particles) tmp.fromArray(particles.positions,3*v.id);
      else proxyMesh!.getVertexPosition(v.id,tmp).applyMatrix4(proxyMesh!.matrixWorld);
      updatePoint(v,tmp.sub(origin));
      if (drivers) {
        const id = drivers[v.id];
        if (!Number.isInteger(id) || id < 0 || id >= mainCount) throw new Error('Invalid proxy driver vertex');
        v.bind.fromBufferAttribute(mesh.geometry.attributes.position,id);
      }
    }
    let posed: [T.Line3,T.Line3] | undefined;
    if (!drivers && mesh instanceof T.SkinnedMesh) {
      const bones = ['LeftArm','LeftForeArm','LeftHand'].map(s => mesh.skeleton.getBoneByName('mixamorig'+s));
      if (bones.every(Boolean)) {
        const [a,b,c] = bones.map(bone => new T.Vector3().setFromMatrixPosition(bone!.matrixWorld).sub(origin));
        posed = [new T.Line3(a,b),new T.Line3(b,c)];
      }
    }
    for (const f of cachedProxy.faces) {
      f.hasBind = !!drivers;
      const [a,b,c] = f.vertices;
      if (drivers) {
        centroid.copy(a.bind).add(b.bind).add(c.bind).multiplyScalar(1/3);
        f.region = armRegion(centroid,upper,lower,tmp);
      } else if (posed) f.region = armRegion(f.triangle.getMidpoint(centroid),posed[0],posed[1],tmp);
      else f.region = 'unmapped';
    }
    cachedProxy.tree.refit();
    return cachedProxy.tree;
  }
  function measureStages(input: SleeveAuditInput, { recordLimit = 4 }: SleeveAuditOptions = {}) {
    if (recordLimit !== Infinity && (!Number.isInteger(recordLimit) || recordLimit < 0)) throw new Error('Invalid recordLimit');
    for (const k of ['raw','blend','shell','final'] as const) if (input[k]?.length !== 3*mainCount)
      throw new Error(`Expected full mesh-local ${k} offsets`);
    origin.setFromMatrixPosition(mesh.matrixWorld);
    linear.setFromMatrix4(mesh.matrixWorld);
    for (const v of vertices.values()) {
      const source = v.id < mainCount ? mesh : facing;
      source.getVertexPosition(v.id < mainCount ? v.id : v.id-mainCount, v.base).applyMatrix4(source.matrixWorld).sub(origin);
    }
    function measureStage(stage: SleeveStage | 'limited'): SleeveStageResult {
      const proxy = stage === 'proxy';
      if (stage !== 'proxy') updateCloth(stage === 'skinned' ? undefined : input[stage]);
      const source = proxy ? updateProxy(input.proxy,input.driverVertices) : clothTree;
      const result: SleeveStageResult = { torso: contactStats(), facing: contactStats(), skin: contactStats(),
        innerOuter: proxy ? null : contactStats() };
      cast(source,obstacleTree,result,false,proxy,recordLimit);
      if (!proxy) cast(outerTree,innerTree,result,true,false,recordLimit);
      if (recordLimit === Infinity) for (const stats of Object.values(result)) stats?.records.sort((a: SleeveContact,b: SleeveContact) => b.depth - a.depth);
      return result;
    }
    const stages = {} as Record<SleeveStage,SleeveStageResult>;
    for (const stage of sleeveStages) stages[stage] = measureStage(stage);
    if (input.limited && input.limited.length !== input.final.length) throw new Error('Invalid limited offsets');
    const limited = input.limited && (input.limited.every((x,i) => x === input.final[i]) ? stages.final : measureStage('limited'));
    return { stages, limited };
  }
  return { mapping, measureStages };
}
