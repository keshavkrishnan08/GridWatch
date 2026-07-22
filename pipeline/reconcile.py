#!/usr/bin/env python3
"""
Reconcile our dataset against an external one.

    python3 -m pipeline.reconcile --csv /tmp/cac.csv --label "CAC"
    python3 -m pipeline.reconcile --url "https://docs.google.com/.../pub?output=csv" --label "CAC"

Someone else tracking the same subject is the best available check on your work.
This matches their records to ours by proximity first (both sides are geocoded,
so location beats fuzzy names) and reports four things:

    MATCHED    both have it, fields agree
    CONFLICT   both have it, a field disagrees -- these are the valuable ones
    THEIRS     they have it, we don't
    OURS       we have it, they don't

It changes nothing. Which side is right is a judgment call that needs a source,
and a merge script that guessed would quietly import someone else's errors
alongside their finds.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import sys

import requests

from .core.geo import haversine_mi, norm_name

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FAC = os.path.join(ROOT, "public", "data", "facilities.json")
UA = {"User-Agent": "GridWatch/1.0 (open-source civic grid atlas)"}

# external status wording -> ours
STATUS_MAP = {
    "proposed": "proposed", "under construction": "construction",
    "partially operational": "construction", "operating": "operational",
    "operational": "operational", "withdrawn": "withdrawn",
    "rumored": "rumored", "expansion": "operational", "approved": "approved",
    "cancelled": "withdrawn", "canceled": "withdrawn",
}


def norm_status(s: str) -> str:
    return STATUS_MAP.get((s or "").strip().lower(), (s or "").strip().lower())


def to_mw(s: str) -> float | None:
    """'1,500 MW' / '1.5 GW' / '600' -> megawatts."""
    if not s:
        return None
    t = str(s).strip().lower().replace(",", "").replace("~", "")
    mult = 1000.0 if "gw" in t else 1.0
    num = "".join(c for c in t if c.isdigit() or c == ".")
    try:
        return round(float(num) * mult, 1) if num else None
    except ValueError:
        return None


def load_external(rows) -> list[dict]:
    out = []
    for r in rows:
        g = {k.strip().lower(): (v or "").strip() for k, v in r.items() if k}
        try:
            lat, lng = float(g.get("latitude") or 0), float(g.get("longitude") or 0)
        except ValueError:
            lat = lng = 0
        if not lat or not lng:
            continue
        out.append({
            "name": g.get("name", ""), "owner": g.get("owner", ""),
            "city": g.get("city", ""), "county": g.get("county", ""),
            "lat": lat, "lng": lng,
            "status": norm_status(g.get("project status", "")),
            "utility": g.get("electric utility", ""),
            "mw": to_mw(g.get("anticipated power demand", "")),
            "acres": to_mw(g.get("acres", "")),
        })
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description="Reconcile our facilities against an external CSV.")
    src = ap.add_mutually_exclusive_group(required=True)
    src.add_argument("--csv", help="local CSV path")
    src.add_argument("--url", help="CSV URL")
    ap.add_argument("--label", default="EXTERNAL")
    ap.add_argument("--radius", type=float, default=6.0,
                    help="miles within which two records may describe one site (default 6)")
    ap.add_argument("--json-out", help="write the report as JSON")
    args = ap.parse_args()

    if args.url:
        try:
            r = requests.get(args.url, headers=UA, timeout=120)
            r.raise_for_status()
            text = r.text
        except Exception as e:
            print(f"  ERROR  fetch failed: {e}")
            return 2
    else:
        text = open(args.csv).read()

    theirs = load_external(list(csv.DictReader(io.StringIO(text))))
    with open(FAC) as fh:
        ours = json.load(fh)["facilities"]

    print(f"\n  Reconcile · ours {len(ours)} vs {args.label} {len(theirs)}\n" + "=" * 74)

    used_ours: set[str] = set()
    matched, conflicts, only_theirs = [], [], []

    for t in theirs:
        best, best_d = None, 1e9
        for o in ours:
            if o["id"] in used_ours:
                continue
            try:
                d = haversine_mi((t["lng"], t["lat"]), (float(o["lng"]), float(o["lat"])))
            except (TypeError, ValueError):
                continue
            # a name echo lets us accept a looser distance (city-level coords differ)
            n1, n2 = norm_name(t["name"]), norm_name(o["name"])
            shared = bool(n1 and n2 and (set(n1.split()) & set(n2.split())))
            limit = args.radius * (2.5 if shared else 1.0)
            if d < best_d and d <= limit:
                best, best_d = o, d
        if not best:
            only_theirs.append(t)
            continue
        used_ours.add(best["id"])
        diffs = []
        ours_mw = best.get("mw_full") or best.get("mw_phase1")
        if t["mw"] and ours_mw and abs(t["mw"] - ours_mw) / max(t["mw"], ours_mw) > 0.15:
            diffs.append(("mw", ours_mw, t["mw"]))
        if t["mw"] and not ours_mw:
            diffs.append(("mw", None, t["mw"]))
        if t["status"] and t["status"] != best["status"]:
            diffs.append(("status", best["status"], t["status"]))
        if t["county"] and best.get("county") and \
           t["county"].lower() != best["county"].lower():
            diffs.append(("county", best["county"], t["county"]))
        (conflicts if diffs else matched).append({"ours": best, "theirs": t,
                                                  "miles": round(best_d, 1), "diffs": diffs})

    only_ours = [o for o in ours if o["id"] not in used_ours]

    print(f"\n  THEY HAVE, WE DON'T ({len(only_theirs)}) — candidates to research\n" + "-" * 74)
    for t in sorted(only_theirs, key=lambda x: -(x["mw"] or 0)):
        mw = f"{t['mw']:>6.0f} MW" if t["mw"] else "     — MW"
        print(f"  {mw}  {t['name'][:38]:38} {t['county'][:12]:12} {t['status']}")

    print(f"\n  CONFLICTS ({len(conflicts)}) — one of us is wrong\n" + "-" * 74)
    for c in sorted(conflicts, key=lambda x: x["ours"]["id"]):
        print(f"  {c['ours']['id'][:34]:34} ({c['miles']} mi apart)")
        for field, a, b in c["diffs"]:
            print(f"       {field:8} ours={str(a)[:26]:26} {args.label.lower()}={b}")

    print(f"\n  WE HAVE, THEY DON'T ({len(only_ours)})\n" + "-" * 74)
    for o in sorted(only_ours, key=lambda x: x["id"]):
        mw = o.get("mw_full") or o.get("mw_phase1")
        print(f"  {(str(int(mw))+' MW') if mw else '— MW':>8}  {o['id'][:36]:36} {o['status']}")

    print("\n" + "=" * 74)
    print(f"  {len(matched)} agree · {len(conflicts)} conflict · "
          f"{len(only_theirs)} only {args.label} · {len(only_ours)} only ours")
    print("\n  Nothing was changed. Each conflict needs a source before either side moves.\n")

    if args.json_out:
        with open(args.json_out, "w") as fh:
            json.dump({
                "label": args.label,
                "counts": {"agree": len(matched), "conflict": len(conflicts),
                           "only_theirs": len(only_theirs), "only_ours": len(only_ours)},
                "only_theirs": only_theirs,
                "conflicts": [{"id": c["ours"]["id"], "miles": c["miles"],
                               "diffs": [{"field": f, "ours": a, "theirs": b} for f, a, b in c["diffs"]]}
                              for c in conflicts],
                "only_ours": [o["id"] for o in only_ours],
            }, fh, indent=2)
        print(f"  report -> {args.json_out}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
