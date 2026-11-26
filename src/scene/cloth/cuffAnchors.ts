import { MathUtils, Vector3, type SkinnedMesh } from 'three';
import type { ClothProfile } from './physics';

export type CuffStrategy = 'hard' | 'released' | 'soft' | 'zoned' | 'feathered' | 'dynamic';
export type CuffGuide = 41 | 53;

type ElasticAnchor = NonNullable<ClothProfile['elasticAnchor']>;
const softStiffness = 5000; // N/m for one unit-mass proxy particle.
const zonedStiffness = 12000; // Total stiffness across both rings, in N/m.

// Three sectors 120° apart on each ring. The guide side carries more of the load.
// The weaker proximal ring supports the sleeve wall while allowing it to bend.
const zones = [
  { row: 0, column: 0, share: 0.28 }, { row: 0, column: 4, share: 0.20 }, { row: 0, column: -4, share: 0.20 },
  { row: -1, column: 0, share: 0.14 }, { row: -1, column: 4, share: 0.09 }, { row: -1, column: -4, share: 0.09 },
] as const;

function movingSpring(mesh: SkinnedMesh, share: number): ElasticAnchor['createStiffnessSampler'] {
  const shoulder = mesh.skeleton.getBoneByName('mixamorigLeftArm');
  const elbow = mesh.skeleton.getBoneByName('mixamorigLeftForeArm');
  const wrist = mesh.skeleton.getBoneByName('mixamorigLeftHand');
  if (!shoulder || !elbow || !wrist) throw new Error('动态袖口需要左上臂、前臂和手骨');
  return () => {
    const previous = new Vector3().setFromMatrixPosition(wrist.matrixWorld);
    const hand = previous.clone(), upper = new Vector3(), lower = new Vector3(), origin = new Vector3();
    const postureStiffness = () => {
      origin.setFromMatrixPosition(elbow.matrixWorld);
      upper.setFromMatrixPosition(shoulder.matrixWorld).sub(origin).negate();
      lower.copy(hand).sub(origin);
      const flex = MathUtils.radToDeg(upper.angleTo(lower));
      return share * MathUtils.lerp(zonedStiffness, softStiffness, MathUtils.smoothstep(flex, 30, 100));
    };
    let stiffness = postureStiffness();
    return dt => {
      if (dt <= 0) return stiffness;
      hand.setFromMatrixPosition(wrist.matrixWorld);
      const speed = hand.distanceTo(previous) / dt;
      previous.copy(hand);
      // Rapid clip transitions can move the cuff by >50 mm in one 120 Hz step.
      const desired = MathUtils.lerp(postureStiffness(), share * 45000, MathUtils.smoothstep(speed, 1, 4));
      const response = desired > stiffness ? 0.025 : 0.08;
      stiffness += (desired - stiffness) * -Math.expm1(-dt / response);
      return stiffness;
    };
  };
}

/** Configure the 12 × 5 ribbon left sleeve before constructing its solver and binding pin mask. */
export function configureSleeveCuff(
  profile: ClothProfile, strategy: CuffStrategy, mesh: SkinnedMesh, guide: CuffGuide = 53,
) {
  // 41 is the original forearm guide. 53 is the same column on the cuff itself.
  profile.pins = profile.pins.filter(id => id !== 41 && id !== 53);
  delete profile.elasticAnchor;
  delete profile.elasticAnchors;
  if (strategy === 'hard') profile.pins.push(guide);
  if (strategy === 'hard' || strategy === 'released') return;
  if (strategy === 'soft') {
    profile.elasticAnchor = { particle: guide, createStiffnessSampler: () => () => softStiffness };
    return;
  }
  // Spread a quarter of each sector's load onto its two circumferential neighbors.
  const distribution = strategy === 'feathered' ? zones.flatMap(({ row, column, share }) =>
    [-1, 0, 1].map(offset => ({ row, column: column + offset, share: share * (offset === 0 ? 0.75 : 0.125) })),
  ) : zones;
  profile.elasticAnchors = distribution.map(({ row, column, share }) => ({
    particle: guide + row * 12 + column,
    createStiffnessSampler: strategy === 'dynamic' ? movingSpring(mesh, share) : () => () => share * zonedStiffness,
  }));
}
