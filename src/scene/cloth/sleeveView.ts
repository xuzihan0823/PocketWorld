import * as T from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Region } from './binding';
import type { createSleeveAudit } from './sleeveSurface';

/** Four draws of the same frozen pose. Restore the displayed attribute before returning. */
export function sleeveView(region: Region, proxy: T.Mesh, renderer: T.WebGLRenderer, scene: T.Scene,
  camera: T.PerspectiveCamera, orbit: OrbitControls, getAudit: () => ReturnType<typeof createSleeveAudit>) {
  const layers = region.sleeveLayers!;
  const attribute = layers.mesh.geometry.getAttribute('pwCloth') as T.BufferAttribute;
  const saved = new Float32Array(layers.final.length);
  const size = new T.Vector2();
  const labels = document.getElementById('layer-labels')!;
  let showing = false, wireVisible = false;
  let marked: ReturnType<ReturnType<typeof createSleeveAudit>['markedPose']> | undefined;
  return {
    get showing() { return showing; },
    toggle() {
      showing = !showing;
      labels.hidden = !showing;
      if (showing) {
        saved.set(layers.final);
        marked = getAudit().markedPose();
        marked.visible = false;
        scene.add(marked);
        wireVisible = proxy.visible;
        orbit.saveState();
        proxy.geometry.computeBoundingSphere();
        const sphere = proxy.geometry.boundingSphere!;
        const direction = camera.position.clone().sub(orbit.target).normalize();
        orbit.target.copy(sphere.center);
        camera.position.copy(sphere.center).addScaledVector(direction, Math.max(0.6, sphere.radius * 4.5));
        orbit.update();
      } else {
        if (marked) { scene.remove(marked); marked.geometry.dispose(); marked.material.dispose(); marked = undefined; }
        orbit.reset();
        proxy.visible = wireVisible;
      }
    },
    draw() {
      renderer.getSize(size);
      const halfX = Math.floor(size.x / 2), halfY = Math.floor(size.y / 2);
      renderer.setScissorTest(true);
      const facing = getAudit().facing;
      try {
        for (let i = 0; i < 4; i++) {
          const x = i % 2 ? halfX : 0, y = i < 2 ? halfY : 0;
          const w = x ? size.x - halfX : halfX, h = y ? size.y - halfY : halfY;
          renderer.setViewport(x, y, w, h);
          renderer.setScissor(x, y, w, h);
          if (i < 2) layers.final.fill(0);
          else layers.final.set(i === 2 ? layers.raw : saved);
          attribute.needsUpdate = true;
          proxy.visible = i === 1;
          layers.mesh.visible = facing.visible = i !== 1;
          marked!.visible = i === 1;
          renderer.render(scene, camera);
        }
      } finally {
        layers.final.set(saved);
        attribute.needsUpdate = true;
        proxy.visible = wireVisible;
        layers.mesh.visible = facing.visible = true;
        marked!.visible = false;
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, size.x, size.y);
      }
    },
  };
}
