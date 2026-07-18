"""
The provider contract.

A provider knows how to fetch one layer for one region. Everything the
bootstrap does is call providers in order and hand each one a RegionContext.

Adding a source (a national grid operator, a state regulator, your own CSV) is
just writing a class with `key`, `outputs`, and `run()`, then registering it in
providers/__init__.py. Nothing else in the pipeline needs to change.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol


@dataclass
class RegionContext:
    """Everything a provider needs to know about the region being built."""

    query: str                       # what the user asked for, e.g. "Ohio, United States"
    slug: str                        # filesystem-safe id, e.g. "ohio"
    label: str                       # display label, e.g. "OHIO"
    out_dir: str                     # where layer files are written
    country_code: str | None = None  # ISO2 when known, e.g. "US"
    osm_id: int | None = None        # OSM relation id for the region
    osm_area: int | None = None      # Overpass area id (3600000000 + relation id)
    bbox: tuple[float, float, float, float] | None = None
    boundary: dict | None = None     # GeoJSON geometry of the region outline
    subdivision_level: int | None = None   # OSM admin_level used for subdivisions
    subdivision_key: str = "county"        # property name the app reads
    extras: dict[str, Any] = field(default_factory=dict)


class Provider(Protocol):
    """One layer, one source."""

    key: str            # short id, e.g. "osm_power"
    outputs: list[str]  # files it writes, e.g. ["power_plants.geojson"]

    def run(self, ctx: RegionContext) -> dict:
        """Fetch + write. Return a small summary dict for the run report."""
        ...
