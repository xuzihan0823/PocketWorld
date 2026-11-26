import { BufferAttribute, MathUtils, SkinnedMesh, type Object3D } from 'three';
import type { ResidentOutfit } from './outfit';

const fitKey = 'WardrobeSideEase';
const smooth = MathUtils.smoothstep;
const garmentMeshes: Record<ResidentOutfit, readonly string[]> = {
  everyday: ['Luna_Surface'],
  ribbon: ['Luna_|_Ribbon_jacket', 'Luna_|_Ribbon_jacket_1'],
  cardigan: ['Luna_Cardigan_Surface'],
};

/** A relative shape in the garment's bind space, applied once in the wardrobe loader. */
export function fitWardrobeGarment(scene: Object3D, outfit: ResidentOutfit) {
  scene.traverse(mesh => {
    if (!(mesh instanceof SkinnedMesh) || mesh.morphTargetDictionary?.[fitKey] !== undefined) return;
    const geometry = mesh.geometry;
    const { position, skinIndex, skinWeight } = geometry.attributes;
    if (!garmentMeshes[outfit].includes(mesh.name)) return;
    const previous = geometry.morphAttributes.position ?? [];
    const left = mesh.morphTargetDictionary?.LeftArmContact;
    const right = mesh.morphTargetDictionary?.RightArmContact;
    if (outfit === 'everyday' && (left === undefined || right === undefined)) return;
    const isTrunk = mesh.skeleton.bones.map(({ name }) => /^mixamorig(?:Hips$|Spine)/.test(name)
      || (outfit === 'cardigan' && name.startsWith('Dress_')));
    const isSleeve = mesh.skeleton.bones.map(bone => /^mixamorig(?:Left|Right)(?:Fore)?Arm$/.test(bone.name));
    const delta = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
      const lateral = Math.abs(x);
      if (outfit === 'everyday') {
        // The authored left/right contact shapes identify the fabric along the exposed arm.
        const key = previous[x > 0 ? left! : right!];
        const cloth = smooth(Math.abs(key.getX(i)), .0001, .0022);
        const mask = cloth * smooth(y, .505, .56) * (1 - smooth(y, .675, .70));
        delta[i * 3] = -Math.sign(x) * .017 * mask;
        continue;
      }
      let trunk = 0, arm = 0;
      for (let j = 0; j < 4; j++) {
        const joint = skinIndex.getComponent(i, j), weight = skinWeight.getComponent(i, j);
        if (isTrunk[joint]) trunk += weight;
        if (isSleeve[joint]) arm += weight;
      }
      if (outfit === 'cardigan') {
        // Ease the side panel and the short inner sleeve band around the rib cage.
        const waist = smooth(lateral, .04, .10) * smooth(y, .48, .54) * (1 - smooth(y, .65, .755))
          * smooth(z, -.086, -.045) * trunk * trunk;
        const along = (lateral - .07) * .395 - (y - .73) * .919;
        const across = (lateral - .07) * .919 + (y - .73) * .395;
        const sleeve = .0132 * smooth(-across, -.014, .020) * smooth(along, .005, .04)
          * (1 - smooth(along, .13, .19)) * arm * arm;
        delta[i * 3] = Math.sign(x) * (.919 * sleeve - .024 * waist);
        delta[i * 3 + 1] = .395 * sleeve;
        continue;
      }
      if (y < .475 || y > .77 || lateral < .034) continue;
      const mask = smooth(lateral, .034, .082) * smooth(y, .475, .523) * (1 - smooth(y, .685, .734))
        * smooth(z, -.06, -.025);
      const ease = mask * trunk * trunk;
      // From the shoulder toward the wrist, taper only the fabric facing the ribs.
      const along = (lateral - .068) * .595 - (y - .744) * .804;
      const across = (lateral - .068) * .804 + (y - .744) * .595;
      const sleeve = .026 * smooth(-across, -.010, .024) * smooth(along, -.01, .045)
        * (1 - smooth(along, .17, .21)) * arm * arm;
      delta[i * 3] = Math.sign(x) * (.804 * sleeve - .020 * ease);
      delta[i * 3 + 1] = .595 * sleeve;
      delta[i * 3 + 2] = -.009 * smooth(z, .025, .085) * ease;
    }
    const shape = new BufferAttribute(delta, 3);
    shape.name = fitKey;
    geometry.morphTargetsRelative = true;
    geometry.morphAttributes.position = [...previous, shape];
    mesh.morphTargetDictionary = { ...mesh.morphTargetDictionary, [fitKey]: previous.length };
    mesh.morphTargetInfluences = [...(mesh.morphTargetInfluences ?? []), 1];
  });
}
