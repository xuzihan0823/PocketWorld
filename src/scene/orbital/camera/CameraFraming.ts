import { Box3, Vector3, MathUtils } from 'three';

const upAxis = new Vector3(0, 1, 0);

export function fitCameraBounds(box: Box3, direction: Vector3, aspect: number, fov: number, padding = 1.14) {
  const target = box.getCenter(new Vector3());
  const right = new Vector3().crossVectors(upAxis, direction).normalize();
  const up = new Vector3().crossVectors(direction, right);
  const slope = Math.tan(MathUtils.degToRad(fov / 2));
  const ratio = Math.max(.1, aspect);
  const corner = new Vector3();
  let halfHeight = 0, distance = 0;
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    corner.set(x, y, z).sub(target);
    const extent = Math.max(Math.abs(corner.dot(up)), Math.abs(corner.dot(right)) / ratio) * padding;
    halfHeight = Math.max(halfHeight, extent);
    distance = Math.max(distance, corner.dot(direction) + extent / slope);
  }
  const radius = box.getSize(corner).length() / 2;
  return { target, halfHeight, distance: Math.max(distance, radius * 1.2, .45), radius };
}
