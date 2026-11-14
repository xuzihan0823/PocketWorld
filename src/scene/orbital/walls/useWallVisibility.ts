import { useEffect, useRef, type RefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { fadeOpacity, stepFade, wallOccludes, type Vec3, type WallBox, type WallTag } from './wallVisibility';

interface MaterialSlot { material: THREE.Material; opacity: number; transparent: boolean; depthWrite: boolean }
interface Part { mesh: THREE.Mesh; original: THREE.Material | THREE.Material[]; slots: MaterialSlot[]; castShadow: boolean; visible: boolean }
interface Wall { box: WallBox; parts: Part[]; hidden: boolean; progress: number; applied: number }

function apply(wall: Wall, opacity: number) {
  const solid = opacity >= 1;
  for (const part of wall.parts) {
    part.mesh.visible = part.visible && opacity > 0.002;
    // A wall the visitor can no longer see stops shading the room; it returns halfway through fading back in.
    part.mesh.castShadow = part.castShadow && opacity > 0.5;
    for (const slot of part.slots) {
      const transparent = solid ? slot.transparent : true;
      if (slot.material.transparent !== transparent) { slot.material.transparent = transparent; slot.material.needsUpdate = true; }
      slot.material.depthWrite = solid ? slot.depthWrite : false;
      slot.material.opacity = slot.opacity * opacity;
    }
  }
}

/**
 * Fades every mesh under a node tagged with `userData.wall` (see WallTag) when that wall stands between the
 * camera and the room interior. Nodes sharing an id fade together. Only reads the camera; it never moves it.
 * Materials are cloned per mesh so shared materials elsewhere in the scene are never touched.
 */
export function useWallVisibility(root: RefObject<THREE.Group>, samples: readonly Vec3[]) {
  const walls = useRef<Wall[]>([]);
  const fresh = useRef(true);
  const local = useRef(new THREE.Vector3());

  useEffect(() => {
    const group = root.current;
    if (!group) return;
    group.updateWorldMatrix(true, true);
    const toRoom = group.matrixWorld.clone().invert(), relative = new THREE.Matrix4();
    const byId = new Map<string, { tag: WallTag; bounds: THREE.Box3; parts: Part[] }>(), seen = new Set<THREE.Mesh>();
    group.traverse(node => {
      const tag = node.userData.wall as WallTag | undefined;
      if (!tag) return;
      const entry = byId.get(tag.id) ?? { tag, bounds: new THREE.Box3(), parts: [] };
      byId.set(tag.id, entry);
      node.traverse(child => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh || seen.has(mesh)) return;
        seen.add(mesh);
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        entry.bounds.union(mesh.geometry.boundingBox!.clone().applyMatrix4(relative.multiplyMatrices(toRoom, mesh.matrixWorld)));
        const original = mesh.material;
        const clones = (Array.isArray(original) ? original : [original]).map(material => material.clone());
        mesh.material = Array.isArray(original) ? clones : clones[0];
        entry.parts.push({ mesh, original, castShadow: mesh.castShadow, visible: mesh.visible,
          slots: clones.map(material => ({ material, opacity: material.opacity, transparent: material.transparent, depthWrite: material.depthWrite })) });
      });
    });
    const found: Wall[] = [...byId.values()].filter(entry => entry.parts.length).map(({ tag, bounds, parts }) => ({
      box: { ...tag, min: bounds.min.toArray(), max: bounds.max.toArray() }, parts, hidden: false, progress: 1, applied: 1 }));
    walls.current = found;
    fresh.current = true;
    return () => {
      for (const wall of found) for (const part of wall.parts) {
        part.mesh.material = part.original;
        part.mesh.castShadow = part.castShadow;
        part.mesh.visible = part.visible;
        part.slots.forEach(slot => slot.material.dispose());
      }
      walls.current = [];
    };
  }, [root]);

  useFrame(({ camera }, delta) => {
    const group = root.current;
    if (!group || !walls.current.length) return;
    const point = group.worldToLocal(local.current.copy(camera.position));
    const eye: Vec3 = [point.x, point.y, point.z];
    const dt = Math.min(delta, 0.1);
    for (const wall of walls.current) {
      wall.hidden = wallOccludes(wall.box, eye, samples, wall.hidden);
      // The first frame snaps so the room never opens with a fade.
      wall.progress = fresh.current ? (wall.hidden ? 0 : 1) : stepFade(wall.progress, wall.hidden, dt);
      const opacity = fadeOpacity(wall.progress);
      if (opacity === wall.applied) continue;
      wall.applied = opacity;
      apply(wall, opacity);
    }
    fresh.current = false;
  });
}
