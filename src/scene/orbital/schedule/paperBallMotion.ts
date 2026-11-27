import { PAPER_BALL_RADIUS, paperBallPosition, type PaperBall } from './schedule.ts';

export type PaperBallRect = [number, number, number, number];
export interface PaperBallBounds { left: number; right: number; back: number; front: number }
export interface PaperBallCircle { x: number; z: number; radius: number }

export interface PaperBallBody {
  id: string;
  seed: number;
  x: number;
  z: number;
  y: number;
  vx: number;
  vz: number;
  vy: number;
  yaw: number;
  spin: number;
  roll: number;
  rollVel: number;
  pitch: number;
  pitchVel: number;
  radius: number;
  cooldown: number;
}

export interface PaperBallMover {
  x: number;
  z: number;
  vx: number;
  vz: number;
  radius: number;
  active: boolean;
  strength?: number;
}

export const PAPER_BALL_MOVER_RADIUS = 0.18;
export const PAPER_BALL_DRAG = 2.8;
export const PAPER_BALL_REST = 0.42;
export const PAPER_BALL_GRAVITY = 13.5;
const MAX_KICK = 2.6;
const SUBSTEP = 0.025;

export function createPaperBallBody(ball: PaperBall): PaperBallBody {
  const [x, , z] = paperBallPosition(ball.seed);
  return {
    id: ball.id,
    seed: ball.seed,
    x,
    z,
    y: 0,
    vx: 0,
    vz: 0,
    vy: 0,
    yaw: ball.seed,
    spin: 0,
    roll: 0.3,
    rollVel: 0,
    pitch: 0.4,
    pitchVel: 0,
    radius: PAPER_BALL_RADIUS,
    cooldown: 0,
  };
}

export function isValidPaperBallBody(body: PaperBallBody | undefined): boolean {
  return !!body
    && typeof body.id === 'string'
    && Number.isFinite(body.seed)
    && Number.isFinite(body.x)
    && Number.isFinite(body.y)
    && Number.isFinite(body.z)
    && Number.isFinite(body.vx)
    && Number.isFinite(body.vy)
    && Number.isFinite(body.vz)
    && Number.isFinite(body.yaw)
    && Number.isFinite(body.spin)
    && Number.isFinite(body.roll)
    && Number.isFinite(body.rollVel)
    && Number.isFinite(body.pitch)
    && Number.isFinite(body.pitchVel)
    && Number.isFinite(body.radius)
    && Number.isFinite(body.cooldown);
}

export function syncPaperBallBodies(
  current: readonly PaperBallBody[],
  balls: readonly PaperBall[],
): PaperBallBody[] {
  const byId = new Map<string, PaperBallBody>();
  for (const body of current) {
    if (isValidPaperBallBody(body)) byId.set(body.id, body);
  }
  return balls.map(ball => {
    const existing = byId.get(ball.id);
    if (existing && existing.seed === ball.seed) return existing;
    return createPaperBallBody(ball);
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function wrapAngle(rad: number): number {
  let a = (rad + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

export function paperBallOpen(
  x: number,
  z: number,
  radius: number,
  staticBoxes: readonly PaperBallRect[],
  bounds: PaperBallBounds,
  solidCircles: readonly PaperBallCircle[] = [],
): boolean {
  return x >= bounds.left + radius
    && x <= bounds.right - radius
    && z >= bounds.back + radius
    && z <= bounds.front - radius
    && !staticBoxes.some(([a, b, c, d]) => x > a - radius && x < b + radius && z > c - radius && z < d + radius)
    && !solidCircles.some(circle => Math.hypot(x - circle.x, z - circle.z) < circle.radius + radius);
}

function trySlide(
  body: PaperBallBody,
  targetX: number,
  targetZ: number,
  staticBoxes: readonly PaperBallRect[],
  bounds: PaperBallBounds,
  solidCircles: readonly PaperBallCircle[],
): boolean {
  if (paperBallOpen(targetX, targetZ, body.radius, staticBoxes, bounds, solidCircles)) {
    body.x = targetX;
    body.z = targetZ;
    return true;
  }
  let moved = false;
  if (paperBallOpen(targetX, body.z, body.radius, staticBoxes, bounds, solidCircles)) {
    body.x = targetX;
    moved = true;
  }
  if (paperBallOpen(body.x, targetZ, body.radius, staticBoxes, bounds, solidCircles)) {
    body.z = targetZ;
    moved = true;
  }
  return moved;
}

export function resolveMoverAgainstPaperBalls(
  pos: { x: number; z: number },
  moverRadius: number,
  bodies: readonly PaperBallBody[],
  isAllowed: (x: number, z: number) => boolean,
): boolean {
  let blocked = false;
  for (let pass = 0; pass < 3; pass++) {
    for (const body of bodies) {
      const dx = pos.x - body.x;
      const dz = pos.z - body.z;
      const gap = Math.hypot(dx, dz);
      const minGap = moverRadius + body.radius;
      if (gap < minGap - 1e-5) {
        const nx = gap > 1e-5 ? dx / gap : 0;
        const nz = gap > 1e-5 ? dz / gap : 1;
        const targetX = body.x + nx * minGap;
        const targetZ = body.z + nz * minGap;
        if (isAllowed(targetX, targetZ)) {
          pos.x = targetX;
          pos.z = targetZ;
        } else if (isAllowed(targetX, pos.z)) {
          pos.x = targetX;
        } else if (isAllowed(pos.x, targetZ)) {
          pos.z = targetZ;
        }
        blocked = true;
      }
    }
  }
  return blocked;
}

export function stepPaperBalls(
  bodies: PaperBallBody[],
  dt: number,
  movers: readonly PaperBallMover[],
  staticBoxes: readonly PaperBallRect[],
  bounds: PaperBallBounds,
  reducedMotion = false,
  random: () => number = Math.random,
  solidCircles: readonly PaperBallCircle[] = [],
): void {
  if (!(dt > 0) || !bodies.length) return;

  for (const body of bodies) {
    if (body.cooldown > 0) body.cooldown = Math.max(0, body.cooldown - dt);

    for (const mover of movers) {
      if (!mover.active) continue;
      const dx = body.x - mover.x;
      const dz = body.z - mover.z;
      const gap = Math.hypot(dx, dz);
      const contact = mover.radius + body.radius;
      if (gap < contact) {
        let nx = 0;
        let nz = 1;
        if (gap > 1e-5) {
          nx = dx / gap;
          nz = dz / gap;
        } else {
          const speed = Math.hypot(mover.vx, mover.vz);
          if (speed > 1e-5) {
            nx = mover.vx / speed;
            nz = mover.vz / speed;
          }
        }
        trySlide(body, mover.x + nx * contact, mover.z + nz * contact, staticBoxes, bounds, solidCircles);

        const approach = mover.vx * nx + mover.vz * nz;
        const mult = mover.strength ?? 1;
        if (approach > 0.03) {
          const kick = Math.min(MAX_KICK, (0.55 + approach * 1.6) * mult);
          body.vx = nx * kick;
          body.vz = nz * kick;
          const lateral = mover.vx * nz - mover.vz * nx;
          body.spin = reducedMotion
            ? 0
            : clamp(lateral * 3.2 + (approach > 0.45 ? (nx >= 0 ? 1.8 : -1.8) : 0), -8, 8);

          if (!reducedMotion && body.cooldown <= 0 && body.y <= 0.03) {
            const cosY = Math.cos(body.yaw);
            const sinY = Math.sin(body.yaw);
            const localForward = nx * sinY + nz * cosY;
            const localRight = nx * cosY - nz * sinY;

            if (approach >= 0.42) {
              const s = clamp((approach - 0.42) / 0.6, 0, 1.2);
              body.vy = 0.85 + s * 0.45 + random() * 0.18;
              const tumble = 6.5 + s * 3.0 + random() * 2.0;
              body.pitchVel = clamp(localForward * tumble + (random() - 0.5) * 2.5, -12, 12);
              body.rollVel = clamp(-localRight * tumble + (random() - 0.5) * 2.5, -12, 12);
              body.cooldown = 0.18;
            } else if (approach > 0.12) {
              body.vy = Math.max(body.vy, 0.28 + (approach - 0.12) * 1.1);
              body.pitchVel = clamp(body.pitchVel + localForward * 4.2, -7, 7);
              body.rollVel = clamp(body.rollVel - localRight * 4.2, -7, 7);
              body.cooldown = 0.12;
            }
          }
        }
      }
    }
  }

  for (const body of bodies) {
    if (reducedMotion) {
      body.y = 0;
      body.vy = 0;
      body.spin = 0;
      body.rollVel = 0;
      body.pitchVel = 0;
    }

    const airborne = body.y > 0.004 || body.vy > 0;
    const linearDrag = Math.exp(-dt * (reducedMotion ? 7.0 : airborne ? 0.55 : PAPER_BALL_DRAG));
    body.vx *= linearDrag;
    body.vz *= linearDrag;
    body.spin *= Math.exp(-dt * (airborne ? 1.1 : 4.2));
    if (!airborne && Math.hypot(body.vx, body.vz) < 0.012) {
      body.vx = 0;
      body.vz = 0;
    }
    if (Math.abs(body.spin) < 0.02) body.spin = 0;

    let hitImpact = 0;
    const travel = Math.hypot(body.vx, body.vz) * dt;
    const steps = Math.max(1, Math.ceil(travel / SUBSTEP));
    for (let i = 0; i < steps; i++) {
      const nextX = body.x + (body.vx * dt) / steps;
      if (paperBallOpen(nextX, body.z, body.radius, staticBoxes, bounds, solidCircles)) {
        body.x = nextX;
      } else {
        hitImpact = Math.max(hitImpact, Math.abs(body.vx));
        body.vx *= -PAPER_BALL_REST;
      }
      const nextZ = body.z + (body.vz * dt) / steps;
      if (paperBallOpen(body.x, nextZ, body.radius, staticBoxes, bounds, solidCircles)) {
        body.z = nextZ;
      } else {
        hitImpact = Math.max(hitImpact, Math.abs(body.vz));
        body.vz *= -PAPER_BALL_REST;
      }
    }

    if (!reducedMotion && hitImpact >= 0.7 && body.y <= 0.02 && body.cooldown <= 0) {
      body.vy = Math.max(body.vy, 0.45);
      body.rollVel += (random() - 0.5) * 5.0;
      body.pitchVel += (random() - 0.5) * 5.0;
      body.cooldown = 0.14;
    }

    if (!reducedMotion) {
      body.yaw = wrapAngle(body.yaw + body.spin * dt);

      if (body.y > 0 || body.vy > 0) {
        body.vy -= PAPER_BALL_GRAVITY * dt;
        body.y += body.vy * dt;
        if (body.y <= 0) {
          body.y = 0;
          if (body.vy < -0.45) {
            body.vy = -body.vy * 0.38;
            body.rollVel *= 0.72;
            body.pitchVel *= 0.72;
          } else {
            body.vy = 0;
          }
        }
      }

      const grounded = body.y <= 0.004 && body.vy === 0;
      if (grounded) {
        const cosY = Math.cos(body.yaw);
        const sinY = Math.sin(body.yaw);
        const localForward = body.vx * sinY + body.vz * cosY;
        const localRight = body.vx * cosY - body.vz * sinY;
        body.pitch = wrapAngle(body.pitch + (localForward / body.radius) * dt * 0.75 + body.pitchVel * dt);
        body.roll = wrapAngle(body.roll - (localRight / body.radius) * dt * 0.75 + body.rollVel * dt);
        body.rollVel *= Math.exp(-dt * 7.0);
        body.pitchVel *= Math.exp(-dt * 7.0);
        if (Math.abs(body.rollVel) < 0.03) body.rollVel = 0;
        if (Math.abs(body.pitchVel) < 0.03) body.pitchVel = 0;
      } else {
        body.rollVel *= Math.exp(-dt * 1.1);
        body.pitchVel *= Math.exp(-dt * 1.1);
        body.pitch = wrapAngle(body.pitch + body.pitchVel * dt);
        body.roll = wrapAngle(body.roll + body.rollVel * dt);
      }
    }
  }

  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < bodies.length; i++) {
      for (let j = i + 1; j < bodies.length; j++) {
        const a = bodies[i]!;
        const b = bodies[j]!;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const gap = Math.hypot(dx, dz);
        const minGap = a.radius + b.radius;
        if (gap < minGap) {
          const nx = gap > 1e-5 ? dx / gap : 1;
          const nz = gap > 1e-5 ? dz / gap : 0;
          const overlap = minGap - gap;
          const half = overlap * 0.5;
          const aMoved = trySlide(a, a.x - nx * half, a.z - nz * half, staticBoxes, bounds, solidCircles);
          const bMoved = trySlide(b, b.x + nx * half, b.z + nz * half, staticBoxes, bounds, solidCircles);
          if (!aMoved && bMoved) trySlide(b, b.x + nx * half, b.z + nz * half, staticBoxes, bounds, solidCircles);
          if (!bMoved && aMoved) trySlide(a, a.x - nx * half, a.z - nz * half, staticBoxes, bounds, solidCircles);

          if (pass === 0) {
            const relVn = (b.vx - a.vx) * nx + (b.vz - a.vz) * nz;
            if (relVn < 0) {
              const impulse = -0.72 * relVn;
              a.vx -= nx * impulse;
              a.vz -= nz * impulse;
              b.vx += nx * impulse;
              b.vz += nz * impulse;
              if (!reducedMotion && Math.abs(relVn) > 0.25) {
                a.vy = Math.max(a.vy, 0.28);
                b.vy = Math.max(b.vy, 0.28);
                a.rollVel += (random() - 0.5) * 4.0;
                b.rollVel += (random() - 0.5) * 4.0;
              }
            }
          }
        }
      }
    }
  }
}
