import { BufferAttribute, DynamicDrawUsage, MathUtils, Matrix4, Mesh, Quaternion, SkinnedMesh, Vector3, type BufferGeometry, type Object3D } from 'three';
import { slotFor } from './catalog';
import type { LibrarySample } from './libraryMotion';
import type { LibraryFlow } from './useLibrary';

const { smoothstep } = MathUtils;
const trunkJoints = new Set(['mixamorigSpine1', 'mixamorigSpine2', 'mixamorigNeck', 'mixamorigRightShoulder']);

export function topShelfSleeveProgress(flow: LibraryFlow | undefined, sample: LibrarySample | null) {
  if (!sample || !flow?.book || slotFor(flow.book).row !== 2) return 0;
  return sample.progress;
}

/** Fit both transitions of the raised sleeve, keeping each ring's bone blend consistent. */
export function createCardiganBookSleeve(asset: Object3D) {
  const surface = asset.getObjectByName('Luna_Cardigan_Surface');
  if (!(surface instanceof SkinnedMesh)) return undefined;
  const original: BufferGeometry = surface.geometry;
  const { position, skinIndex, skinWeight } = original.attributes;
  const { bones, boneInverses } = surface.skeleton;
  const upper = bones.findIndex(bone => bone.name === 'mixamorigRightArm');
  const elbow = bones.findIndex(bone => bone.name === 'mixamorigRightForeArm');
  const hand = bones.findIndex(bone => bone.name === 'mixamorigRightHand');
  if (upper < 0 || elbow < 0 || hand < 0) return undefined;
  const bind = (id: number) => new Vector3().setFromMatrixPosition(boneInverses[id].clone().invert());
  const shoulder = bind(upper), bend = bind(elbow);
  const axis = bend.clone().sub(shoulder), forearm = bind(hand).sub(bend);
  const point = new Vector3(), relative = new Vector3();
  const isTrunk = bones.map(bone => trunkJoints.has(bone.name));
  const allowed = bones.map((_, id) => isTrunk[id] || id === upper || id === elbow || id === hand);
  const edits: { vertex: number; indices: number[]; baseIndices: number[]; base: number[]; target: number[]; blend: number }[] = [];
  for (let vertex = 0; vertex < position.count; vertex++) {
    const baseIndices = Array.from({ length: 4 }, (_, slot) => skinIndex.getComponent(vertex, slot));
    const base = Array.from({ length: 4 }, (_, slot) => skinWeight.getComponent(vertex, slot));
    let arm = 0, outside = 0, trunk = 0;
    baseIndices.forEach((id, slot) => {
      if (id === upper || id === elbow || id === hand) arm += base[slot];
      if (!allowed[id]) outside += base[slot];
      if (isTrunk[id]) trunk += base[slot];
    });
    if (arm < .02 || outside > .001) continue;
    point.fromBufferAttribute(position, vertex).applyMatrix4(surface.bindMatrix);
    relative.copy(point).sub(shoulder);
    const along = relative.dot(axis) / axis.lengthSq();
    const lowerAlong = point.sub(bend).dot(forearm) / forearm.lengthSq();
    if (relative.addScaledVector(axis, -along).length() > .06 || along <= .10 || lowerAlong >= .90) continue;
    const blend = smoothstep(along, .10, .30) * (1 - smoothstep(lowerAlong, .65, .90));
    const u = smoothstep(along, .12, .50), l = smoothstep(along, .65, 1.80);
    const total = trunk + baseIndices.reduce((sum, id, slot) => sum + (id === upper || id === elbow ? base[slot] : 0), 0);
    const indices = baseIndices.slice();
    let upperSlot = indices.indexOf(upper), lowerSlot = indices.indexOf(elbow);
    // The elbow rings already have both bones. On the forearm, use an empty slot for the upper bone.
    if (upperSlot < 0 && total * (1 - l) > 0) {
      upperSlot = base.findIndex((weight, slot) => weight === 0 && slot !== lowerSlot);
      if (upperSlot >= 0) indices[upperSlot] = upper;
    }
    if (lowerSlot < 0 && total * l > 0) {
      lowerSlot = base.findIndex((weight, slot) => weight === 0 && slot !== upperSlot);
      if (lowerSlot >= 0) indices[lowerSlot] = elbow;
    }
    if ((upperSlot < 0 && l < 1) || (lowerSlot < 0 && l > 0)) continue;
    const target = indices.map((id, slot) => slot === upperSlot ? total * (trunk > 0 ? u : 1) * (1 - l)
      : slot === lowerSlot ? total * l
        : isTrunk[id] && trunk > 0 ? base[slot] / trunk * total * (1 - u) * (1 - l) : base[slot]);
    if (target.some((weight, slot) => Math.abs(weight - base[slot]) > 1e-7)) edits.push({ vertex, indices, baseIndices, base, target, blend });
  }
  let owned: BufferGeometry | undefined;
  const volume = createSleeveVolume(surface, edits.map(edit => ({ vertex: edit.vertex, blend: edit.blend })));
  let previous = 0;
  return {
    apply(progress: number) {
      // This is the full baked clock: reach occupies 0..0.4; return follows the same clock backwards.
      const weight = smoothstep(progress, .04, .10) * (1 - smoothstep(progress, .60, .88));
      if (weight === 0 && previous === 0) return;
      if (surface.geometry === original) {
        owned = original.clone();
        for (const name of ['skinWeight', 'skinIndex', 'position', 'normal']) {
          const attribute = owned.getAttribute(name);
          if (attribute instanceof BufferAttribute) attribute.setUsage(DynamicDrawUsage);
        }
        surface.geometry = owned;
      }
      const weights = surface.geometry.getAttribute('skinWeight'), indices = surface.geometry.getAttribute('skinIndex');
      for (const edit of edits) for (let slot = 0; slot < 4; slot++) {
        indices.setComponent(edit.vertex, slot, weight > 0 ? edit.indices[slot] : edit.baseIndices[slot]);
        weights.setComponent(edit.vertex, slot, edit.base[slot] + weight * edit.blend * (edit.target[slot] - edit.base[slot]));
      }
      weights.needsUpdate = true;
      indices.needsUpdate = true;
      volume(weight);
      previous = weight;
    },
    dispose: () => owned?.dispose(),
  };
}

/** Compensate linear-skin volume loss before the usual GPU skin pass, for this sleeve only. */
function createSleeveVolume(surface: SkinnedMesh, vertices: { vertex: number; blend: number }[]) {
  const original = surface.geometry.attributes;
  const samples = vertices.map(({ vertex, blend }) => ({ vertex, blend,
    rest: new Vector3().fromBufferAttribute(original.position, vertex),
    normal: new Vector3().fromBufferAttribute(original.normal, vertex),
  }));
  const { bones, boneInverses } = surface.skeleton;
  const transforms = bones.map(() => new Matrix4());
  const rotations = bones.map(() => new Quaternion());
  const duals = bones.map(() => new Quaternion());
  const affecting = new Set(vertices.flatMap(({ vertex }) => Array.from({ length: 4 }, (_, k) => original.skinIndex.getComponent(vertex, k))));
  // Empty slots may be assigned to either arm bone by the fit.
  bones.forEach((bone, id) => { if (/^mixamorigRight(?:Arm|ForeArm)$/.test(bone.name)) affecting.add(id); });
  const rotationMatrix = new Matrix4(), linear = new Matrix4(), inverse = new Matrix4();
  const real = new Quaternion(), dual = new Quaternion(), translation = new Vector3();
  const morphed = new Vector3(), morphDelta = new Vector3(), result = new Vector3(), normal = new Vector3();
  return (weight: number) => {
    const { position, normal: normals, skinIndex, skinWeight } = surface.geometry.attributes;
    // Each pose starts from bind data, so reverse playback and random seeks do not accumulate errors.
    for (const sample of samples) {
      position.setXYZ(sample.vertex, sample.rest.x, sample.rest.y, sample.rest.z);
      normals.setXYZ(sample.vertex, sample.normal.x, sample.normal.y, sample.normal.z);
    }
    if (weight > 0) {
      surface.skeleton.bones[0].updateWorldMatrix(true, true);
      surface.updateWorldMatrix(true, false);
      surface.updateMatrixWorld(true);
      for (const id of affecting) {
        const matrix = transforms[id].copy(surface.bindMatrixInverse).multiply(bones[id].matrixWorld)
          .multiply(boneInverses[id]).multiply(surface.bindMatrix);
        const rotation = rotations[id].setFromRotationMatrix(rotationMatrix.extractRotation(matrix)).normalize();
        translation.setFromMatrixPosition(matrix);
        duals[id].set(translation.x, translation.y, translation.z, 0).multiply(rotation);
      }
      for (const sample of samples) {
        const { vertex } = sample;
        let strongest = 0;
        for (let k = 1; k < 4; k++) if (skinWeight.getComponent(vertex, k) > skinWeight.getComponent(vertex, strongest)) strongest = k;
        const reference = rotations[skinIndex.getComponent(vertex, strongest)];
        let x = 0, y = 0, z = 0, w = 0, dx = 0, dy = 0, dz = 0, dw = 0;
        linear.elements.fill(0);
        for (let k = 0; k < 4; k++) {
          const id = skinIndex.getComponent(vertex, k), influence = skinWeight.getComponent(vertex, k);
          if (influence === 0) continue;
          const q = rotations[id], d = duals[id], signed = q.dot(reference) < 0 ? -influence : influence;
          x += signed * q.x; y += signed * q.y; z += signed * q.z; w += signed * q.w;
          dx += signed * d.x; dy += signed * d.y; dz += signed * d.z; dw += signed * d.w;
          for (let j = 0; j < 16; j++) linear.elements[j] += influence * transforms[id].elements[j];
        }
        const length = Math.hypot(x, y, z, w);
        if (length < 1e-6 || Math.abs(linear.determinant()) < 1e-8) continue;
        real.set(x / length, y / length, z / length, w / length);
        dual.set(dx / length, dy / length, dz / length, dw / length);
        Mesh.prototype.getVertexPosition.call(surface, vertex, morphed);
        morphDelta.copy(morphed).sub(sample.rest);
        result.copy(morphed).applyQuaternion(real);
        normal.copy(sample.normal).applyQuaternion(real);
        real.conjugate();
        dual.multiply(real);
        result.add(translation.set(dual.x, dual.y, dual.z));
        inverse.copy(linear).invert();
        result.applyMatrix4(inverse).sub(morphDelta);
        const amount = weight * sample.blend;
        result.lerpVectors(sample.rest, result, amount);
        normal.transformDirection(inverse).lerp(sample.normal, 1 - amount).normalize();
        position.setXYZ(vertex, result.x, result.y, result.z);
        normals.setXYZ(vertex, normal.x, normal.y, normal.z);
      }
    }
    position.needsUpdate = true;
    normals.needsUpdate = true;
  };
}
