"""
PeeringDB — the network operators' facility registry.

Free, keyless, global, geocoded, and CC-BY. It's the best machine-readable
inventory of *colocation and network* facilities that exists.

Read the caveat before you use it. PeeringDB catalogues carrier hotels and
colocation sites — the places networks interconnect. It is excellent at those
and largely blind to the thing this atlas exists for: hyperscale campuses, which
are single-tenant, don't sell interconnection, and therefore have no reason to
appear. So it broadens coverage at the small end without touching the big end.

That's still worth having: a reader looking up their county should see the
facilities that are there. But these records arrive with no megawatt figure and
are a different class of thing from a 2,250 MW campus, so they're tagged
`facility_class: "colocation"` and `verification: "pending"`, and they render at
minimum size because capacity is null. Nothing here is presented as a
grid-straining project unless a filing says so.
"""

from __future__ import annotations

import json
import os
import re

from ..core.geo import dedupe_sites
from ..core.http import get_json
from .base import RegionContext

API = "https://www.peeringdb.com/api/fac"

# US state names -> USPS code, so a region query can be filtered server-side.
_STATES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA",
    "colorado": "CO", "connecticut": "CT", "delaware": "DE", "florida": "FL", "georgia": "GA",
    "hawaii": "HI", "idaho": "ID", "illinois": "IL", "indiana": "IN", "iowa": "IA",
    "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS",
    "missouri": "MO", "montana": "MT", "nebraska": "NE", "nevada": "NV",
    "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY",
    "north carolina": "NC", "north dakota": "ND", "ohio": "OH", "oklahoma": "OK",
    "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI", "south carolina": "SC",
    "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT",
    "virginia": "VA", "washington": "WA", "west virginia": "WV", "wisconsin": "WI",
    "wyoming": "WY", "district of columbia": "DC",
}


def _slug(name: str, fid) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "facility").lower()).strip("-")[:40]
    return f"pdb-{s or 'facility'}-{fid}"


class PeeringDBProvider:
    key = "peeringdb"
    outputs = ["facilities.peeringdb.json"]

    def run(self, ctx: RegionContext) -> dict:
        q = ctx.query.lower()
        state = next((v for k, v in _STATES.items() if k in q), None)
        params: dict = {"limit": 1000}
        if state:
            params.update({"state": state, "country": "US"})
        elif ctx.country_code:
            params["country"] = ctx.country_code
        else:
            return {"ok": False, "error": "no state or country to filter on; skipping"}

        res = get_json(API, params, timeout=90, min_gap=1.0,
                       cache_key=f"pdb:{params.get('state','')}:{params.get('country','')}")
        if res is None:
            return {"ok": False, "error": "PeeringDB unavailable; nothing written — re-run to retry"}

        bb = ctx.bbox
        sites = []
        for f in res.get("data", []) or []:
            try:
                lat, lng = float(f.get("latitude") or 0), float(f.get("longitude") or 0)
            except (TypeError, ValueError):
                continue
            if not lat or not lng:
                continue
            # a country-level query can return far more than the region
            if bb and not (bb[0] <= lng <= bb[2] and bb[1] <= lat <= bb[3]):
                continue
            name = (f.get("name") or "").strip() or "Unnamed facility"
            sites.append({
                "id": _slug(name, f.get("id")),
                "name": name,
                "developer": (f.get("org_name") or "").strip() or "Undisclosed",
                "city": (f.get("city") or "").strip(),
                "county": "",
                "lat": round(lat, 5), "lng": round(lng, 5),
                "geo_precision": "site",
                "status": "operational",
                "mw_phase1": None, "mw_full": None, "mw_estimated": False,
                "acres": None, "investment_usd": None,
                "water_mgd": None, "water_status": "unknown",
                "utility": None, "iurc_docket": None, "docket_url": None,
                "announced_year": None, "online_year": None, "tax_note": None,
                "sources": [{"label": f"PeeringDB facility {f.get('id')}",
                             "url": f"https://www.peeringdb.com/fac/{f.get('id')}"}],
                "notes": ("Listed in PeeringDB, the network operators' facility registry. This is a "
                          "colocation or interconnection site rather than a hyperscale campus; "
                          "PeeringDB records no power capacity, so none is claimed here."),
                "last_verified": None,
                "facility_class": "colocation",
                "verification": "pending",
                "_auto": True,
                "_source": f"peeringdb:{f.get('id')}",
            })

        sites = dedupe_sites(sites, radius_mi=0.15)
        path = os.path.join(ctx.out_dir, "facilities.peeringdb.json")
        with open(path, "w") as fh:
            json.dump({
                "generated_by": "pipeline/providers/peeringdb.py",
                "region": ctx.query,
                "license": "PeeringDB data is CC-BY 4.0 — attribute it if you republish.",
                "coverage_note": ("Colocation and interconnection facilities. PeeringDB is strong on "
                                  "carrier hotels and blind to single-tenant hyperscale campuses, "
                                  "which do not sell interconnection and so do not register."),
                "facilities": sites,
            }, fh, indent=1)
        return {"ok": True, "count": len(sites), "file": "facilities.peeringdb.json"}
