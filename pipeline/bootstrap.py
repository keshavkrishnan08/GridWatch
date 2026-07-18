#!/usr/bin/env python3
"""
GridWatch — one-command region bootstrap.

    python3 -m pipeline.bootstrap --region "Ohio, United States"
    python3 -m pipeline.bootstrap --region "Ireland" --label IRELAND
    python3 -m pipeline.bootstrap --region "Bavaria, Germany" --subdivision-level 6

Resolves the region, pulls every layer the atlas needs from public sources,
de-duplicates the sites, and writes a ready-to-serve dataset plus the
region.json the app reads. No API keys. Roads, cities, and water come from the
global basemap at render time, so they work everywhere automatically.

Datasets are written to `regions/<slug>/`, and `--activate` points the running
app at one by copying it into `public/data/`. That keeps every region a
separate, self-contained folder you can commit, share, or hand to someone else.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import sys
import time

from .core.geo import bbox_of, dedupe_sites
from .providers import RegionContext, resolve
from .scaffold import write_civic_stubs, write_meta

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REGIONS_DIR = os.path.join(ROOT, "regions")
PUBLIC_DATA = os.path.join(ROOT, "public", "data")

# files the app expects, and where the bootstrap's output maps onto them
ACTIVATE_FILES = [
    "boundary.geojson", "subdivisions.geojson", "power_plants.geojson",
    "transmission.geojson", "substations.geojson", "utility_territories.geojson",
    "facilities.json", "region.json", "meta.json", "timeline_events.json",
    "bill_impact_models.json", "action_items.json", "dockets.json",
    "county_restrictions.json",
]


def slugify(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60] or "region"


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


def locate(pt, features, key: str) -> str:
    """Which subdivision contains this point?"""
    for f in features:
        g = f.get("geometry") or {}
        coords = g.get("coordinates") or []
        if g.get("type") == "Polygon":
            if coords and point_in_ring(pt, coords[0]):
                return f["properties"].get(key, "")
        elif g.get("type") == "MultiPolygon":
            for poly in coords:
                if poly and point_in_ring(pt, poly[0]):
                    return f["properties"].get(key, "")
    return ""


def main() -> int:
    ap = argparse.ArgumentParser(description="Bootstrap a GridWatch region from public data.")
    ap.add_argument("--region", required=True, help='e.g. "Ohio, United States" or "Ireland"')
    ap.add_argument("--label", help="header label (defaults to the region name, uppercased)")
    ap.add_argument("--name", help='app title, e.g. "GridWatch Ohio"')
    ap.add_argument("--slug", help="folder name under regions/ (defaults to a slug of --region)")
    ap.add_argument("--subdivision-key", default="county",
                    help="property name for subdivisions in the app (default: county)")
    ap.add_argument("--subdivision-level", type=int, help="force an OSM admin_level")
    ap.add_argument("--providers", nargs="*", help="run only these provider keys")
    ap.add_argument("--activate", action="store_true", help="copy the result into public/data/")
    ap.add_argument("--force", action="store_true",
                    help="allow --activate to replace a different region already in public/data/")
    ap.add_argument("--merge-curated", metavar="FILE",
                    help="merge a curated facilities.json over the auto-discovered sites")
    args = ap.parse_args()

    slug = args.slug or slugify(args.region)
    label = (args.label or args.region.split(",")[0]).upper()
    out_dir = os.path.join(REGIONS_DIR, slug)
    os.makedirs(out_dir, exist_ok=True)

    ctx = RegionContext(
        query=args.region, slug=slug, label=label, out_dir=out_dir,
        subdivision_key=args.subdivision_key, subdivision_level=args.subdivision_level,
    )

    print(f"\n  GridWatch bootstrap · {args.region}")
    print(f"  output: regions/{slug}/\n")

    report = {}
    t0 = time.time()
    chain = resolve(args.providers)
    # Every provider queries the region's OSM area, so the boundary has to
    # resolve first even when the user asked for a subset. It's cached, so
    # doing it implicitly costs nothing on a re-run.
    if not any(p.key == "osm_boundary" for p in chain):
        from .providers import REGISTRY
        chain = [REGISTRY["osm_boundary"]] + chain
    for prov in chain:
        t = time.time()
        try:
            res = prov.run(ctx)
        except Exception as e:                      # a dead source must not kill the run
            res = {"ok": False, "error": f"{type(e).__name__}: {e}"}
        report[prov.key] = res
        mark = "ok " if res.get("ok") else "FAIL"
        detail = res.get("error") or f'{res.get("count", "")} {res.get("file", "")}'.strip()
        print(f"  [{mark}] {prov.key:22} {detail}  ({time.time()-t:.1f}s)")
        if prov.key == "osm_boundary" and not res.get("ok"):
            print("\n  Could not resolve that region. Try a fuller name, e.g. "
                  '"Ohio, United States".\n')
            return 1

    # ---- stitch facilities: auto-discovered + optional curated, de-duplicated
    auto_path = os.path.join(out_dir, "facilities.auto.json")
    sites = []
    if os.path.exists(auto_path):
        with open(auto_path) as fh:
            sites = json.load(fh).get("facilities", [])
    curated = []
    if args.merge_curated and os.path.exists(args.merge_curated):
        with open(args.merge_curated) as fh:
            curated = json.load(fh).get("facilities", [])
        for c in curated:
            c["_curated"] = True
    merged = dedupe_sites(curated + sites, radius_mi=1.2)

    # fill in the subdivision each site sits in
    sub_path = os.path.join(out_dir, "subdivisions.geojson")
    if os.path.exists(sub_path):
        with open(sub_path) as fh:
            subs = json.load(fh).get("features", [])
        for s in merged:
            if not s.get("county") and s.get("lng") is not None:
                s["county"] = locate((s["lng"], s["lat"]), subs, ctx.subdivision_key)

    with open(os.path.join(out_dir, "facilities.json"), "w") as fh:
        json.dump({
            "schema_version": "1.0",
            "region": args.region,
            "coverage_note": (
                "Auto-discovered from OpenStreetMap and merged with any curated records. "
                "Auto-discovered sites are marked rumored with no capacity figures — they are "
                "leads to verify against filings, not confirmed projects."),
            "facilities": merged,
        }, fh, indent=1)
    print(f"  [ok ] facilities            {len(merged)} after dedupe "
          f"({len(curated)} curated + {len(sites)} auto)")

    # ---- region.json the app reads
    region_cfg = {
        "name": args.name or f"GridWatch {args.region.split(',')[0].strip()}",
        "region_label": label,
        "tagline": "DATA CENTER ATLAS",
        "boundary_file": "boundary.geojson",
        "subdivisions_file": "subdivisions.geojson",
        "subdivision_key": ctx.subdivision_key,
        "subdivision_singular": ctx.subdivision_key,
        "home_center": None,          # auto-frames from the boundary bbox
        "home_zoom_boost": 0.42,
        "min_zoom": 3.5,
        "max_zoom": 16,
        "_generated": {
            "query": args.region,
            "osm_relation": ctx.osm_id,
            "admin_level": ctx.subdivision_level,
            "bbox": ctx.bbox,
        },
    }
    with open(os.path.join(out_dir, "region.json"), "w") as fh:
        json.dump(region_cfg, fh, indent=2)

    with open(os.path.join(out_dir, "build_report.json"), "w") as fh:
        json.dump({"region": args.region, "slug": slug, "providers": report}, fh, indent=2)

    # ---- files the auto-pull can't invent: computed stats + honest empty stubs
    meta = write_meta(out_dir, args.region, merged)
    stubs = write_civic_stubs(out_dir, args.region, label)
    print(f"  [ok ] meta.json             {meta['counts']['power_plants']} plants, "
          f"{len(meta['generation_mix'])} fuel types, {meta['total_generation_mw']} MW mapped")
    print(f"  [ok ] civic stubs           {len(stubs)} files (empty until you localize them)")

    if args.activate:
        os.makedirs(PUBLIC_DATA, exist_ok=True)
        # Activating replaces public/data — which may hold hand-curated records
        # for a different region. Never clobber that silently.
        live = os.path.join(PUBLIC_DATA, "region.json")
        if os.path.exists(live):
            try:
                with open(live) as fh:
                    live_cfg = json.load(fh)
            except Exception:
                live_cfg = {}
            live_region = (live_cfg.get("_generated") or {}).get("query") or live_cfg.get("name")
            if live_region and live_region != args.region and not args.force:
                print(f"\n  public/data/ currently holds: {live_region}")
                print(f"  Activating {args.region!r} would overwrite it, including any curated files.")
                print(f"  Re-run with --force to proceed (a backup is written either way).\n")
                return 2
            backup = os.path.join(REGIONS_DIR, "_backup")
            os.makedirs(backup, exist_ok=True)
            for name in ACTIVATE_FILES:
                p = os.path.join(PUBLIC_DATA, name)
                if os.path.exists(p):
                    shutil.copy2(p, os.path.join(backup, name))
            print(f"  [ok ] backup                previous public/data -> regions/_backup/")
        copied, missing = 0, []
        for name in ACTIVATE_FILES:
            p = os.path.join(out_dir, name)
            if os.path.exists(p):
                shutil.copy2(p, os.path.join(PUBLIC_DATA, name))
                copied += 1
            else:
                missing.append(name)
        print(f"  [ok ] activated             {copied} files -> public/data/"
              + (f" (missing: {', '.join(missing)})" if missing else ""))

    print(f"\n  done in {time.time()-t0:.1f}s")
    if not args.activate:
        print(f"  activate with: python3 -m pipeline.bootstrap --region \"{args.region}\" --activate")
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
