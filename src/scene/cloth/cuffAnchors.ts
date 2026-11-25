import { MathUtils, Vector3, type SkinnedMesh } from 'three';
import type { ClothProfile } from './physics';

export type CuffStrategy = 'hard' | 'released' | 'soft' | 'dynamic';
export type CuffGuide = 41 | 53;

const softStiffness = 5000; // N/m for a unit-mass proxy particle.

/** Configure the 12 × 5 ribbon left sleeve before constructing its solver and binding pin mask. */
export function configureSleeveCuff(
  profile: ClothProfile, strategy: CuffStrategy, mesh: SkinnedMesh, guide: CuffGuide = 53,
) {
  // 41 is the existing forearm guide. 53 is the same column on the cuff itself.
  profile.pins = profile.pins.filter(id => id !== 41 && id !== 53);
  delete profile.elasticAnchor;
  if (strategy === 'hard') profile.pins.push(guide);
  if (strategy === 'hard' || strategy === 'released') return;
  if (strategy === 'soft') {
    profile.elasticAnchor = { particle: guide, createStiffnessSampler: () => () => softStiffness };
    return;
  }

  const shoulder = mesh.skeleton.getBoneByName('mixamorigLeftArm');
  const elbow = mesh.skeleton.getBoneByName('mixamorigLeftForeArm');
  const wrist = mesh.skeleton.getBoneByName('mixamorigLeftHand');
  if (!shoulder || !elbow || !wrist) throw new Error('动态袖口需要左上臂、前臂和手骨');
  const origin = new Vector3(), upper = new Vector3(), lower = new Vector3();
  const desired = () => {
    origin.setFromMatrixPosition(elbow.matrixWorld);
    upper.setFromMatrixPosition(shoulder.matrixWorld).sub(origin).negate();
    lower.setFromMatrixPosition(wrist.matrixWorld).sub(origin);
    const flex = MathUtils.radToDeg(upper.angleTo(lower));
    return MathUtils.lerp(softStiffness, 150, MathUtils.smoothstep(flex, 30, 100));
  };
  profile.elasticAnchor = {
    particle: guide,
    createStiffnessSampler() {
      let stiffness = desired();
      return dt => {
        // An 80 ms time constant smooths recovery across clip changes without switching inverse mass.
        stiffness += (desired() - stiffness) * -Math.expm1(-dt / 0.08);
        return stiffness;
      };
    },
  };
}
