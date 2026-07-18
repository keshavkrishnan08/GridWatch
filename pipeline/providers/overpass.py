"""
Shared Overpass/Nominatim access.

OpenStreetMap is what makes GridWatch region-agnostic: administrative
boundaries, power infrastructure, and data centers are all tagged with the same
schema everywhere on Earth, so one query works for Ohio, Ontario, or Osaka.
"""

from __future__ import annotations

import hashlib

from ..core.http import get_json, post_json

MIRRORS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.osm.jp/api/interpreter",
]
NOMINATIM = "https://nominatim.openstreetmap.org/search"

# admin_level that best matches "the clickable piece inside a region".
# OSM levels differ by country; these are the sane defaults, overridable.
DEFAULT_SUBDIVISION_LEVEL: dict[str, int] = {
    "US": 6,   # counties
    "CA": 6,   # census divisions
    "GB": 6,   # counties / council areas
    "DE": 6,   # Kreise
    "FR": 6,   # départements
    "IT": 6,   # province
    "ES": 6,   # provincias
    "AU": 6,   # LGAs
    "BR": 8,   # municípios
    "IN": 5,   # districts
    "JP": 7,   # municipalities
    "MX": 6,   # municipios
    "NL": 8,   # gemeenten
    "IE": 6,
    "PL": 6,
    "SE": 7,
}
FALLBACK_LEVELS = [6, 8, 5, 7, 4]


def geocode(query: str, *, polygon: bool = True) -> dict | None:
    """Resolve a free-text region name to an OSM relation + boundary polygon."""
    params = {
        "q": query,
        "format": "json",
        "limit": 1,
        "polygon_geojson": 1 if polygon else 0,
    }
    res = get_json(
        NOMINATIM, params, min_gap=1.2, timeout=60,
        cache_key=f"nominatim:{query}:{polygon}",
    )
    if not res:
        return None
    hit = res[0]
    if hit.get("osm_type") != "relation":
        return None  # need a relation to build an Overpass area
    return hit


def query(overpass_ql: str, *, cache_key: str | None = None) -> dict | None:
    """Run an Overpass QL query against the mirror pool.

    The cache key always includes a hash of the query text — a label alone
    would serve a stale result after the query changes.
    """
    digest = hashlib.sha1(overpass_ql.encode()).hexdigest()[:12]
    key = f"{cache_key}:{digest}" if cache_key else f"overpass:{digest}"
    return post_json(MIRRORS, {"data": overpass_ql}, cache_key=key)


def area_id(osm_relation_id: int) -> int:
    """Overpass area id for an OSM relation."""
    return 3600000000 + int(osm_relation_id)


def elements(result: dict | None) -> list[dict]:
    return (result or {}).get("elements", []) or []


def center_of(el: dict) -> tuple[float, float] | None:
    """(lng, lat) for a node, or the computed center of a way/relation."""
    if el.get("type") == "node" and "lon" in el:
        return (float(el["lon"]), float(el["lat"]))
    c = el.get("center")
    if c:
        return (float(c["lon"]), float(c["lat"]))
    return None
