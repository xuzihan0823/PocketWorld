import * as THREE from 'three';
import { CHAIR_CLIP_ORIGIN, CHAIR_FPS, CHAIR_SIT_FRAMES } from './chairMotion';
import { RESIDENT_SCALE } from './residentRig';

export interface SeatContactCache { frames: number; count: number; quantum: number; values: Int16Array }
export function readSeatContactCache(buffer: ArrayBuffer): SeatContactCache {
  const header = new DataView(buffer);
  if (buffer.byteLength < 20 || header.getUint32(0, true) !== 0x43535750 || header.getUint32(4, true) !== 1)
    throw new Error('Invalid Luna seat contact cache');
  const frames = header.getUint32(8, true), count = header.getUint32(12, true), quantum = header.getFloat32(16, true);
  if (frames !== CHAIR_SIT_FRAMES || !count || !Number.isFinite(quantum) || quantum <= 0 || buffer.byteLength !== 20 + frames * count * 6)
    throw new Error('Incomplete Luna seat contact cache');
  return { frames, count, quantum, values: new Int16Array(buffer, 20) };
}

/** Evaluated Blender clearance is baked in pre-skin space. Only the local contact vertices change. */
export function createChairAnimation(asset: THREE.Object3D, reference: THREE.AnimationClip, capture: THREE.AnimationClip, cache: SeatContactCache) {
  const bones = new Map<string, THREE.Bone>();
  asset.traverse(o => { if (o instanceof THREE.Bone) bones.set(o.name, o); });
  const timingTrack = capture.tracks.find(track => track.name === 'ChairContactTime.position');
  if (!timingTrack) throw new Error('Luna CMU seat contact timing missing');
  const clock = timingTrack.createInterpolant();
  const recorded = new Map(capture.tracks.map(track => [track.name, track]));
  const channels = reference.tracks.map(track => {
    const { nodeName, propertyName } = THREE.PropertyBinding.parseTrackName(track.name);
    const joint = bones.get(nodeName);
    if (!joint || !['position', 'quaternion', 'scale'].includes(propertyName)) throw new Error(`Invalid seat channel ${track.name}`);
    const replacement = recorded.get(track.name);
    return { captured: !!replacement, value: joint[propertyName as 'position' | 'quaternion' | 'scale'], propertyName, curve: (replacement ?? track).createInterpolant() };
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
  let lastTime = -1, lastWeight = -1;
  function deform(time: number, weight: number) {
    if (time === lastTime && weight === lastWeight) return;
    lastTime = time; lastWeight = weight;
    const f = THREE.MathUtils.clamp(time * CHAIR_FPS, 0, cache.frames - 1), a = Math.floor(f), b = Math.min(a + 1, cache.frames - 1), t = f - a;
    const stride = cache.count * 3;
    for (const { rest, position, mapping } of surfaces) {
      for (const [vertex, id] of mapping) for (let axis = 0; axis < 3; axis++) {
        const lo = cache.values[a * stride + id + axis], hi = cache.values[b * stride + id + axis];
        position.array[vertex + axis] = weight === 0 ? rest[vertex + axis] : rest[vertex + axis] + (lo + (hi - lo) * t) * cache.quantum * weight;
      }
      position.needsUpdate = true;
      // Preserve authored split normals on the face, hair and limbs. The baked correction
      // is small and local; rebuilding every normal destroys the imported smooth shading.
    }
  }
  /** Call after the normal pose. The chair owns every deform bone while its weight is one. */
  function apply(time: number, weight: number) {
    time = THREE.MathUtils.clamp(time, 0, capture.duration);
    const referenceTime = clock.evaluate(time)[0];
    deform(referenceTime, weight);
    if (weight <= 0) return;
    for (const { value, propertyName, curve, captured } of channels) {
      const sample = curve.evaluate(captured ? time : referenceTime);
      if (propertyName === 'quaternion') (value as THREE.Quaternion).slerp(rotation.fromArray(sample), weight);
      else (value as THREE.Vector3).lerp(vector.fromArray(sample), weight);
    }
    // Root travel is already in the clip. Rebase once so the controller can align the entry stance.
    hips.position.z -= CHAIR_CLIP_ORIGIN / RESIDENT_SCALE * weight;
  }
  return { apply, dispose: () => surfaces.forEach(s => s.geometry.dispose()) };
}
