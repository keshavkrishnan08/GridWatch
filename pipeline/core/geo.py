"""
Geometry helpers shared by every provider.

Keeps the output files small (simplification + coordinate rounding) and, most
importantly, guarantees the atlas never renders the same real-world site twice:
`dedupe_sites` merges records that describe one place even when they arrive
from different sources with different names.
"""

from __future__ import annotations

import math
import re
from typing import Any, Iterable

EARTH_MI = 3958.8


# ---------------------------------------------------------------- distance
def haversine_mi(a: tuple[float, float], b: tuple[float, float]) -> float:
    """Great-circle distance in miles between two (lng, lat) points."""
    lng1, lat1 = a
    lng2, lat2 = b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return EARTH_MI * 2 * math.asin(min(1.0, math.sqrt(h)))


# ---------------------------------------------------------------- bbox
def bbox_of(geom: Any) -> tuple[float, float, float, float] | None:
    """[min_lng, min_lat, max_lng, max_lat] for any GeoJSON geometry."""
    xs: list[float] = []
    ys: list[float] = []

    def scan(c: Any) -> None:
        if isinstance(c, (list, tuple)) and c and isinstance(c[0], (int, float)):
            xs.append(float(c[0]))
            ys.append(float(c[1]))
        elif isinstance(c, (list, tuple)):
            for x in c:
                scan(x)

    scan(geom.get("coordinates") if isinstance(geom, dict) else geom)
    if not xs:
        return None
    return (min(xs), min(ys), max(xs), max(ys))


# ---------------------------------------------------------------- simplify
def _rdp(points: list[list[float]], eps: float) -> list[list[float]]:
    """Ramer-Douglas-Peucker. Pure Python so the pipeline has no hard GEOS dep."""
    if len(points) < 3:
        return points
    start, end = points[0], points[-1]
    dx, dy = end[0] - start[0], end[1] - start[1]
    denom = math.hypot(dx, dy)
    idx, far = 0, -1.0
    for i in range(1, len(points) - 1):
        px, py = points[i][0] - start[0], points[i][1] - start[1]
        d = abs(px * dy - py * dx) / denom if denom else math.hypot(px, py)
        if d > far:
            idx, far = i, d
    if far <= eps:
        return [start, end]
    return _rdp(points[: idx + 1], eps)[:-1] + _rdp(points[idx:], eps)


def simplify_geometry(geom: dict, eps: float = 0.004, digits: int = 5) -> dict:
    """Simplify + round a GeoJSON geometry in place-safe fashion."""
    def ring(r: list) -> list:
        out = _rdp([[float(p[0]), float(p[1])] for p in r], eps)
        if len(out) < 4 and len(r) >= 4:      # keep polygons closable
            out = [[float(p[0]), float(p[1])] for p in r]
        return [[round(p[0], digits), round(p[1], digits)] for p in out]

    t = geom.get("type")
    c = geom.get("coordinates")
    if t == "Polygon":
        return {"type": t, "coordinates": [ring(r) for r in c]}
    if t == "MultiPolygon":
        return {"type": t, "coordinates": [[ring(r) for r in poly] for poly in c]}
    if t == "LineString":
        return {"type": t, "coordinates": ring(c)}
    if t == "MultiLineString":
        return {"type": t, "coordinates": [ring(r) for r in c]}
    return geom


# ---------------------------------------------------------------- dedupe
_STOP = re.compile(
    r"\b(data ?cent(er|re)|campus|facility|project|llc|inc|corp|company|the|site|phase\s*\w+)\b",
    re.I,
)


def norm_name(name: str | None) -> str:
    """Normalize a site name for comparison: lowercase, drop filler + punctuation."""
    if not name:
        return ""
    s = _STOP.sub(" ", name.lower())
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _name_match(a: str, b: str) -> bool:
    if not a or not b:
        return False
    if a == b:
        return True
    ta, tb = set(a.split()), set(b.split())
    if not ta or not tb:
        return False
    overlap = len(ta & tb) / min(len(ta), len(tb))
    return overlap >= 0.6


def dedupe_sites(
    sites: Iterable[dict],
    *,
    radius_mi: float = 1.2,
    lng_key: str = "lng",
    lat_key: str = "lat",
) -> list[dict]:
    """
    Collapse records describing the same physical site.

    Two records merge when they're within `radius_mi` AND their names match, or
    when they're essentially co-located (< 1/6 radius) regardless of name --
    which catches the same campus mapped under different operators. Curated
    records always win over auto-pulled ones, and every merge records what it
    absorbed in `_merged_from` so the provenance stays auditable.
    """
    out: list[dict] = []
    for s in sites:
        try:
            pt = (float(s[lng_key]), float(s[lat_key]))
        except (KeyError, TypeError, ValueError):
            out.append(s)
            continue
        n = norm_name(s.get("name"))
        hit = None
        for kept in out:
            try:
                kpt = (float(kept[lng_key]), float(kept[lat_key]))
            except (KeyError, TypeError, ValueError):
                continue
            d = haversine_mi(pt, kpt)
            if d <= radius_mi and (_name_match(n, norm_name(kept.get("name"))) or d <= radius_mi / 6):
                hit = kept
                break
        if hit is None:
            out.append(s)
            continue
        # merge: prefer curated, then the record with more filled fields
        cur_a, cur_b = hit.get("_curated", False), s.get("_curated", False)
        richer = s if (cur_b and not cur_a) else hit
        poorer = hit if richer is s else s
        if richer is s:
            out[out.index(hit)] = s
        for k, v in poorer.items():
            if k.startswith("_"):
                continue
            if richer.get(k) in (None, "", []) and v not in (None, "", []):
                richer[k] = v
        merged = richer.setdefault("_merged_from", [])
        src = poorer.get("_source") or poorer.get("id")
        if src and src not in merged:
            merged.append(src)
    return out


def fc(features: list[dict]) -> dict:
    return {"type": "FeatureCollection", "features": features}
