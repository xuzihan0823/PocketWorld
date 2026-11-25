import * as T from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { sleeveSurfaceMask } from './sleeveMask';

/** Development-only narrow phase on posed faces, in the main mesh's post-skin local coordinates. */
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
  for (let i = 0; i < facingIds.count; i += 3) {
    const x = facingIds.getX(i), y = facingIds.getX(i+1), z = facingIds.getX(i+2);
    if (Math.min(lining.getX(x),lining.getX(y),lining.getX(z)) <= 0) continue;
    obstacleIndices.push(n+x,n+y,n+z); counts.facing++;
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
  const cloth = tree(sleeveIndices), obstacle = tree(obstacleIndices);
  function intersections(offset?: Float32Array) {
    for (const id of used) {
      const k = 3 * id;
      v.fromArray(base,k);
      if (offset && id < n) v.add(a.fromArray(offset,k));
      position.setXYZ(id,v.x,v.y,v.z);
    }
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
  function markedPose() {
    const xyz: number[] = [], rgb: number[] = [];
    const colors = ['#000000','#56bdcb','#9a68ba','#dcaa42','#6885aa','#edb290','#bfd17a'].map(s => new T.Color(s));
    function triangle(source: T.SkinnedMesh, index: T.BufferAttribute, k: number, label: number) {
      const color = colors[label];
      for (let j = 0; j < 3; j++) {
        source.getVertexPosition(index.getX(k + j), v).applyMatrix4(source.matrixWorld);
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
    return new T.Mesh(geometry,new T.MeshBasicMaterial({ vertexColors: true, side: T.DoubleSide }));
  }
  return { counts, markedPose, facing, measure(raw: Float32Array, final: Float32Array) {
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
