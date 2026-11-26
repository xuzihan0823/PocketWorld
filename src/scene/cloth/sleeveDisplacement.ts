import { Matrix3, Vector3 } from 'three';
import type { Region } from './binding';

/** Frozen stage input/output, absolute cloth offsets in world mm. Proxy IDs are particle IDs. */
export function sleeveDisplacement(region: Region, positions: Float32Array, includeVertices = false) {
  const l = region.sleeveLayers!, linear = new Matrix3().setFromMatrix4(l.mesh.matrixWorld);
  const input = new Vector3(), output = new Vector3();
  function collect(ids: number[], read: (id: number) => void) {
    let requestedMaxMm = 0, appliedMaxMm = 0, maxDifferenceMm = -1;
    let witness = { id:-1, requested:[0,0,0], applied:[0,0,0] };
    const vertices = includeVertices ? [] as typeof witness[] : undefined;
    for (const id of ids) {
      read(id);
      const difference = input.distanceTo(output);
      requestedMaxMm = Math.max(requestedMaxMm,input.length());
      appliedMaxMm = Math.max(appliedMaxMm,output.length());
      if (vertices || difference > maxDifferenceMm) {
        const row = {id, requested:input.toArray(), applied:output.toArray()};
        vertices?.push(row);
        if (difference > maxDifferenceMm) { maxDifferenceMm = difference; witness = row; }
      }
    }
    return {requestedMaxMm, appliedMaxMm, maxDifferenceMm, witness, vertices};
  }
  function cloth(before?: Float32Array, after?: Float32Array) {
    return collect(l.vertexIds,id => {
      if (before) input.fromArray(before,3*id).applyMatrix3(linear).multiplyScalar(1000); else input.setScalar(0);
      if (after) output.fromArray(after,3*id).applyMatrix3(linear).multiplyScalar(1000); else output.setScalar(0);
    });
  }
  const proxy = collect(Array.from({length:positions.length/3},(_,i) => i),id => {
    output.fromArray(positions,3*id).sub(input.fromArray(region.targets,3*id)).multiplyScalar(1000);
    input.setScalar(0);
  });
  const shader = l.mesh.geometry.getAttribute('pwCloth').array as Float32Array;
  return {skinned:cloth(), proxy, raw:cloth(l.raw,l.raw), blend:cloth(l.raw,l.blend),
    shell:cloth(l.blend,l.shell), limit:cloth(l.shell,l.limited), final:cloth(l.limited,shader)};
}
