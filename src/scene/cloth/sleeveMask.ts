import type { SkinnedMesh } from 'three';

// Minimum render-vertex ID in each left wrist/hand UV island, checked on luna-ribbon's painted atlas.
// Wrist cloth is also weighted to hand bones. These skin islands are excluded before fitting the proxy.
const skinIslands = new Set([2562,2578,2607,3220,3224,3238,3242,3249,3253,3257,3272,3276,3284,3288,3292,3302,
  3314,3318,3328,3352,3356,3360,3393,3397,3532,3544,3554,3596,3602,5833,5841,5845,5849,5853,5857,5861,
  5867,5890,5894,5900,5906,5910,5951,5963,5971,5975,5981,5987,6003,6019,18316,18328,18370,18393,18528,
  18539,18615,18619,18722,18762,18810,18840,18859,36075,36190,36211,36262]);
const cache = new WeakMap<SkinnedMesh, { sleeve: Set<number>; torso: Set<number>; skin: Set<number> }>();

export function sleeveSurfaceMask(mesh: SkinnedMesh) {
  const cached = cache.get(mesh);
  if (cached) return cached;
  const g = mesh.geometry.attributes, p = g.position, idx = mesh.geometry.index;
  if (!idx || p.count !== 38114 || !mesh.name.includes('Ribbon_jacket')) throw new Error('左袖遮罩只适配当前 luna-ribbon 主网格');
  const parent = Uint32Array.from({length: p.count}, (_, i) => i);
  function root(i: number) {
    while (i !== parent[i]) { parent[i] = parent[parent[i]]; i = parent[i]; }
    return i;
  }
  for (let i = 0; i < idx.count; i += 3) {
    const a = root(idx.getX(i)), b = root(idx.getX(i+1)), c = root(idx.getX(i+2));
    parent[a] = parent[b] = parent[c] = Math.min(a,b,c);
  }
  const sleeve = new Set<number>(), torso = new Set<number>(), skin = new Set<number>();
  for (let i = 0; i < p.count; i++) {
    if (skinIslands.has(root(i))) { skin.add(i); continue; }
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    let arm = 0, hand = 0, trunk = 0;
    for (let j = 0; j < 4; j++) {
      const name = mesh.skeleton.bones[g.skinIndex.getComponent(i,j)].name;
      const w = g.skinWeight.getComponent(i,j);
      if (name === 'mixamorigLeftArm' || name === 'mixamorigLeftForeArm') arm += w;
      if (name.startsWith('mixamorigLeftHand')) hand += w;
      if (name.startsWith('mixamorigSpine') || name === 'mixamorigHips') trunk += w;
    }
    if (x > 0.05 && y > 0.51 && y < 0.775 && arm + hand >= 0.5) sleeve.add(i);
    else if (Math.abs(x) < 0.118 && y >= 0.54 && y < 0.765 && z > -0.065 && trunk >= 0.5) torso.add(i);
  }
  const result = { sleeve, torso, skin };
  cache.set(mesh, result);
  return result;
}

/** Geodesic distance from an attached edge. UV-split vertices share the same result. */
export function sleeveSeamDistance(mesh: SkinnedMesh, sleeve: Set<number>, width: number) {
  const p = mesh.geometry.attributes.position, tri = mesh.geometry.index!;
  const groups = new Map<string,number>(), welded = new Int32Array(p.count);
  const graph: Map<number,number>[] = [], distances: number[] = [];
  for (let id = 0; id < p.count; id++) {
    const key = [p.getX(id),p.getY(id),p.getZ(id)].map(x => Math.round(1e5*x)).join(',');
    let group = groups.get(key);
    if (group === undefined) { group = graph.length; groups.set(key,group); graph.push(new Map()); distances.push(width); }
    welded[id] = group;
    if (!sleeve.has(id)) distances[group] = 0;
  }
  for (let k = 0; k < tri.count; k += 3) for (let j = 0; j < 3; j++) {
    const a = tri.getX(k+j), b = tri.getX(k+(j+1)%3), u = welded[a], v = welded[b];
    if (sleeve.has(a) !== sleeve.has(b)) { distances[u] = distances[v] = 0; continue; }
    if (!sleeve.has(a) || u === v) continue;
    const length = Math.hypot(p.getX(a)-p.getX(b),p.getY(a)-p.getY(b),p.getZ(a)-p.getZ(b));
    graph[u].set(v,length); graph[v].set(u,length);
  }
  const queue = [...new Set([...sleeve].map(id => welded[id]))].filter(u => !distances[u]);
  for (let i = 0; i < queue.length; i++) {
    const u = queue[i];
    for (const [v,length] of graph[u]) if (distances[u]+length < distances[v]) {
      distances[v] = distances[u]+length; queue.push(v);
    }
  }
  return (id: number) => distances[welded[id]];
}
