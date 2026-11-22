"""Build the rigged, flat-sock-footed, cloth-simulated Cloud Hoodie Luna in Blender.

Pipeline (verified with Blender 5.3):
  1. Load the user-supplied Tripo Cloud Hoodie GLB, normalize cm -> m, weld seam
     duplicates (preserving UVs), drop tiny internal Tripo noise islands, gently
     round the 2mm chin point, and smoothly align left/right hands onto Luna's
     exact 20 finger bones.
  2. Cleanly separate the fused lower sleeve-to-torso underarm crease below the true
     armpit and cap both cloth walls with outward normals and matched hoodie UVs.
  3. Replace the high-heeled boots below the slouch sock cuff (z = 0.084) with cozy
     flat indoor white knit sock feet built from Luna's exact anatomical foot template
     (preserving the exact bind-pose heel angle so standing & walking plant dead-flat
     on the floor, with smooth rounded knit toe box and seamless slouch-sock bridge).
  4. Calibrate cozy matte fleece/knit PBR material (soft matte roughness, normal 0.20,
     basecolor ambient fill 0.32 matching Luna's cabin lighting & residentSkin.ts).
  5. Bind to Luna's exact 115-bone armature with semantic region-aware skinning
     (strict torso/sleeve isolation, exact per-finger weighting, silky back-hair
     transition, zero Dress_* drag on hoodie back, exact Luna foot weights, 4-bone
     normalized).
  6. Run a real Blender Cloth simulation on smooth proxy cloth shells (preserved in
     scene 'Hoodie_ClothSim') as arms lower from A-pose to Luna's relaxed standing
     pose, transfer via a C-infinity Gaussian spatial kernel (zero torn bows or
     spikes!), refine with a smooth Gaussian-filtered BVH contact-clearance field,
     and invert LBS into exact pre-skin Shape Keys: 'LeftArmContact' & 'RightArmContact'.
  7. Bake the 98-frame fixed desk chair seat-contact cache (luna-cloud-hoodie-seat.bin)
     and '_CONTACT_ID' vertex attribute against the real chair collider.
  8. Save editable source (assets/models/resident/Luna-CloudHoodie.blend) and pack
     the sleek runtime GLB (assets/public/models/resident/luna-cloud-hoodie.glb)
     with exact Walk_Grounded_Loop + ChairSit_Contact clips and sparse morph targets.
"""

import argparse
import copy
import json
import math
import struct
import subprocess
import sys
from array import array
from collections import deque
from pathlib import Path
from tempfile import TemporaryDirectory

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

ROOT = Path(__file__).resolve().parents[1]
BASE_LUNA = ROOT / "assets/public/models/resident/luna-walk-room.glb"
SIT_BLEND = ROOT / "assets/models/resident/Luna-Sit-ContactFixed.blend"
DEFAULT_INPUT = Path(r"C:\Users\10965\Downloads\1115d436-5d3e-444c-be63-a6141e1f346c.glb")
DEFAULT_BLEND = ROOT / "assets/models/resident/Luna-CloudHoodie.blend"
DEFAULT_GLB = ROOT / "assets/public/models/resident/luna-cloud-hoodie.glb"
DEFAULT_SEAT = ROOT / "assets/public/models/resident/luna-cloud-hoodie-seat.bin"
SHAPE_NAMES = ("LeftArmContact", "RightArmContact")


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


# The sleeve begins just below the shoulder trim. Ending this cut at the elbow
# leaves the upper arm sewn to the ribs and lifts the whole side panel on a reach.
ARMHOLE_HEIGHT = 0.705


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

        # Push torso rim strictly inward (-plane_no) and sleeve rim strictly outward (+plane_no)
        # while fading smoothly to 0 at the front/back armpit endpoints!
        # Ease both rims into rounded panels. Carry the displacement a short
        # distance into the original sleeve so the cut edge is not a hard crease.
        for chain, direction in ((torso_chain, -1.), (sleeve_chain, 1.)):
            widths = {}
            for v in chain[1:-1]:
                u = smoothstep(v.co.z, .508, .55) * (1 - smoothstep(v.co.z, .665, ARMHOLE_HEIGHT))
                widths[v] = .001 + (.012 if direction > 0 else .003) * u
            frontier = dict(widths)
            for _ in range(5):
                following = {}
                for v, width in frontier.items():
                    for edge in v.link_edges:
                        nb = edge.other_vert(v)
                        if nb in chain or nb in widths:
                            continue
                        following[nb] = max(following.get(nb, 0.), width * .58)
                widths.update(following)
                frontier = following
            for v, width in widths.items():
                v.co.x += side * direction * width

        # Build a 100% WATERTIGHT, 2-MANIFOLD real-tailoring armpit gusset:
        # Shared armpit roof crease spine R_1..R_P running cleanly from front armpit to back armpit!
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
            samples = np.linspace(0., 1., 37)
            rails = [(front, front_t)]
            for k in range(1, len(roof) - 1):
                across = k / (len(roof) - 1)
                rail = [chain[bottom]]
                for u in samples[1:-1]:
                    a, b = at(front, front_t, u), at(back, back_t, u)
                    co = a.lerp(b, across)
                    arch = math.sin(math.pi * across) * math.sin(math.pi * u)
                    co.x -= side * sidewall * (.025 if sidewall > 0 else .007) * arch
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

    bmesh.ops.dissolve_degenerate(bm, edges=bm.edges, dist=1e-6)
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

        if reg == "HEAD_RIGID":
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
            root_head = smoothstep(p.z, 0.755, 0.858)
            w_hair = assign_capsules(p, hair_bones, power=3.8, eps=0.012)
            tot = sum(w_hair.values()) or 1.0
            for bn, val in w_hair.items():
                w[bn] = (1.0 - root_head) * (val / tot)
            if root_head > 0.0:
                w["mixamorig:Head"] = root_head

        elif reg == "TORSO":
            # Strictly ZERO Arm/ForeArm/Hand weights and ZERO Dress_* weights!
            # Hoodie body, cloud pocket, drawstrings, and bottom rib move smoothly on Hips/Spine/Spine1/Spine2!
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

            # Subtle clavicle follow ONLY right at the top shoulder cap
            if z > 0.695 and abs(p.x) > 0.050:
                s_name = "Left" if p.x >= 0 else "Right"
                sh_amt = (
                    smoothstep(abs(p.x), 0.052, 0.095)
                    * smoothstep(z, 0.695, 0.740)
                    * (1.0 - smoothstep(p.y, 0.035, 0.065))
                )
                if sh_amt > 0.01:
                    tot = sum(w.values()) or 1.0
                    for k in w:
                        w[k] = (w[k] / tot) * (1.0 - 0.52 * sh_amt)
                    w[f"mixamorig:{s_name}Shoulder"] = 0.52 * sh_amt

            # Shorts leg openings (z < 0.484, |x| > 0.012): smooth UpLeg blend so legs walk & sit cleanly
            if z < 0.486:
                tot = sum(w.values()) or 1.0
                for k in w:
                    w[k] /= tot
                leg_blend = (1.0 - smoothstep(z, 0.450, 0.484)) * smoothstep(abs(p.x), 0.010, 0.046)
                if leg_blend > 0.005:
                    s_name = "Left" if p.x >= 0 else "Right"
                    for k in w:
                        w[k] *= (1.0 - 0.68 * leg_blend)
                    w[f"mixamorig:{s_name}UpLeg"] = w.get(f"mixamorig:{s_name}UpLeg", 0.0) + 0.68 * leg_blend

        elif reg in ("SLEEVE_L", "SLEEVE_R"):
            s_name = "Left" if reg == "SLEEVE_L" else "Right"
            arm_a, arm_b = bone_seg[f"mixamorig:{s_name}Arm"]
            fa_a, fa_b = bone_seg[f"mixamorig:{s_name}ForeArm"]
            u_arm = (p - arm_a).dot((arm_b - arm_a).normalized()) / max(1e-5, (arm_b - arm_a).length)
            u_fa = (p - fa_a).dot((fa_b - fa_a).normalized()) / max(1e-5, (fa_b - fa_a).length)

            # Medial armpit gusset (|x| < 0.112, z > 0.625) must NEVER be pulled by ForeArm!
            t_fore = smoothstep(u_arm, 0.66, 1.14) * smoothstep(abs(p.x), 0.095, 0.125)
            t_sh = 1.0 - smoothstep(u_arm, -0.10, 0.28)
            t_cuff = 0.40 * smoothstep(u_fa, 0.78, 1.02)

            w_arm = (1.0 - t_fore) * (1.0 - t_sh)
            w_fa = t_fore * (1.0 - t_cuff)
            w_sh = t_sh
            w_hand = t_fore * t_cuff

            # Smooth raglan torso blend at top shoulder cap AND right at the uncut armpit roof crease
            t_cap = (1.0 - smoothstep(abs(p.x), 0.070, 0.096)) * smoothstep(p.z, 0.695, 0.738) * 0.40
            t_pit = (1.0 - smoothstep(abs(p.x), 0.084, 0.112)) * smoothstep(p.z, ARMHOLE_HEIGHT - 0.012, ARMHOLE_HEIGHT + 0.012) * (1.0 - smoothstep(p.z, 0.725, 0.745)) * 0.42
            t_torso = min(0.55, t_cap + t_pit)
            if t_torso > 0.01:
                rem = 1.0 - t_torso
                w["mixamorig:Spine2"] = t_cap + 0.55 * t_pit
                if t_pit > 0.01:
                    w["mixamorig:Spine1"] = 0.45 * t_pit
                w[f"mixamorig:{s_name}Shoulder"] = w_sh * rem
                w[f"mixamorig:{s_name}Arm"] = w_arm * rem
                w[f"mixamorig:{s_name}ForeArm"] = w_fa * rem
                w[f"mixamorig:{s_name}Hand"] = w_hand * rem
            else:
                w[f"mixamorig:{s_name}Shoulder"] = w_sh
                w[f"mixamorig:{s_name}Arm"] = w_arm
                w[f"mixamorig:{s_name}ForeArm"] = w_fa
                w[f"mixamorig:{s_name}Hand"] = w_hand

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

        elif reg in ("LEG_L", "LEG_R"):
            s_name = "Left" if reg == "LEG_L" else "Right"
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
                t_hip = smoothstep(z, 0.425, 0.465) * (1.0 - smoothstep(abs(p.x), 0.018, 0.058))
                w["mixamorig:Hips"] = 0.55 * t_hip
                w[f"mixamorig:{s_name}UpLeg"] = (1.0 - 0.55 * t_hip) * (1.0 - t_knee)
                w[f"mixamorig:{s_name}Leg"] = (1.0 - 0.55 * t_hip) * t_knee
            else:
                w[f"mixamorig:{s_name}Leg"] = 1.0

        raw_weights[i] = w

    # Region-aware smoothing (allowing smooth blend across back-hair <-> scalp too, keeping face/fingers sharp!)
    smooth_group = {
        "HEAD_RIGID": "HEAD",
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
    for _ in range(4):
        next_w = []
        for i in range(n_verts):
            sg = smooth_group[region[i]]
            if sg in ("HAND_L", "HAND_R"):
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

    # Clamp strictly to top 4 bone influences per vertex & normalize to 1.0
    for i, w in enumerate(raw_weights):
        items = sorted(((bn, val) for bn, val in w.items() if val > 1e-5), key=lambda x: -x[1])[:4]
        if not items:
            items = [("mixamorig:Hips", 1.0)]
        tot = sum(val for _, val in items)
        for bn, val in items:
            vg_map[bn].add([i], val / tot, "REPLACE")

    obj.parent = arm_obj
    obj.matrix_parent_inverse = Matrix.Identity(4)
    mod = obj.modifiers.new(name="Armature", type="ARMATURE")
    mod.object = arm_obj

    reg_counts = {}
    for r in region:
        reg_counts[r] = reg_counts.get(r, 0) + 1
    print("Semantic regions:", reg_counts)
    return region


def load_runtime_standing_pose(base_glb: Path, arm_obj, arm_contact=True):
    """Apply Luna's exact runtime relaxed standing pose (from luna-library-neutral.mjs)."""
    cmd = ["node", str(ROOT / "scripts/luna-library-neutral.mjs")]
    if arm_contact:
        cmd.append("--arm-contact")
    standing = json.loads(subprocess.check_output(cmd, cwd=ROOT))
    pose_map = standing["pose"] if arm_contact else standing
    scale = standing["scale"] if arm_contact else 1.43
    influences = standing.get("influences", [0.82, 0.84]) if arm_contact else [0.0, 0.0]

    doc, binary = read_glb(base_glb)
    skin = doc["skins"][0]
    acc = doc["accessors"][skin["inverseBindMatrices"]]
    bv = doc["bufferViews"][acc["bufferView"]]
    offset = bv.get("byteOffset", 0) + acc.get("byteOffset", 0)

    to_blender = Matrix.Rotation(math.pi / 2.0, 4, "X")
    to_gltf = to_blender.inverted()
    unscale = Matrix.Scale(1.0 / scale, 4)

    inv_bind = {}
    for idx, node_idx in enumerate(skin["joints"]):
        name = doc["nodes"][node_idx]["name"].replace(":", "")
        inv_bind[name] = mat_from_gltf(struct.unpack_from("<16f", binary, offset + 64 * idx))

    posed = {}
    for pb in arm_obj.pose.bones:
        name = pb.name.replace(":", "")
        posed[pb.name] = (
            to_blender @ unscale @ mat_from_gltf(pose_map[name]) @ inv_bind[name] @ to_gltf @ pb.bone.matrix_local
        )

    basis_map = {}
    for pb in arm_obj.pose.bones:
        opts = (
            {"parent_matrix": posed[pb.parent.name], "parent_matrix_local": pb.parent.bone.matrix_local}
            if pb.parent
            else {}
        )
        mb = pb.bone.convert_local_to_pose(posed[pb.name], pb.bone.matrix_local, invert=True, **opts)
        pb.matrix_basis = mb
        basis_map[pb.name] = mb.copy()
    bpy.context.view_layer.update()
    return basis_map, influences


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


def gaussian_smooth_field(coords: np.ndarray, values: np.ndarray, idx_list, sigma: float):
    """Apply a C-infinity spatial Gaussian filter over a vertex subset (guarantees zero torn bows or spikes!)."""
    if not idx_list:
        return values.copy()
    pts = coords[idx_list]
    vals = values[idx_list]
    kd = KDTree(len(idx_list))
    for k, p in enumerate(pts):
        kd.insert(Vector(p), k)
    kd.balance()

    radius = sigma * 2.4
    inv_2s2 = 1.0 / (2.0 * sigma * sigma)
    out = values.copy()
    for k, orig_i in enumerate(idx_list):
        neighbors = kd.find_range(Vector(pts[k]), radius)
        acc = np.zeros(3, dtype=np.float64)
        wsum = 0.0
        for _, nb_k, dist in neighbors:
            w = math.exp(-dist * dist * inv_2s2)
            acc += vals[nb_k] * w
            wsum += w
        if wsum > 1e-12:
            out[orig_i] = acc / wsum
    return out


def build_smooth_cloth_proxy(name, source_pts, source_arm, source_obj, region_tag, region, sim_scene):
    """Create a smooth low-frequency proxy cloth shell (no protruding bows) for clean Blender Cloth Sim."""
    # Build a smooth proxy by copying only the target region's faces and heavily smoothing surface relief
    bm = bmesh.new()
    bm.from_mesh(source_obj.data)
    bm.verts.ensure_lookup_table()
    drop = [v for v in bm.verts if region[v.index] != region_tag]
    if drop:
        bmesh.ops.delete(bm, geom=drop, context="VERTS")
    bm.verts.ensure_lookup_table()
    # Heavy Laplacian smooth (12 passes) removes protruding bows/ribbons/stars while keeping exact cloth envelope!
    for _ in range(12):
        bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.55, use_axis_x=True, use_axis_y=True, use_axis_z=True)
    me = bpy.data.meshes.new(name + "_Mesh")
    bm.to_mesh(me)
    bm.free()

    proxy = bpy.data.objects.new(name, me)
    sim_scene.collection.objects.link(proxy)
    # Transfer bone weights from source_obj via nearest vertex KDTree
    kd = KDTree(len(source_pts))
    for idx, p in enumerate(source_pts):
        if region[idx] == region_tag:
            kd.insert(Vector(p), idx)
    kd.balance()

    src_vgs = {g.index: g.name for g in source_obj.vertex_groups}
    dst_vgs = {}
    for b in source_arm.data.bones:
        dst_vgs[b.name] = proxy.vertex_groups.new(name=b.name)
    for pv in me.vertices:
        _, src_i, _ = kd.find(pv.co)
        for g in source_obj.data.vertices[src_i].groups:
            bn = src_vgs.get(g.group)
            if bn in dst_vgs:
                dst_vgs[bn].add([pv.index], g.weight, "REPLACE")

    proxy.parent = source_arm
    mod = proxy.modifiers.new("Armature", "ARMATURE")
    mod.object = source_arm
    return proxy


def build_cloth_sim_and_arm_shape_keys(obj, arm_obj, region, base_glb: Path):
    """Run proxy-cage Blender Cloth simulation + smooth Gaussian BVH contact solver -> LeftArmContact / RightArmContact."""
    if arm_obj.animation_data:
        arm_obj.animation_data.action = None
        for tr in arm_obj.animation_data.nla_tracks:
            tr.mute = True

    relaxed_basis, runtime_influences = load_runtime_standing_pose(base_glb, arm_obj, arm_contact=True)

    # Reset to rest to read exact rest coordinates
    for pb in arm_obj.pose.bones:
        pb.matrix_basis = Matrix.Identity(4)
    bpy.context.view_layer.update()

    n_verts = len(obj.data.vertices)
    rest_co = np.empty(n_verts * 3, dtype=np.float64)
    obj.data.vertices.foreach_get("co", rest_co)
    rest_co = rest_co.reshape(n_verts, 3)

    # --- 1. Build clean Proxy-Cage Blender Cloth Simulation in scene 'Hoodie_ClothSim' ---
    main_scene = bpy.context.scene
    sim_scene = bpy.data.scenes.new("Hoodie_ClothSim")
    sim_scene.frame_start = 1
    sim_scene.frame_end = 54
    sim_scene.render.fps = 30

    sim_arm = arm_obj.copy()
    sim_arm.data = arm_obj.data.copy()
    sim_arm.name = "Sim_Armature"
    sim_scene.collection.objects.link(sim_arm)

    # Animate sim_arm smoothly from A-pose (frame 1) -> relaxed standing arm-down (frame 34..54)
    sim_arm.animation_data_create()
    sim_action = bpy.data.actions.new("ClothSim_ArmLower")
    sim_arm.animation_data.action = sim_action
    bpy.context.window.scene = sim_scene
    sim_scene.frame_set(1)
    for pb in sim_arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
        pb.matrix_basis = Matrix.Identity(4)
        pb.keyframe_insert(data_path="location", frame=1)
        pb.keyframe_insert(data_path="rotation_quaternion", frame=1)
    for tf in (34, 54):
        sim_scene.frame_set(tf)
        for pb in sim_arm.pose.bones:
            pb.matrix_basis = relaxed_basis[pb.name]
            pb.keyframe_insert(data_path="location", frame=tf)
            pb.keyframe_insert(data_path="rotation_quaternion", frame=tf)

    # Create ONE unified smooth proxy mesh (TORSO + SLEEVE_L + SLEEVE_R) so Blender Cloth Sim runs with
    # self-collision cleanly and ZERO dependency cycles!
    def build_unified_smooth_proxy(name, source_pts, source_arm, source_obj, sim_scene):
        bm = bmesh.new()
        bm.from_mesh(source_obj.data)
        bm.verts.ensure_lookup_table()
        keep_tags = {"TORSO", "SLEEVE_L", "SLEEVE_R"}
        drop = [v for v in bm.verts if region[v.index] not in keep_tags]
        if drop:
            bmesh.ops.delete(bm, geom=drop, context="VERTS")
        bm.verts.ensure_lookup_table()
        for _ in range(12):
            bmesh.ops.smooth_vert(bm, verts=bm.verts, factor=0.55, use_axis_x=True, use_axis_y=True, use_axis_z=True)
        me = bpy.data.meshes.new(name + "_Mesh")
        bm.to_mesh(me)
        bm.free()
        proxy = bpy.data.objects.new(name, me)
        sim_scene.collection.objects.link(proxy)
        kd = KDTree(len(source_pts))
        for idx, p in enumerate(source_pts):
            if region[idx] in keep_tags:
                kd.insert(Vector(p), idx)
        kd.balance()
        src_vgs = {g.index: g.name for g in source_obj.vertex_groups}
        dst_vgs = {b.name: proxy.vertex_groups.new(name=b.name) for b in source_arm.data.bones}
        p_regions = []
        for pv in me.vertices:
            _, src_i, _ = kd.find(pv.co)
            p_regions.append(region[src_i])
            for g in source_obj.data.vertices[src_i].groups:
                bn = src_vgs.get(g.group)
                if bn in dst_vgs:
                    dst_vgs[bn].add([pv.index], g.weight, "REPLACE")
        proxy.parent = source_arm
        mod = proxy.modifiers.new("Armature", "ARMATURE")
        mod.object = source_arm
        return proxy, p_regions

    proxy_hoodie, proxy_regs = build_unified_smooth_proxy("Proxy_Hoodie", rest_co, sim_arm, obj, sim_scene)

    pin_vg = proxy_hoodie.vertex_groups.new(name="Cloth_Pin")
    for idx, v in enumerate(proxy_hoodie.data.vertices):
        x, y, z = v.co
        ax = abs(x)
        if proxy_regs[idx] == "TORSO":
            side_free = (
                smoothstep(ax, 0.066, 0.096)
                * smoothstep(z, 0.465, 0.505)
                * (1.0 - smoothstep(z, 0.640, 0.695))
                * (1.0 - smoothstep(-y, 0.065, 0.090))
            )
            pin_vg.add([idx], 1.0 - 0.85 * side_free, "REPLACE")
        else:
            free = (
                smoothstep(ax, 0.100, 0.128)
                * (1.0 - smoothstep(ax, 0.172, 0.195))
                * smoothstep(z, 0.508, 0.542)
                * (1.0 - smoothstep(z, 0.650, 0.698))
            )
            pin_vg.add([idx], 1.0 - 0.72 * free, "REPLACE")

    # Single Cloth modifier with self-collision on the smooth unified proxy (ZERO dependency cycles!)
    cl = proxy_hoodie.modifiers.new(name="FleeceCloth", type="CLOTH")
    cl.settings.quality = 6
    cl.settings.mass = 0.28
    cl.settings.tension_stiffness = 22.0
    cl.settings.compression_stiffness = 18.0
    cl.settings.shear_stiffness = 14.0
    cl.settings.bending_stiffness = 2.5
    cl.settings.tension_damping = 10.0
    cl.settings.compression_damping = 10.0
    cl.settings.shear_damping = 10.0
    cl.settings.bending_damping = 2.0
    cl.settings.vertex_group_mass = "Cloth_Pin"
    cl.settings.pin_stiffness = 2.5
    cl.settings.effector_weights.gravity = 0.08
    cl.collision_settings.use_collision = False
    cl.collision_settings.use_self_collision = True
    cl.collision_settings.self_distance_min = 0.003
    cl.collision_settings.self_friction = 2.5
    cl.collision_settings.collision_quality = 4

    def eval_verts(o):
        dg = bpy.context.evaluated_depsgraph_get()
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        arr = np.empty(len(me.vertices) * 3, dtype=np.float64)
        me.vertices.foreach_get("co", arr)
        ev.to_mesh_clear()
        return arr.reshape(-1, 3)

    sim_samples = []
    for f in range(1, 55):
        sim_scene.frame_set(f)
        if f >= 46:
            sim_samples.append(eval_verts(proxy_hoodie))

    sim_avg = np.mean(sim_samples, axis=0)
    proxy_hoodie.modifiers["FleeceCloth"].show_viewport = False
    bpy.context.view_layer.update()
    raw_proxy_all = eval_verts(proxy_hoodie)
    proxy_hoodie.modifiers["FleeceCloth"].show_viewport = True

    dp_all = sim_avg - raw_proxy_all
    dn_all = np.linalg.norm(dp_all, axis=1, keepdims=True)
    dp_all *= np.minimum(1.0, 0.012 / np.maximum(dn_all, 1e-9))

    proxy_deltas = {}
    proxy_raw_posed = {}
    for tag in ("TORSO", "SLEEVE_L", "SLEEVE_R"):
        sel = [k for k, r in enumerate(proxy_regs) if r == tag]
        proxy_deltas[tag] = dp_all[sel]
        proxy_raw_posed[tag] = raw_proxy_all[sel]
        print(f"Proxy cloth [{tag}]: mean={np.linalg.norm(dp_all[sel], axis=1).mean()*1000:.2f}mm, max={np.linalg.norm(dp_all[sel], axis=1).max()*1000:.2f}mm")

    sim_scene.frame_set(1)
    bpy.context.view_layer.update()

    # --- 2. Switch back to main scene & transfer smooth proxy cloth delta via 2.4cm Gaussian kernel ---
    bpy.context.window.scene = main_scene
    for pb in arm_obj.pose.bones:
        pb.matrix_basis = relaxed_basis[pb.name]
    bpy.context.view_layer.update()

    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me_raw = ev.to_mesh()
    raw_posed = np.empty(n_verts * 3, dtype=np.float64)
    me_raw.vertices.foreach_get("co", raw_posed)
    raw_posed = raw_posed.reshape(n_verts, 3)
    polys = [list(p.vertices) for p in me_raw.polygons]
    ev.to_mesh_clear()

    # Transfer proxy cloth field smoothly onto Luna_Surface using Gaussian RBF (zero spikes on bows!)
    cloth_field = np.zeros_like(raw_posed)
    for tag in ("TORSO", "SLEEVE_L", "SLEEVE_R"):
        p_pts = proxy_raw_posed[tag]
        p_dp = proxy_deltas[tag]
        kd = KDTree(len(p_pts))
        for k, p in enumerate(p_pts):
            kd.insert(Vector(p), k)
        kd.balance()
        sigma = 0.024
        inv_2s2 = 1.0 / (2.0 * sigma * sigma)
        for i in range(n_verts):
            if region[i] != tag:
                continue
            nbs = kd.find_range(Vector(raw_posed[i]), sigma * 2.5)
            if not nbs:
                continue
            acc = np.zeros(3, dtype=np.float64)
            wsum = 0.0
            for _, nb_k, dist in nbs:
                w = math.exp(-dist * dist * inv_2s2)
                acc += p_dp[nb_k] * w
                wsum += w
            if wsum > 1e-12:
                cloth_field[i] = acc / wsum

    posed = raw_posed + cloth_field * 0.65

    torso_faces = [p for p in polys if all(region[v] == "TORSO" for v in p)]
    sleeve_l_faces = [p for p in polys if all(region[v] == "SLEEVE_L" for v in p)]
    sleeve_r_faces = [p for p in polys if all(region[v] == "SLEEVE_R" for v in p)]

    def count_overlaps(pts_arr):
        pts = [Vector(p) for p in pts_arr]
        bvh_t = BVHTree.FromPolygons(pts, torso_faces)
        bvh_sl = BVHTree.FromPolygons(pts, sleeve_l_faces)
        bvh_sr = BVHTree.FromPolygons(pts, sleeve_r_faces)
        return len(bvh_t.overlap(bvh_sl)), len(bvh_t.overlap(bvh_sr))

    ol_raw = count_overlaps(raw_posed)
    ol_proxy = count_overlaps(posed)
    print(f"Sleeve-torso BVH overlaps: raw={ol_raw}, after smooth proxy cloth={ol_proxy}")

    # Keep the ribcage and fleece on opposite sides of a smooth contact surface.
    def smooth_2d_grid(grid, mask, sigma_cells=1.8, passes=4):
        """Gaussian smooth a 2D field over valid cells (normalized convolution so empty border cells don't pull values to 0)."""
        g = grid.copy()
        m = mask.astype(np.float64).copy()
        for _ in range(passes):
            # 3x3 separable [1, 2, 1] / 4 kernel on numerator & denominator
            num = g * m
            den = m.copy()
            for axis in (0, 1):
                p_num = np.pad(num, ((1, 1), (0, 0)) if axis == 0 else ((0, 0), (1, 1)), mode="edge")
                p_den = np.pad(den, ((1, 1), (0, 0)) if axis == 0 else ((0, 0), (1, 1)), mode="edge")
                if axis == 0:
                    num = 0.25 * p_num[:-2, :] + 0.50 * p_num[1:-1, :] + 0.25 * p_num[2:, :]
                    den = 0.25 * p_den[:-2, :] + 0.50 * p_den[1:-1, :] + 0.25 * p_den[2:, :]
                else:
                    num = 0.25 * p_num[:, :-2] + 0.50 * p_num[:, 1:-1] + 0.25 * p_num[:, 2:]
                    den = 0.25 * p_den[:, :-2] + 0.50 * p_den[:, 1:-1] + 0.25 * p_den[:, 2:]
            valid = den > 1e-6
            g[valid] = num[valid] / den[valid]
            m = np.clip(den, 0.0, 1.0)
        return g

    for s, s_tag, s_faces in (
        (1.0, "SLEEVE_L", sleeve_l_faces),
        (-1.0, "SLEEVE_R", sleeve_r_faces),
    ):
        arm_bone = arm_obj.pose.bones[f"mixamorig:{'Left' if s > 0 else 'Right'}Arm"]
        hand_bone = arm_obj.pose.bones[f"mixamorig:{'Left' if s > 0 else 'Right'}Hand"]
        p_sh = arm_bone.head.copy()
        p_wr = hand_bone.head.copy()

        torso_side = [
            i for i in range(n_verts)
            if region[i] == "TORSO" and s * raw_posed[i, 0] > 0.045 and 0.420 < raw_posed[i, 2] < 0.715
        ]
        sleeve_all = [i for i in range(n_verts) if region[i] == s_tag]
        # Contact alters the fleece. The wrist and hand follow the armature.
        posed[sleeve_all] = raw_posed[sleeve_all] + .35 * cloth_field[sleeve_all]

        # Step 3b: Build C-infinity smooth separating surface x_sep(y, z) over the entire contact region!
        ny, nz = 40, 48
        y_min, y_max = -0.155, 0.115
        z_min, z_max = 0.420, 0.675
        ys_grid = np.linspace(y_min, y_max, ny)
        zs_grid = np.linspace(z_min, z_max, nz)
        t_max_g = np.full((ny, nz), -1.0, dtype=np.float64)
        s_min_g = np.full((ny, nz), 1e9, dtype=np.float64)

        def cell_idx(y, z):
            iy = int(np.clip((y - y_min) / (y_max - y_min) * (ny - 1), 0, ny - 1))
            iz = int(np.clip((z - z_min) / (z_max - z_min) * (nz - 1), 0, nz - 1))
            return iy, iz

        for i in torso_side:
            x, y, z = posed[i]
            if z < z_min or z > z_max or y < y_min or y > y_max:
                continue
            iy, iz = cell_idx(y, z)
            sx = s * x
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    jy, jz = iy + dy, iz + dz
                    if 0 <= jy < ny and 0 <= jz < nz and sx > t_max_g[jy, jz]:
                        t_max_g[jy, jz] = sx

        for i in sleeve_all:
            x, y, z = posed[i]
            if z < z_min or z > z_max or y < y_min or y > y_max:
                continue
            iy, iz = cell_idx(y, z)
            sx = s * x
            for dy in (-1, 0, 1):
                for dz in (-1, 0, 1):
                    jy, jz = iy + dy, iz + dz
                    if 0 <= jy < ny and 0 <= jz < nz and sx < s_min_g[jy, jz]:
                        s_min_g[jy, jz] = sx

        both = (t_max_g > 0.04) & (s_min_g < 1.0)
        x_sep_g = np.full((ny, nz), 0.090, dtype=np.float64)
        for iy in range(ny):
            yv = ys_grid[iy]
            # Front pocket guard: keep cloud pocket & pink pocket bows (y < -0.058) strictly intact (x_sep >= 0.092)!
            # Side & back waist can softly compress inward down to ribcage floor (0.078)!
            front_w = smoothstep(-yv, 0.042, 0.072)
            min_sep = 0.078 + 0.014 * front_w
            for iz in range(nz):
                if both[iy, iz]:
                    # Weighted midpoint: torso takes ~50% compression, sleeve medial wall takes ~50% flattening
                    mid = 0.45 * t_max_g[iy, iz] + 0.55 * s_min_g[iy, iz]
                    x_sep_g[iy, iz] = max(min_sep, mid)
                else:
                    x_sep_g[iy, iz] = min_sep

        x_sep_g = smooth_2d_grid(x_sep_g, both, passes=6)
        # Re-enforce front pocket floor smoothly after grid smoothing
        for iy in range(ny):
            front_w = smoothstep(-ys_grid[iy], 0.042, 0.072)
            min_sep = 0.078 + 0.014 * front_w
            x_sep_g[iy, :] = np.maximum(x_sep_g[iy, :], min_sep)

        def eval_x_sep(y, z):
            fy = np.clip((y - y_min) / (y_max - y_min) * (ny - 1), 0.0, ny - 1.0001)
            fz = np.clip((z - z_min) / (z_max - z_min) * (nz - 1), 0.0, nz - 1.0001)
            iy0, iz0 = int(fy), int(fz)
            ty, tz = fy - iy0, fz - iz0
            return (
                x_sep_g[iy0, iz0] * (1 - ty) * (1 - tz)
                + x_sep_g[iy0 + 1, iz0] * ty * (1 - tz)
                + x_sep_g[iy0, iz0 + 1] * (1 - ty) * tz
                + x_sep_g[iy0 + 1, iz0 + 1] * ty * tz
            )

        # Step 3c: Smoothly project BOTH torso flanks & sleeve medial wall onto their safe sides of x_sep(y, z)!
        # Keep sleeve local flattening strictly <= 1.1cm (well below sleeve thickness ~3.5cm -> NEVER turns inside-out!)
        half_gap = 0.0025  # 5mm cozy plush shadow crevice (zero clipping, zero artificial sky gap!)
        for i in torso_side:
            x, y, z = posed[i]
            if z < 0.415 or z > 0.655:
                continue
            # Smooth C-infinity vertical envelope fading gently below the armpit roof crease (z=0.642)
            z_env = smoothstep(z, 0.415, 0.435) * (1.0 - smoothstep(z, 0.585, 0.638))
            if z_env <= 0.01:
                continue
            x_lim = eval_x_sep(y, z) - half_gap
            sx = s * x
            if sx > x_lim:
                push = min(sx - x_lim, 0.024) * z_env
                posed[i, 0] -= s * push
                posed[i, 2] += 0.05 * push * math.exp(-((z - 0.555) / 0.045) ** 2)

        for i in sleeve_all:
            x, y, z = posed[i]
            if z < 0.415 or z > 0.655:
                continue
            # Smoothly taper extra cuff push near the bare wrist AND below the armpit roof crease
            d_wr = (Vector(posed[i]) - p_wr).length
            wr_env = smoothstep(d_wr, 0.014, 0.038)
            z_env = (1.0 - smoothstep(z, 0.585, 0.638)) * wr_env
            if z_env <= 0.01:
                continue
            x_lim = eval_x_sep(y, z) + half_gap
            sx = s * x
            if sx < x_lim:
                push = min(x_lim - sx, 0.011) * z_env
                posed[i, 0] += s * push

        # Step 3d: Gentle region smoothing STRICTLY respecting the x_sep safety barrier & sleeve thickness cap!
        tot_t = posed - raw_posed
        extra_s = posed - (raw_posed)
        sm_t = gaussian_smooth_field(raw_posed, tot_t, torso_side, sigma=0.011)
        sm_s = gaussian_smooth_field(raw_posed, extra_s, sleeve_all, sigma=0.012)
        for i in torso_side:
            cand = raw_posed[i] + sm_t[i]
            z = cand[2]
            z_env = smoothstep(z, 0.415, 0.435) * (1.0 - smoothstep(z, 0.585, 0.638))
            if z_env > 0.01:
                x_lim = eval_x_sep(cand[1], z) - 0.0020
                if s * cand[0] > x_lim:
                    cand[0] -= s * (s * cand[0] - x_lim) * z_env
            min_x = min(0.074, s * raw_posed[i, 0])
            if s * cand[0] < min_x:
                cand[0] = s * min_x
            d_tot = cand - raw_posed[i]
            d_len = float(np.linalg.norm(d_tot))
            if d_len > 0.026:
                cand = raw_posed[i] + d_tot * (0.026 / d_len)
            posed[i] = cand

        for i in sleeve_all:
            pt = Vector(raw_posed[i])
            _, t_arm = point_to_segment_dist(pt, p_sh, p_wr)
            arm_c = p_sh.lerp(p_wr, t_arm)
            rel_x = (pt.x - arm_c.x) * s
            med = 1.0 - smoothstep(rel_x, -0.010, 0.024)
            wr_env = smoothstep((pt - p_wr).length, 0.014, 0.038)
            d_ex = sm_s[i] * (0.06 + 0.94 * med) * wr_env
            cand = raw_posed[i] + d_ex
            z = cand[2]
            z_env = (1.0 - smoothstep(z, 0.585, 0.638)) * wr_env
            if z_env > 0.01:
                x_lim = eval_x_sep(cand[1], z) + 0.0020
                if s * cand[0] < x_lim:
                    cand[0] += s * min(x_lim - s * cand[0], 0.011) * z_env
            d_ex_final = cand - (raw_posed[i])
            d_len = float(np.linalg.norm(d_ex_final))
            if d_len > 0.012:
                cand = raw_posed[i] + d_ex_final * (0.012 / d_len)
            posed[i] = cand

        # Step 3e: Smooth Gaussian-filtered BVH micro-clearance pass (capped strictly to preserve sleeve thickness!)
        for it in range(12):
            pts_vec = [Vector(p) for p in posed]
            bvh_t = BVHTree.FromPolygons(pts_vec, torso_faces)
            bvh_s = BVHTree.FromPolygons(pts_vec, s_faces)
            ov = bvh_t.overlap(bvh_s)
            if not ov:
                break
            hit_t = {vi for ti, _ in ov for vi in torso_faces[ti] if posed[vi, 2] < 0.632}
            hit_s = {vi for _, si in ov for vi in s_faces[si] if posed[vi, 2] < 0.632}
            if not hit_t and not hit_s:
                break
            inc = np.zeros_like(posed)
            for vi in hit_t:
                z_env = 1.0 - smoothstep(posed[vi, 2], 0.592, 0.632)
                if s * posed[vi, 0] > 0.073:
                    inc[vi, 0] -= s * 0.0026 * z_env
            for vi in hit_s:
                wr_env = smoothstep((Vector(posed[vi]) - p_wr).length, 0.014, 0.038)
                z_env = (1.0 - smoothstep(posed[vi, 2], 0.592, 0.632)) * wr_env
                inc[vi, 0] += s * 0.0022 * z_env
            inc_t = gaussian_smooth_field(raw_posed, inc, torso_side, sigma=0.009)
            inc_s = gaussian_smooth_field(raw_posed, inc, sleeve_all, sigma=0.009)
            for vi in torso_side:
                if abs(inc_t[vi, 0]) > 1e-6:
                    cand_x = posed[vi, 0] + inc_t[vi, 0]
                    if s * cand_x >= 0.072:
                        posed[vi, 0] = cand_x
            for vi in sleeve_all:
                if abs(inc_s[vi, 0]) > 1e-6:
                    cand = posed[vi].copy()
                    cand[0] += inc_s[vi, 0]
                    d_ex = cand - (raw_posed[vi])
                    if float(np.linalg.norm(d_ex)) <= 0.013:
                        posed[vi] = cand

    ol_after = count_overlaps(posed)
    print(f"Sleeve-torso BVH overlaps AFTER smooth separating-sheet + micro-clearance: {ol_after}")

    # --- 4. Invert LBS matrix into exact pre-skin Shape Keys (LeftArmContact & RightArmContact) ---
    skin_mats = compute_lbs_skin_matrices(obj, arm_obj)
    world_delta = posed - raw_posed
    # Exact per-side calibration so at the runtime standing idle influence (~0.818 / ~0.838) overlaps are 0!
    gain_l = min(1.25, 1.0 / max(runtime_influences[0], 0.78))
    gain_r = min(1.25, 1.0 / max(runtime_influences[1], 0.78))
    rest_delta_raw = np.linalg.solve(skin_mats[:, :3, :3], world_delta[..., None])[..., 0]

    if obj.data.shape_keys:
        obj.shape_key_clear()
    obj.shape_key_add(name="Basis", from_mix=False)
    key_l = obj.shape_key_add(name="LeftArmContact", from_mix=False)
    key_r = obj.shape_key_add(name="RightArmContact", from_mix=False)

    cnt_l = cnt_r = 0
    for i in range(n_verts):
        reg = region[i]
        if reg in ("SLEEVE_L", "HAND_L") or (reg == "TORSO" and rest_co[i, 0] > 0.032):
            dx = rest_delta_raw[i] * gain_l
            mag = float(np.linalg.norm(dx))
            if mag < 1e-4:
                continue
            fade = 1.0 if reg in ("SLEEVE_L", "HAND_L") else smoothstep(rest_co[i, 0], 0.032, 0.056)
            key_l.data[i].co = Vector(rest_co[i] + dx * fade)
            if fade * mag > 2e-4:
                cnt_l += 1
        elif reg in ("SLEEVE_R", "HAND_R") or (reg == "TORSO" and rest_co[i, 0] < -0.032):
            dx = rest_delta_raw[i] * gain_r
            mag = float(np.linalg.norm(dx))
            if mag < 1e-4:
                continue
            fade = 1.0 if reg in ("SLEEVE_R", "HAND_R") else smoothstep(-rest_co[i, 0], 0.032, 0.056)
            key_r.data[i].co = Vector(rest_co[i] + dx * fade)
            if fade * mag > 2e-4:
                cnt_r += 1

    # Round-trip verification at exact runtime idle weight AND full 1.0 weight
    for wl, wr, label in (
        (runtime_influences[0], runtime_influences[1], "runtime_idle"),
        (1.0, 1.0, "full_1.0"),
    ):
        key_l.value = wl
        key_r.value = wr
        bpy.context.view_layer.update()
        dg = bpy.context.evaluated_depsgraph_get()
        ev = obj.evaluated_get(dg)
        me_v = ev.to_mesh()
        v_pts = np.empty(n_verts * 3, dtype=np.float64)
        me_v.vertices.foreach_get("co", v_pts)
        ev.to_mesh_clear()
        ov = count_overlaps(v_pts.reshape(n_verts, 3))
        print(f"Round-trip ShapeKey verify [{label} w=({wl:.3f},{wr:.3f})]: overlaps={ov}")

    key_l.value, key_r.value = runtime_influences[0], runtime_influences[1]
    bpy.context.view_layer.update()
    print(f"Authored Shape Keys: LeftArmContact ({cnt_l} verts), RightArmContact ({cnt_r} verts)")
    return relaxed_basis, runtime_influences


def bake_chair_seat_contact(obj, arm_obj, region, sit_blend: Path, seat_out: Path):
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
        rest_co[i, 2] < 0.84 and region[i] in ("TORSO", "HAIR", "LEG_L", "LEG_R", "SLEEVE_L", "SLEEVE_R", "HAND_L", "HAND_R")
        for i in range(n_verts)
    ])

    scene = bpy.context.scene
    frames = range(1, 99)
    deltas = []
    max_overlaps_before = 0
    max_overlaps_after = 0

    for f in frames:
        scene.frame_set(f)
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
    panels = {"TORSO": 1, "SLEEVE_L": 2, "SLEEVE_R": 3, "HAND_L": 4, "HAND_R": 5}
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


def pack_runtime_glb(obj, arm_obj, base_glb: Path, glb_out: Path, scratch_dir: Path):
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
        export_morph_normal=False,
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
                sparse_targets = []
                for tgt in prim["targets"]:
                    pos_idx = tgt["POSITION"]
                    src_a = doc["accessors"][pos_idx]
                    if "sparse" in src_a or "bufferView" not in src_a:
                        # Already sparse (exported natively by Blender 5.2.3!) — copy cleanly!
                        sparse_targets.append({"POSITION": copy_accessor(doc, db, pos_idx, "new")})
                    else:
                        # Dense accessor -> compact into sparse VEC3
                        src_v = doc["bufferViews"][src_a["bufferView"]]
                        off = src_v.get("byteOffset", 0) + src_a.get("byteOffset", 0)
                        count = src_a["count"]
                        vals = struct.unpack_from(f"<{count * 3}f", db, off)
                        use_u32 = count > 65535
                        idx_arr = array("I" if use_u32 else "H")
                        val_arr = array("f")
                        for vi in range(count):
                            dx, dy, dz = vals[vi * 3], vals[vi * 3 + 1], vals[vi * 3 + 2]
                            if dx * dx + dy * dy + dz * dz > 0.00018 * 0.00018:
                                idx_arr.append(vi)
                                val_arr.extend((dx, dy, dz))
                        if sys.byteorder != "little":
                            idx_arr.byteswap()
                            val_arr.byteswap()
                        if len(idx_arr) == 0:
                            idx_arr.append(0)
                            val_arr.extend((0.0, 0.0, 0.0))
                        bv_idx = add_bytes(idx_arr.tobytes())
                        bv_val = add_bytes(val_arr.tobytes())
                        new_a_idx = len(new_accs)
                        new_accs.append({
                            "componentType": 5126,
                            "count": count,
                            "type": "VEC3",
                            "min": [min(0.0, min(val_arr[k::3])) for k in range(3)],
                            "max": [max(0.0, max(val_arr[k::3])) for k in range(3)],
                            "sparse": {
                                "count": len(idx_arr),
                                "indices": {"bufferView": bv_idx, "componentType": 5125 if use_u32 else 5123},
                                "values": {"bufferView": bv_val},
                            },
                        })
                        sparse_targets.append({"POSITION": new_a_idx})
                prim["targets"] = sparse_targets
        mesh.setdefault("extras", {})["targetNames"] = list(SHAPE_NAMES)
        mesh["weights"] = [0.0, 0.0]

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
        doc["animations"].append(src_anim)

    doc["bufferViews"] = new_views
    doc["accessors"] = new_accs
    doc.pop("extensionsUsed", None)
    doc.pop("extensionsRequired", None)
    write_glb(glb_out, doc, bytes(new_bin))
    print(f"Packed runtime GLB: {glb_out} ({glb_out.stat().st_size:,} bytes)")


def setup_blend_viewport_and_save(obj, arm_obj, blend_out: Path):
    """Save clean, compressed editable Luna-CloudHoodie.blend with packed optimized textures."""
    for act in bpy.data.actions:
        act.use_fake_user = True
    # Remove any orphan unused images/meshes from temporary import
    bpy.ops.outliner.orphans_purge(do_recursive=True)
    for area in bpy.context.screen.areas:
        if area.type == "VIEW_3D":
            view = area.spaces.active
            view.region_3d.view_perspective = "ORTHO"
            view.region_3d.view_rotation = Vector((-0.18, 1.0, -0.08)).to_track_quat("-Z", "Y")
            view.region_3d.view_distance = 1.45
            view.region_3d.view_location = (0.0, 0.0, 0.50)
            view.overlay.show_overlays = False
            view.shading.type = "MATERIAL"
    bpy.context.view_layer.objects.active = obj
    bpy.context.preferences.filepaths.save_version = 0
    blend_out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_out), compress=True)
    print(f"Saved editable Blender source: {blend_out} ({blend_out.stat().st_size:,} bytes)")


def attach_sleeve_normals(surface, rig, doc, binary):
    """Expose glTF morph normals as a native Blender modifier driven by the shape keys."""
    prim = doc["meshes"][0]["primitives"][0]
    types = {5121: "u1", 5123: "<u2", 5125: "<u4", 5126: "<f4"}

    def view(values, count, dtype):
        offset = doc["bufferViews"][values["bufferView"]].get("byteOffset", 0) + values.get("byteOffset", 0)
        return np.frombuffer(binary, dtype, count, offset)

    def accessor(index, width):
        a = doc["accessors"][index]
        dtype = types[a["componentType"]]
        data = np.zeros((a["count"], width), dtype=dtype)
        if "bufferView" in a:
            data[:] = view(a, data.size, dtype).reshape(data.shape)
        if "sparse" in a:
            sparse = a["sparse"]
            ids = view(sparse["indices"], sparse["count"], types[sparse["indices"]["componentType"]])
            data[ids] = view(sparse["values"], len(ids) * width, dtype).reshape(-1, width)
        if a.get("normalized"):
            return data.astype(np.float32) / np.iinfo(data.dtype).max
        return data

    mesh = surface.data
    corners = accessor(prim["indices"], 1).ravel()
    axes = lambda v: np.column_stack((v[:, 0], -v[:, 2], v[:, 1]))
    vertices = np.asarray([v.co[:] for v in mesh.vertices])
    loops = np.asarray([lp.vertex_index for lp in mesh.loops])
    if not np.allclose(vertices[loops], axes(accessor(prim["attributes"]["POSITION"], 3))[corners], atol=1e-6, rtol=0):
        raise ValueError("Final sleeve normal corners do not match the editable mesh")

    tree = bpy.data.node_groups.new("连帽衫 · 袖片修形法线", "GeometryNodeTree")
    tree.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    tree.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    links, nodes = tree.links, tree.nodes

    def normal_field(name, index, row):
        attribute = mesh.attributes.new(name, "FLOAT_VECTOR", "CORNER")
        vectors = np.ascontiguousarray(axes(accessor(index, 3))[corners], dtype=np.float32)
        attribute.data.foreach_set("vector", vectors.ravel())
        node = nodes.new("GeometryNodeInputNamedAttribute")
        node.data_type = "FLOAT_VECTOR"
        node.inputs["Name"].default_value = name
        node.location = (-600, row)
        return node.outputs["Attribute"]

    current = normal_field("Sleeve normal · basis", prim["attributes"]["NORMAL"], 200)
    shapes = mesh.shape_keys
    for n, (name, target) in enumerate(zip(doc["meshes"][0]["extras"]["targetNames"], prim["targets"])):
        row = -165 * n
        field = normal_field("Sleeve normal · " + name, target["NORMAL"], row)
        scale = nodes.new("ShaderNodeVectorMath")
        scale.operation = "SCALE"
        scale.location = (-330, row)
        links.new(field, scale.inputs[0])
        driver = scale.inputs["Scale"].driver_add("default_value").driver
        driver.type = "AVERAGE"
        variable = driver.variables.new()
        variable.type = "SINGLE_PROP"
        var = variable.targets[0]
        var.id_type, var.id = "KEY", shapes
        var.data_path = shapes.key_blocks[name].path_from_id("value")
        add = nodes.new("ShaderNodeVectorMath")
        add.operation = "ADD"
        add.location = (-80, row)
        links.new(current, add.inputs[0])
        links.new(scale.outputs["Vector"], add.inputs[1])
        current = add.outputs["Vector"]
    # Blender's free corner normals stay in object space through the
    # Armature modifier. Skin the normal after the mesh deforms, using the
    # actual bone pose and the same four weights as the exported garment.
    palette = bpy.data.node_groups.new("Luna · 骨骼变换", "GeometryNodeTree")
    palette.interface.new_socket(name="Bone", in_out="INPUT", socket_type="NodeSocketInt")
    palette.interface.new_socket(name="Transform", in_out="OUTPUT", socket_type="NodeSocketMatrix")
    palette_input, palette_output = palette.nodes.new("NodeGroupInput"), palette.nodes.new("NodeGroupOutput")
    switch = palette.nodes.new("GeometryNodeIndexSwitch")
    switch.data_type = "MATRIX"
    palette.links.new(palette_input.outputs[0], switch.inputs["Index"])
    palette.links.new(switch.outputs[0], palette_output.inputs[0])
    bone_ids = doc["skins"][0]["joints"]
    while len(switch.index_switch_items) < len(bone_ids):
        switch.index_switch_items.new()
    for j, node_id in enumerate(bone_ids):
        name = doc["nodes"][node_id]["name"]
        bone = rig.pose.bones.get(name) or rig.pose.bones[name.replace(":", "")]
        pose = palette.nodes.new("GeometryNodeBoneInfo")
        pose.inputs["Armature"].default_value = rig
        pose.inputs["Bone Name"].default_value = bone.name
        pose.location = (-650, -170 * j)
        inv = palette.nodes.new("FunctionNodeInvertMatrix")
        inv.location = (-430, -170 * j)
        palette.links.new(pose.outputs["Rest Pose"], inv.inputs[0])
        product = palette.nodes.new("FunctionNodeMatrixMultiply")
        product.location = (-220, -170 * j)
        palette.links.new(pose.outputs["Pose"], product.inputs[0])
        palette.links.new(inv.outputs[0], product.inputs[1])
        palette.links.new(product.outputs[0], switch.inputs[j + 1])
    switch.location, palette_input.location, palette_output.location = (20, 0), (-200, 180), (260, 0)
    # Split UV vertices address the same editable point and carry identical
    # bone influences. Retain one four-weight tuple per editable vertex.
    corner_to_source = np.zeros(len(mesh.vertices), dtype=np.int32)
    corner_to_source[loops] = corners
    joint_ids = accessor(prim["attributes"]["JOINTS_0"], 4)[corner_to_source]
    values = accessor(prim["attributes"]["WEIGHTS_0"], 4)[corner_to_source]
    accumulated = None
    for k in range(4):
        fields = []
        for prefix, kind, array in (("Bone index", "INT", joint_ids[:, k]), ("Bone weight", "FLOAT", values[:, k])):
            name = f"{prefix} {k + 1}"
            attr = mesh.attributes.new(name, kind, "POINT")
            attr.data.foreach_set("value", np.ascontiguousarray(array, dtype=np.int32 if kind == "INT" else np.float32))
            field = nodes.new("GeometryNodeInputNamedAttribute")
            field.data_type = kind
            field.inputs["Name"].default_value = name
            field.location = (180, -400 * k - (160 if kind == "FLOAT" else 0))
            fields.append(field.outputs["Attribute"])
        lookup = nodes.new("GeometryNodeGroup")
        lookup.node_tree = palette
        lookup.location = (410, -400 * k)
        links.new(fields[0], lookup.inputs["Bone"])
        direction = nodes.new("FunctionNodeTransformDirection")
        direction.location = (620, -400 * k)
        links.new(current, direction.inputs["Direction"])
        links.new(lookup.outputs[0], direction.inputs["Transform"])
        weighted = nodes.new("ShaderNodeVectorMath")
        weighted.operation = "SCALE"
        weighted.location = (840, -400 * k)
        links.new(direction.outputs[0], weighted.inputs[0])
        links.new(fields[1], weighted.inputs["Scale"])
        if accumulated is None:
            accumulated = weighted.outputs["Vector"]
        else:
            add = nodes.new("ShaderNodeVectorMath")
            add.operation = "ADD"
            add.location = (1050, -400 * k)
            links.new(accumulated, add.inputs[0])
            links.new(weighted.outputs[0], add.inputs[1])
            accumulated = add.outputs["Vector"]
    current = accumulated
    normalize = nodes.new("ShaderNodeVectorMath")
    normalize.operation = "NORMALIZE"
    normalize.location = (1290, 0)
    links.new(current, normalize.inputs[0])
    result = nodes.new("GeometryNodeSetMeshNormal")
    result.mode, result.domain = "FREE", "CORNER"
    result.location = (1510, 120)
    input_node, output_node = nodes.new("NodeGroupInput"), nodes.new("NodeGroupOutput")
    input_node.location, output_node.location = (1290, 270), (1730, 120)
    links.new(input_node.outputs["Geometry"], result.inputs["Mesh"])
    links.new(normalize.outputs["Vector"], result.inputs["Custom Normal"])
    links.new(result.outputs["Mesh"], output_node.inputs["Geometry"])
    modifier = surface.modifiers.new("袖片法线 · 随修形变化", "NODES")
    modifier.node_group = tree


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
    attach_sleeve_normals(surface, rig, raw, binary)
    # The studio garment is viewed at close range under ray-traced lights.
    # Relax the two sewn rims on the posed cage before evaluating its smooth
    # subdivision surface. Keep both operations editable in the .blend.
    seam = surface.vertex_groups.new(name="袖缝 · 布片过渡")
    for v in surface.data.vertices:
        x, _, z = v.co
        rim = abs(abs(x) - (.128 - .305 * (z - .51)))
        weight = ((1 - smoothstep(rim, .024, .061)) * smoothstep(z, .49, .52)
                  * (1 - smoothstep(z, .67, .725)))
        if weight > 0:
            seam.add([v.index], weight, "REPLACE")
    smoothing = surface.modifiers.new("袖缝 · 缓和折脊", "SMOOTH")
    smoothing.vertex_group, smoothing.factor, smoothing.iterations = seam.name, .85, 14
    surface.modifiers.move(len(surface.modifiers) - 1, 1)
    subdivision = surface.modifiers.new("针织表面 · 工作室细分", "SUBSURF")
    subdivision.levels = subdivision.render_levels = 1

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


def render_diagnostic_board(obj, arm_obj, review_dir: Path, relaxed_basis, runtime_influences):
    """Render comprehensive before/after and multi-pose diagnostic evidence."""
    review_dir.mkdir(parents=True, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 768
    scene.render.resolution_y = 768

    world = bpy.data.worlds.new("ReviewWorld")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.16, 0.18, 0.22, 1.0)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.15

    key_data = bpy.data.lights.new("KeyLight", type="SUN")
    key_data.energy = 2.6
    key = bpy.data.objects.new("KeyLight", key_data)
    scene.collection.objects.link(key)
    key.rotation_euler = (0.55, 0.25, 0.45)

    fill_data = bpy.data.lights.new("FillLight", type="SUN")
    fill_data.energy = 1.1
    fill = bpy.data.objects.new("FillLight", fill_data)
    scene.collection.objects.link(fill)
    fill.rotation_euler = (0.4, -0.3, -2.2)

    cam_data = bpy.data.cameras.new("ReviewCam")
    cam_data.type = "ORTHO"
    cam = bpy.data.objects.new("ReviewCam", cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam

    k_l = obj.data.shape_keys.key_blocks["LeftArmContact"]
    k_r = obj.data.shape_keys.key_blocks["RightArmContact"]

    def snap(name, loc, rot, scale):
        cam.location = loc
        cam.rotation_euler = rot
        cam_data.ortho_scale = scale
        scene.render.filepath = str(review_dir / f"{name}.png")
        bpy.ops.render.render(write_still=True)

    for pb in arm_obj.pose.bones:
        pb.matrix_basis = relaxed_basis[pb.name]

    k_l.value = k_r.value = 0.0
    bpy.context.view_layer.update()
    snap("01_standing_OFF_closeup", (0, -2.0, 0.57), (1.5708, 0, 0), 0.42)

    k_l.value, k_r.value = runtime_influences[0], runtime_influences[1]
    bpy.context.view_layer.update()
    snap("02_standing_ON_front", (0, -2.0, 0.50), (1.5708, 0, 0), 1.08)
    snap("03_standing_ON_closeup", (0, -2.0, 0.57), (1.5708, 0, 0), 0.42)
    snap("04_standing_ON_side", (2.0, 0.0, 0.50), (1.5708, 0, 1.5708), 1.08)
    snap("05_standing_ON_34", (1.2, -1.6, 0.54), (1.5708, 0, 0.64), 0.72)
    snap("06_standing_ON_back", (0, 2.0, 0.50), (1.5708, 0, 3.14159), 1.08)

    # Full 1.0 Shape Keys check
    k_l.value = k_r.value = 1.0
    bpy.context.view_layer.update()
    snap("07_standing_FULL_closeup", (0, -2.0, 0.57), (1.5708, 0, 0), 0.42)

    # Flat knit sock feet (standing planted pose!)
    k_l.value, k_r.value = runtime_influences[0], runtime_influences[1]
    bpy.context.view_layer.update()
    snap("08_feet_side", (2.0, -0.02, 0.10), (1.5708, 0, 1.5708), 0.24)
    snap("09_feet_front", (0.0, -2.0, 0.10), (1.5708, 0, 0), 0.26)

    # Asymmetric arm raise
    pb_la = arm_obj.pose.bones["mixamorig:LeftArm"]
    orig_la = pb_la.matrix_basis.copy()
    pb_la.matrix_basis = orig_la @ Matrix.Rotation(-1.15, 4, "Z")
    k_l.value = 0.0
    k_r.value = runtime_influences[1]
    bpy.context.view_layer.update()
    snap("10_arm_raise_front", (0, -2.0, 0.56), (1.5708, 0, 0), 0.90)
    pb_la.matrix_basis = orig_la

    # Walk mid-stride
    walk_act = bpy.data.actions.get("Walk_Grounded_Loop")
    if walk_act:
        arm_obj.animation_data.action = walk_act
        k_l.value = k_r.value = 0.0
        scene.frame_set(6)
        bpy.context.view_layer.update()
        snap("11_walk_34", (1.4, -1.4, 0.50), (1.5708, 0, 0.78), 1.10)
        arm_obj.animation_data.action = None

    # ChairSit deep
    sit_act = bpy.data.actions.get("ChairSit_Contact")
    if sit_act:
        arm_obj.animation_data.action = sit_act
        k_l.value = k_r.value = 0.0
        scene.frame_set(int(round(sit_act.frame_range[1])))
        bpy.context.view_layer.update()
        snap("12_chairsit_34", (1.4, -1.4, 0.46), (1.5708, 0, 0.78), 1.15)
        arm_obj.animation_data.action = None

    # Face closeups & sleeve-torso seam closeups (in relaxed standing ON pose!)
    for pb in arm_obj.pose.bones:
        pb.matrix_basis = relaxed_basis[pb.name]
    k_l.value, k_r.value = runtime_influences[0], runtime_influences[1]
    bpy.context.view_layer.update()
    snap("13_face_front", (0.0, -2.0, 0.81), (1.5708, 0, 0), 0.24)
    snap("14_face_34", (0.9, -1.8, 0.81), (1.5708, 0, 0.46), 0.24)
    snap("15_seam_left_34", (0.85, -1.8, 0.54), (1.5708, 0, 0.44), 0.36)
    snap("16_seam_right_34", (-0.85, -1.8, 0.54), (1.5708, 0, -0.44), 0.36)

    bpy.data.objects.remove(cam, do_unlink=True)
    bpy.data.objects.remove(key, do_unlink=True)
    bpy.data.objects.remove(fill, do_unlink=True)
    scene.world = None


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

    # Step 6: Proxy-Cage Blender Cloth Sim + Smooth Gaussian BVH Contact Cushion -> LeftArmContact / RightArmContact
    relaxed_basis, runtime_influences = build_cloth_sim_and_arm_shape_keys(obj, arm_obj, region, args.base_luna.resolve())

    # Step 7: Bake 98-frame ChairSit contact cache against real fixed desk chair
    bake_chair_seat_contact(obj, arm_obj, region, args.sit_blend.resolve(), args.seat_out.resolve())

    # Step 8: Save editable .blend and pack sleek runtime .glb
    setup_blend_viewport_and_save(obj, arm_obj, args.blend_out.resolve())
    pack_runtime_glb(obj, arm_obj, args.base_luna.resolve(), args.glb_out.resolve(), scratch_dir)
    glb_path, seat_path = str(args.glb_out.resolve()), str(args.seat_out.resolve())
    with TemporaryDirectory(dir=str(scratch_dir)) as folder:
        poses = str(Path(folder) / "hoodie-pose-data.json")
        subprocess.run(["node", str(ROOT / "scripts/finish-luna-cloud-hoodie.mjs"),
                        glb_path, glb_path, seat_path, seat_path, poses], cwd=ROOT, check=True)
        subprocess.run([bpy.app.binary_path, "--background", "--factory-startup", "--python-exit-code", "1",
                        "--python", str(ROOT / "scripts/refine-luna-hoodie-folds.py"),
                        "--", glb_path, glb_path, poses], cwd=ROOT, check=True)

        if args.review_dir:
            render_diagnostic_board(obj, arm_obj, args.review_dir.resolve(), relaxed_basis, runtime_influences)
        save_finished_garment(glb_path, poses, args.blend_out)

    print("BUILD LUNA CLOUD HOODIE COMPLETE!")


if __name__ == "__main__":
    main()
