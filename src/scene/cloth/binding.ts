import * as T from 'three';
import { lattice, type Ball, type ClothProfile } from './physics';
import { sleeveSurfaceMask } from './sleeveMask';

export interface Region {
  profile: ClothProfile;
  targets: Float32Array;
  balls: Ball[];
  sample(time: number): void;
  bind(positions: Float32Array): void;
  surfaceContact?(): { samples: number; skinnedDepth: number; correctedDepth: number };
  sleeveLayers?: { mesh: T.SkinnedMesh; raw: Float32Array; final: Float32Array; driverVertices: number[] };
  mappedVertices: number;
}
type Side = 'Left' | 'Right';
const v = () => new T.Vector3();
const tau = Math.PI * 2;
function bone(mesh: T.SkinnedMesh, name: string) {
  const b = mesh.skeleton.getBoneByName('mixamorig' + name);
  if (!b) throw new Error('缺少骨骼 ' + name);
  return b;
}
function bindPosition(mesh: T.SkinnedMesh, name: string) {
  const i = mesh.skeleton.bones.indexOf(bone(mesh, name));
  return v()
    .setFromMatrixPosition(mesh.skeleton.boneInverses[i].clone().invert())
    .applyMatrix4(mesh.bindMatrix.clone().invert());
}

function collisionRig(mesh: T.SkinnedMesh, side: Side, skirt: boolean) {
  // Overlapping spheres sampled along bones. Radii include the jacket torso envelope.
  const segments: [string, string, number, number][] = skirt
    ? [
        ['LeftUpLeg', 'LeftLeg', 0.055, 5],
        ['RightUpLeg', 'RightLeg', 0.055, 5],
        ['Hips', 'Spine', 0.09, 2],
      ]
    : [
        [side + 'Arm', side + 'ForeArm', 0.033, 5],
        [side + 'ForeArm', side + 'Hand', 0.032, 5],
        ['Spine', 'Spine2', 0.1, 5],
      ];
  const spans = segments.map(([start, end, radius, count]) => ({
    a: bone(mesh, start),
    b: bone(mesh, end),
    radius,
    count,
  }));
  const balls = spans.flatMap((s) =>
    Array.from({ length: s.count }, () => ({ x: 0, y: 0, z: 0, radius: s.radius })),
  );
  const a = v(),
    b = v(),
    c = v();
  return {
    balls,
    sample() {
      let i = 0;
      for (const span of spans) {
        a.setFromMatrixPosition(span.a.matrixWorld);
        b.setFromMatrixPosition(span.b.matrixWorld);
        for (let j = 0; j < span.count; j++) {
          c.lerpVectors(a, b, j / (span.count - 1));
          Object.assign(balls[i++], { x: c.x, y: c.y, z: c.z });
        }
      }
    },
  };
}

export function patchRegion(stage: T.Scene, arm?: T.SkinnedMesh): Region {
  const profile = lattice(12, 9, false, arm ? 0.0025 : 0.012, (c, r) =>
    arm
      ? [(c / 11 - 0.5) * 0.095, -0.014 * r, 0.045]
      : [(c / 11 - 0.5) * 0.85, 1.28 - r * 0.082, 0.025 * Math.cos(c * 0.45)],
  );
  const local = profile.rest.slice(),
    targets = profile.rest.slice();
  const collision = arm && collisionRig(arm, 'Left', false);
  const balls = collision?.balls ?? [{ x: 0, y: 0.85, z: 0, radius: 0.16 }];
  const joint = arm && bone(arm, 'LeftForeArm');
  const point = v();
  const geometry = new T.BufferGeometry();
  geometry.setIndex(profile.triangles);
  const attribute = new T.BufferAttribute(targets.slice(), 3).setUsage(T.DynamicDrawUsage);
  geometry.setAttribute('position', attribute);
  const render = new T.Mesh(
    geometry,
    new T.MeshStandardMaterial({ color: 0x68cdc3, side: T.DoubleSide, roughness: 0.8 }),
  );
  render.frustumCulled = false;
  stage.add(render);
  function sample(t: number) {
    collision?.sample();
    for (let i = 0; i < local.length; i += 3) {
      point.fromArray(local, i);
      if (joint) point.applyMatrix4(joint.matrixWorld);
      else {
        // Lateral travel, fold and reverse on exactly the same trajectory in both solvers.
        // Squeeze the suspended edge for a folded-sheet self-contact trial.
        const squeeze = T.MathUtils.smoothstep(Math.sin(t * 2), 0.2, 0.95);
        point.z += squeeze * 0.09 * Math.sin(((i / 3) % 12) * 1.72);
        point.x *= 1 - 0.9 * squeeze;
        point.x += 0.26 * Math.sin(5 * t);
        point.z += 0.15 * Math.sin(4 * t + point.x * 2);
        point.y += 0.14 * Math.sin(t * 6) * (point.x + 0.5);
      }
      point.toArray(targets, i);
    }
  }
  function bind(p: Float32Array) {
    attribute.array.set(p);
    attribute.needsUpdate = true;
    geometry.computeVertexNormals();
  }
  sample(0);
  profile.rest.set(targets);
  bind(targets);
  return { profile, targets, balls, sample, bind, mappedVertices: targets.length / 3 };
}

/** A displacement after skinning preserves UVs, material groups, morphs and the skeleton. */
function offsetAttribute(mesh: T.SkinnedMesh) {
  let attr = mesh.geometry.getAttribute('pwCloth') as T.BufferAttribute | undefined;
  if (attr) return attr;
  const material = mesh.material as T.MeshStandardMaterial;
  attr = new T.BufferAttribute(new Float32Array(mesh.geometry.attributes.position.count * 3), 3).setUsage(
    T.DynamicDrawUsage,
  );
  mesh.geometry.setAttribute('pwCloth', attr);
  const prior = material.onBeforeCompile.bind(material),
    priorKey = material.customProgramCacheKey();
  material.onBeforeCompile = (shader, renderer) => {
    prior(shader, renderer);
    shader.vertexShader =
      'attribute vec3 pwCloth;\n' +
      shader.vertexShader.replace(
        '#include <skinning_vertex>',
        '#include <skinning_vertex>\ntransformed += pwCloth;',
      );
  };
  material.customProgramCacheKey = () => priorKey + '-pwcs-post-skin-1';
  material.needsUpdate = true;
  return attr;
}

export function garmentRegion(
  mesh: T.SkinnedMesh, side: Side, skirt = false, singleSleeve = false, captureLayers = singleSleeve,
): Region {
  const cols = skirt ? 20 : 12,
    rows = skirt ? 6 : 5;
  const arm = bindPosition(mesh, side + 'Arm'),
    wrist = bindPosition(mesh, side + 'Hand');
  const start = skirt ? new T.Vector3(0, 0.51, 0) : arm.clone().lerp(wrist, 0.2);
  const end = skirt ? new T.Vector3(0, 0.369, 0) : arm.clone().lerp(wrist, 0.96);
  const axis = end.clone().sub(start),
    height = axis.length();
  axis.normalize();
  const horizontal = v()
    .crossVectors(axis, new T.Vector3(0, 0, 1))
    .normalize();
  const front = v().crossVectors(horizontal, axis).normalize();
  const g = mesh.geometry.attributes,
    p = v(),
    radial = v();
  const candidates: { id: number; u: number; t: number; radius: number; weight: number }[] = [];
  const bones = mesh.skeleton.bones;
  const mask = singleSleeve ? sleeveSurfaceMask(mesh).sleeve : undefined;
  for (let i = 0; i < g.position.count; i++) {
    if (mask && !mask.has(i)) continue;
    let weight = 0;
    for (let k = 0; k < 4; k++) {
      const name = bones[g.skinIndex.getComponent(i, k)].name;
      if (
        skirt
          ? name.startsWith('Dress_')
          : [side + 'Arm', side + 'ForeArm'].some((s) => name === 'mixamorig' + s)
      )
        weight += g.skinWeight.getComponent(i, k);
    }
    if (weight < 0.22) continue;
    p.fromBufferAttribute(g.position, i).sub(start);
    const t = p.dot(axis) / height;
    if (t < -0.03 || t > 1.1) continue;
    radial.copy(p).addScaledVector(axis, -height * t);
    const u = (1 + Math.atan2(radial.dot(front), radial.dot(horizontal)) / tau) % 1;
    candidates.push({ id: i, u, t, radius: radial.length(), weight });
  }
  if (candidates.length < cols * rows) throw new Error('服装选区过小，请检查 GLB 版本');
  // Center angular bins on each garment section. The arm-bone chord is eccentric inside this sleeve.
  const centers = Array.from({ length: rows }, (_, r) => start.clone().lerp(end, r / (rows - 1)));
  if (singleSleeve) {
    centers.forEach((center, r) => {
      const box = new T.Box2();
      for (const q of candidates) {
        if (Math.abs(q.t - r / (rows - 1)) > 0.12) continue;
        p.fromBufferAttribute(g.position, q.id).sub(center);
        box.expandByPoint(new T.Vector2(p.dot(horizontal), p.dot(front)));
      }
      if (box.isEmpty()) throw new Error('左袖截面缺少样本');
      const mid = box.getCenter(new T.Vector2());
      center.addScaledVector(horizontal, mid.x).addScaledVector(front, mid.y);
    });
    for (const q of candidates) {
      const row = T.MathUtils.clamp(q.t, 0, 1) * (rows - 1);
      const r = Math.min(rows - 2, Math.floor(row));
      radial.lerpVectors(centers[r], centers[r + 1], row - r);
      p.fromBufferAttribute(g.position, q.id).sub(radial);
      const x = p.dot(horizontal), y = p.dot(front);
      q.u = (1 + Math.atan2(y, x) / tau) % 1;
      q.radius = Math.hypot(x, y);
    }
  }
  const nearest: number[] = [];
  const profile = lattice(cols, rows, true, 0.0025, (c, r) => {
    const u = c / cols,
      t = r / (rows - 1);
    let best = candidates[0],
      cost = Infinity;
    for (const q of candidates) {
      const gap = Math.abs(q.u - u),
        d = Math.min(gap, 1 - gap) ** 2 + (q.t - t) ** 2;
      if (d < cost) {
        best = q;
        cost = d;
      }
    }
    nearest.push(best.id);
    return centers[r]
      .clone()
      .addScaledVector(horizontal, best.radius * Math.cos(tau * u))
      .addScaledVector(front, best.radius * Math.sin(tau * u))
      .toArray();
  });
  if (singleSleeve) {
    // All cuff targets enter the torso during isolated elbow flexion. Guide one ring higher.
    profile.pins = [5, 6, 7, 3 * cols + 5];
  } else if (!skirt) profile.pins.push((rows - 1) * cols);
  // One skin transform per sleeve ring avoids conflicting kinematic targets around its circumference.
  // Keep the individual skirt sectors on their authored dress bones.
  if (!skirt) for (let r = 0; r < rows; r++) nearest.fill(nearest[r * cols], r * cols, (r + 1) * cols);
  const local = profile.rest.slice(),
    targets = profile.rest.slice(),
    delta = new Float32Array(local.length);
  const attr = offsetAttribute(mesh);
  const bindings = candidates.map((q) => {
    const col = q.u * cols,
      row = T.MathUtils.clamp(q.t, 0, 1) * (rows - 1);
    const c = Math.floor(col),
      r = Math.min(rows - 2, Math.floor(row)),
      x = col - c,
      y = row - r;
    const fade =
      T.MathUtils.smoothstep(q.weight, 0.22, 0.85) *
      T.MathUtils.smoothstep(q.t, 0, 0.22) *
      (1 - T.MathUtils.smoothstep(q.t, 0.95, 1.1));
    return {
      id: q.id,
      nodes: [
        r * cols + c,
        r * cols + ((c + 1) % cols),
        (r + 1) * cols + c,
        (r + 1) * cols + ((c + 1) % cols),
      ],
      weights: [(1 - x) * (1 - y), x * (1 - y), (1 - x) * y, x * y],
      fade,
    };
  });
  const collision = collisionRig(mesh, side, skirt);
  // Fit a fixed reference envelope inside the bind-pose sleeve. Its centers follow the animated
  // ring guides, never the solver output. Keep the torso chain independently driven by the spine.
  const worldScale = mesh.matrixWorld.getMaxScaleOnAxis();
  const ringRadii = centers.map((center, r) => {
    let radius = Infinity;
    for (let c = 0; c < cols; c++) radius = Math.min(radius, center.distanceTo(p.fromArray(local, 3 * (r * cols + c))));
    return radius * worldScale * 0.75;
  });
  const sleeveBalls = singleSleeve ? Array.from({ length: 2 * rows - 1 }, (_, j) => ({
    x: 0, y: 0, z: 0, radius: (ringRadii[j >> 1] + ringRadii[Math.ceil(j / 2)]) / 2,
  })) : [];
  const torsoBalls = collision.balls.slice(10);
  const balls = singleSleeve ? [...sleeveBalls, ...torsoBalls] : collision.balls;
  const raw = captureLayers ? new Float32Array(attr.array.length) : undefined;
  const rawDelta = captureLayers ? new Float32Array(local.length) : undefined;
  const inverse = new T.Matrix3(),
    normal = v(),
    corrected = v();
  const displacementLimit = skirt ? 0.04 : 0.018;
  const skinned = v();
  const linear = new T.Matrix3();
  const pinned = new Set(profile.pins);
  function sample() {
    collision.sample();
    for (let i = 0; i < nearest.length; i++) {
      p.fromArray(local, 3 * i);
      mesh
        .applyBoneTransform(nearest[i], p)
        .applyMatrix4(mesh.matrixWorld)
        .toArray(targets, 3 * i);
    }
    if (singleSleeve) {
      for (let r = 0; r < rows; r++) {
        mesh.applyBoneTransform(nearest[r * cols], p.copy(centers[r])).applyMatrix4(mesh.matrixWorld);
        Object.assign(sleeveBalls[2 * r], { x: p.x, y: p.y, z: p.z });
        if (r > 0) {
          const previous = sleeveBalls[2 * r - 2];
          Object.assign(sleeveBalls[2 * r - 1], { x: (p.x + previous.x) / 2, y: (p.y + previous.y) / 2, z: (p.z + previous.z) / 2 });
        }
      }
    }
  }
  function bind(positions: Float32Array) {
    inverse.setFromMatrix4(mesh.matrixWorld).invert();
    linear.setFromMatrix4(mesh.matrixWorld);
    for (let i = 0; i < nearest.length; i++) {
      p.fromArray(positions, 3 * i).sub(radial.fromArray(targets, 3 * i));
      if (rawDelta) corrected.copy(p).applyMatrix3(inverse).toArray(rawDelta, 3 * i);
      p.clampLength(0, displacementLimit);
      if (!pinned.has(i)) {
        corrected.copy(radial).add(p);
        for (const ball of balls) {
          normal.set(corrected.x - ball.x, corrected.y - ball.y, corrected.z - ball.z);
          const depth = ball.radius + profile.thickness - normal.length();
          if (depth > 0) corrected.addScaledVector(normal.normalize(), depth);
        }
        p.copy(corrected).sub(radial).clampLength(0, displacementLimit);
      }
      p.applyMatrix3(inverse).toArray(delta, 3 * i);
    }
    for (const b of bindings) {
      p.set(0, 0, 0);
      for (let k = 0; k < 4; k++) p.addScaledVector(radial.fromArray(delta, 3 * b.nodes[k]), b.weights[k]);
      p.multiplyScalar(b.fade);
      if (singleSleeve && b.fade > 0) {
        // Interpolating displacements on a curved surface can put a vertex back inside the torso.
        // Project the actual post-skin point and keep the same world-space displacement budget at the seam.
        mesh.getVertexPosition(b.id, skinned).applyMatrix4(mesh.matrixWorld);
        corrected.copy(p).applyMatrix3(linear).add(skinned);
        for (const ball of torsoBalls) {
          normal.set(corrected.x - ball.x, corrected.y - ball.y, corrected.z - ball.z);
          const depth = ball.radius + profile.thickness - normal.length();
          if (depth > 0) corrected.addScaledVector(normal.normalize(), depth);
        }
        p.copy(corrected).sub(skinned).clampLength(0, displacementLimit * b.fade).applyMatrix3(inverse);
      }
      attr.setXYZ(b.id, p.x, p.y, p.z);
      if (raw && rawDelta) {
        p.set(0, 0, 0);
        for (let k = 0; k < 4; k++) p.addScaledVector(radial.fromArray(rawDelta, 3 * b.nodes[k]), b.weights[k]);
        p.toArray(raw, 3 * b.id);
      }
    }
    attr.needsUpdate = true;
  }
  sample();
  if (singleSleeve) {
    for (let k = 0; k < local.length; k += 3) p.fromArray(local, k).applyMatrix4(mesh.matrixWorld).toArray(profile.rest, k);
    profile.initial = targets.slice();
  } else profile.rest.set(targets);
  function surfaceContact() {
    let skinnedDepth = 0,
      correctedDepth = 0,
      samples = 0;
    const stride = Math.max(1, Math.ceil(bindings.length / 128));
    for (let j = 0; j < bindings.length; j += stride) {
      const id = bindings[j].id;
      mesh.getVertexPosition(id, p);
      corrected.copy(p).add(radial.fromBufferAttribute(attr, id)).applyMatrix4(mesh.matrixWorld);
      p.applyMatrix4(mesh.matrixWorld);
      for (const b of balls) {
        skinnedDepth = Math.max(skinnedDepth, b.radius - Math.hypot(p.x - b.x, p.y - b.y, p.z - b.z));
        correctedDepth = Math.max(
          correctedDepth,
          b.radius - Math.hypot(corrected.x - b.x, corrected.y - b.y, corrected.z - b.z),
        );
      }
      samples++;
    }
    return { samples, skinnedDepth, correctedDepth };
  }
  return {
    profile,
    targets,
    balls,
    sleeveLayers: raw ? { mesh, raw, final: attr.array as Float32Array, driverVertices: nearest } : undefined,
    sample,
    bind,
    mappedVertices: bindings.length,
    surfaceContact,
  };
}
