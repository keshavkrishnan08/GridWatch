"""
Grid infrastructure: generation, transmission, substations — anywhere.

OSM's `power=*` schema is global and well maintained, which is what lets the
atlas draw a real grid for a region nobody has hand-curated.
"""

from __future__ import annotations

import json
import os

from ..core.geo import fc, simplify_geometry
from .base import RegionContext
from . import overpass as ov

# OSM plant:source -> the fuel keys the app's palette understands
FUEL_MAP = {
    "coal": "coal", "gas": "gas", "oil": "oil", "diesel": "oil",
    "nuclear": "nuclear", "hydro": "hydro", "wind": "wind", "solar": "solar",
    "biomass": "biomass", "biogas": "biomass", "waste": "biomass",
    "battery": "battery", "geothermal": "other",
}


def _fuel(tags: dict) -> str:
    raw = (tags.get("plant:source") or tags.get("generator:source") or "").split(";")[0].strip().lower()
    return FUEL_MAP.get(raw, "other")


def _mw(tags: dict) -> float | None:
    """Parse OSM power output like '1200 MW' / '850000000' (watts)."""
    raw = tags.get("plant:output:electricity") or tags.get("generator:output:electricity")
    if not raw:
        return None
    s = str(raw).strip().lower().replace(",", "")
    try:
        if s.endswith("mw"):
            return round(float(s[:-2].strip()), 1)
        if s.endswith("kw"):
            return round(float(s[:-2].strip()) / 1000, 1)
        if s.endswith("gw"):
            return round(float(s[:-2].strip()) * 1000, 1)
        return round(float(s) / 1e6, 1)   # bare number = watts
    except ValueError:
        return None


class PowerPlantProvider:
    key = "osm_power_plants"
    outputs = ["power_plants.geojson"]

    def run(self, ctx: RegionContext) -> dict:
        if not ctx.osm_area:
            return {"ok": False, "error": "boundary must resolve first"}
        q = (f'[out:json][timeout:180];area({ctx.osm_area})->.a;'
             f'(nwr["power"="plant"](area.a););out center tags;')
        res = ov.query(q, cache_key=f"plants:{ctx.osm_area}")
        if res is None:
            return {"ok": False, "error": "Overpass unavailable; nothing written — re-run to retry"}
        els = ov.elements(res)
        feats = []
        for el in els:
            pt = ov.center_of(el)
            if not pt:
                continue
            t = el.get("tags") or {}
            feats.append({
                "type": "Feature",
                "properties": {
                    "name": t.get("name") or "Unnamed plant",
                    "fuel": _fuel(t),
                    "mw": _mw(t),
                    "operator": t.get("operator"),
                    "source": f'osm:{el.get("type")}/{el.get("id")}',
                },
                "geometry": {"type": "Point", "coordinates": [round(pt[0], 5), round(pt[1], 5)]},
            })
        path = os.path.join(ctx.out_dir, "power_plants.geojson")
        with open(path, "w") as fh:
            json.dump(fc(feats), fh)
        return {"ok": True, "count": len(feats), "file": "power_plants.geojson"}


class TransmissionProvider:
    key = "osm_transmission"
    outputs = ["transmission.geojson"]

    def run(self, ctx: RegionContext) -> dict:
        if not ctx.osm_area:
            return {"ok": False, "error": "boundary must resolve first"}
        # transmission-class lines only; minor distribution would swamp the map
        q = (f'[out:json][timeout:240];area({ctx.osm_area})->.a;'
             f'(way["power"="line"](area.a););out geom tags;')
        res = ov.query(q, cache_key=f"trans:{ctx.osm_area}")
        if res is None:
            return {"ok": False, "error": "Overpass unavailable; nothing written — re-run to retry"}
        els = ov.elements(res)
        feats = []
        for el in els:
            pts = [[round(float(p["lon"]), 5), round(float(p["lat"]), 5)]
                   for p in el.get("geometry") or []]
            if len(pts) < 2:
                continue
            t = el.get("tags") or {}
            kv = t.get("voltage", "").split(";")[0]
            try:
                kv_num = int(float(kv)) // 1000 if kv else None
            except ValueError:
                kv_num = None
            geom = simplify_geometry({"type": "LineString", "coordinates": pts}, eps=0.002)
            feats.append({
                "type": "Feature",
                "properties": {"voltage_kv": kv_num, "operator": t.get("operator")},
                "geometry": geom,
            })
        path = os.path.join(ctx.out_dir, "transmission.geojson")
        with open(path, "w") as fh:
            json.dump(fc(feats), fh)
        return {"ok": True, "count": len(feats), "file": "transmission.geojson"}


class SubstationProvider:
    key = "osm_substations"
    outputs = ["substations.geojson"]

    def run(self, ctx: RegionContext) -> dict:
        if not ctx.osm_area:
            return {"ok": False, "error": "boundary must resolve first"}
        q = (f'[out:json][timeout:180];area({ctx.osm_area})->.a;'
             f'(nwr["power"="substation"](area.a););out center tags;')
        res = ov.query(q, cache_key=f"subs:{ctx.osm_area}")
        if res is None:
            return {"ok": False, "error": "Overpass unavailable; nothing written — re-run to retry"}
        els = ov.elements(res)
        feats = []
        for el in els:
            pt = ov.center_of(el)
            if not pt:
                continue
            t = el.get("tags") or {}
            feats.append({
                "type": "Feature",
                "properties": {"name": t.get("name"), "operator": t.get("operator")},
                "geometry": {"type": "Point", "coordinates": [round(pt[0], 5), round(pt[1], 5)]},
            })
        path = os.path.join(ctx.out_dir, "substations.geojson")
        with open(path, "w") as fh:
            json.dump(fc(feats), fh)
        return {"ok": True, "count": len(feats), "file": "substations.geojson"}
