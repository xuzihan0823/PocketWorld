"""Export the web mesh from the editable floor-sofa.blend without saving over the source."""
from pathlib import Path

import bpy

root = Path(__file__).resolve().parents[1]
objects = list(bpy.context.scene.objects)
body = next(obj for obj in objects if obj.name.startswith("01 "))
bpy.ops.object.select_all(action="SELECT")
bpy.context.view_layer.objects.active = body
bpy.ops.object.convert(target="MESH")

# Retain the folds and rounded silhouette. Stitches and tassels require fewer facets.
for obj in objects:
    detail = obj.modifiers.new("Web resolution", "DECIMATE")
    if obj.name.startswith("01 "):
        detail.ratio = .52
    elif obj.name.startswith("05 "):
        detail.ratio = .65
    else:
        detail.ratio = .22
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=detail.name)

bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
body.name = "Linen_floor_sofa"
bpy.ops.export_scene.gltf(
    filepath=str(root / "assets/public/models/furniture/floor-sofa.glb"),
    export_format="GLB",
    export_animations=False,
)
