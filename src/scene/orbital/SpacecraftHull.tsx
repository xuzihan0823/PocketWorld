import React, { Suspense, useEffect, useMemo, useRef } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { AssetBoundary } from './ReusableAsset';
import type { SunState } from './Cosmos';
import { SHIP_TARGET, type SpacecraftFlightState } from './spacecraftFlight';

interface MaterialSlot {
  material: THREE.MeshStandardMaterial;
  baseOpacity: number;
  baseTransparent: boolean;
  baseDepthWrite: boolean;
  baseEmissiveIntensity: number;
  kind: 'default' | 'window' | 'plume' | 'core' | 'beacon';
}

interface PlumeTarget {
  node: THREE.Object3D;
  lengthAxis: 'x' | 'y' | 'z';
}

interface SpacecraftHullProps {
  flight: SpacecraftFlightState;
  sun: SunState;
  reducedMotion: boolean;
  onEnterCabin: () => void;
  onReady?: () => void;
}

const HULL_MODEL_URL = `${import.meta.env.BASE_URL}models/cabin/spacecraft-hull.glb`;

function classifyMaterial(name: string): MaterialSlot['kind'] {
  if (name.includes('CabinWarmGlow')) return 'window';
  if (name.includes('ThrusterPlume')) return 'plume';
  if (name.includes('ThrusterCore')) return 'core';
  if (name.includes('Beacon')) return 'beacon';
  return 'default';
}

function SpacecraftHullMesh({ flight, sun, reducedMotion, onEnterCabin, onReady }: SpacecraftHullProps) {
  const { scene } = useGLTF(HULL_MODEL_URL);
  const groupRef = useRef<THREE.Group>(null);
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  const hovering = useRef(false);

  useEffect(() => { onReady?.(); }, [onReady]);

  const rig = useMemo(() => {
    const copy = scene.clone(true);
    const clonedMaterials = new Map<THREE.Material, MaterialSlot>();
    const plumes: PlumeTarget[] = [];
    let dish: THREE.Object3D | null = null;
    let dishBaseRot: THREE.Euler | null = null;
    const rimUniforms = {
      uSunViewDir: { value: new THREE.Vector3(-0.3, 0.6, -0.7).normalize() },
      uEarthViewDir: { value: new THREE.Vector3(0.1, -0.8, 0.5).normalize() },
      uDaylight: sun.daylight,
      uWarmth: sun.warmthUniform,
      uRimStrength: { value: 1 },
    };

    copy.traverse(node => {
      if (node.name === 'Comms_ParabolicDish') {
        dish = node;
        dishBaseRot = node.rotation.clone();
      }
      if (!(node instanceof THREE.Mesh)) return;

      const isPlume = node.name.startsWith('Thruster_Plume_');
      const isGlass = node.name.includes('Glass');
      node.castShadow = !isPlume && !isGlass;
      node.receiveShadow = !isPlume && !isGlass;

      if (isPlume) {
        node.geometry.computeBoundingBox();
        const size = new THREE.Vector3();
        node.geometry.boundingBox?.getSize(size);
        const lengthAxis: 'x' | 'y' | 'z' = size.y >= size.x && size.y >= size.z ? 'y'
          : size.z >= size.x ? 'z' : 'x';
        plumes.push({ node, lengthAxis });
      }

      const replaceMat = (mat: THREE.Material) => {
        const existing = clonedMaterials.get(mat);
        if (existing) return existing.material;
        const cloned = mat.clone();
        if (cloned instanceof THREE.MeshStandardMaterial) {
          const kind = classifyMaterial(cloned.name);
          if (kind === 'plume') {
            cloned.depthWrite = false;
            cloned.transparent = true;
            cloned.blending = THREE.AdditiveBlending;
            cloned.color.set('#3cb2ff');
            cloned.emissive.set('#4ac8ff');
            cloned.emissiveIntensity = 1.6;
          } else if (kind === 'default') {
            cloned.customProgramCacheKey = () => 'spacecraft-hull-orbital-rim-v1';
            cloned.onBeforeCompile = shader => {
              shader.uniforms.uSunViewDir = rimUniforms.uSunViewDir;
              shader.uniforms.uEarthViewDir = rimUniforms.uEarthViewDir;
              shader.uniforms.uDaylight = rimUniforms.uDaylight;
              shader.uniforms.uWarmth = rimUniforms.uWarmth;
              shader.uniforms.uRimStrength = rimUniforms.uRimStrength;
              shader.fragmentShader = `
                uniform vec3 uSunViewDir;
                uniform vec3 uEarthViewDir;
                uniform float uDaylight;
                uniform float uWarmth;
                uniform float uRimStrength;
              ` + shader.fragmentShader.replace(
                '#include <opaque_fragment>',
                /* glsl */ `
                vec3 rimViewDir = normalize(vViewPosition);
                float rimFresnel = pow(clamp(1.0 - abs(dot(normal, rimViewDir)), 0.0, 1.0), 3.1);
                float sunRimAlign = smoothstep(-0.16, 0.72, dot(normal, uSunViewDir));
                float earthRimAlign = smoothstep(-0.15, 0.75, dot(normal, uEarthViewDir));
                vec3 solarRim = mix(vec3(1.0, 0.94, 0.82), vec3(1.0, 0.62, 0.32), uWarmth * 0.8) * rimFresnel * sunRimAlign * (0.48 * uDaylight);
                vec3 earthRim = vec3(0.42, 0.72, 1.0) * rimFresnel * earthRimAlign * (0.22 + 0.16 * uDaylight);
                outgoingLight += (solarRim + earthRim) * uRimStrength;
                #include <opaque_fragment>
                `,
              );
            };
          }
          const slot: MaterialSlot = {
            material: cloned,
            baseOpacity: cloned.opacity,
            baseTransparent: cloned.transparent,
            baseDepthWrite: cloned.depthWrite,
            baseEmissiveIntensity: cloned.emissiveIntensity,
            kind,
          };
          clonedMaterials.set(mat, slot);
          return cloned;
        }
        return cloned;
      };

      if (Array.isArray(node.material)) node.material = node.material.map(replaceMat);
      else if (node.material) node.material = replaceMat(node.material);
    });

    return {
      copy,
      slots: Array.from(clonedMaterials.values()),
      plumes,
      dish: dish as THREE.Object3D | null,
      dishBaseRot: dishBaseRot as THREE.Euler | null,
      rimUniforms,
    };
  }, [scene, sun]);

  useEffect(() => () => {
    for (const slot of rig.slots) slot.material.dispose();
    if (hovering.current && typeof document !== 'undefined') document.body.style.cursor = '';
  }, [rig]);

  useFrame(({ camera }) => {
    const group = groupRef.current;
    if (!group) return;

    const opacity = flight.hullOpacity;
    if (opacity <= 0.004) {
      group.visible = false;
      rig.rimUniforms.uRimStrength.value = 0;
      if (hovering.current) {
        hovering.current = false;
        document.body.style.cursor = '';
      }
      return;
    }

    group.visible = true;
    rig.rimUniforms.uSunViewDir.value.copy(sun.direction).transformDirection(camera.matrixWorldInverse);
    rig.rimUniforms.uEarthViewDir.value.copy(sun.earthDirection).negate().transformDirection(camera.matrixWorldInverse);
    rig.rimUniforms.uRimStrength.value = opacity * opacity;
    const t = flight.clock;
    const boost = flight.boost;
    const daylight = sun.daylight.value;

    // Gentle orbital hover and boost surge while cruising; settles cleanly to origin during cabin cutaway
    const inCruise = flight.mode === 'orbit' || flight.mode === 'approach';
    const hoverWeight = inCruise && !reducedMotion ? opacity : 0;
    const bobY = Math.sin(t * 0.85) * 0.095 * hoverWeight;
    const surgeX = boost * 0.26 * hoverWeight;
    const vibe = boost > 0.05 ? Math.sin(t * 42) * 0.012 * boost * hoverWeight : 0;
    // Subtle outward architectural expansion around the duplex hull center as the shell opens into the interior cutaway
    const cutawayScale = 1 + (1 - opacity) * 0.045;
    const expandOffset = 1 - cutawayScale;
    group.position.set(
      surgeX + SHIP_TARGET.x * expandOffset,
      bobY + vibe + SHIP_TARGET.y * expandOffset,
      SHIP_TARGET.z * expandOffset,
    );
    group.rotation.set(
      Math.sin(t * 0.52) * 0.014 * hoverWeight,
      Math.sin(t * 0.37) * 0.010 * hoverWeight,
      boost * 0.032 * hoverWeight,
    );
    group.scale.setScalar(cutawayScale);

    // Animate twin engine exhaust plumes smoothly with boost + lively flicker
    const flicker = reducedMotion ? 1 : 0.94 + 0.06 * Math.sin(t * 34) + 0.04 * Math.cos(t * 53);
    const lengthScale = (0.48 + boost * 1.95) * flicker;
    const widthScale = (0.86 + boost * 0.28) * (0.97 + 0.03 * flicker);
    for (const { node, lengthAxis } of rig.plumes) {
      if (lengthAxis === 'y') node.scale.set(widthScale, lengthScale, widthScale);
      else if (lengthAxis === 'z') node.scale.set(widthScale, widthScale, lengthScale);
      else node.scale.set(lengthScale, widthScale, widthScale);
    }

    // Subtle slow comms dish sweep
    if (rig.dish && rig.dishBaseRot && !reducedMotion) {
      rig.dish.rotation.y = rig.dishBaseRot.y + Math.sin(t * 0.42) * 0.22;
    }

    // Update materials for cutaway opacity, orbital night window glow, beacon pulse & thruster core surge
    const fading = opacity < 0.995;
    const beaconPulse = reducedMotion ? 1 : 0.72 + 0.28 * Math.sin(t * 2.4);
    const nightBoost = 1 + (1 - daylight) * 0.85;
    for (const slot of rig.slots) {
      const m = slot.material;
      const nextTransparent = fading ? true : slot.baseTransparent;
      if (m.transparent !== nextTransparent) {
        m.transparent = nextTransparent;
        m.needsUpdate = true;
      }
      m.depthWrite = fading ? false : slot.baseDepthWrite;

      if (slot.kind === 'plume') {
        m.opacity = slot.baseOpacity * (0.55 + boost * 0.45) * opacity;
        m.emissiveIntensity = slot.baseEmissiveIntensity * (0.70 + boost * 1.15);
      } else if (slot.kind === 'core') {
        m.opacity = slot.baseOpacity * opacity;
        m.emissiveIntensity = slot.baseEmissiveIntensity * (0.85 + boost * 1.85);
      } else if (slot.kind === 'window') {
        m.opacity = slot.baseOpacity * opacity;
        m.emissiveIntensity = slot.baseEmissiveIntensity * nightBoost;
      } else if (slot.kind === 'beacon') {
        m.opacity = slot.baseOpacity * opacity;
        m.emissiveIntensity = slot.baseEmissiveIntensity * beaconPulse * (0.85 + (1 - daylight) * 0.5);
      } else {
        m.opacity = slot.baseOpacity * opacity;
      }
    }
  });

  const interactive = flight.mode === 'orbit' || flight.mode === 'approach';

  return (
    <group
      ref={groupRef}
      name="spacecraft-hull"
      onPointerOver={event => {
        if (!interactive || flight.hullOpacity < 0.8) return;
        event.stopPropagation();
        hovering.current = true;
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        if (!hovering.current) return;
        hovering.current = false;
        document.body.style.cursor = '';
      }}
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        if (!interactive || flight.hullOpacity < 0.8) return;
        pointerDownPos.current = { x: event.clientX, y: event.clientY };
      }}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        if (!interactive || flight.hullOpacity < 0.8) return;
        const start = pointerDownPos.current;
        pointerDownPos.current = null;
        if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 6) return;
        event.stopPropagation();
        onEnterCabin();
      }}
    >
      <primitive object={rig.copy} />
    </group>
  );
}

export function SpacecraftHull(props: SpacecraftHullProps) {
  return (
    <AssetBoundary fallback={null}>
      <Suspense fallback={null}>
        <SpacecraftHullMesh {...props} />
      </Suspense>
    </AssetBoundary>
  );
}
