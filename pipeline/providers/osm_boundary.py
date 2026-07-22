"""
Region outline + subdivisions, for anywhere on Earth.

The outline drives the spotlight mask and the camera framing; the subdivisions
are the clickable pieces (counties, départements, municípios...). Both come
from OSM administrative relations, so a fork only has to name its region.
"""

from __future__ import annotations

import json
import os

from ..core.geo import bbox_of, fc, simplify_geometry
from .base import RegionContext
from . import overpass as ov


class BoundaryProvider:
    key = "osm_boundary"
    outputs = ["boundary.geojson"]

    def run(self, ctx: RegionContext) -> dict:
        hit = ov.geocode(ctx.query)
        if not hit or not hit.get("geojson"):
            return {"ok": False, "error": f"could not resolve region: {ctx.query!r}"}

        geom = simplify_geometry(hit["geojson"], eps=0.004)
        ctx.osm_id = int(hit["osm_id"])
        ctx.osm_area = ov.area_id(ctx.osm_id)
        ctx.boundary = geom
        bb = bbox_of(geom)
        ctx.bbox = bb
        # ISO2 helps pick the right subdivision level
        cc = (hit.get("address", {}) or {}).get("country_code")
        if cc:
            ctx.country_code = cc.upper()

        path = os.path.join(ctx.out_dir, "boundary.geojson")
        with open(path, "w") as fh:
            json.dump(fc([{ "type": "Feature", "properties": {"name": ctx.label}, "geometry": geom }]), fh)
        return {"ok": True, "osm_id": ctx.osm_id, "bbox": bb, "file": "boundary.geojson"}


class SubdivisionsProvider:
    key = "osm_subdivisions"
    outputs = ["subdivisions.geojson"]

    def run(self, ctx: RegionContext) -> dict:
        if not ctx.osm_area:
            return {"ok": False, "error": "boundary must resolve first"}

        # try the country's conventional level, then fall back until we get a
        # sane count -- a region with 1 or 2000 "subdivisions" is the wrong level
        levels = []
        pref = ctx.subdivision_level or ov.DEFAULT_SUBDIVISION_LEVEL.get(ctx.country_code or "", None)
        if pref:
            levels.append(pref)
        levels += [l for l in ov.FALLBACK_LEVELS if l not in levels]

        chosen, els = None, []
        for lvl in levels:
            # `out geom` (not `out geom tags`) — adding `tags` suppresses the
            # member bodies, leaving only a bbox and no polygon to build.
            q = (
                f'[out:json][timeout:280];area({ctx.osm_area})->.a;'
                f'rel["admin_level"="{lvl}"]["boundary"="administrative"](area.a);'
                f'out geom;'
            )
            res = ov.query(q, cache_key=f"subdiv:{ctx.osm_area}:{lvl}")
            if res is None:
                return {"ok": False, "error": "Overpass unavailable; nothing written — re-run to retry"}
            got = ov.elements(res)
            if 2 <= len(got) <= 1200:
                chosen, els = lvl, got
                break
        if not chosen:
            return {"ok": False, "error": "no usable admin_level found"}

        ctx.subdivision_level = chosen
        feats = []
        for el in els:
            name = (el.get("tags") or {}).get("name")
            geom = _relation_geometry(el)
            if not name or not geom:
                continue
            feats.append({
                "type": "Feature",
                "properties": {ctx.subdivision_key: _strip_suffix(name)},
                "geometry": simplify_geometry(geom, eps=0.005),
            })

        path = os.path.join(ctx.out_dir, "subdivisions.geojson")
        with open(path, "w") as fh:
            json.dump(fc(feats), fh)
        return {"ok": True, "admin_level": chosen, "count": len(feats), "file": "subdivisions.geojson"}


def _strip_suffix(name: str) -> str:
    """'Warren County' -> 'Warren' so labels read cleanly in the UI."""
    for suf in (" County", " Parish", " Borough", " Census Area"):
        if name.endswith(suf):
            return name[: -len(suf)]
    return name


def _relation_geometry(el: dict) -> dict | None:
    """Stitch an Overpass 'out geom' relation into a (Multi)Polygon."""
    rings: list[list[list[float]]] = []
    for m in el.get("members", []):
        if m.get("type") != "way" or m.get("role") not in (None, "", "outer"):
            continue
        pts = [[float(p["lon"]), float(p["lat"])] for p in m.get("geometry") or []]
        if len(pts) >= 2:
            rings.append(pts)
    if not rings:
        return None
    closed = _stitch(rings)
    if not closed:
        return None
    if len(closed) == 1:
        return {"type": "Polygon", "coordinates": [closed[0]]}
    return {"type": "MultiPolygon", "coordinates": [[r] for r in closed]}


def _stitch(segments: list[list[list[float]]], tol: float = 1e-6) -> list[list[list[float]]]:
    """Join way segments end-to-end into closed rings."""
    segs = [list(s) for s in segments]
    rings: list[list[list[float]]] = []
    while segs:
        ring = segs.pop(0)
        changed = True
        while changed and ring[0] != ring[-1]:
            changed = False
            for i, s in enumerate(segs):
                if _near(ring[-1], s[0], tol):
                    ring += s[1:]; segs.pop(i); changed = True; break
                if _near(ring[-1], s[-1], tol):
                    ring += list(reversed(s))[1:]; segs.pop(i); changed = True; break
                if _near(ring[0], s[-1], tol):
                    ring = s[:-1] + ring; segs.pop(i); changed = True; break
                if _near(ring[0], s[0], tol):
                    ring = list(reversed(s))[:-1] + ring; segs.pop(i); changed = True; break
        if len(ring) >= 4:
            if ring[0] != ring[-1]:
                ring.append(ring[0])
            rings.append(ring)
    return rings


def _near(a: list[float], b: list[float], tol: float) -> bool:
    return abs(a[0] - b[0]) < tol and abs(a[1] - b[1]) < tol
