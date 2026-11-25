import { Box3, MathUtils, Mesh, Raycaster, Vector2, Vector3, type Camera, type Material, type Object3D } from 'three';
import type { CabinDeck } from '../cabinLayout.ts';
import { setCameraRay } from './CameraTransition.ts';
import type { CameraCollision } from './CameraCollision.ts';

const structures = [
  { names: ['Duplex_LowerShellBack'], deck: 'lower', solid: true },
  { names: ['Duplex_LowerShellRight'], deck: 'lower', solid: true },
  { names: ['Duplex_UpperShellBack'], deck: 'upper', solid: true },
  { names: ['Duplex_UpperShellRight'], deck: 'upper', solid: true },
  { names: ['Duplex_DeckBase', 'Floor_Parquet', 'Duplex_LowerShellFloorTrim'], deck: 'lower', solid: true },
  { names: ['Duplex_BedroomBase', 'Floor_Parquet_Bedroom'], deck: 'upper', solid: true },
  { names: ['Stair_Lower_Landing'], deck: 'lower', solid: true },
  { names: ['Stair_Upper_Landing'], deck: 'upper', solid: true },
  { names: ['Furniture_Workbench'], deck: 'lower', solid: true, subject: 'desktop' },
  { names: ['Furniture_Bed'], deck: 'upper', solid: true, subject: 'bed' },
  { names: ['Interactable_wardrobe'], deck: 'upper', solid: false, subject: 'wardrobe' },
  { names: ['Bedroom_Guardrail'], deck: 'upper', solid: false },
  { names: ['Stair_CameraRail'], deck: 'stairs', solid: false },
] as const;

type Structure = typeof structures[number];
type Target = { point: Vector3; deck?: CabinDeck };
type MaterialSlot = { original: Material; clone: Material };
type MeshFade = { mesh: Mesh; materials: Material | Material[]; slots: MaterialSlot[]; castShadow: boolean; visible: boolean };
type Entry = {
  group: Structure;
  meshes: Mesh[];
  bounds: Box3;
  fade: number;
  blocked: boolean;
  restoreAt: number;
};

export function cameraHitVisible(node: Object3D) {
  for (let current: Object3D | null = node; current; current = current.parent) {
    if (!current.visible || current.userData.cameraIgnoreHit) return false;
  }
  return true;
}

function cloneMaterials(mesh: Mesh): MeshFade {
  const materials = mesh.material;
  const slots = (Array.isArray(materials) ? materials : [materials]).map(original => {
    const clone = original.clone();
    // Coverage fading keeps opaque surfaces in the depth pass. Glass keeps its blend mode.
    if (!original.transparent) clone.alphaHash = true;
    return { original, clone };
  });
  mesh.material = Array.isArray(materials) ? slots.map(slot => slot.clone) : slots[0].clone;
  return { mesh, materials, slots, castShadow: mesh.castShadow, visible: mesh.visible };
}

function applyFade({ mesh, castShadow, visible, slots }: MeshFade, opacity: number) {
  mesh.visible = opacity > .02 && visible;
  mesh.userData.cameraIgnoreHit = opacity < .45;
  mesh.castShadow = opacity > .54 && castShadow;
  for (const { original, clone } of slots) clone.opacity = original.opacity * opacity;
}

function restore({ mesh, materials, slots, visible, castShadow }: MeshFade) {
  mesh.material = materials;
  mesh.visible = visible;
  mesh.castShadow = castShadow;
  delete mesh.userData.cameraIgnoreHit;
  slots.forEach(({ clone }) => clone.dispose());
}

export class SceneVisibilityManager {
  private entries: Entry[] = [];
  private upperRoot: Object3D | undefined;
  private upperAmount: number | undefined;
  private upperMeshes: Mesh[] = [];
  private readonly pendingFades = new Map<Mesh, number>();
  private readonly appliedFades = new Map<Mesh, MeshFade>();
  private lastScan = -Infinity;
  private lastCheck = -Infinity;
  private lastEye = new Vector3(Infinity, 0, 0);
  private lastDirection = new Vector3();
  private lastTarget = new Vector3(Infinity, 0, 0);
  private lastKey = '';
  private time = 0;
  private readonly raycaster = new Raycaster();
  private readonly direction = new Vector3();
  private readonly right = new Vector3();
  private readonly up = new Vector3();
  private readonly sample = new Vector3();
  private readonly screen = new Vector3();
  private readonly pointer = new Vector2();
  private readonly intersection = new Vector3();

  private readonly collision: CameraCollision;

  constructor(collision: CameraCollision) {
    this.collision = collision;
  }

  refresh(interior: Object3D, delta: number) {
    this.time += Math.min(delta, .1);
    this.upperRoot ??= interior.getObjectByName('Cabin_UpperDeck');
    if (this.entries.length === structures.length || this.time - this.lastScan < .25) return;
    this.lastScan = this.time;
    let changed = false;
    for (const group of structures) {
      if (this.entries.some(entry => entry.group === group)) continue;
      const nodes = group.names.map(name => interior.getObjectByName(name));
      if (nodes.some(node => !node)) continue;
      const roots = nodes as Object3D[];
      const bounds = new Box3();
      const meshes: Mesh[] = [];
      for (const node of roots) {
        node.updateWorldMatrix(true, true);
        bounds.expandByObject(node);
        node.traverse(child => { if (child instanceof Mesh && child.visible) meshes.push(child); });
      }
      if (bounds.isEmpty()) continue;
      this.entries.push({ group, meshes, bounds, fade: 1, blocked: false, restoreAt: -Infinity });
      changed = true;
    }
    if (changed) {
      this.lastCheck = -Infinity;
      this.collision.setSolids(this.entries.filter(entry => entry.group.solid).map(entry => entry.bounds));
    }
  }

  update(camera: Camera, targets: readonly Target[], scope: string, subject: string | null, upper: boolean, stairs: boolean, enabled: boolean, reducedMotion: boolean, delta: number) {
    const main = targets[0].point;
    const key = `${scope}/${subject ?? ''}/${upper}/${stairs}/${enabled}/${camera.type}`;
    camera.getWorldDirection(this.direction);
    const changing = camera.position.distanceToSquared(this.lastEye) > .0025
      || this.direction.distanceToSquared(this.lastDirection) > .00025 || main.distanceToSquared(this.lastTarget) > .0025;
    const nextExpiry = this.entries.some(entry => entry.restoreAt > -Infinity && entry.restoreAt <= this.time);
    if (key !== this.lastKey || ((changing || nextExpiry || this.lastCheck === -Infinity) && this.time - this.lastCheck >= .1)) {
      this.lastKey = key;
      this.lastCheck = this.time;
      this.lastEye.copy(camera.position);
      this.lastDirection.copy(this.direction);
      this.lastTarget.copy(main);
      this.right.set(1, 0, 0).applyQuaternion(camera.quaternion);
      this.up.set(0, 1, 0).applyQuaternion(camera.quaternion);
      for (const entry of this.entries) {
        const allowed = enabled && (upper || entry.group.deck !== 'upper');
        const isSubject = 'subject' in entry.group && (entry.group.subject === subject || entry.bounds.containsPoint(main));
        const rail = entry.group.deck === 'stairs' && stairs && camera.position.x < entry.bounds.max.x;
        const hit = allowed && !isSubject && (rail || targets.some(target => this.obscures(entry, camera, target, scope)));
        if (hit || !allowed || isSubject) entry.restoreAt = -Infinity;
        else if (entry.blocked) entry.restoreAt = this.time + .24;
        else if (entry.restoreAt <= this.time) entry.restoreAt = -Infinity;
        entry.blocked = hit;
      }
    }
    this.pendingFades.clear();
    this.updateUpper(upper, reducedMotion, delta);
    for (const entry of this.entries) {
      const goal = entry.blocked || entry.restoreAt > this.time ? 0 : 1;
      entry.fade = this.fadeToward(entry.fade, goal, reducedMotion, delta);
      if (entry.fade >= 1) continue;
      for (const mesh of entry.meshes) {
        this.pendingFades.set(mesh, Math.min(entry.fade, this.pendingFades.get(mesh) ?? 1));
      }
    }
    for (const [mesh, state] of this.appliedFades) {
      if (this.pendingFades.has(mesh)) continue;
      restore(state);
      this.appliedFades.delete(mesh);
    }
    for (const [mesh, opacity] of this.pendingFades) {
      let state = this.appliedFades.get(mesh);
      if (!state) {
        if (!mesh.visible) continue;
        state = cloneMaterials(mesh);
        this.appliedFades.set(mesh, state);
      }
      applyFade(state, opacity);
    }
  }

  private fadeToward(current: number, goal: number, reducedMotion: boolean, delta: number) {
    if (current === goal || reducedMotion) return goal;
    const next = MathUtils.damp(current, goal, goal ? 9 : 13, Math.min(delta, .1));
    return Math.abs(next - goal) < .018 ? goal : next;
  }

  private updateUpper(visible: boolean, reducedMotion: boolean, delta: number) {
    if (!this.upperRoot) return;
    const goal = visible ? 1 : 0;
    const previous = this.upperAmount ?? goal;
    const amount = this.fadeToward(previous, goal, reducedMotion, delta);
    this.upperAmount = amount;
    this.upperRoot.visible = amount > 0;
    if (amount === 0 || amount === 1) {
      this.upperMeshes.length = 0;
      return;
    }
    if (!this.upperMeshes.length) {
      this.upperRoot.traverse(node => { if (node instanceof Mesh) this.upperMeshes.push(node); });
    }
    for (const mesh of this.upperMeshes) this.pendingFades.set(mesh, amount);
  }

  private obscures(entry: Entry, camera: Camera, target: Target, scope: string) {
    const { deck } = entry.group;
    if (deck !== 'stairs' && target.deck && deck !== target.deck && 'subject' in entry.group) return false;
    if (entry.bounds.containsPoint(target.point)) return false;
    const reach = scope === 'overview' ? .65 : .31;
    let blocked = 0;
    for (const [x, y] of [[0, 0], [-1, 0], [1, 0], [0, -.72], [0, .72]]) {
      this.sample.copy(target.point).addScaledVector(this.right, x * reach).addScaledVector(this.up, y * reach);
      this.screen.copy(this.sample).project(camera);
      setCameraRay(this.raycaster, this.pointer.set(this.screen.x, this.screen.y), camera);
      const distance = this.sample.distanceTo(this.raycaster.ray.origin) - .12;
      if (distance <= 0) continue;
      const broad = this.raycaster.ray.intersectBox(entry.bounds, this.intersection);
      if (!broad || broad.distanceTo(this.raycaster.ray.origin) > distance) continue;
      this.raycaster.far = distance;
      // Hidden parts still participate so visibility can recover without alternating
      // between an invisible wall and a ray which no longer sees it.
      if (this.raycaster.intersectObjects(entry.meshes, false).length && ++blocked >= 2) return true;
    }
    return false;
  }

  dispose() {
    this.appliedFades.forEach(restore);
    this.appliedFades.clear();
    this.pendingFades.clear();
    if (this.upperRoot) this.upperRoot.visible = true;
    this.upperRoot = undefined;
    this.upperAmount = undefined;
    this.upperMeshes = [];
    this.entries = [];
    this.lastScan = this.lastCheck = -Infinity;
    this.lastKey = '';
    this.collision.setSolids([]);
  }
}
