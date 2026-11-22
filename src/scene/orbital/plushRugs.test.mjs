import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { load } from './load-for-validation.mjs';
import {
  BED_POSITION,
  CAT_HOME,
  FLOOR_SOFA,
  HABITAT_SPAWN,
  LOWER_PLUSH_RUG,
  TRASH_CAN,
  UPPER_PLUSH_RUG,
  isOnHabitatRug,
} from './cabinLayout.ts';
import {
  PLUSH_SHELL_COUNT,
  createPlushRugShellGeometry,
  createPlushRugShellMaterial,
} from './shaders/plushRug.ts';

const LOWER_SPEC = {
  shape: {
    kind: 'rounded-rect',
    halfSize: LOWER_PLUSH_RUG.halfSize,
    cornerRadius: LOWER_PLUSH_RUG.cornerRadius,
  },
  baseY: LOWER_PLUSH_RUG.baseY,
  pileHeight: LOWER_PLUSH_RUG.pileHeight,
  edgeFluff: 0.028,
  tuftFreq: 37.0,
  napLean: 0.026,
  normalStrength: 0.68,
  sheenStrength: 0.38,
  tipLift: 0.30,
  patternMode: 0,
  mainColor: '#527896',
  rootTint: [0.42, 0.40, 0.38],
  tipColor: '#f8f3ea',
  borderColor: '#f4ede2',
  accentColor: '#d9b167',
  borderWidth: 0.165,
  accentWidth: 0.10,
};

const UPPER_SPEC = {
  shape: {
    kind: 'oval',
    radii: UPPER_PLUSH_RUG.radii,
  },
  baseY: UPPER_PLUSH_RUG.baseY,
  pileHeight: UPPER_PLUSH_RUG.pileHeight,
  edgeFluff: 0.032,
  tuftFreq: 31.0,
  napLean: 0.030,
  normalStrength: 0.74,
  sheenStrength: 0.46,
  tipLift: 0.36,
  patternMode: 1,
  mainColor: '#f4ece0',
  rootTint: [0.50, 0.44, 0.37],
  tipColor: '#fffdf8',
};

test('isOnHabitatRug classifies both plush rugs cleanly and excludes neighboring furniture zones', () => {
  // Lower sea-salt plush rug interior & soft corner clipping
  assert.equal(isOnHabitatRug(LOWER_PLUSH_RUG.center[0], LOWER_PLUSH_RUG.center[1]), true);
  assert.equal(isOnHabitatRug(1.45, -0.55), true); // fixed desk chair sits on the lower rug
  assert.equal(isOnHabitatRug(LOWER_PLUSH_RUG.center[0] + LOWER_PLUSH_RUG.halfSize[0] - 0.02, LOWER_PLUSH_RUG.center[1] + LOWER_PLUSH_RUG.halfSize[1] - 0.02), false); // rounded corner cut-out
  assert.equal(isOnHabitatRug(HABITAT_SPAWN[0], HABITAT_SPAWN[1]), false);
  assert.equal(isOnHabitatRug(CAT_HOME[0], CAT_HOME[1]), false);
  assert.equal(isOnHabitatRug(TRASH_CAN.position[0], TRASH_CAN.position[2]), false);

  // Upper bedroom oval lambswool rug interior & exclusions
  assert.equal(isOnHabitatRug(UPPER_PLUSH_RUG.center[0], UPPER_PLUSH_RUG.center[1]), true);
  assert.equal(isOnHabitatRug(-3.90, 0.11), true); // slipper resting zone
  assert.equal(isOnHabitatRug(BED_POSITION[0], BED_POSITION[2]), false);
  assert.equal(isOnHabitatRug(FLOOR_SOFA.position[0], FLOOR_SOFA.position[2]), false);
});

test('plush shell geometry has upward normals, zero degenerate triangles, and valid instanced layers', () => {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const triN = new THREE.Vector3();

  for (const [label, spec] of [['lower', LOWER_SPEC], ['upper', UPPER_SPEC]]) {
    const geom = createPlushRugShellGeometry(spec, PLUSH_SHELL_COUNT);
    const pos = geom.getAttribute('position');
    const edge = geom.getAttribute('aEdgeDist');
    const outward = geom.getAttribute('aOutward');
    const layers = geom.getAttribute('aShellLayer');
    const idx = geom.getIndex();

    assert.ok(pos && edge && outward && layers && idx, `${label}: required attributes exist`);
    assert.equal(layers.count, PLUSH_SHELL_COUNT);
    for (let i = 0; i < layers.count; i++) {
      const h = layers.getX(i);
      assert.ok(h > 0 && h < 1, `${label}: shell layer ${i} out of (0,1): ${h}`);
      if (i > 0) assert.ok(h > layers.getX(i - 1), `${label}: shell layers must strictly increase`);
    }

    let minEdge = Infinity;
    let maxEdge = -Infinity;
    for (let i = 0; i < pos.count; i++) {
      assert.ok(Number.isFinite(pos.getX(i)) && Number.isFinite(pos.getY(i)) && Number.isFinite(pos.getZ(i)));
      minEdge = Math.min(minEdge, edge.getX(i));
      maxEdge = Math.max(maxEdge, edge.getX(i));
    }
    assert.ok(minEdge < -0.02, `${label}: outer fluff skirt must extend past nominal edge (${minEdge})`);
    assert.ok(maxEdge > 0.5, `${label}: center inward distance must be positive (${maxEdge})`);

    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(pos, idx.getX(i));
      b.fromBufferAttribute(pos, idx.getX(i + 1));
      c.fromBufferAttribute(pos, idx.getX(i + 2));
      ab.subVectors(b, a);
      ac.subVectors(c, a);
      triN.crossVectors(ab, ac);
      const area2 = triN.length();
      assert.ok(area2 > 1e-8, `${label}: degenerate triangle at ${i} (2*area=${area2})`);
      assert.ok(triN.y > 0, `${label}: triangle ${i} normal must point upward (+Y), got y=${triN.y}`);
    }

    const mat = createPlushRugShellMaterial(spec);
    assert.equal(mat.customProgramCacheKey(), 'orbital-plush-rug-v1');
    geom.dispose();
    mat.dispose();
  }
});

test('exported open-cabin.glb replaces both flat rugs with sculpted plush rugs while preserving kickable slippers', async () => {
  const { gltf } = await load(new URL('../../../assets/public/models/cabin/open-cabin.glb', import.meta.url));
  gltf.scene.updateMatrixWorld(true);

  const collectMaterials = root => {
    const names = new Set();
    root.traverse(node => {
      if (!node.isMesh) return;
      const list = Array.isArray(node.material) ? node.material : [node.material];
      for (const m of list) if (m?.name) names.add(m.name);
    });
    return names;
  };

  const lower = gltf.scene.getObjectByName('Rugs');
  const upper = gltf.scene.getObjectByName('Rugs_Upper');
  assert.ok(lower && upper, 'Rugs and Rugs_Upper must exist in open-cabin.glb');

  const lowerMats = collectMaterials(lower);
  assert.ok(lowerMats.has('Rug | sea-salt tufted plush'), `lower plush material missing: ${[...lowerMats]}`);
  assert.ok(!lowerMats.has('Rug | sea-salt cotton weave'), 'legacy flatweave cotton material must be removed');
  assert.ok(!lowerMats.has('Rug | ivory cotton fringe'), 'legacy flat fringe material must be removed');

  const upperMats = collectMaterials(upper);
  assert.ok(upperMats.has('Rug | cream lambswool plush'), `upper plush material missing: ${[...upperMats]}`);
  assert.ok(!upperMats.has('Woven oat fibre'), 'legacy upper flat oval rug material must be removed');
  assert.ok(!upperMats.has('Rug weft'), 'legacy braided border material must be removed');

  // Measure the sculpted upper plush rug's own max Y and verify both slipper primitives rest cleanly above it.
  let upperRugMaxY = -Infinity;
  let slipperMinY = Infinity;
  let slipperMeshCount = 0;
  upper.traverse(node => {
    if (!node.isMesh) return;
    const mat = Array.isArray(node.material) ? node.material[0] : node.material;
    if (mat?.name === 'Rug | cream lambswool plush') {
      const box = new THREE.Box3().setFromObject(node);
      upperRugMaxY = Math.max(upperRugMaxY, box.max.y);
    } else if (mat?.name?.startsWith('Slipper')) {
      const box = new THREE.Box3().setFromObject(node);
      slipperMinY = Math.min(slipperMinY, box.min.y);
      slipperMeshCount++;
    }
  });
  assert.ok(upperRugMaxY > 0.010 && upperRugMaxY < 0.013, `upper plush rug base top ${upperRugMaxY} must sit cleanly below slippers`);
  assert.ok(slipperMeshCount >= 6, `expected slipper material primitives in Rugs_Upper, got ${slipperMeshCount}`);
  assert.ok(slipperMinY > upperRugMaxY, `slipper minY=${slipperMinY} must rest cleanly above rug base ${upperRugMaxY}`);
});
