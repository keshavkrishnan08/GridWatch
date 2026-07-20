#!/usr/bin/env python3
"""
Build the ZIP -> location lookup that powers "check my area".

    python3 -m pipeline.fetch_zips
    python3 -m pipeline.fetch_zips --prefixes 39 --state "Mississippi"

Source: US Census ZCTA Gazetteer (public domain, no key). We keep only the
centroid, and only for ZCTAs whose centroid falls inside the region boundary —
so a fork gets its own ZIPs by changing the prefixes, and border ZIPs that
belong to a neighboring state don't sneak in.

Outside the US this file simply won't exist, and the app falls back to picking
a subdivision from a list. Nothing breaks.
"""

from __future__ import annotations

import argparse
import io
import json
import os
import sys
import zipfile

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
GAZ = "https://www2.census.gov/geo/docs/maps-data/data/gazetteer/{year}_Gazetteer/{year}_Gaz_zcta_national.zip"
UA = {"User-Agent": "GridWatch/1.0 (open-source civic grid atlas)"}


def point_in_ring(pt, ring) -> bool:
    x, y = pt
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def in_region(pt, features) -> bool:
    for f in features:
        g = f.get("geometry") or {}
        c = g.get("coordinates") or []
        if g.get("type") == "Polygon":
            if c and point_in_ring(pt, c[0]):
                return True
        elif g.get("type") == "MultiPolygon":
            for poly in c:
                if poly and point_in_ring(pt, poly[0]):
                    return True
    return False


def main() -> int:
    ap = argparse.ArgumentParser(description="Build a ZIP centroid lookup for the active region.")
    ap.add_argument("--prefixes", nargs="+", default=["46", "47"],
                    help="ZIP prefixes to keep (Indiana = 46 47)")
    ap.add_argument("--boundary", default=None,
                    help="boundary geojson (default: whatever region.json points at)")
    ap.add_argument("--year", default="2024")
    ap.add_argument("--out", default=os.path.join(DATA, "zip_centroids.json"))
    args = ap.parse_args()

    # resolve the region boundary so we can clip to it
    boundary_path = args.boundary
    if not boundary_path:
        try:
            with open(os.path.join(DATA, "region.json")) as fh:
                boundary_path = os.path.join(DATA, json.load(fh)["boundary_file"])
        except Exception:
            boundary_path = os.path.join(DATA, "indiana.geojson")
    try:
        with open(boundary_path) as fh:
            feats = json.load(fh).get("features", [])
    except Exception as e:
        print(f"  ERROR  could not read boundary {boundary_path}: {e}")
        return 2

    url = GAZ.format(year=args.year)
    print(f"\n  Fetching Census ZCTA gazetteer ({args.year})…")
    try:
        r = requests.get(url, headers=UA, timeout=180)
        r.raise_for_status()
    except Exception as e:
        print(f"  ERROR  fetch failed: {e}\n  Nothing written — re-run to retry.")
        return 2

    z = zipfile.ZipFile(io.BytesIO(r.content))
    raw = z.read(z.namelist()[0]).decode("utf-8", "replace")

    zips: dict[str, list[float]] = {}
    skipped_outside = 0
    for line in raw.splitlines()[1:]:
        parts = line.split("\t")
        if len(parts) < 7:
            continue
        zc = parts[0].strip()
        if not any(zc.startswith(p) for p in args.prefixes):
            continue
        try:
            lat = float(parts[5].strip())
            lng = float(parts[6].strip())
        except ValueError:
            continue
        if not in_region((lng, lat), feats):
            skipped_outside += 1
            continue
        zips[zc] = [round(lng, 4), round(lat, 4)]

    if not zips:
        print("  ERROR  no ZIPs matched — check --prefixes and the boundary file.")
        return 2

    with open(args.out, "w") as fh:
        json.dump({
            "_source": f"US Census {args.year} ZCTA Gazetteer (public domain)",
            "_note": "Centroid of each ZCTA, clipped to the region boundary. "
                     "Used to look up a visitor's utility and subdivision.",
            "zips": dict(sorted(zips.items())),
        }, fh, separators=(",", ":"))

    kb = os.path.getsize(args.out) / 1024
    print(f"  [ok ] {len(zips)} ZIPs written ({kb:.0f} KB) -> {os.path.relpath(args.out, ROOT)}")
    print(f"         {skipped_outside} skipped as outside the region boundary\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
