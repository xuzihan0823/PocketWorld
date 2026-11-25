import * as T from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { Region } from './binding';
import type { createSleeveAudit } from './sleeveSurface';

/** Draw each stage with the same pose, camera and tile aspect. */
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
      const columns = window.matchMedia('(max-width: 700px)').matches ? 2 : 3;
      const rows = 6 / columns;
      const aspect = camera.aspect;
      const stages = [null, null, layers.raw, layers.blend, layers.shell, saved];
      renderer.setScissorTest(true);
      const facing = getAudit().facing;
      try {
        for (let i = 0; i < stages.length; i++) {
          const column = i % columns, row = rows - 1 - Math.floor(i / columns);
          const x = Math.floor(size.x * column / columns), y = Math.floor(size.y * row / rows);
          const w = Math.floor(size.x * (column + 1) / columns) - x;
          const h = Math.floor(size.y * (row + 1) / rows) - y;
          camera.aspect = w / h;
          camera.updateProjectionMatrix();
          renderer.setViewport(x, y, w, h);
          renderer.setScissor(x, y, w, h);
          const stageOffsets = stages[i];
          if (stageOffsets) layers.final.set(stageOffsets);
          else layers.final.fill(0);
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
        camera.aspect = aspect;
        camera.updateProjectionMatrix();
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, size.x, size.y);
      }
    },
  };
}
