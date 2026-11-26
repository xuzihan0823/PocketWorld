import { Matrix3, Vector3 } from 'three';
import type { Region } from './binding';
import { sleeveSurfaceMask } from './sleeveMask';

/** Inferred arm volume, reported independently of actual wrist/hand triangle intersections. */
export function measureArmEnvelope(region: Region, positions: Float32Array) {
  const l = region.sleeveLayers!, linear = new Matrix3().setFromMatrix4(l.mesh.matrixWorld);
  const base = new Vector3(), point = new Vector3();
  const state = () => ({inside:0, maxDepthMm:0, vertex:-1, ball:-1});
  const result = {skinned:state(), proxy:state(), raw:state(), blend:state(), shell:state(), final:state()};
  function sample(id: number, row: ReturnType<typeof state>) {
    let max = 0, ball = -1;
    for (let i = 0; i < l.armBalls.length; i++) {
      const b = l.armBalls[i], depth = b.radius - Math.hypot(point.x-b.x,point.y-b.y,point.z-b.z);
      if (depth > max) { max = depth; ball = i; }
    }
    if (max > 0) row.inside++;
    if (max * 1000 > row.maxDepthMm) Object.assign(row,{maxDepthMm:max*1000,vertex:id,ball});
  }
  const stages = ['raw','blend','shell','final'] as const;
  for (const id of sleeveSurfaceMask(l.mesh).sleeve) {
    l.mesh.getVertexPosition(id,base).applyMatrix4(l.mesh.matrixWorld);
    point.copy(base); sample(id,result.skinned);
    for (const key of stages) {
      point.fromArray(l[key],3*id).applyMatrix3(linear).add(base); sample(id,result[key]);
    }
  }
  for (let k = 0; k < positions.length; k += 3) { point.fromArray(positions,k); sample(k/3,result.proxy); }
  return result;
}
