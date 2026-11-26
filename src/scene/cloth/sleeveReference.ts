import { MathUtils, Matrix4, Vector3, type SkinnedMesh } from 'three';

interface ReferenceFace { a: number; b: number; c: number; area: number }

/** Compare the posed sleeve with immutable bind-space edges and face areas.
 * Both samples are mesh-local so a moving or rescaled character cannot trigger the guard. */
export function createSleeveReference(mesh: SkinnedMesh, sleeve: ReadonlySet<number>, restoreTriangles = false) {
  const bind = mesh.geometry.attributes.position;
  const indices = mesh.geometry.index!;
  const vertices = [...sleeve];
  const local = new Map(vertices.map((id, i) => [id, i]));
  const groups = new Map<string, number>();
  const points = vertices.map(id => new Vector3().fromBufferAttribute(bind, id));
  const weld = points.map(point => {
    const key = point.toArray().map(x => Math.round(x * 1e5)).join(',');
    if (!groups.has(key)) groups.set(key, groups.size);
    return groups.get(key)!;
  });
  const weights = new Float64Array(groups.size);
  const ab = new Vector3(), ac = new Vector3();
  function doubleArea(a: number, b: number, c: number) {
    return ab.subVectors(points[b], points[a]).cross(ac.subVectors(points[c], points[a])).length();
  }
  const faces: ReferenceFace[] = [];
  const edges: { a: number; b: number; length: number }[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < indices.count; i += 3) {
    const a = local.get(indices.getX(i)), b = local.get(indices.getX(i + 1)), c = local.get(indices.getX(i + 2));
    if (a === undefined || b === undefined || c === undefined) continue;
    const area = doubleArea(a, b, c);
    if (area > 1e-12) faces.push({ a, b, c, area });
    for (const [first, second] of [[a, b], [b, c], [c, a]]) {
      const key = Math.min(first, second) * vertices.length + Math.max(first, second);
      if (seen.has(key)) continue;
      seen.add(key);
      const length = points[first].distanceTo(points[second]);
      if (length > 1e-8) edges.push({ a: first, b: second, length });
    }
  }
  const patch = restoreTriangles ? createTriangleCorrection(mesh, faces, vertices, points, weld, groups.size) : undefined;
  // Experimental fade over 12–38% of the original length or area, shared by both comparisons.
  function influence(ratio: number) { return MathUtils.smoothstep(ratio, 0.12, 0.38); }
  return {
    sample() {
      weights.fill(1);
      vertices.forEach((id, i) => mesh.getVertexPosition(id, points[i]));
      for (const { a, b, length } of edges) {
        const weight = influence(points[a].distanceTo(points[b]) / length);
        weights[weld[a]] = Math.min(weights[weld[a]], weight);
        weights[weld[b]] = Math.min(weights[weld[b]], weight);
      }
      for (const { a, b, c, area } of faces) {
        const weight = influence(doubleArea(a, b, c) / area);
        weights[weld[a]] = Math.min(weights[weld[a]], weight);
        weights[weld[b]] = Math.min(weights[weld[b]], weight);
        weights[weld[c]] = Math.min(weights[weld[c]], weight);
      }
      patch?.sample(weights);
    },
    weight(id: number) { return weights[weld[local.get(id)!]]; },
    correction(id: number, out: Vector3) {
      return patch ? out.copy(patch.offsets[weld[local.get(id)!]]) : out.set(0, 0, 0);
    },
  };
}

/** Reconstruct each triangle in a single bone frame so mixed skin weights cannot crush its shape.
 * Keep its animated centroid, then area-average suggestions at welded corners in mesh-local space. */
function createTriangleCorrection(mesh: SkinnedMesh, faces: ReferenceFace[], vertices: number[],
  points: Vector3[], weld: number[], groupCount: number) {
  const rotations = new Map<number, Matrix4>();
  const totals = new Float64Array(groupCount);
  const offsets = Array.from({ length: groupCount }, () => new Vector3());
  const { skinWeight, skinIndex } = mesh.geometry.attributes;
  const center = new Vector3(), delta = new Vector3(), matrix = new Matrix4();
  const patches = faces.map(({ a, b, c, area }) => {
    const ids = [a, b, c];
    const sums = new Map<number, number>();
    for (const i of ids) for (let k = 0; k < 4; k++) {
      const bone = skinIndex.getComponent(vertices[i], k);
      sums.set(bone, (sums.get(bone) ?? 0) + skinWeight.getComponent(vertices[i], k));
    }
    const [bone] = [...sums].sort((u, v) => v[1] - u[1] || u[0] - v[0])[0];
    if (!rotations.has(bone)) rotations.set(bone, new Matrix4());
    center.copy(points[a]).add(points[b]).add(points[c]).multiplyScalar(1 / 3);
    for (const i of ids) totals[weld[i]] += area;
    return { ids, area, axes: rotations.get(bone)!, rest: ids.map(i => points[i].clone().sub(center)) };
  });
  return { offsets, sample(weights: Float64Array) {
    for (const [id, axes] of rotations) {
      matrix.multiplyMatrices(mesh.bindMatrixInverse, mesh.skeleton.bones[id].matrixWorld)
        .multiply(mesh.skeleton.boneInverses[id]).multiply(mesh.bindMatrix);
      axes.extractRotation(matrix);
    }
    for (const offset of offsets) offset.set(0, 0, 0);
    for (const { ids, area, axes, rest } of patches) {
      if (ids.every(i => weights[weld[i]] === 1)) continue;
      center.copy(points[ids[0]]).add(points[ids[1]]).add(points[ids[2]]).multiplyScalar(1 / 3);
      for (let k = 0; k < 3; k++) {
        const i = ids[k], group = weld[i];
        delta.copy(rest[k]).applyMatrix4(axes).add(center).sub(points[i]);
        offsets[group].addScaledVector(delta, area / totals[group]);
      }
    }
  } };
}
