import type { AnimationState } from './actor';
import type { ClothProfile } from './physics';

// Rates in s⁻¹. Shoulder pins track the body most closely. The support ring
// yields further/longer during a blend than the rim that follows the hand.
const bands = [
  { name: 'shoulder', from: 0, to: 36, targetRate: 240, gainRate: 100, release: 0 },
  { name: 'support', from: 36, to: 48, targetRate: 120, gainRate: 32, release: 0.25 },
  { name: 'cuff', from: 48, to: 60, targetRate: 180, gainRate: 62, release: 0.12 },
] as const;
const bandOf = (particle: number) => particle < bands[1].from ? 0 : particle < bands[2].from ? 1 : 2;

/** Left sleeve only. Construct once before the solver. Animation targets remain
 * the reference for mapping, collisions and tracking error in every strategy. */
export function createSleeveDrive(profile: ClothProfile, animated: Float32Array, transition: boolean) {
  const targets = transition ? animated.slice() : animated;
  const velocities = new Float64Array(animated.length);
  const previousInput = animated.slice();
  const gains = bands.map(() => 1);
  const configured = profile.elasticAnchors ?? (profile.elasticAnchor ? [profile.elasticAnchor] : []);
  const anchors = configured.map(({ particle }) => ({ particle, band: bands[bandOf(particle)].name,
    baseStiffness: 0, stiffness: 0 }));
  // Observe the sampler actually used by the backend. A second read would
  // advance the dynamic wrist-speed sampler and change the experiment.
  configured.forEach((anchor, i) => {
    const create = anchor.createStiffnessSampler.bind(anchor);
    anchor.createStiffnessSampler = () => {
      const sample = create();
      return dt => {
        const row = anchors[i];
        row.baseStiffness = sample(dt);
        row.stiffness = row.baseStiffness * gains[bandOf(row.particle)];
        return row.stiffness;
      };
    };
  });
  function update(dt: number, state: AnimationState) {
    if (dt <= 0) return;
    if (transition) {
      // Legacy fades can overlap above unity or leave a residual bind pose. Use
      // relative contributions including that residual, without mutating the mixer.
      const total = state.weights.reduce((sum, w) => sum + w, 0);
      const dominant = Math.max(1 - total, ...state.weights) / Math.max(1, total);
      for (const [b, band] of bands.entries()) {
        const desired = 1 - band.release * (1 - dominant);
        gains[b] += (desired - gains[b]) * -Math.expm1(-band.gainRate * dt);
        const rate = band.targetRate, decay = Math.exp(-rate * dt);
        const first = band.from * 3, end = band.to * 3;
        // Exact critically damped tracking of the line between adjacent animation
        // samples. Position AND velocity carry through every change of input slope.
        for (let k = first; k < end; k++) {
          const slope = (animated[k] - previousInput[k]) / dt;
          const error = targets[k] - previousInput[k] + 2 * slope / rate;
          const dv = velocities[k] - slope;
          const c = dv + rate * error;
          targets[k] = animated[k] - 2 * slope / rate + (error + c * dt) * decay;
          velocities[k] = slope + (dv - rate * c * dt) * decay;
        }
      }
    } else {
      for (let k = 0; k < targets.length; k++) velocities[k] = (animated[k] - previousInput[k]) / dt;
    }
    previousInput.set(animated);
  }
  return { targets, velocities, anchors, gains, update };
}
