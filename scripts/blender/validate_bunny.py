"""Check the exported bunny and re-import it for geometry/anchor validation."""
import argparse
import hashlib
import json
from pathlib import Path
import struct
import sys

import bpy
import bmesh
from mathutils import Vector


def validate(runtime, report_path):
    blob = runtime.read_bytes()
    magic, version, length = struct.unpack_from('<4sII', blob)
    assert magic == b'glTF' and version == 2 and length == len(blob)
    json_length = struct.unpack_from('<I', blob, 12)[0]
    document = json.loads(blob[20:20 + json_length])
    assert len(document['scenes']) == 1
    assert len(document['meshes']) == 1
    assert not document.get('skins') and not document.get('animations')
    assert all('uri' not in image for image in document.get('images', []))
    assert all('uri' not in buffer for buffer in document['buffers'])
    assert {node['name'] for node in document['nodes']} == {
        'Bunny', 'Bunny_Surface', 'Grip_Left', 'Grip_Right', 'Support'}
    primitive_count = len(document['meshes'][0]['primitives'])
    assert primitive_count <= 10
    assert any('normalTexture' in material for material in document['materials'])
    source_scene = bpy.context.scene
    source_root = source_scene.objects['Bunny']
    assert source_root.get('asset_version') == 'bunny-reference-v2'
    required_parts = ['Bunny_Head', 'Bunny_RoundTail', 'Bunny_FourPointStar',
                      'Bunny_EyepatchStrap', 'Bunny_SixPetalCollar']
    assert all(source_scene.objects.get(name) for name in required_parts)
    imported_scene = bpy.data.scenes.new('Bunny roundtrip validation')
    bpy.context.window.scene = imported_scene
    bpy.ops.import_scene.gltf(filepath=str(runtime))
    meshes = [obj for obj in imported_scene.objects if obj.type == 'MESH']
    assert len(meshes) == 1
    mesh = meshes[0]
    bm = bmesh.new()
    bm.from_mesh(mesh.data)
    raw_vertices = len(bm.verts)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=1e-7)
    boundary = sum(edge.is_boundary for edge in bm.edges)
    nonmanifold = sum(not edge.is_manifold for edge in bm.edges)
    zero_area = sum(face.calc_area() < 1e-13 for face in bm.faces)
    assert boundary == 0, f'{boundary} open edges'
    assert nonmanifold == 0, f'{nonmanifold} nonmanifold edges'
    assert zero_area == 0, f'{zero_area} degenerate faces'
    triangles = sum(len(face.verts) - 2 for face in bm.faces)
    bm.free()
    corners = [mesh.matrix_world @ Vector(corner) for corner in mesh.bound_box]
    minimum = [min(point[axis] for point in corners) for axis in range(3)]
    maximum = [max(point[axis] for point in corners) for axis in range(3)]
    assert abs(minimum[2]) < 1e-5, f'Origin is not on the floor: {minimum}'
    assert 0.27 < maximum[2] < 0.31
    anchors = {}
    for name in ('Grip_Right', 'Grip_Left', 'Support'):
        original = source_scene.objects[name]
        imported = next(obj for obj in imported_scene.objects if obj.name.split('.')[0] == name)
        assert (original.matrix_world.translation - imported.matrix_world.translation).length < 1e-6
        anchors[name] = list(imported.matrix_world.translation)
    report = {'blender': bpy.app.version_string, 'runtime_sha256': hashlib.sha256(blob).hexdigest(),
              'runtime_bytes': len(blob), 'runtime_meshes': len(meshes), 'material_draw_calls': primitive_count,
              'triangles': triangles, 'vertices_with_uv_seams': raw_vertices,
              'boundary_edges_after_welding_uv_seams': boundary,
              'nonmanifold_edges_after_welding_uv_seams': nonmanifold,
              'zero_area_faces': zero_area, 'bounds_blender_xyz_m': [minimum, maximum],
              'contact_markers_blender_xyz_m': anchors,
              'textures_embedded': True, 'roundtrip': 'passed'}
    report_path.write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))
    bpy.context.window.scene = source_scene
    bpy.data.scenes.remove(imported_scene)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--runtime', required=True, type=Path)
    parser.add_argument('--report', required=True, type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    validate(args.runtime, args.report)


if __name__ == '__main__':
    main()
