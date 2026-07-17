#!/usr/bin/env python3
"""
GridWatch Indiana - geographic data pipeline
=============================================

Fetches the public geospatial base layers the atlas renders on top of and
writes them as compact GeoJSON into ../public/data/. Everything here is
reproducible: run `python3 pipeline/fetch_geo.py` and the layers rebuild from
their public sources. No API keys. If a source is unreachable, the layer is
written as an empty FeatureCollection and the app degrades gracefully rather
than breaking.

Sources
-------
- County boundaries  : plotly public mirror of US Census cartographic counties
- Power plants       : WRI Global Power Plant Database (v1.3.0)
- Utility territories : HIFLD Electric Retail Service Territories (ArcGIS)
- Transmission lines : HIFLD Electric Power Transmission Lines (ArcGIS)
- Substations        : HIFLD Electric Substations (ArcGIS)

Every ArcGIS layer is paged, simplified server-side (maxAllowableOffset) and
rounded client-side to keep the static files small and CDN-friendly.
"""

import csv
import io
import json
import os
import sys
import time
import urllib.parse
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, "..", "public", "data"))
os.makedirs(OUT, exist_ok=True)

# Indiana bounding box (lon/lat). Used to clip national datasets.
IN_BBOX = (-88.10, 37.77, -84.78, 41.76)
UA = {"User-Agent": "GridWatchIndiana/1.0 (civic-tech; +https://github.com/gridwatch)"}


def log(msg):
    print(f"  {msg}", flush=True)


def http_get(url, timeout=60, retries=3):
    last = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001 - pipeline should be forgiving
            last = e
            time.sleep(1.5 * (attempt + 1))
    raise last


def http_json(url, timeout=60, retries=3):
    return json.loads(http_get(url, timeout, retries).decode("utf-8", "replace"))


def write_geojson(name, features, meta=None):
    fc = {"type": "FeatureCollection", "features": features}
    if meta:
        fc["metadata"] = meta
    path = os.path.join(OUT, name)
    with open(path, "w") as f:
        json.dump(fc, f, separators=(",", ":"))
    kb = os.path.getsize(path) / 1024
    log(f"wrote {name}: {len(features)} features, {kb:.0f} KB")


def round_coords(obj, nd):
    """Recursively round coordinate numbers to nd decimals to shrink files."""
    if isinstance(obj, float):
        return round(obj, nd)
    if isinstance(obj, list):
        return [round_coords(x, nd) for x in obj]
    return obj


# --------------------------------------------------------------------------- #
# ArcGIS Feature Service paging helper
# --------------------------------------------------------------------------- #
def arcgis_layer_url(service_url):
    """Accept a FeatureServer or FeatureServer/<id> url; return (base, layer_id).
    Auto-discovers the first layer if only the service root is given."""
    service_url = service_url.rstrip("/")
    parts = service_url.split("/")
    if parts[-1].isdigit():
        return "/".join(parts[:-1]), int(parts[-1])
    # discover layers
    try:
        info = http_json(service_url + "?f=json", timeout=30)
        layers = info.get("layers") or []
        if layers:
            return service_url, int(layers[0]["id"])
    except Exception:
        pass
    return service_url, 0


def arcgis_fetch(service_url, where="1=1", bbox=None, out_fields="*",
                 offset_tol=None, precision=5, page=1000, label=""):
    """Page through an ArcGIS feature layer and return GeoJSON features."""
    base, lid = arcgis_layer_url(service_url)
    layer = f"{base}/{lid}"
    # respect the server's maxRecordCount
    try:
        linfo = http_json(f"{layer}?f=json", timeout=30)
        page = min(page, int(linfo.get("maxRecordCount", page)) or page)
    except Exception:
        pass

    params = {
        "where": where,
        "outFields": out_fields,
        "outSR": "4326",
        "f": "geojson",
        "geometryPrecision": str(precision),
        "resultRecordCount": str(page),
    }
    if offset_tol is not None:
        params["maxAllowableOffset"] = str(offset_tol)
    if bbox:
        params["geometry"] = ",".join(str(v) for v in bbox)
        params["geometryType"] = "esriGeometryEnvelope"
        params["inSR"] = "4326"
        params["spatialRel"] = "esriSpatialRelIntersects"

    features = []
    offset = 0
    while True:
        params["resultOffset"] = str(offset)
        url = layer + "/query?" + urllib.parse.urlencode(params)
        try:
            data = http_json(url, timeout=90)
        except Exception as e:  # noqa: BLE001
            log(f"[{label}] fetch failed at offset {offset}: {e}")
            break
        if isinstance(data, dict) and data.get("error"):
            log(f"[{label}] server error: {data['error'].get('message')} "
                f"({data['error'].get('details')})")
            break
        feats = data.get("features", [])
        if not feats:
            break
        features.extend(feats)
        got = len(feats)
        log(f"[{label}] +{got} (total {len(features)})")
        # geojson responses nest the flag under "properties"
        exceeded = data.get("exceededTransferLimit") or \
            data.get("properties", {}).get("exceededTransferLimit")
        if got < page and not exceeded:
            break
        offset += got
        if offset > 200000:  # hard safety stop
            break
        time.sleep(0.2)
    return features


# --------------------------------------------------------------------------- #
# Layer builders
# --------------------------------------------------------------------------- #
def build_counties():
    log("COUNTIES <- plotly US Census mirror")
    url = "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json"
    try:
        gj = http_json(url, timeout=90)
    except Exception as e:  # noqa: BLE001
        log(f"counties failed: {e}")
        write_geojson("counties.geojson", [])
        return
    feats = []
    for f in gj.get("features", []):
        fips = str(f.get("id", ""))
        if not fips.startswith("18"):  # Indiana state FIPS = 18
            continue
        props = f.get("properties", {})
        f["geometry"] = {
            "type": f["geometry"]["type"],
            "coordinates": round_coords(f["geometry"]["coordinates"], 4),
        }
        f["properties"] = {
            "fips": fips,
            "county": props.get("NAME", ""),
            "lsad": props.get("LSAD", ""),
        }
        feats.append(f)
    write_geojson("counties.geojson", feats,
                  {"source": "US Census cartographic boundaries (plotly mirror)"})


def build_state():
    """Dissolve the county polygons into one accurate Indiana outline.
    Used by the app to mask everything outside the state (spotlight effect)."""
    log("STATE OUTLINE <- dissolve counties (shapely)")
    try:
        from shapely.geometry import shape, mapping
        from shapely.ops import unary_union
    except ImportError:
        log("shapely not available; skipping indiana.geojson")
        return
    try:
        with open(os.path.join(OUT, "counties.geojson")) as f:
            counties = json.load(f)
    except Exception as e:  # noqa: BLE001
        log(f"counties.geojson missing ({e}); run build_counties first")
        return
    geoms = [shape(ft["geometry"]) for ft in counties["features"] if ft.get("geometry")]
    if not geoms:
        log("no county geometries")
        return
    diss = unary_union(geoms).buffer(0).simplify(0.004, preserve_topology=True)
    gj = mapping(diss)

    def rnd(o):
        if isinstance(o, float):
            return round(o, 4)
        if isinstance(o, (list, tuple)):
            return [rnd(x) for x in o]
        return o

    geom = {"type": gj["type"], "coordinates": rnd(gj["coordinates"])}
    fc = {"type": "FeatureCollection",
          "features": [{"type": "Feature", "properties": {"name": "Indiana"}, "geometry": geom}]}
    path = os.path.join(OUT, "indiana.geojson")
    with open(path, "w") as f:
        json.dump(fc, f, separators=(",", ":"))

    def npts(c):
        if c and isinstance(c[0], (int, float)):
            return 1
        return sum(npts(x) for x in c) if isinstance(c, list) else 0
    log(f"wrote indiana.geojson: {geom['type']}, {npts(geom['coordinates'])} pts, "
        f"{os.path.getsize(path)/1024:.0f} KB")


FUEL_MAP = {
    "Coal": "coal", "Gas": "gas", "Oil": "oil", "Petcoke": "oil",
    "Nuclear": "nuclear", "Solar": "solar", "Wind": "wind",
    "Hydro": "hydro", "Biomass": "biomass", "Waste": "biomass",
    "Cogeneration": "gas", "Storage": "battery", "Geothermal": "other",
}


def build_power_plants():
    log("POWER PLANTS <- WRI Global Power Plant Database")
    url = ("https://raw.githubusercontent.com/wri/global-power-plant-database/"
           "master/output_database/global_power_plant_database.csv")
    try:
        raw = http_get(url, timeout=120).decode("utf-8", "replace")
    except Exception as e:  # noqa: BLE001
        log(f"power plants failed: {e}")
        write_geojson("power_plants.geojson", [])
        return
    x0, y0, x1, y1 = IN_BBOX
    feats = []
    reader = csv.DictReader(io.StringIO(raw))
    for row in reader:
        if row.get("country") != "USA":
            continue
        try:
            lat = float(row["latitude"]); lng = float(row["longitude"])
        except (ValueError, KeyError):
            continue
        if not (x0 <= lng <= x1 and y0 <= lat <= y1):
            continue
        try:
            cap = round(float(row.get("capacity_mw") or 0), 1)
        except ValueError:
            cap = 0.0
        fuel = FUEL_MAP.get(row.get("primary_fuel", ""), "other")
        yr = row.get("commissioning_year", "") or ""
        try:
            yr = int(float(yr)) if yr else None
        except ValueError:
            yr = None
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point", "coordinates": [round(lng, 5), round(lat, 5)]},
            "properties": {
                "name": row.get("name", ""),
                "fuel": fuel,
                "capacity_mw": cap,
                "year": yr,
                "owner": (row.get("owner", "") or "")[:80],
            },
        })
    # largest first so small plants draw on top visually
    feats.sort(key=lambda f: f["properties"]["capacity_mw"], reverse=True)
    write_geojson("power_plants.geojson", feats,
                  {"source": "WRI Global Power Plant Database v1.3.0",
                   "note": "Existing generation. Vintage ~2021; used for grid context."})


def build_territories():
    log("UTILITY TERRITORIES <- HIFLD Electric Retail Service Territories")
    svc = ("https://services3.arcgis.com/OYP7N6mAJJCyH6hd/arcgis/rest/services/"
           "Electric_Retail_Service_Territories_HIFLD/FeatureServer/0")
    feats = arcgis_fetch(svc, where="STATE='IN'",
                         out_fields="NAME,STATE,TYPE,CUSTOMERS",
                         offset_tol=0.004, precision=4, label="territories")
    for f in feats:
        p = f.get("properties", {})
        p_clean = {
            "utility": (p.get("NAME") or "").title(),
            "type": (p.get("TYPE") or "").title(),
            "customers": p.get("CUSTOMERS"),
        }
        f["properties"] = p_clean
    write_geojson("utility_territories.geojson", feats,
                  {"source": "HIFLD Electric Retail Service Territories",
                   "note": "Retail service footprints; boundaries generalized."})


def build_transmission():
    log("TRANSMISSION <- HIFLD Electric Power Transmission Lines (>=138 kV)")
    svc = ("https://services2.arcgis.com/LYMgRMwHfrWWEg3s/arcgis/rest/services/"
           "HIFLD_US_Electric_Power_Transmission_Lines/FeatureServer/0")
    feats = arcgis_fetch(svc, where="VOLTAGE>=138", bbox=IN_BBOX,
                         out_fields="VOLTAGE,VOLT_CLASS,OWNER,STATUS",
                         offset_tol=0.003, precision=4, label="transmission")
    for f in feats:
        p = f.get("properties", {})
        v = p.get("VOLTAGE")
        try:
            v = int(round(float(v))) if v not in (None, "", -999999) else None
        except (ValueError, TypeError):
            v = None
        f["properties"] = {"kv": v, "class": p.get("VOLT_CLASS"), "owner": p.get("OWNER")}
    write_geojson("transmission.geojson", feats,
                  {"source": "HIFLD Electric Power Transmission Lines",
                   "note": "Lines >=138 kV intersecting Indiana."})


def build_substations():
    log("SUBSTATIONS <- HIFLD Electric Substations")
    svc = ("https://services1.arcgis.com/BSnEnFfEn54YLVeq/arcgis/rest/services/"
           "HIFLD_Electric_Substations/FeatureServer")
    feats = arcgis_fetch(svc, where="STATE='IN'",
                         out_fields="NAME,STATE,MAX_VOLT,MIN_VOLT,LINES,STATUS",
                         precision=5, label="substations")
    keep = []
    for f in feats:
        p = f.get("properties", {})
        mv = p.get("MAX_VOLT")
        try:
            mv = int(round(float(mv))) if mv not in (None, "", -999999) else None
        except (ValueError, TypeError):
            mv = None
        # keep transmission-class substations (>=100 kV) to reduce clutter
        if mv is not None and mv < 100:
            continue
        f["properties"] = {"name": p.get("NAME"), "max_kv": mv, "lines": p.get("LINES")}
        keep.append(f)
    write_geojson("substations.geojson", keep,
                  {"source": "HIFLD Electric Substations",
                   "note": "Transmission substations (>=100 kV) in Indiana."})


def main():
    print("=" * 60)
    print("GridWatch Indiana - geographic data pipeline")
    print("=" * 60)
    steps = [build_counties, build_state, build_power_plants, build_territories,
             build_transmission, build_substations]
    for fn in steps:
        try:
            fn()
        except Exception as e:  # noqa: BLE001
            log(f"STEP FAILED ({fn.__name__}): {e}")
        print("-" * 60)
    print("geo pipeline complete ->", OUT)


if __name__ == "__main__":
    sys.exit(main())
