#!/usr/bin/env python3
"""
Report how stale the dataset has gone.

    python3 -m pipeline.check_freshness
    python3 -m pipeline.check_freshness --max-age 120 --strict

A dataset like this doesn't break when it goes out of date — it keeps looking
authoritative while quietly being wrong. Run this in CI (on a schedule) so
staleness shows up as a failing check instead of a surprise.

Exit codes: 0 fine, 1 stale (only with --strict), 2 the files couldn't be read.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA = os.path.join(ROOT, "public", "data")

AGING_DAYS = 60
STALE_DAYS = 180


def _age(datestr: str | None, today: date) -> int | None:
    if not datestr:
        return None
    try:
        return (today - datetime.strptime(str(datestr)[:10], "%Y-%m-%d").date()).days
    except ValueError:
        return None


def main() -> int:
    ap = argparse.ArgumentParser(description="Check GridWatch data freshness.")
    ap.add_argument("--data-dir", default=DATA)
    ap.add_argument("--max-age", type=int, default=STALE_DAYS,
                    help=f"days before the dataset counts as stale (default {STALE_DAYS})")
    ap.add_argument("--strict", action="store_true", help="exit 1 when stale (for CI)")
    args = ap.parse_args()

    today = date.today()
    try:
        with open(os.path.join(args.data_dir, "meta.json")) as fh:
            meta = json.load(fh)
        with open(os.path.join(args.data_dir, "facilities.json")) as fh:
            facs = json.load(fh).get("facilities", [])
    except Exception as e:
        print(f"  ERROR  could not read data: {e}")
        return 2

    ds_age = _age(meta.get("last_updated"), today)
    print(f"\n  GridWatch freshness · {today}")
    print("-" * 52)

    if ds_age is None:
        print("  DATASET   no readable last_updated date")
        level = "stale"
    else:
        level = "stale" if ds_age >= args.max_age else "aging" if ds_age >= AGING_DAYS else "fresh"
        print(f"  DATASET   {meta.get('last_updated')}  ({ds_age} days · {level.upper()})")

    # per-record verification age
    unverified = [f for f in facs if not f.get("last_verified")]
    aged = []
    for f in facs:
        a = _age(f.get("last_verified"), today)
        if a is not None and a >= args.max_age:
            aged.append((a, f.get("id", "?")))
    aged.sort(reverse=True)

    print(f"  RECORDS   {len(facs)} total · {len(unverified)} never verified · "
          f"{len(aged)} not re-checked in {args.max_age}d")

    for a, fid in aged[:10]:
        print(f"     {a:5}d  {fid}")
    if len(aged) > 10:
        print(f"     … and {len(aged) - 10} more")
    for f in unverified[:5]:
        print(f"     never  {f.get('id','?')}")

    print("-" * 52)
    if level == "stale":
        print("  STALE — refresh the dataset, or publish the caveat prominently.")
        print("  The app already shows a staleness banner to visitors.\n")
        return 1 if args.strict else 0
    if level == "aging":
        print("  Aging — worth a pass through recent filings soon.\n")
        return 0
    print("  Fresh.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
