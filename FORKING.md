# Build a GridWatch for anywhere in the world

GridWatch is a **toolkit**, not one state's map. Indiana is the reference
implementation; the engine underneath is region-agnostic.

You bring a region name and your own facility data. The toolkit brings the map,
the rendering, the color science, the civic-action tooling, and the honesty
guardrails.

```bash
npm run region -- --region "Bavaria, Germany" --activate
npm run dev
```

Two things happen automatically: the region is mapped (outline, subdivisions,
grid infrastructure), and the whole atlas re-tunes to it (units, currency,
terminology, color scale). Roads, cities, water, and building footprints come
from the global basemap at render time — they already work everywhere and need
no configuration at all.

---

## What the toolkit gives you

**Region mapping.** Name any region on Earth. The outline, its subdivisions
(counties, départements, Kreise, municípios — whatever that country uses), and
the grid around it resolve from OpenStreetMap. The camera frames itself from the
boundary; the spotlight mask clips to it.

**Color + scale science.** Load severity is a configurable band scale. Set
`scale_mode: "auto"` and the bands re-derive from *your* data's distribution, so
colors stay meaningful whether you're mapping one county or an entire country.
Fuel palette, utility colors, and the undisclosed-capacity color are all config.

**Units and language that fit.** A German fork reads hectares, m³/day, €, and
"Kreise". A US fork reads acres, MGD, $, and "counties". The bootstrap infers
this from the region and writes it into `theme.json`.

**Civic tooling.** The letter generator, "check my area" exposure report, bill
calculator, filters, timeline, and share/analytics layer all come along, wired
to your region's regulator once you name it.

**Honesty guardrails.** Missing data renders as "not configured" rather than
another region's numbers; unverified records are visibly flagged; a failed
fetch reports failure instead of writing an empty file.

---

## The three files you control

### 1. `region.json` — what and where

```json
{
  "name": "GridWatch Bavaria",
  "region_label": "BAVARIA",
  "boundary_file": "boundary.geojson",
  "subdivisions_file": "subdivisions.geojson",
  "subdivision_key": "county",
  "home_center": null
}
```

`home_center: null` auto-frames from the boundary. Generated for you, editable
by hand.

### 2. `theme.json` — how it looks and reads

```json
{
  "scale_mode": "auto",
  "bands": [
    { "key": "low",  "label": "Small",  "max": 50,   "color": "#3FB950" },
    { "key": "mega", "label": "Mega",   "max": null, "color": "#FF6BFF" }
  ],
  "utilities": [
    { "id": "eon", "display": "E.ON Bayern", "color": "#4E7BE8", "match": ["e.on", "eon"] }
  ],
  "units":       { "system": "metric", "currency": { "code": "EUR", "symbol": "€" }, "water": "m3d" },
  "terminology": { "subdivision": "Kreis", "subdivision_plural": "Kreise", "regulator": "BNetzA" },
  "jobs":        { "datacenter": 0.26, "comparison": null }
}
```

Change a band color and the nodes, legend, filter chips, and card accents all
follow. Add a utility and it appears in the filter dropdown, the territory
colors, and every card. Nothing in the code needs editing.

### 3. `facilities.json` — your data

Start from [`templates/facilities.template.json`](templates/facilities.template.json),
which documents every field. Only `id`, `name`, `lat`, `lng`, `status`, and
`sources` are required — leave anything you can't source as `null`.

```bash
npm run validate -- my_region/facilities.json --subdivisions public/data/subdivisions.geojson
```

The validator enforces the project's core rule: **every facility carries at
least one source.** It also catches duplicate ids, bad coordinates, unknown
statuses, and phase capacity exceeding full capacity.

---

## Optional: auto-discovery

The bootstrap can also sweep OpenStreetMap for data centers already mapped in
your region, as a starting point:

```bash
npm run region -- --region "Ohio, United States"
# 88 counties · 293 plants · 11,095 transmission segments · 43 sites found
```

Be clear-eyed about what this is. OSM knows *where* some data centers are; it
does not know megawatts, water use, or project stage, and it misses
unannounced and brand-new sites. So every auto-discovered record is written
`status: "rumored"` with null capacity and its OSM object cited, and the app
shows it behind a **CHATTER** banner. It's a lead list to verify, never a
finished dataset.

Merge your researched records over it — curated always wins, and de-duplication
(proximity + name similarity) means one site never appears twice:

```bash
npm run region -- --region "Ohio, United States" --merge-curated my_research.json --activate
```

---

## What stays empty until you fill it

Civic facts can't be inferred. The bootstrap writes these **empty**, each with a
`_todo`, so the app shows nothing rather than something false:

- `bill_impact_models.json` — your utilities, rates, filed cost-shifts
- `action_items.json`, `dockets.json` — your regulator, comment process, hearings
- `county_restrictions.json` — local bans and moratoriums
- `meta.json → state_peak_mw` — published by your grid operator

Everything else in `meta.json` (generation mix, plant counts, load totals) is
**computed** from what was actually fetched, so it's accurate on day one.

---

## Flags

| Flag | What it does |
|---|---|
| `--region` | any region name, e.g. `"Ireland"`, `"Bavaria, Germany"` |
| `--label`, `--name` | override header text and title |
| `--subdivision-key` | rename `county` to `kreis`, `council`, … |
| `--subdivision-level N` | force an OSM `admin_level` if the default picks wrong |
| `--providers ...` | run a subset, e.g. `--providers osm_power_plants` |
| `--merge-curated FILE` | merge your researched facilities |
| `--activate` / `--force` | publish into `public/data/` (backs up first) |

## Adding a data source

Providers are independent modules behind a small protocol. Write a class with
`key`, `outputs`, and `run(ctx)` (see `pipeline/providers/base.py`), register it
in `pipeline/providers/__init__.py`, and it joins the pipeline. A national
regulator's API, a government ArcGIS server, or your own CSV all plug in the
same way — the core never changes.

## Analytics (optional, off by default)

Set `VITE_META_PIXEL_ID` and/or `VITE_POSTHOG_KEY` in `.env.local`. Nothing is
sent until you do.
