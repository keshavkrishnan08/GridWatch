"""
Resilient HTTP for the GridWatch pipeline.

Public data endpoints rate-limit, time out, and occasionally return HTML error
pages with a 200. Every provider goes through this module so that behaviour is
handled once: mirror rotation, retry with backoff, polite rate limiting, and an
on-disk cache so re-runs during development don't hammer the source.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Any, Iterable

import requests

UA = "GridWatch/1.0 (open-source civic grid atlas; https://github.com/)"
CACHE_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".cache")

_session = requests.Session()
_session.headers.update({"User-Agent": UA})
_last_call: dict[str, float] = {}


def _throttle(host: str, min_gap: float) -> None:
    """Keep at least `min_gap` seconds between calls to the same host."""
    prev = _last_call.get(host, 0.0)
    wait = min_gap - (time.time() - prev)
    if wait > 0:
        time.sleep(wait)
    _last_call[host] = time.time()


def _cache_path(key: str) -> str:
    return os.path.join(CACHE_DIR, hashlib.sha1(key.encode()).hexdigest() + ".json")


def cached(key: str) -> Any | None:
    p = _cache_path(key)
    if os.path.exists(p):
        try:
            with open(p) as fh:
                return json.load(fh)
        except Exception:
            return None
    return None


def put_cache(key: str, value: Any) -> None:
    os.makedirs(CACHE_DIR, exist_ok=True)
    try:
        with open(_cache_path(key), "w") as fh:
            json.dump(value, fh)
    except Exception:
        pass  # cache is an optimization, never a hard dependency


def get_json(
    url: str,
    params: dict | None = None,
    *,
    tries: int = 3,
    timeout: int = 60,
    min_gap: float = 1.0,
    cache_key: str | None = None,
) -> Any | None:
    """GET JSON with retry + polite throttling. Returns None if unavailable."""
    if cache_key:
        hit = cached(cache_key)
        if hit is not None:
            return hit
    host = url.split("/")[2] if "//" in url else url
    for attempt in range(tries):
        _throttle(host, min_gap)
        try:
            r = _session.get(url, params=params, timeout=timeout)
            if r.status_code == 200 and "json" in r.headers.get("content-type", ""):
                data = r.json()
                if cache_key:
                    put_cache(cache_key, data)
                return data
        except Exception:
            pass
        time.sleep(2 * (attempt + 1))
    return None


def post_json(
    urls: Iterable[str],
    data: dict,
    *,
    tries: int = 4,
    timeout: int = 300,
    min_gap: float = 2.0,
    cache_key: str | None = None,
) -> Any | None:
    """POST to the first healthy mirror in `urls`, rotating on failure."""
    if cache_key:
        hit = cached(cache_key)
        if hit is not None:
            return hit
    mirrors = list(urls)
    for attempt in range(tries):
        url = mirrors[attempt % len(mirrors)]
        host = url.split("/")[2] if "//" in url else url
        _throttle(host, min_gap)
        try:
            r = _session.post(url, data=data, timeout=timeout)
            if r.status_code == 200 and "json" in r.headers.get("content-type", ""):
                out = r.json()
                if cache_key:
                    put_cache(cache_key, out)
                return out
        except Exception:
            pass
        time.sleep(3 * (attempt + 1))
    return None
