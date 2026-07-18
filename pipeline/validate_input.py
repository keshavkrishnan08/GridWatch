#!/usr/bin/env python3
"""
Validate a facilities file before you publish it.

    python3 -m pipeline.validate_input my_region/facilities.json
    python3 -m pipeline.validate_input my_region/facilities.json --subdivisions regions/ohio/subdivisions.geojson

Errors are things that will break or mislead (missing coordinates, an unknown
status, a figure with no source). Warnings are things worth a second look
(a site with no capacity, coordinates outside the region, a name that doesn't
match any subdivision).

The rule this enforces above all: every facility carries at least one source.
"""

from __future__ import annotations

import argparse
import json
import sys

STATUSES = {"proposed", "approved", "construction", "operational", "rumored", "withdrawn"}
PRECISION = {"parcel", "site", "city", "county"}
WATER = {"known", "redacted", "unknown"}


def main() -> int:
    ap = argparse.ArgumentParser(description="Validate a GridWatch facilities file.")
    ap.add_argument("file")
    ap.add_argument("--subdivisions", help="geojson to check county names against")
    ap.add_argument("--subdivision-key", default="county")
    args = ap.parse_args()

    try:
        with open(args.file) as fh:
            doc = json.load(fh)
    except FileNotFoundError:
        print(f"  ERROR  no such file: {args.file}")
        return 1
    except json.JSONDecodeError as e:
        print(f"  ERROR  invalid JSON: {e}")
        return 1

    facs = doc.get("facilities")
    if not isinstance(facs, list):
        print("  ERROR  top-level 'facilities' array is missing")
        return 1

    known: set[str] = set()
    if args.subdivisions:
        try:
            with open(args.subdivisions) as fh:
                known = {
                    str((f.get("properties") or {}).get(args.subdivision_key, "")).lower()
                    for f in json.load(fh).get("features", [])
                }
                known.discard("")
        except Exception as e:
            print(f"  WARN   could not read subdivisions: {e}")

    errors: list[str] = []
    warns: list[str] = []
    seen_ids: set[str] = set()

    for i, f in enumerate(facs):
        who = f.get("id") or f.get("name") or f"#{i}"

        for field in ("id", "name", "status"):
            if not f.get(field):
                errors.append(f"{who}: missing required '{field}'")

        if f.get("id") in seen_ids:
            errors.append(f"{who}: duplicate id")
        seen_ids.add(f.get("id"))

        lat, lng = f.get("lat"), f.get("lng")
        if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
            errors.append(f"{who}: lat/lng must be numbers")
        else:
            if not (-90 <= lat <= 90) or not (-180 <= lng <= 180):
                errors.append(f"{who}: lat/lng out of range")

        st = f.get("status")
        if st and st not in STATUSES:
            errors.append(f"{who}: unknown status {st!r} (use {'/'.join(sorted(STATUSES))})")

        srcs = f.get("sources")
        if not isinstance(srcs, list) or not srcs:
            errors.append(f"{who}: needs at least one source — every figure must be traceable")
        else:
            for s in srcs:
                if not isinstance(s, dict) or not s.get("label"):
                    errors.append(f"{who}: each source needs a 'label'")
                elif s.get("url") and not str(s["url"]).startswith(("http://", "https://")):
                    warns.append(f"{who}: source url is not http(s)")

        gp = f.get("geo_precision")
        if gp and gp not in PRECISION:
            warns.append(f"{who}: geo_precision {gp!r} not one of {'/'.join(sorted(PRECISION))}")

        ws = f.get("water_status")
        if ws and ws not in WATER:
            warns.append(f"{who}: water_status {ws!r} not one of {'/'.join(sorted(WATER))}")

        mw = f.get("mw_full") or f.get("mw_phase1")
        if mw is None and not f.get("acres"):
            warns.append(f"{who}: no capacity and no acreage — it will render at minimum size")
        if mw is not None and not isinstance(mw, (int, float)):
            errors.append(f"{who}: capacity must be a number or null")
        if f.get("mw_full") and f.get("mw_phase1") and f["mw_phase1"] > f["mw_full"]:
            errors.append(f"{who}: mw_phase1 exceeds mw_full")

        a, o = f.get("announced_year"), f.get("online_year")
        if a and o and o < a:
            warns.append(f"{who}: online_year is before announced_year")

        cty = (f.get("county") or "").lower()
        if known and cty and cty not in known:
            warns.append(f"{who}: county {f.get('county')!r} not found in subdivisions")

    print(f"\n  {args.file}")
    print(f"  {len(facs)} facilities\n" + "-" * 50)
    for e in errors:
        print(f"  ERROR  {e}")
    for w in warns:
        print(f"  WARN   {w}")
    print("-" * 50)
    print(f"  {len(errors)} errors, {len(warns)} warnings\n")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
