import * as THREE from 'three';
import { CHAIR_CLIP_ORIGIN, CHAIR_SIT_SECONDS } from './chairMotion';
import { RESIDENT_SCALE } from './residentRig';

export interface SeatContactCache { frames: number; count: number; quantum: number; values: Int16Array }
export function readSeatContactCache(buffer: ArrayBuffer): SeatContactCache {
  const header = new DataView(buffer);
  if (buffer.byteLength < 20 || header.getUint32(0, true) !== 0x43535750 || header.getUint32(4, true) !== 1)
    throw new Error('Invalid Luna seat contact cache');
  const frames = header.getUint32(8, true), count = header.getUint32(12, true), quantum = header.getFloat32(16, true);
  if (frames !== 68 || !count || !Number.isFinite(quantum) || quantum <= 0 || buffer.byteLength !== 20 + frames * count * 6)
    throw new Error('Incomplete Luna seat contact cache');
  return { frames, count, quantum, values: new Int16Array(buffer, 20) };
}

/** Evaluated Blender clearance is baked in pre-skin space. Only the local contact vertices change. */
export function createChairAnimation(asset: THREE.Object3D, clip: THREE.AnimationClip, cache: SeatContactCache) {
  const bones = new Map<string, THREE.Bone>();
  asset.traverse(o => { if (o instanceof THREE.Bone) bones.set(o.name, o); });
  const channels = clip.tracks.map(track => {
    const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
    const joint = bones.get(nodeName);
    if (!joint || !['position', 'quaternion', 'scale'].includes(propertyName)) throw new Error(`Invalid seat channel ${track.name}`);
    return { value: joint[propertyName as 'position' | 'quaternion' | 'scale'], propertyName, curve: track.createInterpolant() };
  });
  const surfaces: { geometry: THREE.BufferGeometry; rest: Float32Array; position: THREE.BufferAttribute; mapping: [number, number][] }[] = [];
  asset.traverse(o => {
    if (!(o instanceof THREE.SkinnedMesh)) return;
    const ids = o.geometry.getAttribute('_contact_id');
    if (!ids) throw new Error('Luna seat vertex mapping missing');
    o.geometry = o.geometry.clone();
    const position = o.geometry.getAttribute('position') as THREE.BufferAttribute;
    position.setUsage(THREE.DynamicDrawUsage);
    const mapping: [number, number][] = [];
    for (let i = 0; i < ids.count; i++) if (ids.getX(i) >= 0) {
      const index = Math.round(ids.getX(i));
      if (index >= cache.count) throw new Error('Luna seat vertex mapping out of range');
      mapping.push([i * 3, index * 3]);
    }
    surfaces.push({ geometry: o.geometry, rest: new Float32Array(position.array), position, mapping });
  });
  const vector = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const hips = bones.get('mixamorigHips')!;
  const legChains = ['Right', 'Left'].map(side => ['UpLeg', 'Leg', 'Foot'].map(s => bones.get('mixamorig' + side + s)!));
  let lastTime = -1, lastWeight = -1;
  function deform(time: number, weight: number) {
    if (time === lastTime && weight === lastWeight) return;
    lastTime = time; lastWeight = weight;
    const f = THREE.MathUtils.clamp(time * 30, 0, cache.frames - 1), a = Math.floor(f), b = Math.min(a + 1, cache.frames - 1), t = f - a;
    const stride = cache.count * 3;
    for (const { rest, position, mapping } of surfaces) {
      for (const [vertex, id] of mapping) for (let axis = 0; axis < 3; axis++) {
        const lo = cache.values[a * stride + id + axis], hi = cache.values[b * stride + id + axis];
        position.array[vertex + axis] = rest[vertex + axis] + (lo + (hi - lo) * t) * cache.quantum * weight;
      }
      position.needsUpdate = true;
      // Preserve authored split normals on the face, hair and limbs. The baked correction
      // is small and local; rebuilding every normal destroys the imported smooth shading.
    }
  }
  /** Call after the normal pose. The chair owns every deform bone while its weight is one. */
  function apply(time: number, weight: number, soleAhead = 0, soleLift = 0) {
    time = THREE.MathUtils.clamp(time, 0, CHAIR_SIT_SECONDS);
    deform(time, weight);
    if (weight <= 0) return;
    for (const { value, propertyName, curve } of channels) {
      const sample = curve.evaluate(time);
      if (propertyName === 'quaternion') (value as THREE.Quaternion).slerp(rotation.fromArray(sample), weight);
      else (value as THREE.Vector3).lerp(vector.fromArray(sample), weight);
    }
    // Root travel is already in the clip. Rebase once so the controller can align the entry stance.
    hips.position.z -= CHAIR_CLIP_ORIGIN / RESIDENT_SCALE * weight;
    if (soleAhead || soleLift) {
      asset.updateWorldMatrix(true, true);
      for (const chain of legChains) offsetFoot(chain, soleAhead, soleLift, asset);
    }
  }
  return { apply, dispose: () => surfaces.forEach(s => s.geometry.dispose()) };
}

/** Shortest-arc corrections preserve the accepted knee roll and measured segment lengths. */
function offsetFoot([thigh, shin, foot]: THREE.Bone[], ahead: number, lift: number, asset: THREE.Object3D) {
  const position = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());
  const orientation = (o: THREE.Object3D) => o.getWorldQuaternion(new THREE.Quaternion());
  const h = position(thigh), k = position(shin), a = position(foot), sole = orientation(foot);
  const direction = new THREE.Vector3(0, 0, 1).transformDirection(asset.matrixWorld);
  const target = a.clone().addScaledVector(direction, ahead); target.y += lift;
  const l1 = h.distanceTo(k), l2 = k.distanceTo(a), axis = target.clone().sub(h);
  const distance = THREE.MathUtils.clamp(axis.length(), Math.abs(l1 - l2) + 1e-5, l1 + l2 - 1e-5); axis.normalize();
  const bend = k.clone().sub(h); bend.addScaledVector(axis, -bend.dot(axis));
  if (bend.lengthSq() < 1e-10) bend.copy(direction).addScaledVector(axis, -direction.dot(axis));
  bend.normalize();
  const along = (l1*l1 - l2*l2 + distance*distance) / (2*distance);
  const knee = h.clone().addScaledVector(axis, along).addScaledVector(bend, Math.sqrt(Math.max(0, l1*l1-along*along)));
  const set = (joint: THREE.Bone, q: THREE.Quaternion) => { joint.quaternion.copy(orientation(joint.parent!).invert()).multiply(q); joint.updateWorldMatrix(false, true); };
  const aim = (joint: THREE.Bone, before: THREE.Vector3, after: THREE.Vector3) => set(joint, new THREE.Quaternion().setFromUnitVectors(before.normalize(), after.normalize()).multiply(orientation(joint)));
  aim(thigh, k.clone().sub(h), knee.clone().sub(h));
  const newKnee = position(shin);
  aim(shin, position(foot).sub(newKnee), h.addScaledVector(axis, distance).sub(newKnee));
  set(foot, sole);
}
