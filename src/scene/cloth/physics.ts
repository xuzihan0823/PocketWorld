export interface Ball {
  x: number;
  y: number;
  z: number;
  radius: number;
}
export interface ClothProfile {
  rest: Float32Array;
  /** World-space particle positions at solver creation, independent of constraint rest lengths. */
  initial?: Float32Array;
  pins: number[];
  structural: number[];
  shear: number[];
  bend: number[];
  triangles: number[];
  thickness: number;
  material: {
    drag: number;
    iterations: number;
    stretchCompliance: number;
    shearCompliance: number;
    bendCompliance: number;
    edgeHz: number;
    bendHz: number;
  };
}
export interface ClothSolver {
  positions: Float32Array;
  collisionMs: number | null;
  step(dt: number, targets: Float32Array, balls: Ball[]): void;
  dispose(): void;
}

/** Each tick advances the character as well as the cloth. Discard backlog after a stall. */
export class FixedClock {
  remainder = 0;
  dropped = 0;
  advance(elapsed: number, hz: number, tick: (dt: number) => void) {
    const dt = 1 / hz;
    this.remainder += elapsed;
    const due = Math.floor((this.remainder + 1e-10) / dt);
    this.remainder = Math.max(0, this.remainder - due * dt);
    this.dropped += Math.max(0, due - 4);
    for (let i = 0; i < Math.min(4, due); i++) tick(dt);
  }
}

export function lattice(
  columns: number,
  rows: number,
  wrap: boolean,
  thickness: number,
  point: (column: number, row: number) => number[],
): ClothProfile {
  const rest = new Float32Array(columns * rows * 3);
  const pins: number[] = [],
    structural: number[] = [],
    shear: number[] = [],
    bend: number[] = [],
    triangles: number[] = [];
  const id = (c: number, r: number) => r * columns + (c % columns);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < columns; c++) {
      const a = id(c, r);
      rest.set(point(c, r), 3 * a);
      if (r === 0) pins.push(a);
      if (wrap || c + 1 < columns) structural.push(a, id(c + 1, r));
      if (wrap || c + 2 < columns) bend.push(a, id(c + 2, r));
      if (r + 2 < rows) bend.push(a, id(c, r + 2));
      if (r + 1 >= rows) continue;
      const b = id(c, r + 1);
      structural.push(a, b);
      if (wrap || c + 1 < columns) {
        const right = id(c + 1, r),
          diag = id(c + 1, r + 1);
        shear.push(a, diag, b, right);
        triangles.push(a, b, right, right, b, diag);
      }
    }
  return {
    rest,
    pins,
    structural,
    shear,
    bend,
    triangles,
    thickness,
    material: {
      drag: 2,
      iterations: 5,
      stretchCompliance: 1e-7,
      shearCompliance: 3e-7,
      bendCompliance: 0.00012,
      edgeHz: 80,
      bendHz: 8,
    },
  };
}

export function distance(p: Float32Array, a: number, b: number) {
  return Math.hypot(p[3 * a] - p[3 * b], p[3 * a + 1] - p[3 * b + 1], p[3 * a + 2] - p[3 * b + 2]);
}

export class Xpbd implements ClothSolver {
  positions: Float32Array;
  collisionMs = 0;
  /** Exposed so the isolation tests can switch gravity off. */
  gravity = 9.81;
  private previous: Float32Array;
  private mass: Float32Array;
  private links: { a: number; b: number; length: number; compliance: number; lambda: number }[];
  private neighbors: Set<number>[];
  private buckets = new Map<number, number[]>();
  constructor(
    readonly profile: ClothProfile,
    readonly selfContacts = true,
  ) {
    this.positions = (profile.initial ?? profile.rest).slice();
    this.previous = this.positions.slice();
    this.mass = new Float32Array(this.positions.length / 3).fill(1);
    this.neighbors = Array.from(this.mass, () => new Set<number>());
    for (const id of profile.pins) this.mass[id] = 0;
    this.links = [];
    const m = profile.material;
    for (const [edges, compliance] of [
      [profile.structural, m.stretchCompliance],
      [profile.shear, m.shearCompliance],
      [profile.bend, m.bendCompliance],
    ] as const) {
      for (let i = 0; i < edges.length; i += 2) {
        const a = edges[i],
          b = edges[i + 1];
        this.neighbors[a].add(b);
        this.neighbors[b].add(a);
        this.links.push({ a, b, length: distance(profile.rest, a, b), compliance, lambda: 0 });
      }
    }
  }
  private collide(balls: Ball[]) {
    const p = this.positions,
      diameter = this.profile.thickness * 2;
    this.buckets.clear();
    // Hash collisions can only add candidates. Recheck Euclidean distance before projection.
    const key = (x: number, y: number, z: number) => (x * 73856093) ^ (y * 19349663) ^ (z * 83492791);
    for (let i = 0; i < this.mass.length; i++) {
      const a = 3 * i;
      if (this.mass[i])
        for (const ball of balls) {
          const dx = p[a] - ball.x,
            dy = p[a + 1] - ball.y,
            dz = p[a + 2] - ball.z;
          const d = Math.hypot(dx, dy, dz),
            r = ball.radius + this.profile.thickness;
          if (d >= r) continue;
          const push = r / (d || 1) - 1;
          p[a] += dx * push;
          p[a + 1] += d ? dy * push : r;
          p[a + 2] += dz * push;
        }
      if (!this.selfContacts) continue;
      const x = Math.floor(p[a] / diameter),
        y = Math.floor(p[a + 1] / diameter),
        z = Math.floor(p[a + 2] / diameter);
      for (let u = -1; u <= 1; u++)
        for (let v = -1; v <= 1; v++)
          for (let w = -1; w <= 1; w++) {
            const bucket = this.buckets.get(key(x + u, y + v, z + w));
            if (!bucket) continue;
            for (const j of bucket) {
              const b = 3 * j,
                weight = this.mass[i] + this.mass[j];
              if (!weight || this.neighbors[i].has(j)) continue;
              const dx = p[a] - p[b],
                dy = p[a + 1] - p[b + 1],
                dz = p[a + 2] - p[b + 2];
              const squared = dx * dx + dy * dy + dz * dz;
              if (squared >= diameter * diameter) continue;
              const d = Math.sqrt(squared),
                shift = (diameter - d) / weight;
              const normal = d ? [dx / d, dy / d, dz / d] : [1, 0, 0];
              for (let k = 0; k < 3; k++) {
                p[a + k] += normal[k] * this.mass[i] * shift;
                p[b + k] -= normal[k] * this.mass[j] * shift;
              }
            }
          }
      const hash = key(x, y, z),
        list = this.buckets.get(hash);
      if (list) list.push(i);
      else this.buckets.set(hash, [i]);
    }
  }
  step(dt: number, targets: Float32Array, balls: Ball[]) {
    const p = this.positions,
      drag = Math.exp(-this.profile.material.drag * dt);
    for (let k = 0; k < p.length; k++) {
      const old = p[k];
      p[k] = this.mass[Math.floor(k / 3)]
        ? old + (old - this.previous[k]) * drag - (k % 3 === 1 ? this.gravity * dt * dt : 0)
        : targets[k];
      this.previous[k] = old;
    }
    for (const edge of this.links) edge.lambda = 0;
    this.collisionMs = 0;
    for (let iter = 0; iter < this.profile.material.iterations; iter++) {
      for (const edge of this.links) {
        const { a, b, length, compliance } = edge;
        const dx = p[3 * a] - p[3 * b],
          dy = p[3 * a + 1] - p[3 * b + 1],
          dz = p[3 * a + 2] - p[3 * b + 2];
        const d = Math.hypot(dx, dy, dz),
          alpha = compliance / (dt * dt);
        if (d < 1e-9) continue;
        const dl = (length - d - alpha * edge.lambda) / (this.mass[a] + this.mass[b] + alpha);
        edge.lambda += dl;
        for (let k = 0; k < 3; k++) {
          const delta = ((p[3 * a + k] - p[3 * b + k]) * dl) / d;
          p[3 * a + k] += this.mass[a] * delta;
          p[3 * b + k] -= this.mass[b] * delta;
        }
      }
      const start = performance.now();
      this.collide(balls);
      this.collisionMs += performance.now() - start;
    }
  }
  dispose() {
    this.buckets.clear();
  }
}
