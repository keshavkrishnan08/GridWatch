# Forking GridWatch for your state, country, or region

GridWatch ships pointed at Indiana, but the map engine is region-agnostic. The
basemap (CARTO dark-matter) renders roads, water, and building footprints for
anywhere on Earth, and the atlas frames itself from whatever boundary you give
it. Re-pointing it is mostly swapping data files and editing one config.

Here's the whole job.

## What you swap

1. **A boundary polygon** — one GeoJSON file for your region's outline. This
   drives the spotlight mask (everything outside is dimmed) and the camera. The
   map's zoom and framing are derived from this file's bounding box, so you
   don't hand-tune coordinates.

2. **A subdivisions layer** — GeoJSON of the clickable pieces inside your
   region: US counties, UK councils, German Kreise, whatever fits. Each feature
   needs a name property (see `subdivision_key` below).

3. **Your facility data** — `public/data/facilities.json`, same schema as the
   Indiana file. Every record carries its own sources; nothing is invented.

4. **`public/data/region.json`** — the config that ties it together.

## region.json

```json
{
  "name": "GridWatch Ohio",
  "region_label": "OHIO",
  "tagline": "DATA CENTER ATLAS",
  "boundary_file": "ohio.geojson",
  "subdivisions_file": "ohio_counties.geojson",
  "subdivision_key": "county",
  "subdivision_singular": "county",
  "home_center": null,
  "home_zoom_boost": 0.42,
  "min_zoom": 3.5,
  "max_zoom": 16
}
```

- `name` sets the browser-tab title; `region_label` and `tagline` set the
  header. Change these and the whole app re-brands — no code edits.
- `boundary_file` / `subdivisions_file` are paths under `public/data/`.
- `subdivision_key` is the property on each subdivision feature that holds its
  name (Indiana uses `"county"`). Match it to your GeoJSON's properties.
- `home_center` — leave `null` to auto-center on the boundary's bounding box,
  or set `[lng, lat]` to nudge the framing (Indiana offsets slightly so the
  state sits clear of the filter panel).
- `home_zoom_boost` tightens the fit; `min_zoom` / `max_zoom` cap the range.

## Steps

1. Drop your boundary and subdivisions GeoJSON into `public/data/`.
2. Edit `public/data/region.json` to point at them and set the labels.
3. Replace `public/data/facilities.json` with your region's projects.
4. `npm install && npm run dev` — the map frames your region, renders its roads,
   and clips the spotlight to your outline automatically.

That's the map. Roads and shapes "just work" because they come from the global
basemap, not from your data.

## Region-specific content to review

Some copy is Indiana civic context, not map logic. Edit these for a faithful
fork:

- `public/data/bill_impact_models.json` — your utilities, rates, and dockets.
- `public/data/action_items.json` and `dockets.json` — your public-comment
  process, regulators, and hearings.
- `public/data/county_restrictions.json` — local bans/moratoriums.
- `public/data/meta.json` — headline stats and generation mix.
- The action links and letter template in `src/lib/card.ts`, `src/lib/main.ts`,
  and `src/lib/modals.ts` reference Indiana's OUCC/IURC. Point them at your own
  regulators.

## Analytics (optional)

Set `VITE_META_PIXEL_ID` and/or `VITE_POSTHOG_KEY` in `.env.local` to turn on
conversion tracking. Off by default — nothing is sent until you configure it.

## Building the geo layers

`pipeline/fetch_geo.py` pulls US grid, plant, and territory data (HIFLD, EIA,
Census) and dissolves a state boundary from its counties. For a US state, point
it at your FIPS code. For other countries, supply your own boundary and
subdivisions GeoJSON directly — the app only needs the files, not the pipeline.
