import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Euler, MathUtils, Matrix4, Quaternion, Vector3 } from 'three';
import { load } from '../src/scene/orbital/load-for-validation.mjs';
import { CABIN_IDLE_OFFSETS } from '../src/scene/orbital/cabinActions.ts';
import { createResidentRig } from '../src/scene/orbital/residentRig.ts';

const [directory, outfit = 'everyday'] = process.argv.slice(2);
const models = new Map([
  ['everyday', 'luna-walk-room.glb'],
  ['cardigan', 'luna-cardigan.glb'],
]);
const model = models.get(outfit);
if (!directory || !model) throw new Error('Usage: node scripts/bake-luna-cabin-actions.mjs <MotionSmith folder> [everyday|cardigan]');

const takes = {
  floorSit: 'sit_floor_take2',
  floorStand: 'stand_up_floor_take1',
  pickUp: 'pick_up_take1',
  rubEye: 'rub_eye_take1',
  think: 'thinking_take1',
  reachHigh: 'reach_high_take1',
  shiftWeight: 'idle_feminine_take1',
  stretchNeck: 'idle_neck_stretch_take2',
  sofaDoze: 'seated_dozing_idle_take1',
  chairGlance: 'sit_chair_idle_take5',
  floorGlance: 'sit_floor_idle_take1',
};
const body = new Map([
  ['Hips', 'pelvis'], ['Spine', 'spine_01'], ['Spine1', 'spine_03'], ['Spine2', 'spine_05'],
  ['Neck', 'neck_01'], ['Head', 'head'],
]);
const next = new Map([['Hips', 'Spine'], ['Spine', 'Spine1'], ['Spine1', 'Spine2'], ['Spine2', 'Neck'], ['Neck', 'Head']]);
for (const [side, suffix] of [['Left', 'l'], ['Right', 'r']]) {
  for (const [[target, source], following] of [
    [['Shoulder', 'clavicle'], 'Arm'], [['Arm', 'upperarm'], 'ForeArm'], [['ForeArm', 'lowerarm'], 'Hand'],
    [['Hand', 'hand'], 'HandMiddle1'], [['UpLeg', 'thigh'], 'Leg'], [['Leg', 'calf'], 'Foot'],
    [['Foot', 'foot'], 'ToeBase'], [['ToeBase', 'ball'], null],
  ]) {
    body.set(side + target, source + '_' + suffix);
    if (following) next.set(side + target, side + following);
  }
  for (const [a, b] of [['Thumb', 'thumb'], ['Index', 'index'], ['Middle', 'middle'], ['Ring', 'ring'], ['Pinky', 'pinky']]) {
    for (let segment = 1; segment <= 3; segment++) {
      body.set(side + 'Hand' + a + segment, b + '_0' + segment + '_' + suffix);
      if (segment < 3) next.set(side + 'Hand' + a + segment, side + 'Hand' + a + (segment + 1));
    }
  }
}
const upper = /^(?:Spine|Neck|Head)|Shoulder|Arm|Hand/;
const offsetMask = {
  stretchNeck: /^(?:Spine2|Neck|Head)$/,
  sofaDoze: /^(?:Spine|Spine1|Spine2|Neck|Head)$/,
  chairGlance: /^(?:Neck|Head)$/,
  floorGlance: /^(?:Spine2|Neck|Head)$/,
};
const point = bone => bone.getWorldPosition(new Vector3());
const rotation = bone => bone.getWorldQuaternion(new Quaternion());
const direction = (from, to) => point(to).sub(point(from)).normalize();

function basis(axis, across) {
  const x = axis.clone().normalize();
  const y = across.clone().addScaledVector(x, -across.dot(x)).normalize();
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(x, y, x.clone().cross(y)));
}

function alignment(name, from, bind, source) {
  const child = next.get(name);
  if (!child) return new Quaternion();
  const targetAxis = bind.get(child).point.clone().sub(bind.get(name).point).normalize();
  const sourceAxis = direction(from, source.get(child));
  if (/^(Left|Right)Hand$/.test(name)) {
    const sourceSpan = point(source.get(name + 'Index1')).sub(point(source.get(name + 'Pinky1')));
    const targetSpan = bind.get(name + 'Index1').point.clone().sub(bind.get(name + 'Pinky1').point);
    return basis(sourceAxis, sourceSpan).multiply(basis(targetAxis, targetSpan).invert());
  }
  if (/^(Left|Right)Foot$/.test(name)) {
    const up = new Vector3(0, 1, 0);
    return basis(sourceAxis, up).multiply(basis(targetAxis, up).invert());
  }
  return new Quaternion().setFromUnitVectors(targetAxis, sourceAxis);
}

function worldQuaternion(joint, q) {
  joint.quaternion.copy(rotation(joint.parent).invert()).multiply(q).normalize();
}
function aim(joint, from, to, desired) {
  const actual = point(to).sub(point(from)).normalize();
  worldQuaternion(joint, new Quaternion().setFromUnitVectors(actual, desired.normalize()).multiply(rotation(joint)));
}

function moveEnd(shoulder, elbow, wrist, target) {
  const goal = target.clone().sub(point(shoulder));
  const upper = point(shoulder).distanceTo(point(elbow)), lower = point(elbow).distanceTo(point(wrist));
  const reach = MathUtils.clamp(goal.length(), Math.abs(upper - lower) + .001, upper + lower - .001);
  const axis = goal.normalize(), start = point(shoulder);
  const pole = point(elbow).sub(start);
  pole.addScaledVector(axis, -pole.dot(axis)).normalize();
  const along = (upper ** 2 + reach ** 2 - lower ** 2) / (2 * reach);
  const bent = start.clone().addScaledVector(axis, along).addScaledVector(pole, Math.sqrt(Math.max(0, upper ** 2 - along ** 2)));
  const wristRotation = rotation(wrist);
  aim(shoulder, shoulder, elbow, bent.sub(start));
  aim(elbow, elbow, wrist, start.addScaledVector(axis, reach).sub(point(elbow)));
  worldQuaternion(wrist, wristRotation);
}

// Fit each three-joint panel to the lap in room coordinates. The middle of the
// front hem sags between the knees while each outside pleat clears its own knee.
function drapeCrossedLap(panels, leftKnee, rightKnee, weight) {
  for (const panel of panels) {
    const { joints, side, front, back } = panel;
    const root = point(joints[0].joint);
    const knee = side > 0 ? leftKnee : side < 0 ? rightKnee : leftKnee.clone().lerp(rightKnee, .5);
    let rim, overhang;
    if (front) {
      const height = side ? .030 : -.002;
      rim = knee.clone().add(new Vector3(side * .012, height, .019));
      overhang = new Vector3(side * .16, side ? -.76 : -.94, .50);
    } else if (back) {
      rim = root.clone().add(new Vector3(side * .145, 0, side ? -.152 : -.206));
      rim.y = .082;
      overhang = new Vector3(side * .68, -.16, side ? -.72 : -1);
    } else {
      rim = knee.clone().add(new Vector3(side * .078, -.072, -.085));
      overhang = new Vector3(side * .42, -.91, .10);
    }
    const middle = root.clone().lerp(rim, .5);
    middle.y += front ? .016 : back ? .008 : .040;
    const curve = [root, middle, rim];
    for (const [i, { joint, bindRotation, bindAxis }] of joints.entries()) {
      if (i > 0) joint.position.lerp(joint.parent.worldToLocal(curve[i].clone()), weight);
      const tangent = i === 2 ? overhang : curve[i + 1].clone().sub(curve[i]);
      const oriented = new Quaternion().setFromUnitVectors(bindAxis, tangent.normalize()).multiply(bindRotation);
      worldQuaternion(joint, rotation(joint).slerp(oriented, weight));
    }
  }
}

function skinContactVertices(rig, matches, stride = 4) {
  const contact = [];
  const v = new Vector3();
  rig.mesh.traverse(surface => {
    if (!surface.isSkinnedMesh) return;
    const indices = surface.geometry.getAttribute('skinIndex'), weights = surface.geometry.getAttribute('skinWeight');
    const vertices = [];
    for (let i = 0; i < indices.count; i += stride) {
      const bone = surface.skeleton.bones[indices.getX(i)];
      if (weights.getX(i) <= .22 || !matches(bone.name, surface)) continue;
      vertices.push(i);
    }
    contact.push({ surface, vertices });
  });
  return () => {
    rig.mesh.updateMatrixWorld(true);
    let floor = Infinity;
    for (const { surface, vertices } of contact) {
      surface.skeleton.update();
      for (const i of vertices) {
        surface.getVertexPosition(i, v).applyMatrix4(surface.matrixWorld);
        floor = Math.min(floor, v.y);
      }
    }
    return floor;
  };
}

function fitHairAboveRug({ joints, lowest, axis }) {
  // Leave room for the head turn while seated. Sweep the long strands
  // behind and outward, using the rendered tips to set the amount of bend.
  const clearance = .033;
  if (lowest() >= clearance) return;
  const base = joints.map(joint => joint.quaternion.clone());
  const swing = new Quaternion();
  const setBend = amount => {
    joints.forEach((joint, i) => {
      joint.quaternion.copy(base[i]);
      worldQuaternion(joint, swing.setFromAxisAngle(axis, amount * (i === 0 ? .72 : .54)).multiply(rotation(joint)));
    });
  };
  let lo = 0, hi = 1;
  for (let i = 0; i < 8; i++) {
    const mid = (lo + hi) / 2;
    setBend(mid);
    if (lowest() >= clearance) hi = mid;
    else lo = mid;
  }
  setBend(hi);
}

const loadSourceClips = () => Promise.all(Object.entries(takes).map(async ([name, take]) => {
  const data = await load(resolve(directory, 'MotionSmith_' + take + '.glb'));
  if (data.gltf.animations[0]?.name !== take) throw new Error('Unexpected MotionSmith take ' + take);
  return [name, data];
}));

async function bake(outfit, file) {
  const { gltf } = await load(new URL('../assets/public/models/resident/' + file, import.meta.url));
  const target = new Map([...body.keys()].map(name => [name, gltf.scene.getObjectByName('mixamorig' + name)]));
  const bind = new Map([...target].map(([name, joint]) => [name, { rotation: rotation(joint), point: point(joint) }]));
  const cardigan = outfit === 'cardigan';
  const rig = createResidentRig(gltf.scene, gltf.animations.find(a => a.name === 'Walk_Grounded_Loop'), cardigan);
  rig.applyPose(0, 0);
  rig.mesh.updateMatrixWorld(true);
  const hips = target.get('Hips'), neutralHips = point(hips);
  const floorAtPose = skinContactVertices(rig, name => /Foot|Toe|UpLeg|Hand/.test(name)
    || cardigan && name === 'mixamorigHips');
  const soles = ['Left', 'Right'].map(side => skinContactVertices(rig,
    name => name.startsWith('mixamorig' + side) && /Foot|Toe/.test(name)));
  const hipContact = skinContactVertices(rig, name => name === 'mixamorigHips');
  const neutralFloor = floorAtPose();
  const hipParent = hips.parent;
  const seatedHair = cardigan ? [['L', 1], ['R', -1]].map(([side, sign]) => {
    const prefix = 'Hair_Front_' + side + '_';
    return {
      joints: [1, 2].map(index => rig.mesh.getObjectByName(prefix + '0' + index)),
      lowest: skinContactVertices(rig, name => name.startsWith(prefix), 1),
      axis: new Vector3(1, 0, sign * .42).normalize(),
    };
  }) : [];
  const dress = [];
  rig.mesh.traverse(joint => {
    // The cardigan hem is skinned directly to the hips and thighs.
    if (cardigan || !joint.isBone || !/^Dress_.+_0[123]$/.test(joint.name)) return;
    const child = joint.children.find(value => value.isBone && value.name.startsWith('Dress_'));
    const forward = child ? direction(joint, child) : direction(joint.parent, joint);
    const axis = forward.clone().applyQuaternion(rotation(joint).invert());
    dress.push({ joint, child, axis, bindRotation: rotation(joint), bindAxis: forward });
  });
  const panels = dress.filter(({ joint }) => joint.name.endsWith('_01')).map(({ joint }) => {
    const prefix = joint.name.slice(0, -2);
    return {
      joints: dress.filter(entry => entry.joint.name.slice(0, -2) === prefix).sort((a, b) => a.joint.name.localeCompare(b.joint.name)),
      side: /_(L|Left)_/.test(prefix) ? 1 : /_(R|Right)_/.test(prefix) ? -1 : 0,
      front: prefix.includes('Front'), back: prefix.includes('Back'),
    };
  });
  const legLength = (a, b, c) => a.distanceTo(b) + b.distanceTo(c);
  const fittedLength = legLength(point(target.get('RightUpLeg')), point(target.get('RightLeg')), point(target.get('RightFoot')));
  const clips = [];
  for (const [name, data] of await loadSourceClips()) {
    rig.applyPose(0, 0);
    const source = new Map([...body].map(([joint, b]) => [joint, data.gltf.scene.getObjectByName(b)]));
    const delta = new Map();
    for (const [key, joint] of source) {
      if (!joint || !target.get(key)) throw new Error('Unmapped ' + key + ' for ' + name + '/' + outfit);
      // Match both bones in the common Y-up, +Z-forward frame. The alignment is
      // folded into the constant so each sample can retain source limb twist.
      const saved = bind.get(key);
      const a = alignment(key, joint, bind, source);
      delta.set(key, rotation(joint).invert().multiply(a).multiply(saved.rotation));
    }
    const ratio = fittedLength / legLength(point(source.get('RightUpLeg')), point(source.get('RightLeg')), point(source.get('RightFoot')));
    const duration = data.gltf.animations[0].duration;
    const offsetIdle = CABIN_IDLE_OFFSETS.includes(name);
    const sampleRate = offsetIdle ? 15 : 30;
    const frameCount = Math.round(duration * sampleRate) + 1;
    const timeAt = frame => offsetIdle ? frame * duration / (frameCount - 1) : frame / sampleRate;
    const upperOnly = offsetIdle || ['rubEye', 'think', 'reachHigh', 'shiftWeight'].includes(name);
    const sourceBind = new Map(['Head', 'Spine2'].map(key => [key, rotation(source.get(key)).invert()]));
    const seated = name === 'floorSit' || name === 'floorStand';
    data.sample(name === 'floorStand' ? duration : 0);
    const sourceAnchor = point(source.get('Hips'));
    const sampleBones = [...target].filter(([key]) => !upperOnly
      || (offsetMask[name] ?? (name === 'shiftWeight' ? /^(?:Spine|Neck|Head|Left(?:Shoulder|Arm|ForeArm|Hand))/ : upper)).test(key));
    const firstRotation = new Map((offsetIdle ? sampleBones : []).map(([key]) => [key, source.get(key).quaternion.clone().invert()]));
    const authoredYaw = key => new Euler().setFromQuaternion(
      rotation(source.get(key)).multiply(sourceBind.get(key)), 'YXZ',
    ).y;
    // These authored seated takes mostly hold a gaze. Ease from Luna's seat
    // pose toward the source's head direction, preserving its smaller motion.
    const gazeYaw = ['chairGlance', 'floorGlance'].includes(name) ? authoredYaw('Head') - authoredYaw('Spine2') : 0;
    const bias = new Map((offsetIdle ? sampleBones : []).map(([key, joint]) => {
      const inverse = rotation(joint).invert();
      const nod = name === 'sofaDoze' ? { Spine: .045, Spine1: .035, Spine2: .04, Neck: .10, Head: .13 }[key] ?? 0 : 0;
      const yaw = gazeYaw * (key === 'Head' ? .72 : key === 'Neck' ? .28 : 0);
      const tilt = new Quaternion().setFromEuler(new Euler(nod, yaw, 0, 'YXZ'));
      return [key, inverse.clone().multiply(tilt).multiply(inverse.invert())];
    }));
    const tracks = sampleBones.map(([, joint]) => ({ joint, path: 'rotation', values: [] }));
    if (!upperOnly) tracks.push({ joint: hips, path: 'translation', values: [] });
    if (seated || name === 'pickUp') for (const { joint } of dress) tracks.push({ joint, path: 'rotation', values: [] });
    if (seated) for (const { joints } of seatedHair) {
      for (const joint of joints) tracks.push({ joint, path: 'rotation', values: [] });
    }
    const lapDrape = seated && dress.length > 0;
    if (lapDrape) for (const { joint } of dress) {
      if (!joint.name.endsWith('_01')) tracks.push({ joint, path: 'translation', values: [] });
    }
    const anchors = [];
    for (let frame = 0; frame < frameCount; frame++) {
      const t = timeAt(frame);
      rig.applyPose(0, 0);
      data.sample(t);
      for (const [key, joint] of sampleBones) {
        const alignment = delta.get(key);
        if (offsetIdle) {
          const offset = alignment.clone().invert().multiply(firstRotation.get(key))
            .multiply(source.get(key).quaternion).multiply(alignment);
          const gain = name === 'stretchNeck' ? .78 : 1;
          joint.quaternion.copy(bias.get(key)).multiply(new Quaternion().slerp(offset, gain));
        } else {
          worldQuaternion(joint, rotation(source.get(key)).multiply(alignment));
        }
      }
      if (name === 'shiftWeight') {
        const waist = point(target.get('Spine'));
        const left = target.get('LeftHand');
        // Guide the palm onto the side of the waist. Keep the free arm relaxed
        // and carry over the source's shift through the torso and wrist.
        const width = cardigan ? .128 : .117;
        const sourceOffset = point(source.get('LeftHand')).sub(point(source.get('Hips')));
        const goal = waist.add(new Vector3(width + .12 * (sourceOffset.x - .29), .013 + .24 * (sourceOffset.y + .05),
          -.012 + .14 * (sourceOffset.z + .075)));
        const shoulder = target.get('LeftArm'), elbow = target.get('LeftForeArm');
        const arm = point(shoulder);
        const bent = point(elbow);
        // Let the elbow swing out before drawing the wrist in to the hip.
        aim(shoulder, shoulder, elbow, bent.sub(arm).add(new Vector3(.12, 0, -.025)));
        moveEnd(shoulder, elbow, left, goal);
        const fingers = direction(left, target.get('LeftHandMiddle1'));
        const across = point(target.get('LeftHandIndex1')).sub(point(target.get('LeftHandPinky1')));
        const palmNormal = new Vector3(-1, 0, -.12).normalize();
        const palmForward = new Vector3(-.09, -.4, 1);
        const hand = basis(palmForward, palmNormal.cross(palmForward))
          .multiply(basis(fingers, across).invert()).multiply(rotation(left));
        worldQuaternion(left, rotation(left).slerp(hand, .82));
      }
      if (!upperOnly) {
        const sourceHips = point(source.get('Hips'));
        const offset = sourceHips.clone().sub(sourceAnchor).multiplyScalar(ratio);
        // The room owns movement. Keep crouches centered and preserve the
        // preparatory shift while leaving both standing endpoints at the spot.
        if (name === 'floorStand') {
          const settle = MathUtils.smoothstep(t, duration * .55, duration);
          offset.z += (1 - settle) * .16;
        }
        const lift = MathUtils.smoothstep(-offset.y, .12, .54);
        hips.position.copy(hipParent.worldToLocal(neutralHips.clone().add(offset)));
        const soleFloor = floorAtPose();
        const floor = Math.min(soleFloor, Math.max(soleFloor - .033, hipContact()));
        const ground = Math.max(neutralFloor, .002);
        hips.position.copy(hipParent.worldToLocal(neutralHips.clone().add(offset).add(new Vector3(0, ground - floor, 0))));
        const settle = name === 'floorSit' ? MathUtils.smoothstep(t, 3.10, 3.7)
          : name === 'floorStand' ? 1 - MathUtils.smoothstep(t, .4, 1.2) : 0;
        if (settle > 0) for (const [index, side] of ['Left', 'Right'].entries()) {
          const foot = target.get(side + 'Foot');
          const clearance = index === 0 ? .026 : .008;
          const correction = MathUtils.clamp(ground + clearance - soles[index](), -.13, .08) * settle;
          moveEnd(target.get(side + 'UpLeg'), target.get(side + 'Leg'), foot, point(foot).add(new Vector3(0, correction, 0)));
        }
        if (lift > 0 && dress.length) {
          const leftKnee = point(target.get('LeftLeg')), rightKnee = point(target.get('RightLeg'));
          for (const { joint, child, axis } of dress) {
            const start = point(joint), length = start.distanceTo(point(child ?? joint.parent));
            const side = /_(?:L|Left)_/.test(joint.name) ? 1 : /_(?:R|Right)_/.test(joint.name) ? -1 : 0;
            const front = joint.name.includes('Front'), back = joint.name.includes('Back');
            const knee = side > 0 ? leftKnee.clone() : side < 0 ? rightKnee.clone() : leftKnee.clone().lerp(rightKnee, .5);
            // Front cloth follows the thighs, while the side and rear hem spread out over the rug.
            const destination = front ? knee.add(new Vector3(side * .02, .067, .12))
              : start.clone().add(new Vector3(side * (back ? .035 : .13), -.038, back ? -.15 : .075));
            const clearance = !child && back ? .10 : .064;
            destination.y = Math.max(destination.y, clearance);
            const world = rotation(joint);
            const natural = child ? direction(joint, child) : axis.clone().applyQuaternion(world);
            const desired = destination.sub(start).normalize();
            const groundSlope = Math.min(.35, (clearance - start.y) / length);
            desired.y = Math.max(desired.y, groundSlope);
            const mixed = natural.clone().lerp(desired.normalize(), lift).normalize();
            worldQuaternion(joint, new Quaternion().setFromUnitVectors(natural, mixed).multiply(world));
          }
          const lapWeight = name === 'floorSit' ? MathUtils.smoothstep(t, 2.5, 3.7)
            : name === 'floorStand' ? 1 - MathUtils.smoothstep(t, .15, 1.05) : 0;
          if (lapDrape && lapWeight > 0) drapeCrossedLap(panels, leftKnee, rightKnee, lapWeight);
        }
      }
      if (seated) seatedHair.forEach(fitHairAboveRug);
      if (name === 'rubEye' || name === 'think') {
        const side = name === 'rubEye' ? 'Left' : 'Right';
        const hand = target.get(side + 'Hand'), head = target.get('Head');
        const sourceHand = point(source.get(side + 'Hand')).sub(point(source.get('Head')));
        const close = 1 - MathUtils.smoothstep(sourceHand.length(), .22, .47);
        // Keep the wrist in front of the real face after the change in head/arm proportions.
        const goal = point(head).add(new Vector3(name === 'rubEye' ? .072 : -.038, name === 'rubEye' ? .028 : -.075, .135));
        if (close > 0) moveEnd(target.get(side + 'Arm'), target.get(side + 'ForeArm'), hand, point(hand).lerp(goal, close));
      }
      if (name === 'pickUp') anchors.push(point(target.get('RightHand')).toArray());
      for (const track of tracks) {
        const value = track.path === 'rotation' ? track.joint.quaternion : track.joint.position;
        track.values.push(...value.toArray());
      }
    }
    if (anchors.length) {
      const grip = anchors.reduce((best, row, i) => row[1] < anchors[best][1] ? i : best, 0);
      console.log(outfit, 'pickUp lowest wrist', (grip / 30).toFixed(2), anchors[grip].map(x => x.toFixed(3)));
    }
    clips.push({ name, times: Array.from({ length: frameCount }, (_, i) => timeAt(i)), tracks });
  }
  rig.dispose();
  return clips;
}

function pack(clips) {
  const nodes = [], nodeIds = new Map(), buffers = [], bufferViews = [], accessors = [];
  let bytes = 0;
  function add(data, type, width) {
    const binary = Buffer.from(Float32Array.from(data).buffer);
    bufferViews.push({ buffer: 0, byteOffset: bytes, byteLength: binary.length });
    buffers.push(binary);
    bytes += binary.length;
    accessors.push({ bufferView: bufferViews.length - 1, componentType: 5126, count: data.length / width, type,
      ...(width === 1 ? { min: [data[0]], max: [data.at(-1)] } : {}) });
    return accessors.length - 1;
  }
  const animations = clips.map(({ name, times, tracks }) => {
    const input = add(times, 'SCALAR', 1), samplers = [], channels = [];
    for (const { joint, path, values } of tracks) {
      if (!nodeIds.has(joint.name)) { nodeIds.set(joint.name, nodes.length); nodes.push({ name: joint.name }); }
      const output = path === 'rotation' ? add(values, 'VEC4', 4) : add(values, 'VEC3', 3);
      samplers.push({ input, output, interpolation: 'LINEAR' });
      channels.push({ sampler: samplers.length - 1, target: { node: nodeIds.get(joint.name), path } });
    }
    return { name, channels, samplers };
  });
  const doc = { asset: { version: '2.0', generator: 'PocketWorld MotionSmith retarget' },
    scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, animations, bufferViews, accessors, buffers: [{ byteLength: bytes }] };
  const json = Buffer.from(JSON.stringify(doc));
  const padded = Buffer.alloc(Math.ceil(json.length / 4) * 4, 32);
  json.copy(padded);
  const header = Buffer.alloc(20), binHeader = Buffer.alloc(8);
  [0x46546c67, 2, 28 + padded.length + bytes, padded.length, 0x4e4f534a].forEach((n, i) => header.writeUInt32LE(n, i * 4));
  binHeader.writeUInt32LE(bytes); binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, padded, binHeader, ...buffers]);
}

const output = new URL('../assets/public/models/resident/luna-cabin-actions-' + outfit + '.glb', import.meta.url);
const clips = await bake(outfit, model);
await writeFile(output, pack(clips));
