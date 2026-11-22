"""Export the two deck sets and the observatory shell from open-cabin.blend."""
from pathlib import Path
from math import cos, hypot, pi, sin, tau
import sys

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


LOWER_RUG_CENTER = (0.65, -0.22)  # Blender XY (Three.js X=0.65, Z=0.22)
LOWER_RUG_HALF = (1.66, 1.43)
LOWER_RUG_CORNER = 0.30
UPPER_RUG_CENTER = (-4.05, -0.115)  # Blender XY (Three.js X=-4.05, Z=0.115)
UPPER_RUG_RADII = (1.08, 0.62)
LEGACY_UPPER_RUG_NAMES = {
    "Oval bedside rug",
    "Braided border",
    "Braided border.001",
    "Braided border.002",
    "Braided border.003",
}


def _blur2d(arr, passes=1):
    out = arr.astype(np.float32, copy=True)
    for _ in range(passes):
        out = (
            out * 0.25
            + (np.roll(out, 1, 0) + np.roll(out, -1, 0) + np.roll(out, 1, 1) + np.roll(out, -1, 1)) * 0.125
            + (
                np.roll(np.roll(out, 1, 0), 1, 1)
                + np.roll(np.roll(out, 1, 0), -1, 1)
                + np.roll(np.roll(out, -1, 0), 1, 1)
                + np.roll(np.roll(out, -1, 0), -1, 1)
            )
            * 0.0625
        )
    return out


def _plush_tuft_fields(sz, cell_nx, cell_ny, seed):
    """Vectorized Voronoi plush wool tuft field + combed nap wave + microfiber grain."""
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:sz, 0:sz].astype(np.float32) / float(sz)

    # Low-frequency combed plush nap swirl (gives soft velvety light/dark patches)
    nap_u = _blur2d(rng.normal(0.0, 1.0, (sz // 4, sz // 4)), 6)
    nap_v = _blur2d(rng.normal(0.0, 1.0, (sz // 4, sz // 4)), 6)
    nap_u = np.repeat(np.repeat(nap_u, 4, axis=0), 4, axis=1)[:sz, :sz]
    nap_v = np.repeat(np.repeat(nap_v, 4, axis=0), 4, axis=1)[:sz, :sz]
    nap_u = _blur2d(nap_u, 3)
    nap_v = _blur2d(nap_v, 3)
    nap_norm = np.sqrt(nap_u * nap_u + nap_v * nap_v + 1e-4)
    nap_dx = nap_u / nap_norm
    nap_dy = nap_v / nap_norm

    # Subtle warp of tuft coordinates along combed nap direction
    gx = xx * cell_nx + nap_dx * 0.18
    gy = yy * cell_ny + nap_dy * 0.18
    ix = np.floor(gx).astype(np.int32)
    iy = np.floor(gy).astype(np.int32)

    jx_grid = rng.uniform(0.14, 0.86, (cell_ny, cell_nx)).astype(np.float32)
    jy_grid = rng.uniform(0.14, 0.86, (cell_ny, cell_nx)).astype(np.float32)
    rand_grid = rng.uniform(0.0, 1.0, (cell_ny, cell_nx)).astype(np.float32)
    ht_grid = rng.uniform(0.55, 1.0, (cell_ny, cell_nx)).astype(np.float32)

    min_d2 = np.full((sz, sz), 1e9, dtype=np.float32)
    best_u = np.zeros((sz, sz), dtype=np.float32)
    best_v = np.zeros((sz, sz), dtype=np.float32)
    best_rand = np.zeros((sz, sz), dtype=np.float32)
    best_ht = np.ones((sz, sz), dtype=np.float32)

    for dy in (-1, 0, 1):
        for dx in (-1, 0, 1):
            nx = (ix + dx) % cell_nx
            ny = (iy + dy) % cell_ny
            cx = (ix + dx).astype(np.float32) + jx_grid[ny, nx]
            cy = (iy + dy).astype(np.float32) + jy_grid[ny, nx]
            ddx = gx - cx
            ddy = gy - cy
            d2 = ddx * ddx + ddy * ddy
            mask = d2 < min_d2
            min_d2 = np.where(mask, d2, min_d2)
            best_u = np.where(mask, np.clip(cx / cell_nx, 0.0, 1.0), best_u)
            best_v = np.where(mask, np.clip(cy / cell_ny, 0.0, 1.0), best_v)
            best_rand = np.where(mask, rand_grid[ny, nx], best_rand)
            best_ht = np.where(mask, ht_grid[ny, nx], best_ht)

    dist = np.sqrt(min_d2)
    mound = np.clip(1.0 - np.power(np.clip(dist / 0.68, 0.0, 1.0), 1.65), 0.0, 1.0) * best_ht
    micro = _blur2d(rng.normal(0.0, 1.0, (sz, sz)), 1)
    height = _blur2d(mound * 0.78 + np.clip(micro * 0.16 + 0.12, 0.0, 0.28), 1)
    nap_sheen = (nap_dx * 0.65 - nap_dy * 0.76) * 0.5 + 0.5
    return xx, yy, mound, height, best_u, best_v, best_rand, nap_sheen


def _pack_image(name, rgba, colorspace="sRGB"):
    old = bpy.data.images.get(name)
    if old is not None:
        bpy.data.images.remove(old)
    sz = rgba.shape[0]
    img = bpy.data.images.new(name, width=sz, height=sz, alpha=False)
    img.colorspace_settings.name = colorspace
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


def _normal_from_height(height, strength=2.6):
    dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * strength
    dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * strength
    n_vec = np.stack((-dx, -dy, np.ones_like(height)), axis=-1)
    n_vec /= np.linalg.norm(n_vec, axis=-1, keepdims=True)
    rgba = np.ones((height.shape[0], height.shape[1], 4), dtype=np.float32)
    rgba[..., :3] = n_vec * 0.5 + 0.5
    return rgba


def _make_plush_rug_material(name, albedo_img, normal_img, base_rgb, normal_strength=0.45, roughness=0.96, sheen=0.72):
    old = bpy.data.materials.get(name)
    if old is not None:
        bpy.data.materials.remove(old)
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = (*base_rgb, 1.0)
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = 0.0
    if "Specular IOR Level" in bsdf.inputs:
        bsdf.inputs["Specular IOR Level"].default_value = 0.14
    if "Sheen Weight" in bsdf.inputs:
        bsdf.inputs["Sheen Weight"].default_value = sheen
    if "Sheen Roughness" in bsdf.inputs:
        bsdf.inputs["Sheen Roughness"].default_value = 0.78

    atex = nt.nodes.new("ShaderNodeTexImage")
    atex.image = albedo_img
    nt.links.new(atex.outputs["Color"], bsdf.inputs["Base Color"])

    ntex = nt.nodes.new("ShaderNodeTexImage")
    ntex.image = normal_img
    nmap = nt.nodes.new("ShaderNodeNormalMap")
    nmap.inputs["Strength"].default_value = normal_strength
    nt.links.new(ntex.outputs["Color"], nmap.inputs["Color"])
    nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def _rounded_rect_sdf(px, py, hx, hy, corner):
    qx = np.abs(px) - (hx - corner)
    qy = np.abs(py) - (hy - corner)
    out_d = np.sqrt(np.maximum(qx, 0.0) ** 2 + np.maximum(qy, 0.0) ** 2)
    in_d = np.minimum(np.maximum(qx, qy), 0.0)
    return out_d + in_d - corner


def _rounded_rect_perimeter(hx, hy, corner, arc_steps=8, edge_steps=10):
    """Build a uniform-density rounded rectangle loop in Blender XY."""
    pts = []
    corners = [
        (hx - corner, hy - corner, 0.0),
        (-hx + corner, hy - corner, pi * 0.5),
        (-hx + corner, -hy + corner, pi),
        (hx - corner, -hy + corner, pi * 1.5),
    ]
    for ci, (ox, oy, a0) in enumerate(corners):
        for s in range(arc_steps):
            ang = a0 + (pi * 0.5) * (s / arc_steps)
            pts.append((ox + corner * cos(ang), oy + corner * sin(ang)))
        # Straight segment to the start of the next corner arc
        ang_end = a0 + pi * 0.5
        p0 = (ox + corner * cos(ang_end), oy + corner * sin(ang_end))
        nox, noy, na0 = corners[(ci + 1) % 4]
        p1 = (nox + corner * cos(na0), noy + corner * sin(na0))
        for e in range(edge_steps):
            t = e / edge_steps
            pts.append((p0[0] + (p1[0] - p0[0]) * t, p0[1] + (p1[1] - p0[1]) * t))
    return pts


def _build_pillowed_rug_mesh(mesh_name, outer_pts, hx, hy, ring_specs, fluff_amp, seed_phase):
    """Build a smooth, pole-safe pillowed cushion mesh in local coordinates with organic plush loft."""
    bm = bmesh.new()
    n = len(outer_pts)
    rings = []
    for ring_scale, z_base, edge_wave in ring_specs:
        ring = []
        for idx, (px, py) in enumerate(outer_pts):
            ang = tau * idx / n
            wave = 1.0 + edge_wave * (
                0.55 * sin(ang * 13.0 + seed_phase)
                + 0.30 * cos(ang * 23.0 - seed_phase * 1.3)
                + 0.15 * sin(ang * 37.0 + seed_phase * 0.7)
            )
            rx = px * ring_scale * wave
            ry = py * ring_scale * wave
            # Gentle organic wool-pile cushion micro-loft across the top plateau
            loft = fluff_amp * (1.0 - min(1.0, (ring_scale / 0.96) ** 4)) * (
                0.50 * sin(rx * 5.2 + ry * 3.8 + seed_phase)
                + 0.30 * cos(rx * 9.4 - ry * 7.6)
                + 0.20 * sin(rx * 15.0 + ry * 14.0)
            )
            ring.append(bm.verts.new((rx, ry, z_base + loft)))
        rings.append(ring)

    for r in range(len(rings) - 1):
        lo = rings[r]
        hi = rings[r + 1]
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((lo[i], lo[j], hi[j], hi[i]))

    inner = rings[-1]
    center_z = ring_specs[-1][1] + fluff_amp * 0.15
    center_v = bm.verts.new((0.0, 0.0, center_z))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((inner[i], inner[j], center_v))

    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    # Match the existing UV layer name ("UVMap") on open-cabin.blend rugs so join_as merges UVs cleanly.
    uv_layer = bm.loops.layers.uv.new("UVMap")
    for face in bm.faces:
        face.smooth = True
        for loop in face.loops:
            co = loop.vert.co
            u = max(0.0, min(1.0, (co.x + hx) / (2.0 * hx)))
            v = max(0.0, min(1.0, (co.y + hy) / (2.0 * hy)))
            loop[uv_layer].uv = (u, v)

    old = bpy.data.meshes.get(mesh_name)
    if old is not None:
        bpy.data.meshes.remove(old)
    mesh = bpy.data.meshes.new(mesh_name)
    bm.to_mesh(mesh)
    bm.free()
    return mesh


def create_lower_plush_rug():
    """Author a thick, pillowy sea-salt vintage denim & cream hand-tufted plush rug on Floor 1."""
    sz = 384
    cx, cy = LOWER_RUG_CENTER
    hx, hy = LOWER_RUG_HALF
    corner = LOWER_RUG_CORNER

    _, _, mound, height, cell_u, cell_v, cell_rand, nap_sheen = _plush_tuft_fields(sz, 88, 76, seed=20261122)

    # Evaluate rounded-rectangle border distance at each Voronoi tuft center so border edges
    # follow natural hand-tufted yarn clusters rather than crisp printed stripes.
    cpx = (cell_u * 2.0 - 1.0) * hx
    cpy = (cell_v * 2.0 - 1.0) * hy
    edge_dist = -_rounded_rect_sdf(cpx, cpy, hx, hy, corner)

    outer_cream = (edge_dist < 0.165).astype(np.float32)
    honey_band = ((edge_dist >= 0.165) & (edge_dist < 0.265)).astype(np.float32)
    denim_field = (edge_dist >= 0.265).astype(np.float32)

    # Rich vintage sea-salt denim blue plush (#527896) with cozy melange yarn variance
    heather = (cell_rand - 0.5) * 0.055
    r = denim_field * (0.318 + heather * 0.7) + honey_band * (0.845 + heather * 0.5) + outer_cream * (0.948 + heather * 0.3)
    g = denim_field * (0.468 + heather * 0.85) + honey_band * (0.692 + heather * 0.45) + outer_cream * (0.922 + heather * 0.3)
    b = denim_field * (0.588 + heather * 0.95) + honey_band * (0.408 + heather * 0.35) + outer_cream * (0.882 + heather * 0.25)

    # Plush root-to-tip depth + creamy tip light scattering + brushed nap wave
    ao = 0.62 + 0.44 * mound
    tip_glow = np.power(mound, 2.2) * 0.12
    nap_mod = 0.94 + 0.12 * nap_sheen

    rgba = np.ones((sz, sz, 4), dtype=np.float32)
    rgba[..., 0] = np.clip(r * ao * nap_mod + tip_glow * 0.98, 0.0, 1.0)
    rgba[..., 1] = np.clip(g * ao * nap_mod + tip_glow * 0.96, 0.0, 1.0)
    rgba[..., 2] = np.clip(b * ao * nap_mod + tip_glow * 0.92, 0.0, 1.0)

    albedo_img = _pack_image("Lower_Plush_Rug_Albedo", rgba, "sRGB")
    normal_img = _pack_image("Lower_Plush_Rug_Normal", _normal_from_height(height, strength=3.0), "Non-Color")
    rug_mat = _make_plush_rug_material(
        "Rug | sea-salt tufted plush",
        albedo_img,
        normal_img,
        (0.24, 0.37, 0.47),
        normal_strength=0.52,
        roughness=0.96,
        sheen=0.72,
    )

    outer_pts = _rounded_rect_perimeter(hx, hy, corner, arc_steps=8, edge_steps=10)
    ring_specs = [
        (0.992, 0.0005, 0.0030),
        (0.996, 0.0042, 0.0045),
        (0.988, 0.0086, 0.0040),
        (0.972, 0.0110, 0.0025),
        (0.930, 0.0118, 0.0010),
        (0.840, 0.0121, 0.0000),
        (0.680, 0.0123, 0.0000),
        (0.480, 0.0124, 0.0000),
        (0.280, 0.0124, 0.0000),
        (0.120, 0.0123, 0.0000),
    ]
    mesh = _build_pillowed_rug_mesh("Lower_Plush_Rug", outer_pts, hx, hy, ring_specs, fluff_amp=0.0008, seed_phase=0.4)
    rug_obj = link_mesh("Lower_Plush_Rug", mesh, rug_mat)
    rug_obj.location = (cx, cy, 0.0)
    return [rug_obj]


def create_upper_plush_rug(collection=None):
    """Author a thick, cloud-soft warm cream lambswool oval plush rug on Floor 2 under the slippers."""
    sz = 384
    cx, cy = UPPER_RUG_CENTER
    rx, ry = UPPER_RUG_RADII

    _, _, mound, height, _, _, cell_rand, nap_sheen = _plush_tuft_fields(sz, 68, 42, seed=20261129)

    # Warm creamy cloud-lambswool palette: warm oat roots (#C9B8A0) rising to milky cream tips (#FDF9F0)
    fleece_var = (cell_rand - 0.5) * 0.036
    base_r = 0.958 + fleece_var * 0.8
    base_g = 0.928 + fleece_var * 0.9
    base_b = 0.878 + fleece_var * 1.1

    root_r, root_g, root_b = 0.77, 0.70, 0.61
    pile_mix = np.clip(0.26 + 0.78 * np.power(mound, 0.78), 0.0, 1.0)
    tip_glow = np.power(mound, 2.0) * 0.065
    nap_mod = 0.955 + 0.09 * nap_sheen

    rgba = np.ones((sz, sz, 4), dtype=np.float32)
    rgba[..., 0] = np.clip((root_r * (1.0 - pile_mix) + base_r * pile_mix) * nap_mod + tip_glow, 0.0, 1.0)
    rgba[..., 1] = np.clip((root_g * (1.0 - pile_mix) + base_g * pile_mix) * nap_mod + tip_glow * 0.98, 0.0, 1.0)
    rgba[..., 2] = np.clip((root_b * (1.0 - pile_mix) + base_b * pile_mix) * nap_mod + tip_glow * 0.95, 0.0, 1.0)

    albedo_img = _pack_image("Upper_Plush_Rug_Albedo", rgba, "sRGB")
    normal_img = _pack_image("Upper_Plush_Rug_Normal", _normal_from_height(height, strength=3.4), "Non-Color")
    rug_mat = _make_plush_rug_material(
        "Rug | cream lambswool plush",
        albedo_img,
        normal_img,
        (0.86, 0.80, 0.71),
        normal_strength=0.58,
        roughness=0.97,
        sheen=0.78,
    )

    segs = 72
    outer_pts = [(rx * cos(tau * i / segs), ry * sin(tau * i / segs)) for i in range(segs)]
    # Top stays safely <= 0.0126 m so the slippers (baseY = 0.0134 m) rest cleanly on top without clipping.
    ring_specs = [
        (0.990, 0.0004, 0.0055),
        (0.995, 0.0040, 0.0075),
        (0.986, 0.0084, 0.0065),
        (0.968, 0.0108, 0.0040),
        (0.925, 0.0116, 0.0015),
        (0.820, 0.0119, 0.0000),
        (0.650, 0.0121, 0.0000),
        (0.450, 0.0121, 0.0000),
        (0.240, 0.0121, 0.0000),
        (0.110, 0.0120, 0.0000),
    ]
    mesh = _build_pillowed_rug_mesh("Oval plush rug", outer_pts, rx, ry, ring_specs, fluff_amp=0.0005, seed_phase=1.9)
    obj = bpy.data.objects.new("Oval plush rug", mesh)
    obj.location = (cx, cy, 0.0)
    mesh.materials.append(rug_mat)
    target_col = collection or bpy.context.scene.collection
    target_col.objects.link(obj)
    return obj


def update_blend_with_upper_plush_rug():
    """Replace the legacy flat braided bedside rug inside open-cabin.blend with the sculpted plush rug."""
    textiles_col = next(c for c in bpy.context.scene.collection.children if c.name.startswith("06"))
    for obj in list(textiles_col.objects):
        if obj.name in LEGACY_UPPER_RUG_NAMES or obj.name == "Oval plush rug":
            bpy.data.objects.remove(obj, do_unlink=True)
    create_upper_plush_rug(collection=textiles_col)
    bpy.ops.wm.save_as_mainfile(filepath=str(ROOT / "assets/models/cabin/open-cabin.blend"))


if "--update-blend" in sys.argv:
    update_blend_with_upper_plush_rug()
    collections = {collection.name[:2]: list(collection.objects) for collection in bpy.context.scene.collection.children}
    depsgraph = bpy.context.evaluated_depsgraph_get()


deck_base = []
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
        upper = copy_mesh(source)
        upper.location.x = -BEDROOM_EXTENSION
        upper_shell.append(upper)
    elif name.startswith("Rounded porcelain"):
        deck_base.append(cut_x(copy_mesh(source), DIVIDER_X, False))
    elif name.startswith("Parquet substrate"):
        # Recess the substrate's cut face from the porcelain fascia.
        deck_base.append(cut_x(copy_mesh(source), DIVIDER_X + .006, False))
    else:
        lower_shell.append(cut_x(copy_mesh(source), DIVIDER_X, False))
        if name.startswith("Aft skirting"):
            upper = cut_x(copy_mesh(source), DIVIDER_X, True)
            remap_x(upper, CABIN_LEFT, DIVIDER_X, BEDROOM_LEFT, DIVIDER_X)
            upper_shell.append(upper)

upper_shell.extend(bedroom_walls())

parquet = collections["02"][0]
upper_parquet = cut_x(copy_mesh(parquet), DIVIDER_X, True, cap=False)
lower_parquet = cut_x(copy_mesh(parquet), DIVIDER_X, False, cap=False)
bpy.data.objects.remove(parquet, do_unlink=True)
rugs = collections["06"]
lower_rugs = [obj for obj in rugs if obj.location.x >= DIVIDER_X]
lower_rugs.extend(create_lower_plush_rug())
upper_rugs = [obj for obj in rugs if obj.location.x < DIVIDER_X and obj.name not in LEGACY_UPPER_RUG_NAMES]
for obj in list(rugs):
    if obj.name in LEGACY_UPPER_RUG_NAMES:
        bpy.data.objects.remove(obj, do_unlink=True)
if not any(obj.name == "Oval plush rug" for obj in upper_rugs):
    upper_rugs.insert(0, create_upper_plush_rug())
else:
    upper_rugs.sort(key=lambda o: 0 if o.name == "Oval plush rug" else 1)
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
join_as("Duplex_LowerShell", lower_shell)
join_as("Duplex_UpperShell", upper_shell)
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
