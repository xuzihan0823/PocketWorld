import { useEffect, useMemo } from 'react';
import type { MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { Camera, FramebufferTexture, Mesh, PlaneGeometry, Scene, ShaderMaterial, Vector2 } from 'three';
import type { Object3D } from 'three';
import type { CabinOpacity, CabinZoomFadePart } from './cabinCutaway';

export function CabinZoomRenderer({ opacity }: { opacity: MutableRefObject<CabinOpacity> }) {
  const pass = useMemo(() => {
    const scene = new Scene();
    const material = new ShaderMaterial({
      uniforms: { frame: { value: null as FramebufferTexture | null }, amount: { value: 1 } },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D frame;
        uniform float amount;
        varying vec2 vUv;
        void main() {
          gl_FragColor = vec4(texture2D(frame, vUv).rgb, amount);
        }
      `,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const geometry = new PlaneGeometry(2, 2);
    const quad = new Mesh(geometry, material);
    quad.frustumCulled = false;
    scene.add(quad);
    const buckets: Record<CabinZoomFadePart, Object3D[]> = { lower: [], upper: [], resident: [] };
    return { scene, material, geometry, camera: new Camera(), size: new Vector2(), buckets, active: [] as CabinZoomFadePart[] };
  }, []);

  useEffect(() => () => {
    pass.material.uniforms.frame.value?.dispose();
    pass.material.dispose();
    pass.geometry.dispose();
  }, [pass]);

  useFrame(({ gl, scene, camera }) => {
    const requested = opacity.current.zoomFades;
    if (requested.length === 0) {
      gl.render(scene, camera);
      return;
    }

    const { buckets, active } = pass;
    for (const part of requested) buckets[part].length = 0;
    scene.traverseVisible(node => {
      const part = node.userData.cabinZoomPart as CabinZoomFadePart | undefined;
      if (part && requested.includes(part)) buckets[part].push(node);
    });
    active.length = 0;
    for (const part of requested) {
      if (buckets[part].length > 0) active.push(part);
    }
    if (active.length === 0) {
      gl.render(scene, camera);
      return;
    }

    const autoClear = gl.autoClear;
    try {
      const { x: width, y: height } = gl.getDrawingBufferSize(pass.size);
      let texture = pass.material.uniforms.frame.value;
      if (!texture || texture.image.width !== width || texture.image.height !== height) {
        texture?.dispose();
        texture = new FramebufferTexture(width, height);
        pass.material.uniforms.frame.value = texture;
      }

      // Render the opaque base scene once, then composite each fading layer with its own opaque shaders.
      for (const part of active) {
        for (const node of buckets[part]) node.visible = false;
      }
      gl.autoClear = true;
      gl.render(scene, camera);

      for (const part of active) {
        gl.copyFramebufferToTexture(texture);
        for (const node of buckets[part]) node.visible = true;
        gl.autoClear = true;
        gl.render(scene, camera);
        gl.autoClear = false;
        pass.material.uniforms.amount.value = 1 - opacity.current[part];
        gl.render(pass.scene, pass.camera);
        for (const node of buckets[part]) node.visible = false;
      }
    } finally {
      for (const part of active) {
        for (const node of buckets[part]) node.visible = true;
        buckets[part].length = 0;
      }
      active.length = 0;
      gl.autoClear = autoClear;
    }
  }, 1);

  return null;
}
