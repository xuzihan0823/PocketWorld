"""Local bind-surface and knee skin correction; feet and rest joints stay fixed.

The source has an inward patella/upper-tibia silhouette and an outward calf
centre even before animation. Move only leg skin across X, then broaden the
thigh/shin weight transition with a small anterior patella bias. This is not
a stance-width or bone-rotation correction.
"""
import math
from mathutils import Vector

PROFILE = {'knee': {'height': .303, 'width': .038, 'shift': .0055},
           'calf': {'height': .215, 'width': .048, 'shift': -.0045},
           'bounds': [.10, .40], 'fade': .025}


def smooth(value):
    value = max(0., min(1., value))
    return value * value * (3 - 2 * value)


def offset(height):
    amount = sum(part['shift'] * math.exp(-((height - part['height']) / part['width'])**2)
                 for part in [PROFILE['knee'], PROFILE['calf']])
    lo, hi = PROFILE['bounds']
    return amount * smooth((height - lo) / PROFILE['fade']) * smooth((hi - height) / PROFILE['fade'])


def repair(obj, arm):
    world_to_local = obj.matrix_world.to_3x3().inverted()
    shape_ids, weight_ids, shifts, changes = [], [], [], []
    names = [g.name for g in obj.vertex_groups]
    for vertex in obj.data.vertices:
        p = obj.matrix_world @ vertex.co
        if not .10 < p.z < .40:
            continue
        side, sign = ('Left', 1.) if p.x > 0 else ('Right', -1.)
        upper, lower = [obj.vertex_groups['mixamorig:' + side + n] for n in ['UpLeg', 'Leg']]
        weights = {g.group: g.weight for g in vertex.groups}
        # Select the actual skin by bone membership, excluding dress and hair.
        total = weights.get(upper.index, 0.) + weights.get(lower.index, 0.)
        if total < .95:
            continue
        shift = sign * offset(p.z)
        if abs(shift) > 1e-9:
            delta = world_to_local @ Vector((shift, 0, 0))
            vertex.co += delta
            for key in obj.data.shape_keys.key_blocks:
                key.data[vertex.index].co += delta
            shape_ids.append(vertex.index)
            shifts.append(abs(shift))
        knee = arm.matrix_world @ arm.data.bones['mixamorig:' + side + 'Leg'].head_local
        relative = p.z - knee.z
        if abs(relative) < .045:
            anterior = smooth((knee.y - p.y) / .025)
            thigh = smooth((relative + .045) / .09)
            thigh += .16 * anterior * math.exp(-(relative / .025)**2)
            thigh = min(1., thigh)
            old = weights.get(upper.index, 0.) / total
            # Fade at the edge of the local edit, keeping adjoining weights exact.
            influence = smooth((.045 - abs(relative)) / .012)
            thigh = old + (thigh - old) * influence
            if abs(thigh - old) > 1e-7:
                upper.add([vertex.index], thigh * total, 'REPLACE')
                lower.add([vertex.index], (1 - thigh) * total, 'REPLACE')
                weight_ids.append(vertex.index)
                changes.append(abs(thigh - old))
    obj.data.update()
    return {'shape_vertex_ids': shape_ids, 'weight_vertex_ids': weight_ids,
            'shape_vertices': len(shape_ids), 'weight_vertices': len(weight_ids),
            'max_lateral_offset': max(shifts, default=0.),
            'max_weight_change': max(changes, default=0.), 'profile': PROFILE,
            'rest_joints_unchanged': True, 'feet_below_010_unchanged': True}
