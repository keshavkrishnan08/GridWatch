---
name: gridwatch-region
description: Research and build a GridWatch dataset for a region — data centers, bill models, and civic process — with every figure sourced. Use when setting up GridWatch for a new state, country, or region, or refreshing an existing one.
---

# Build a GridWatch region

Research a region's data centers and grid context, and write them into the
files the atlas reads. The map layers come from the bootstrap; your job is the
part that needs judgment and sources.

## The rule this skill exists to enforce

**If you cannot cite it, do not state it.**

This dataset is read by journalists, regulators, and residents. One invented
figure discredits all of it. Concretely:

- Every facility carries at least one real source URL.
- Anything you cannot find in a document is `null` — never `0`, never a
  "typical" value, never an average of conflicting reports.
- A figure from reporting rather than a filing gets `mw_estimated: true`.
- If you're not confident a project exists, leave it out and list it as
  uncertain instead.

Ten sourced facilities beat fifty guesses. Report what you couldn't find.

## Steps

### 1. Map the region (no research needed)

```bash
python3 -m pipeline.bootstrap --region "<REGION>" --activate
```

This resolves the outline, subdivisions, power plants, transmission, and
substations, and writes a fitting `theme.json` (units, currency, terminology).
Roads and cities come from the basemap.

If activating over an existing region, it will ask for `--force` and back up
what's there.

### 2. Research the facilities

Follow `prompts/01-facilities.md` in this repo — it contains the full schema
and field rules. Use web search. Prefer, in order: regulator filings, local
government records (rezoning, planning minutes), utility resource plans,
company announcements, local/trade press, industry trackers.

Work in batches and tell the user what you covered.

Write to `public/data/facilities.json`, then:

```bash
npm run validate -- public/data/facilities.json --subdivisions public/data/subdivisions.geojson
```

Fix anything it flags before continuing.

### 3. Bill model and civic process

`prompts/02-utilities-and-bills.md` → `bill_impact_models.json`
`prompts/03-civic-process.md` → `action_items.json`, `dockets.json`,
`county_restrictions.json`, and the `terminology` block of `theme.json`

Leave these empty rather than approximating. The app reports "not configured
for this region" honestly; it never falls back to another region's numbers.

Keep utility `id` values consistent between `theme.json` and
`bill_impact_models.json`, or the map filter and the calculator won't line up.

### 4. Audit before publishing

Run `prompts/04-audit.md` against the finished dataset — ideally in a fresh
session, since authors don't catch their own fabrications. Prioritize checking
that source URLs resolve and actually say what the record claims.

Then:

```bash
npm run validate -- public/data/facilities.json
npm run freshness
npm run test:all
```

## Notes

- `county` fields take the bare name (`Boone`, not `Boone County`) — the app
  adds the noun from `theme.json`.
- Restriction names must match subdivision names exactly or the overlay won't
  render.
- Set `last_verified` to the date you checked the sources, not the document's
  publication date.
- Auto-discovered records (from the OSM sweep) are leads, not facts: they stay
  `status: "rumored"` with null capacity until a human verifies them.

## What to tell the user at the end

- What you searched and what you likely missed.
- Which records they should verify by hand before publishing.
- Anything time-sensitive that will be stale within months.

Be blunt about gaps. A visibly incomplete dataset is fine; a confidently wrong
one is not.
