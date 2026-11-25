import * as THREE from 'three';

export function paperGeometry(crumpled = false) {
  const geometry = new THREE.PlaneGeometry(0.56, 0.872, 20, 26).toNonIndexed();
  const attribute = geometry.attributes.position;
  const flat = attribute.array.slice() as Float32Array;
  const folded = new Float32Array(flat.length);
  for (let i = 0; i < attribute.count; i++) {
    const x = flat[i * 3], y = flat[i * 3 + 1];
    const u = (x + 0.28) / 0.56, v = (y + 0.436) / 0.872;
    const longitude = u * Math.PI * 2, latitude = v * Math.PI;
    const radius = 0.083 + Math.sin(u * 23 + v * 17) * Math.cos(v * 29) * 0.009;
    folded.set([Math.cos(longitude) * Math.sin(latitude) * radius, Math.cos(latitude) * radius, Math.sin(longitude) * Math.sin(latitude) * radius], i * 3);
    flat[i * 3 + 2] = 0.012 * (u ** 6) + Math.sin(v * Math.PI) * 0.003;
  }
  attribute.array.set(crumpled ? folded : flat);
  geometry.computeVertexNormals();
  return { geometry, flat, folded };
}
