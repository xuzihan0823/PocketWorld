"""Baked world-space foot targets shared by Walk and the sit approach.

Walk is an in-place 1.2 s loop at 0.20 model units/s. A host must advance
its root by that distance (or scale clip time with measured travel).
"""
import math
import bpy
from mathutils import Vector, Quaternion

PERIOD = 1.2
SPEED = .20
STANCE = 2 / 3
APPROACH_END = 2.1
STEPS = [('Left', .08, .50, .25, .17), ('Right', .58, .99, .25, .09),
         ('Left', 1.07, 1.48, .17, 0.), ('Right', 1.56, 1.98, .09, 0.)]


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
        y = .25
        for which, start, end, before, after in STEPS:
            if which != side:
                continue
            if t >= end:
                y = after
            elif t > start:
                u = (t-start)/(end-start)
                return swing(u, before, after)
        return y, 0., 0., True
    # Deliberate walk: 2/3 stance, 1/3 swing. Both contact boundaries align
    # with 30 fps keys, preventing interpolation across a support switch.
    phase = (t/PERIOD + (0 if side == 'Left' else .5)) % 1
    half = SPEED * PERIOD * STANCE / 2
    if phase <= STANCE:
        return -half + SPEED*PERIOD*phase, 0., 0., True
    return swing((phase-STANCE)/(1-STANCE), half, -half)


def swing(u, start, end):
    blend = smooth(u)
    # Zero vertical velocity on both contacts. Pitch rolls from toe-off to
    # dorsiflexion, then returns to the exact flat-foot landing orientation.
    lift = .026 * math.sin(math.pi*u)**2
    pitch = .22 * math.sin(math.tau*u) * math.sin(math.pi*u)**2
    return start + (end-start)*blend, lift, pitch, False


def apply(state, t, approach=False):
    arm = state['arm']
    for bone in arm.pose.bones:
        bone.matrix_basis.identity()
    strength = smooth(t/.18) * (1-smooth((t-1.85)/.25)) if approach else 1.
    phase = math.tau*t/PERIOD
    offset = .25*(1-smooth(t/1.98)) if approach else 0.
    bob = ((-.009 if approach else -.019) + .004*math.cos(2*phase)) * strength
    hips = arm.pose.bones['mixamorig:Hips']
    hips.location = state['hip_space'] @ Vector((.003*math.sin(phase)*strength, offset, bob))
    rotate(arm, 'mixamorig:Hips', (0,0,1), .035*math.sin(phase)*strength)
    rotate(arm, 'mixamorig:Spine', (0,0,1), -.018*math.sin(phase)*strength)
    for side, sign in [('Left',1),('Right',-1)]:
        rotate(arm, 'mixamorig:'+side+'Arm', (0,1,0), sign*.29*strength)
        rotate(arm, 'mixamorig:'+side+'Arm', (1,0,0), sign*.15*math.sin(phase)*strength)
        rotate(arm, 'mixamorig:'+side+'ForeArm', (1,0,0), (-.16-.035*sign*math.sin(phase))*strength)
    bpy.context.view_layer.update()
    forward = state['space'] @ Vector((0,-1,0))
    for side in ['Left','Right']:
        thigh, shin, foot = [arm.pose.bones['mixamorig:'+side+n] for n in ['UpLeg','Leg','Foot']]
        anchor, rotation = state['feet'][side]
        y, lift, pitch, planted = target(t, side, approach)
        goal = anchor + state['space'] @ Vector((0,y,lift))
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
