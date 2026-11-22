"""Local fleece shapes on the welded Blender pattern, before UV splits and export."""
import math
from heapq import heapify, heappop, heappush


def ease(value, lo, hi):
    t = max(0., min(1., (value - lo) / (hi - lo)))
    return t * t * (3 - 2 * t)


def add_fleece_keys(obj, regions):
    basis = obj.shape_key_add(name="Basis", from_mix=False)
    # Taper to zero at the wrist opening and hem stitching, including the
    # first cloth ring. This keeps normals on adjoining skin independent.
    cloth = {"TORSO", "SLEEVE_L", "SLEEVE_R"}
    graph = [[] for _ in regions]
    rim = set()
    for edge in obj.data.edges:
        a,b = edge.vertices
        distance = (basis.data[a].co - basis.data[b].co).length
        graph[a].append((b, distance))
        graph[b].append((a, distance))
        if (regions[a] in cloth) != (regions[b] in cloth):
            rim.update((a,b))
    distance = [math.inf] * len(regions)
    queue = [(0., i) for i in rim]
    heapify(queue)
    for i in rim:
        distance[i] = 0.
    while queue:
        d, i = heappop(queue)
        if d > distance[i] or d >= .023:
            continue
        for j, edge in graph[i]:
            if d + edge < distance[j]:
                distance[j] = d + edge
                heappush(queue, (distance[j], j))
    for side, sign, sleeve in (("Left", 1, "SLEEVE_L"), ("Right", -1, "SLEEVE_R")):
        key = obj.shape_key_add(name=side + "ArmContact", from_mix=False)
        for i, reg in enumerate(regions):
            x, y, z = basis.data[i].co
            if sign * x <= 0 or reg not in ("TORSO", sleeve):
                continue
            rail = .128 - .305 * (z - .51)
            lateral = sign * x - rail
            depth = math.exp(-((y + .012) / .069) ** 2)
            # Broad side contact tapers through the full ribbed hem. The cuff
            # and outside of the sleeve stay round as the inner fleece yields.
            if reg == sleeve:
                pressure = .0178 * math.exp(-((z - .566) / .087) ** 2 - (lateral / .043) ** 2)
            else:
                pressure = -.0155 * math.exp(-((z - .555) / .102) ** 2 - (lateral / .048) ** 2)
            shared = 1 - ease(z, .605, .648)
            key.data[i].co.x += sign * pressure * depth * shared * ease(z, .388, .456) * ease(distance[i], .002, .021)
    # A small relief along the elbow fold as the arms reach overhead.
    key = obj.shape_key_add(name="HoodieStretch_520", from_mix=False)
    for i, reg in enumerate(regions):
        if reg not in ("SLEEVE_L", "SLEEVE_R"):
            continue
        x, y, z = basis.data[i].co
        width = math.exp(-((abs(x) - .149) / .032) ** 2 - ((z - .620) / .036) ** 2)
        fade = ease(z, .55, .60) * (1 - ease(z, .649, .686))
        key.data[i].co.y += .005 * width * fade * math.tanh(y / .027)
