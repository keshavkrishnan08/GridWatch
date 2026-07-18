"""
Data-center discovery, anywhere on Earth.

OSM tags data centers consistently worldwide (`telecom=data_center`,
`building=data_center`, `man_made=data_center`), so one query finds the mapped
sites in any region without a human hunting for filings first.

Honesty rule, inherited from the project: this is a STARTING INVENTORY, not a
complete one. OSM misses unannounced, private, and brand-new sites, and it
carries no megawatt or water figures. Every record produced here is marked
`status: "rumored"`, `mw: null`, and `_auto: true` so nothing auto-pulled can
masquerade as a filed fact. Curated records always override these on merge.
"""

from __future__ import annotations

import json
import os
import re

from ..core.geo import bbox_of, dedupe_sites, haversine_mi
from .base import RegionContext
from . import overpass as ov

# tags that reliably mean "this is a data center"
SELECTORS = [
    '["telecom"="data_center"]',
    '["building"="data_center"]',
    '["man_made"="data_center"]',
    '["telecom"="data_centre"]',
    '["building"="data_centre"]',
]
# name-based sweep for sites tagged only as generic industrial/office
NAME_RE = re.compile(r"\b(data ?cent(er|re)|datacent(er|re)|colocation|colo facility)\b", re.I)


class DataCenterProvider:
    key = "osm_datacenters"
    outputs = ["facilities.auto.json"]

    def run(self, ctx: RegionContext) -> dict:
        if not ctx.osm_area:
            return {"ok": False, "error": "boundary must resolve first"}

        # One query per selector. The public Overpass instances time out on a
        # single fat union, and splitting means one slow selector degrades the
        # result instead of losing the whole region.
        els: list[dict] = []
        ok_passes, failed = 0, []
        for i, sel in enumerate(SELECTORS):
            q = (f'[out:json][timeout:120];area({ctx.osm_area})->.a;'
                 f'(nwr{sel}(area.a););out center tags;')
            res = ov.query(q, cache_key=f"dc:{ctx.osm_area}:{i}")
            if res is None:
                failed.append(sel)
                continue
            ok_passes += 1
            els += ov.elements(res)

        # final pass: anything *named* like a data center but tagged generically
        q2 = (f'[out:json][timeout:120];area({ctx.osm_area})->.a;'
              f'(nwr["name"~"[Dd]ata ?[Cc]ent",i](area.a););out center tags;')
        named = ov.query(q2, cache_key=f"dcname:{ctx.osm_area}")
        if named is None:
            failed.append("name-sweep")
        else:
            ok_passes += 1
            els += [e for e in ov.elements(named)
                    if NAME_RE.search((e.get("tags") or {}).get("name", ""))]

        if ok_passes == 0:
            # Never write "no sites here" when we simply couldn't ask.
            return {"ok": False, "error": "every Overpass pass failed; nothing written — re-run to retry"}
        partial = bool(failed)

        sites = []
        for el in els:
            pt = ov.center_of(el)
            tags = el.get("tags") or {}
            if not pt:
                continue
            name = tags.get("name") or tags.get("operator") or "Unnamed data center"
            osm_ref = f'osm:{el.get("type")}/{el.get("id")}'
            sites.append({
                "id": _slug(name, el.get("id")),
                "name": name,
                "developer": tags.get("operator") or "Undisclosed",
                "city": tags.get("addr:city") or "",
                "county": "",           # filled by the bootstrap via point-in-polygon
                "lat": round(pt[1], 5),
                "lng": round(pt[0], 5),
                "geo_precision": "site",
                # never assert a stage or a number we didn't read from a filing
                "status": "rumored",
                "mw_phase1": None, "mw_full": None, "mw_estimated": False,
                "acres": None, "investment_usd": None,
                "water_mgd": None, "water_status": "unknown",
                "utility": tags.get("operator:electricity"),
                "iurc_docket": None, "docket_url": None,
                "announced_year": None, "online_year": None, "tax_note": None,
                "sources": [{
                    "label": f"OpenStreetMap {el.get('type')}/{el.get('id')}",
                    "url": f"https://www.openstreetmap.org/{el.get('type')}/{el.get('id')}",
                }],
                "notes": ("Discovered in OpenStreetMap. Location is mapped, but capacity, "
                          "water use, and project stage are not recorded there — treat as an "
                          "unverified lead until a filing or news report confirms it."),
                "last_verified": None,
                "_auto": True,
                "_source": osm_ref,
            })

        sites = dedupe_sites(sites, radius_mi=0.4)
        path = os.path.join(ctx.out_dir, "facilities.auto.json")
        with open(path, "w") as fh:
            json.dump({
                "generated_by": "pipeline/providers/osm_datacenters.py",
                "region": ctx.query,
                "coverage_note": ("Auto-discovered from OpenStreetMap. A starting inventory, "
                                  "not a complete one — enrich with filings and reporting."),
                "facilities": sites,
            }, fh, indent=1)
        return {"ok": True, "count": len(sites), "file": "facilities.auto.json",
                "partial": partial,
                **({"warning": f"{len(failed)} pass(es) failed: {failed}"} if partial else {})}


def _slug(name: str, oid) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "site").lower()).strip("-")[:40]
    return f"{s or 'site'}-{oid}"
