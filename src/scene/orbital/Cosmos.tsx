import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CABIN_LEFT, CABIN_RIGHT } from './cabinLayout';
import { EARTH_RADIUS, earthPositionForAspect } from './cabinView';
import { orbitCelestialLayout, type SpacecraftFlightState } from './spacecraftFlight';
import {
  skyVertex, skyFragment, starVertex, starFragment, particleVertex, particleFragment,
  planetVertex, earthFragment, cloudFragment, atmosphereFragment, moonFragment,
} from './shaders/cosmos';
import {
  BASE_SUN_DIRECTION, SUN_CYCLE_SECONDS, createOrbitSunRig, createSunOrbit,
  readSunOverrides, roomLightDirection, sampleOrbitSun, sampleSun, startPhase,
} from './sunCycle';

/**
 * Shared, mutable Sun state. `Cosmos` writes it once per frame; the sky, Earth, Moon, and the
 * room key light read it, so all celestial bodies and cabin lighting stay synchronized.
 */
export interface SunState {
  /** Unit vector from the habitat toward the rendered sky Sun (world space). */
  direction: THREE.Vector3;
  /** Key-light direction for the room & spacecraft: never shines from below the cabin floor. */
  light: THREE.Vector3;
  /** Surface illumination Sun vector for Earth (tilted to expose sunlit horizon cap in orbit). */
  earthLitSun: THREE.Vector3;
  /** Surface illumination Sun vector for the Moon (sculpted crescent-quarter phase toward uSun). */
  moonLitSun: THREE.Vector3;
  /** Active Earth world direction (for sky airglow & spacecraft Earthshine rim). */
  earthDirection: THREE.Vector3;
  /** 0 inside Earth's shadow, 1 in full sunlight. */
  daylight: { value: number };
  /** 1 while the Sun grazes Earth's limb, 0 far from it. */
  warmth: number;
  /** Uniform wrapper synced with `warmth` for shader materials. */
  warmthUniform: { value: number };
  /** 0 inside cabin, 1 in exterior orbital cruise (`hullOpacity`). */
  orbitUniform: { value: number };
}

export function createSunState(): SunState {
  const direction = new THREE.Vector3(...BASE_SUN_DIRECTION).normalize();
  return {
    direction,
    light: direction.clone(),
    earthLitSun: direction.clone(),
    moonLitSun: direction.clone(),
    earthDirection: new THREE.Vector3(0.25, -0.40, -0.88).normalize(),
    daylight: { value: 1 },
    warmth: 0,
    warmthUniform: { value: 0 },
    orbitUniform: { value: 0 },
  };
}

const GALACTIC_POLE = new THREE.Vector3(0.32, 0.88, -0.35).normalize();
const STAR_COUNT = 12000;
const STAR_RADIUS = 1400;
const DRIFT_COUNT = 320;
const NO_RAYCAST = () => undefined;
const STAR_COLORS = ['#7aa4ff', '#9cbaff', '#cadbff', '#f5f7ff', '#fff3e2', '#ffd7ab', '#ffb684'].map(hex => new THREE.Color(hex));
const DRIFT_COLORS = ['#7fd4ff', '#a8e4ff', '#e6f4ff', '#9fb8ff', '#ffe8c8', '#b8f0e8'].map(hex => new THREE.Color(hex));

function seededRandom(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createStarGeometry() {
  const random = seededRandom(20261106);
  const positions = new Float32Array(STAR_COUNT * 3);
  const colors = new Float32Array(STAR_COUNT * 3);
  const sizes = new Float32Array(STAR_COUNT);
  const twinkles = new Float32Array(STAR_COUNT * 2);
  const tangent = new THREE.Vector3().crossVectors(GALACTIC_POLE, new THREE.Vector3(0, 0, 1)).normalize();
  const bitangent = new THREE.Vector3().crossVectors(GALACTIC_POLE, tangent);
  const direction = new THREE.Vector3();

  // Precompute 6 open star cluster centers along and near the galactic plane
  const clusters = Array.from({ length: 6 }, (_, idx) => {
    const angle = (idx / 6) * Math.PI * 2 + (random() - 0.5) * 0.45;
    const latOffset = (random() - 0.5) * 0.26;
    return new THREE.Vector3()
      .copy(tangent).multiplyScalar(Math.cos(angle))
      .addScaledVector(bitangent, Math.sin(angle))
      .addScaledVector(GALACTIC_POLE, latOffset)
      .normalize();
  });

  for (let i = 0; i < STAR_COUNT; i++) {
    const roll = random();
    let isClusterStar = false;
    if (roll < 0.48) {
      // Galactic disc & core bulge stars
      const inBulge = random() < 0.28;
      const angle = inBulge ? (random() - 0.5) * 1.15 : random() * Math.PI * 2;
      const gaussian = Math.sqrt(-2 * Math.log(random() + 1e-6)) * Math.cos(Math.PI * 2 * random());
      const spread = inBulge ? 0.16 : 0.105;
      direction.copy(tangent).multiplyScalar(Math.cos(angle))
        .addScaledVector(bitangent, Math.sin(angle))
        .addScaledVector(GALACTIC_POLE, gaussian * spread);
    } else if (roll < 0.55) {
      // Compact open star clusters (Pleiades / Jewel Box style)
      isClusterStar = true;
      const center = clusters[Math.floor(random() * clusters.length)];
      const r1 = Math.sqrt(-2 * Math.log(random() + 1e-6)) * 0.022;
      const theta = random() * Math.PI * 2;
      direction.copy(center).add(new THREE.Vector3(
        Math.cos(theta) * r1,
        (random() - 0.5) * 0.028,
        Math.sin(theta) * r1,
      ));
    } else {
      // All-sky background field stars
      direction.set(random() * 2 - 1, random() * 2 - 1, random() * 2 - 1);
      if (direction.lengthSq() < 1e-4) direction.set(0, 1, 0);
    }
    direction.setLength(STAR_RADIUS).toArray(positions, i * 3);
    const magnitude = Math.pow(random(), isClusterStar ? 4.8 : 6.8);
    // Cluster stars skew toward young hot blue-white O/B/A spectral types
    const colorIdx = isClusterStar
      ? Math.floor(Math.pow(random(), 1.8) * 4)
      : Math.floor(random() * STAR_COLORS.length);
    const color = STAR_COLORS[colorIdx];
    const brightness = 0.22 + 0.52 * random() + magnitude * 1.42;
    colors.set([color.r * brightness, color.g * brightness, color.b * brightness], i * 3);
    sizes[i] = 0.85 + magnitude * 4.9;
    twinkles.set([random() * Math.PI * 2, 0.35 + random() * 2.7], i * 2);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aTwinkle', new THREE.BufferAttribute(twinkles, 2));
  return geometry;
}

function createDriftGeometry() {
  const random = seededRandom(20261112);
  const positions = new Float32Array(DRIFT_COUNT * 3);
  const colors = new Float32Array(DRIFT_COUNT * 3);
  const sizes = new Float32Array(DRIFT_COUNT);
  const seeds = new Float32Array(DRIFT_COUNT * 4);
  const point = new THREE.Vector3();
  let i = 0;
  while (i < DRIFT_COUNT) {
    const deepLayer = i >= Math.floor(DRIFT_COUNT * 0.65);
    if (!deepLayer) {
      point.set(-14 + random() * 42, 0.6 + random() * 9.8, -14 + random() * 28);
    } else {
      // Outer orbital halo surrounding the station for 360° camera parallax
      const theta = random() * Math.PI * 2;
      const radius = 16 + random() * 28;
      point.set(Math.cos(theta) * radius + 4, -2.5 + random() * 16, Math.sin(theta) * radius);
    }
    const inHabitatVolume = point.y < 9.5 && Math.abs(point.z) < 6.5 && point.x > CABIN_LEFT - 1.5 && point.x < CABIN_RIGHT + 6.0;
    const inObservatoryVolume = point.y < 4.5 && Math.abs(point.z) < 6 && Math.abs(point.x - 14) < 6;
    if (inHabitatVolume || inObservatoryVolume) continue;
    point.toArray(positions, i * 3);
    const color = DRIFT_COLORS[Math.floor(random() * DRIFT_COLORS.length)];
    const brightness = 0.52 + random() * 0.62;
    colors.set([color.r * brightness, color.g * brightness, color.b * brightness], i * 3);
    sizes[i] = (deepLayer ? 1.9 : 1.4) + random() * 2.8;
    seeds.set([random() * Math.PI * 2, random() * Math.PI * 2, random() * Math.PI * 2, random()], i * 4);
    i++;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 4));
  return geometry;
}

interface CosmicClock { value: number }

function Drift({ clock, sun, flight }: { clock: CosmicClock; sun: SunState; flight?: SpacecraftFlightState }) {
  const geometry = useMemo(createDriftGeometry, []);
  const dpr = useThree(state => state.viewport.dpr);
  const zeroTravel = useMemo(() => ({ value: 0 }), []);
  const zeroBoost = useMemo(() => ({ value: 0 }), []);
  const uniforms = useMemo(() => ({
    uTime: clock,
    uPixelRatio: { value: dpr },
    uSun: { value: sun.direction },
    uDaylight: sun.daylight,
    uWarmth: sun.warmthUniform,
    uTravel: flight ? flight.travelUniform : zeroTravel,
    uBoost: flight ? flight.boostUniform : zeroBoost,
  }), [clock, sun, flight, zeroTravel, zeroBoost]);
  useEffect(() => { uniforms.uPixelRatio.value = dpr; }, [dpr, uniforms]);
  return (
    <points geometry={geometry} raycast={NO_RAYCAST} frustumCulled={false}>
      <shaderMaterial uniforms={uniforms} vertexShader={particleVertex} fragmentShader={particleFragment}
        transparent blending={THREE.AdditiveBlending} depthWrite={false} />
    </points>
  );
}

function CelestialSphere({ clock, sun, onBeforeRender }: { clock: CosmicClock; sun: SunState; onBeforeRender: THREE.Object3D['onBeforeRender'] }) {
  const sphere = useRef<THREE.Group>(null);
  const dpr = useThree(state => state.viewport.dpr);
  const starGeometry = useMemo(createStarGeometry, []);
  const skyUniforms = useMemo(() => ({
    uTime: clock,
    uSun: { value: sun.direction },
    uDaylight: sun.daylight,
    uWarmth: sun.warmthUniform,
    uOrbit: sun.orbitUniform,
    uGalacticPole: { value: GALACTIC_POLE },
    uEarthGlow: { value: sun.earthDirection },
  }), [clock, sun]);
  const starUniforms = useMemo(() => ({
    uTime: clock,
    uPixelRatio: { value: dpr },
    uDaylight: sun.daylight,
    uOrbit: sun.orbitUniform,
  }), [clock, sun]);
  useEffect(() => { starUniforms.uPixelRatio.value = dpr; }, [dpr, starUniforms]);
  useFrame(() => { sphere.current?.quaternion.setFromAxisAngle(GALACTIC_POLE, clock.value * 0.0025); });
  return (
    <group ref={sphere}>
      <mesh renderOrder={-101} raycast={NO_RAYCAST} frustumCulled={false} onBeforeRender={onBeforeRender}>
        <sphereGeometry args={[1600, 64, 32]} />
        <shaderMaterial uniforms={skyUniforms} vertexShader={skyVertex} fragmentShader={skyFragment} side={THREE.BackSide} depthWrite={false} />
      </mesh>
      <points geometry={starGeometry} renderOrder={-100} raycast={NO_RAYCAST} frustumCulled={false}>
        <shaderMaterial uniforms={starUniforms} vertexShader={starVertex} fragmentShader={starFragment}
          transparent blending={THREE.AdditiveBlending} depthWrite={false} />
      </points>
    </group>
  );
}

function Moon({
  clock,
  sun,
  cabinPosition,
  cabinRadius,
  orbitPosition,
  orbitRadius,
}: {
  clock: CosmicClock;
  sun: SunState;
  cabinPosition: [number, number, number];
  cabinRadius: number;
  orbitPosition: [number, number, number];
  orbitRadius: number;
}) {
  const group = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Mesh>(null);
  const uniforms = useMemo(() => ({
    uSun: { value: sun.direction },
    uLitSun: { value: sun.moonLitSun },
    uDaylight: sun.daylight,
    uOrbit: sun.orbitUniform,
  }), [sun]);
  useFrame(() => {
    if (!group.current) return;
    const t = sun.orbitUniform.value;
    group.current.position.set(
      THREE.MathUtils.lerp(cabinPosition[0], orbitPosition[0], t),
      THREE.MathUtils.lerp(cabinPosition[1], orbitPosition[1], t),
      THREE.MathUtils.lerp(cabinPosition[2], orbitPosition[2], t),
    );
    const radius = THREE.MathUtils.lerp(cabinRadius, orbitRadius, t);
    group.current.scale.setScalar(radius);
    if (spin.current) {
      // Subtle lunar libration / slow orbital rotation
      spin.current.rotation.y = 0.65 + clock.value * 0.0018;
    }
  });
  return (
    <group ref={group} position={orbitPosition} scale={orbitRadius} rotation={[0.18, -0.42, -0.14]}>
      <mesh ref={spin} name="cosmos-moon" renderOrder={-94} raycast={NO_RAYCAST}>
        <sphereGeometry args={[1, 72, 48]} />
        <shaderMaterial uniforms={uniforms} vertexShader={planetVertex} fragmentShader={moonFragment} />
      </mesh>
    </group>
  );
}

function Earth({
  clock,
  sun,
  cabinPosition,
  orbitPosition,
  orbitRadius,
  flight,
}: {
  clock: CosmicClock;
  sun: SunState;
  cabinPosition: [number, number, number];
  orbitPosition: [number, number, number];
  orbitRadius: number;
  flight?: SpacecraftFlightState;
}) {
  const root = useRef<THREE.Group>(null);
  const spin = useRef<THREE.Group>(null);
  const baseRadius = EARTH_RADIUS;
  const uniforms = useMemo(() => ({
    uTime: clock,
    uSun: { value: sun.direction },
    uLitSun: { value: sun.earthLitSun },
    uOrbit: sun.orbitUniform,
  }), [clock, sun]);
  useFrame(() => {
    const t = sun.orbitUniform.value;
    if (root.current) {
      root.current.position.set(
        THREE.MathUtils.lerp(cabinPosition[0], orbitPosition[0], t),
        THREE.MathUtils.lerp(cabinPosition[1], orbitPosition[1], t),
        THREE.MathUtils.lerp(cabinPosition[2], orbitPosition[2], t),
      );
      root.current.scale.setScalar(orbitRadius / baseRadius);
    }
    if (!spin.current) return;
    spin.current.rotation.y = (flight ? flight.earthSpinAngle : clock.value * 0.008) + 2.32;
    spin.current.rotation.z = flight ? flight.earthOrbitSweep * 0.35 : 0;
  });
  return (
    <group ref={root} position={orbitPosition} rotation={[1.22, 0.35, -0.26]}>
      <group ref={spin}>
        <mesh renderOrder={-90} raycast={NO_RAYCAST}>
          <sphereGeometry args={[baseRadius, 128, 96]} />
          <shaderMaterial uniforms={uniforms} vertexShader={planetVertex} fragmentShader={earthFragment} />
        </mesh>
        <mesh renderOrder={-89} raycast={NO_RAYCAST}>
          <sphereGeometry args={[baseRadius * 1.0032, 128, 96]} />
          <shaderMaterial uniforms={uniforms} vertexShader={planetVertex} fragmentShader={cloudFragment} transparent depthWrite={false} />
        </mesh>
      </group>
      <mesh renderOrder={-88} raycast={NO_RAYCAST}>
        <sphereGeometry args={[baseRadius * 1.0092, 128, 96]} />
        <shaderMaterial uniforms={uniforms} vertexShader={planetVertex} fragmentShader={atmosphereFragment}
          transparent blending={THREE.AdditiveBlending} depthWrite={false} />
      </mesh>
    </group>
  );
}

/** Mount once inside Canvas, outside SCENE_ORIGINS. Compatible with near=.1 / far=2000.
 * Copy only camera translation at draw time, after camera controls have run, retaining
 * celestial directions during rotations and removing room-scale stellar parallax.
 *
 * Also advances the compressed orbital day and writes it into `sun` (see sunCycle.ts).
 * Reduced motion keeps the Sun at its starting position unless `?sun=` pins a phase.
 */
export const Cosmos: React.FC<{ reducedMotion: boolean; sun: SunState; flight?: SpacecraftFlightState }> = ({ reducedMotion, sun, flight }) => {
  const distant = useRef<THREE.Group>(null);
  const worldPosition = useMemo(() => new THREE.Vector3(), []);
  const cabinLightVec = useMemo(() => new THREE.Vector3(), []);
  const orbitLightVec = useMemo(() => new THREE.Vector3(), []);
  const upVec = useMemo(() => new THREE.Vector3(), []);
  const lookVec = useMemo(() => new THREE.Vector3(), []);
  const moonViewDir = useMemo(() => new THREE.Vector3(), []);
  const clock = useMemo<CosmicClock>(() => ({ value: 0 }), []);
  const aspect = useThree(state => state.size.width / Math.max(1, state.size.height));
  const cabinEarthPosition = useMemo(() => earthPositionForAspect(aspect), [aspect]);
  const orbitLayout = useMemo(() => orbitCelestialLayout(aspect), [aspect]);
  const cabinOrbit = useMemo(() => createSunOrbit(cabinEarthPosition, EARTH_RADIUS), [cabinEarthPosition]);
  const initialSunPhase = useMemo(() => startPhase(cabinOrbit), [cabinOrbit]);
  const orbitSunRig = useMemo(
    () => createOrbitSunRig(
      orbitLayout.earthPosition,
      orbitLayout.earthRadius,
      orbitLayout.upDirection,
      orbitLayout.sunStartTarget,
      initialSunPhase,
    ),
    [orbitLayout, initialSunPhase],
  );
  const overrides = useMemo(() => readSunOverrides(window.location.search), []);
  const phase = useRef<number | null>(null);
  const follow = (camera: THREE.Camera) => {
    if (!distant.current) return;
    camera.getWorldPosition(worldPosition);
    distant.current.position.copy(worldPosition);
    distant.current.parent?.worldToLocal(distant.current.position);
  };
  useFrame(({ camera }, delta) => {
    const step = Math.min(delta, 0.1);
    const boost = flight?.boost ?? 0;
    const timeScale = flight?.timeScale ?? 1;
    const orbitPresence = flight ? THREE.MathUtils.clamp(flight.hullOpacity, 0, 1) : 0;
    sun.orbitUniform.value = orbitPresence;

    if (!reducedMotion) clock.value += step * (1 + boost * 4.5);
    if (phase.current === null) phase.current = overrides.phase ?? initialSunPhase;
    else if (overrides.phase === null && (!reducedMotion || boost > 0.01)) {
      phase.current = (phase.current + step * overrides.speed * timeScale / SUN_CYCLE_SECONDS) % 1;
    }

    const cabinSample = sampleSun(cabinOrbit, phase.current);
    const orbitSample = sampleOrbitSun(orbitSunRig, phase.current);
    const daylight = orbitSample.daylight;
    const warmth = orbitSample.warmth;

    // Unified celestial Sun across both exterior orbit and interior cabin (no jump or revert on entering cabin!)
    sun.direction.set(...orbitSample.direction);

    // Keep indoor room key-light shadow direction open-front inside cabin so walls never cast dark shadows on furniture
    cabinLightVec.set(...roomLightDirection(cabinSample.direction));
    orbitLightVec.set(...roomLightDirection(orbitSample.direction, 0.36));
    sun.light.copy(cabinLightVec).lerp(orbitLightVec, orbitPresence).normalize();

    // Active Earth world direction for sky halo & spacecraft rim bounce
    sun.earthDirection.set(
      THREE.MathUtils.lerp(orbitLayout.cabinEarthPosition[0], orbitLayout.earthPosition[0], orbitPresence),
      THREE.MathUtils.lerp(orbitLayout.cabinEarthPosition[1], orbitLayout.earthPosition[1], orbitPresence),
      THREE.MathUtils.lerp(orbitLayout.cabinEarthPosition[2], orbitLayout.earthPosition[2], orbitPresence),
    ).normalize();

    // Illuminate ~72% of Earth's LEO cap in vivid Blue-Marble sunlight, sweeping into a lower-right golden terminator
    upVec.set(...orbitLayout.upDirection);
    lookVec.set(...orbitLayout.cameraLook);
    sun.earthLitSun.copy(sun.direction)
      .addScaledVector(upVec, 0.28 * daylight)
      .addScaledVector(lookVec, -0.25 * daylight);
    sun.earthLitSun.x += orbitSunRig.left[0] * 0.28 * daylight;
    sun.earthLitSun.y += orbitSunRig.left[1] * 0.28 * daylight;
    sun.earthLitSun.z += orbitSunRig.left[2] * 0.28 * daylight;
    sun.earthLitSun.normalize();

    // Sculpted ~42% crescent-quarter Moon facing the upper-left Sun in both orbit & cabin
    moonViewDir.set(
      THREE.MathUtils.lerp(orbitLayout.cabinMoonPosition[0], orbitLayout.moonPosition[0], orbitPresence),
      THREE.MathUtils.lerp(orbitLayout.cabinMoonPosition[1], orbitLayout.moonPosition[1], orbitPresence),
      THREE.MathUtils.lerp(orbitLayout.cabinMoonPosition[2], orbitLayout.moonPosition[2], orbitPresence),
    ).normalize().negate();
    sun.moonLitSun.copy(sun.direction)
      .addScaledVector(moonViewDir, 0.56 * daylight)
      .addScaledVector(upVec, 0.10 * daylight)
      .normalize();

    sun.daylight.value = daylight;
    sun.warmth = warmth;
    sun.warmthUniform.value = warmth;
    follow(camera);
  });
  return (
    <>
      <group ref={distant} name="cosmos">
        <CelestialSphere clock={clock} sun={sun} onBeforeRender={(_renderer, _scene, camera) => { follow(camera); distant.current?.updateMatrixWorld(true); }} />
        <Moon
          clock={clock}
          sun={sun}
          cabinPosition={orbitLayout.cabinMoonPosition}
          cabinRadius={orbitLayout.cabinMoonRadius}
          orbitPosition={orbitLayout.moonPosition}
          orbitRadius={orbitLayout.moonRadius}
        />
        <Earth
          cabinPosition={orbitLayout.cabinEarthPosition}
          orbitPosition={orbitLayout.earthPosition}
          orbitRadius={orbitLayout.earthRadius}
          clock={clock}
          sun={sun}
          flight={flight}
        />
      </group>
      <Drift clock={clock} sun={sun} flight={flight} />
    </>
  );
};
