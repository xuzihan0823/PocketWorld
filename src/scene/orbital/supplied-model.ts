import * as THREE from 'three';

/** Keep cached geometry/materials immutable while isolating each instance's visibility. */
export function cloneSuppliedModel(scene: THREE.Group, part?: string): THREE.Group {
  if (part && !scene.getObjectByName(part)) throw new Error(`Missing supplied part: ${part}`);
  const clone = scene.clone(true);
  clone.traverse(o => {
    if (!(o instanceof THREE.Mesh)) return;
    o.castShadow = o.receiveShadow = true;
    if (part) {
      let parent: THREE.Object3D | null = o;
      let included = false;
      while (parent) { if (parent.name === part) included = true; parent = parent.parent; }
      o.visible = included;
      // Three.js raycasting does not skip invisible meshes. Hidden sibling
      // parts must not steal hits from the original ObjectHandle hierarchy.
      if (!included) o.raycast = () => {};
    }
  });
  return clone;
}
