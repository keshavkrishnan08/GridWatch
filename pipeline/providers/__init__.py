"""
Provider registry.

`DEFAULT_CHAIN` is what `bootstrap.py` runs for any region on Earth. Order
matters: the boundary resolves the OSM area that every later provider queries.

To add a source, write a class implementing the Provider protocol (see
base.py) and append it here — or pass `--providers` on the command line to run
a subset. Regional sources (a national regulator, a state ArcGIS server) can be
registered alongside the global OSM ones without touching the pipeline core.
"""

from __future__ import annotations

from .base import Provider, RegionContext
from .osm_boundary import BoundaryProvider, SubdivisionsProvider
from .osm_datacenters import DataCenterProvider
from .osm_power import PowerPlantProvider, SubstationProvider, TransmissionProvider

# global, works for every region
DEFAULT_CHAIN: list[Provider] = [
    BoundaryProvider(),
    SubdivisionsProvider(),
    DataCenterProvider(),
    PowerPlantProvider(),
    TransmissionProvider(),
    SubstationProvider(),
]

REGISTRY: dict[str, Provider] = {p.key: p for p in DEFAULT_CHAIN}


def resolve(keys: list[str] | None) -> list[Provider]:
    """Providers for the requested keys, or the full default chain."""
    if not keys:
        return DEFAULT_CHAIN
    out = []
    for k in keys:
        if k not in REGISTRY:
            raise SystemExit(f"unknown provider {k!r}; available: {', '.join(REGISTRY)}")
        out.append(REGISTRY[k])
    return out


__all__ = ["Provider", "RegionContext", "DEFAULT_CHAIN", "REGISTRY", "resolve"]
