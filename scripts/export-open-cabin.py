"""Export the two deck sets and the observatory shell from open-cabin.blend."""
from pathlib import Path
from math import cos, sin, tau

import bmesh
import bpy


ROOT = Path(__file__).resolve().parents[1]
DIVIDER_X = -1.86  # Keep aligned with cabinLayout.ts.
WINDOW_CUT_X = -2.61  # The leftmost panorama trim is at -2.55 m.
CABIN_LEFT = -6.57
CABIN_RIGHT = 4.24
BEDROOM_FRONT_Z = 1.20  # The rail meets the front face of the return wall.

collections = {collection.name[:2]: list(collection.objects) for collection in bpy.context.scene.collection.children}
depsgraph = bpy.context.evaluated_depsgraph_get()


def copy_mesh(source):
    # Evaluate the authored bevels and bake transforms before cutting in cabin coordinates.
    mesh = bpy.data.meshes.new_from_object(source.evaluated_get(depsgraph), depsgraph=depsgraph)
    mesh.transform(source.matrix_world)
    copy = bpy.data.objects.new(source.name + " deck section", mesh)
    bpy.context.scene.collection.objects.link(copy)
    return copy


def cut_x(obj, x, keep_left, cap=True):
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.bisect_plane(
        bm,
        geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
        dist=0.000001,
        plane_co=(x, 0, 0),
        plane_no=(1, 0, 0),
        clear_inner=not keep_left,
        clear_outer=keep_left,
    )
    bmesh.ops.dissolve_degenerate(bm, dist=0.000002, edges=list(bm.edges))
    if cap:
        cut_edges = [edge for edge in bm.edges if edge.is_boundary
                     and all(abs(vertex.co.x - x) < .00001 for vertex in edge.verts)]
        if cut_edges:
            faces = bmesh.ops.holes_fill(bm, edges=cut_edges)["faces"]
            bmesh.ops.recalc_face_normals(bm, faces=faces)
    if not bm.faces:
        bm.free()
        bpy.data.objects.remove(obj, do_unlink=True)
        return None
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def remap_x(obj, left, right, new_left, new_right):
    scale = (new_right - new_left) / (right - left)
    for vertex in obj.data.vertices:
        vertex.co.x = new_left + (vertex.co.x - left) * scale
    obj.data.update()


def join_as(name, objects):
    objects = [obj for obj in objects if obj is not None]
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.convert(target="MESH")
    if len(objects) > 1:
        bpy.ops.object.join()
    bpy.context.object.name = name


def finish(name, hex_color, roughness=.78):
    srgb = [int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    linear = tuple(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in srgb)
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*linear, 1)
    if mat.node_tree is None:
        mat.use_nodes = True
    shader = next(node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED")
    shader.inputs["Base Color"].default_value = (*linear, 1)
    shader.inputs["Roughness"].default_value = roughness
    return mat


def link_mesh(name, mesh, material):
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    mesh.materials.append(material)
    return obj


def bedroom_box(name, center, size, material, radius=0):
    # Author in room coordinates to match Three.js, then convert to Blender's Z-up.
    x, y, z = center
    sx, sy, sz = size
    mesh = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    for vertex in bm.verts:
        vertex.co.x *= sx
        vertex.co.y *= sz
        vertex.co.z *= sy
    bm.to_mesh(mesh)
    bm.free()
    obj = link_mesh(name, mesh, material)
    obj.location = (x, -z, y)
    if radius:
        bevel = obj.modifiers.new("Softened edges", "BEVEL")
        bevel.width = radius
        bevel.segments = 2
    return obj


def bedroom_return(inner_x, outer_x, back, front, window, material):
    # A continuous wall with a rectangular opening and finished interior jambs.
    left, right, sill, lintel = window
    outline = [(back, -.024), (front, -.024), (front, 3.73), (back, 3.73)]
    opening = [(left, sill), (right, sill), (right, lintel), (left, lintel)]
    vertices = [(x, -z, y) for x in (inner_x, outer_x) for z, y in outline + opening]
    faces = []
    for i in range(4):
        j = (i + 1) % 4
        faces.extend(((i, j, j + 4, i + 4), (i + 8, i + 12, j + 12, j + 8),
                      (i, i + 8, j + 8, j), (i + 4, j + 4, j + 12, i + 12)))
    name = "Bedroom side wall with porthole"
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    return link_mesh(name, mesh, material)


def bedroom_walls():
    parts = []

    def box(name, center, size, material, radius=0):
        parts.append(bedroom_box(name, center, size, material, radius))

    limewash = finish("Bedroom | ivory limewash", "ebe3cf")
    sage = finish("Bedroom | sage painted timber", "879581")
    sage_seams = finish("Bedroom | recessed sage seams", "727f6b")
    maple = finish("Bedroom | matte maple", "bd8a55", .57)
    window_green = finish("Bedroom | window inset", "527166", .62)
    ivory = bpy.data.materials["Porcelain | cut edges"]

    inner_x, outer_x = DIVIDER_X - .015, DIVIDER_X + .096
    wall_x = (inner_x + outer_x) / 2
    back, front = -3.385, BEDROOM_FRONT_Z - .025
    depth = front - back
    wall_z = (back + front) / 2
    rear_right = inner_x + .03
    rear_crown_left, rear_crown_right = CABIN_LEFT - .014, wall_x - .159 / 2
    win_back, win_front, sill, lintel = window = (-2.26, -.96, 1.405, 3.01)
    box("Bedroom rear wall", ((CABIN_LEFT + rear_right) / 2, 1.853, -3.30),
        (rear_right - CABIN_LEFT, 3.754, .20), limewash, .008)
    parts.append(bedroom_return(inner_x, outer_x, back, front, window, limewash))
    box("Rear wall crown", ((rear_crown_left + rear_crown_right) / 2, 3.73, -3.288),
        (rear_crown_right - rear_crown_left, .064, .246), ivory, .014)
    box("Side wall crown", (wall_x, 3.73, wall_z), (.159, .064, depth + .04), ivory, .015)
    box("Side wall edge trim", (wall_x, 1.85, BEDROOM_FRONT_Z - .04), (.155, 3.71, .08), ivory, .012)
    box("Side wall foundation trim", (wall_x, -.115, wall_z), (.16, .192, depth + .03), ivory, .022)
    box("Side baseboard", (inner_x - .015, .082, (-3.20 + front) / 2), (.045, .165, front + 3.20), ivory, .012)

    # Barely raised boards cast fine, tonal shadow lines on the two interior walls.
    first_y, last_y, rows = .161, 1.115, 7
    row_height = (last_y - first_y) / rows
    rear_x = (CABIN_LEFT + inner_x) / 2
    rear_width = inner_x - CABIN_LEFT
    side_z = (-3.19 + front) / 2
    side_width = front + 3.19
    center_y = (first_y + last_y) / 2
    box("Rear wainscot backing", (rear_x, center_y, -3.199), (rear_width, last_y - first_y, .011), sage_seams)
    box("Side wainscot backing", (inner_x - .003, center_y, side_z), (.012, last_y - first_y, side_width), sage_seams)
    for row in range(rows):
        y = first_y + row_height * (row + .5)
        box("Rear wainscot board", (rear_x, y, -3.192), (rear_width, row_height - .004, .023), sage, .003)
        box("Side wainscot board", (inner_x - .009, y, side_z), (.025, row_height - .004, side_width), sage, .003)
    box("Rear dado rail", (rear_x, last_y + .012, -3.181), (rear_width, .036, .035), sage, .008)
    box("Side dado rail", (inner_x - .010, last_y + .012, side_z), (.041, .036, side_width), sage, .008)

    # The aperture opens straight onto the existing sky, with a maple casing and inset mullions.
    aperture_width, aperture_height = win_front - win_back, lintel - sill
    window_z, window_y = (win_back + win_front) / 2, (sill + lintel) / 2
    for z in (win_back, win_front):
        box("Maple window jamb", (wall_x, window_y, z), (.182, aperture_height, .084), maple, .011)
    box("Maple window header", (wall_x, lintel, window_z), (.184, .093, aperture_width + .084), maple, .013)
    box("Deep maple sill", (wall_x - .057, sill, window_z), (.299, .074, aperture_width + .16), maple, .014)
    box("Window center mullion", (wall_x, window_y, window_z), (.067, aperture_height, .041), window_green, .009)
    for y in (sill + aperture_height / 3, sill + aperture_height * 2 / 3):
        box("Window transom", (wall_x, y, window_z), (.067, .035, aperture_width), window_green, .008)

    # One shelf and one small original print dress the rear wall above the bed.
    book_green = finish("Bedroom | muted book cloth", "6e857a")
    book_clay = finish("Bedroom | terracotta book cloth", "b77962")
    paper = finish("Bedroom | warm paper", "e6d5b5")
    shelf_y = 2.17
    box("Maple bed shelf", (-4.05, shelf_y, -3.055), (1.53, .074, .29), maple, .016)
    for x in (-4.55, -3.56):
        box("Shelf cleat", (x, shelf_y - .087, -3.159), (.085, .116, .09), maple, .009)
    for x, height, cover in ((-4.47, .26, book_green), (-4.35, .31, book_clay), (-4.23, .22, maple), (-4.11, .28, book_green)):
        y = shelf_y + .037 + height / 2
        box("Book cover", (x, y, -3.073), (.104, height, .166), cover, .008)
        box("Exposed page block", (x + .004, y, -3.002), (.081, height - .022, .045), paper, .003)
    for index, cover in enumerate((book_clay, book_green)):
        box("Horizontal book", (-3.66, shelf_y + .065 + .054 * index, -3.05), (.31, .054, .19), cover, .007)

    print_x, print_y = -2.94, 2.57
    box("Maple print frame", (print_x, print_y, -3.179), (.445, .57, .055), maple, .014)
    box("Print paper", (print_x, print_y, -3.148), (.377, .495, .017), paper, .004)
    # Flat pigment shapes on the framed paper, kept separate from its bevel.
    sun = [(.086 * cos(tau * i / 24) + .044, .086 * sin(tau * i / 24) + .071) for i in range(24)]
    hills = [(-.155, -.175), (.155, -.175), (.155, -.078), (.047, -.124), (-.056, -.06), (-.155, -.085)]
    for name, points, tint in (("Print sun", sun, book_clay), ("Print landscape", hills, book_green)):
        mesh = bpy.data.meshes.new(name)
        mesh.from_pydata([(print_x + x, 3.138, print_y + y) for x, y in points], [], [tuple(range(len(points)))])
        parts.append(link_mesh(name, mesh, tint))
    return parts


lower_shell = []
upper_shell = []
for source in collections["01"]:
    name = source.name
    if name.startswith("Aft wall"):
        # The panorama straddles the division; fit its complete outline on the desk level.
        lower = cut_x(copy_mesh(source), WINDOW_CUT_X, False)
        remap_x(lower, WINDOW_CUT_X, CABIN_RIGHT, DIVIDER_X, CABIN_RIGHT)
        lower_shell.append(lower)
    elif name.startswith("Panorama"):
        lower = copy_mesh(source)
        remap_x(lower, WINDOW_CUT_X, CABIN_RIGHT, DIVIDER_X, CABIN_RIGHT)
        lower_shell.append(lower)
    elif name.startswith("Port cut edge"):
        lower = copy_mesh(source)
        lower.location.x = DIVIDER_X - CABIN_LEFT
        lower_shell.append(lower)
        upper_shell.append(copy_mesh(source))
    else:
        lower_shell.append(cut_x(copy_mesh(source), DIVIDER_X, False))
        if name.startswith(("Aft skirting", "Parquet substrate", "Rounded porcelain")):
            upper_shell.append(cut_x(copy_mesh(source), DIVIDER_X, True))

upper_shell.extend(bedroom_walls())

parquet = collections["02"][0]
upper_parquet = cut_x(copy_mesh(parquet), DIVIDER_X, True, cap=False)
lower_parquet = cut_x(copy_mesh(parquet), DIVIDER_X, False, cap=False)
bpy.data.objects.remove(parquet, do_unlink=True)
rugs = collections["06"]
lower_rugs = [obj for obj in rugs if obj.location.x >= DIVIDER_X]
upper_rugs = [obj for obj in rugs if obj.location.x < DIVIDER_X]

join_as("Shell", collections["01"])
join_as("Duplex_LowerShell", lower_shell)
join_as("Duplex_UpperShell", upper_shell)
join_as("Floor_Parquet", [lower_parquet])
join_as("Floor_Parquet_Upper", [upper_parquet])
join_as("Wardrobe_Nightstand", collections["03"])
join_as("Stationery", collections["04"])
join_as("Shelf_Gallery", collections["05"])
join_as("Rugs", lower_rugs)
join_as("Rugs_Upper", upper_rugs)

bpy.ops.export_scene.gltf(
    filepath=str(ROOT / "assets/public/models/cabin/open-cabin.glb"),
    export_format="GLB",
    export_yup=True,
    export_animations=False,
    export_vertex_color="ACTIVE",
)
