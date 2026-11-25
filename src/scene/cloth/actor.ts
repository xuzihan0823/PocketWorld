import * as T from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createResidentRig } from '../orbital/residentRig';
import { loadCabinActions } from '../orbital/cabinActions';
import { applyLibraryPose } from '../orbital/library/residentPose';
import { BUILTIN_BOOKS, shelfYaw } from '../orbital/library/catalog';
import { createSleeveContact } from '../orbital/wardrobe/sleeveContact';

export const motions = ['待机', '行走', '抬臂', '阅读', '坐下', '躺下', '起身'] as const;
export type Motion = (typeof motions)[number];
export type ReplayBlend = 'legacy' | 'preserveFadeWeight' | 'continuous';
export interface AnimationState {
  selected: Motion;
  /** Effective mixer weights in motions order, after this substep. */
  weights: readonly number[];
}
const base = import.meta.env.BASE_URL + 'models/resident/';
const loader = new GLTFLoader();

// The ribbon asset has no bed track. Transfer bind-relative rotations of common bones,
// preserving the target proportions, and retain the source hip trajectory.
async function bedMotion(target: T.SkinnedMesh) {
  const source = await loader.loadAsync(base + 'luna-cardigan.glb');
  const clip = T.AnimationClip.findByName(source.animations, 'Luna_Bed_V3_DirectSeat');
  let sourceSkin!: T.SkinnedMesh;
  source.scene.traverse((o) => {
    if (o instanceof T.SkinnedMesh) sourceSkin = o;
  });
  const rotations = (skin: T.SkinnedMesh) => {
    const map = new Map<string, T.Quaternion>();
    skin.skeleton.bones.forEach((b, i) => {
      const m = skin.skeleton.boneInverses[i].clone().invert();
      map.set(b.name, new T.Quaternion().setFromRotationMatrix(new T.Matrix4().extractRotation(m)));
    });
    return map;
  };
  const a = rotations(sourceSkin),
    b = rotations(target);
  const tracks: T.KeyframeTrack[] = [];
  for (const input of clip.tracks) {
    const { nodeName, propertyName } = T.PropertyBinding.parseTrackName(input.name);
    const dest = target.skeleton.getBoneByName(nodeName),
      src = sourceSkin.skeleton.getBoneByName(nodeName);
    if (!dest || !src) continue;
    const out = input.clone();
    if (propertyName === 'quaternion') {
      const fromParent = a.get(src.parent!.name) ?? new T.Quaternion();
      const toParent = b.get(dest.parent!.name) ?? new T.Quaternion();
      const pre = toParent.clone().invert().multiply(fromParent);
      const post = a.get(nodeName)!.clone().invert().multiply(b.get(nodeName)!);
      const q = new T.Quaternion();
      for (let k = 0; k < out.values.length; k += 4)
        q.fromArray(out.values, k).premultiply(pre).multiply(post).normalize().toArray(out.values, k);
    } else if (nodeName === 'mixamorigHips' && propertyName === 'position') {
      const offset = dest.position.clone().sub(src.position);
      for (let k = 0; k < out.values.length; k += 3)
        offset.clone().add(new T.Vector3().fromArray(out.values, k)).toArray(out.values, k);
    } else continue;
    tracks.push(out);
  }
  releaseMeshes(source.scene);
  return new T.AnimationClip('bed', clip.duration, tracks);
}

export function releaseMeshes(scene: T.Object3D) {
  const resources = new Set<T.Texture | T.Material | T.BufferGeometry | T.Skeleton>();
  scene.traverse((o) => {
    if (!(o instanceof T.Mesh || o instanceof T.Line)) return;
    if (o instanceof T.SkinnedMesh) resources.add(o.skeleton);
    resources.add(o.geometry);
    for (const m of ([] as T.Material[]).concat(o.material)) {
      resources.add(m);
      for (const item of Object.values(m)) if (item instanceof T.Texture) resources.add(item);
    }
  });
  for (const item of resources) {
    if (item instanceof T.Texture && typeof ImageBitmap !== 'undefined' && item.image instanceof ImageBitmap)
      item.image.close();
    item.dispose();
  }
}

export async function createActor(stage: T.Scene, everyday: boolean, offset: number, blend: boolean | ReplayBlend = false) {
  const [model, cabin] = await Promise.all([
    loader.loadAsync(base + (everyday ? 'luna-walk-room' : 'luna-ribbon') + '.glb'),
    loadCabinActions(everyday ? 'everyday' : 'ribbon'),
  ]);
  const surfaces: T.SkinnedMesh[] = [];
  model.scene.traverse((o) => {
    if (o instanceof T.SkinnedMesh) surfaces.push(o);
  });
  const skin = surfaces.sort(
    (a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count,
  )[0];
  const bed = await bedMotion(skin);
  const walk = T.AnimationClip.findByName(model.animations, 'Walk_Grounded_Loop');
  const rig = createResidentRig(model.scene, walk);
  const root = new T.Group();
  root.add(rig.mesh);
  stage.add(root);

  // Capture the production reading IK solution as a blendable pose in character space.
  const neutral = skin.skeleton.bones.map((b) => ({
    q: b.quaternion.clone(),
    p: b.position.clone(),
    s: b.scale.clone(),
  }));
  root.rotation.y = Math.PI + shelfYaw('habitat');
  for (let i = 0; i < 8; i++) {
    applyLibraryPose(
      rig,
      root,
      'habitat',
      {
        phase: 'reading',
        book: BUILTIN_BOOKS[0],
        page: 0,
        targetPage: 0,
        direction: 1,
        progress: 1,
        pages: [],
        nextId: null,
        closeRequested: false,
        exit: false,
        pending: null,
      },
      0.15,
      true,
    );
    rig.applyPose(0, 0);
    root.updateMatrixWorld(true);
  }
  const reading = new T.AnimationClip(
    'reading',
    1,
    skin.skeleton.bones.flatMap((b) => [
      new T.QuaternionKeyframeTrack(b.name + '.quaternion', [0], b.quaternion.toArray()),
      new T.VectorKeyframeTrack(b.name + '.position', [0], b.position.toArray()),
    ]),
  );
  skin.skeleton.bones.forEach((b, i) => {
    b.quaternion.copy(neutral[i].q);
    b.position.copy(neutral[i].p);
    b.scale.copy(neutral[i].s);
  });
  root.position.set(offset, 0, 0);
  root.rotation.y = 0;
  const mixer = new T.AnimationMixer(model.scene);
  const clips = [cabin.shiftWeight, walk, cabin.reachHigh, reading, cabin.floorSit, bed, cabin.floorStand];
  const actions = clips.map((clip, i) => {
    const act = mixer.clipAction(clip);
    if (i >= 4) {
      act.setLoop(T.LoopOnce, 1);
      act.clampWhenFinished = true;
    }
    return act;
  });
  const contact = createSleeveContact(model.scene);
  let active: T.AnimationAction | undefined;
  let selected: Motion = '待机';
  const duration = 0.22;
  // Convolve the requested action with a finite smoothstep window. On interruption
  // every earlier change keeps its original clock, including a return to a live clip.
  const changes: { from: number; to: number; start: number }[] = [];
  const weights = new Array<number>(actions.length).fill(0);
  let settled = 0;
  function select(motion: Motion) {
    const next = actions[motions.indexOf(motion)];
    if (active === next) return;
    const index = motions.indexOf(motion);
    if (blend === 'continuous') {
      if (active) changes.push({ from: motions.indexOf(selected), to: index, start: mixer.time });
      else settled = index;
      if (!next.isScheduled()) next.reset().setEffectiveWeight(active ? 0 : 1).play();
    } else {
      next.reset().setEffectiveWeight(1).play();
      if (active) {
        // Three starts a fade-out at a multiplier of one, including interrupted fade-ins.
        if (blend === true || blend === 'preserveFadeWeight') active.setEffectiveWeight(active.getEffectiveWeight());
        active.crossFadeTo(next, duration, false);
      }
    }
    selected = motion;
    active = next;
  }
  function update(dt: number) {
    if (blend === 'continuous') {
      const time = mixer.time + dt;
      while (changes.length && time - changes[0].start >= duration) settled = changes.shift()!.to;
      weights.fill(0);
      weights[settled] = 1;
      for (const { from, to, start } of changes) {
        const fraction = T.MathUtils.smoothstep(time - start, 0, duration);
        weights[from] -= fraction;
        weights[to] += fraction;
      }
      actions.forEach((action, i) => {
        if (!action.isScheduled()) return;
        if (weights[i] <= 0 && action !== active) action.stop();
        else action.setEffectiveWeight(Math.max(0, weights[i]));
      });
    }
    mixer.update(dt);
    root.updateMatrixWorld(true);
    contact?.();
    for (const s of surfaces) s.skeleton.update();
  }
  select('待机');
  update(0);
  return {
    skin,
    select,
    update,
    animationState(): AnimationState {
      return { selected, weights: actions.map(a => a.isScheduled() && a.enabled ? a.getEffectiveWeight() : 0) };
    },
    dispose() {
      mixer.stopAllAction();
      mixer.uncacheRoot(model.scene);
    },
  };
}
