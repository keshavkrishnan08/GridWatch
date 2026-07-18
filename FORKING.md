# Fork GridWatch for your state, country, or region

GridWatch ships pointed at Indiana, but nothing about the engine is
Indiana-specific. One command pulls a whole region from public data and writes a
ready-to-serve atlas:

```bash
python3 -m pipeline.bootstrap --region "Ohio, United States" --activate
npm run dev
```

That's it. You get the region's outline, its counties (or départements, or
municípios), its power plants, transmission lines, substations, and every data
center currently mapped in OpenStreetMap — de-duplicated, framed, and rendered.

Roads, cities, water, and building footprints come from the global basemap at
render time, so they already work everywhere. You never fetch or configure them.

## Try it

```bash
python3 -m pipeline.bootstrap --region "Ireland"
python3 -m pipeline.bootstrap --region "Bavaria, Germany"
python3 -m pipeline.bootstrap --region "Virginia, United States" --activate
```

Each run writes a self-contained folder under `regions/<slug>/`. Nothing is
overwritten until you pass `--activate`, and activating over a *different*
region requires `--force` (a backup is written either way).

## What it pulls, and from where

| Layer | Source | Global? |
|---|---|---|
| Region outline | OSM / Nominatim | yes |
| Subdivisions | OSM admin boundaries | yes |
| Data centers | OSM (`telecom`/`building`/`man_made=data_center`) + name sweep | yes |
| Power plants | OSM `power=plant` (with fuel + capacity where tagged) | yes |
| Transmission | OSM `power=line` | yes |
| Substations | OSM `power=substation` | yes |
| Roads · cities · water | CARTO basemap, at render time | yes |

No API keys. No accounts.

## The honest part: what auto-discovery can and can't do

**It finds sites, not filings.** OpenStreetMap knows where many data centers
are. It does not know megawatts, water use, project stage, or who's paying for
the grid upgrades. So every auto-discovered record is written as:

- `status: "rumored"` — a lead, not a confirmed project
- `mw`, `water`, `investment`: `null` — never guessed
- `_auto: true`, with its OSM object linked as the source

The app shows these with a **CHATTER** banner. That's deliberate: this project's
one rule is that no number is ever invented, and an auto-pull must not be able
to launder a guess into a fact.

**It is a starting inventory, not a complete one.** Unannounced, private, and
brand-new sites aren't in OSM. Your region almost certainly has more than the
pull finds. Treat the output as the scaffold you then enrich with filings and
reporting — which is exactly how the Indiana dataset was built.

**Failures are loud.** If a source is unreachable, the provider reports `FAIL`
and writes nothing, rather than emitting an empty file that would read as "no
data centers here."

## Merging your curated research

Auto-discovery gets you started; hand-verified records make it authoritative.

```bash
python3 -m pipeline.bootstrap --region "Ohio, United States" \
  --merge-curated my_research.json --activate
```

Curated records win every conflict, and de-duplication merges them with the
auto-discovered site describing the same place (name similarity + proximity), so
one facility never appears twice. Each merge records what it absorbed in
`_merged_from`, so the provenance stays auditable.

## What you still have to localize

Some things are civic facts the pull can't invent. The bootstrap writes them
**empty**, with a `_todo` note, so the app shows nothing rather than another
region's figures:

- `bill_impact_models.json` — your utilities, rates, customer counts, filed cost-shifts
- `action_items.json`, `dockets.json` — your regulator, comment process, hearings
- `county_restrictions.json` — local bans and moratoriums
- `meta.json` → `state_peak_mw` — published by your grid operator

`meta.json` is otherwise **computed** from what was actually fetched (generation
mix, plant counts, load totals), so it's accurate on day one.

The letter template and civic links in `src/lib/card.ts`, `src/lib/main.ts`, and
`src/lib/modals.ts` reference Indiana's OUCC/IURC — point those at your own
regulator.

## Configuration

`public/data/region.json` (generated, and editable by hand):

```json
{
  "name": "GridWatch Ohio",
  "region_label": "OHIO",
  "boundary_file": "boundary.geojson",
  "subdivisions_file": "subdivisions.geojson",
  "subdivision_key": "county",
  "home_center": null,
  "home_zoom_boost": 0.42
}
```

- `name` / `region_label` re-brand the tab and header — no code edits.
- `subdivision_key` is the property holding each subdivision's name.
- `home_center: null` auto-frames from the boundary's bounding box.

Useful flags:

| Flag | What it does |
|---|---|
| `--label`, `--name` | override the header text and title |
| `--subdivision-level N` | force an OSM `admin_level` if the default picks wrong |
| `--subdivision-key` | rename `county` to `province`, `council`, … |
| `--providers ...` | run a subset, e.g. `--providers osm_power_plants` |
| `--merge-curated FILE` | merge your researched facilities |
| `--activate` / `--force` | publish into `public/data/` |

## Adding a source

Providers are independent and registered in one list. Write a class with `key`,
`outputs`, and `run(ctx)` (see `pipeline/providers/base.py`), add it to
`DEFAULT_CHAIN` in `pipeline/providers/__init__.py`, and it joins the pipeline.
A national regulator's API, a state ArcGIS server, or your own CSV all plug in
the same way — the core never changes.

## Analytics (optional, off by default)

Set `VITE_META_PIXEL_ID` and/or `VITE_POSTHOG_KEY` in `.env.local`. Nothing is
sent until you do.
