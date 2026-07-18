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


# ---------------------------------------------------------------- theme
# Regions that don't use the metric system (US, Liberia, Myanmar).
_IMPERIAL = {"US", "LR", "MM"}
# Enough of the common cases to be useful; everything else gets a _todo.
_CURRENCY = {
    "US": ("USD", "$"), "CA": ("CAD", "$"), "AU": ("AUD", "$"), "NZ": ("NZD", "$"),
    "GB": ("GBP", "£"), "IE": ("EUR", "€"), "DE": ("EUR", "€"), "FR": ("EUR", "€"),
    "ES": ("EUR", "€"), "IT": ("EUR", "€"), "NL": ("EUR", "€"), "PT": ("EUR", "€"),
    "AT": ("EUR", "€"), "BE": ("EUR", "€"), "FI": ("EUR", "€"), "GR": ("EUR", "€"),
    "JP": ("JPY", "¥"), "CN": ("CNY", "¥"), "IN": ("INR", "₹"), "BR": ("BRL", "R$"),
    "MX": ("MXN", "$"), "SE": ("SEK", "kr"), "NO": ("NOK", "kr"), "DK": ("DKK", "kr"),
    "PL": ("PLN", "zł"), "CH": ("CHF", "CHF"), "ZA": ("ZAR", "R"), "SG": ("SGD", "$"),
    "KR": ("KRW", "₩"),
}
_LOCALE = {
    "US": "en-US", "GB": "en-GB", "IE": "en-IE", "CA": "en-CA", "AU": "en-AU",
    "DE": "de-DE", "FR": "fr-FR", "ES": "es-ES", "IT": "it-IT", "NL": "nl-NL",
    "BR": "pt-BR", "MX": "es-MX", "JP": "ja-JP", "IN": "en-IN", "SE": "sv-SE",
}


def _pluralize(word: str) -> str:
    """county -> counties, parish -> parishes, commune -> communes."""
    if not word:
        return ""
    if word.endswith("y") and len(word) > 1 and word[-2] not in "aeiou":
        return word[:-1] + "ies"
    if word.endswith(("s", "x", "z", "ch", "sh")):
        return word + "es"
    return word + "s"


def write_theme(out_dir: str, label: str, subdivision: str, country_code: str | None) -> str:
    """
    A theme tuned to the region, not to Indiana.

    Scale is 'auto' so the color bands re-derive from whatever capacities the
    region actually has — a single county and a whole country both read
    correctly. Utilities start empty because they're region-specific; until
    they're filled in everything falls back to a neutral label.
    """
    cc = (country_code or "").upper()
    currency = _CURRENCY.get(cc)
    imperial = cc in _IMPERIAL
    plural = _pluralize(subdivision)

    theme = {
        "_doc": ("Visual + semantic toolkit for this region. Generated by the bootstrap — "
                 "edit freely. See FORKING.md."),
        "scale_mode": "auto",
        "_scale_mode_doc": ("'auto' keeps these labels/colors but re-derives the MW bounds from "
                            "your data at load time. Switch to 'fixed' once you know the right "
                            "thresholds for your region."),
        "bands": [
            {"key": "low", "label": "Small", "max": 50, "color": "#3FB950"},
            {"key": "med", "label": "Medium", "max": 250, "color": "#E3A72B"},
            {"key": "high", "label": "Large", "max": 500, "color": "#F85149"},
            {"key": "mega", "label": "Mega", "max": None, "color": "#FF6BFF"},
        ],
        "unknown_color": "#6B7684",
        "fuels": {
            "coal": {"label": "Coal", "color": "#B24A45"},
            "gas": {"label": "Gas", "color": "#E3862B"},
            "solar": {"label": "Solar", "color": "#EBCB3E"},
            "wind": {"label": "Wind", "color": "#47C7B0"},
            "nuclear": {"label": "Nuclear", "color": "#B06BE0"},
            "hydro": {"label": "Hydro", "color": "#3D9BE0"},
            "battery": {"label": "Battery", "color": "#3FB950"},
            "oil": {"label": "Oil", "color": "#8A6A55"},
            "biomass": {"label": "Biomass", "color": "#7F9A4E"},
            "other": {"label": "Other", "color": "#6B7684"},
        },
        "_utilities_todo": (f"Add the utilities serving {label}. 'match' holds lowercase "
                           f"substrings used to recognize each one in your data. Until then, "
                           f"every site shows the neutral other_utility label."),
        "utilities": [],
        "other_utility": {"display": "Utility not identified", "color": "#46586B"},
        "units": {
            "system": "imperial" if imperial else "metric",
            "currency": {"code": currency[0], "symbol": currency[1]} if currency
                        else {"code": "USD", "symbol": "$"},
            "water": "mgd" if imperial else "m3d",
            "locale": _LOCALE.get(cc, "en-US"),
        },
        **({} if currency else {"_currency_todo": "Set units.currency for your region."}),
        "terminology": {
            "subdivision": subdivision,
            "subdivision_plural": plural,
            "regulator": None,
            "regulator_url": None,
            "consumer_advocate": None,
            "consumer_advocate_url": None,
        },
        "_terminology_todo": (f"Set regulator / consumer_advocate to {label}'s utility regulator "
                              f"and ratepayer advocate — they're used in the civic action links."),
        "_jobs_todo": ("jobs.comparison is the jobs-per-MW figure for other industry in your "
                       "region, used for the employment comparison. Set it from a local source, "
                       "or null to hide the comparison."),
        "jobs": {
            "datacenter": 0.26,
            "comparison": None,
            "comparison_label": "other industry",
            "source": None,
        },
    }
    return _dump(out_dir, "theme.json", theme)
