import { TRAILS } from './model.ts';
import type { Feature, FeatureKind, SkiInput, SkiPlayer, SkiState, TrailId } from './model.ts';

const TAU = Math.PI * 2;
const START_X = 200;
const SEGMENT = 2400;
const STEP = 1 / 120;
const MAX_FEATURES = 72;
const MAX_PARTICLES = 80;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
const wrapped = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));
const rideHeight = (p: SkiPlayer) => p.partner === 'slide' ? 22 : p.partner === 'charge' ? 42 : 0;

export function terrainY(x: number, trail: TrailId): number {
  const amplitude = trail === 'valley' ? 21 : trail === 'forest' ? 32 : 26;
  return 420 + amplitude * Math.sin(x / 460) + 9 * Math.sin(x / 173);
}

export function terrainAngle(x: number, trail: TrailId): number {
  const amplitude = trail === 'valley' ? 21 : trail === 'forest' ? 32 : 26;
  return Math.atan(amplitude / 460 * Math.cos(x / 460) + 9 / 173 * Math.cos(x / 173));
}

type Placement = readonly [FeatureKind, number, number, number?];
const OPENING: readonly Placement[] = [
  ['coin', 650, 18, 52], ['coin', 730, 18, 52], ['coin', 810, 18, 52],
  ['rock', 1020, 44], ['ramp', 1470, 76], ['coin', 1580, 18, 110],
  ['coin', 1670, 18, 145], ['slide', 2040, 60],
];
const ROUTES: Record<TrailId, readonly (readonly Placement[])[]> = {
  valley: [
    [['rock', 420, 44], ['ramp', 1020, 76], ['gap', 1240, 130], ['slide', 1840, 60]],
    [['branch', 450, 120], ['rock', 1160, 48], ['charge', 1740, 60]],
    [['ice', 240, 350], ['ramp', 1080, 76], ['rock', 1280, 44], ['slide', 1900, 60]],
  ],
  forest: [
    [['branch', 360, 140], ['ramp', 1040, 80], ['rock', 1240, 48], ['charge', 1820, 60]],
    [['rock', 400, 46], ['branch', 1120, 150], ['slide', 1820, 60]],
    [['ramp', 320, 80], ['gap', 540, 145], ['branch', 1320, 140], ['charge', 1900, 60]],
  ],
  night: [
    [['ice', 220, 380], ['ramp', 940, 80], ['gap', 1160, 180], ['charge', 1860, 60]],
    [['rock', 380, 48], ['ice', 1000, 300], ['slide', 1780, 60]],
    [['ramp', 320, 80], ['gap', 540, 165], ['rock', 1300, 48], ['charge', 1900, 60]],
  ],
};

function generate(state: SkiState): void {
  const x = state.player.x;
  state.features = state.features.filter(f => f.x + f.width > x - 450);
  state.nextSegment = Math.max(state.nextSegment, Math.floor((x - 450) / SEGMENT));
  while (state.nextSegment * SEGMENT < x + 1900) {
    const segment = state.nextSegment++;
    const layouts = ROUTES[state.trail];
    const placements = segment === 0 ? OPENING : layouts[(segment - 1) % layouts.length];
    for (const [kind, offset, width, height = 0] of placements) {
      const fx = segment * SEGMENT + offset;
      if (fx + width < x - 450) continue;
      state.features.push({ id: state.nextId++, kind, x: fx, width,
        y: terrainY(fx + width / 2, state.trail) - height, used: false });
    }
    if (segment > 0) {
      for (let i = 0; i < 3; i++) {
        const fx = segment * SEGMENT + 740 + i * 72;
        state.features.push({ id: state.nextId++, kind: 'coin', x: fx, width: 18,
          y: terrainY(fx, state.trail) - 52, used: false });
      }
    }
  }
  if (state.features.length > MAX_FEATURES) state.features.length = MAX_FEATURES;
}

export function createRun(trail: TrailId): SkiState {
  const speed = TRAILS.find(t => t.id === trail)!.baseSpeed;
  const state: SkiState = {
    trail, time: 0, player: {
      x: START_X, y: terrainY(START_X, trail), vy: 0, speed,
      angle: terrainAngle(START_X, trail), grounded: true, airTime: 0,
      rotation: 0, flipping: false, tucked: false, crashTime: 0, invulnerable: 0,
      coyote: 0.1, jumpBuffer: 0, partner: null, partnerLeft: 0, shield: false, squash: 0,
    },
    chasers: Array.from({ length: 8 }, (_, i) => ({
      x: START_X - 308 - i * 52, offset: -i * 52, lane: i % 3, phase: i * 0.79,
    })),
    features: [], particles: [], distance: 0, coins: 0, flips: 0, combo: 0,
    bonus: 0, score: 0, over: false, caughtTime: 0,
    cameraY: terrainY(START_X, trail) - 420,
    nextSegment: 0, nextId: 0, message: '按住跳跃，松手稳稳落地', messageTime: 5, events: [],
  };
  generate(state);
  return state;
}

export function frontGap(state: SkiState): number {
  if (!state.chasers.length) return Infinity;
  const radius = state.player.tucked || state.player.crashTime > 0 ? 16 : 14;
  return Math.max(0, state.player.x - Math.max(...state.chasers.map(c => c.x)) - radius - 14);
}

function message(state: SkiState, text: string): void {
  state.message = text;
  state.messageTime = 2.2;
}

function burst(state: SkiState, color: string, reducedMotion: boolean): void {
  if (reducedMotion) return;
  for (let i = 0; i < 8 && state.particles.length < MAX_PARTICLES; i++) {
    const angle = i * TAU / 8;
    state.particles.push({ x: state.player.x, y: state.player.y - 12,
      vx: Math.cos(angle) * 65, vy: -50 + Math.sin(angle) * 50,
      life: 0.35 + i * 0.025, color });
  }
}

function dismount(p: SkiPlayer): void {
  if (p.grounded) p.y += rideHeight(p);
  p.partner = null;
  p.partnerLeft = 0;
  p.shield = false;
}

function crash(state: SkiState, reducedMotion: boolean): void {
  const p = state.player;
  if (p.crashTime > 0 || p.invulnerable > 0) return;
  p.crashTime = 1.25;
  p.speed = Math.max(60, p.speed * 0.3);
  p.invulnerable = 1.6;
  p.jumpBuffer = 0;
  p.rotation = 0;
  p.flipping = false;
  p.tucked = false;
  state.combo = 0;
  dismount(p);
  state.events.push('crash');
  message(state, '轻按跳跃，快快起身！');
  burst(state, '#FFFFFF', reducedMotion);
}

function jump(p: SkiPlayer, velocity = -390): void {
  p.grounded = false;
  p.vy = velocity;
  p.airTime = 0;
  p.rotation = 0;
  p.flipping = false;
  p.coyote = 0;
  p.jumpBuffer = 0;
}

type Circle = { x: number; y: number; radius: number };
function playerBody(p: SkiPlayer, tuck: boolean): Circle[] {
  if (p.crashTime > 0 || tuck) return [{ x: p.x, y: p.y - 18, radius: 16 }];
  return [-12, 12].map(offset => ({
    x: p.x - Math.sin(p.angle) * offset,
    y: p.y - 32 + Math.cos(p.angle) * offset, radius: 14,
  }));
}
function chaserBody(x: number, trail: TrailId): Circle[] {
  const y = terrainY(x, trail);
  return [{ x, y: y - 32, radius: 14 }, { x, y: y - 52, radius: 12 }];
}
function sweptCircle(a: Circle, b: Circle, c: Circle, d: Circle): boolean {
  const x = a.x - c.x;
  const y = a.y - c.y;
  const dx = b.x - d.x - x;
  const dy = b.y - d.y - y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : clamp(-(x * dx + y * dy) / length, 0, 1);
  return (x + dx * t) ** 2 + (y + dy * t) ** 2 <= (Math.max(a.radius, b.radius) + c.radius) ** 2;
}

function rectangleHit(before: Circle[], after: Circle[], left: number, right: number, top: number, bottom: number): boolean {
  return after.some((circle, i) => {
    const old = before[Math.min(i, before.length - 1)];
    const radius = Math.max(old.radius, circle.radius);
    const dx = circle.x - old.x;
    const dy = circle.y - old.y;
    let enter = 0;
    let exit = 1;
    for (const [start, delta, min, max] of [[old.x, dx, left - radius, right + radius], [old.y, dy, top - radius, bottom + radius]]) {
      if (Math.abs(delta) < 1e-9) {
        if (start < min || start > max) return false;
      } else {
        const a = (min - start) / delta;
        const b = (max - start) / delta;
        enter = Math.max(enter, Math.min(a, b));
        exit = Math.min(exit, Math.max(a, b));
        if (enter > exit) return false;
      }
    }
    return true;
  });
}

function gapAt(state: SkiState, x: number): Feature | undefined {
  return state.features.find(f => f.kind === 'gap' && x > f.x + 5 && x < f.x + f.width - 5);
}

function simulate(state: SkiState, input: SkiInput, dt: number, reducedMotion: boolean): void {
  const p = state.player;
  const oldX = p.x;
  const oldGap = gapAt(state, oldX);
  const oldFeet = p.y + rideHeight(p);
  const wasCrashed = p.crashTime > 0;
  p.tucked = input.tuck && !wasCrashed;
  const before = playerBody(p, p.tucked);
  state.time += dt;
  state.messageTime = Math.max(0, state.messageTime - dt);
  p.squash = Math.max(0, p.squash - dt * 3);
  p.invulnerable = Math.max(0, p.invulnerable - dt);
  p.jumpBuffer = Math.max(0, p.jumpBuffer - dt);
  p.coyote = p.grounded ? 0.1 : Math.max(0, p.coyote - dt);
  if (input.jumpPressed) {
    if (wasCrashed) p.crashTime = Math.max(0, p.crashTime - 0.24);
    else p.jumpBuffer = 0.13;
  }
  if (wasCrashed) {
    p.crashTime = Math.max(0, p.crashTime - dt);
    if (p.crashTime === 0) {
      p.angle = terrainAngle(p.x, state.trail);
      p.invulnerable = Math.max(p.invulnerable, 0.55);
      message(state, '站稳啦，继续滑！');
    }
  }
  const base = TRAILS.find(t => t.id === state.trail)!.baseSpeed;
  const difficulty = Math.min(65, state.distance / 65);
  const onIce = state.features.some(f => f.kind === 'ice' && p.x >= f.x && p.x <= f.x + f.width);
  const targetSpeed = clamp(base + difficulty + Math.sin(terrainAngle(p.x, state.trail)) * 80
    + (p.partner === 'slide' ? 80 : p.partner === 'charge' ? 100 : 0)
    + (onIce && p.grounded ? 30 : 0) + state.combo * 4, 180, 470);
  p.speed += ((p.crashTime > 0 ? 65 : targetSpeed) - p.speed) * Math.min(1, dt * (p.crashTime > 0 ? 5 : 1.9));
  if (p.jumpBuffer > 0 && p.crashTime === 0 && (p.grounded || p.coyote > 0)) jump(p);
  p.x += p.speed * dt;
  if (p.partner) {
    p.partnerLeft = Math.max(0, p.partnerLeft - (p.x - oldX));
    if (p.partnerLeft === 0) dismount(p);
  }
  const gap = gapAt(state, p.x);
  const exitedBelowLip = oldGap && !gap && p.y > terrainY(p.x, state.trail) - rideHeight(p) + 18;
  if (p.grounded && gap && p.y < terrainY(p.x, state.trail) + 89 - rideHeight(p)) {
    p.grounded = false;
    p.airTime = 0;
    p.vy = 0;
    p.rotation = 0;
    p.flipping = false;
  }
  const floor = terrainY(p.x, state.trail) + (gap ? 90 : 0) - rideHeight(p);
  if (p.grounded) {
    p.y = floor;
    p.angle = terrainAngle(p.x, state.trail);
    p.vy = 0;
  } else {
    p.airTime += dt;
    const holdLift = input.jump && !input.tuck && p.airTime < 0.23 && p.vy < 0;
    p.vy += (holdLift ? 330 : input.tuck ? 1450 : 780) * dt;
    p.y += p.vy * dt;
    if (p.crashTime === 0) {
      const activeFlip = input.jump && !input.tuck && p.airTime >= 0.24;
      const turn = activeFlip ? -8.2 : clamp(input.tilt, -1, 1) * 3.4;
      if (activeFlip && !p.flipping) {
        p.flipping = true;
        state.events.push('flip');
      }
      p.angle += turn * dt;
      p.rotation += turn * dt;
      if (!activeFlip && Math.abs(input.tilt) < 0.1) {
        const difference = wrapped(terrainAngle(p.x, state.trail) - p.angle);
        p.angle += clamp(difference, -7 * dt, 7 * dt);
      }
    }
    if (p.vy >= 0 && p.y >= floor) {
      p.y = floor;
      p.grounded = true;
      p.vy = 0;
      p.coyote = 0.1;
      const failedGap = gap && !gap.used ? gap : exitedBelowLip && !oldGap.used ? oldGap : undefined;
      if (failedGap) {
        failedGap.used = true;
        crash(state, reducedMotion);
      } else if (p.crashTime === 0) {
        const error = Math.abs(wrapped(p.angle - terrainAngle(p.x, state.trail)));
        if (error > 0.85) crash(state, reducedMotion);
        else {
          const flips = Math.floor((Math.abs(p.rotation) + 1e-6) / TAU);
          if (flips > 0) {
            state.combo = Math.min(3, state.combo + 1);
            state.flips += flips;
            state.bonus += flips * 120 * state.combo;
            p.speed = Math.min(470, p.speed + 22);
            message(state, `${flips} 圈翻转 · 技巧 ×${state.combo}`);
          }
          state.events.push('land');
          p.squash = 0.65;
          burst(state, '#E3F4FF', reducedMotion);
        }
      }
      p.angle = terrainAngle(p.x, state.trail);
      p.rotation = 0;
      p.flipping = false;
      p.airTime = 0;
      if (p.jumpBuffer > 0 && p.crashTime === 0) jump(p);
    }
  }

  let after = playerBody(p, p.tucked);
  for (const f of state.features) {
    if (f.used || f.x > p.x + 80 || f.x + f.width < oldX - 80) continue;
    if (f.kind === 'coin') {
      const coin = { x: f.x + f.width / 2, y: f.y, radius: 10 };
      if (after.some((body, i) => sweptCircle(before[Math.min(i, before.length - 1)], body, coin, coin))) {
        f.used = true;
        state.coins++;
        state.events.push('coin');
      }
    } else if (f.kind === 'slide' || f.kind === 'charge') {
      if (p.crashTime === 0 && rectangleHit(before, after, f.x, f.x + f.width, f.y - 50, f.y)) {
        const previousHeight = rideHeight(p);
        p.partner = f.kind;
        p.partnerLeft = f.kind === 'slide' ? 1500 : 1900;
        p.shield = f.kind === 'slide';
        if (p.grounded) p.y += previousHeight - rideHeight(p);
        p.speed = Math.min(470, p.speed + 35);
        f.used = true;
        state.events.push('mount');
        message(state, f.kind === 'slide' ? '牛来滑行 · 一次护盾' : '牛来冲撞 · 撞开圆石');
        burst(state, '#F8CF66', reducedMotion);
      }
    } else if (f.kind === 'ramp') {
      if (p.grounded && p.crashTime === 0 && oldX <= f.x + f.width && p.x >= f.x + f.width * 0.65) {
        f.used = true;
        jump(p, -430);
        burst(state, '#FFFFFF', reducedMotion);
      }
    } else if (f.kind === 'rock' || f.kind === 'branch') {
      const partnerHit = p.partner && f.kind === 'rock' && rectangleHit(
        [{ x: oldX, y: oldFeet - 20, radius: 20 }],
        [{ x: p.x, y: p.y + rideHeight(p) - 20, radius: 20 }],
        f.x + 5, f.x + f.width - 5, f.y - 34, f.y);
      const hit = partnerHit || rectangleHit(before, after, f.x + 5, f.x + f.width - 5,
        f.y - (f.kind === 'rock' ? 34 : 72), f.y - (f.kind === 'rock' ? 0 : 46));
      if (!hit) continue;
      f.used = true;
      if (p.partner === 'charge' && f.kind === 'rock') {
        state.bonus += 30;
        burst(state, '#CBDDE4', reducedMotion);
      } else if (p.partner === 'slide' && p.shield) {
        dismount(p);
        p.invulnerable = Math.max(p.invulnerable, 0.3);
        message(state, '牛来挡住了撞击！');
        burst(state, '#F8CF66', reducedMotion);
      } else crash(state, reducedMotion);
    }
  }
  after = playerBody(p, p.tucked);
  const gapToFront = frontGap(state);
  const openingGrace = 55 * clamp((28 - state.time) / 22, 0, 1);
  const chaseSpeed = base - 8 + difficulty - openingGrace + clamp((gapToFront - 220) * 0.6, 0, 180);
  for (const chaser of state.chasers) {
    const oldBody = chaserBody(chaser.x, state.trail);
    chaser.x += chaseSpeed * dt;
    const newBody = chaserBody(chaser.x, state.trail);
    if (!state.over && after.some((body, i) => oldBody.some((enemy, j) =>
      sweptCircle(before[Math.min(i, before.length - 1)], body, enemy, newBody[j])))) {
      state.over = true;
      state.caughtTime = 0;
      state.events.push('caught');
      message(state, '豆包追上来啦！');
    }
  }
  state.distance = Math.max(state.distance, (p.x - START_X) / 10);
  state.score = Math.floor(state.distance) + state.coins * 25 + state.bonus;
  state.cameraY += (terrainY(p.x, state.trail) - 420 - state.cameraY) * Math.min(1, dt * 3);
  if (reducedMotion) state.particles.length = 0;
  else {
    for (const particle of state.particles) {
      particle.x += particle.vx * dt;
      particle.y += particle.vy * dt;
      particle.vy += 120 * dt;
      particle.life -= dt;
    }
    state.particles = state.particles.filter(particle => particle.life > 0).slice(-MAX_PARTICLES);
  }
  generate(state);
}

export function stepRun(state: SkiState, input: SkiInput, dt: number, reducedMotion = false): void {
  state.events.length = 0;
  if (state.over || !Number.isFinite(dt) || dt <= 0) return;
  // Cap resumed/background frames; the caller owns its fixed-step accumulator.
  let remaining = Math.min(dt, 0.1);
  let pressed = input.jumpPressed;
  while (remaining > 1e-9 && !state.over) {
    const step = Math.min(STEP, remaining);
    simulate(state, { ...input, jumpPressed: pressed }, step, reducedMotion);
    pressed = false;
    remaining -= step;
  }
}
