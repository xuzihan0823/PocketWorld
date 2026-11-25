import R from '@dimforge/rapier3d-compat';
import type { Ball, ClothProfile, ClothSolver } from './physics';

const ready = R.init();

export async function makeRapier(
  profile: ClothProfile,
  balls: Ball[],
  selfContacts: boolean,
  gravity = 9.81,
): Promise<ClothSolver> {
  await ready;
  const world = new R.World({ x: 0, y: -gravity, z: 0 });
  try {
    world.profilerEnabled = true;
    const material = R.SoftBodyMaterial.uniform(profile.material.edgeHz, 1);
    material.bendSoftness = { naturalFrequency: profile.material.bendHz, dampingRatio: 1 };
    const cloth = world.createSoftBody(
      new R.SoftBodyDesc(profile.rest)
        .setEdges([...profile.structural, ...profile.shear])
        .setBendEdges(profile.bend)
        .setSurface(profile.triangles)
        .setPinnedParticles(profile.pins)
        .setMaterial(material)
        .setParticleMass(1)
        .setLinearDamping(profile.material.drag)
        .setParticleRadius(profile.thickness)
        .setSelfContacts(selfContacts)
        .setSurfaceCollider(R.ColliderDesc.ball(profile.thickness))
        .setCanSleep(false),
    );
    if (profile.initial) {
      for (let k = 0; k < profile.initial.length; k += 3) {
        const p = profile.initial;
        cloth.setParticlePosition(k / 3, { x: p[k], y: p[k + 1], z: p[k + 2] });
      }
    }
    const bodies = balls.map((ball) => {
      const body = world.createRigidBody(
        R.RigidBodyDesc.kinematicPositionBased().setTranslation(ball.x, ball.y, ball.z),
      );
      world.createCollider(R.ColliderDesc.ball(ball.radius), body);
      return body;
    });
    const target = { x: 0, y: 0, z: 0 };
    const configured = profile.elasticAnchors ?? (profile.elasticAnchor ? [profile.elasticAnchor] : []);
    const anchors = configured.map(a => ({particle: a.particle, stiffness: a.createStiffnessSampler()}));
    const velocity = { x: 0, y: 0, z: 0 };
    const solver: ClothSolver = {
      positions: (profile.initial ?? profile.rest).slice(),
      collisionMs: null,
      step(dt, targets, spheres) {
        world.timestep = dt;
        for (const i of profile.pins) {
          target.x = targets[3 * i];
          target.y = targets[3 * i + 1];
          target.z = targets[3 * i + 2];
          cloth.setParticleKinematicTarget(i, target);
        }
        for (const anchor of anchors) {
          // Backward Euler impulse for a unit-mass spring, before native contact/edge resolution.
          const stiffness = anchor.stiffness(dt);
          const gain = stiffness * dt / (1 + stiffness * dt * dt);
          const k = 3 * anchor.particle;
          cloth.particleVelocity(anchor.particle, velocity);
          target.x = gain * (targets[k] - this.positions[k] - dt * velocity.x);
          target.y = gain * (targets[k + 1] - this.positions[k + 1] - dt * velocity.y);
          target.z = gain * (targets[k + 2] - this.positions[k + 2] - dt * velocity.z);
          cloth.applyParticleImpulse(anchor.particle, target, true);
        }
        bodies.forEach((b, i) => b.setNextKinematicTranslation(spheres[i]));
        world.step();
        this.positions.set(cloth.particlePositions());
        this.collisionMs = world.profilerEnabled ? world.timingCollisionDetection() : null;
      },
      dispose() {
        world.free();
      },
    };
    return solver;
  } catch (error) {
    world.free();
    throw error;
  }
}
