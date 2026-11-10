import { Bone, BufferAttribute, Group, Material, MathUtils, Matrix4, MeshDepthMaterial, MeshDistanceMaterial, MeshStandardMaterial, Quaternion, RGBADepthPacking, SkinnedMesh, Vector3 } from 'three';
import { CHAIR_POSES, chairFacing } from '../chairPose';
import { OFFICE_CHAIR, type ChairSeating } from './ChairSeating';
import { plantLeg } from './TurnFootPlant';

const smooth = (x: number) => { x = MathUtils.clamp(x, 0, 1); return x * x * (3 - 2 * x); };
export function seatedWeight(seating?: ChairSeating) {
  if (!seating?.sitting) return 0;
  return seating.phase === 'STAND_UP' ? 1 - smooth((seating.clipTime - 5.8) / 1.7) : smooth((seating.clipTime - 2.4) / 1.7);
}

/** Additive posed-surface correction. Source geometry, skin weights and UVs remain unchanged.
 * Both GPU rendering and CPU raycast/validation use the same chair-space contact projection.
 */
export class ChairContact {
  private meshToChair = new Matrix4();
  private chairToMesh = new Matrix4();
  private strength = { value: 0 };
  private originalGeometry;
  private originalMaterial: Material | Material[];
  private originalVertex;
  private material: MeshStandardMaterial;
  private depthMaterial = new MeshDepthMaterial({ depthPacking: RGBADepthPacking });
  private distanceMaterial = new MeshDistanceMaterial();
  private originalDepth;
  private originalDistance;
  readonly regions: Float32Array;
  private dress: Bone[];
  private arms: { arm: Bone; forearm: Bone; hand: Bone; middle: Bone; index: Bone; pinky: Bone; side: number }[];
  constructor(private mesh: SkinnedMesh, private actor: Group) {
    this.originalGeometry = mesh.geometry; this.originalMaterial = mesh.material;
    this.originalDepth = mesh.customDepthMaterial; this.originalDistance = mesh.customDistanceMaterial;
    this.originalVertex = mesh.getVertexPosition.bind(mesh);
    mesh.geometry = mesh.geometry.clone();
    const a = mesh.geometry.attributes;
    this.regions = new Float32Array(a.position.count);
    for (let i = 0; i < this.regions.length; i++) {
      let dress = 0, hair = 0;
      for (let c = 0; c < 4; c++) {
        const name = mesh.skeleton.bones[a.skinIndex.getComponent(i, c)].name, w = a.skinWeight.getComponent(i, c);
        if (name.startsWith('Dress_')) dress += w;
        if (name.startsWith('Hair_')) hair += w;
      }
      // Include the skirt's attached waist/inner seam, whose original weights use Hips/UpLeg.
      this.regions[i] = hair > .02 ? 2 : dress > .01 || (a.position.getY(i) > .38 && a.position.getY(i) < .56 && Math.abs(a.position.getX(i)) < .21) ? 1 : 0;
    }
    mesh.geometry.setAttribute('chairRegion', new BufferAttribute(this.regions, 1));
    this.material = (mesh.material as MeshStandardMaterial).clone();
    mesh.material = this.material;
    const deform = (shader: Parameters<MeshStandardMaterial['onBeforeCompile']>[0]) => {
      shader.uniforms.chairContactStrength = this.strength;
      shader.uniforms.meshToChair = { value: this.meshToChair };
      shader.uniforms.chairToMesh = { value: this.chairToMesh };
      shader.vertexShader = `attribute float chairRegion;
uniform float chairContactStrength;
uniform mat4 meshToChair;
uniform mat4 chairToMesh;
${shader.vertexShader}`.replace('#include <skinning_vertex>', `#include <skinning_vertex>
if (chairContactStrength > 0.0 && chairRegion > 0.5) {
  vec3 p = (meshToChair * vec4(transformed, 1.0)).xyz;
  if (chairRegion < 1.5) {
    float edge = (1.0 - smoothstep(0.235, 0.285, abs(p.x))) * (1.0 - smoothstep(0.22, 0.27, abs(p.z)));
    float compression = max(0.0, 0.374 - p.y) * edge * chairContactStrength;
    p.y += compression;
  } else {
    float edge = (1.0 - smoothstep(0.215, 0.265, abs(p.x))) * smoothstep(0.40, 0.46, p.y) * (1.0 - smoothstep(0.82, 0.88, p.y));
    p.z += max(0.0, -0.223 - p.z) * edge * chairContactStrength;
  }
  transformed = (chairToMesh * vec4(p, 1.0)).xyz;
}`);
    };
    for (const material of [this.material, this.depthMaterial, this.distanceMaterial]) {
      material.onBeforeCompile = deform;
      material.customProgramCacheKey = () => 'chair-contact-v1';
    }
    mesh.customDepthMaterial = this.depthMaterial;
    mesh.customDistanceMaterial = this.distanceMaterial;
    mesh.getVertexPosition = (index, target) => {
      this.originalVertex(index, target);
      if (!this.strength.value || !this.regions[index]) return target;
      target.applyMatrix4(this.meshToChair);
      this.project(target, this.regions[index]);
      return target.applyMatrix4(this.chairToMesh);
    };
    const bone = (name: string) => mesh.skeleton.bones.find(b => b.name.replace(/[^\w]/g, '') === 'mixamorig' + name)!;
    this.dress = mesh.skeleton.bones.filter(b => b.name.startsWith('Dress_'));
    this.arms = ['Left', 'Right'].map((side, index) => ({ arm: bone(side + 'Arm'), forearm: bone(side + 'ForeArm'), hand: bone(side + 'Hand'), middle: bone(side + 'HandMiddle1'), index: bone(side + 'HandIndex1'), pinky: bone(side + 'HandPinky1'), side: index ? -1 : 1 }));
  }
  private project(p: Vector3, region: number) {
    const band = (x: number, a: number, b: number) => smooth((x - a) / (b - a));
    if (region === 1) {
      const edge = (1 - band(Math.abs(p.x), .235, .285)) * (1 - band(Math.abs(p.z), .22, .27));
      const compression = Math.max(0, OFFICE_CHAIR.seatHeight + .004 - p.y) * edge * this.strength.value;
      p.y += compression;
    } else {
      const edge = (1 - band(Math.abs(p.x), .215, .265)) * band(p.y, .40, .46) * (1 - band(p.y, .82, .88));
      p.z += Math.max(0, -.223 - p.z) * edge * this.strength.value;
    }
  }
  poseDress(seating?: ChairSeating) {
    if (!seating?.sitting) return;
    this.actor.updateWorldMatrix(true, true);
    for (const bone of this.dress) {
      bone.updateWorldMatrix(true, false);
      const child = bone.children.find(c => (c as Bone).isBone);
      const originWorld = bone.getWorldPosition(new Vector3());
      const tailWorld = child ? child.getWorldPosition(new Vector3()) : bone.localToWorld(new Vector3(0, Number(bone.userData.secondary_length), 0));
      const origin = this.actor.worldToLocal(originWorld.clone()), tail = this.actor.worldToLocal(tailWorld.clone());
      const plane = OFFICE_CHAIR.seatHeight + .026;
      const depth = origin.z + OFFICE_CHAIR.rootAhead;
      if (tail.y >= plane || origin.y < plane - .02 || Math.abs(origin.x) > .27 || Math.abs(depth) > .255) continue;
      const length = tail.distanceTo(origin), dy = MathUtils.clamp(plane - origin.y, -length * .999, length * .999);
      const outward = new Vector3(origin.x, 0, depth).normalize();
      const horizontal = tail.clone().sub(origin); horizontal.y = 0;
      if (horizontal.lengthSq() < 1e-8) horizontal.copy(outward); else horizontal.normalize().lerp(outward, smooth((plane - tail.y) / .04)).normalize();
      const goal = origin.clone().addScaledVector(horizontal, Math.sqrt(length * length - dy * dy)); goal.y = origin.y + dy;
      this.actor.localToWorld(goal);
      const change = new Quaternion().setFromUnitVectors(tailWorld.sub(originWorld).normalize(), goal.sub(originWorld).normalize());
      const rotation = bone.getWorldQuaternion(new Quaternion());
      bone.quaternion.copy(bone.parent!.getWorldQuaternion(new Quaternion()).invert()).multiply(change).multiply(rotation);
      bone.updateWorldMatrix(false, true);
    }
  }
  poseArms(seating?: ChairSeating) {
    const weight = seatedWeight(seating);
    if (!weight) return;
    this.actor.updateWorldMatrix(true, true);
    const actorQ = this.actor.getWorldQuaternion(new Quaternion()), forward = new Vector3(0, 0, 1).applyQuaternion(actorQ);
    for (const { arm, forearm, hand, middle, index, pinky, side } of this.arms) {
      const current = hand.getWorldPosition(new Vector3());
      const target = this.actor.localToWorld(new Vector3(side * .16, .49, -.10));
      const direction = middle.getWorldPosition(new Vector3()).sub(current).normalize();
      const currentQ = hand.getWorldQuaternion(new Quaternion());
      const swing = new Quaternion().setFromUnitVectors(direction, forward);
      const across = index.getWorldPosition(new Vector3()).sub(pinky.getWorldPosition(new Vector3())).applyQuaternion(swing);
      across.addScaledVector(forward, -across.dot(forward)).normalize();
      const desiredAcross = new Vector3(-side, 0, 0).applyQuaternion(actorQ);
      const twist = Math.atan2(forward.dot(across.clone().cross(desiredAcross)), across.dot(desiredAcross));
      const palm = new Quaternion().setFromAxisAngle(forward, twist).multiply(swing).multiply(currentQ);
      const pole = new Vector3(side * .5, -.2, -1).applyQuaternion(actorQ).normalize();
      plantLeg(arm, forearm, hand, current.clone().lerp(target, weight), currentQ.slerp(palm, weight), pole);
    }
  }
  update(seating?: ChairSeating) {
    // The correction follows contact during lowering and releases as the fabric clears the seat.
    this.strength.value = seating?.sitting ? 1 : 0;
    if (!this.strength.value) return;
    this.actor.updateWorldMatrix(true, true);
    const pose = CHAIR_POSES.habitat;
    const chair = new Matrix4().compose(new Vector3(pose.x, 0, pose.z), new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), chairFacing(pose)), new Vector3(1, 1, 1));
    chair.premultiply(this.actor.parent!.matrixWorld);
    this.meshToChair.copy(chair).invert().multiply(this.mesh.matrixWorld);
    this.chairToMesh.copy(this.meshToChair).invert();
  }
  dispose() {
    this.mesh.geometry.dispose(); this.material.dispose(); this.depthMaterial.dispose(); this.distanceMaterial.dispose();
    this.mesh.geometry = this.originalGeometry; this.mesh.material = this.originalMaterial; this.mesh.getVertexPosition = this.originalVertex;
    this.mesh.customDepthMaterial = this.originalDepth; this.mesh.customDistanceMaterial = this.originalDistance;
  }
}
