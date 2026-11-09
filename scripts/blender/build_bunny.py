"""Build a new editable bunny in an empty output directory, using Blender Python."""
import argparse
import hashlib
import json
import math
from pathlib import Path
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
from export_bunny import export_bunny

ROOT = Path(__file__).resolve().parents[2]
HEAD_CENTER = Vector((0, -0.003, 0.137))
HEAD_RADIUS = Vector((0.073, 0.051, 0.059))
HEAD_POWER = 2.15


def signed_power(value, exponent):
    return math.copysign(abs(value) ** exponent, value)


def mesh_object(name, vertices, faces, material):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(material)
    mesh.update()
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    for face in mesh.polygons:
        face.use_smooth = True
    uv = mesh.uv_layers.new(name='FabricUV')
    for polygon in mesh.polygons:
        normal = polygon.normal
        axes = (0, 2) if abs(normal.y) >= max(abs(normal.x), abs(normal.z)) else (1, 2) if abs(normal.x) > abs(normal.z) else (0, 1)
        for loop_index in polygon.loop_indices:
            point = mesh.vertices[mesh.loops[loop_index].vertex_index].co
            uv.data[loop_index].uv = (point[axes[0]] * 30, point[axes[1]] * 30)
    return obj


def fabric_normal(output):
    rng = np.random.default_rng(23)
    field = rng.normal(0, 1, (256, 256))
    field = (field * 2 + np.roll(field, 1, 0) + np.roll(field, 1, 1)) / 4
    dx = np.roll(field, 1, 1) - np.roll(field, -1, 1)
    dy = np.roll(field, 1, 0) - np.roll(field, -1, 0)
    normals = np.stack((-dx * 0.23, -dy * 0.23, np.ones_like(field)), axis=-1)
    normals /= np.linalg.norm(normals, axis=-1, keepdims=True)
    pixels = np.ones((256, 256, 4), dtype=np.float32)
    pixels[:, :, :3] = normals * 0.5 + 0.5
    image = bpy.data.images.new('Short plush micro normal', width=256, height=256)
    image.colorspace_settings.name = 'Non-Color'
    image.pixels.foreach_set(pixels.ravel())
    image.filepath_raw = str(output / 'plush-normal.png')
    image.file_format = 'PNG'
    image.save()
    image.pack()
    image.filepath_raw = '//plush-normal.png'
    return image


def material(name, color, roughness=0.7, normal=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.diffuse_color = (*color, 1)
    bsdf = next(node for node in mat.node_tree.nodes if node.type == 'BSDF_PRINCIPLED')
    bsdf.inputs['Base Color'].default_value = (*color, 1)
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Specular IOR Level'].default_value = 0.22
    if normal:
        bsdf.inputs['Sheen Weight'].default_value = 0.3
        bsdf.inputs['Sheen Roughness'].default_value = 0.8
        image_node = mat.node_tree.nodes.new('ShaderNodeTexImage')
        image_node.image = normal
        normal_node = mat.node_tree.nodes.new('ShaderNodeNormalMap')
        normal_node.inputs['Strength'].default_value = 0.35
        mat.node_tree.links.new(image_node.outputs['Color'], normal_node.inputs['Color'])
        mat.node_tree.links.new(normal_node.outputs['Normal'], bsdf.inputs['Normal'])
    return mat


def ellipsoid(name, center, radius, mat, rotation=None, power=2, pear=0, segments=48, rings=32):
    rotation = rotation or Matrix.Identity(3)
    center = Vector(center)
    vertices = [center + rotation @ Vector((0, 0, -radius[2]))]
    for row in range(1, rings):
        latitude = -math.pi / 2 + math.pi * row / rings
        height = signed_power(math.sin(latitude), 2 / power)
        width = math.cos(latitude) ** (2 / power)
        for col in range(segments):
            longitude = math.tau * col / segments
            point = Vector((radius[0] * width * signed_power(math.sin(longitude), 2 / power) * (1 - pear * height),
                            -radius[1] * width * signed_power(math.cos(longitude), 2 / power),
                            radius[2] * height))
            vertices.append(center + rotation @ point)
    vertices.append(center + rotation @ Vector((0, 0, radius[2])))
    top = len(vertices) - 1
    faces = []
    for col in range(segments):
        next_col = (col + 1) % segments
        faces.append((0, 1 + next_col, 1 + col))
        for row in range(rings - 2):
            a = 1 + row * segments + col
            b = 1 + row * segments + next_col
            faces.append((a, b, b + segments, a + segments))
        a = 1 + (rings - 2) * segments + col
        b = 1 + (rings - 2) * segments + next_col
        faces.append((a, b, top))
    return mesh_object(name, vertices, faces, mat)


def front_surface(x, z, center=HEAD_CENTER, radius=HEAD_RADIUS, power=HEAD_POWER):
    remaining = 1 - abs((x - center[0]) / radius[0]) ** power - abs((z - center[2]) / radius[2]) ** power
    if remaining <= 0:
        raise ValueError(f'Surface point outside {x}, {z}')
    return center[1] - radius[1] * remaining ** (1 / power)


def surface_patch(name, center, radii, surface, mat, lift=0.0006, bulge=0.0006, rotation=None):
    rotation = rotation or Matrix.Identity(3)
    vertices = []
    segments, rings = 48, 5
    for back in (False, True):
        for row in range(rings + 1):
            r = row / rings
            count = segments if row else 1
            for col in range(count):
                angle = math.tau * col / segments
                x = center[0] + radii[0] * r * math.sin(angle)
                z = center[1] + radii[1] * r * math.cos(angle)
                y = surface(x, z) - lift - bulge * (1 - r * r) + (0.0004 if back else 0)
                vertices.append(rotation @ Vector((x, y, z)))
    count = 1 + rings * segments
    faces = []
    for offset in (0, count):
        for col in range(segments):
            next_col = (col + 1) % segments
            faces.append((offset, offset + 1 + col, offset + 1 + next_col))
            for row in range(rings - 1):
                a = offset + 1 + row * segments + col
                b = offset + 1 + row * segments + next_col
                faces.append((a, a + segments, b + segments, b))
    edge = 1 + (rings - 1) * segments
    for col in range(segments):
        a = edge + col
        b = edge + (col + 1) % segments
        faces.append((a, b, b + count, a + count))
    return mesh_object(name, vertices, faces, mat)


def tube(name, points, radius, mat, cyclic=False):
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = radius
    curve.bevel_resolution = 2
    curve.resolution_u = 4
    curve.use_fill_caps = True
    spline = curve.splines.new('BEZIER')
    spline.bezier_points.add(len(points) - 1)
    for point, position in zip(spline.bezier_points, points):
        point.co = position
        point.handle_left_type = point.handle_right_type = 'AUTO'
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, curve)
    bpy.context.scene.collection.objects.link(obj)
    curve.materials.append(mat)
    return obj


def eye_band(mat):
    vertices, faces = [], []
    segments = 160
    for col in range(segments):
        angle = math.tau * col / segments
        height = 0.144 + 0.024 * math.sin(angle) + 0.003 * math.cos(angle)
        for offset, thickness in [(-0.0031, 0.0004), (-0.0031, 0.0012), (0.0031, 0.0012), (0.0031, 0.0004)]:
            z = height + offset
            factor = (1 - abs((z - HEAD_CENTER.z) / HEAD_RADIUS.z) ** HEAD_POWER) ** (1 / HEAD_POWER)
            x = HEAD_RADIUS.x * factor * signed_power(math.sin(angle), 2 / HEAD_POWER)
            y = -HEAD_RADIUS.y * factor * signed_power(math.cos(angle), 2 / HEAD_POWER)
            outward = Vector((x / HEAD_RADIUS.x ** 2, y / HEAD_RADIUS.y ** 2, 0)).normalized()
            vertices.append(Vector((x, y + HEAD_CENTER.y, z)) + outward * thickness)
        for edge in range(4):
            a = col * 4 + edge
            b = col * 4 + (edge + 1) % 4
            next_col = ((col + 1) % segments) * 4
            faces.append((a, b, next_col + (edge + 1) % 4, next_col + edge))
    return mesh_object('Bunny_EyepatchStrap', vertices, faces, mat)


def collar(mat, edge_mat):
    vertices, faces, edge = [], [], []
    segments, rings = 144, 5
    for layer in range(2):
        for row in range(rings + 1):
            t = row / rings
            for col in range(segments):
                angle = math.tau * col / segments
                petal = abs(math.sin(3 * angle)) ** 0.65
                outer = 0.86 + 0.14 * petal
                x = math.sin(angle) * ((1 - t) * 0.031 + t * 0.058 * outer)
                y = -math.cos(angle) * ((1 - t) * 0.024 + t * 0.048 * outer)
                z = 0.088 - t * (0.010 + 0.012 * petal) - layer * 0.0016
                vertices.append((x, y, z))
                if layer == 0 and row == rings:
                    edge.append((x, y, z - 0.0001))
    layer_size = (rings + 1) * segments
    for layer in range(2):
        for row in range(rings):
            for col in range(segments):
                a = layer * layer_size + row * segments + col
                b = layer * layer_size + row * segments + (col + 1) % segments
                faces.append((a, b, b + segments, a + segments))
    for row in (0, rings):
        for col in range(segments):
            a = row * segments + col
            b = row * segments + (col + 1) % segments
            faces.append((a, a + layer_size, b + layer_size, b))
    mesh_object('Bunny_SixPetalCollar', vertices, faces, mat)
    tube('Bunny_CollarHem', edge[::2], 0.00065, edge_mat, True)


def build(output):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.name = 'Bunny_Refined'
    normal = fabric_normal(output)
    plush = material('Ivory short plush', (0.89, 0.845, 0.85), 0.88, normal)
    pink = material('Rose pink embroidery', (0.79, 0.24, 0.29), 0.8, normal)
    pink_edge = material('Pink inner ear seam', (0.70, 0.28, 0.31), 0.85)
    cocoa = material('Cocoa felt eyepatch', (0.066, 0.040, 0.030), 0.92, normal)
    face = material('Dark cocoa stitched face', (0.09, 0.055, 0.043), 0.5)
    gold = material('Butter yellow collar', (1.0, 0.52, 0.035), 0.82, normal)
    gold_edge = material('Warm cream collar hem', (1.0, 0.79, 0.31), 0.75)
    star = material('Cream gold embroidered star', (1.0, 0.85, 0.46), 0.7)
    glint = material('Soft eye highlight', (0.97, 0.86, 0.79), 0.35)

    ellipsoid('Bunny_Head', HEAD_CENTER, HEAD_RADIUS, plush, power=HEAD_POWER, segments=64, rings=40)
    ellipsoid('Bunny_PearBody', (0, 0.005, 0.047), (0.052, 0.037, 0.044), plush, pear=0.18)
    for side, sign in [('Right', -1), ('Left', 1)]:
        rotation = Matrix.Rotation(sign * (0.34 if sign < 0 else 0.42), 3, 'Y')
        center = Vector((sign * 0.042, 0.0, 0.228))
        ellipsoid(f'Bunny_Ear_{side}', center, (0.0205, 0.010, 0.065), plush, rotation)
        patch = surface_patch(f'Bunny_InnerEar_{side}', (0, 0.003), (0.0144, 0.049),
                              lambda x, z: front_surface(x, z, (0, 0, 0), (0.0205, 0.010, 0.065), 2), pink, rotation=rotation)
        for vertex in patch.data.vertices:
            vertex.co += center
        seam = []
        for col in range(48):
            angle = math.tau * col / 48
            x, z = 0.0144 * math.sin(angle), 0.003 + 0.049 * math.cos(angle)
            y = front_surface(x, z, (0, 0, 0), (0.0205, 0.010, 0.065), 2) - 0.0005
            seam.append(center + rotation @ Vector((x, y, z)))
        tube(f'Bunny_InnerEarSeam_{side}', seam, 0.00028, pink_edge, True)
        arm_rotation = Vector((sign * 0.65, -0.1, -0.76)).to_track_quat('Z', 'Y').to_matrix()
        ellipsoid(f'Bunny_Arm_{side}', (sign * 0.057, -0.005, 0.068), (0.016, 0.018, 0.025), plush, arm_rotation)
        foot_center = (sign * 0.035, -0.030, 0.022)
        foot_radius = (0.024, 0.024, 0.022)
        ellipsoid(f'Bunny_Foot_{side}', foot_center, foot_radius, plush)
        surface = lambda x, z, c=foot_center: front_surface(x, z, c, foot_radius, 2)
        surface_patch(f'Bunny_PawPad_{side}', (sign * 0.035, 0.017), (0.0108, 0.0085), surface, pink)
        for index, (dx, z) in enumerate([(-0.009, 0.029), (0, 0.033), (0.009, 0.029)]):
            surface_patch(f'Bunny_ToePad_{side}_{index + 1}', (sign * 0.035 + dx, z), (0.0038, 0.0044), surface, pink, bulge=0.0003)
    ellipsoid('Bunny_RoundTail', (0, 0.042, 0.026), (0.020, 0.020, 0.021), plush)
    collar(gold, gold_edge)
    eye_band(cocoa)
    patch_center = (-0.032, 0.145)
    surface_patch('Bunny_RoundEyepatch', patch_center, (0.0235, 0.024), front_surface, cocoa, lift=0.0021, bulge=0.0022)

    star_outline = [(0, 0.014), (0.003, 0.003), (0.012, 0), (0.003, -0.003),
                    (0, -0.014), (-0.003, -0.003), (-0.012, 0), (-0.003, 0.003)]
    vertices = []
    for depth in (0.0048, 0.0052):
        for x, z in star_outline:
            angle = -0.19
            xx = patch_center[0] + x * math.cos(angle) - z * math.sin(angle)
            zz = patch_center[1] + x * math.sin(angle) + z * math.cos(angle)
            vertices.append((xx, front_surface(xx, zz) - depth, zz))
    faces = [tuple(range(7, -1, -1)), tuple(range(8, 16))]
    for index in range(8):
        nxt = (index + 1) % 8
        faces.append((index, nxt, nxt + 8, index + 8))
    star_obj = mesh_object('Bunny_FourPointStar', vertices, faces, star)
    for face_polygon in star_obj.data.polygons:
        face_polygon.use_smooth = False
    surface_patch('Bunny_VisibleEye', (0.035, 0.139), (0.0054, 0.008), front_surface, face, lift=0.0007, bulge=0.0012)
    surface_patch('Bunny_EyeGlint', (0.0335, 0.1424), (0.0012, 0.0016), front_surface, glint, lift=0.0021, bulge=0.0001)
    surface_patch('Bunny_Nose', (0.004, 0.128), (0.0052, 0.0028), front_surface, face, lift=0.0009, bulge=0.001)
    mouth = [[(0.004, 0.126), (0.004, 0.120)],
             [(-0.007, 0.119), (-0.004, 0.116), (0.001, 0.116), (0.004, 0.120)],
             [(0.004, 0.120), (0.007, 0.116), (0.012, 0.116), (0.015, 0.119)]]
    for index, points in enumerate(mouth):
        tube(f'Bunny_Mouth_{index + 1}', [(x, front_surface(x, z) - 0.001, z) for x, z in points], 0.00055, face)
    for side, sign in [('Right', -1), ('Left', 1)]:
        points = []
        for z in np.linspace(0.117, 0.170, 12):
            width = HEAD_RADIUS.x * (1 - abs((z - HEAD_CENTER.z) / HEAD_RADIUS.z) ** HEAD_POWER) ** (1 / HEAD_POWER)
            x = sign * width * 0.89
            y = front_surface(x, z) + 0.00015
            points.append((x, y, z))
        tube(f'Bunny_CheekSeam_{side}', points, 0.00016, plush)

    model = bpy.data.objects.new('Bunny', None)
    scene.collection.objects.link(model)
    parts = [obj for obj in scene.objects if obj != model]
    for obj in parts:
        obj.parent = model
    model['asset_version'] = 'bunny-reference-v2'
    model['front'] = '-Y in Blender, +Z in glTF'
    model['origin'] = 'Floor contact, metres'
    model['reference'] = 'Five-view white bunny plush character sheet supplied by user'
    for name, point in [('Grip_Right', (-0.052, 0, 0.054)), ('Grip_Left', (0.052, 0, 0.054)), ('Support', (0, 0, 0.004))]:
        anchor = bpy.data.objects.new(name, None)
        scene.collection.objects.link(anchor)
        anchor.parent = model
        anchor.location = point
        anchor.empty_display_size = 0.01
        anchor['purpose'] = 'Non-rendered contact marker for carrying animation'
    return model


def stage(model):
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 40
    scene.cycles.use_denoising = True
    scene.render.resolution_x = 900
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.exposure = 0.35
    world = bpy.data.worlds.new('Warm studio')
    world.use_nodes = True
    background = next(node for node in world.node_tree.nodes if node.type == 'BACKGROUND')
    background.inputs['Color'].default_value = (0.53, 0.48, 0.51, 1)
    background.inputs['Strength'].default_value = 0.4
    scene.world = world
    for name, location, energy, size in [('Key', (-0.35, -0.45, 0.55), 3.5, 0.4),
                                         ('Fill', (0.35, -0.2, 0.3), 1.4, 0.3),
                                         ('Rim', (0.10, 0.35, 0.4), 3.5, 0.3)]:
        data = bpy.data.lights.new(name, 'AREA')
        data.energy = energy
        data.shape = 'DISK'
        data.size = size
        light = bpy.data.objects.new(name, data)
        scene.collection.objects.link(light)
        light.location = location
        light.rotation_euler = (Vector((0, 0, 0.13)) - light.location).to_track_quat('-Z', 'Y').to_euler()
    floor_mat = material('Studio warm grey', (0.17, 0.14, 0.155), 0.9)
    bpy.ops.mesh.primitive_plane_add(size=200)
    floor = bpy.context.object
    floor.name = 'Studio floor (excluded from GLB)'
    floor.data.materials.append(floor_mat)
    data = bpy.data.cameras.new('Review Camera')
    camera = bpy.data.objects.new('Review Camera', data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    data.type = 'ORTHO'
    data.ortho_scale = 0.335
    point_camera(0)
    bpy.ops.object.select_all(action='DESELECT')
    model.select_set(True)
    bpy.context.view_layer.objects.active = model


def point_camera(angle, elevation=0.015):
    camera = bpy.context.scene.camera
    camera.location = (math.sin(angle) * 0.7, -math.cos(angle) * 0.7, 0.145 + elevation)
    camera.rotation_euler = (Vector((0, 0, 0.145)) - camera.location).to_track_quat('-Z', 'Y').to_euler()


def export(model, output, reference):
    export_bunny(output / 'luna-bunny-refined.glb')
    if reference:
        collection = bpy.data.collections.new('Reference (hidden from renders)')
        bpy.context.scene.collection.children.link(collection)
        image = bpy.data.images.load(str(reference))
        image.pack()
        image.filepath = '//references/bunny-reference.png'
        obj = bpy.data.objects.new('User supplied five-view reference', None)
        collection.objects.link(obj)
        obj.empty_display_type = 'IMAGE'
        obj.data = image
        obj.empty_display_size = 0.55
        obj.location = (0.4, 0.08, 0.15)
        obj.rotation_euler.x = math.pi / 2
        obj.hide_render = True
        collection.hide_viewport = True
    bpy.ops.wm.save_as_mainfile(filepath=str(output / 'luna-bunny-refined.blend'))
    corners = [obj.matrix_world @ Vector(corner) for obj in model.children if obj.type in {'MESH', 'CURVE'} for corner in obj.bound_box]
    dimensions = [max(point[axis] for point in corners) - min(point[axis] for point in corners) for axis in range(3)]
    manifest = {'asset_version': model['asset_version'], 'blender': bpy.app.version_string,
                'reference_sha256': hashlib.sha256(reference.read_bytes()).hexdigest() if reference else None,
                'export': {'format': 'GLB', 'selection_only': True, 'apply_modifiers': True,
                           'animations': False, 'y_up': True, 'textures': 'embedded'},
                'dimensions_blender_xyz_m': dimensions,
                'contact_markers': ['Grip_Right', 'Grip_Left', 'Support']}
    (output / 'bunny-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'art/resident/generated/bunny')
    parser.add_argument('--reference', type=Path)
    parser.add_argument('--render', action='store_true')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    if any(output.iterdir()):
        raise FileExistsError(f'Refusing to overwrite an existing asset directory: {output}')
    model = build(output)
    stage(model)
    export(model, output, args.reference)
    if args.render:
        for name, angle in [('front', 0), ('front-45', math.pi / 4), ('side', math.pi / 2),
                            ('back-45', math.pi * 3 / 4), ('back', math.pi)]:
            point_camera(angle)
            bpy.context.scene.render.filepath = str(output / f'{name}.png')
            bpy.ops.render.render(write_still=True)


if __name__ == '__main__':
    main()
