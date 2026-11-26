import * as T from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { sleeveSurfaceMask } from './sleeveMask';

/** Collapse bind-space cells to actual skinned vertices, independently for each contact material. */
export function clusteredSurface(mesh: T.SkinnedMesh, accept: (id: number) => boolean, spacing: number) {
  const bind = mesh.geometry.attributes.position, ids = mesh.geometry.index!;
  const cells = new Map<string, number>(), drivers: number[] = [], indices: number[] = [];
  const seen = new Set<string>();
  function corner(id: number) {
    const key = [bind.getX(id),bind.getY(id),bind.getZ(id)].map(x => Math.floor(x / spacing)).join(',');
    let index = cells.get(key);
    if (index === undefined) { index = drivers.length; cells.set(key,index); drivers.push(id); }
    return index;
  }
  for (let k = 0; k < ids.count; k += 3) {
    const corners = [ids.getX(k),ids.getX(k+1),ids.getX(k+2)];
    if (!corners.every(accept)) continue;
    const tri = corners.map(corner);
    if (new Set(tri).size < 3) continue;
    const key = tri.slice().sort((a,b) => a-b).join(',');
    if (!seen.has(key)) { seen.add(key); indices.push(...tri); }
  }
  const geometry = new T.BufferGeometry();
  const position = new T.Float32BufferAttribute(drivers.length * 3, 3);
  geometry.setAttribute('position',position); geometry.setIndex(indices);
  const p = new T.Vector3(), a = new T.Vector3(), b = new T.Vector3(), c = new T.Vector3();
  function pose() {
    for (let i = 0; i < drivers.length; i++) {
      mesh.getVertexPosition(drivers[i],p).applyMatrix4(mesh.matrixWorld);
      position.setXYZ(i,p.x,p.y,p.z);
    }
    position.needsUpdate = true;
  }
  pose();
  const tree = new MeshBVH(geometry), hit = { point: new T.Vector3(), distance: 0, faceIndex: 0 };
  return {
    geometry,
    sample() { pose(); tree.refit(); },
    project(point: T.Vector3, outward: T.Vector3, reach: number, clearance: number) {
      if (!tree.closestPointToPoint(point,hit,0,reach)) return;
      const index = geometry.index!, k = 3 * hit.faceIndex;
      a.fromBufferAttribute(position,index.getX(k)); b.fromBufferAttribute(position,index.getX(k+1));
      c.fromBufferAttribute(position,index.getX(k+2));
      const normal = b.sub(a).cross(c.sub(a)).normalize();
      if (normal.dot(outward) < 0) normal.negate();
      const depth = clearance - p.subVectors(point,hit.point).dot(normal);
      if (depth <= 0) return;
      const falloff = 1 - T.MathUtils.smoothstep(hit.distance,reach/2,reach);
      point.addScaledVector(normal,depth * falloff);
    },
  };
}

/** Coherent world-space field on the existing rings. No change to integration or rest lengths. */
export function sleeveContact(mesh: T.SkinnedMesh, cols: number, rows: number) {
  const mask = sleeveSurfaceMask(mesh), facing = mesh.parent!.children.find(o => o instanceof T.SkinnedMesh &&
    ([] as T.Material[]).concat(o.material).some(m => m.name.includes('Ivory underarm facing'))) as T.SkinnedMesh;
  const torso = clusteredSurface(mesh,id => mask.torso.has(id),0.012);
  const lining = clusteredSurface(facing,id => facing.geometry.attributes.position.getX(id) > 0,0.007);
  const skin = clusteredSurface(mesh,id => mask.skin.has(id),0.007);
  const surfaces = {torso, facing:lining, skin};
  const left = mesh.skeleton.getBoneByName('mixamorigLeftArm')!, right = mesh.skeleton.getBoneByName('mixamorigRightArm')!;
  const lateral = new T.Vector3(), target = new T.Vector3(), point = new T.Vector3(), radial = new T.Vector3();
  const center = new T.Vector3(), field = new Float32Array(cols * rows * 3);
  return { surfaces, field,
    sample(targets: Float32Array, solved: Float32Array, limit: number, clearance: number) {
      Object.values(surfaces).forEach(s => s.sample());
      lateral.setFromMatrixPosition(left.matrixWorld).sub(point.setFromMatrixPosition(right.matrixWorld)).normalize();
      for (let row = 0; row < rows; row++) {
        center.set(0,0,0);
        for (let col = 0; col < cols; col++) center.add(target.fromArray(targets,3*(row*cols+col)));
        center.multiplyScalar(1/cols);
        for (let col = 0; col < cols; col++) {
          const k = 3*(row*cols+col);
          target.fromArray(targets,k);
          radial.subVectors(target,center).normalize();
          point.fromArray(solved,k).sub(target).clampLength(0,limit).add(target);
          skin.project(point,radial,0.024,clearance);
          lining.project(point,lateral,0.030,clearance);
          torso.project(point,lateral,0.050,clearance);
          point.sub(target).toArray(field,k);
        }
      }
    },
  };
}
