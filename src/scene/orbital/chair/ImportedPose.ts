import { Bone, Object3D } from 'three';

/** AnimationMixer skips unchanged values. Restore the previous imported body pose before
 * sampling, so procedural IK never feeds its last result back into the next fixed step.
 * The imported pose includes Hair/Dress; SecondaryMotion captures its base after chair contact shaping.
 */
export class ImportedPose {
  private entries;
  constructor(root: Object3D) {
    const bones: Bone[] = [];
    root.traverse(o => { if ((o as Bone).isBone) bones.push(o as Bone); });
    this.entries = bones.map(bone => ({ bone, position: bone.position.clone(), rotation: bone.quaternion.clone(), scale: bone.scale.clone() }));
  }
  sample(animate: () => void) {
    for (const entry of this.entries) { entry.bone.position.copy(entry.position); entry.bone.quaternion.copy(entry.rotation); entry.bone.scale.copy(entry.scale); }
    animate();
    for (const entry of this.entries) { entry.position.copy(entry.bone.position); entry.rotation.copy(entry.bone.quaternion); entry.scale.copy(entry.bone.scale); }
  }
}
