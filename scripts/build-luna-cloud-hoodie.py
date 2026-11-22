"""Tailor the Tripo hoodie on the Luna skeleton, bake chair contact, and export the game mesh."""

import argparse
import copy
import json
import math
import struct
import subprocess
import sys
import runpy
from collections import deque
from pathlib import Path
from tempfile import TemporaryDirectory

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Quaternion, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

ROOT = Path(__file__).resolve().parents[1]
BASE_LUNA = ROOT / "assets/public/models/resident/luna-walk-room.glb"
SIT_BLEND = ROOT / "assets/models/resident/Luna-Sit-ContactFixed.blend"
DEFAULT_INPUT = Path.home() / "Downloads/1115d436-5d3e-444c-be63-a6141e1f346c.glb"
DEFAULT_BLEND = ROOT / "assets/models/resident/Luna-CloudHoodie.blend"
DEFAULT_GLB = ROOT / "assets/public/models/resident/luna-cloud-hoodie.glb"
DEFAULT_SEAT = ROOT / "assets/public/models/resident/luna-cloud-hoodie-seat.bin"


def smoothstep(x, lo, hi):
    if hi == lo:
        return 1.0 if x >= hi else 0.0
    u = max(0.0, min(1.0, (x - lo) / (hi - lo)))
    return u * u * (3.0 - 2.0 * u)


def lerp(a, b, t):
    return a + (b - a) * t


def read_glb(path: Path):
    raw = path.read_bytes()
    jlen = struct.unpack_from("<I", raw, 12)[0]
    return json.loads(raw[20 : 20 + jlen]), raw[28 + jlen :]


def write_glb(path: Path, doc: dict, binary: bytes):
    b = bytearray(binary)
    while len(b) % 4:
        b.append(0)
    doc["buffers"] = [{"byteLength": len(b)}]
    j = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    j += b" " * (-len(j) % 4)
    out = (
        struct.pack("<4sII", b"glTF", 2, 28 + len(j) + len(b))
        + struct.pack("<I4s", len(j), b"JSON")
        + j
        + struct.pack("<I4s", len(b), b"BIN\x00")
        + bytes(b)
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(out)


def mat_from_gltf(values):
    return Matrix([values[i : i + 4] for i in range(0, 16, 4)]).transposed()


def clean_and_prepare_mesh(input_glb: Path):
    """Import Tripo hoodie GLB, scale to metres, weld seams, remove tiny noise islands."""
    bpy.ops.import_scene.gltf(filepath=str(input_glb), merge_vertices=False, import_pack_images=True)
    mesh_objs = [
        o for o in bpy.data.objects
        if o.type == "MESH" and o.name not in ("Luna_Surface", "Ref_Luna_Surface") and len(o.data.vertices) > 5000
    ]
    if not mesh_objs:
        raise RuntimeError("Could not find hoodie mesh in input GLB")
    obj = mesh_objs[0]
    parent = obj.parent
    obj.parent = None
    obj.scale = (0.01, 0.01, 0.01)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    if parent and parent.type == "EMPTY":
        bpy.data.objects.remove(parent, do_unlink=True)

    obj.name = "Luna_Surface"
    obj.data.name = "Luna_CloudHoodie_Mesh"

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()

    # Keep only the main character component (>= 100 vertices)
    visited = set()
    to_delete = []
    for v in bm.verts:
        if v.index in visited:
            continue
        comp = []
        q = deque([v])
        visited.add(v.index)
        while q:
            cur = q.popleft()
            comp.append(cur)
            for e in cur.link_edges:
                o = e.other_vert(cur)
                if o.index not in visited:
                    visited.add(o.index)
                    q.append(o)
        if len(comp) < 100:
            to_delete.extend(comp)
    if to_delete:
        bmesh.ops.delete(bm, geom=to_delete, context="VERTS")

    # 1) Smooth anatomical hand alignment so all 20 finger bones sit dead-center inside the sculpted fingers
    # 2) Subtle chin tip softening (~1.8mm) for an adorable rounded 3/4 anime jawline
    # (Leave legs completely untouched to preserve natural graceful silhouette without knock-knees!)
    for v in bm.verts:
        x, y, z = v.co
        ax = abs(x)
        s = 1.0 if x >= 0.0 else -1.0
        if ax > 0.145 and 0.44 < z < 0.64:
            t = smoothstep(ax, 0.148, 0.198) * smoothstep(z, 0.44, 0.465) * (1.0 - smoothstep(z, 0.59, 0.64))
            v.co.x += s * 0.0058 * t
            v.co.y += 0.0132 * t
        # Soft chin rounding right at the bottom jaw tip
        if ax < 0.018 and y < -0.052 and 0.778 < z < 0.802:
            tc = (1.0 - smoothstep(ax, 0.003, 0.018)) * smoothstep(-y, 0.052, 0.068) * (1.0 - smoothstep(z, 0.784, 0.802))
            v.co.z += 0.0018 * tc
            v.co.y += 0.0014 * tc

    bm.normal_update()
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    return obj


def sample_uv_palette(obj):
    """Find verified clean matte UVs for the white slouch sock and baby-blue hoodie cloth."""
    bc = next(im for im in bpy.data.images if "basecolor" in im.name.lower())
    rm = next(im for im in bpy.data.images if "_rm" in im.name.lower())
    bc_w, bc_h = bc.size
    rm_w, rm_h = rm.size
    bc_px = np.array(bc.pixels[:], dtype=np.float32).reshape(bc_h, bc_w, 4)
    rm_px = np.array(rm.pixels[:], dtype=np.float32).reshape(rm_h, rm_w, 4)
    uv_data = obj.data.uv_layers.active.data

    best_sock = (0.0, Vector((0.1623, 0.5249)))
    best_hoodie = (0.0, Vector((0.486, 0.658)))

    for poly in obj.data.polygons:
        cs = [obj.data.vertices[vi].co for vi in poly.vertices]
        z_min, z_max = min(c.z for c in cs), max(c.z for c in cs)
        if 0.095 <= z_min and z_max <= 0.150:
            for li in poly.loop_indices:
                u, v = uv_data[li].uv
                bx, by = int(min(bc_w - 1, max(0, u * bc_w))), int(min(bc_h - 1, max(0, v * bc_h)))
                rx, ry = int(min(rm_w - 1, max(0, u * rm_w))), int(min(rm_h - 1, max(0, v * rm_h)))
                r, g, b, _ = bc_px[by, bx]
                rough = float(rm_px[ry, rx, 1])
                sat = float(max(r, g, b) - min(r, g, b))
                if min(r, g, b) > 0.78 and sat < 0.05:
                    score = rough + 0.5 * float(r + g + b) / 3.0
                    if score > best_sock[0]:
                        best_sock = (score, Vector((float(u), float(v))))
        elif 0.56 <= z_min and z_max <= 0.63 and all(0.080 <= abs(c.x) <= 0.105 and -0.01 <= c.y <= 0.03 for c in cs):
            for li in poly.loop_indices:
                u, v = uv_data[li].uv
                bx, by = int(min(bc_w - 1, max(0, u * bc_w))), int(min(bc_h - 1, max(0, v * bc_h)))
                rx, ry = int(min(rm_w - 1, max(0, u * rm_w))), int(min(rm_h - 1, max(0, v * rm_h)))
                r, g, b, _ = bc_px[by, bx]
                rough = float(rm_px[ry, rx, 1])
                if b > r and min(r, g, b) > 0.45:
                    if rough > best_hoodie[0]:
                        best_hoodie = (rough, Vector((float(u), float(v))))

    print(f"Sampled matte UVs: sock={tuple(round(x, 4) for x in best_sock[1])}, hoodie={tuple(round(x, 4) for x in best_hoodie[1])}")
    return best_sock[1], best_hoodie[1]


# Keep the dropped shoulder and the white sleeve trim above the shared arch intact.
ARMHOLE_HEIGHT = 0.652


def separate_underarm_seams(obj, cloth_uv: Vector):
    """Split the Tripo-fused sleeve-to-torso crease below the true armpit and cap smoothly."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv_layer = bm.loops.layers.uv.active
    bm.verts.ensure_lookup_table()
    bm.faces.ensure_lookup_table()

    def x_cut(z):
        return 0.128 - 0.305 * (z - 0.51)

    for side in (1.0, -1.0):
        cand_faces = []
        for f in bm.faces:
            c = f.calc_center_median()
            if c.y > 0.044 or c.y < -0.145:
                continue
            if not (0.442 <= c.z <= ARMHOLE_HEIGHT + 0.008):
                continue
            if abs(side * c.x - x_cut(c.z)) < 0.032:
                cand_faces.append(f)

        plane_co = Vector((side * 0.128, 0.0, 0.51))
        plane_no = Vector((side, 0.0, 0.305)).normalized()

        geom = list(set(cand_faces) | {e for f in cand_faces for e in f.edges} | {v for f in cand_faces for v in f.verts})
        res = bmesh.ops.bisect_plane(
            bm,
            geom=geom,
            dist=1e-5,
            plane_co=plane_co,
            plane_no=plane_no,
            use_snap_center=False,
            clear_inner=False,
            clear_outer=False,
        )

        cut_edges = [
            g for g in res["geom_cut"]
            if isinstance(g, bmesh.types.BMEdge)
            and all(0.440 <= v.co.z < ARMHOLE_HEIGHT and -0.148 < v.co.y < 0.042 for v in g.verts)
        ]
        # Follow the connected U-shaped underarm cut before splitting it. Other
        # intersections higher up can belong to hair or the shoulder decoration.
        incident = {}
        for edge in cut_edges:
            for v in edge.verts:
                incident.setdefault(v, []).append(edge)
        seed = min(incident, key=lambda v: v.co.z)
        connected = {seed}
        stack = [seed]
        while stack:
            v = stack.pop()
            for edge in incident[v]:
                other = edge.other_vert(v)
                if other not in connected:
                    connected.add(other)
                    stack.append(other)
        ends = [v for v in connected if len(incident[v]) == 1]
        if len(ends) != 2 or any(len(incident[v]) > 2 for v in connected):
            raise ValueError(f"Open underarm seam expected on side {side}")
        current = min(ends, key=lambda v: v.co.y)
        ordered = []
        previous = None
        while True:
            edge = next((e for e in incident[current] if e != previous), None)
            if edge is None:
                break
            following = edge.other_vert(current)
            faces = sorted(edge.link_faces, key=lambda f: (f.calc_center_median() - plane_co).dot(plane_no))
            if len(faces) != 2:
                raise ValueError(f"Non-manifold source at underarm on side {side}")
            ordered.append((edge, current.co.copy(), following.co.copy(), faces))
            previous, current = edge, following
        bmesh.ops.split_edges(bm, edges=[record[0] for record in ordered])
        # Each adjacent face retains its own copy of the cut edge. Recover both
        # rims by face membership, even when a UV split has the same coordinate.
        torso_chain, sleeve_chain = [], []
        for _, start, finish, faces in ordered:
            for chain, face in zip((torso_chain, sleeve_chain), faces):
                a = min(face.verts, key=lambda v: (v.co - start).length_squared)
                b = min(face.verts, key=lambda v: (v.co - finish).length_squared)
                if not chain:
                    chain.append(a)
                elif chain[-1] != a:
                    raise ValueError(f"Discontinuous underarm rim on side {side}")
                chain.append(b)

        t_front, t_back = torso_chain[0], torso_chain[-1]
        s_front, s_back = sleeve_chain[0], sleeve_chain[-1]

        # Feather the opening by distance along each connected sheet. The two
        # end vertices remain sewn into the original uncut dropped shoulder.
        for chain, direction in ((torso_chain, -1.), (sleeve_chain, 1.)):
            widths = {}
            for v in chain[1:-1]:
                to_end = min((v.co - chain[0].co).length, (v.co - chain[-1].co).length)
                # Keep both inner walls distinct right up to the one shared
                # endpoint. A height-only taper welded several upper rail
                # points together and left a tiny non-manifold fold.
                rim_gap = .0008 * smoothstep(to_end, 0., .007)
                opening = (.007 if direction > 0 else .004) * (1 - smoothstep(
                    v.co.z, ARMHOLE_HEIGHT - .040, ARMHOLE_HEIGHT - .006))
                widths[v] = max(rim_gap, opening)
            frontier = widths.copy()
            for _ in range(5):
                following = {}
                for v, width in frontier.items():
                    for edge in v.link_edges:
                        nb = edge.other_vert(v)
                        if nb not in widths and nb not in chain:
                            following[nb] = max(following.get(nb, 0.), width * .56)
                widths.update(following)
                frontier = following
            for v, width in widths.items():
                v.co += plane_no * (direction * width)

        p_front = 0.5 * (t_front.co + s_front.co)
        p_back = 0.5 * (t_back.co + s_back.co)
        n_roof = 8
        roof_verts = []
        for k in range(1, n_roof + 1):
            frac = k / float(n_roof + 1)
            pos = p_front.lerp(p_back, frac)
            # Gentle upward arch (+2.5mm) right under the armpit crease
            pos.z += 0.0025 * math.sin(math.pi * frac)
            roof_verts.append(bm.verts.new(pos))

        cap_faces_apex = []

        # Close front & back apex transition edges with consistent opposite half-edge winding
        if t_front != s_front:
            try:
                f_ap = bm.faces.new((s_front, t_front, roof_verts[0]))
                cap_faces_apex.append(f_ap)
            except ValueError:
                pass
        if t_back != s_back:
            try:
                f_ap = bm.faces.new((t_back, s_back, roof_verts[-1]))
                cap_faces_apex.append(f_ap)
            except ValueError:
                pass

        def stitch_wall(chain, sidewall):
            # Cross-sections run around the arm, with a row at each height.
            # A pole in the middle of the panel would create long triangles
            # from the cuff to the elbow which cannot bend around the joint.
            bottom = min(range(len(chain)), key=lambda k: chain[k].co.z)
            front, back = list(reversed(chain[:bottom + 1])), chain[bottom:]
            roof = [chain[0], *roof_verts, chain[-1]]

            def lengths(points):
                distance = [0.]
                for a, b in zip(points, points[1:]):
                    distance.append(distance[-1] + (b.co - a.co).length)
                return [d / distance[-1] for d in distance]

            def at(points, dist, t):
                k = min(len(dist) - 2, max(0, int(np.searchsorted(dist, t)) - 1))
                return points[k].co.lerp(points[k + 1].co, (t - dist[k]) / (dist[k + 1] - dist[k]))

            def triangle(a, b, c):
                if a == b or a == c or b == c:
                    return
                verts = (a, b, c) if side * sidewall < 0 else (a, c, b)
                face = bm.faces.new(verts)
                face.smooth = True
                for loop in face.loops:
                    # A small fleece swatch gives the inner panel a finite UV
                    # basis even at the armpit where the camera can see it.
                    point = loop.vert.co
                    loop[uv_layer].uv = Vector((1.05 + .85 * smoothstep(point.y, -.09, .05),
                                                .03 + .94 * smoothstep(point.z, .50, .72)))

            def join_rails(left, left_t, right, right_t):
                a = b = 0
                while a + 1 < len(left) or b + 1 < len(right):
                    if b + 1 == len(right) or (a + 1 < len(left) and left_t[a + 1] <= right_t[b + 1]):
                        triangle(left[a], right[b], left[a + 1])
                        a += 1
                    else:
                        triangle(left[a], right[b], right[b + 1])
                        b += 1

            front_t, back_t = lengths(front), lengths(back)
            samples = np.linspace(0., 1., 25)
            rails = [(front, front_t)]
            for k in range(1, len(roof) - 1):
                across = k / (len(roof) - 1)
                rail = [chain[bottom]]
                for u in samples[1:-1]:
                    a, b = at(front, front_t, u), at(back, back_t, u)
                    co = a.lerp(b, across)
                    arch = math.sin(math.pi * across) * math.sin(math.pi * u)
                    co.x += side * sidewall * .006 * arch
                    co.z += .0025 * math.sin(math.pi * across) * u ** 3
                    rail.append(bm.verts.new(co))
                rail.append(roof[k])
                rails.append((rail, samples))
            rails.append((back, back_t))
            for (a, a_t), (b, b_t) in zip(rails, rails[1:]):
                join_rails(a, a_t, b, b_t)

        stitch_wall(torso_chain, -1)
        stitch_wall(sleeve_chain, 1)

        for nf in cap_faces_apex:
            nf.normal_update()
            nf.smooth = True
            for l in nf.loops:
                l[uv_layer].uv = cloth_uv

        print(
            f"Capped underarm side={side:+.0f}: torso_chain={len(torso_chain)}, sleeve_chain={len(sleeve_chain)}, "
            f"cut height={ARMHOLE_HEIGHT:.3f}"
        )

    sewing = [v for v in bm.verts if abs(abs(v.co.x) - x_cut(v.co.z)) < .035 and .45 < v.co.z < .657]
    bmesh.ops.remove_doubles(bm, verts=sewing, dist=1e-6)
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
    for edge in bm.edges:
        if all(.51 < v.co.z < .675 and abs(abs(v.co.x) - x_cut(v.co.z)) < .038
               and abs(v.co.y + .012) < .056 for v in edge.verts):
            if len(edge.link_faces) != 2:
                raise ValueError("Each edge in the sewn sleeve roof must have two incident faces")
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.normal_update()
    bm.to_mesh(obj.data)
    bm.free()
    invalid_fixed = obj.data.validate(verbose=False)
    obj.data.update()
    print(f"Separated underarm seams cleanly; verts={len(obj.data.vertices)}, polys={len(obj.data.polygons)}, validate_fixed={invalid_fixed}")


def build_flat_sock_feet_from_luna(obj, ref_luna_obj, arm_obj, sock_uv: Vector):
    """Replace high-heeled boots below z=0.084 with cozy flat knit sock feet built from Luna's exact foot template.

    Using Luna's actual bare foot mesh (welded, smoothed across bare toe clefts, inflated +2mm
    into a sleek knit sock) preserves her exact bind-pose +16 deg plantarflexion so both sock
    feet plant 100% dead-flat on the cabin floor in standing pose and walking!
    """
    cut_z = 0.084

    # --- 1. Cut off hoodie boots below z = cut_z ---
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    uv_layer = bm.loops.layers.uv.active
    bm.verts.ensure_lookup_table()

    foot_geom = [f for f in bm.faces if any(v.co.z < cut_z + 0.015 for v in f.verts)]
    geom = list(set(foot_geom) | {e for f in foot_geom for e in f.edges} | {v for f in foot_geom for v in f.verts})
    bmesh.ops.bisect_plane(
        bm,
        geom=geom,
        dist=1e-5,
        plane_co=Vector((0.0, 0.0, cut_z)),
        plane_no=Vector((0.0, 0.0, 1.0)),
        clear_inner=True,
        clear_outer=False,
    )
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()

    # Extract ordered slouch-sock ankle boundary loops for Left (+1) and Right (-1)
    def extract_ordered_loop(target_bm, z_level, side_sign):
        edges = [
            e for e in target_bm.edges
            if e.is_boundary
            and all(abs(v.co.z - z_level) < 0.004 and v.co.x * side_sign > 0.015 for v in e.verts)
        ]
        if not edges:
            raise RuntimeError(f"Could not find boundary loop at z={z_level} side={side_sign}")
        adj = {}
        for e in edges:
            a, b = e.verts[0], e.verts[1]
            adj.setdefault(a, []).append(b)
            adj.setdefault(b, []).append(a)
        # Walk largest cycle
        best_loop = []
        visited_e = set()
        for start_e in edges:
            start = start_e.verts[0]
            if start in visited_e:
                continue
            loop = [start]
            prev = None
            cur = start
            for _ in range(len(edges) + 2):
                nxts = [n for n in adj.get(cur, []) if n != prev]
                if not nxts:
                    break
                nxt = nxts[0]
                if nxt == start:
                    break
                loop.append(nxt)
                prev, cur = cur, nxt
            for v in loop:
                visited_e.add(v)
            if len(loop) > len(best_loop):
                best_loop = loop
        cx = sum(v.co.x for v in best_loop) / len(best_loop)
        cy = sum(v.co.y for v in best_loop) / len(best_loop)
        area2 = sum(
            (best_loop[i].co.x - cx) * (best_loop[(i + 1) % len(best_loop)].co.y - cy)
            - (best_loop[(i + 1) % len(best_loop)].co.x - cx) * (best_loop[i].co.y - cy)
            for i in range(len(best_loop))
        )
        if area2 < 0:
            best_loop.reverse()
        return best_loop, cx, cy

    # --- 2. Build smoothed, rounded knit sock feet from Luna's actual foot geometry ---
    ref_bm = bmesh.new()
    ref_bm.from_mesh(ref_luna_obj.data)
    bmesh.ops.remove_doubles(ref_bm, verts=ref_bm.verts, dist=1e-5)
    # Keep only faces below z = 0.088 and bisect cleanly at z = 0.078 (just below slouch sock cuff!)
    ref_foot_cut = 0.078
    upper = [v for v in ref_bm.verts if v.co.z > ref_foot_cut + 0.025]
    if upper:
        bmesh.ops.delete(ref_bm, geom=upper, context="VERTS")
    ref_bm.verts.ensure_lookup_table()
    ref_bm.faces.ensure_lookup_table()
    all_geom = list(ref_bm.faces) + list(ref_bm.edges) + list(ref_bm.verts)
    bmesh.ops.bisect_plane(
        ref_bm,
        geom=all_geom,
        dist=1e-5,
        plane_co=Vector((0.0, 0.0, ref_foot_cut)),
        plane_no=Vector((0.0, 0.0, 1.0)),
        clear_inner=False,
        clear_outer=True,
    )
    ref_bm.verts.ensure_lookup_table()
    ref_bm.edges.ensure_lookup_table()
    ref_bm.faces.ensure_lookup_table()
    ref_bm.normal_update()

    # Replace the 5 separate bare-toe fingers (y < -0.055) with a 100% seamless, smooth rounded knit sock toe box!
    # Preserves Luna's exact bind-pose heel, instep, arch, and exact sole tangent plane so planted feet are dead flat!
    toe_cut_y = -0.054
    for s in (1.0, -1.0):
        # Measure exact front tip & sole slope of Luna's original toes before cutting them off!
        orig_toes = [v.co.copy() for v in ref_bm.verts if v.co.x * s > 0.01 and v.co.y < toe_cut_y]
        if not orig_toes:
            continue
        tip_y = min(p.y for p in orig_toes)  # ~ -0.089
        # Sole plane height at toe_cut_y vs at tip_y (preserves exact +16 deg bind-pose sole angle!)
        cut_band = [v.co for v in ref_bm.verts if v.co.x * s > 0.01 and abs(v.co.y - toe_cut_y) < 0.005]
        z_sole_cut = min(p.z for p in cut_band)
        z_sole_tip = min(p.z for p in orig_toes if p.y < tip_y + 0.012)
        toe_len = toe_cut_y - tip_y  # positive ~0.035m

        # Bisect this foot cleanly at y = toe_cut_y and delete the 5 separate bare toes (y < toe_cut_y)
        side_faces = [f for f in ref_bm.faces if any(v.co.x * s > 0.01 and v.co.y < toe_cut_y + 0.012 for v in f.verts)]
        geom = list(set(side_faces) | {e for f in side_faces for e in f.edges} | {v for f in side_faces for v in f.verts})
        bmesh.ops.bisect_plane(
            ref_bm,
            geom=geom,
            dist=1e-5,
            plane_co=Vector((0.0, toe_cut_y, 0.0)),
            plane_no=Vector((0.0, 1.0, 0.0)),
            clear_inner=True,
            clear_outer=False,
        )
        ref_bm.verts.ensure_lookup_table()
        ref_bm.edges.ensure_lookup_table()

        # Extract ordered boundary loop at y = toe_cut_y for this foot
        cut_edges = [
            e for e in ref_bm.edges
            if e.is_boundary
            and all(abs(v.co.y - toe_cut_y) < 0.003 and v.co.x * s > 0.01 for v in e.verts)
        ]
        if not cut_edges:
            continue
        adj_c = {}
        for e in cut_edges:
            a, b = e.verts[0], e.verts[1]
            adj_c.setdefault(a, []).append(b)
            adj_c.setdefault(b, []).append(a)
        start = cut_edges[0].verts[0]
        ring0 = [start]
        prev, cur = None, start
        for _ in range(len(cut_edges) + 2):
            nxts = [n for n in adj_c.get(cur, []) if n != prev]
            if not nxts or nxts[0] == start:
                break
            ring0.append(nxts[0])
            prev, cur = cur, nxts[0]

        # Ensure consistent winding around +Y axis (so lofted sock toe normals point outward!)
        rcx = sum(v.co.x for v in ring0) / len(ring0)
        rcz = sum(v.co.z for v in ring0) / len(ring0)
        area2 = sum(
            (ring0[i].co.x - rcx) * (ring0[(i + 1) % len(ring0)].co.z - rcz)
            - (ring0[(i + 1) % len(ring0)].co.x - rcx) * (ring0[i].co.z - rcz)
            for i in range(len(ring0))
        )
        if area2 < 0:
            ring0.reverse()

        # Loft 5 smooth dome rings forward from y = toe_cut_y to tip_y with cozy rounded sock toe profile!
        # Keep the bottom of every ring hugging the exact barefoot sole slope (z_sole_cut -> z_sole_tip)!
        # Subtle medial big-toe curve (big toe slightly fuller & longer on medial side -s)
        toe_rings = [ring0]
        n_r = len(ring0)
        steps = [
            (0.24, 0.94, 0.92),
            (0.50, 0.84, 0.80),
            (0.74, 0.68, 0.64),
            (0.91, 0.44, 0.42),
            (0.99, 0.16, 0.16),
        ]
        for frac, rx_scale, rz_scale in steps:
            y_base = toe_cut_y - frac * toe_len
            z_sole = lerp(z_sole_cut, z_sole_tip, frac)
            # Dome center height tapers smoothly down toward the toe bumper
            zc_new = lerp(rcz, z_sole + 0.006, frac * 0.88)
            # Slight natural medial shift for cute asymmetric anime sock toe
            xc_new = rcx - s * 0.0028 * (frac ** 1.4)
            ring = []
            for v0 in ring0:
                dx = v0.co.x - rcx
                dz = v0.co.z - rcz
                # Asymmetric rounding: lateral pinky side recedes gently faster than medial big-toe side
                lat_frac = max(0.0, (dx * s) / 0.025)
                y_v = y_base + 0.0055 * (frac ** 1.2) * lat_frac
                x_v = xc_new + dx * rx_scale
                if dz < 0:
                    # Keep sole cleanly hugging exact sole plane!
                    z_v = lerp(z_sole, zc_new + dz * rz_scale, 0.35)
                else:
                    z_v = zc_new + dz * rz_scale
                ring.append(ref_bm.verts.new(Vector((x_v, y_v, z_v))))
            toe_rings.append(ring)

        for r_idx in range(len(toe_rings) - 1):
            ra, rb = toe_rings[r_idx], toe_rings[r_idx + 1]
            for i in range(n_r):
                j = (i + 1) % n_r
                for tri_vs in ((ra[i], rb[i], rb[j]), (ra[i], rb[j], ra[j])):
                    try:
                        f = ref_bm.faces.new(tri_vs)
                        f.smooth = True
                    except ValueError:
                        pass
        # Cap the very front rounded toe tip cleanly
        last_r = toe_rings[-1]
        tip_center = ref_bm.verts.new(Vector((
            sum(v.co.x for v in last_r) / n_r,
            tip_y - 0.001,
            sum(v.co.z for v in last_r) / n_r,
        )))
        for i in range(n_r):
            j = (i + 1) % n_r
            try:
                f = ref_bm.faces.new((last_r[i], tip_center, last_r[j]))
                f.smooth = True
            except ValueError:
                pass
    bmesh.ops.recalc_face_normals(ref_bm, faces=list(ref_bm.faces))
    ref_bm.normal_update()

    # Gently inflate the knit sock by +1.6mm outward on sides/top (NOT pushing bottom sole below floor!)
    # and softly align ankle X to match the slouch sock center without shifting the sole off the bone!
    sock_loops = {}
    for side_name, s in (("Left", 1.0), ("Right", -1.0)):
        hoodie_loop, h_cx, h_cy = extract_ordered_loop(bm, cut_z, s)
        ref_loop, r_cx, r_cy = extract_ordered_loop(ref_bm, ref_foot_cut, s)
        sock_loops[s] = (hoodie_loop, h_cx, h_cy, ref_loop, r_cx, r_cy)

        # Shift this ref foot's X smoothly from h_cx at ankle (z=0.078) to 0.45*h_cx + 0.55*r_cx at sole
        # (only ~4-6mm lateral shift, keeping feet centered cleanly under the slouch socks AND aligned with bones!)
        side_verts = [v for v in ref_bm.verts if v.co.x * s > 0.01]
        for v in side_verts:
            t_up = smoothstep(v.co.z, 0.015, ref_foot_cut)
            dx_shift = lerp((h_cx - r_cx) * 0.55, h_cx - r_cx, t_up)
            dy_shift = lerp((h_cy - r_cy) * 0.35, h_cy - r_cy, t_up)
            # Soft knit thickness (+1.6mm outward on top & sides, zero downward sole shift!)
            n = v.normal.copy()
            if n.z < -0.35:
                n.z = 0.0
            v.co.x += dx_shift + n.x * 0.0016
            v.co.y += dy_shift + n.y * 0.0016
            v.co.z += max(0.0, n.z) * 0.0016

    # Copy both sculpted knit sock feet into main bm and bridge cleanly to the slouch sock ankle loops!
    v_map = {}
    new_faces = []
    for rv in ref_bm.verts:
        v_map[rv] = bm.verts.new(rv.co.copy())
    for rf in ref_bm.faces:
        vs = [v_map[v] for v in rf.verts]
        try:
            nf = bm.faces.new(vs)
            nf.smooth = True
            new_faces.append(nf)
        except ValueError:
            pass

    # Bridge each slouch sock loop (z=0.084) smoothly to the top rim of the knit sock foot (z=0.078)
    for s, (h_loop, h_cx, h_cy, r_loop_old, _, _) in sock_loops.items():
        r_loop = [v_map[v] for v in r_loop_old]
        r_cx = sum(v.co.x for v in r_loop) / len(r_loop)
        r_cy = sum(v.co.y for v in r_loop) / len(r_loop)

        # Match angle parameterization between h_loop (top) and r_loop (bottom) for a twist-free quad/tri bridge
        def ring_angles(ring, cx, cy):
            angs = [math.atan2((v.co.x - cx) * s, -(v.co.y - cy)) for v in ring]
            # Sort monotonically by angle
            paired = sorted(zip(angs, ring), key=lambda x: x[0])
            return [a for a, _ in paired], [v for _, v in paired]

        h_angs, h_sorted = ring_angles(h_loop, h_cx, h_cy)
        r_angs, r_sorted = ring_angles(r_loop, r_cx, r_cy)

        # Two-pointer merge walk around the circle [-pi, pi] to zip unequal vertex counts cleanly!
        nh, nr = len(h_sorted), len(r_sorted)
        ih, ir = 0, 0
        # Walk nh + nr steps wrapping around
        steps = 0
        while (ih < nh or ir < nr) and steps < nh + nr + 4:
            steps += 1
            h0 = h_sorted[ih % nh]
            h1 = h_sorted[(ih + 1) % nh]
            r0 = r_sorted[ir % nr]
            r1 = r_sorted[(ir + 1) % nr]

            a_h1 = h_angs[(ih + 1) % nh] + (2.0 * math.pi if ih + 1 >= nh else 0.0)
            a_r1 = r_angs[(ir + 1) % nr] + (2.0 * math.pi if ir + 1 >= nr else 0.0)

            advance_h = (ir >= nr) or (ih < nh and a_h1 <= a_r1)
            if advance_h:
                tri = (h0, r0, h1) if s < 0 else (h0, h1, r0)
                ih += 1
            else:
                tri = (h0, r0, r1) if s < 0 else (h0, r1, r0)
                ir += 1
            if len({tri[0], tri[1], tri[2]}) == 3:
                try:
                    nf = bm.faces.new(tri)
                    nf.smooth = True
                    new_faces.append(nf)
                except ValueError:
                    pass

    # Assign clean matte white knit sock UV to all new sock foot & bridge faces
    for f in new_faces:
        for l in f.loops:
            l[uv_layer].uv = sock_uv

    # Smooth the ankle transition seam (z in 0.072..0.088) so the slouch sock flows into the sock foot with zero lip!
    seam_verts = [v for v in bm.verts if 0.072 <= v.co.z <= 0.087 and abs(v.co.x) > 0.015]
    for _ in range(3):
        bmesh.ops.smooth_vert(bm, verts=seam_verts, factor=0.45, use_axis_x=True, use_axis_y=True, use_axis_z=False)

    ref_bm.free()
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
    bm.normal_update()
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    print(f"Built anatomical flat knit sock feet from Luna template; verts={len(obj.data.vertices)}, polys={len(obj.data.polygons)}")


def finish_small_surface_details(obj):
    """Give flat palette faces a finite texture footprint and separate two sewn layers."""
    mesh = obj.data
    uv = mesh.uv_layers.active.data
    for face in mesh.polygons:
        loops = list(face.loop_indices)
        points = [uv[i].uv.copy() for i in loops]
        twice_area = sum(a.x * b.y - b.x * a.y for a, b in zip(points, points[1:] + points[:1]))
        if abs(twice_area) > 1e-12:
            continue
        # Use the dominant projection of each face. The original palette
        # sample stays at its centre and the three corners stay in that texel.
        origin = sum(points, Vector((0., 0.))) / len(points)
        axis = max(range(3), key=lambda i: abs(face.normal[i]))
        u, v = (axis + 1) % 3, (axis + 2) % 3
        positions = [mesh.vertices[mesh.loops[i].vertex_index].co - face.center for i in loops]
        extent = max(max(abs(q[u]), abs(q[v])) for q in positions)
        if extent > 0:
            for i, q in zip(loops, positions):
                uv[i].uv = origin + Vector((q[u], q[v])) * (.00014 / extent)

    # These two layers almost coincide in the source scan at the nape and
    # at the underside of the left sock. Follow topology from the outer
    # triangle so the facing layer does not receive the same displacement.
    adjacent = [set() for _ in mesh.vertices]
    for edge in mesh.edges:
        a, b = edge.vertices
        adjacent[a].add(b)
        adjacent[b].add(a)
    for center in ((.022828, .040542, .776771), (-.076256, -.084954, .002510)):
        face = min(mesh.polygons, key=lambda p: (p.center - Vector(center)).length_squared)
        rim = set(face.vertices)
        seen = set()
        direction = face.normal.copy()
        if center[2] < .01:
            direction.z = 0.
            direction.normalize()
        for distance in (.0018, .00075, .00020):
            for i in rim:
                mesh.vertices[i].co += direction * distance
            seen.update(rim)
            rim = {j for i in rim for j in adjacent[i]} - seen
    mesh.update()


def enhance_anime_face_mesh(obj):
    """Close any tiny bangs slit and sculpt a delicate 3D anime nose ridge on Luna_Surface."""
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()
    uv_layer = bm.loops.layers.uv.active

    # 1. Close tiny boundary hole slits in the front bangs / forehead (e.g. above right eyebrow)
    bang_hole_edges = [
        e for e in bm.edges
        if e.is_boundary
        and all(-0.055 < v.co.x < 0.055 and v.co.y < -0.055 and 0.855 < v.co.z < 0.908 for v in e.verts)
    ]
    filled = 0
    if bang_hole_edges:
        res = bmesh.ops.holes_fill(bm, edges=bang_hole_edges, sides=16)
        new_faces = res.get("faces", [])
        filled = len(new_faces)
        for f in new_faces:
            f.smooth = True
            # Copy UV from neighboring existing face loop sharing each vertex
            for l in f.loops:
                nb_uvs = [
                    ol[uv_layer].uv
                    for ol in l.vert.link_loops
                    if ol.face not in new_faces
                ]
                if nb_uvs:
                    l[uv_layer].uv = nb_uvs[0].copy()

    # 2. Subtle delicate 3D anime nose bump (+1.8mm forward along -Y at nose tip)
    # Gives soft 3/4 profile definition without disturbing flat anime cheeks or UVs.
    nose_x, nose_z = 0.0004, 0.8255
    for v in bm.verts:
        if v.co.y < -0.062 and abs(v.co.x - nose_x) < 0.012 and abs(v.co.z - nose_z) < 0.018:
            dx = (v.co.x - nose_x) / 0.0040
            dz = (v.co.z - nose_z) / 0.0062
            g = math.exp(-0.5 * (dx * dx + dz * dz))
            v.co.y -= 0.0018 * g

    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.normal_update()
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.update()
    print(f"Enhanced face mesh: filled {filled} tiny bangs slit faces + sculpted subtle 3D anime nose")


def paint_anime_face_features(obj, px: np.ndarray):
    """3D-projected anti-aliased anime facial feature refinement directly on the 2K sRGB basecolor atlas.

    Uses exact barycentric 3D coordinates on the front face mesh so nose, gentle smiling mouth,
    warm peach cheek blush, eyebrows, and eye catchlights align to sub-millimetre accuracy.
    """
    h, w, _ = px.shape
    me = obj.data
    uvl = me.uv_layers.active.data
    cx = 0.0004
    painted_pixels = 0

    for poly in me.polygons:
        if len(poly.vertices) != 3:
            continue
        vs = [me.vertices[vi].co for vi in poly.vertices]
        if any(v.y > -0.048 or abs(v.x) > 0.062 or v.z < 0.784 or v.z > 0.882 for v in vs):
            continue
        uvs = [uvl[li].uv for li in poly.loop_indices]
        u0, v0 = uvs[0].x * (w - 1), uvs[0].y * (h - 1)
        u1, v1 = uvs[1].x * (w - 1), uvs[1].y * (h - 1)
        u2, v2 = uvs[2].x * (w - 1), uvs[2].y * (h - 1)
        denom = (v1 - v2) * (u0 - u2) + (u2 - u1) * (v0 - v2)
        if abs(denom) < 1e-6:
            continue

        umin = max(0, int(math.floor(min(u0, u1, u2))) - 1)
        umax = min(w - 1, int(math.ceil(max(u0, u1, u2))) + 1)
        vmin = max(0, int(math.floor(min(v0, v1, v2))) - 1)
        vmax = min(h - 1, int(math.ceil(max(v0, v1, v2))) + 1)

        uu, vv = np.meshgrid(
            np.arange(umin, umax + 1, dtype=np.float32),
            np.arange(vmin, vmax + 1, dtype=np.float32),
        )
        w0 = ((v1 - v2) * (uu - u2) + (u2 - u1) * (vv - v2)) / denom
        w1 = ((v2 - v0) * (uu - u2) + (u0 - u2) * (vv - v2)) / denom
        w2 = 1.0 - w0 - w1
        inside = (w0 >= -0.06) & (w1 >= -0.06) & (w2 >= -0.06)
        if not np.any(inside):
            continue

        iy, ix = np.where(inside)
        py_idx = vmin + iy
        px_idx = umin + ix
        bw0, bw1, bw2 = w0[inside], w1[inside], w2[inside]

        fx = bw0 * vs[0].x + bw1 * vs[1].x + bw2 * vs[2].x
        fz = bw0 * vs[0].z + bw1 * vs[1].z + bw2 * vs[2].z
        col = px[py_idx, px_idx, :3].copy()
        orig = col.copy()

        # Guard: skin pixels only for nose, mouth, blush (never overwrite hair, sclera, or iris!)
        is_skin = (orig[:, 0] > 0.58) & ((orig[:, 0] - orig[:, 2]) > 0.012) & (orig[:, 1] > 0.46)

        if np.any(is_skin):
            sx = fx[is_skin]
            sz = fz[is_skin]
            sc = col[is_skin]

            # 1. Warm rosy cheek blush directly under both eyes
            for side_x in (-0.0305, 0.0312):
                bx = (sx - side_x) / 0.0155
                bz = (sz - 0.8265) / 0.0092
                ba = 0.24 * np.exp(-0.5 * (bx * bx + bz * bz))
                blush = np.array([0.97, 0.64, 0.65], dtype=np.float32)
                sc = sc * (1.0 - ba[:, None]) + blush[None, :] * ba[:, None]

            # 2. Delicate anime nose shadow dot + subtle warm bridge highlight
            nx = (sx - (cx + 0.0002)) / 0.00105
            nz = (sz - 0.8248) / 0.00155
            na = 0.56 * np.exp(-0.5 * (nx * nx + nz * nz))
            nose_col = np.array([0.70, 0.48, 0.45], dtype=np.float32)
            sc = sc * (1.0 - na[:, None]) + nose_col[None, :] * na[:, None]

            hx = (sx - (cx - 0.0010)) / 0.0015
            hz = (sz - 0.8268) / 0.0030
            ha = 0.038 * np.exp(-0.5 * (hx * hx + hz * hz))
            sc = np.clip(sc + ha[:, None], 0.0, 1.0)

            # 3. Sweet gentle smiling anime mouth (delicate curved upper lip line + warm rosy lower lip tint)
            mx = sx - cx
            z_curve = 0.8098 + 0.0017 * np.square(mx / 0.0070)
            dz = sz - z_curve
            ax_m = np.abs(mx)
            # Smooth horizontal taper at corners + subtle delicate lightening right at lip center
            env = np.clip((0.0070 - ax_m) / 0.0024, 0.0, 1.0)
            env = env * env * (3.0 - 2.0 * env)
            mid_dip = 0.68 + 0.32 * np.clip((ax_m - 0.0007) / 0.0020, 0.0, 1.0)
            line_a = 0.76 * env * mid_dip * np.exp(-0.5 * np.square(dz / 0.00064))
            mouth_line = np.array([0.68, 0.41, 0.41], dtype=np.float32)
            sc = sc * (1.0 - line_a[:, None]) + mouth_line[None, :] * line_a[:, None]

            # Soft coral-pink lower lip cushion tint
            lx = mx / 0.0044
            lz = (sz - (z_curve - 0.0015)) / 0.0014
            la = 0.28 * np.exp(-0.5 * (lx * lx + lz * lz))
            lip_tint = np.array([0.95, 0.66, 0.67], dtype=np.float32)
            sc = sc * (1.0 - la[:, None]) + lip_tint[None, :] * la[:, None]

            # Whisper-soft lower lip shadow accent
            shx = mx / 0.0026
            shz = (sz - 0.8062) / 0.00085
            sha = 0.16 * np.exp(-0.5 * (shx * shx + shz * shz))
            chin_sh = np.array([0.78, 0.56, 0.54], dtype=np.float32)
            sc = sc * (1.0 - sha[:, None]) + chin_sh[None, :] * sha[:, None]

            # 4. Crisp up existing faint eyebrows slightly without drawing over bangs
            brow_zone = (np.abs(sx - cx) > 0.016) & (np.abs(sx - cx) < 0.043) & (sz > 0.860) & (sz < 0.874)
            lum = sc.mean(axis=1)
            brow_mask = brow_zone & (lum < 0.78)
            if np.any(brow_mask):
                sc[brow_mask] *= np.array([0.84, 0.82, 0.84], dtype=np.float32)

            col[is_skin] = sc

        # 5. Eye clarity: deepen lashes/sapphire iris slightly & add crisp anime specular catchlights
        eye_zone = (np.abs(fx - cx) > 0.014) & (np.abs(fx - cx) < 0.045) & (fz > 0.835) & (fz < 0.858)
        if np.any(eye_zone):
            ex = fx[eye_zone]
            ez = fz[eye_zone]
            ec = col[eye_zone]
            # Deepen dark eyelashes slightly
            lash = ec.mean(axis=1) < 0.42
            if np.any(lash):
                ec[lash] *= 0.86
            # Enrich blue iris saturation slightly
            iris = (ec[:, 2] - ec[:, 0]) > 0.08
            if np.any(iris):
                ec[iris, 0] *= 0.92
                ec[iris, 1] *= 0.96
                ec[iris, 2] = np.clip(ec[iris, 2] * 1.04, 0.0, 1.0)
            # Crisp upper-left main white catchlight + small lower-right sparkle in both irises
            for (kx, kz, kr, ka) in (
                (-0.0352, 0.8495, 0.0018, 0.88),
                (0.0276, 0.8495, 0.0018, 0.88),
                (-0.0282, 0.8432, 0.00095, 0.55),
                (0.0346, 0.8432, 0.00095, 0.55),
            ):
                d2 = ((ex - kx) / kr) ** 2 + ((ez - kz) / kr) ** 2
                ca = ka * np.exp(-0.5 * np.square(np.maximum(0.0, np.sqrt(d2) - 0.35) / 0.55)) * (d2 < 3.5)
                # Only paint catchlight inside iris/pupil area (not white sclera or skin)
                in_iris = (ec[:, 2] > 0.25) & ((ec[:, 2] - ec[:, 0]) > 0.03) | (ec.mean(axis=1) < 0.55)
                ca = ca * in_iris
                ec = ec * (1.0 - ca[:, None]) + 1.0 * ca[:, None]
            col[eye_zone] = np.clip(ec, 0.0, 1.0)

        px[py_idx, px_idx, :3] = col
        painted_pixels += len(px_idx)

    print(f"Refined anime face texture on {painted_pixels} front-face texels")


def configure_cozy_matte_material(obj, scratch_dir: Path):
    """Calibrate PBR material, refine anime face features & lift fabric roughness for cozy matte look."""
    mat = obj.data.materials[0]
    mat.name = "Luna_CloudHoodie_Mat"
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    base_sock = bsdf.inputs["Base Color"].links[0].from_socket
    norm = next((n for n in nt.nodes if n.type == "NORMAL_MAP"), None)
    if norm:
        norm.inputs["Strength"].default_value = 0.20
    bsdf.inputs["Metallic"].default_value = 0.0
    nt.links.new(base_sock, bsdf.inputs["Emission Color"])
    bsdf.inputs["Emission Strength"].default_value = 0.32

    # Collect ONLY images actually used by the hoodie material (skip temporary ref_luna walk_* images!)
    mat_images = []
    seen_imgs = set()
    for node in nt.nodes:
        if node.type == "TEX_IMAGE" and node.image and node.image.name not in seen_imgs:
            seen_imgs.add(node.image.name)
            mat_images.append(node.image)

    def save_modified_image(img, out_path: Path, fmt: str, px_arr=None, scale_to=None):
        """Safely write modified pixels to disk and pack — unpacking first prevents Blender from reverting to stale packed bytes!"""
        if img.packed_file is not None:
            img.unpack(method="REMOVE")
        if px_arr is not None:
            img.pixels.foreach_set(px_arr.ravel())
            img.update()
        if scale_to is not None and img.size[0] > scale_to:
            img.scale(scale_to, scale_to)
            img.update()
        img.filepath_raw = str(out_path)
        img.file_format = fmt
        img.save()
        img.reload()
        img.pack()

    # Reserve the last eighth of each map for the previously unseen inner
    # panels. The scan bakes colour into the fleece, so a single sampled
    # texel would read as a grey plane when the elbow turns toward the camera.
    uv = obj.data.uv_layers.active.data
    def panel_atlas(px, kind):
        height, width, _ = px.shape
        cut = width * 7 // 8
        source_x = np.linspace(0, width - 1, cut)
        left = source_x.astype(int)
        weight = (source_x - left)[None, :, None]
        result = np.empty_like(px)
        result[:, :cut] = px[:, left] * (1 - weight) + px[:, np.minimum(left + 1, width - 1)] * weight
        if kind == 'colour':
            # Sample clean blue fleece on the original outer upper sleeve.
            samples = []
            for poly in obj.data.polygons:
                c = poly.center
                if .628 < c.z < .666 and .109 < abs(c.x) < .151 and c.y < -.02:
                    for li in poly.loop_indices:
                        u, v = uv[li].uv
                        if u <= 1:
                            rgb = px[min(height-1, max(0, int(v*height))),
                                     min(width-1, max(0, int(u*width))), :3]
                            if rgb[2] > rgb[0] * 1.06 and rgb[0] > .19:
                                samples.append(rgb)
            if not samples:
                raise ValueError('Could not sample sleeve fleece from source atlas')
            colour = np.median(samples, axis=0)
            x, y = np.meshgrid(np.linspace(0, 1, width-cut), np.linspace(0, 1, height))
            # Soft reflected light around the sleeve and shallow diagonal folds
            # match the painted shading on the adjoining scanned fabric.
            shade = .95 + .07 * np.cos((x - .52) * 2 * math.pi)
            for center, slope, strength in ((.23,.065,.09), (.47,-.075,.055), (.76,.06,.035)):
                line = y - center - slope * np.sin(math.pi*x)
                shade += strength * (np.exp(-((line-.020)/.025)**2) - np.exp(-(line/.024)**2))
            result[:, cut:, :3] = np.clip(colour * shade[:, :, None], 0, 1)
        elif kind == 'normal':
            result[:, cut:, :3] = (.5, .5, 1)
        else:
            result[:, cut:, :3] = (1, .85, 0)
        result[:, cut:, 3] = 1
        return result

    # Lift RM green channel roughness to cozy matte fleece/knit (~0.68-0.96), zero metallic,
    # paint refined 3D-projected anime face features onto basecolor, and pack optimized textures!
    tex_dir = scratch_dir / "optimized_textures"
    tex_dir.mkdir(parents=True, exist_ok=True)
    for img in mat_images:
        if img.size[0] == 0:
            continue
        lname = img.name.lower()
        if "_rm" in lname or "rough" in lname:
            w, h = img.size
            px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
            px[:, :, 0] = 1.0
            px[:, :, 1] = np.clip(0.58 + 0.36 * px[:, :, 1], 0.68, 0.96)
            px[:, :, 2] = 0.0
            px[:, :, 3] = 1.0
            save_modified_image(img, tex_dir / "hoodie_rm.png", "PNG", px_arr=panel_atlas(px, "roughness"), scale_to=1024)
        elif "basecolor" in lname:
            w, h = img.size
            px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
            paint_anime_face_features(obj, px)
            save_modified_image(img, tex_dir / "hoodie_basecolor.jpg", "JPEG", px_arr=panel_atlas(px, "colour"))
        elif "normal" in lname:
            w, h = img.size
            px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
            save_modified_image(img, tex_dir / "hoodie_normal.jpg", "JPEG", px_arr=panel_atlas(px, "normal"))

    for loop in uv:
        u, v = loop.uv
        loop.uv = ((u * .875) if u <= 1 else .875 + (u - 1) * .125, v)



def point_to_segment_dist(p: Vector, a: Vector, b: Vector):
    ab = b - a
    l2 = ab.length_squared
    if l2 < 1e-10:
        return (p - a).length, 0.0
    t = max(0.0, min(1.0, (p - a).dot(ab) / l2))
    proj = a + ab * t
    return (p - proj).length, t


def segment_and_skin(obj, ref_luna_obj, arm_obj):
    """Assign clean, semantically isolated 115-bone skin weights to Luna_Surface."""
    mesh = obj.data
    n_verts = len(mesh.vertices)
    coords = [v.co.copy() for v in mesh.vertices]

    adj = [[] for _ in range(n_verts)]
    for e in mesh.edges:
        a, b = e.vertices[0], e.vertices[1]
        adj[a].append(b)
        adj[b].append(a)

    obj.vertex_groups.clear()
    vg_map = {}
    bones = list(arm_obj.data.bones)
    for b in bones:
        vg_map[b.name] = obj.vertex_groups.new(name=b.name)
    bone_seg = {b.name: (b.head_local.copy(), b.tail_local.copy()) for b in bones}

    # Build KDTree on ref_luna_obj feet (z < 0.095) so our knit sock feet inherit Luna's EXACT foot/toe skin weights!
    ref_foot_verts = [v for v in ref_luna_obj.data.vertices if v.co.z < 0.098]
    ref_vgs = {g.index: g.name for g in ref_luna_obj.vertex_groups}
    ref_kd = KDTree(len(ref_foot_verts))
    for idx, rv in enumerate(ref_foot_verts):
        ref_kd.insert(rv.co, idx)
    ref_kd.balance()

    def x_cut(z):
        return 0.128 - 0.305 * (z - 0.51)

    region = ["TORSO"] * n_verts
    for i, p in enumerate(coords):
        ax = abs(p.x)
        s = 1 if p.x >= 0 else -1
        if p.z < 0.455:
            region[i] = "LEG_L" if s > 0 else "LEG_R"
        elif ax > 0.196 and 0.44 < p.z < 0.62:
            region[i] = "HAND_L" if s > 0 else "HAND_R"
        elif ax > x_cut(p.z) + 0.001 and p.y < 0.044 and 0.48 < p.z < 0.745:
            region[i] = "SLEEVE_L" if s > 0 else "SLEEVE_R"
        elif p.z > 0.790 or (p.z > 0.778 and p.y < -0.024 and ax < 0.046):
            # Include entire lower jaw and chin tip (z down to 0.778, y < -0.024) strictly in HEAD_RIGID
            # so chin vertices NEVER lag onto Neck/Spine2 and spike downward!
            region[i] = "HAIR" if (p.y > 0.032 and p.z < 0.865) else "HEAD_RIGID"
        elif p.z > 0.748 and math.hypot(p.x, p.y + 0.008) < 0.036:
            region[i] = "NECK"
        elif p.y > 0.044 and p.z > 0.655:
            region[i] = "HAIR"

    # Flood-fill back hair strands strictly from hanging hair tips (z >= 0.665, y > 0.052)
    # Note: the hoodie's oversized back puffs out below z=0.648, so stop strictly at z >= 0.648!
    hair_seeds = [i for i, p in enumerate(coords) if p.y > 0.052 and 0.665 <= p.z <= 0.835]
    hair_visited = set(hair_seeds)
    q = deque(hair_seeds)
    while q:
        u = q.popleft()
        for nb in adj[u]:
            if nb in hair_visited:
                continue
            p = coords[nb]
            if p.y > 0.040 and 0.648 <= p.z <= 0.865:
                hair_visited.add(nb)
                q.append(nb)
    for i in range(n_verts):
        if region[i] == "HAIR" and i not in hair_visited:
            region[i] = "TORSO" if coords[i].z < 0.79 else "HEAD_RIGID"
    for i in hair_visited:
        region[i] = "HAIR"

    # Flood-fill left/right sleeves + hands strictly outside the separated underarm seam
    for side_tag, s in (("L", 1.0), ("R", -1.0)):
        sleeve_tag = f"SLEEVE_{side_tag}"
        hand_tag = f"HAND_{side_tag}"
        seeds = [i for i, p in enumerate(coords) if s * p.x > 0.155 and 0.52 <= p.z <= 0.66 and p.y < 0.045]
        seen = set(seeds)
        q = deque(seeds)
        while q:
            u = q.popleft()
            for nb in adj[u]:
                if nb in seen:
                    continue
                p = coords[nb]
                if s * p.x <= 0.059 or p.z > 0.752 or p.z < 0.440:
                    continue
                # Stay strictly on the SLEEVE side of the bisect cut plane (NEVER leak onto the TORSO seam rim!)
                if p.z < ARMHOLE_HEIGHT - 0.003 and s * p.x < x_cut(p.z) + 0.00002:
                    continue
                if p.y > 0.050 and p.z > 0.65:
                    continue
                seen.add(nb)
                q.append(nb)
        # Below the underarm, membership follows the cut fabric. Spatial
        # nearest-bone labels can jump across the two close inner walls.
        lower_limit = ARMHOLE_HEIGHT - 0.016
        lower = {i for i in seeds if coords[i].z < lower_limit}
        queue = deque(lower)
        while queue:
            for nb in adj[queue.popleft()]:
                if nb not in lower and coords[nb].z < lower_limit:
                    lower.add(nb)
                    queue.append(nb)
        seen = {i for i in seen if coords[i].z >= lower_limit} | lower
        for i in range(n_verts):
            if region[i] in (sleeve_tag, hand_tag) and i not in seen:
                region[i] = "TORSO"
        for i in seen:
            p = coords[i]
            wrist = bone_seg[f"mixamorig:{'Left' if s > 0 else 'Right'}Hand"][0]
            elbow = bone_seg[f"mixamorig:{'Left' if s > 0 else 'Right'}ForeArm"][0]
            fore_dir = (wrist - elbow).normalized()
            along = (p - wrist).dot(fore_dir)
            d_axis = ((p - wrist) - fore_dir * along).length
            # Bare hand + thumb/fingers have d_axis <= 0.045 & along > -0.005;
            # inner puffy ribbed cuff has d_axis = 0.062..0.082 so stays strictly in SLEEVE!
            region[i] = hand_tag if (along > -0.005 and d_axis < 0.052) else sleeve_tag

    # Follow the painted wrist opening. Blue cuff vertices can lie much
    # closer to a thumb segment than to the forearm in the scanned A-pose.
    image = next(node.image for node in obj.data.materials[0].node_tree.nodes
                 if node.type == "TEX_IMAGE" and node.image.colorspace_settings.name == "sRGB")
    pixels = np.empty(len(image.pixels), dtype=np.float32)
    image.pixels.foreach_get(pixels)
    width, height = image.size
    palette = pixels.reshape(height, width, 4)
    uvs = np.empty((len(mesh.loops), 2), dtype=np.float32)
    mesh.uv_layers.active.data.foreach_get("uv", uvs.ravel())
    samples = palette[(uvs[:, 1] * height).astype(int) % height, (uvs[:, 0] * width).astype(int) % width]
    loop_ids = np.empty(len(mesh.loops), dtype=np.int32)
    mesh.loops.foreach_get("vertex_index", loop_ids)
    skin = (samples[:, 0] - samples[:, 2] > .073) & (samples[:, 0] - samples[:, 1] > .054)
    votes = np.bincount(loop_ids, weights=skin, minlength=n_verts)
    total = np.bincount(loop_ids, minlength=n_verts)
    for i, part in enumerate(region):
        if part in ("SLEEVE_L", "SLEEVE_R", "HAND_L", "HAND_R"):
            cloth = coords[i].z >= .536 or votes[i] < .5 * max(1, total[i])
            region[i] = ("SLEEVE_" if cloth else "HAND_") + part[-1]

    # Horizontal sections below the collar separate the two front locks
    # and the whole rear hair shell from the garment. A depth cutoff cuts
    # straight through the side strands where they curl around the shoulder.
    def islands_between(low, high):
        remaining = {i for i, p in enumerate(coords) if low < p.z < high}
        while remaining:
            start = remaining.pop()
            island = {start}
            queue = deque([start])
            while queue:
                neighbors = set(adj[queue.popleft()]) & remaining
                island.update(neighbors)
                remaining.difference_update(neighbors)
                queue.extend(neighbors)
            yield island

    locks = set()
    for island in islands_between(.66, .745):
        if all(.039 < abs(coords[i].x) < .078 and coords[i].y < -.066 for i in island):
            locks.update(island)
    back_locks = set()
    for island in islands_between(.62, .748):
        if min(coords[i].y for i in island) > .025 and max(coords[i].y for i in island) > .058:
            back_locks.update(island)
    if len(back_locks) < 1400:
        raise ValueError("Rear hair shell was not separated from the shoulders")
    for i, p in enumerate(coords):
        if i in back_locks:
            region[i] = "HAIR"
        elif .62 < p.z < .790 and region[i] == "HAIR":
            region[i] = "TORSO"
    for i in locks:
        region[i] = "FRINGE"
    if len(locks) < 200:
        raise ValueError("Both free front locks must be isolated from the hood")
    from heapq import heapify, heappush, heappop
    hair_distance = {i: 0. for i in locks}
    queue = [(0., i) for i in locks]
    heapify(queue)
    while queue:
        distance, i = heappop(queue)
        for nb in adj[i]:
            new = distance + (coords[nb] - coords[i]).length
            if new < min(.045, hair_distance.get(nb, 1.)):
                hair_distance[nb] = new
                heappush(queue, (new, nb))

    # Above the free shell the scan joins the hood. Feather its attachment
    # along the scanned surface so adjacent points follow the same chain.
    back_distance = {i: 0. for i in back_locks}
    queue = [(0., i) for i in back_locks if any(nb not in back_locks for nb in adj[i])]
    heapify(queue)
    while queue:
        distance, i = heappop(queue)
        for nb in adj[i]:
            new = distance + (coords[nb] - coords[i]).length
            if new < min(.071, back_distance.get(nb, 1.)):
                back_distance[nb] = new
                heappush(queue, (new, nb))

    # Use the exposed thigh's paint and its attached shorts rim for contact
    # checks. Both sides of the opening use the same leg-weight field.
    for i, p in enumerate(coords):
        if p.z < .485 and p.z > .290 and region[i] in ("TORSO", "LEG_L", "LEG_R"):
            if votes[i] > .5 * total[i]:
                region[i] = "THIGH"
            elif p.z < .454:
                region[i] = "SHORTS"

    # Pink bows on the shorts share a hue with skin. Only the two painted
    # components connected to the exposed legs belong to the thigh.
    legs = {i for i, p in enumerate(coords) if region[i] == "THIGH" and p.z < .37}
    queue = deque(legs)
    while queue:
        for nb in adj[queue.popleft()]:
            if nb not in legs and region[nb] == "THIGH":
                legs.add(nb)
                queue.append(nb)
    for i, part in enumerate(region):
        if part == "THIGH" and i not in legs:
            region[i] = "SHORTS"

    # Clean up any single isolated vertex on the cut seam whose neighbors all belong to SLEEVE_L / SLEEVE_R
    for _ in range(2):
        for i in range(n_verts):
            if region[i] == "TORSO" and coords[i].z < 0.635 and adj[i]:
                nb_regs = {region[nb] for nb in adj[i]}
                if nb_regs == {"SLEEVE_L"}:
                    region[i] = "SLEEVE_L"
                elif nb_regs == {"SLEEVE_R"}:
                    region[i] = "SLEEVE_R"

    # Verify zero TORSO <-> SLEEVE bridged faces below the armpit cut (z < 0.630)!
    bridged_low = sum(
        1 for poly in mesh.polygons
        if poly.center.z < 0.630
        and any(region[vi] == "TORSO" for vi in poly.vertices)
        and any(region[vi] in ("SLEEVE_L", "SLEEVE_R") for vi in poly.vertices)
    )
    print(f"Bridged TORSO<->SLEEVE faces below z=0.630: {bridged_low}")

    raw_weights = [{} for _ in range(n_verts)]
    hair_bones = [b.name for b in bones if b.name.startswith("Hair_")]

    def assign_capsules(p: Vector, bone_names, power=3.2, eps=0.008):
        w = {}
        for bn in bone_names:
            a, b = bone_seg[bn]
            d, _ = point_to_segment_dist(p, a, b)
            w[bn] = 1.0 / ((d + eps) ** power)
        return w

    for i, p in enumerate(coords):
        reg = region[i]
        w = {}

        if reg == "FRINGE":
            w["mixamorig:Head"] = 1.0

        elif reg == "HEAD_RIGID":
            if p.z < 0.805 and p.y > 0.0:
                t_head = smoothstep(p.z, 0.788, 0.805)
                w["mixamorig:Head"] = t_head
                w["mixamorig:Neck"] = 1.0 - t_head
            else:
                w["mixamorig:Head"] = 1.0

        elif reg == "NECK":
            t_head = smoothstep(p.z, 0.778, 0.805)
            t_spine = 1.0 - smoothstep(p.z, 0.746, 0.778)
            w["mixamorig:Head"] = t_head
            w["mixamorig:Neck"] = max(0.0, 1.0 - t_head - t_spine)
            w["mixamorig:Spine2"] = t_spine

        elif reg == "HAIR":
            # Silky transition from 100% Head at z=0.86 down to Hair_* below z=0.76 (zero step/kink!)
            root_head = smoothstep(p.z, .698, .743)
            w_hair = assign_capsules(p, hair_bones, power=3.8, eps=0.012)
            tot = sum(w_hair.values()) or 1.0
            for bn, val in w_hair.items():
                w[bn] = (1.0 - root_head) * (val / tot)
            if root_head > 0.0:
                w["mixamorig:Head"] = root_head

        elif reg == "TORSO":
            # Distribute the trunk over the spine before fitting the hem and yoke.
            z = p.z
            for bn, zc in (
                ("mixamorig:Hips", 0.515),
                ("mixamorig:Spine", 0.575),
                ("mixamorig:Spine1", 0.635),
                ("mixamorig:Spine2", 0.715),
                ("mixamorig:Neck", 0.780),
            ):
                sigma = 0.058 if "Spine" in bn else 0.050
                w[bn] = math.exp(-((z - zc) / sigma) ** 2)
            if z > 0.745 and p.y > 0.0:
                w["mixamorig:Neck"] += 0.35 * smoothstep(z, 0.745, 0.790)

            # The shoulder yoke and underarm use the same lateral gradient.
            side = "Left" if p.x >= 0 else "Right"
            lateral = abs(p.x) - x_cut(z)
            cap = smoothstep(z, ARMHOLE_HEIGHT - .071, ARMHOLE_HEIGHT - .006)
            arm = smoothstep(lateral, -.037, .042) * cap
            clavicle = .34 * cap * smoothstep(abs(p.x), .035, .086) * (1 - arm)
            total_weight = sum(w.values())
            w = {bone: value / total_weight * (1 - arm - clavicle) for bone, value in w.items()}
            w[f"mixamorig:{side}Arm"] = arm
            w[f"mixamorig:{side}Shoulder"] = clavicle

            if z < .607:
                # The fixed-chair and sofa clips already animate the anterior
                # dress chain out over the thighs. The side blends toward the
                # matching pant leg so the pocket follows a continuous arc.
                ride = 1 - smoothstep(z, .480, .607)
                front = 1 - smoothstep(p.y, -.075, -.031)
                left = smoothstep(p.x, -.028, .028)
                w = {bone: value * (1 - ride) for bone, value in w.items()}
                w["Dress_Front_01"] = ride * front
                back = smoothstep(p.y, -.015, .034)
                w[f"Dress_Back_{'L' if p.x >= 0 else 'R'}_01"] = ride * back * smoothstep(abs(p.x), .004, .038)
                w["Dress_Back_01"] = ride * back * (1 - smoothstep(abs(p.x), .004, .038))
                w["mixamorig:LeftUpLeg"] = ride * (1 - front - back) * left
                w["mixamorig:RightUpLeg"] = ride * (1 - front - back) * (1 - left)

        elif reg in ("SLEEVE_L", "SLEEVE_R"):
            s_name = "Left" if reg == "SLEEVE_L" else "Right"
            arm_a, arm_b = bone_seg[f"mixamorig:{s_name}Arm"]
            fa_a, fa_b = bone_seg[f"mixamorig:{s_name}ForeArm"]
            u_arm = (p - arm_a).dot((arm_b - arm_a).normalized()) / max(1e-5, (arm_b - arm_a).length)
            u_fa = (p - fa_a).dot((fa_b - fa_a).normalized()) / max(1e-5, (fa_b - fa_a).length)

            fore = smoothstep(u_arm, .64, 1.28)
            hand = .24 * smoothstep(u_fa, .74, 1.18)
            lateral = abs(p.x) - x_cut(p.z)
            cap = smoothstep(p.z, ARMHOLE_HEIGHT - .071, ARMHOLE_HEIGHT - .006)
            arm_fraction = lerp(1., smoothstep(lateral, -.037, .042), cap)
            clavicle = .34 * cap * smoothstep(abs(p.x), .035, .086) * (1 - arm_fraction)
            w = {"mixamorig:Spine2": 1 - arm_fraction - clavicle,
                 f"mixamorig:{s_name}Shoulder": clavicle,
                 f"mixamorig:{s_name}Arm": arm_fraction * (1 - fore),
                 f"mixamorig:{s_name}ForeArm": arm_fraction * fore * (1 - hand),
                 f"mixamorig:{s_name}Hand": arm_fraction * fore * hand}

        elif reg in ("HAND_L", "HAND_R"):
            s_name = "Left" if reg == "HAND_L" else "Right"
            ha_a, _ = bone_seg[f"mixamorig:{s_name}Hand"]
            fa_a, _ = bone_seg[f"mixamorig:{s_name}ForeArm"]
            along = (p - ha_a).dot((ha_a - fa_a).normalized())

            best_digit = None
            best_d = 1e9
            digit_bones_all = {}
            for d_name in ("Thumb", "Index", "Middle", "Ring", "Pinky"):
                segs = [f"mixamorig:{s_name}Hand{d_name}{k}" for k in (1, 2, 3)]
                digit_bones_all[d_name] = segs
                d_min = min(point_to_segment_dist(p, *bone_seg[bn])[0] for bn in segs)
                if d_min < best_d:
                    best_d = d_min
                    best_digit = d_name

            knuckle_head = bone_seg[f"mixamorig:{s_name}Hand{best_digit}1"][0]
            knuckle_tail = bone_seg[f"mixamorig:{s_name}Hand{best_digit}3"][1]
            along_digit = (p - knuckle_head).dot((knuckle_tail - knuckle_head).normalized())

            if along_digit < -0.004 or best_d > 0.016:
                t_fa = 1.0 - smoothstep(along, -0.008, 0.014)
                w[f"mixamorig:{s_name}ForeArm"] = 0.45 * t_fa
                w[f"mixamorig:{s_name}Hand"] = 1.0 - 0.45 * t_fa
            else:
                segs = digit_bones_all[best_digit]
                dw = assign_capsules(p, segs, power=4.5, eps=0.004)
                dtot = sum(dw.values()) or 1.0
                t_palm = 1.0 - smoothstep(along_digit, -0.004, 0.008)
                w[f"mixamorig:{s_name}Hand"] = t_palm
                for bn, val in dw.items():
                    w[bn] = (1.0 - t_palm) * (val / dtot)

        elif reg in ("LEG_L", "LEG_R", "THIGH", "SHORTS"):
            s_name = "Left" if p.x >= 0 else "Right"
            z = p.z
            knee_z = bone_seg[f"mixamorig:{s_name}Leg"][0].z
            if z < 0.088:
                # Transfer exact foot/toe weights from Luna's reference foot via KDTree!
                co_q, idx_q, _ = ref_kd.find(p)
                rv = ref_foot_verts[idx_q]
                for g in rv.groups:
                    bn = ref_vgs.get(g.group, "")
                    if bn in (f"mixamorig:{s_name}Leg", f"mixamorig:{s_name}Foot", f"mixamorig:{s_name}ToeBase"):
                        w[bn] = g.weight
                if not w:
                    w[f"mixamorig:{s_name}Foot"] = 1.0
            elif z > knee_z - 0.035:
                t_knee = 1.0 - smoothstep(z, knee_z - 0.032, knee_z + 0.032)
                t_hip = smoothstep(z, 0.442, 0.495) * (1.0 - smoothstep(abs(p.x), 0.018, 0.058))
                w["mixamorig:Hips"] = 0.55 * t_hip
                w[f"mixamorig:{s_name}UpLeg"] = (1.0 - 0.55 * t_hip) * (1.0 - t_knee)
                w[f"mixamorig:{s_name}Leg"] = (1.0 - 0.55 * t_hip) * t_knee
            else:
                w[f"mixamorig:{s_name}Leg"] = 1.0

        raw_weights[i] = w

    # Region-aware smoothing (allowing smooth blend across back-hair <-> scalp too, keeping face/fingers sharp!)
    smooth_group = {
        "HEAD_RIGID": "HEAD", "FRINGE": "FRINGE", "SHORTS": "BODY", "THIGH": "BODY",
        "NECK": "BODY",
        "TORSO": "BODY",
        "LEG_L": "BODY",
        "LEG_R": "BODY",
        "HAIR": "HAIR",
        "SLEEVE_L": "SLEEVE_L",
        "SLEEVE_R": "SLEEVE_R",
        "HAND_L": "HAND_L",
        "HAND_R": "HAND_R",
    }
    for iteration in range(24):
        next_w = []
        for i in range(n_verts):
            sg = smooth_group[region[i]]
            if iteration >= 4 and not (sg in ("BODY", "SLEEVE_L", "SLEEVE_R") and .602 < coords[i].z < .768):
                next_w.append(raw_weights[i])
                continue
            if sg in ("FRINGE", "HAND_L", "HAND_R"):
                next_w.append(raw_weights[i])
                continue
            if sg == "HEAD" and coords[i].y <= 0.030:
                next_w.append(raw_weights[i])
                continue
            if sg in ("HAIR", "HEAD"):
                nbs = [nb for nb in adj[i] if smooth_group[region[nb]] in ("HAIR", "HEAD") and coords[nb].y > 0.025]
            elif sg in ("BODY", "SLEEVE_L", "SLEEVE_R") and coords[i].z >= ARMHOLE_HEIGHT - 0.012:
                # Allow silky raglan weight blending across the uncut armpit/shoulder arch
                nbs = [
                    nb for nb in adj[i]
                    if smooth_group[region[nb]] == sg
                    or (coords[nb].z >= ARMHOLE_HEIGHT - 0.012 and smooth_group[region[nb]] in ("BODY", "SLEEVE_L", "SLEEVE_R"))
                ]
            else:
                nbs = [nb for nb in adj[i] if smooth_group[region[nb]] == sg]
            if not nbs:
                next_w.append(raw_weights[i])
                continue
            acc = {bn: val * 0.55 for bn, val in raw_weights[i].items()}
            inv = 0.45 / len(nbs)
            for nb in nbs:
                for bn, val in raw_weights[nb].items():
                    acc[bn] = acc.get(bn, 0.0) + val * inv
            next_w.append(acc)
        raw_weights = next_w

    obj.parent = arm_obj
    obj.matrix_parent_inverse = Matrix.Identity(4)
    mod = obj.modifiers.new(name="Armature", type="ARMATURE")
    mod.object = arm_obj

    reg_counts = {}
    for r in region:
        reg_counts[r] = reg_counts.get(r, 0) + 1
    print("Semantic regions:", reg_counts)
    # Cut fullness into the sleeve cross-section. The inner panel follows a
    # rounded section around the forearm instead of spanning the flat plane
    # where the scan fused the sleeve to the waist. Carry the loft around
    # the outer elbow and roll gently into the ribbed opening.
    for i,p in enumerate(coords):
        x, y, z = p
        side = 1 if x >= 0 else -1
        rail = x_cut(z)
        medial = abs(x) - rail
        if region[i] in ("SLEEVE_L", "SLEEVE_R"):
            inner = 1 - smoothstep(medial, .005, .089)
            bottom = smoothstep(z, .481, .534)
            roof = 1 - smoothstep(z, .583, .658)
            loft = .010 * math.exp(-((z - .625) / .069) ** 2)
            fold = .037 * inner * bottom * roof
            obj.data.vertices[i].co.x += side * (fold + loft * smoothstep(medial, .018, .065))
            obj.data.vertices[i].co.y += .006 * math.tanh((y + .014) / .025) * inner * bottom * roof
        elif region[i] == "TORSO":
            taper = math.exp(-((medial + .004) / .041) ** 2)
            obj.data.vertices[i].co.x -= side * .009 * taper * math.exp(-((z - .553) / .070) ** 2)

        if region[i] in ("TORSO", "SHORTS", "THIGH"):
            # Round the back of the shorts over each sit bone. Feather
            # through the stitched openings so the two pieces stay together
            # when the thigh turns onto either cushion.
            rear = smoothstep(y, -.016, .018) * smoothstep(abs(x), .022, .041)
            rear *= (1 - smoothstep(abs(x), .084, .128)) * smoothstep(z, .365, .409)
            rear *= 1 - smoothstep(z, .466, .532)
            obj.data.vertices[i].co.y += .0040 * rear

    # Give the knitted band an even transition into the fleece, preserving
    # the painted opening, wrist center and all exposed hand vertices.
    for i, p in enumerate(coords):
        if not region[i].startswith("SLEEVE_"):
            continue
        side = "Left" if p.x > 0 else "Right"
        wrist = bone_seg[f"mixamorig:{side}Hand"][0]
        elbow = bone_seg[f"mixamorig:{side}ForeArm"][0]
        axis = (wrist - elbow).normalized()
        along = (p - wrist).dot(axis)
        radial = p - wrist - along * axis
        band = math.exp(-((along - .012) / .021) ** 2) * smoothstep(radial.length, .024, .048)
        obj.data.vertices[i].co += radial.normalized() * (.0025 * band)
    mesh.update()
    # The scan stores split corner normals. Keep them on the face, hair
    # and ornaments, and let the freshly sewn fleece share a geometric
    # normal across UV splits on its inner sleeve, side panel and roof.
    corner_normals = np.empty((len(mesh.loops), 3), dtype=np.float32)
    mesh.corner_normals.foreach_get("vector", corner_normals.ravel())
    for loop in mesh.loops:
        i = loop.vertex_index
        if region[i] not in ("TORSO", "SLEEVE_L", "SLEEVE_R"):
            continue
        v = mesh.vertices[i]
        x, y, z = v.co
        amount = (1 - smoothstep(abs(abs(x) - x_cut(z)), .036, .061))
        amount *= smoothstep(z, .477, .517) * (1 - smoothstep(z, .657, .693))
        amount *= (1 - smoothstep(abs(y + .012), .061, .083))
        if amount > 0:
            normal = Vector(corner_normals[loop.index]).lerp(v.normal, amount)
            if normal.length_squared > 1e-8:
                corner_normals[loop.index] = normal.normalized()
    mesh.normals_split_custom_set(corner_normals.tolist())
    mesh.update()
    # Filter the weights over physical distance on the finished yoke. A
    # fixed number of edge hops gives radically different transition widths
    # on a densely bisected rim and on the original large triangles.
    cloth = {"TORSO", "SLEEVE_L", "SLEEVE_R"}
    cloth_ids = [i for i in range(n_verts) if region[i] in cloth and .535 < coords[i].z < .80]
    tree = KDTree(len(cloth_ids))
    for i in cloth_ids:
        tree.insert(mesh.vertices[i].co, i)
    tree.balance()
    area = np.zeros(n_verts)
    for poly in mesh.polygons:
        for i in poly.vertices:
            area[i] += poly.area / len(poly.vertices)
    smooth_weights = list(raw_weights)
    for i in cloth_ids:
        p = mesh.vertices[i].co
        amount = smoothstep(p.z, .567, .619) * (1 - smoothstep(p.z, .743, .780))
        amount *= smoothstep(abs(p.x), .026, .055)
        if amount == 0 or i in hair_distance or i in back_distance:
            continue
        mixed = {}
        mass = 0.
        for _, j, distance in tree.find_range(p, .092):
            if j in hair_distance or j in back_distance:
                continue
            weight = area[j] * math.exp(-.5 * (distance / .036) ** 2)
            mass += weight
            for bone, value in raw_weights[j].items():
                mixed[bone] = mixed.get(bone, 0.) + weight * value
        if mass:
            smooth_weights[i] = {bone: (1 - amount) * raw_weights[i].get(bone, 0.) + amount * mixed.get(bone, 0.) / mass
                                 for bone in raw_weights[i].keys() | mixed.keys()}
    for i, w in enumerate(smooth_weights):
        # Four exported influences are sufficient for trunk, clavicle, upper
        # arm and forearm. Pool the adjoining spine segments in the yoke
        # before pruning so a bending sleeve cannot switch between vertebrae.
        if region[i] in cloth and i not in hair_distance and i not in back_distance:
            p = coords[i]
            pool = smoothstep(p.z, .554, .611) * (1 - smoothstep(p.z, .743, .782))
            pool *= smoothstep(abs(p.x), .024, .066)
            w = w.copy()
            for name in ("mixamorig:Hips", "mixamorig:Spine", "mixamorig:Spine1"):
                share = pool * w.get(name, 0.)
                w[name] = w.get(name, 0.) - share
                w["mixamorig:Spine2"] = w.get("mixamorig:Spine2", 0.) + share
        # Apply hair attachment after weight filtering. Filtering a rigid
        # root together with sleeve neighbors previously pulled its first
        # millimetre-wide triangle along with the raised arm.
        p = coords[i]
        # The back of the scalp rises above the free hair section. Carry
        # its roots continuously up to the rigid head, across both sides
        # of the horizontal slice used to identify the hanging shell.
        head = smoothstep(p.z, .722, .751) * smoothstep(p.y, .028, .071)
        head = max(head, smoothstep(p.z, .750, .789) * smoothstep(p.y, .0, .039))
        if i in back_distance and i not in back_locks:
            head = max(head, 1 - smoothstep(back_distance[i], .009, .071))
        if i in hair_distance:
            head = max(head, 1 - smoothstep(hair_distance[i], .009, .045))
        if head:
            total = sum(w.values()) or 1.
            w = {bone: value / total * (1 - head) for bone, value in w.items()}
            w["mixamorig:Head"] = w.get("mixamorig:Head", 0.) + head
        items = sorted(((name, value) for name, value in w.items() if value > 1e-6),
                       key=lambda pair: pair[1], reverse=True)
        # A fifth joint replacing the fourth must enter at zero. A hard
        # top-four swap gave adjacent millimetre edges centimetres of travel.
        cutoff = items[4][1] if len(items) > 4 else 0.
        kept = [(name, weight - cutoff) for name, weight in items[:4] if weight > cutoff]
        if not kept:
            kept = items[:4] or [("mixamorig:Hips", 1.)]
        total = sum(weight for _, weight in kept)
        fitted = {name: weight / total for name, weight in kept}
        if region[i] in ("TORSO", "SHORTS"):
            # Carry the front pocket hem and the shorts opening over the
            # same thigh through the entire sit, including the initial bend.
            p = coords[i]
            front = smoothstep(-p.y, -.055, .035)
            # Only the anterior cloth above the welt rides over the knee.
            # Leave the sleeve side and the back coupled to the torso.
            apron = lerp(front, smoothstep(-p.y, .042, .095), smoothstep(p.z, .512, .578))
            pocket = .96 * apron * (1 - smoothstep(p.z, .515, .683))
            opening = .85 * smoothstep(-p.y, -.025, .035) * (1 - smoothstep(p.z, .473, .547))
            leg = (opening + (1 - opening) * pocket) * smoothstep(p.z, .375, .400)
            left = smoothstep(p.x, -.012, .012)
            fitted = {name: weight * (1 - leg) for name, weight in fitted.items()}
            for side, fraction in (("Left", left), ("Right", 1 - left)):
                name = f"mixamorig:{side}UpLeg"
                fitted[name] = fitted.get(name, 0.) + leg * fraction
        top = sorted(fitted.items(), key=lambda pair: pair[1], reverse=True)[:4]
        total = sum(weight for _, weight in top)
        for name, weight in top:
            if weight:
                vg_map[name].add([i], weight / total, "REPLACE")

    mesh.update()
    return region


def compute_lbs_skin_matrices(obj, arm_obj):
    """Compute exact per-vertex 4x4 LBS matrix for the current armature pose."""
    mesh = obj.data
    n = len(mesh.vertices)
    bones = list(arm_obj.pose.bones)
    bi = {b.name: idx for idx, b in enumerate(bones)}
    vg_to_b = {g.index: bi[g.name] for g in obj.vertex_groups if g.name in bi}

    weights = np.zeros((n, len(bones)), dtype=np.float64)
    for v in mesh.vertices:
        for g in v.groups:
            if g.group in vg_to_b:
                weights[v.index, vg_to_b[g.group]] = g.weight
    wsum = np.maximum(weights.sum(axis=1, keepdims=True), 1e-12)
    weights /= wsum

    bone_mats = np.array([np.array(pb.matrix @ pb.bone.matrix_local.inverted(), dtype=np.float64) for pb in bones])
    return np.einsum("nb,bij->nij", weights, bone_mats)


def bake_chair_seat_contact(obj, arm_obj, region, sit_blend: Path, seat_out: Path, base_glb: Path):
    """Bake 98-frame pre-skin chair contact displacements against the real fixed desk chair."""
    with bpy.data.libraries.load(str(sit_blend), link=False) as (data_from, data_to):
        data_to.objects = [n for n in data_from.objects if n in ("seat", "Habitat chair coordinates")]
        data_to.actions = [n for n in data_from.actions if n == "ChairSit_ScootBack"]

    seat_obj = bpy.data.objects["seat"]
    chair_coord = bpy.data.objects["Habitat chair coordinates"]
    sit_action = bpy.data.actions["ChairSit_ScootBack"]

    col = bpy.context.scene.collection
    col.objects.link(seat_obj)
    col.objects.link(chair_coord)
    bpy.context.view_layer.update()

    seat_pts = [seat_obj.matrix_world @ v.co for v in seat_obj.data.vertices]
    seat_polys = [list(p.vertices) for p in seat_obj.data.polygons]
    seat_bvh = BVHTree.FromPolygons(seat_pts, seat_polys)

    saved_basis = {pb.name: pb.matrix_basis.copy() for pb in arm_obj.pose.bones}
    saved_keys = [kb.value for kb in obj.data.shape_keys.key_blocks]
    for kb in obj.data.shape_keys.key_blocks:
        kb.value = 0.0

    old_parent = arm_obj.parent
    old_mw = arm_obj.matrix_world.copy()
    arm_obj.parent = chair_coord
    arm_obj.matrix_basis = Matrix.Identity(4)
    arm_obj.scale = (1.43, 1.43, 1.43)
    if not arm_obj.animation_data:
        arm_obj.animation_data_create()
    arm_obj.animation_data.action = sit_action

    n_verts = len(obj.data.vertices)
    rest_co = np.empty(n_verts * 3, dtype=np.float64)
    obj.data.vertices.foreach_get("co", rest_co)
    rest_co = rest_co.reshape(n_verts, 3)
    polys = [list(p.vertices) for p in obj.data.polygons]
    adj = [[] for _ in range(n_verts)]
    for e in obj.data.edges:
        a, b = e.vertices[0], e.vertices[1]
        adj[a].append(b)
        adj[b].append(a)

    # Allow cushion, backrest, and armrest contact clearance across body, hair tips, legs, and sleeves
    contact_eligible = np.array([
        rest_co[i, 2] < 0.84 and region[i] in ("TORSO", "HAIR", "SHORTS", "THIGH", "LEG_L", "LEG_R", "SLEEVE_L", "SLEEVE_R", "HAND_L", "HAND_R")
        for i in range(n_verts)
    ])

    scene = bpy.context.scene
    frames = range(1, 99)
    deltas = []
    max_overlaps_before = 0
    max_overlaps_after = 0

    # Carry the hands clear of the thick front pocket after they leave the
    # armrests. Record the same parent-local rotation for the runtime clip.
    doc, binary = read_glb(base_glb)
    skin = doc["skins"][0]
    accessor = doc["accessors"][skin["inverseBindMatrices"]]
    view = doc["bufferViews"][accessor["bufferView"]]
    bind = {doc["nodes"][node]["name"]: mat_from_gltf(struct.unpack_from(
        "<16f", binary, view.get("byteOffset", 0) + accessor.get("byteOffset", 0) + 64 * j)).inverted()
            for j, node in enumerate(skin["joints"])}
    axis = Matrix.Rotation(math.pi / 2, 4, "X").to_quaternion()
    chair_turns = {f"mixamorig:{side}Arm": [] for side in ("Left", "Right")}
    for f in frames:
        scene.frame_set(f)
        bpy.context.view_layer.update()
        release = smoothstep(f, 82, 94)
        phase = (f - 1) / 97
        forward = -.34 * (1 - smoothstep(phase, .18, .42))
        support = smoothstep(phase, .58, .68) * (1 - smoothstep(phase, .84, .94))
        outside = (.43 - .19 * support) * (1 - smoothstep(phase, .83, .98))
        for name, turns in chair_turns.items():
            b = arm_obj.pose.bones[name]
            sign = 1 if "Left" in name else -1
            turn = Euler((-.18 * release, 0., sign * .30 * release)).to_quaternion()
            turn = Quaternion((1, 0, 0), forward) @ Quaternion((0, 0, 1), sign * outside) @ turn
            parent_skin = (b.parent.matrix @ b.parent.bone.matrix_local.inverted()).to_quaternion()
            parent = axis.inverted() @ parent_skin @ axis @ bind[b.parent.name].to_quaternion()
            turns.append(parent.inverted() @ turn @ parent)
            origin = Matrix.Translation(b.matrix.translation)
            b.matrix = origin @ (axis @ turn @ axis.inverted()).to_matrix().to_4x4() @ origin.inverted() @ b.matrix
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        ev = obj.evaluated_get(dg)
        me = ev.to_mesh()
        raw_local = np.empty(n_verts * 3, dtype=np.float64)
        me.vertices.foreach_get("co", raw_local)
        raw_local = raw_local.reshape(n_verts, 3)
        ev.to_mesh_clear()

        mw = arm_obj.matrix_world
        inv_mw = mw.inverted()
        world_pts = [mw @ Vector(p) for p in raw_local]
        pairs = BVHTree.FromPolygons(world_pts, polys).overlap(seat_bvh)
        max_overlaps_before = max(max_overlaps_before, len(pairs))

        if not pairs:
            deltas.append(np.zeros((n_verts, 3), dtype=np.float32))
            continue

        # Multi-pass outward clearance against chair cushion/backrest/armrests
        target_world = [p.copy() for p in world_pts]
        for _ in range(18):
            cur_pairs = BVHTree.FromPolygons(target_world, polys).overlap(seat_bvh)
            if not cur_pairs:
                break
            hit_verts = set()
            for ma, _ in cur_pairs:
                for vi in polys[ma]:
                    if contact_eligible[vi]:
                        hit_verts.add(vi)
            if not hit_verts:
                break
            disp_w = {}
            for vi in hit_verts:
                pt = target_world[vi]
                loc, nrm, _, dist = seat_bvh.find_nearest(pt, 0.20)
                if loc is None:
                    continue
                if (pt - loc).dot(nrm) < 0.0:
                    push = (loc + nrm * 0.004) - pt
                else:
                    push = nrm * max(0.001, 0.004 - dist)
                disp_w[vi] = push
            for vi, dp in disp_w.items():
                target_world[vi] += dp
            for vi, dp in disp_w.items():
                for nb in adj[vi]:
                    if nb not in disp_w and contact_eligible[nb]:
                        target_world[nb] += dp * 0.25

        after_pairs = BVHTree.FromPolygons(target_world, polys).overlap(seat_bvh)
        max_overlaps_after = max(max_overlaps_after, len(after_pairs))
        if f == 98:
            print("Chair final frame overlaps", len(after_pairs))

        target_local = np.array([list(inv_mw @ p) for p in target_world], dtype=np.float64)
        skin_mats = compute_lbs_skin_matrices(obj, arm_obj)
        d_local = target_local - raw_local
        d_pre = np.linalg.solve(skin_mats[:, :3, :3], d_local[..., None])[..., 0].astype(np.float32)
        deltas.append(d_pre)

    print(f"Chair 98-frame contact bake: max_overlaps before={max_overlaps_before}, after={max_overlaps_after}")

    D = np.array(deltas, dtype=np.float32)
    contact_indices = np.where(np.max(np.abs(D), axis=(0, 2)) > 1e-5)[0]
    if len(contact_indices) == 0:
        contact_indices = np.array([0], dtype=np.int64)
        quantum = 1e-6
        quantized = np.zeros((len(frames), 1, 3), dtype="<i2")
    else:
        cache = D[:, contact_indices, :][:, :, [0, 2, 1]].copy()
        cache[:, :, 2] *= -1.0
        max_abs = float(np.max(np.abs(cache)))
        quantum = max(1e-6, max_abs / 32760.0)
        quantized = np.rint(cache / quantum).astype("<i2")

    header = struct.pack("<4sIIIf", b"PWSC", 1, len(frames), len(contact_indices), float(quantum))
    seat_out.parent.mkdir(parents=True, exist_ok=True)
    seat_out.write_bytes(header + quantized.tobytes())

    attr = obj.data.attributes.get("_CONTACT_ID") or obj.data.attributes.new("_CONTACT_ID", "FLOAT", "POINT")
    ids = np.full(n_verts, -1.0, dtype=np.float32)
    ids[contact_indices] = np.arange(len(contact_indices), dtype=np.float32)
    attr.data.foreach_set("value", ids)
    # Keep the actual sewn panels identifiable at UV splits and at the cuff,
    # where cloth and fingers can have the same bone weights.
    panels = {"TORSO": 1, "SLEEVE_L": 2, "SLEEVE_R": 3, "HAND_L": 4, "HAND_R": 5,
              "THIGH": 6, "SHORTS": 7, "FRINGE": 8}
    panel = obj.data.attributes.new("_GARMENT_PART", "FLOAT", "POINT")
    panel.data.foreach_set("value", np.asarray([panels.get(name, 0) for name in region], dtype=np.float32))
    print(f"Wrote seat contact cache: {seat_out.name} ({len(contact_indices)} verts, {seat_out.stat().st_size} bytes)")

    bpy.data.objects.remove(seat_obj, do_unlink=True)
    bpy.data.objects.remove(chair_coord, do_unlink=True)
    bpy.data.actions.remove(sit_action, do_unlink=True)
    arm_obj.parent = old_parent
    arm_obj.matrix_world = old_mw
    arm_obj.animation_data.action = None
    for pb in arm_obj.pose.bones:
        pb.matrix_basis = saved_basis[pb.name]
    for kb, val in zip(obj.data.shape_keys.key_blocks, saved_keys):
        kb.value = val
    bpy.context.view_layer.update()


    return chair_turns


def pack_runtime_glb(obj, arm_obj, base_glb: Path, glb_out: Path, scratch_dir: Path, chair_turns):
    """Export active scene mesh + sparse Shape Keys and splice exact Walk/Chair clips."""
    saved_basis = {pb.name: pb.matrix_basis.copy() for pb in arm_obj.pose.bones}
    saved_keys = [kb.value for kb in obj.data.shape_keys.key_blocks]
    for pb in arm_obj.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    for kb in obj.data.shape_keys.key_blocks:
        kb.value = 0.0
    bpy.context.view_layer.update()

    raw_export = scratch_dir / "hoodie_raw_export.glb"
    bpy.ops.object.select_all(action="DESELECT")
    arm_obj.select_set(True)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    bpy.ops.export_scene.gltf(
        filepath=str(raw_export),
        export_format="GLB",
        use_selection=True,
        use_active_scene=True,
        export_animations=False,
        export_morph=True,
        export_morph_normal=True,
        export_try_sparse_sk=True,
        export_morph_tangent=False,
        export_attributes=True,
        export_image_format="AUTO",
        export_jpeg_quality=92,
        export_skins=True,
        export_all_influences=False,
    )

    for pb in arm_obj.pose.bones:
        pb.matrix_basis = saved_basis[pb.name]
    for kb, val in zip(obj.data.shape_keys.key_blocks, saved_keys):
        kb.value = val
    bpy.context.view_layer.update()

    orig_doc, orig_bin = read_glb(base_glb)
    doc, db = read_glb(raw_export)

    new_bin = bytearray()
    new_views = []
    new_accs = []
    view_cache = {}
    acc_cache = {}

    def add_bytes(data: bytes):
        while len(new_bin) % 4:
            new_bin.append(0)
        off = len(new_bin)
        new_bin.extend(data)
        idx = len(new_views)
        new_views.append({"buffer": 0, "byteOffset": off, "byteLength": len(data)})
        return idx

    def copy_view(src_doc, src_bin, v_idx, tag):
        key = (tag, v_idx)
        if key in view_cache:
            return view_cache[key]
        v = copy.deepcopy(src_doc["bufferViews"][v_idx])
        start = v.get("byteOffset", 0)
        data = src_bin[start : start + v["byteLength"]]
        while len(new_bin) % 4:
            new_bin.append(0)
        v["byteOffset"] = len(new_bin)
        v["buffer"] = 0
        new_bin.extend(data)
        idx = len(new_views)
        new_views.append(v)
        view_cache[key] = idx
        return idx

    def copy_accessor(src_doc, src_bin, a_idx, tag):
        key = (tag, a_idx)
        if key in acc_cache:
            return acc_cache[key]
        a = copy.deepcopy(src_doc["accessors"][a_idx])
        if "bufferView" in a:
            a["bufferView"] = copy_view(src_doc, src_bin, a["bufferView"], tag)
        if "sparse" in a:
            for part in ("indices", "values"):
                a["sparse"][part]["bufferView"] = copy_view(src_doc, src_bin, a["sparse"][part]["bufferView"], tag)
        idx = len(new_accs)
        new_accs.append(a)
        acc_cache[key] = idx
        return idx

    # Copy mesh geometry + preserve/sparsify morph targets cleanly!
    for mesh in doc["meshes"]:
        for prim in mesh["primitives"]:
            prim["attributes"] = {k: copy_accessor(doc, db, v, "new") for k, v in prim["attributes"].items()}
            if "indices" in prim:
                prim["indices"] = copy_accessor(doc, db, prim["indices"], "new")
            if "targets" in prim:
                prim["targets"] = [{kind: copy_accessor(doc, db, idx, "new") for kind, idx in target.items()}
                                   for target in prim["targets"]]
        mesh.setdefault("extras", {})["hoodieClearance"] = True
        mesh["extras"]["hoodieStretchDuration"] = 250 / 30

    for skin in doc.get("skins", []):
        if "inverseBindMatrices" in skin:
            skin["inverseBindMatrices"] = copy_accessor(doc, db, skin["inverseBindMatrices"], "new")

    for im in doc.get("images", []):
        if "bufferView" in im:
            im["bufferView"] = copy_view(doc, db, im["bufferView"], "new")

    for mat in doc.get("materials", []):
        pbr = mat.setdefault("pbrMetallicRoughness", {})
        pbr["metallicFactor"] = 0.0
        if "normalTexture" in mat:
            mat["normalTexture"]["scale"] = 0.20
        if "baseColorTexture" in pbr:
            mat["emissiveTexture"] = {"index": pbr["baseColorTexture"]["index"]}
            mat["emissiveFactor"] = [0.32, 0.32, 0.32]

    node_map = {n.get("name"): i for i, n in enumerate(doc["nodes"])}
    doc["animations"] = []
    for anim_name in ("Walk_Grounded_Loop", "ChairSit_Contact"):
        src_anim = copy.deepcopy(next(a for a in orig_doc["animations"] if a["name"] == anim_name))
        for ch in src_anim["channels"]:
            orig_node_name = orig_doc["nodes"][ch["target"]["node"]]["name"]
            if orig_node_name not in node_map:
                raise RuntimeError(f"Exported skeleton missing bone node {orig_node_name}")
            ch["target"]["node"] = node_map[orig_node_name]
        for sam in src_anim["samplers"]:
            for key in ("input", "output"):
                sam[key] = copy_accessor(orig_doc, orig_bin, sam[key], "orig")
        if anim_name == "ChairSit_Contact":
            for channel in src_anim["channels"]:
                name = doc["nodes"][channel["target"]["node"]]["name"]
                if name not in chair_turns or channel["target"]["path"] != "rotation":
                    continue
                sampler = src_anim["samplers"][channel["sampler"]]
                accessor = new_accs[sampler["output"]]
                offset = new_views[accessor["bufferView"]]["byteOffset"] + accessor.get("byteOffset", 0)
                if accessor["count"] != len(chair_turns[name]):
                    raise ValueError("Chair clip sampling differs from the seat cache")
                values = []
                for i, turn in enumerate(chair_turns[name]):
                    x,y,z,w = struct.unpack_from("<4f", new_bin, offset + 16 * i)
                    q = turn @ Quaternion((w,x,y,z))
                    values.append((q.x,q.y,q.z,q.w))
                sampler["output"] = len(new_accs)
                data = np.asarray(values, dtype="<f4")
                new_accs.append({"type":"VEC4", "componentType":5126, "count":len(data),
                                 "bufferView":add_bytes(data.tobytes())})
        doc["animations"].append(src_anim)

    doc["bufferViews"] = new_views
    doc["accessors"] = new_accs
    doc.pop("extensionsUsed", None)
    doc.pop("extensionsRequired", None)
    write_glb(glb_out, doc, bytes(new_bin))
    print(f"Packed runtime GLB: {glb_out} ({glb_out.stat().st_size:,} bytes)")


def save_finished_garment(glb_path, pose_path, blend_path):
    """Keep the shipping mesh, its editable shape keys and preview action in the source file."""
    bpy.context.scene.name = "Hoodie_Pattern"
    final = bpy.data.scenes.new("Luna · 云朵连帽衫")
    bpy.context.window.scene = final
    previous = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(glb_path), merge_vertices=True, import_pack_images=True)
    imported = set(bpy.data.objects) - previous
    surface = next(o for o in imported if o.type == "MESH" and o.data.shape_keys)
    rig = next(o for o in imported if o.type == "ARMATURE")
    surface.name = "Luna · 连帽衫成品"
    rig.name = "Luna · 成品骨架"
    for action in bpy.data.actions:
        action.use_fake_user = True
    # Preserve the imported walk and chair Actions. The selected timeline
    # plays the stretch and all cloth shapes together and remains editable.
    rig.animation_data_clear()
    shapes = surface.data.shape_keys
    shapes.animation_data_clear()
    raw, binary = read_glb(Path(glb_path))
    names = [raw["nodes"][i]["name"] for i in raw["skins"][0]["joints"]]
    targets = raw["meshes"][0]["extras"]["targetNames"]
    pose = json.loads(Path(pose_path).read_text("utf-8"))
    rest = {b.name: b.bone.matrix_local.copy() for b in rig.pose.bones}
    to_blender = Matrix.Rotation(math.pi / 2, 4, "X")
    basis = rig.matrix_world.inverted_safe() @ surface.matrix_world @ to_blender
    inverse = basis.inverted_safe()
    bones = [rig.pose.bones.get(name) or rig.pose.bones[name.replace(":", "")] for name in names]
    previous_quat = {}
    for frame, sample in enumerate(pose["preview"], 1):
        matrices = {b.name: basis @ Matrix(np.asarray(m).reshape(4,4).T.tolist()) @ inverse @ rest[b.name]
                    for b, m in zip(bones, sample["matrices"])}
        for b in bones:
            kwargs = {}
            if b.parent:
                kwargs = {"parent_matrix": matrices.get(b.parent.name, b.parent.bone.matrix_local),
                          "parent_matrix_local": b.parent.bone.matrix_local}
            local = b.bone.convert_local_to_pose(matrices[b.name], rest[b.name], invert=True, **kwargs)
            location, rotation, scale = local.decompose()
            if b.name in previous_quat:
                rotation.make_compatible(previous_quat[b.name])
            previous_quat[b.name] = rotation.copy()
            b.rotation_mode = "QUATERNION"
            b.location, b.rotation_quaternion, b.scale = location, rotation, scale
            for channel in ("location", "rotation_quaternion", "scale"):
                b.keyframe_insert(channel, frame=frame, group=b.name)
        for name, weight in zip(targets, sample["weights"]):
            key = shapes.key_blocks[name]
            key.value = float(weight)
            key.keyframe_insert("value", frame=frame)
    rig.animation_data.action.name = "Luna · 站立与伸懒腰"
    shapes.animation_data.action.name = "连帽衫 · 同步袖型"
    final.render.fps = pose["fps"]
    final.frame_end = len(pose["preview"])
    final.timeline_markers.new("自然站定", frame=1)
    final.timeline_markers.new("呼吸", frame=1 + pose["idleFrames"] // 4)
    for label, seconds in (("伸懒腰开始", 0), ("抬臂", 3.7), ("伸展", 5.2), ("收臂", 6.85)):
        final.timeline_markers.new(label, frame=1 + pose["idleFrames"] + round(seconds * final.render.fps))
    final.frame_set(1)
    # A saved camera and soft studio lights make F12 and viewport playback
    # useful in Blender without any game or external texture paths.
    studio = bpy.data.collections.new("服装预览 · 相机与灯光")
    final.collection.children.link(studio)
    def studio_object(name, data, location, target):
        item = bpy.data.objects.new(name, data)
        studio.objects.link(item)
        item.location = location
        item.rotation_euler = (Vector(target) - item.location).to_track_quat("-Z", "Y").to_euler()
        return item
    camera = bpy.data.cameras.new("服装正面")
    camera.type = "ORTHO"
    camera.ortho_scale = 1.12
    final.camera = studio_object("服装正面", camera, (.055, -2.25, .62), (0, 0, .53))
    for label, xyz, watts, width in (("柔光", (-1.35, -1.65, 2.20), 95, 1.7),
                                      ("补光", (1.4, -.85, 1.15), 51, 1.5),
                                      ("轮廓光", (.4, 1., 1.8), 68, 1.15)):
        lamp = bpy.data.lights.new(label, "AREA")
        lamp.energy, lamp.shape, lamp.size = watts, "DISK", width
        studio_object(label, lamp, xyz, (0, 0, .58))
    final.world = bpy.data.worlds.new("服装预览背景")
    final.world.use_nodes = True
    sky = final.world.node_tree.nodes.get("Background")
    sky.inputs["Color"].default_value = (.23, .26, .31, 1)
    sky.inputs["Strength"].default_value = .45
    final.render.engine = "CYCLES"
    final.cycles.samples = 16
    final.cycles.use_denoising = True
    final.render.resolution_x, final.render.resolution_y = 600, 760
    final.render.resolution_percentage = 100
    bpy.ops.object.select_all(action="DESELECT")
    surface.select_set(True)
    bpy.context.view_layer.objects.active = surface
    for screen in bpy.data.screens:
        for area in screen.areas:
            if area.type == "VIEW_3D":
                view = area.spaces.active
                view.region_3d.view_perspective = "ORTHO"
                view.region_3d.view_location = (0, 0, .57)
                view.region_3d.view_distance = 1.60
                view.region_3d.view_rotation = Vector((-.06, 1, -.04)).to_track_quat("-Z", "Y")
                view.overlay.show_overlays = False
                view.shading.type = "MATERIAL"
    bpy.ops.file.pack_all()
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(Path(blend_path).resolve()), compress=True)
    print("Saved final Blender scene", final.name, len(bones), "bones,", len(targets), "shape keys")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--base-luna", type=Path, default=BASE_LUNA)
    parser.add_argument("--sit-blend", type=Path, default=SIT_BLEND)
    parser.add_argument("--blend-out", type=Path, default=DEFAULT_BLEND)
    parser.add_argument("--glb-out", type=Path, default=DEFAULT_GLB)
    parser.add_argument("--seat-out", type=Path, default=DEFAULT_SEAT)
    parser.add_argument("--review-dir", type=Path, default=None)
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])

    scratch_dir = args.review_dir if args.review_dir else Path(bpy.app.tempdir)
    scratch_dir.mkdir(parents=True, exist_ok=True)

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(args.base_luna), merge_vertices=False)
    arm_obj = bpy.data.objects["Luna_ContactCorrected_Baked"]
    ref_luna = bpy.data.objects["Luna_Surface"]
    ref_luna.name = "Ref_Luna_Surface"
    # Remove any extra custom bone-shape meshes imported from glTF
    for o in list(bpy.data.objects):
        if o.type == "MESH" and o != ref_luna:
            bpy.data.objects.remove(o, do_unlink=True)

    if arm_obj.animation_data:
        arm_obj.animation_data.action = None
        for tr in arm_obj.animation_data.nla_tracks:
            tr.mute = True
    for pb in arm_obj.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()

    # Step 1-4: Clean hoodie mesh, polish anime face mesh, sample matte UVs, separate underarm seams, build flat knit sock feet
    obj = clean_and_prepare_mesh(args.input.resolve())
    enhance_anime_face_mesh(obj)
    sock_uv, cloth_uv = sample_uv_palette(obj)
    separate_underarm_seams(obj, cloth_uv)
    build_flat_sock_feet_from_luna(obj, ref_luna, arm_obj, sock_uv)
    configure_cozy_matte_material(obj, scratch_dir)
    finish_small_surface_details(obj)

    # Step 5: Semantic region-aware 115-bone skinning (inheriting Luna's exact foot/toe weights!)
    region = segment_and_skin(obj, ref_luna, arm_obj)

    # Now discard temporary reference Luna mesh & its images so only hoodie assets remain!
    ref_mats = list(ref_luna.data.materials)
    bpy.data.objects.remove(ref_luna, do_unlink=True)
    for m in ref_mats:
        if m and m.users == 0:
            bpy.data.materials.remove(m)
    for im in list(bpy.data.images):
        if im.name.startswith("walk_"):
            bpy.data.images.remove(im)

    folds = runpy.run_path(str(ROOT / "scripts/refine-luna-hoodie-folds.py"))
    folds["add_fleece_keys"](obj, region)

    # Step 7: Bake 98-frame ChairSit contact cache against real fixed desk chair
    chair_turns = bake_chair_seat_contact(obj, arm_obj, region, args.sit_blend.resolve(), args.seat_out.resolve(), args.base_luna)

    # Step 8: Save editable .blend and pack sleek runtime .glb
    pack_runtime_glb(obj, arm_obj, args.base_luna.resolve(), args.glb_out.resolve(), scratch_dir, chair_turns)
    with TemporaryDirectory(dir=str(scratch_dir)) as folder:
        poses = Path(folder) / "poses.json"
        subprocess.run(["node", str(ROOT / "scripts/finish-luna-cloud-hoodie.mjs"),
                        str(args.glb_out.resolve()), str(poses)], cwd=ROOT, check=True)
        save_finished_garment(args.glb_out.resolve(), poses, args.blend_out)

    print("BUILD LUNA CLOUD HOODIE COMPLETE!")


if __name__ == "__main__":
    main()
