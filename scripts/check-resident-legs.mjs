import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from 'three';
import { load } from './resident-glb-loader.mjs';

assert.ok(process.env.BASELINE_GLB, 'Set BASELINE_GLB to the previous accepted export');
const old = await load(process.env.BASELINE_GLB);
const fixed = await load('public/models/resident/luna-tripo-transitions.glb');
const v = () => new THREE.Vector3();
function joints(model, side) {
  const [hip, knee, ankle] = ['UpLeg', 'Leg', 'Foot'].map(n => model.bone(side + n).getWorldPosition(v()));
  const axis = ankle.clone().sub(hip).normalize();
  const pole = knee.clone().sub(hip); pole.addScaledVector(axis, -pole.dot(axis)).normalize();
  return { hip: hip.toArray(), knee: knee.toArray(), ankle: ankle.toArray(), pole: pole.toArray(),
    lateralOffset: knee.x - THREE.MathUtils.lerp(hip.x, ankle.x, (hip.y - knee.y) / (hip.y - ankle.y)),
    flexionDegrees: THREE.MathUtils.radToDeg(knee.clone().sub(hip).angleTo(ankle.clone().sub(knee))) };
}
function sections(model) {
  const mesh = model.mesh, points = [];
  for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
    mesh.getVertexPosition(i, points[i] = v()); mesh.localToWorld(points[i]);
  }
  const index = mesh.geometry.index, result = {};
  for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
    const j = joints(model, side); result[side] = [];
    for (const y of [.14, .18, .22, .26, .28, .30, .32]) {
      const xs = [];
      for (let i = 0; i < index.count; i += 3) {
        const tri = [0, 1, 2].map(k => points[index.getX(i + k)]);
        if (tri.some(p => p.x * sign < .015) || Math.min(...tri.map(p => p.y)) > y || Math.max(...tri.map(p => p.y)) < y) continue;
        for (let k = 0; k < 3; k++) {
          const a = tri[k], b = tri[(k + 1) % 3];
          if ((a.y - y) * (b.y - y) > 0 || Math.abs(a.y - b.y) < 1e-9) continue;
          const t = (y - a.y) / (b.y - a.y); if (t >= 0 && t <= 1) xs.push(THREE.MathUtils.lerp(a.x, b.x, t));
        }
      }
      if (!xs.length) continue;
      const [a, b] = y > j.knee[1] ? [j.hip, j.knee] : [j.knee, j.ankle];
      const boneX = THREE.MathUtils.lerp(a[0], b[0], (y - a[1]) / (b[1] - a[1]));
      const min = Math.min(...xs), max = Math.max(...xs), center = (min + max) / 2;
      result[side].push({ height: y, min, max, center, boneX, surfaceOffset: (center - boneX) * sign });
    }
  }
  return result;
}
const report = { baseline: old.sha256, after: fixed.sha256, coordinateSystem: 'glTF: X lateral, Y up, Z forward',
  videoTimeMap: { '2.20': ['SitCycle', 2.2], '2.60': ['Walk', .2], '3.20': ['Walk', .8] }, poses: [] };
for (const [clip, time] of [['Rest', 0], ['SitCycle', 2.2], ['Walk', .2], ['Walk', .8]]) {
  const sample = { clip, time };
  for (const [key, model] of [['before', old], ['after', fixed]]) {
    clip === 'Rest' ? model.rest() : model.select(clip)(time);
    sample[key] = { joints: Object.fromEntries(['Left', 'Right'].map(s => [s, joints(model, s)])), surface: sections(model) };
    // Compare the calf/knee silhouette bend within each leg. A constant
    // surface-to-bone offset is legitimate and cancels out of this measure.
    sample[key].surfaceBend = Object.fromEntries(['Left', 'Right'].map(side => {
      const rings = sample[key].surface[side];
      const mean = heights => rings.filter(r => heights.includes(r.height)).reduce((s, r) => s + r.surfaceOffset, 0) / heights.length;
      return [side, mean([.18, .22]) - mean([.28, .30, .32])];
    }));
  }
  report.poses.push(sample);
}
let maxWalkMatrixDifference = 0, maxFootDifference = 0, maxFlexionDifference = 0, maxCoronalOffset = 0;
const beforeWalk = old.select('Walk'), afterWalk = fixed.select('Walk');
for (let i = 0; i <= 144; i++) {
  const t = i / 120; beforeWalk(t); afterWalk(t);
  for (const [n, b] of old.mesh.skeleton.bones.entries()) {
    const other = fixed.mesh.skeleton.bones[n];
    maxWalkMatrixDifference = Math.max(maxWalkMatrixDifference, ...b.matrixWorld.elements.map((x, j) => Math.abs(x - other.matrixWorld.elements[j])));
  }
  for (const side of ['Left', 'Right']) {
    const a = joints(old, side), b = joints(fixed, side);
    maxFootDifference = Math.max(maxFootDifference, v().fromArray(a.ankle).distanceTo(v().fromArray(b.ankle)));
    maxFlexionDifference = Math.max(maxFlexionDifference, Math.abs(a.flexionDegrees - b.flexionDegrees));
    maxCoronalOffset = Math.max(maxCoronalOffset, Math.abs(b.lateralOffset));
  }
}
const stop = report.poses.find(p => p.clip === 'SitCycle');
report.regression = { fps: 120, maxWalkMatrixDifference, maxFootDifference, maxFlexionDifference, maxCoronalOffset,
  stoppedKneeOffsetBefore: Math.max(...Object.values(stop.before.joints).map(j => Math.abs(j.lateralOffset))),
  stoppedKneeOffsetAfter: Math.max(...Object.values(stop.after.joints).map(j => Math.abs(j.lateralOffset))) };
assert.ok(maxWalkMatrixDifference < 1e-6, 'Walk rotations and distances must remain unchanged');
assert.ok(maxFootDifference < 1e-6 && maxFlexionDifference < .001);
assert.ok(maxCoronalOffset < .0005, 'No inward knee plane during walking');
assert.ok(report.regression.stoppedKneeOffsetAfter < 1e-6);
await fs.writeFile('art/resident/tripo-transitions/leg-validation.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report.regression, null, 2));
