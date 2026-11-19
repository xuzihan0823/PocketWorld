import { MeshStandardMaterial, SkinnedMesh, type Object3D } from 'three';

function warmSkin(material: MeshStandardMaterial) {
  const copy = material.clone();
  copy.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vRestHeight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRestHeight = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vRestHeight;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        // Luna's atlas shares skin, blue hair, lavender fabric and pink ribbon.
        // Select the light peach tones in linear RGB with soft edges at UV seams.
        vec3 base = sampledDiffuseColor.rgb;
        float skin =
          smoothstep(0.44, 0.75, base.r) *
          smoothstep(0.025, 0.13, base.r - base.g) *
          smoothstep(0.035, 0.15, base.r - base.b) *
          smoothstep(-0.035, 0.030, base.g - base.b);
        vec3 skinTint = mix(vec3(1.0), vec3(0.99, 0.84, 0.86), skin);
        float hair = smoothstep(0.07, 0.24, base.b - base.r) * smoothstep(0.015, 0.09, base.g - base.r);
        float hem = smoothstep(0.17, 0.24, vRestHeight) * (1.0 - smoothstep(0.49, 0.56, vRestHeight));
        float skirt = hem * smoothstep(0.24, 0.55, base.b) * (1.0 - skin) * (1.0 - hair);
        vec3 palette = skinTint * mix(vec3(1.0), vec3(1.0, .46, .44), skirt);
        diffuseColor.rgb *= palette;
      `)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        // The fill uses the same atlas; keep its effect around the eyes and hairline.
        totalEmissiveRadiance *= palette * mix(mix(1.0, .90, skin), .55, skirt);
      `);
  };
  copy.customProgramCacheKey = () => 'luna-original-hair-rose-skirt';
  return copy;
}

export function applyResidentSkin(mesh: Object3D) {
  const copies = new Map<MeshStandardMaterial, MeshStandardMaterial>();
  const bindings: { mesh: SkinnedMesh; original: MeshStandardMaterial }[] = [];
  mesh.traverse(object => {
    if (!(object instanceof SkinnedMesh)) return;
    const original = object.material;
    if (!(original instanceof MeshStandardMaterial) || !original.map || original.map !== original.emissiveMap) return;
    let material = copies.get(original);
    if (!material) {
      material = warmSkin(original);
      copies.set(original, material);
    }
    object.material = material;
    bindings.push({ mesh: object, original });
  });
  return () => {
    // SkeletonUtils shares materials and textures with the loader cache.
    for (const binding of bindings) binding.mesh.material = binding.original;
    for (const material of copies.values()) material.dispose();
  };
}
