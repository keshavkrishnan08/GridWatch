"""
Region scaffolding.

The atlas reads several files the auto-pull can't invent: bill models, dockets,
regulator contacts, local restrictions. If a fork activated a new region while
those still held the previous region's content, the app would confidently show
one place's rates and hearings under another place's name. That's the exact
failure mode this project exists to avoid.

So every bootstrapped region gets a complete set of files: `meta.json` is
COMPUTED from what we actually fetched, and the civic files are written EMPTY,
with a note telling the forker what to fill in. Empty is honest; stale is not.
"""

from __future__ import annotations

import collections
import json
import os
from datetime import date


def _mw(f: dict) -> float:
    return f.get("mw_full") or f.get("mw_phase1") or 0


def write_meta(out_dir: str, region_query: str, facilities: list[dict]) -> dict:
    """Derive headline stats from the data we actually have."""
    plants = []
    p = os.path.join(out_dir, "power_plants.geojson")
    if os.path.exists(p):
        with open(p) as fh:
            plants = json.load(fh).get("features", [])

    by_status = collections.Counter(f.get("status", "unknown") for f in facilities)
    active = [f for f in facilities if f.get("status") != "withdrawn"]
    committed = sum(_mw(f) for f in active if f.get("status") in ("construction", "operational"))
    proposed = sum(_mw(f) for f in active if f.get("status") in ("proposed", "approved", "rumored"))

    fuel_mw: dict[str, float] = collections.defaultdict(float)
    total_gen = 0.0
    for pf in plants:
        pr = pf.get("properties", {})
        mw = pr.get("mw") or 0
        fuel_mw[pr.get("fuel", "other")] += mw
        total_gen += mw
    mix = [{"fuel": k, "mw": round(v), "pct": round(100 * v / total_gen, 1) if total_gen else 0}
           for k, v in sorted(fuel_mw.items(), key=lambda kv: -kv[1])]

    counties = collections.Counter(f.get("county") for f in active if f.get("county"))
    meta = {
        "last_updated": date.today().isoformat(),
        "region": region_query,
        # Peak demand is a published figure per grid operator — it can't be
        # derived from OSM, so it stays null until a forker supplies it.
        "state_peak_mw": None,
        "counts": {
            "facilities_curated": len(facilities),
            "facilities_tracked_statewide": len(facilities),
            "by_status": dict(by_status),
            "counties_with_projects": len(counties),
            "power_plants": len(plants),
            "transmission_lines": _count(out_dir, "transmission.geojson"),
            "utility_territories": 0,
            "substations": _count(out_dir, "substations.geojson"),
        },
        "load_mw": {
            "committed": round(committed),
            "proposed": round(proposed),
            "active_total": round(committed + proposed),
            "withdrawn_avoided": round(sum(_mw(f) for f in facilities if f.get("status") == "withdrawn")),
            "pct_of_state_peak": None,
        },
        "mega_facilities": sorted(
            [{"name": f["name"], "mw": round(_mw(f)), "county": f.get("county", "")}
             for f in active if _mw(f) > 500],
            key=lambda d: -d["mw"],
        ),
        "generation_mix": mix,
        "total_generation_mw": round(total_gen),
        "top_counties": [{"county": c, "count": n, "mw": round(sum(_mw(f) for f in active if f.get("county") == c)),
                          "utility": None} for c, n in counties.most_common(10)],
        "utilities": [],
        "sources": {
            "facilities": "OpenStreetMap (auto-discovered) + curated records",
            "power_plants": "OpenStreetMap power=plant",
            "transmission": "OpenStreetMap power=line",
            "territories": "not configured for this region",
            "counties": "OpenStreetMap administrative boundaries",
        },
    }
    _dump(out_dir, "meta.json", meta)
    return meta


def write_civic_stubs(out_dir: str, region_query: str, label: str) -> list[str]:
    """Empty-but-valid civic files, each explaining what to fill in."""
    written = []

    todo = (f"Not yet configured for {label}. Replace this file with real, sourced "
            f"local data before publishing — the atlas deliberately shows nothing "
            f"rather than another region's figures.")

    written.append(_dump(out_dir, "bill_impact_models.json", {
        "_todo": todo,
        "disclaimer": (f"No bill-impact model is configured for {label} yet. "
                       "Rates and cost-shift figures must come from local utility filings."),
        "equation": "dc_impact_per_month = filed_infrastructure_usd / customers / (amortize_years * 12)",
        "statewide_context": {
            "avg_bill_increase_this_year_pct": None,
            "avg_bill_increase_decade_pct": None,
            "avg_rate_cents_kwh": None,
            "source": {"label": "not configured", "url": ""},
        },
        "assumptions": {"amortize_years": 20, "uncertainty_band_pct": 25, "typical_household_kwh": 1000},
        "utilities": [],
    }))

    written.append(_dump(out_dir, "action_items.json", {
        "_todo": todo,
        "intro": (f"GridWatch is nonpartisan: it shows the process, not a position. "
                  f"Add {label}'s regulator, public-comment process, and local groups here."),
        "items": [],
    }))

    written.append(_dump(out_dir, "dockets.json", {
        "_todo": todo,
        "portal": "",
        "note": f"Add {label}'s utility-regulator docket portal.",
        "dockets": [],
    }))

    written.append(_dump(out_dir, "county_restrictions.json", {
        "_todo": todo,
        "note": f"Local bans and moratoriums in {label}. Each needs a citation.",
        "sources": [],
        "counties": [],
    }))

    written.append(_dump(out_dir, "timeline_events.json", {
        "_todo": todo,
        "range": {"start": date.today().year - 6, "end": date.today().year + 9},
        "now": round(date.today().year + (date.today().month - 1) / 12, 2),
        "events": [],
    }))

    # the app expects this layer to exist; empty renders cleanly
    written.append(_dump(out_dir, "utility_territories.geojson",
                         {"type": "FeatureCollection", "features": []}))
    return written


def _count(out_dir: str, fname: str) -> int:
    p = os.path.join(out_dir, fname)
    if not os.path.exists(p):
        return 0
    try:
        with open(p) as fh:
            return len(json.load(fh).get("features", []))
    except Exception:
        return 0


def _dump(out_dir: str, name: str, obj) -> str:
    with open(os.path.join(out_dir, name), "w") as fh:
        json.dump(obj, fh, indent=1)
    return name
