"""Export the two deck sets and the observatory shell from open-cabin.blend."""
from pathlib import Path
from math import cos, pi, sin, tau

import bmesh
import bpy
import numpy as np
from mathutils import Matrix


ROOT = Path(__file__).resolve().parents[1]
DIVIDER_X = -1.86  # Keep aligned with cabinLayout.ts.
WINDOW_CUT_X = -2.61  # The leftmost panorama trim is at -2.55 m.
CABIN_LEFT = -6.57
CABIN_RIGHT = 4.24
BEDROOM_FRONT_Z = 3.16
BEDROOM_EXTENSION = 1.26  # The upper floor spans the same exterior wall plane as the lower floor.
BEDROOM_LEFT = CABIN_LEFT - BEDROOM_EXTENSION
UPPER_DECK_X = DIVIDER_X - BEDROOM_LEFT
UPPER_RIGHT_X = CABIN_RIGHT - UPPER_DECK_X

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
    return bpy.context.object


def join_shell(name, parts):
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    for side, meshes in parts.items():
        joined = join_as(name + side, meshes)
        joined.parent = root
    return root


def finish_wardrobe_mesh(obj):
    # The authored bevels collapse at a few corners. Weld before exporting the moving parts.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=.00001)
    bmesh.ops.dissolve_degenerate(bm, edges=list(bm.edges), dist=.00001)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.normal_update()
    uv = bm.loops.layers.uv.verify()
    for face in bm.faces:
        # Boolean cuts and new shelf bevels need UVs. Preserve the original panel grain.
        a, b, c = (loop[uv].uv for loop in face.loops)
        if abs((b - a).cross(c - a)) < 1e-10:
            normal = face.normal
            axis = max(range(3), key=lambda i: abs(normal[i]))
            for loop in face.loops:
                point = loop.vert.co
                loop[uv].uv = (point[(axis + 1) % 3], point[(axis + 2) % 3])
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()


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

    limewash = finish("Bedroom | ivory limewash", "f4efe5")
    sage = finish("Bedroom | sage painted timber", "7e9684")
    sage_seams = finish("Bedroom | recessed sage seams", "667d6c")
    maple = finish("Bedroom | pale oak", "d6b68e", .57)
    window_green = finish("Bedroom | eucalyptus window inset", "4f6d60", .60)
    ivory = bpy.data.materials["Porcelain | cut edges"]

    inner_x, outer_x = DIVIDER_X - .015, UPPER_RIGHT_X
    wall_x = (inner_x + outer_x) / 2
    back, front = -3.385, BEDROOM_FRONT_Z - .025
    depth = front - back
    wall_z = (back + front) / 2
    rear_left = BEDROOM_LEFT - .016
    trim_left, trim_right = inner_x - .024, outer_x + .006
    trim_width, trim_x = trim_right - trim_left, (trim_left + trim_right) / 2
    rear_crown_left, rear_crown_right = rear_left - .02, trim_left
    win_back, win_front, sill, lintel = window = (1.69, 2.99, 1.405, 3.01)
    rear_x = (rear_left + inner_x) / 2
    rear_width = inner_x - rear_left
    box("Bedroom rear wall", (rear_x, 1.853, -3.30), (rear_width, 3.754, .20), limewash, .008)
    parts.append(bedroom_return(inner_x, outer_x, back, front, window, limewash))
    box("Rear wall crown", ((rear_crown_left + rear_crown_right) / 2, 3.73, -3.288),
        (rear_crown_right - rear_crown_left, .064, .246), ivory, .014)
    box("Side wall crown", (trim_x, 3.73, wall_z), (trim_width, .064, depth + .04), ivory, .015)
    box("Side wall edge trim", (trim_x, 1.85, BEDROOM_FRONT_Z - .025), (trim_width, 3.71, .098), ivory, .012)

    # Barely raised boards cast fine, tonal shadow lines on the two interior walls.
    first_y, last_y, rows = .161, 1.115, 7
    row_height = (last_y - first_y) / rows
    center_y = (first_y + last_y) / 2
    box("Rear wainscot backing", (rear_x, center_y, -3.199), (rear_width, last_y - first_y, .011), sage_seams)
    for row in range(rows):
        y = first_y + row_height * (row + .5)
        box("Rear wainscot board", (rear_x, y, -3.192), (rear_width, row_height - .004, .023), sage, .003)
    box("Rear dado rail", (rear_x, last_y + .012, -3.181), (rear_width, .036, .035), sage, .008)
    side_z, side_width = (front - 3.19) / 2, front + 3.19
    box("Side baseboard", (inner_x - .015, .082, side_z), (.045, .165, side_width), ivory, .012)
    box("Side wainscot backing", (inner_x - .003, center_y, side_z), (.012, last_y - first_y, side_width), sage_seams)
    for row in range(rows):
        y = first_y + row_height * (row + .5)
        box("Side wainscot board", (inner_x - .009, y, side_z), (.025, row_height - .004, side_width), sage, .003)
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
    book_green = finish("Bedroom | sage book cloth", "6b8a7d")
    book_clay = finish("Bedroom | coral book cloth", "d98b82")
    paper = finish("Bedroom | warm paper", "f4eee3")
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


def create_lower_sea_salt_rug():
    """Author a crisp low-profile sea-salt woven cotton rug with braided border & cream fringe on Floor 1."""
    # Woven cotton albedo texture (512x512): sea-salt field + ice-mist stripe + ivory outer border.
    sz = 512
    yy, xx = np.mgrid[0:sz, 0:sz].astype(np.float32) / float(sz)
    # Fine orthogonal cotton basketweave grain
    warp = np.sin(xx * tau * 96.0) * 0.5 + 0.5
    weft = np.sin(yy * tau * 84.0) * 0.5 + 0.5
    weave = (warp * 0.52 + weft * 0.48 - 0.5) * 0.042
    slub = np.sin(xx * tau * 17.0 + np.sin(yy * tau * 9.0) * 0.6) * 0.012
    # Distance to nearest rug edge in UV space [0..0.5]
    edge = np.minimum(np.minimum(xx, 1.0 - xx), np.minimum(yy, 1.0 - yy))
    # Subtle soft geometric diamond/stripe motif inside the sea-salt field
    stripe_band = ((edge >= 0.072) & (edge < 0.106)).astype(np.float32)
    outer_border = (edge < 0.056).astype(np.float32)
    pin_line = ((edge >= 0.056) & (edge < 0.064)).astype(np.float32)
    # Delicate diagonal herringbone weave modulation inside the main field
    chevron = np.sin((xx * 26.0 + np.abs((yy * 18.0) % 2.0 - 1.0) * 2.0) * tau) * 0.014

    base_r = np.full((sz, sz), 0.305, dtype=np.float32) + chevron
    base_g = np.full((sz, sz), 0.432, dtype=np.float32) + chevron * 0.9
    base_b = np.full((sz, sz), 0.542, dtype=np.float32) + chevron * 0.78

    # Warm honey-mustard woven inner framing band (#D4AC65)
    base_r = base_r * (1.0 - stripe_band) + 0.832 * stripe_band
    base_g = base_g * (1.0 - stripe_band) + 0.675 * stripe_band
    base_b = base_b * (1.0 - stripe_band) + 0.396 * stripe_band
    # Thin deep indigo pinstripe (#2F465C)
    base_r = base_r * (1.0 - pin_line) + 0.185 * pin_line
    base_g = base_g * (1.0 - pin_line) + 0.275 * pin_line
    base_b = base_b * (1.0 - pin_line) + 0.362 * pin_line
    # Warm cream-ivory woven outer border (#F0EAE0)
    base_r = base_r * (1.0 - outer_border) + 0.942 * outer_border
    base_g = base_g * (1.0 - outer_border) + 0.916 * outer_border
    base_b = base_b * (1.0 - outer_border) + 0.876 * outer_border

    rgba = np.ones((sz, sz, 4), dtype=np.float32)
    rgba[..., 0] = np.clip(base_r + weave + slub, 0.0, 1.0)
    rgba[..., 1] = np.clip(base_g + weave + slub * 0.9, 0.0, 1.0)
    rgba[..., 2] = np.clip(base_b + weave + slub * 0.8, 0.0, 1.0)

    img = bpy.data.images.new("SeaSalt_Rug_Weave", width=sz, height=sz, alpha=False)
    img.colorspace_settings.name = "sRGB"
    img.pixels.foreach_set(rgba.ravel())
    img.pack()

    rug_mat = bpy.data.materials.new("Rug | sea-salt cotton weave")
    rug_mat.use_nodes = True
    nt = rug_mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = 0.92
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])

    fringe_mat = finish("Rug | ivory cotton fringe", "efeae1", roughness=0.94)

    # Rounded-rectangle flatweave body: Three.js X in [-1.01, +2.31], Z in [-1.21, +1.65]
    # Blender coords: X = Three.js X, Y = -Three.js Z, Z = Three.js Y
    cx, cy = 0.65, -0.22
    hx, hy = 1.66, 1.43
    corner = 0.22
    arc_steps = 6
    ring = []
    corners = [
        (hx - corner, hy - corner, 0.0),
        (-hx + corner, hy - corner, pi * 0.5),
        (-hx + corner, -hy + corner, pi),
        (hx - corner, -hy + corner, pi * 1.5),
    ]
    for ox, oy, a0 in corners:
        for s in range(arc_steps + 1):
            ang = a0 + (pi * 0.5) * (s / arc_steps)
            ring.append((ox + corner * cos(ang), oy + corner * sin(ang)))

    bm = bmesh.new()
    n = len(ring)
    # Outer skirt rests cleanly just above Floor_Parquet (0.0005 m) and ramps gently to 0.0045 m top
    bot_verts = [bm.verts.new((cx + px, cy + py, 0.0005)) for px, py in ring]
    top_verts = [bm.verts.new((cx + px * 0.988, cy + py * 0.988, 0.0045)) for px, py in ring]
    center_v = bm.verts.new((cx, cy, 0.0048))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot_verts[i], bot_verts[j], top_verts[j], top_verts[i]))
        bm.faces.new((top_verts[i], top_verts[j], center_v))
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    # Match the existing UV layer name ("UVMap") on open-cabin.blend rugs so join_as merges UVs cleanly.
    uv_layer = bm.loops.layers.uv.new("UVMap")
    for face in bm.faces:
        face.smooth = False
        for loop in face.loops:
            co = loop.vert.co
            u = max(0.0, min(1.0, (co.x - (cx - hx)) / (2.0 * hx)))
            v = max(0.0, min(1.0, (co.y - (cy - hy)) / (2.0 * hy)))
            loop[uv_layer].uv = (u, v)

    mesh = bpy.data.meshes.new("Lower_SeaSalt_Rug")
    bm.to_mesh(mesh)
    bm.free()
    rug_obj = link_mesh("Lower_SeaSalt_Rug", mesh, rug_mat)

    # Subtle woven ivory cotton fringe along the left (-X) and right (+X) straight edges
    parts = [rug_obj]
    tassel_count = 26
    y_span = (hy - corner - 0.05) * 2.0
    for side in (-1, 1):
        edge_x = cx + side * (hx + 0.032)
        for idx in range(tassel_count):
            ty = cy - y_span * 0.5 + y_span * (idx + 0.5) / tassel_count
            parts.append(bedroom_box(
                f"Rug fringe {side}_{idx}",
                (edge_x, 0.0018, -ty),
                (0.068, 0.0026, 0.022),
                fringe_mat,
                0.0008,
            ))
    return parts


deck_base = []
lower_shell = {"Back": [], "Right": [], "FloorTrim": []}
upper_shell = {"Back": [], "Right": []}
for source in collections["01"]:
    name = source.name
    if name.startswith("Aft wall"):
        # The panorama straddles the division; fit its complete outline on the desk level.
        lower = cut_x(copy_mesh(source), WINDOW_CUT_X, False)
        remap_x(lower, WINDOW_CUT_X, CABIN_RIGHT, DIVIDER_X, CABIN_RIGHT)
        lower_shell["Back"].append(lower)
    elif name.startswith("Panorama"):
        lower = copy_mesh(source)
        remap_x(lower, WINDOW_CUT_X, CABIN_RIGHT, DIVIDER_X, CABIN_RIGHT)
        lower_shell["Back"].append(lower)
    elif name.startswith("Port cut edge"):
        lower = copy_mesh(source)
        lower.location.x = DIVIDER_X - CABIN_LEFT
        lower_shell["Back"].append(lower)
        upper = copy_mesh(source)
        upper.location.x = -BEDROOM_EXTENSION
        upper_shell["Back"].append(upper)
    elif name.startswith("Rounded porcelain"):
        deck_base.append(cut_x(copy_mesh(source), DIVIDER_X, False))
    elif name.startswith("Parquet substrate"):
        # Recess the substrate's cut face from the porcelain fascia.
        deck_base.append(cut_x(copy_mesh(source), DIVIDER_X + .006, False))
    else:
        side = "Right" if name.startswith("Starboard") else "FloorTrim" if name.startswith("Underside") else "Back"
        lower_shell[side].append(cut_x(copy_mesh(source), DIVIDER_X, False))
        if name.startswith("Aft skirting"):
            upper = cut_x(copy_mesh(source), DIVIDER_X, True)
            remap_x(upper, CABIN_LEFT, DIVIDER_X, BEDROOM_LEFT, DIVIDER_X)
            upper_shell["Back"].append(upper)

for part in bedroom_walls():
    side = "Right" if part.name.startswith(("Bedroom side", "Side", "Maple window", "Deep maple sill", "Window")) else "Back"
    upper_shell[side].append(part)

parquet = collections["02"][0]
upper_parquet = cut_x(copy_mesh(parquet), DIVIDER_X, True, cap=False)
lower_parquet = cut_x(copy_mesh(parquet), DIVIDER_X, False, cap=False)
bpy.data.objects.remove(parquet, do_unlink=True)
rugs = collections["06"]
lower_rugs = [obj for obj in rugs if obj.location.x >= DIVIDER_X]
lower_rugs.extend(create_lower_sea_salt_rug())
upper_rugs = [obj for obj in rugs if obj.location.x < DIVIDER_X]
wardrobe_prefixes = ("Wardrobe", "Sliding panel", "Recessed brass pull", "Pull inset")
wardrobe = [obj for obj in collections["03"] if obj.name.startswith(wardrobe_prefixes)]
nightstand = [obj for obj in collections["03"] if obj not in wardrobe]
# Pivot the cupboard off its original rear wall and face into the bedroom from its right wall.
turn_wardrobe = (
    Matrix.Translation((-2.33, -.75, 0))
    @ Matrix.Rotation(-pi / 2, 4, "Z")
    @ Matrix.Translation((5.72, -2.76, 0))
)
for obj in wardrobe:
    obj.matrix_world = turn_wardrobe @ obj.matrix_world

join_as("Shell", collections["01"])
join_shell("Duplex_LowerShell", lower_shell)
join_shell("Duplex_UpperShell", upper_shell)
join_as("Floor_Parquet_Upper", [upper_parquet])
base = join_as("Duplex_DeckBase", deck_base)
floor = join_as("Floor_Parquet", [lower_parquet])
# Both decks use the same slab and floor meshes. Offset the bedroom copies
# back into their authored coordinates before the runtime deck translation.
for part, name in ((base, "Duplex_BedroomBase"), (floor, "Floor_Parquet_Bedroom")):
    bedroom_part = part.copy()
    bedroom_part.name = name
    bpy.context.scene.collection.objects.link(bedroom_part)
    bedroom_part.location.x -= UPPER_DECK_X
# The front leaf rides out onto a parallel track, then slides over the rear leaf.
moving_leaf = [obj for obj in wardrobe if obj.name in ("Sliding panel 1", "Pull inset.001", "Recessed brass pull.001")]
frame_parts = [obj for obj in wardrobe if obj not in moving_leaf]
door = join_as("Wardrobe_SlidingDoor", moving_leaf)
carcass = next(obj for obj in frame_parts if "carcass" in obj.name)
shadow = next(obj for obj in frame_parts if "shadow reveal" in obj.name)
frame_parts.remove(shadow)
bpy.data.objects.remove(shadow, do_unlink=True)
oak = carcass.data.materials[0]
# Cut a real cavity into the original bent-oak case, keeping its exterior bevels.
cutter = bedroom_box("Wardrobe cavity cutter", (-2.56, 1.53, .75), (1.04, 2.86, 1.34), oak)
bpy.context.view_layer.objects.active = carcass
for modifier in list(carcass.modifiers):
    bpy.ops.object.modifier_apply(modifier=modifier.name)
cut = carcass.modifiers.new("Cupboard interior", "BOOLEAN")
cut.operation = "DIFFERENCE"
cut.object = cutter
bpy.ops.object.modifier_apply(modifier=cut.name)
bpy.data.objects.remove(cutter, do_unlink=True)
# Rebate behind the sliding leaves. It overlaps their edges in elevation, with
# a 4 mm running clearance in depth, so the closed door hides the compartment.
for z in (.092, 1.408):
    frame_parts.append(bedroom_box("Wardrobe door jamb", (-2.681, 1.53, z),
                                   (.073, 2.86, .064), oak, .003))
for y in (.115, 2.945):
    frame_parts.append(bedroom_box("Wardrobe door rail", (-2.681, y, .75),
                                   (.073, .055, 1.265), oak, .003))
frame_parts.append(bedroom_box("Fixed door meeting strip", (-2.706, 1.52, .748),
                               (.026, 2.81, .046), oak, .002))
shelf_maple = bpy.data.materials.get("Pale maple edging") or oak
for height in (.50, 1.27, 2.04):
    frame_parts.append(bedroom_box("Linen shelf", (-2.36, height, .75), (.61, .035, 1.34), shelf_maple, .008))
linen = [finish("Linen | " + name, color, .96) for name, color in
         (("sage", "8aa392"), ("cream", "f3ede3"), ("terracotta", "d69288"))]
for level, height in enumerate((.50, 1.27, 2.04)):
    for layer in range(3 - level % 2):
        frame_parts.append(bedroom_box("Folded linen", (-2.39, height + .062 + layer * .089,
                                       1.05 + .012 * layer), (.42, .088, .48 - .018 * layer),
                                       linen[(level + layer) % len(linen)], .034))
frame = join_as("Wardrobe_Case", frame_parts)
# Keep children in room axes so the travel is authored in metres.
root = bpy.data.objects.new("Interactable_Wardrobe", None)
bpy.context.scene.collection.objects.link(root)
for part in (frame, door):
    finish_wardrobe_mesh(part)
    part.parent = root

join_as("Nightstand", nightstand)
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
