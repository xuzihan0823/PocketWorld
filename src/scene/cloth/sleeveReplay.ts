import * as T from 'three';
import { createActor, motions, releaseMeshes, type AnimationState, type Motion, type ReplayBlend } from './actor';
import { garmentRegion, type Region } from './binding';
import { distance, Xpbd, type ClothProfile } from './physics';
import { makeRapier } from './rapier';
import type { CuffStrategy } from './cuffAnchors';
import { createSleeveDrive } from './clothStateTransition';

const dt = 1 / 120;
const phaseEnds = [6, 8, 12, 14, 19.25, 29, 34.25];
const focus = [6, 8, 12, 14, 19.25, 22.5, 29];

function strainRecorder(profile: ClothProfile) {
  const pins = new Set(profile.pins);
  const edges: { edge: number; a: number; b: number; fixed: number; rest: number; strain: number; length: number; time: number; pose: string }[] = [];
  for (let k = 0; k < profile.structural.length; k += 2) {
    const a = profile.structural[k], b = profile.structural[k + 1];
    edges.push({ edge: k / 2, a, b, fixed: Number(pins.has(a)) + Number(pins.has(b)), rest: distance(profile.rest, a, b),
      strain: -Infinity, length: 0, time: 0, pose: '' });
  }
  return {
    sample(p: Float32Array, time: number, pose: string) {
      for (const edge of edges) {
        const length = distance(p, edge.a, edge.b), strain = length / edge.rest - 1;
        if (strain > edge.strain) Object.assign(edge, { strain, length, time, pose });
      }
    },
    peaks() {
      return [0, 1, 2].map(fixed => edges.filter(edge => edge.fixed === fixed)
        .sort((a, b) => b.strain - a.strain).slice(0, 4));
    },
  };
}

function pinResidual(region: Region, targets = region.targets) {
  let depth = -Infinity, pin = -1, sphere = -1;
  for (const id of region.profile.pins) {
    for (let k = 0; k < region.balls.length; k++) {
      const b = region.balls[k], p = targets;
      const d = b.radius + region.profile.thickness - Math.hypot(p[3*id]-b.x, p[3*id+1]-b.y, p[3*id+2]-b.z);
      if (d > depth) { depth = d; pin = id; sphere = k; }
    }
  }
  return { depth, pin, sphere };
}

type Audit = (mesh: T.SkinnedMesh) => {
  measure(raw: Float32Array, final: Float32Array, region: Region, positions: Float32Array): unknown;
};
export interface SleeveReplayFrame {
  step: number;
  time: number;
  dt: number;
  pose: Motion;
  animation: AnimationState;
  region: Region;
  positions: Float32Array;
  readParticleVelocities(): Float32Array;
  targets: Float32Array;
  velocities: Float64Array;
  anchors: ReturnType<typeof createSleeveDrive>['anchors'];
  /** Shoulder, support, cuff multipliers in this order. */
  gains: readonly number[];
  /** Bind once, on demand, for final surface and mapping diagnostics at this step. */
  bindSurface(): NonNullable<Region['sleeveLayers']>;
}
export interface ReplaySettings {
  pipeline?: import('./binding').SleevePipeline;
  cuff?: CuffStrategy;
  rapidSwitch?: boolean;
  preserveFadeWeight?: boolean;
  animationBlend?: ReplayBlend;
  stateTransition?: boolean;
  /** Synchronous, post-solve. Copy buffer values before retaining a frame. */
  onStep?(frame: SleeveReplayFrame): void;
}

/** Deterministic quality replay. Expensive surface observations run outside the solver timer. */
export async function replaySleeve(engine: 'xpbd' | 'rapier', legacy = false, audit?: Audit, extraFocus: number[] = [], settings: ReplaySettings = {}) {
  if (legacy && settings.stateTransition) throw new Error('Cloth State Transition 需要单袖绑定格点');
  const stage = new T.Scene();
  const animationBlend = settings.animationBlend ?? (settings.preserveFadeWeight ? 'preserveFadeWeight' : 'legacy');
  const actor = await createActor(stage, false, 0, animationBlend);
  const cuff = settings.cuff ?? (settings.stateTransition ? 'zoned' : undefined);
  const region = garmentRegion(actor.skin, 'Left', false, !legacy, true, settings.pipeline, cuff);
  const drive = settings.stateTransition || settings.onStep
    ? createSleeveDrive(region.profile, region.targets, !!settings.stateTransition) : undefined;
  const solver = engine === 'xpbd' ? new Xpbd(region.profile) : await makeRapier(region.profile, region.balls, true);
  const edges = strainRecorder(region.profile), surface = audit?.(actor.skin);
  const observations = [];
  const watched = [...focus, ...extraFocus];
  const final = actor.skin.geometry.getAttribute('pwCloth').array as Float32Array;
  const raw = region.sleeveLayers!.raw;
  const drivers = region.sleeveLayers?.driverVertices.filter((_, i) => i % 12 === 0).map(id => {
    const attr = actor.skin.geometry.attributes;
    return Array.from({ length: 4 }, (_, j) => ({
      name: actor.skin.skeleton.bones[attr.skinIndex.getComponent(id, j)].name,
      weight: attr.skinWeight.getComponent(id, j),
    })).filter(b => b.weight > 0);
  });
  let time = 0, solveMs = 0, pin = {depth: -Infinity, pin: -1, sphere: -1, time: 0};
  const lifeSteps = Math.round(phaseEnds[6] / dt);
  const steps = lifeSteps + (settings.rapidSwitch ? 120 : 0);
  try {
    for (let step = 1; step <= steps; step++) {
      time += dt;
      const rapid = step > lifeSteps;
      const pose = rapid ? motions[Math.floor((step-lifeSteps-1)/12) % motions.length] :
        motions[phaseEnds.findIndex(end => time % phaseEnds[6] < end)];
      actor.select(pose);
      actor.update(dt);
      region.sample(time);
      const animation = drive && actor.animationState();
      if (drive && animation) drive.update(dt, animation);
      const targets = drive?.targets ?? region.targets;
      const start = performance.now();
      solver.step(dt, targets, region.balls);
      solveMs += performance.now() - start;
      edges.sample(solver.positions, time, pose);
      const residual = pinResidual(region, targets);
      if (residual.depth > pin.depth) pin = { ...residual, time };
      let bound = false;
      const bindSurface = () => {
        if (!bound) region.bind(solver.positions);
        bound = true;
        return region.sleeveLayers!;
      };
      if (settings.onStep && drive && animation) {
        settings.onStep({ step, time, dt, pose, animation, region, positions: solver.positions,
          readParticleVelocities: () => solver.readVelocities(dt),
          targets, velocities: drive.velocities, anchors: drive.anchors, gains: drive.gains, bindSurface });
      }
      if (!rapid && step % 60 !== 0 && !watched.some(t => time >= t - 0.04 && time <= t + 0.26)) continue;
      bindSurface();
      const p = solver.positions;
      observations.push({ step, time, pose, shell: region.surfaceContact?.(),
        elbow13to25: distance(p, 13, 25), elbowRest: distance(region.profile.rest, 13, 25),
        intersections: surface?.measure(raw, final, region, p) });
    }
    return { engine, legacy, cuff, animationBlend, stateTransition: !!settings.stateTransition, steps,
      solveMsPerStep: solveMs / steps, mapped: region.mappedVertices,
      drivers, pins: region.profile.pins, pin: { ...pin, minClearance: -pin.depth, depth: Math.max(0, pin.depth) },
      peaks: edges.peaks(), observations };
  } finally {
    solver.dispose(); actor.dispose(); releaseMeshes(stage);
  }
}

/** Rotate only the elbow in its anatomical bending plane, with both types of contact and gravity off. */
export async function isolateElbow(legacy = false, audit?: Audit, releaseDistalGuide = false,
  settings: Pick<ReplaySettings, 'pipeline' | 'cuff' | 'rapidSwitch' | 'preserveFadeWeight'> = {}) {
  const stage = new T.Scene();
  const actor = await createActor(stage, false, 0);
  const region = garmentRegion(actor.skin, 'Left', false, !legacy, true, settings.pipeline, settings.cuff);
  // Control run: leave the sleeve attached at the shoulder and release only the distal guide.
  if (releaseDistalGuide) region.profile.pins = region.profile.pins.filter(i => i < 12);
  const surface = audit?.(actor.skin), observations = [];
  let minClearance = Infinity;
  const solver = new Xpbd(region.profile, false);
  solver.gravity = 0;
  const joint = (name: string) => actor.skin.skeleton.getBoneByName('mixamorigLeft' + name)!;
  const elbow = joint('ForeArm'), original = elbow.quaternion.clone();
  const shoulder = joint('Arm').getWorldPosition(new T.Vector3());
  const center = elbow.getWorldPosition(new T.Vector3());
  const upper = shoulder.sub(center).normalize();
  const lower = joint('Hand').getWorldPosition(new T.Vector3()).sub(center).normalize();
  const axis = new T.Vector3().crossVectors(lower, upper).normalize()
    .applyQuaternion(elbow.getWorldQuaternion(new T.Quaternion()).invert());
  const angle = Math.min(upper.angleTo(lower) - Math.PI / 6, Math.PI / 3);
  const rotation = new T.Quaternion();
  const phases = ['settle', 'flex', 'hold'].map(() => strainRecorder(region.profile));
  try {
    for (let i = 1; i <= 720; i++) {
      const time = i * dt, phase = time <= 1 ? 0 : time <= 4 ? 1 : 2;
      elbow.quaternion.copy(original).multiply(rotation.setFromAxisAngle(axis, angle * T.MathUtils.smoothstep(time, 1, 4)));
      stage.updateMatrixWorld(true);
      region.sample(time);
      solver.step(dt, region.targets, []);
      phases[phase].sample(solver.positions, time, ['settle', 'flex', 'hold'][phase]);
      minClearance = Math.min(minClearance, -pinResidual(region).depth);
      if (surface && (i % 60 === 0 || (i >= 470 && i <= 490))) {
        region.bind(solver.positions);
        const { raw, final } = region.sleeveLayers!;
        observations.push({ time, shell: region.surfaceContact?.(), intersections: surface.measure(raw, final, region, solver.positions) });
      }
    }
    const settled = strainRecorder(region.profile);
    settled.sample(solver.positions, 6, 'hold-end');
    return { legacy, releaseDistalGuide, flexDegrees: T.MathUtils.radToDeg(angle), minClearance, observations,
      phases: phases.map(p => p.peaks()), settled: settled.peaks() };
  } finally {
    solver.dispose(); actor.dispose(); releaseMeshes(stage);
  }
}
