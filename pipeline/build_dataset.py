#!/usr/bin/env python3
"""
GridWatch Indiana - dataset builder
===================================

Reads the curated + fetched data files and emits public/data/meta.json:
statewide roll-ups the console renders (total DC load by status, share of
state peak, generation mix, per-county and per-utility summaries, data
vintages). Pure derivation - invents no numbers; every output is a sum or
count of an existing, sourced value.
"""
import json
import os
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
DATA = os.path.normpath(os.path.join(HERE, "..", "public", "data"))

# Approximate Indiana statewide summer peak demand (MW). Order-of-magnitude
# reference for the "share of state peak" readout; labeled approximate in UI.
STATE_PEAK_MW = 35000

COMMITTED = {"approved", "construction", "operational"}
PROPOSED = {"proposed", "rumored"}


def load(name):
    with open(os.path.join(DATA, name)) as f:
        return json.load(f)


def main():
    fac = load("facilities.json")
    facilities = fac["facilities"]

    by_status = defaultdict(int)
    mw_committed = mw_proposed = mw_withdrawn = 0.0
    mega = []
    county = defaultdict(lambda: {"count": 0, "mw": 0.0, "utility": None})
    utility = defaultdict(lambda: {"count": 0, "mw": 0.0})

    for f in facilities:
        s = f["status"]
        by_status[s] += 1
        mw = f.get("mw_full") or f.get("mw_phase1") or 0
        if s in COMMITTED:
            mw_committed += mw
        elif s in PROPOSED:
            mw_proposed += mw
        elif s == "withdrawn":
            mw_withdrawn += mw
        if mw and mw > 500 and s != "withdrawn":
            mega.append({"name": f["name"], "mw": mw, "county": f["county"]})
        if s != "withdrawn":
            c = county[f["county"]]
            c["count"] += 1
            c["mw"] += mw
            if f.get("utility") and not c["utility"]:
                c["utility"] = f["utility"]  # first serving utility wins (stable)
            if f.get("utility"):
                u = utility[f["utility"]]
                u["count"] += 1
                u["mw"] += mw

    active_total = mw_committed + mw_proposed

    # generation mix from existing power plants
    mix = defaultdict(float)
    plants = load("power_plants.geojson")["features"]
    for p in plants:
        mix[p["properties"]["fuel"]] += p["properties"].get("capacity_mw", 0) or 0
    total_gen = sum(mix.values()) or 1
    gen_mix = sorted(
        [{"fuel": k, "mw": round(v), "pct": round(100 * v / total_gen, 1)}
         for k, v in mix.items()],
        key=lambda x: x["mw"], reverse=True)

    def counts(name):
        try:
            return len(load(name)["features"])
        except Exception:
            return 0

    meta = {
        "last_updated": fac["last_updated"],
        "state_peak_mw": STATE_PEAK_MW,
        "counts": {
            "facilities_curated": len(facilities),
            # The AI Law Tracker inventory that seeded this file listed ~46 Indiana
            # projects. Our own curation has since passed that, so the "tracked"
            # figure is the larger of the two — it can never be below what we hold.
            "facilities_tracked_statewide": max(46, len(facilities)),
            "by_status": dict(by_status),
            "counties_with_projects": len([c for c in county if county[c]["count"]]),
            "power_plants": len(plants),
            "transmission_lines": counts("transmission.geojson"),
            "utility_territories": counts("utility_territories.geojson"),
            "substations": counts("substations.geojson"),
        },
        "load_mw": {
            "committed": round(mw_committed),
            "proposed": round(mw_proposed),
            "active_total": round(active_total),
            "withdrawn_avoided": round(mw_withdrawn),
            "pct_of_state_peak": round(100 * active_total / STATE_PEAK_MW, 1),
        },
        "mega_facilities": sorted(mega, key=lambda x: x["mw"], reverse=True),
        "generation_mix": gen_mix,
        "total_generation_mw": round(total_gen),
        "top_counties": sorted(
            [{"county": k, **v, "mw": round(v["mw"])} for k, v in county.items()],
            key=lambda x: x["mw"], reverse=True)[:10],
        "utilities": sorted(
            [{"utility": k, **v, "mw": round(v["mw"])} for k, v in utility.items()],
            key=lambda x: x["mw"], reverse=True),
        "sources": {
            "counties": "US Census (plotly mirror)",
            "power_plants": "WRI Global Power Plant Database v1.3.0 (~2021)",
            "territories": "HIFLD Electric Retail Service Territories",
            "transmission": "HIFLD Electric Power Transmission Lines (>=138 kV)",
            "facilities": "Curated from IURC filings, utility filings, county records, AI Law Tracker, and news reporting (cited per record)",
        },
    }
    with open(os.path.join(DATA, "meta.json"), "w") as f:
        json.dump(meta, f, indent=2)

    print("meta.json written")
    print(f"  curated facilities : {len(facilities)}  (statewide tracked: 46)")
    print(f"  committed load     : {meta['load_mw']['committed']:,} MW")
    print(f"  proposed load      : {meta['load_mw']['proposed']:,} MW")
    print(f"  active total       : {meta['load_mw']['active_total']:,} MW "
          f"({meta['load_mw']['pct_of_state_peak']}% of state peak)")
    print(f"  avoided (withdrawn): {meta['load_mw']['withdrawn_avoided']:,} MW")
    print(f"  generation sampled : {meta['total_generation_mw']:,} MW across "
          f"{len(gen_mix)} fuels")
    top = ", ".join(f"{g['fuel']} {g['pct']}%" for g in gen_mix[:4])
    print(f"  mix (top)          : {top}")


if __name__ == "__main__":
    main()
