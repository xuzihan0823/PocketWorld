import { MathUtils, SkinnedMesh, Vector3 } from 'three';

/** Sparse supports on the actual left jacket panel. One outermost vertex per bind-space Y/Z cell. */
export function sleeveBudget(mesh: SkinnedMesh, torso: Set<number>) {
  const positions = mesh.geometry.attributes.position;
  const cells = new Map<string, number>();
  for (const id of torso) {
    if (positions.getX(id) < 0.035) continue;
    const cell = `${Math.floor(positions.getY(id) / 0.018)},${Math.floor(positions.getZ(id) / 0.018)}`;
    const prior = cells.get(cell);
    if (prior === undefined || positions.getX(prior) < positions.getX(id)) cells.set(cell, id);
  }
  const supports = [...cells.values()].map(id => ({ id, position: new Vector3() }));
  const left = mesh.skeleton.getBoneByName('mixamorigLeftArm')!;
  const right = mesh.skeleton.getBoneByName('mixamorigRightArm')!;
  const outward = new Vector3(), relative = new Vector3();
  return {
    sample() {
      outward.setFromMatrixPosition(left.matrixWorld).sub(relative.setFromMatrixPosition(right.matrixWorld)).normalize();
      for (const s of supports) mesh.getVertexPosition(s.id, s.position).applyMatrix4(mesh.matrixWorld);
    },
    constrain(offset: Vector3, skinned: Vector3, limit: number) {
      offset.clampLength(0, limit);
      // Bounded half-space projection. Fade each local support at its edges so adjacent sleeve
      // vertices share a direction even at folds where a nearest face normal can change sign.
      const original = offset.dot(outward);
      let required = original;
      for (const s of supports) {
        relative.subVectors(s.position, skinned);
        const gap = relative.dot(outward);
        if (gap < -limit || gap > 0.09) continue;
        const transverseSq = relative.lengthSq() - gap * gap;
        if (transverseSq >= 0.0016) continue;
        const weight = (1 - MathUtils.smoothstep(transverseSq, 0.0001, 0.0016)) *
          (1 - MathUtils.smoothstep(gap, 0.055, 0.09));
        required = Math.max(required, MathUtils.lerp(original, Math.min(limit, gap + 0.0025), weight));
      }
      if (required > original) {
        offset.addScaledVector(outward, -original);
        offset.clampLength(0, Math.sqrt(Math.max(0, limit * limit - required * required)));
        offset.addScaledVector(outward, required);
      }
    },
  };
}
