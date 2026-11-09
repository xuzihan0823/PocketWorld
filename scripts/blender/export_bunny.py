"""Export the editable Bunny hierarchy without including its review stage."""
import argparse
from pathlib import Path
import sys

import bpy


def export_bunny(output):
    output = Path(output).resolve()
    if output.exists():
        raise FileExistsError(f'Refusing to overwrite {output}')
    output.parent.mkdir(parents=True, exist_ok=True)
    source = bpy.context.scene.objects.get('Bunny')
    if source is None or source.get('asset_version') != 'bunny-reference-v2':
        raise ValueError('Open the refined bunny source scene before exporting')
    parts = [obj for obj in source.children if obj.type in {'MESH', 'CURVE'}]
    bpy.ops.object.select_all(action='DESELECT')
    for obj in parts:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.duplicate()
    bpy.ops.object.convert(target='MESH')
    duplicates = list(bpy.context.selected_objects)
    try:
        bpy.ops.object.join()
        combined = bpy.context.object
        combined.name = 'Bunny_Surface'
        duplicates = [combined]
        source.select_set(True)
        for obj in source.children:
            if obj.type == 'EMPTY':
                obj.select_set(True)
        bpy.ops.export_scene.gltf(filepath=str(output), use_selection=True,
                                 export_animations=False, export_extras=True, export_apply=True,
                                 export_yup=True, export_image_format='AUTO')
    finally:
        for obj in duplicates:
            if obj.name in bpy.data.objects:
                mesh = obj.data
                bpy.data.objects.remove(obj, do_unlink=True)
                if mesh.users == 0:
                    bpy.data.meshes.remove(mesh)
        bpy.ops.object.select_all(action='DESELECT')
        source.select_set(True)
        bpy.context.view_layer.objects.active = source


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True, type=Path)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    export_bunny(args.output)


if __name__ == '__main__':
    main()
