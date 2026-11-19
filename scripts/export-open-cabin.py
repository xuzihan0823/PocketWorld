"""Export the editable cabin collections after opening assets/models/cabin/open-cabin.blend."""
from pathlib import Path

import bpy


PARTS = {
    "01": "Shell",
    "02": "Floor_Parquet",
    "03": "Wardrobe_Nightstand",
    "04": "Stationery",
    "05": "Shelf_Gallery",
    "06": "Rugs",
}
root = Path(__file__).resolve().parents[1]
for collection in bpy.context.scene.collection.children:
    name = PARTS.get(collection.name[:2])
    if name is None:
        continue
    objects = list(collection.objects)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.convert(target="MESH")
    if len(objects) > 1:
        bpy.ops.object.join()
    bpy.context.object.name = name

bpy.ops.export_scene.gltf(
    filepath=str(root / "assets/public/models/cabin/open-cabin.glb"),
    export_format="GLB",
    export_yup=True,
    export_animations=False,
    export_vertex_color="ACTIVE",
)
