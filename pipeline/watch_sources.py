#!/usr/bin/env python3
"""
Watch the sources the dataset cites, and report when they change.

    python3 -m pipeline.watch_sources                # check, report
    python3 -m pipeline.watch_sources --update       # check and accept new state
    python3 -m pipeline.watch_sources --check-links  # also report dead links

Some things can be refreshed automatically (see refresh_eia.py). Most cannot:
whether a rate order changed a utility's authorized return, whether a new filing
moves a project from proposed to approved, whether costs sit in rate base or
behind a ring-fence. Reading those correctly took careful human judgment, and a
scraper that guessed would produce exactly the confident-and-wrong output this
project exists to prevent.

So this does the half a machine is good at: it notices that something moved, and
tells a human where to look. It never edits the dataset.

The watch list builds itself from the dataset's own citations, so it grows as
the data grows and never drifts out of sync with what's actually cited.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
from datetime import date

import requests

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")
STATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "watch_state.json")
UA = {"User-Agent": "GridWatch/1.0 (open-source civic grid atlas; source-change monitor)"}

# Boilerplate that changes on every request and would cause false alarms.
NOISE = re.compile(
    r"(csrf|nonce|sessionid|__RequestVerificationToken|timestamp|\d{2}:\d{2}:\d{2}"
    r"|viewstate|_wpnonce|cache[-_]?bust)[^\s\"'<>]*", re.I)

# Content-change monitoring only works on pages that are stable by nature.
# A news article carries rotating headlines, ads and view counts, so its hash
# changes constantly and means nothing — watching those for "change" produces an
# alert nobody reads, which is worse than no alert. For news we watch only
# whether the link still resolves; for primary sources we watch the content.
STABLE_HINTS = (
    ".gov", ".pdf", "iurc.portal", "eia.gov", "census.gov",
    "nipsco.com", "duke-energy.com", "aesindiana.com", "indianamichiganpower.com",
    "centerpointenergy.com", "openstreetmap.org",
)


def is_stable(url: str) -> bool:
    """True when a content hash is a meaningful change signal for this source."""
    u = url.lower()
    return any(h in u for h in STABLE_HINTS)


def collect_targets() -> list[dict]:
    """Every URL the dataset cites, deduped, with what it backs."""
    targets: dict[str, set[str]] = {}

    def add(url: str | None, what: str):
        if not url or not url.startswith("http"):
            return
        targets.setdefault(url, set()).add(what)

    fac = os.path.join(DATA, "facilities.json")
    if os.path.exists(fac):
        with open(fac) as fh:
            for f in json.load(fh).get("facilities", []):
                who = f.get("id", "?")
                for s in f.get("sources", []) or []:
                    add(s.get("url"), f"facility:{who}")
                # a docket portal link is the highest-value thing to watch
                add(f.get("docket_url"), f"docket:{f.get('iurc_docket') or who}")

    bill = os.path.join(DATA, "bill_impact_models.json")
    if os.path.exists(bill):
        with open(bill) as fh:
            b = json.load(fh)
        for u in b.get("utilities", []):
            for s in u.get("sources", []) or []:
                add(s.get("url"), f"utility:{u.get('id')}")
            add((u.get("recent_increase") or {}).get("source", {}).get("url"),
                f"rate-order:{u.get('id')}")

    for name, key in (("action_items.json", "items"), ("dockets.json", "dockets"),
                      ("county_restrictions.json", "counties")):
        p = os.path.join(DATA, name)
        if not os.path.exists(p):
            continue
        with open(p) as fh:
            doc = json.load(fh)
        add(doc.get("portal"), "docket-portal")
        for it in doc.get(key, []) or []:
            add(it.get("url"), f"{name}:{it.get('title') or it.get('name') or '?'}")
            for s in it.get("sources", []) or []:
                add(s.get("url"), f"{name}:{it.get('cause') or it.get('name') or '?'}")

    return [{"url": u, "backs": sorted(w)} for u, w in sorted(targets.items())]


def fingerprint(url: str, timeout: int = 45) -> tuple[str | None, int | None, str | None]:
    """(hash, status, error). Hash ignores per-request boilerplate."""
    try:
        r = requests.get(url, headers=UA, timeout=timeout, allow_redirects=True)
    except Exception as e:
        return None, None, f"{type(e).__name__}: {str(e)[:70]}"
    if r.status_code >= 400:
        return None, r.status_code, None
    body = r.text if "text" in r.headers.get("content-type", "") or not r.content else ""
    if body:
        cleaned = NOISE.sub("", body)
        return hashlib.sha256(cleaned.encode("utf-8", "replace")).hexdigest()[:16], r.status_code, None
    # binary (usually a filing PDF): length is a good enough change signal
    return hashlib.sha256(str(len(r.content)).encode()).hexdigest()[:16], r.status_code, None


def main() -> int:
    ap = argparse.ArgumentParser(description="Report changes in the sources the dataset cites.")
    ap.add_argument("--update", action="store_true", help="accept current state as the new baseline")
    ap.add_argument("--check-links", action="store_true", help="report dead links too")
    ap.add_argument("--limit", type=int, default=0, help="only check the first N (for testing)")
    args = ap.parse_args()

    targets = collect_targets()
    if args.limit:
        targets = targets[: args.limit]

    prev = {}
    if os.path.exists(STATE):
        try:
            with open(STATE) as fh:
                prev = json.load(fh).get("sources", {})
        except Exception:
            prev = {}

    print(f"\n  GridWatch source watch · {date.today()}")
    n_stable = sum(1 for t in targets if is_stable(t["url"]))
    print(f"  {len(targets)} cited sources "
          f"({n_stable} watched for content change, {len(targets)-n_stable} for reachability only)\n"
          + "-" * 66)

    changed, dead, new, errors = [], [], [], []
    state: dict[str, dict] = {}

    for t in targets:
        url = t["url"]
        h, status, err = fingerprint(url)
        state[url] = {"hash": h, "status": status, "backs": t["backs"], "checked": date.today().isoformat()}
        if err:
            errors.append((url, err, t["backs"]))
            # keep the old hash so a transient failure isn't recorded as a change
            if url in prev:
                state[url]["hash"] = prev[url].get("hash")
            continue
        if status and status >= 400:
            dead.append((url, status, t["backs"]))
            continue
        old = prev.get(url, {}).get("hash")
        if old is None:
            new.append((url, t["backs"]))
        elif old != h and is_stable(url):
            changed.append((url, t["backs"]))

    for url, backs in changed:
        print(f"  CHANGED  {url[:78]}")
        print(f"           backs: {', '.join(backs[:3])}{' …' if len(backs) > 3 else ''}")
    if args.check_links:
        for url, status, backs in dead:
            print(f"  DEAD {status} {url[:74]}")
            print(f"           backs: {', '.join(backs[:3])}")
    for url, err, backs in errors:
        print(f"  unreachable {url[:70]}  ({err})")
    if new:
        print(f"  {len(new)} newly watched (no baseline yet)")

    print("-" * 66)
    print(f"  {len(changed)} changed · {len(dead)} dead · {len(errors)} unreachable · {len(new)} new")
    if changed:
        print("\n  A changed source does NOT mean the dataset is wrong — it means a page")
        print("  the dataset relies on has moved. Check whether the underlying fact")
        print("  changed, then update the record and its last_verified date.")

    if args.update or not prev:
        with open(STATE, "w") as fh:
            json.dump({"updated": date.today().isoformat(), "sources": state}, fh, indent=1)
        print(f"\n  baseline written -> {os.path.relpath(STATE, ROOT)}")
    print()
    return 1 if (changed or (args.check_links and dead)) else 0


if __name__ == "__main__":
    sys.exit(main())
