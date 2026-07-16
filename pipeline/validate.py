#!/usr/bin/env python3
"""
GridWatch Indiana - validator
=============================

Schema + sanity checks on the data files. Run `python3 pipeline/validate.py`.
Add `--links` to HTTP-check every unique source URL (slower, network-bound).
Exit code is non-zero if any hard error is found - suitable for CI.
"""
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "public", "data"))
IN_BBOX = (-88.10, 37.77, -84.78, 41.76)
STATUSES = {"proposed", "approved", "construction", "operational", "rumored", "withdrawn"}
PRECISIONS = {"parcel", "site", "city", "county"}

errors, warnings = [], []


def err(m): errors.append(m)
def warn(m): warnings.append(m)


def load(name):
    with open(os.path.join(DATA, name)) as f:
        return json.load(f)


def check_facilities():
    fac = load("facilities.json")["facilities"]
    ids = set()
    x0, y0, x1, y1 = IN_BBOX
    for f in fac:
        fid = f.get("id", "?")
        if fid in ids:
            err(f"duplicate facility id: {fid}")
        ids.add(fid)
        for req in ("id", "name", "developer", "county", "lat", "lng", "status", "sources"):
            if req not in f or f[req] in (None, "", []):
                err(f"{fid}: missing/empty required field '{req}'")
        if f.get("status") not in STATUSES:
            err(f"{fid}: bad status '{f.get('status')}'")
        if f.get("geo_precision") not in PRECISIONS:
            warn(f"{fid}: unusual geo_precision '{f.get('geo_precision')}'")
        lat, lng = f.get("lat"), f.get("lng")
        if isinstance(lat, (int, float)) and isinstance(lng, (int, float)):
            if not (x0 <= lng <= x1 and y0 <= lat <= y1):
                err(f"{fid}: coordinates {lat},{lng} fall outside Indiana")
        for src in f.get("sources", []):
            if not src.get("url", "").startswith("http"):
                err(f"{fid}: source without valid url: {src}")
        mw = f.get("mw_full") or f.get("mw_phase1")
        if f["status"] != "withdrawn" and not mw and not f.get("acres"):
            warn(f"{fid}: no MW and no acreage")
    print(f"  facilities: {len(fac)} records, {len(ids)} unique ids")


def check_geojson(name, gtypes):
    try:
        gj = load(name)
    except Exception as e:
        err(f"{name}: cannot load ({e})")
        return
    feats = gj.get("features", [])
    bad = 0
    for f in feats:
        g = (f.get("geometry") or {}).get("type")
        if g not in gtypes:
            bad += 1
    if bad:
        warn(f"{name}: {bad} features with unexpected geometry")
    print(f"  {name}: {len(feats)} features")
    if len(feats) == 0 and name not in ("substations.geojson",):
        err(f"{name}: empty (expected features)")


def check_cross_refs():
    """Warn if a facility's utility isn't recognizable as a known IOU or a co-op/muni."""
    fac = load("facilities.json")["facilities"]
    iou = ["aes", "indianapolis power", "duke", "indiana michigan", "i&m",
           "nipsco", "northern indiana", "centerpoint", "vectren", "southern indiana gas"]
    coop_muni = ["remc", "cooperative", "coop", "co-op", "municipal", "hoosier",
                 "wvpa", "city of", "town of", "membership", "public power", "impa", "imea"]
    for f in fac:
        u = (f.get("utility") or "").lower()
        if u and not any(k in u for k in iou + coop_muni):
            warn(f"{f['id']}: utility '{f['utility']}' unrecognized (not a known IOU or co-op/muni)")
    try:
        meta = load("meta.json")
        print(f"  cross-refs: {len(fac)} facility utilities checked; meta committed "
              f"{meta['load_mw']['committed']} MW, proposed {meta['load_mw']['proposed']} MW")
    except FileNotFoundError:
        warn("meta.json missing - run build_dataset.py")


def check_links():
    urls = set()
    for name in ("facilities.json", "dockets.json", "bill_impact_models.json",
                 "action_items.json", "timeline_events.json"):
        blob = json.dumps(load(name))
        # crude but effective: pull every http(s) token
        for tok in blob.replace('"', " ").split():
            if tok.startswith("http"):
                urls.add(tok.rstrip(",);"))
    print(f"  checking {len(urls)} unique URLs...")
    ua = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
          "(KHTML, like Gecko) Chrome/124.0 Safari/537.36")
    for u in sorted(urls):
        try:
            # GET (not HEAD); many news sites 405/403 on HEAD but serve to humans
            req = urllib.request.Request(u, headers={"User-Agent": ua})
            code = urllib.request.urlopen(req, timeout=25).status
            if code >= 400:
                warn(f"link {code}: {u}")
        except urllib.error.HTTPError as e:
            # 403 = anti-bot (page is fine for humans); flag others louder
            (warn if e.code in (403, 429) else err)(f"link {e.code}: {u}")
        except Exception as e:
            warn(f"link unreachable: {u} ({type(e).__name__})")


def main():
    print("=" * 50)
    print("GridWatch Indiana - validate")
    print("=" * 50)
    check_facilities()
    check_geojson("counties.geojson", {"Polygon", "MultiPolygon"})
    check_geojson("power_plants.geojson", {"Point"})
    check_geojson("transmission.geojson", {"LineString", "MultiLineString"})
    check_geojson("utility_territories.geojson", {"Polygon", "MultiPolygon"})
    check_geojson("substations.geojson", {"Point"})
    try:
        check_cross_refs()
    except FileNotFoundError:
        warn("meta.json missing - run build_dataset.py")
    if "--links" in sys.argv:
        check_links()

    print("-" * 50)
    for w in warnings:
        print(f"  WARN  {w}")
    for e in errors:
        print(f"  ERROR {e}")
    print(f"\n{len(errors)} errors, {len(warnings)} warnings")
    sys.exit(1 if errors else 0)


if __name__ == "__main__":
    main()
