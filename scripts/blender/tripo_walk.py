"""Baked world-space foot targets shared by Walk and the sit approach.

Walk is an in-place 1.2 s loop at 0.25 model units/s. A host must advance
its root by that distance (or scale clip time with measured travel).
"""
import math
import bpy
from mathutils import Vector, Quaternion

PERIOD = 1.2
SPEED = .25
STANCE = 7 / 12
APPROACH_END = 2.1
STEPS = [('Left', 3/30, 15/30, .28, .18), ('Right', 17/30, 29/30, .28, .09),
         ('Left', 31/30, 44/30, .18, 0.), ('Right', 46/30, 59/30, .09, 0.)]


def smooth(x):
    x = max(0., min(1., x))
    return x*x*x*(10 + x*(-15 + x*6))


def rotate(arm, name, axis, angle):
    bone = arm.pose.bones[name]
    local = (arm.matrix_world.to_3x3() @ bone.bone.matrix_local.to_3x3()).inverted() @ Vector(axis)
    bone.rotation_quaternion = Quaternion(local.normalized(), angle) @ bone.rotation_quaternion


def orient(bone, rotation):
    matrix = bone.matrix.copy()
    position = matrix.translation.copy()
    matrix = rotation.to_matrix().to_4x4() @ matrix
    matrix.translation = position
    bone.matrix = matrix
    bone.location = (0, 0, 0)
    bone.scale = (1, 1, 1)
    bpy.context.view_layer.update()


def setup(arm):
    for b in arm.pose.bones:
        b.matrix_basis.identity()
        b.rotation_mode = 'QUATERNION'
    bpy.context.view_layer.update()
    feet = {}
    for side in ['Left', 'Right']:
        bone = arm.pose.bones['mixamorig:' + side + 'Foot']
        feet[side] = (bone.head.copy(), bone.matrix.to_quaternion())
    return {'arm': arm, 'feet': feet,
            'space': arm.matrix_world.to_3x3().inverted(),
            'hip_space': (arm.matrix_world.to_3x3() @ arm.data.bones['mixamorig:Hips'].matrix_local.to_3x3()).inverted()}


def target(t, side, approach):
    """Return longitudinal foot position, lift, pitch, planted flag."""
    if approach:
        y = .28
        for which, start, end, before, after in STEPS:
            if which != side:
                continue
            if t >= end:
                y = after
            elif t > start:
                u = (t-start)/(end-start)
                return swing(u, before, after)
        return y, 0., 0., True
    # 21/36 frames in stance, 15/36 in swing. Both contact boundaries align
    # with 30 fps keys, preventing interpolation across a support switch.
    phase = (t/PERIOD + (0 if side == 'Left' else .5)) % 1
    half = SPEED * PERIOD * STANCE / 2
    if phase <= STANCE:
        return -half + SPEED*PERIOD*phase, 0., 0., True
    return swing((phase-STANCE)/(1-STANCE), half, -half)


def swing(u, start, end):
    def curve(knots):
        for (a, va), (b, vb) in zip(knots, knots[1:]):
            if u <= b:
                return va + (vb-va)*smooth((u-a)/(b-a))
        return knots[-1][1]
    # Toe-off, dorsiflexion, then heel-first roll-down. Arrive at the
    # longitudinal landing point before flattening the foot for stance.
    blend = smooth(u/.88)
    pitch = curve([(0., 0.), (.18, .28), (.45, 0.), (.78, -.20), (.88, -.16), (1., 0.)])
    clearance = curve([(0., 0.), (.18, .0015), (.48, .032), (.78, .012), (.88, 0.), (1., 0.)])
    # This mesh's toe extends 0.089 past the ankle (rather than 0.058).
    # Include 0.0045 model units of clearance for the curved ankle trajectory
    # between the 30 fps two-bone rotation keys, verified at 120 Hz.
    margin = .0045*smooth(u/.1)*(1-smooth((u-.78)/.22))
    lift = max(clearance, .092*math.sin(max(0., pitch)) + .034*math.sin(max(0., -pitch)) + margin)
    return start + (end-start)*blend, lift, pitch, False


def apply(state, t, approach=False):
    arm = state['arm']
    for bone in arm.pose.bones:
        bone.matrix_basis.identity()
    strength = smooth(t/.18) * (1-smooth((t-1.85)/.25)) if approach else 1.
    gait_phase = math.tau*t/PERIOD - math.pi*STANCE
    offset = .28*(1-smooth(t/(59/30))) if approach else 0.
    targets = {side: target(t, side, approach) for side in ['Left', 'Right']}
    # Approach targets are in world space, so measure their reach relative
    # to the advancing pelvis instead of treating the root offset as stride.
    spread = max(abs(values[0]-offset+.015) for values in targets.values())
    bob = (-.003 - 1.15*spread*spread + .0025*math.cos(2*gait_phase))*strength
    hips = arm.pose.bones['mixamorig:Hips']
    hips.location = state['hip_space'] @ Vector((.009*math.cos(gait_phase)*strength, offset, bob))
    rotate(arm, 'mixamorig:Hips', (0,0,1), .048*math.sin(gait_phase)*strength)
    rotate(arm, 'mixamorig:Spine', (0,0,1), -.026*math.sin(gait_phase)*strength)
    rotate(arm, 'mixamorig:Spine1', (0,0,1), -.022*math.sin(gait_phase)*strength)
    rotate(arm, 'mixamorig:Hips', (0,1,0), -.036*math.cos(gait_phase)*strength)
    rotate(arm, 'mixamorig:Spine', (0,1,0), .024*math.cos(gait_phase)*strength)
    for side, sign in [('Left',1),('Right',-1)]:
        rotate(arm, 'mixamorig:'+side+'Shoulder', (0,1,0), sign*.055*strength)
        rotate(arm, 'mixamorig:'+side+'Arm', (0,1,0), sign*.35*strength)
        rotate(arm, 'mixamorig:'+side+'Arm', (1,0,0), -sign*.22*math.sin(gait_phase)*strength)
        rotate(arm, 'mixamorig:'+side+'ForeArm', (1,0,0), (-.20-.10*sign*math.sin(gait_phase-.35))*strength)
        rotate(arm, 'mixamorig:'+side+'Hand', (1,0,0), -.045*strength)
        # Curl around each digit's local X, mirrored with the hand. This is
        # applied only by the gait author, leaving the legacy clips intact.
        for finger, curl in [('Index', .15), ('Middle', .19), ('Ring', .23), ('Pinky', .28), ('Thumb', .15)]:
            for joint in range(1, 3 if finger == 'Thumb' else 4):
                bone = arm.pose.bones.get(f'mixamorig:{side}Hand{finger}{joint}')
                if bone:
                    bone.rotation_quaternion = Quaternion((1,0,0), -sign*curl*strength)
    bpy.context.view_layer.update()
    forward = state['space'] @ Vector((0,-1,0))
    for side in ['Left','Right']:
        thigh, shin, foot = [arm.pose.bones['mixamorig:'+side+n] for n in ['UpLeg','Leg','Foot']]
        anchor, rotation = state['feet'][side]
        y, lift, pitch, planted = targets[side]
        inward = (-.015 if side == 'Left' else .015) if not approach else 0.
        goal = anchor + state['space'] @ Vector((inward,y,lift))
        hip, knee, ankle = thigh.head.copy(), shin.head.copy(), foot.head.copy()
        upper, lower = (knee-hip).length, (ankle-knee).length
        axis = goal-hip
        reach = min(upper+lower-1e-8, max(abs(upper-lower)+1e-8,axis.length))
        axis.normalize()
        along = (upper*upper-lower*lower+reach*reach)/(2*reach)
        height = math.sqrt(max(0.,upper*upper-along*along))
        pole = (forward-axis*forward.dot(axis)).normalized()
        target_knee = hip+axis*along+pole*height
        orient(thigh,(knee-hip).rotation_difference(target_knee-hip))
        orient(shin,(foot.head-shin.head).rotation_difference(goal-shin.head))
        world_pitch = Quaternion((state['space'] @ Vector((1,0,0))).normalized(),pitch)
        orient(foot,world_pitch @ rotation @ foot.matrix.to_quaternion().inverted())
    # Lift each front panel from the solved thigh angle, including the stance
    # leg's forward reach. Negative world X is the forward swing direction.
    forward_angles = {}
    for side in ['Left','Right']:
        bone = arm.pose.bones['mixamorig:'+side+'UpLeg']
        direction = arm.matrix_world.to_3x3() @ (bone.tail-bone.head)
        forward_angles[side] = max(0.,math.atan2(-direction.y,-direction.z))
    for chain, amount in [('Dress_Front',max(forward_angles.values())),
                          ('Dress_Front_L',forward_angles['Left']),('Dress_Front_R',forward_angles['Right'])]:
        rotate(arm,chain+'_01',(1,0,0),-.95*amount)
        rotate(arm,chain+'_02',(1,0,0),.18*amount)
        rotate(arm,chain+'_03',(1,0,0),.10*amount)
    bpy.context.view_layer.update()
    return forward_angles
