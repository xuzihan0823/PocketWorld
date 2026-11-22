import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import { clone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { load } from '../load-for-validation.mjs';

const moduleCache = new Map();
function loadTs(relPath, extraDeps = {}) {
  const key = `${relPath}:${Object.keys(extraDeps).sort().join(',')}`;
  if (moduleCache.has(key)) return moduleCache.get(key);
  const url = new URL(relPath, import.meta.url);
  const source = readFileSync(url, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText;
  const scope = {
    exports: {},
    URLSearchParams,
    require(name) {
      if (name === 'three') return THREE;
      if (name in extraDeps) return extraDeps[name];
      if (name.startsWith('./') || name.startsWith('../')) {
        const resolved = new URL(name.endsWith('.ts') ? name : `${name}.ts`, url);
        return loadTs(resolved.href, extraDeps);
      }
      throw new Error(`Unexpected require: ${name}`);
    },
  };
  vm.runInNewContext(compiled, scope);
  moduleCache.set(key, scope.exports);
  return scope.exports;
}

const outfitMod = loadTs('./outfit.ts');
const { createResidentRig } = loadTs('../residentRig.ts');
const { createChairAnimation, readSeatContactCache } = loadTs('../chairAnimation.ts');
const { CHAIR_FPS, CHAIR_SIT_FRAMES, CHAIR_SIT_SECONDS } = loadTs('../chairMotion.ts');
const { createIdlePlayer, createIdleState } = loadTs('../standingIdle.ts', {
  'three/examples/jsm/loaders/GLTFLoader.js': { GLTFLoader: class {} },
});
const { sofaPlayer } = loadTs('../sofaMotion.ts', {
  'three/examples/jsm/loaders/GLTFLoader.js': { GLTFLoader: class {} },
});
const { createLibraryPlayer, readLibraryMotion } = loadTs('../library/libraryMotion.ts');
const { applyResidentSkin } = loadTs('../residentSkin.ts');

const hoodieAssetUrl = new URL('../../../../assets/public/models/resident/luna-cloud-hoodie.glb', import.meta.url);
const hoodieSeatUrl = new URL('../../../../assets/public/models/resident/luna-cloud-hoodie-seat.bin', import.meta.url);
const everydayAssetUrl = new URL('../../../../assets/public/models/resident/luna-walk-room.glb', import.meta.url);

const { gltf: hoodieGltf } = await load(hoodieAssetUrl);
const { gltf: everydayGltf } = await load(everydayAssetUrl);
const seatRaw = readFileSync(hoodieSeatUrl);
const seatBuffer = seatRaw.buffer.slice(seatRaw.byteOffset, seatRaw.byteOffset + seatRaw.byteLength);
const seatCache = readSeatContactCache(seatBuffer);

function mountHoodie() {
  const asset = clone(hoodieGltf.scene);
  const walk = hoodieGltf.animations.find(c => c.name === 'Walk_Grounded_Loop');
  const sit = hoodieGltf.animations.find(c => c.name === 'ChairSit_Contact');
  const rig = createResidentRig(asset, walk);
  const chair = createChairAnimation(asset, sit, seatCache);
  const mesh = asset.getObjectByProperty('isSkinnedMesh', true);
  return {
    asset,
    rig,
    chair,
    mesh,
    dispose() {
      chair.dispose();
      rig.dispose();
    },
  };
}

test('wardrobe outfit state parses URL preview, persists to localStorage and toggles cleanly', () => {
  const store = new Map();
  const storage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
  };

  assert.equal(outfitMod.WARDROBE_STORAGE_KEY, 'pocketworld:wardrobe:outfit');
  assert.equal(outfitMod.initialOutfit('', storage), 'everyday');
  assert.equal(outfitMod.previewOutfit('?outfit=hoodie'), 'hoodie');
  assert.equal(outfitMod.previewOutfit('?view=cabin&outfit=cloud-hoodie'), 'hoodie');
  assert.equal(outfitMod.previewOutfit('?outfit=everyday'), 'everyday');
  assert.equal(outfitMod.previewOutfit('?outfit=unknown'), null);

  outfitMod.rememberOutfit('hoodie', storage);
  assert.equal(store.get('pocketworld:wardrobe:outfit'), 'hoodie');
  assert.equal(outfitMod.initialOutfit('', storage), 'hoodie');
  assert.equal(outfitMod.initialOutfit('?outfit=everyday', storage), 'everyday');

  assert.equal(outfitMod.nextOutfit('everyday'), 'hoodie');
  assert.equal(outfitMod.nextOutfit('hoodie'), 'everyday');
  assert.equal(outfitMod.outfitActionHint('everyday'), '换上云朵连帽衫');
  assert.equal(outfitMod.outfitActionHint('hoodie'), '换回日常裙装');
  assert.equal(outfitMod.outfitSwitchedNotice('hoodie'), '已换上云朵连帽衫');
  assert.equal(outfitMod.outfitSwitchedNotice('everyday'), '已换回日常裙装');
  assert.match(outfitMod.outfitErrorNotice('hoodie'), /云朵连帽衫/);
});

test('cloud hoodie GLB matches Luna 115-bone skeleton, clips and seat contact cache', () => {
  const hoodieBones = [];
  const everydayBones = [];
  hoodieGltf.scene.traverse(o => { if (o.isBone) hoodieBones.push(o.name); });
  everydayGltf.scene.traverse(o => { if (o.isBone) everydayBones.push(o.name); });
  assert.equal(hoodieBones.length, 115);
  assert.deepEqual(new Set(hoodieBones), new Set(everydayBones));

  const walk = hoodieGltf.animations.find(c => c.name === 'Walk_Grounded_Loop');
  const sit = hoodieGltf.animations.find(c => c.name === 'ChairSit_Contact');
  assert.ok(walk && walk.duration === 1, 'Walk_Grounded_Loop must be 1 second');
  assert.ok(sit && Math.abs(sit.duration - CHAIR_SIT_SECONDS) < 1e-6, 'ChairSit_Contact duration must match');
  for (const track of sit.tracks) {
    assert.equal(track.times[0], 0, 'ChairSit_Contact tracks must start at time 0');
  }
  assert.equal(seatCache.frames, CHAIR_SIT_FRAMES);
  assert.ok(seatCache.count > 0 && seatCache.count < 5000);
});

test('cloud hoodie flat sock feet plant level on the cabin floor with balanced standing stance', () => {
  const actor = mountHoodie();
  try {
    actor.rig.applyPose(0, 0);
    actor.rig.applyArmCorrectives(true);
    actor.rig.mesh.updateMatrixWorld(true);
    const { asset, mesh } = actor;

    const left = asset.getObjectByName('mixamorigLeftFoot').getWorldPosition(new THREE.Vector3());
    const right = asset.getObjectByName('mixamorigRightFoot').getWorldPosition(new THREE.Vector3());
    assert.ok(left.x - right.x > 0.10, `feet should stay separated (${left.x - right.x})`);

    const min = { Left: Infinity, Right: Infinity };
    const heelMin = { Left: Infinity, Right: Infinity };
    const toeMin = { Left: Infinity, Right: Infinity };
    const indices = mesh.geometry.getAttribute('skinIndex');
    const weights = mesh.geometry.getAttribute('skinWeight');
    const point = new THREE.Vector3();
    const sole = new THREE.Box3();
    for (let i = 0; i < indices.count; i++) {
      mesh.localToWorld(mesh.getVertexPosition(i, point));
      if (point.y < 0.025) sole.expandByPoint(point);
      for (let slot = 0; slot < 4; slot++) {
        if (weights.array[i * 4 + slot] < 0.4) continue;
        const name = mesh.skeleton.bones[indices.array[i * 4 + slot]].name;
        const match = /^mixamorig(Left|Right)(Foot|Toe)/.exec(name);
        if (!match) continue;
        const [, side, part] = match;
        min[side] = Math.min(min[side], point.y);
        if (part === 'Foot') heelMin[side] = Math.min(heelMin[side], point.y);
        else toeMin[side] = Math.min(toeMin[side], point.y);
      }
    }
    for (const side of ['Left', 'Right']) {
      assert.ok(min[side] >= -0.003 && min[side] < 0.008, `${side} sock sole at y=${min[side]}`);
      assert.ok(
        Math.abs(heelMin[side] - toeMin[side]) < 0.012,
        `${side} sock foot should be flat (heel=${heelMin[side]}, toe=${toeMin[side]})`,
      );
    }

    const hip = asset.getObjectByName('mixamorigHips').getWorldPosition(new THREE.Vector3());
    const neck = asset.getObjectByName('mixamorigNeck').getWorldPosition(new THREE.Vector3());
    for (const p of [hip, neck]) {
      assert.ok(p.z > sole.min.z + 0.02 && p.z < sole.max.z - 0.02, 'body projects inside sock sole support');
      assert.ok(p.x > sole.min.x && p.x < sole.max.x, 'body centered between both sock feet');
    }
  } finally {
    actor.dispose();
  }
});

test('LeftArmContact and RightArmContact shape keys compress when arms hang and release independently', () => {
  const actor = mountHoodie();
  try {
    const { rig, mesh } = actor;
    const leftIdx = mesh.morphTargetDictionary?.LeftArmContact;
    const rightIdx = mesh.morphTargetDictionary?.RightArmContact;
    assert.ok(leftIdx !== undefined && rightIdx !== undefined, 'Both arm contact shape keys must exist');

    // Verify morph attributes carry meaningful compression displacements (5mm..60mm in bind units).
    for (const [name, idx] of [['LeftArmContact', leftIdx], ['RightArmContact', rightIdx]]) {
      const attr = mesh.geometry.morphAttributes.position[idx];
      let maxMag = 0;
      let nonZero = 0;
      for (let i = 0; i < attr.count; i++) {
        const mag = Math.hypot(attr.getX(i), attr.getY(i), attr.getZ(i));
        if (mag > 1e-4) nonZero++;
        if (mag > maxMag) maxMag = mag;
      }
      assert.ok(nonZero > 500, `${name} should affect torso/sleeve contact area (${nonZero} verts)`);
      assert.ok(maxMag > 0.005 && maxMag < 0.06, `${name} peak displacement bounded (${maxMag})`);
    }

    // 1. Neutral walk-stop stance engages both shape keys moderately; relaxed standing idle engages strongly.
    const idlePlayer = createIdlePlayer(rig.mesh);
    const idleState = createIdleState(() => 0.5);
    idleState.restWeight = 1;
    rig.applyPose(0, 0);
    rig.mesh.updateMatrixWorld(true);
    rig.applyArmCorrectives(true);
    assert.ok(mesh.morphTargetInfluences[leftIdx] > 0.35 && mesh.morphTargetInfluences[rightIdx] > 0.35);

    rig.applyPose(0, 0, 1);
    idlePlayer(idleState, false);
    rig.mesh.updateMatrixWorld(true);
    rig.applyArmCorrectives(true);
    const restL = mesh.morphTargetInfluences[leftIdx];
    const restR = mesh.morphTargetInfluences[rightIdx];
    assert.ok(restL > 0.7 && restR > 0.7, `relaxed upright standing arms should engage shape keys strongly (L=${restL}, R=${restR})`);

    // 2. Raising the left arm releases LeftArmContact while RightArmContact remains engaged.
    rig.arms[1].upper.rotation.set(-0.9, 0, 0.35);
    rig.applyPose(0, 0, 1);
    idlePlayer(idleState, false);
    rig.mesh.updateMatrixWorld(true);
    rig.applyArmCorrectives(true);
    assert.ok(mesh.morphTargetInfluences[leftIdx] < 0.1, `raised left arm must release LeftArmContact (${mesh.morphTargetInfluences[leftIdx]})`);
    assert.ok(mesh.morphTargetInfluences[rightIdx] > 0.7, `right arm still hanging must stay engaged (${mesh.morphTargetInfluences[rightIdx]})`);

    // 3. Disabling correctives (for chair/sofa/library interactions) zeroes both weights.
    rig.arms[1].upper.rotation.set(0, 0, 0);
    rig.applyPose(0, 0);
    rig.mesh.updateMatrixWorld(true);
    rig.applyArmCorrectives(false);
    assert.equal(mesh.morphTargetInfluences[leftIdx], 0);
    assert.equal(mesh.morphTargetInfluences[rightIdx], 0);
  } finally {
    actor.dispose();
  }
});

test('fitted cloud hoodie clears both flanks through standing and yawn and eases shoulder strain', async () => {
  const { gltf } = await load(new URL('../../../../assets/public/models/resident/luna-yawn.glb', import.meta.url));
  const clip = gltf.animations.find(c => c.name === 'Luna_Yawn');
  const { rig, mesh, dispose } = mountHoodie();
  const { position, skinIndex, skinWeight } = mesh.geometry.attributes;
  const normals = mesh.geometry.morphAttributes.normal;
  assert.equal(normals.length, mesh.morphTargetInfluences.length);
  for (const target of normals) {
    assert.equal(target.count, position.count);
    const delta = new THREE.Vector3();
    let affected = 0;
    for (let i = 0; i < position.count; i++) {
      const length = delta.fromBufferAttribute(target, i).length();
      assert.ok(Number.isFinite(length) && length <= 2.001);
      if (length === 0) continue;
      affected++;
      assert.ok(position.getY(i) > .47 && position.getY(i) < .793 && Math.abs(position.getX(i)) < .234);
    }
    assert.ok(affected > 0, 'morph normals must follow the cloth correction without changing the face');
  }
  const indices = mesh.geometry.index.array, names = mesh.skeleton.bones.map(bone => bone.name);
  const groups = [[], [], [], []], label = [], arm = [], edges = new Map();
  for (let i = 0; i < position.count; i++) {
    const scores = [0, 0, 0];
    for (let k = 0; k < 4; k++) {
      const bone = names[skinIndex.getComponent(i, k)], w = skinWeight.getComponent(i, k);
      if (/Left(?:Arm|ForeArm|Shoulder)$/.test(bone)) scores[0] += w;
      if (/Right(?:Arm|ForeArm|Shoulder)$/.test(bone)) scores[1] += w;
      if (/Spine\d?$|Hips$/.test(bone)) scores[2] += w;
    }
    label.push(scores.findIndex(w => w > .9) + 1);
    arm.push(Math.max(scores[0], scores[1]));
  }
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  for (let i = 0; i < indices.length; i += 3) {
    const tri = Array.from(indices.subarray(i, i + 3));
    const y = tri.reduce((sum, id) => sum + position.getY(id), 0) / 3;
    const part = label[tri[0]];
    // Only the disjoint surfaces below the shared armhole seam should never overlap.
    if (y >= .488 && y < .633 && part && tri.every(id => label[id] === part)) groups[part].push(...tri);
    if (y > .61 && y < .75) for (let k = 0; k < 3; k++) {
      const [a, b] = [tri[k], tri[(k + 1) % 3]].sort((x, y) => x - y);
      if (Math.abs(arm[a] - arm[b]) < .04) continue;
      const rest = p.fromBufferAttribute(position, a).distanceTo(q.fromBufferAttribute(position, b));
      if (rest >= .0015) edges.set(a * position.count + b, { a, b, rest });
    }
  }
  assert.ok(groups.slice(1).every(group => group.length > 1000) && edges.size > 1000);
  const posed = position.clone();
  const geoms = groups.slice(1).map(group => new THREE.BufferGeometry().setAttribute('position', posed).setIndex(group.slice()));
  const bvhs = geoms.map(geometry => new MeshBVH(geometry));
  const identity = new THREE.Matrix4();
  const player = createIdlePlayer(rig.mesh, clip);
  const idle = createIdleState(() => .5);
  const smooth = THREE.MathUtils.smoothstep;
  const stretch = Object.entries(mesh.morphTargetDictionary)
    .filter(([name]) => name.startsWith('HoodieStretch_')).map(([, index]) => index);
  assert.ok(stretch.length > 0);
  try {
    for (const [phase, time] of [
      ...Array.from({ length: 20 }, (_, i) => [i * .6, -1]),
      ...Array.from({ length: 84 }, (_, i) => [0, i * .1]),
    ]) {
      const yawnWeight = smooth(time, 0, .85) * smooth(clip.duration - time, 0, .85);
      rig.applyPose(0, 0, 1);
      player({ ...idle, phase, weight: 1, restWeight: 1, yawnTime: time, yawnWeight });
      rig.applyArmCorrectives(true, time, yawnWeight);
      rig.mesh.updateMatrixWorld(true);
      for (let i = 0; i < position.count; i++) mesh.getVertexPosition(i, p).toArray(posed.array, 3 * i);
      bvhs.forEach(tree => tree.refit());
      for (const sleeve of bvhs.slice(0, 2)) {
        assert.equal(sleeve.bvhcast(bvhs[2], identity, { intersectsTriangles: (a, b) => a.intersectsTriangle(b) }),
          false, `sleeve/flank contact at phase ${phase}, yawn ${time}`);
      }
      if (time >= 4 && time < 7) {
        assert.ok(stretch.some(index => mesh.morphTargetInfluences[index] > 0));
        const ratios = [...edges.values()].map(({ a, b, rest }) =>
          p.fromBufferAttribute(posed, a).distanceTo(q.fromBufferAttribute(posed, b)) / rest).sort((a, b) => a - b);
        assert.ok(ratios[Math.floor(.95 * ratios.length)] < 3.8, `armhole strain at ${time}`);
      }
    }
    // Measure the finished silhouette in mesh-local metres. Comparing only
    // the change between two morph weights allowed a permanently pinched waist.
    const waist = Array.from({ length: position.count }, (_, i) => i).filter(i =>
      label[i] === 3 && Math.abs(position.getY(i) - .61) < .01);
    assert.ok(waist.length > 100);
    for (const time of [-1, 5.2, 6.85]) {
      const active = time < 0 ? 0 : 1;
      rig.applyPose(0, 0, 1);
      player({ ...idle, restWeight: 1, weight: 1, yawnTime: time, yawnWeight: active });
      rig.applyArmCorrectives(true, time, active);
      rig.mesh.updateMatrixWorld(true);
      const x = waist.map(i => mesh.getVertexPosition(i, p).x).sort((a, b) => a - b);
      const width = x[Math.floor(.975 * x.length)] - x[Math.floor(.025 * x.length)];
      assert.ok(width > .14, `waist below the armhole at ${time}s is only ${width} m wide`);
    }
    rig.applyArmCorrectives(false, 5.2, 1);
    assert.ok(mesh.morphTargetInfluences.every(weight => weight === 0));
  } finally {
    geoms.forEach(geometry => geometry.dispose());
    dispose();
  }
});

test('cloud hoodie binds cleanly with chair sit, floor sofa, standing idle, library animations and skin shader', async () => {
  const [yawn, look, sofa, library] = await Promise.all([
    load(new URL('../../../../assets/public/models/resident/luna-yawn.glb', import.meta.url)),
    load(new URL('../../../../assets/public/models/resident/luna-looking-around.glb', import.meta.url)),
    load(new URL('../../../../assets/public/models/resident/luna-sofa-low-sit.glb', import.meta.url)),
    load(new URL('../../../../assets/public/models/resident/luna-library.glb', import.meta.url)),
  ]);

  const actor = mountHoodie();
  const root = new THREE.Group();
  root.add(actor.rig.mesh);
  const v = new THREE.Vector3();
  const checkFinite = label => {
    root.updateMatrixWorld(true);
    actor.mesh.skeleton.update();
    for (let i = 0; i < actor.mesh.geometry.attributes.position.count; i += 97) {
      actor.mesh.getVertexPosition(i, v);
      assert.ok(v.toArray().every(Number.isFinite), `${label} vertex ${i} non-finite`);
    }
  };

  try {
    // Shipped GLB JSON must share baseColorTexture as emissiveTexture so applyResidentSkin activates in WebGL.
    const rawGlb = readFileSync(hoodieAssetUrl);
    const jsonLen = rawGlb.readUInt32LE(12);
    const glbDoc = JSON.parse(rawGlb.subarray(20, 20 + jsonLen).toString('utf8'));
    const mat = glbDoc.materials?.[0];
    assert.ok(mat, 'shipped GLB must define a material');
    assert.equal(
      mat.emissiveTexture?.index,
      mat.pbrMetallicRoughness?.baseColorTexture?.index,
      'emissiveTexture must reuse baseColorTexture for residentSkin',
    );
    assert.equal(mat.pbrMetallicRoughness?.metallicFactor, 0, 'matte fleece hoodie must have metallicFactor 0');

    // Skin tint hook attaches when map === emissiveMap (as loaded in browser) and restores cleanly.
    const originalMat = actor.mesh.material;
    const sharedTex = new THREE.Texture();
    originalMat.map = sharedTex;
    originalMat.emissiveMap = sharedTex;
    const restoreSkin = applyResidentSkin(actor.rig.mesh);
    assert.notEqual(actor.mesh.material, originalMat, 'applyResidentSkin should wrap hoodie material');
    restoreSkin();
    assert.equal(actor.mesh.material, originalMat, 'restoreSkin must restore original material');
    sharedTex.dispose();

    // Chair sit + pre-skin contact cache.
    const restPos = new Float32Array(actor.mesh.geometry.attributes.position.array);
    actor.rig.applyPose(0, 0);
    actor.chair.apply(CHAIR_SIT_SECONDS, 1);
    assert.notDeepEqual(actor.mesh.geometry.attributes.position.array, restPos, 'seat cache should deform seated hoodie');
    checkFinite('chair-sit');
    actor.chair.apply(0, 0);
    assert.deepEqual(actor.mesh.geometry.attributes.position.array, restPos, 'seat cache should release cleanly');

    // Standing idle + yawn + looking around.
    const idlePlayer = createIdlePlayer(
      actor.rig.mesh,
      yawn.gltf.animations[0],
      look.gltf.animations[0],
    );
    const idleState = createIdleState(() => 0.5);
    idleState.weight = 1;
    idleState.restWeight = 1;
    idleState.yawnTime = 1.2;
    idleState.yawnWeight = 1;
    actor.rig.applyPose(0, 0);
    idlePlayer(idleState, true);
    checkFinite('idle-yawn');

    // Floor sofa sit.
    const sofaClip = sofa.gltf.animations.find(c => c.name === 'Luna_CMU_75_20');
    const applySofa = sofaPlayer(actor.rig.mesh, sofaClip);
    actor.rig.applyPose(0, 0);
    applySofa(sofaClip.duration * 0.75);
    checkFinite('sofa-sit');

    // Library book motion.
    const libMotion = readLibraryMotion(library.gltf.animations);
    const applyLib = createLibraryPlayer(actor.rig.mesh, libMotion);
    actor.rig.applyPose(0, 0);
    applyLib({ id: 'test-book', slotId: 's0-0' }, { progress: 0.4, weight: 1 });
    checkFinite('library-reach');
  } finally {
    actor.dispose();
  }
});
