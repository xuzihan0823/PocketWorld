import { MathUtils, Material, Mesh, type Group } from 'three';
import type { CabinDeck } from './cabinLayout';
import type { CabinView } from './cabinView';

type DeckOpacity = Record<CabinDeck, number>;
export type CabinZoomFadePart = CabinDeck | 'resident';
export type CabinOpacity = DeckOpacity & { resident: number; interior: number; zoomFades: CabinZoomFadePart[] };
export const QUICK_CABIN_DURATION = .65;

const DEFAULT_FADE_ORDER: readonly CabinZoomFadePart[] = ['lower', 'upper', 'resident'];

export function collectZoomFades(
  opacity: Pick<CabinOpacity, 'lower' | 'upper' | 'resident' | 'interior'>,
  order: readonly CabinZoomFadePart[] = DEFAULT_FADE_ORDER,
  out: CabinZoomFadePart[] = [],
): CabinZoomFadePart[] {
  out.length = 0;
  if (opacity.interior !== 1) return out;
  for (const part of order) {
    const value = opacity[part];
    if (value > 0 && value < 1) out.push(part);
  }
  return out;
}

export function cabinZoomIsolation(distanceRatio: number) {
  return 1 - MathUtils.smoothstep(distanceRatio, .75, .93);
}

export function cabinDeckOpacity(view: CabinView, isolation: number, ascent: number | null = null, from: CabinDeck | null = null): DeckOpacity {
  if (ascent === null || !from) {
    return { lower: view === 'upper' ? 1 - isolation : 1, upper: view === 'lower' ? 1 - isolation : 1 };
  }
  const progress = from === 'lower' ? ascent : 1 - ascent;
  const leaving = 1 - isolation * MathUtils.smoothstep(progress, .76, 1);
  const arriving = 1 - isolation * (1 - MathUtils.smoothstep(progress, 0, .26));
  return from === 'lower' ? { lower: leaving, upper: arriving } : { lower: arriving, upper: leaving };
}

export function quickCabinFrame(progress: number, start: DeckOpacity, target: CabinDeck, isolation: number) {
  const leaving = MathUtils.smoothstep(progress, 0, .5);
  const arriving = MathUtils.smoothstep(progress, .12, .85);
  return {
    lower: target === 'lower' ? MathUtils.lerp(start.lower, 1, arriving) : MathUtils.lerp(start.lower, 1 - isolation, leaving),
    upper: target === 'upper' ? MathUtils.lerp(start.upper, 1, arriving) : MathUtils.lerp(start.upper, 1 - isolation, leaving),
    resident: 1 - MathUtils.smoothstep(progress, .08, .43) + MathUtils.smoothstep(progress, .63, .93),
    relocate: progress >= .5,
  };
}

type DynamicMaterialProps = Material & {
  map?: unknown;
  color?: { copy: (source: unknown) => unknown };
  emissive?: { copy: (source: unknown) => unknown };
  emissiveIntensity?: number;
};

function syncFadedMaterial(original: Material, faded: Material) {
  faded.visible = original.visible;
  const src = original as DynamicMaterialProps;
  const dst = faded as DynamicMaterialProps;
  if ('map' in src && dst.map !== src.map) {
    dst.map = src.map;
    dst.needsUpdate = true;
  }
  if (src.color && dst.color) dst.color.copy(src.color);
  if (src.emissive && dst.emissive) dst.emissive.copy(src.emissive);
  if (typeof src.emissiveIntensity === 'number') dst.emissiveIntensity = src.emissiveIntensity;
}

export function createCabinGroupFade() {
  type MeshMaterial = Material | Material[];
  const meshes = new Map<Mesh, { original: MeshMaterial; faded: MeshMaterial; castShadow: boolean }>();
  const materials = new Map<Material, Material>();
  const activeMaterials = new Set<Material>();
  const disposeListeners = new Map<Material, () => void>();

  const restore = () => {
    for (const [mesh, { original, faded, castShadow }] of meshes) {
      if (mesh.material === faded) mesh.material = original;
      mesh.castShadow = castShadow;
    }
    meshes.clear();
    activeMaterials.clear();
  };

  const dispose = () => {
    restore();
    for (const [original, listener] of disposeListeners) {
      original.removeEventListener('dispose', listener);
    }
    disposeListeners.clear();
    for (const material of materials.values()) material.dispose();
    materials.clear();
  };

  const getFadedMaterial = (original: Material) => {
    let faded = materials.get(original);
    if (!faded) {
      faded = original.clone();
      if (original.onBeforeCompile !== Material.prototype.onBeforeCompile) {
        faded.onBeforeCompile = original.onBeforeCompile;
        faded.customProgramCacheKey = original.customProgramCacheKey;
      }
      faded.transparent = true;
      faded.alphaHash = false;
      faded.depthWrite = false;
      materials.set(original, faded);
      const onOriginalDispose = () => {
        original.removeEventListener('dispose', onOriginalDispose);
        disposeListeners.delete(original);
        activeMaterials.delete(original);
        const cached = materials.get(original);
        if (cached) {
          materials.delete(original);
          cached.dispose();
        }
      };
      original.addEventListener('dispose', onOriginalDispose);
      disposeListeners.set(original, onOriginalDispose);
    } else if (!activeMaterials.has(original)) {
      syncFadedMaterial(original, faded);
    }
    activeMaterials.add(original);
    return faded;
  };

  return {
    restore,
    dispose,
    set(group: Group, opacity: number) {
      group.visible = opacity > 0;
      group.userData.cabinInteractive = opacity >= .5;
      if (opacity === 0 || opacity === 1) { restore(); return; }

      group.traverseVisible(node => {
        if (!(node instanceof Mesh)) return;
        const entry = meshes.get(node);
        if (entry && node.material === entry.faded) return;
        const original = node.material;
        const faded = Array.isArray(original) ? original.map(getFadedMaterial) : getFadedMaterial(original);
        meshes.set(node, { original, faded, castShadow: entry?.castShadow ?? node.castShadow });
        node.castShadow = false;
        node.material = faded;
      });
      for (const original of activeMaterials) {
        const faded = materials.get(original);
        if (faded) faded.opacity = original.opacity * opacity;
      }
    },
  };
}
