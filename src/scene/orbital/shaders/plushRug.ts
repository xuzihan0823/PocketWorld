import * as THREE from 'three';
import { roundedRectInwardDistance } from '../cabinLayout.ts';

export const PLUSH_SHELL_COUNT = 32;
const FLUFF_SKIRT_MARGIN = 0.032;

export type PlushRugShape =
  | { kind: 'rounded-rect'; halfSize: readonly [number, number]; cornerRadius: number }
  | { kind: 'oval'; radii: readonly [number, number] };

export interface PlushRugSpec {
  shape: PlushRugShape;
  baseY: number;
  pileHeight: number;
  edgeFluff: number;
  tuftFreq: number;
  napLean: number;
  normalStrength: number;
  sheenStrength: number;
  tipLift: number;
  patternMode: 0 | 1 | 2; // 0: sea-salt bordered tufted, 1: cloud lambswool oval, 2: sage bordered
  mainColor: string;
  rootTint: readonly [number, number, number];
  tipColor: string;
  borderColor?: string;
  accentColor?: string;
  borderWidth?: number;
  accentWidth?: number;
}

function roundedRectLoop(hx: number, hz: number, corner: number, arcSteps = 8, edgeSteps = 10): [number, number][] {
  const pts: [number, number][] = [];
  const corners: [number, number, number][] = [
    [hx - corner, hz - corner, 0],
    [-hx + corner, hz - corner, Math.PI * 0.5],
    [-hx + corner, -hz + corner, Math.PI],
    [hx - corner, -hz + corner, Math.PI * 1.5],
  ];
  for (let ci = 0; ci < 4; ci++) {
    const [ox, oz, a0] = corners[ci]!;
    for (let s = 0; s < arcSteps; s++) {
      const ang = a0 + (Math.PI * 0.5) * (s / arcSteps);
      pts.push([ox + corner * Math.cos(ang), oz + corner * Math.sin(ang)]);
    }
    const angEnd = a0 + Math.PI * 0.5;
    const p0x = ox + corner * Math.cos(angEnd);
    const p0z = oz + corner * Math.sin(angEnd);
    const [nox, noz, na0] = corners[(ci + 1) % 4]!;
    const p1x = nox + corner * Math.cos(na0);
    const p1z = noz + corner * Math.sin(na0);
    for (let e = 0; e < edgeSteps; e++) {
      const t = e / edgeSteps;
      pts.push([p0x + (p1x - p0x) * t, p0z + (p1z - p0z) * t]);
    }
  }
  return pts;
}

function ovalLoop(rx: number, rz: number, segments = 72): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < segments; i++) {
    const ang = (Math.PI * 2 * i) / segments;
    pts.push([rx * Math.cos(ang), rz * Math.sin(ang)]);
  }
  return pts;
}

function inwardDistanceAndOutward(
  x: number,
  z: number,
  shape: PlushRugShape,
): { dist: number; ox: number; oz: number } {
  if (shape.kind === 'rounded-rect') {
    const [hx, hz] = shape.halfSize;
    const c = shape.cornerRadius;
    const dist = roundedRectInwardDistance(x, z, hx, hz, c);
    const eps = 0.004;
    const dx = roundedRectInwardDistance(x + eps, z, hx, hz, c) - roundedRectInwardDistance(x - eps, z, hx, hz, c);
    const dz = roundedRectInwardDistance(x, z + eps, hx, hz, c) - roundedRectInwardDistance(x, z - eps, hx, hz, c);
    const len = Math.hypot(dx, dz) || 1;
    // Outward points opposite to the inward-distance gradient.
    return { dist, ox: -dx / len, oz: -dz / len };
  }
  const [rx, rz] = shape.radii;
  const nx = x / rx;
  const nz = z / rz;
  const k0 = Math.hypot(nx, nz);
  if (k0 < 1e-6) return { dist: Math.min(rx, rz), ox: 0, oz: 0 };
  const gx = nx / rx;
  const gz = nz / rz;
  const gLen = Math.hypot(gx, gz) || 1;
  // First-order signed inward distance to the ellipse boundary in metres.
  const dist = (1 - k0) / gLen;
  return { dist, ox: gx / gLen, oz: gz / gLen };
}

/**
 * Build a smooth, upward-facing concentric-ring shell geometry with per-instance layer height
 * (`aShellLayer`), signed inward edge distance (`aEdgeDist`) and rim outward vector (`aOutward`).
 */
export function createPlushRugShellGeometry(
  spec: PlushRugSpec,
  shellCount = PLUSH_SHELL_COUNT,
): THREE.BufferGeometry {
  const { shape, baseY } = spec;
  const nominalPts =
    shape.kind === 'rounded-rect'
      ? roundedRectLoop(shape.halfSize[0], shape.halfSize[1], shape.cornerRadius, 8, 10)
      : ovalLoop(shape.radii[0], shape.radii[1], 72);

  const n = nominalPts.length;
  const minHalf = shape.kind === 'rounded-rect'
    ? Math.min(shape.halfSize[0], shape.halfSize[1])
    : Math.min(shape.radii[0], shape.radii[1]);

  // Fixed-metre rim rings follow the pillowed lip; interior rings scale smoothly by fraction of minHalf.
  const ringSpecs: readonly { mode: 'offset' | 'scale'; value: number; hFrac: number }[] = [
    { mode: 'offset', value: -FLUFF_SKIRT_MARGIN, hFrac: 0.14 },
    { mode: 'offset', value: -0.008, hFrac: 0.42 },
    { mode: 'offset', value: 0.014, hFrac: 0.78 },
    { mode: 'offset', value: 0.055, hFrac: 0.98 },
    { mode: 'scale', value: 0.78, hFrac: 1.0 },
    { mode: 'scale', value: 0.56, hFrac: 1.0 },
    { mode: 'scale', value: 0.34, hFrac: 1.0 },
    { mode: 'scale', value: 0.14, hFrac: 1.0 },
  ];

  const positions: number[] = [];
  const edgeDists: number[] = [];
  const outwards: number[] = [];

  for (let r = 0; r < ringSpecs.length; r++) {
    const ring = ringSpecs[r]!;
    for (let i = 0; i < n; i++) {
      const [px, pz] = nominalPts[i]!;
      const info = inwardDistanceAndOutward(px, pz, shape);
      let vx: number;
      let vz: number;
      if (ring.mode === 'offset') {
        vx = px - info.ox * ring.value;
        vz = pz - info.oz * ring.value;
      } else {
        vx = px * ring.value;
        vz = pz * ring.value;
      }
      const vInfo = inwardDistanceAndOutward(vx, vz, shape);
      const y = Math.max(0.0012, baseY * ring.hFrac);
      positions.push(vx, y, vz);
      edgeDists.push(vInfo.dist);
      outwards.push(vInfo.ox, vInfo.oz);
    }
  }

  // Single shared pole vertex at the rug center (pole-safe, zero degenerate edges).
  const centerIndex = ringSpecs.length * n;
  positions.push(0, baseY, 0);
  edgeDists.push(minHalf);
  outwards.push(0, 0);

  const indices: number[] = [];
  // Winding checked for +Y normals with ang increasing in XZ (clockwise from +Y):
  // (outer[i], inner[i], outer[j]) and (outer[j], inner[i], inner[j]).
  for (let r = 0; r < ringSpecs.length - 1; r++) {
    const oBase = r * n;
    const iBase = (r + 1) * n;
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      indices.push(oBase + i, iBase + i, oBase + j);
      indices.push(oBase + j, iBase + i, iBase + j);
    }
  }
  const innerBase = (ringSpecs.length - 1) * n;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(innerBase + i, centerIndex, innerBase + j);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aEdgeDist', new THREE.Float32BufferAttribute(edgeDists, 1));
  geometry.setAttribute('aOutward', new THREE.Float32BufferAttribute(outwards, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const layers = new Float32Array(shellCount);
  for (let i = 0; i < shellCount; i++) {
    layers[i] = (i + 0.5) / shellCount;
  }
  geometry.setAttribute('aShellLayer', new THREE.InstancedBufferAttribute(layers, 1));
  geometry.computeBoundingBox();
  if (geometry.boundingBox) {
    geometry.boundingBox.min.x -= spec.edgeFluff;
    geometry.boundingBox.max.x += spec.edgeFluff;
    geometry.boundingBox.min.z -= spec.edgeFluff;
    geometry.boundingBox.max.z += spec.edgeFluff;
    geometry.boundingBox.max.y += spec.pileHeight + 0.01;
  }
  geometry.computeBoundingSphere();
  return geometry;
}

const VERTEX_COMMON = /* glsl */ `
attribute float aShellLayer;
attribute float aEdgeDist;
attribute vec2 aOutward;

uniform float uPileHeight;
uniform float uEdgeFluff;

varying float vPrLayer;
varying vec2 vPrLocal;
varying float vPrEdgeDist;
varying vec3 vPrViewRight;
varying vec3 vPrViewForward;
`;

const VERTEX_BEGIN = /* glsl */ `
#include <begin_vertex>
float prRim = 1.0 - smoothstep(-0.024, 0.080, aEdgeDist);
float prLift = aShellLayer * uPileHeight * mix(1.0, 0.54, prRim);
transformed.y += prLift;
transformed.xz += aOutward * (aShellLayer * aShellLayer * uEdgeFluff * prRim);
vPrLayer = aShellLayer;
vPrLocal = transformed.xz;
vPrEdgeDist = aEdgeDist;
vPrViewRight = normalize((modelViewMatrix * vec4(1.0, 0.0, 0.0, 0.0)).xyz);
vPrViewForward = normalize((modelViewMatrix * vec4(0.0, 0.0, 1.0, 0.0)).xyz);
`;

const FRAGMENT_COMMON = /* glsl */ `
uniform float uTuftFreq;
uniform float uNapLean;
uniform float uNormalStrength;
uniform float uSheenStrength;
uniform float uTipLift;
uniform float uPatternMode;
uniform vec3 uMainColor;
uniform vec3 uRootColor;
uniform vec3 uTipColor;
uniform vec3 uBorderColor;
uniform vec3 uAccentColor;
uniform vec3 uShapeParams; // (hx, hz, corner) for rounded-rect, (rx, rz, 0) for oval
uniform vec2 uBorderWidths; // (outerBorderWidth, accentBandWidth)

varying float vPrLayer;
varying vec2 vPrLocal;
varying float vPrEdgeDist;
varying vec3 vPrViewRight;
varying vec3 vPrViewForward;

// Precision-safe 2D hash (no platform-dependent sin artifacts).
vec2 prHash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float prHash21(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float prValueNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  // Quintic C2 interpolation prevents grid-aligned creases in brushed nap waves.
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = prHash21(i);
  float b = prHash21(i + vec2(1.0, 0.0));
  float c = prHash21(i + vec2(0.0, 1.0));
  float d = prHash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float prFbm(vec2 p) {
  // Rotate every octave by ~37 deg so no axis-aligned square bands ever appear.
  const mat2 rot = mat2(0.80, -0.60, 0.60, 0.80);
  float v = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 3; i++) {
    v += amp * prValueNoise(p);
    p = rot * p * 2.04 + vec2(13.7, 7.3);
    amp *= 0.5;
  }
  return v;
}

float prRoundedRectInward(vec2 p, vec2 h, float r) {
  vec2 q = abs(p) - (h - vec2(r));
  float outD = length(max(q, 0.0));
  float inD = min(max(q.x, q.y), 0.0);
  return -(outD + inD - r);
}

// Smooth combed-plush nap direction field (creates velvety brushed-pile light/dark sweeps).
vec2 prNapFlow(vec2 p) {
  vec2 q = mat2(0.866, -0.5, 0.5, 0.866) * p;
  float a = (prFbm(q * 0.72 + vec2(3.1, 1.7)) - 0.5) * 3.2
          + (prValueNoise(q * 1.65 + vec2(9.2, 4.4)) - 0.5) * 0.9;
  return vec2(cos(a), sin(a));
}

struct PrTuft {
  float dist;
  vec2 localVec;
  vec2 cellPos;
  float cellHeight;
  float cellTone;
};

PrTuft prEvalTuft(vec2 p, float freq) {
  vec2 g = p * freq;
  vec2 iBase = floor(g);
  float bestD2 = 1e6;
  vec2 bestVec = vec2(0.0);
  vec2 bestCell = iBase;
  for (int dy = -1; dy <= 1; dy++) {
    for (int dx = -1; dx <= 1; dx++) {
      vec2 cell = iBase + vec2(float(dx), float(dy));
      vec2 jitter = 0.14 + 0.72 * prHash22(cell);
      vec2 center = cell + jitter;
      vec2 diff = g - center;
      float d2 = dot(diff, diff);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestVec = diff;
        bestCell = center;
      }
    }
  }
  vec2 cellId = floor(bestCell);
  float rH = prHash21(cellId + vec2(17.3, 41.9));
  float rT = prHash21(cellId + vec2(73.1, 11.7));
  PrTuft res;
  res.dist = sqrt(bestD2);
  res.localVec = bestVec;
  res.cellPos = bestCell / freq;
  res.cellHeight = mix(0.56, 1.0, rH);
  res.cellTone = rT;
  return res;
}
`;

const FRAGMENT_COLOR = /* glsl */ `
#include <color_fragment>
vec2 prNap = prNapFlow(vPrLocal);
float prH = vPrLayer;
// Lean each plush strand organically along the combed nap + subtle per-patch curl.
vec2 prSampleP = vPrLocal - prNap * (prH * prH * uNapLean);
PrTuft prTuft = prEvalTuft(prSampleP, uTuftFreq);

// Secondary fine microfiber yarn strands inside each wool tuft (fwidth-damped for zero distant shimmer).
float prPxSize = length(fwidth(vPrLocal));
float prCloseDetail = 1.0 - smoothstep(0.0035, 0.011, prPxSize);
float prFine = prValueNoise(prSampleP * (uTuftFreq * 2.85) + prNap * 0.6);

// Macro fleece clumping gives cloud-soft undulating pile thickness across the rug.
float prMacroClump = mix(0.84, 1.08, prFbm(vPrLocal * 4.5 + vec2(2.3, 5.1)));

// Organic fuzzy perimeter contour so the rug edge reads as soft plush tufts, not a sharp CAD line.
float prEdgeWobble = (prFbm(vPrLocal * 12.0 + vec2(4.1, 8.7)) - 0.5) * 0.044
                   + (prTuft.cellHeight - 0.78) * 0.032;
float prRimMask = smoothstep(-0.028, 0.046, vPrEdgeDist + prEdgeWobble);
if (prRimMask <= 0.02) discard;

// Taper wool tufts smoothly from thick interlocking roots to soft wispy tips.
float prDistGuard = smoothstep(0.0045, 0.014, prPxSize) * 0.13 * (1.0 - prH * 0.45);
float prTaperRadius = mix(0.92, 0.24, pow(prH, 1.12)) + prDistGuard;
float prWispMod = mix(1.0, 0.72 + 0.44 * prFine, smoothstep(0.14, 0.85, prH) * prCloseDetail);
float prProfile = 1.0 - smoothstep(0.0, prTaperRadius * prWispMod, prTuft.dist);
float prMaxH = prTuft.cellHeight * prMacroClump * prRimMask * (0.40 + 0.68 * prProfile);
if (prH > prMaxH) discard;

// Evaluate yarn color at the Voronoi tuft center so border edges look genuinely hand-tufted!
vec3 prYarnColor = uMainColor;
if (uPatternMode < 0.5) {
  float prCellEdge = prRoundedRectInward(prTuft.cellPos, uShapeParams.xy, uShapeParams.z);
  if (prCellEdge < uBorderWidths.x) {
    prYarnColor = uBorderColor;
  } else if (prCellEdge < uBorderWidths.x + uBorderWidths.y) {
    prYarnColor = uAccentColor;
  }
} else if (uPatternMode > 1.5) {
  float prCellEdge = prRoundedRectInward(prTuft.cellPos, uShapeParams.xy, uShapeParams.z);
  if (prCellEdge < uBorderWidths.x) {
    prYarnColor = uBorderColor;
  }
}

// Natural yarn-to-yarn melange wool variation.
float prHeather = (prTuft.cellTone - 0.5) * 0.11;
prYarnColor *= (1.0 + prHeather);

// Deep warm-darkened plush roots rising to airy, bright fluffy wool tips + brushed nap sheen!
float prRootMix = pow(prH, 0.72);
vec3 prDeepRoot = prYarnColor * uRootColor;
vec3 prPlushRgb = mix(prDeepRoot, prYarnColor * 1.05, prRootMix);

// Crevice darkening near each tuft's outer boundary reinforces tactile fluff separation.
float prCrevice = mix(0.78, 1.06, 1.0 - clamp(prTuft.dist * 1.35, 0.0, 1.0));
prPlushRgb *= prCrevice;

// Subtle grounded contact darkening at the lowest perimeter tufts where wool meets the oak floor.
float prFloorContact = 1.0 - (1.0 - smoothstep(-0.025, 0.055, vPrEdgeDist)) * (1.0 - smoothstep(0.0, 0.42, prH)) * 0.24;
prPlushRgb *= prFloorContact;

// Silky combed plush nap directional sheen (gentle & seamless, never blocky).
float prNapWave = 1.0 + dot(prNap, vec2(0.65, -0.76)) * 0.062 * smoothstep(0.15, 0.88, prH);
prPlushRgb *= prNapWave;

// Powdery light-scattering fluffy tips (preserves yarn hue while lifting airy wool tips).
vec3 prAiryTip = mix(prPlushRgb * 1.22, uTipColor, 0.44);
prPlushRgb = mix(prPlushRgb, prAiryTip, pow(prH, 1.72) * uTipLift);
diffuseColor.rgb = prPlushRgb;
`;

const FRAGMENT_NORMAL = /* glsl */ `
#include <normal_fragment_maps>
vec2 prTilt = (prTuft.localVec * 0.68 + prNap * 0.24) * uNormalStrength * mix(0.45, 1.0, prH);
normal = normalize(normal + vPrViewRight * prTilt.x + vPrViewForward * prTilt.y);
`;

const FRAGMENT_LIGHTS_END = /* glsl */ `
#include <lights_fragment_end>
vec3 prViewDir = normalize(vViewPosition);
float prFresnel = pow(1.0 - clamp(dot(normal, prViewDir), 0.0, 1.0), 2.35);
float prSheen = prFresnel * smoothstep(0.14, 0.96, vPrLayer) * uSheenStrength;
vec3 prLightEnergy = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
reflectedLight.indirectDiffuse += prLightEnergy * prSheen * vec3(1.06, 1.03, 0.99);
`;

/**
 * Create a PBR MeshStandardMaterial augmented with volumetric multi-shell plush wool pile.
 * Automatically receives Three.js sun/lamp/earthshine lighting, IBL, ACES tone mapping, and shadows.
 */
export function createPlushRugShellMaterial(spec: PlushRugSpec): THREE.MeshStandardMaterial {
  const material = new THREE.MeshStandardMaterial({
    color: '#ffffff',
    roughness: 0.96,
    metalness: 0.0,
    side: THREE.FrontSide,
  });

  const shapeParams =
    spec.shape.kind === 'rounded-rect'
      ? new THREE.Vector3(spec.shape.halfSize[0], spec.shape.halfSize[1], spec.shape.cornerRadius)
      : new THREE.Vector3(spec.shape.radii[0], spec.shape.radii[1], 0);

  material.onBeforeCompile = shader => {
    shader.uniforms.uPileHeight = { value: spec.pileHeight };
    shader.uniforms.uEdgeFluff = { value: spec.edgeFluff };
    shader.uniforms.uTuftFreq = { value: spec.tuftFreq };
    shader.uniforms.uNapLean = { value: spec.napLean };
    shader.uniforms.uNormalStrength = { value: spec.normalStrength };
    shader.uniforms.uSheenStrength = { value: spec.sheenStrength };
    shader.uniforms.uTipLift = { value: spec.tipLift };
    shader.uniforms.uPatternMode = { value: spec.patternMode };
    shader.uniforms.uMainColor = { value: new THREE.Color(spec.mainColor) };
    shader.uniforms.uRootColor = { value: new THREE.Vector3(...spec.rootTint) };
    shader.uniforms.uTipColor = { value: new THREE.Color(spec.tipColor) };
    shader.uniforms.uBorderColor = { value: new THREE.Color(spec.borderColor ?? spec.mainColor) };
    shader.uniforms.uAccentColor = { value: new THREE.Color(spec.accentColor ?? spec.mainColor) };
    shader.uniforms.uShapeParams = { value: shapeParams };
    shader.uniforms.uBorderWidths = { value: new THREE.Vector2(spec.borderWidth ?? 0.165, spec.accentWidth ?? 0.10) };

    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERTEX_COMMON}`)
      .replace('#include <begin_vertex>', VERTEX_BEGIN);

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAGMENT_COMMON}`)
      .replace('#include <color_fragment>', FRAGMENT_COLOR)
      .replace('#include <normal_fragment_maps>', FRAGMENT_NORMAL)
      .replace('#include <lights_fragment_end>', FRAGMENT_LIGHTS_END);
  };

  material.customProgramCacheKey = () => 'orbital-plush-rug-v1';
  return material;
}
