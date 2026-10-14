# GridWatch Indiana

**An interactive atlas of every tracked data-center project in Indiana, drawn against the state's
power grid, with every figure linked to the public document it came from. The engine re-points to
any region.**

![The GridWatch Indiana console with the Amazon (AWS) New Carlisle campus selected: a 2,250 MW filed capacity, a developer-redacted water figure, IURC Cause 46301, local impact figures, the status, size, and utility filters on the left, and the 2020 to 2035 build-out timeline along the bottom](docs/screenshot.png)

Indiana is deciding, docket by docket, how much new load its grid will take on for data centers.
The facts exist. They are scattered across IURC filings, utility resource plans, county rezoning
minutes, and local reporting, so a resident cannot easily answer three plain questions: what is
being built near me, how much power will it draw, and will it raise my bill? GridWatch treats that
as a sourcing problem. Every record carries a link, an unknown figure stays empty instead of being
guessed, and a redacted figure is shown as redacted.

Live: **https://gridwatch-indiana.vercel.app**

```
hand-curated facilities (IURC, utility filings, county records, reporting; cited per record)
  + WRI power plants, HIFLD transmission and territories, Census counties and ZIPs
    ->  pipeline/: fetch, simplify, validate (no facility ships without a source)
    ->  build_dataset.py: statewide roll-ups into meta.json (sums and counts only)
    ->  static JSON and GeoJSON in public/data
    ->  MapLibre console: map, filters, timeline, dossiers, bill and area tools
    ->  monthly jobs: EIA-861 refresh, cited-source watch, freshness check
```

If you can't cite it, don't add it.

## The core idea

1. **Sourcing is the product.** Each facility needs at least one working source link, and the
   validator fails the build without one. A missing figure is `null`, never zero or a typical
   value. `water_status` separates `known`, `unknown`, and `redacted`, because a developer
   withholding water use in a public filing is itself a fact.
2. **Precision is labeled, not implied.** `geo_precision` says whether a pin is a site, a city
   centroid, or a county centroid. `mw_estimated` marks capacity taken from reporting rather than
   a filing. Withdrawn projects stay on the map as faint rings, because hiding them would flatter
   the picture.
3. **Projections say they are projections.** The timeline ramps each project toward an estimated
   energization year. The bill tool is an illustrative even split with a stated band, not a
   forecast of anyone's bill.
4. **Machines do the mechanical part, people do the judgment.** A scheduled job refreshes the
   few utility figures that come from a structured federal source. Anything that needs reading a
   filing is flagged for a human and never edited by a script.
5. **Indiana is one region, not the product.** One command maps any region on Earth from
   OpenStreetMap and re-tunes units, currency, terminology, and the color scale. The civic files a
   script cannot know (rates, dockets, hearings) start empty, so a fork never shows Indiana's
   numbers under another region's name.

## What it shows (Indiana dataset, last updated 2026-07-22)

| Measure | Value |
|---|---|
| Tracked data-center projects | **76** across 32 counties |
| By status | 23 proposed, 10 rumored, 4 approved, 9 under construction, 16 operational, 14 withdrawn |
| Load at full build-out, everything not withdrawn | **15,142 MW**, **43.3%** of an approximate 35,000 MW state peak |
| Committed load (approved, under construction, operational) | 7,870 MW |
| Withdrawn proposals | 3,380 MW |
| Largest single project | Amazon (AWS) New Carlisle, 2,250 MW |
| Existing generating capacity in the plant database | 45,679 MW: 60.6% coal, 30.8% gas |
| Grid layers | 205 power plants, 1,237 transmission segments at 138 kV and above, 114 utility territories |
| Sourcing | 103 source links across the 76 records |
| Statewide bill context | average residential bills up 17% this year (cited to the Indiana Capital Chronicle) |

Every number above is a sum or count over `public/data/` computed by
`pipeline/build_dataset.py`, and a CI job fails if `meta.json` drifts from the committed data.

What a visitor can do:

* **Map the fleet.** Each project is a node sized by megawatts and colored by load band, over
  power plants, high-voltage transmission, utility territories, and county ban and moratorium
  layers, masked to the state border.
* **Filter and search.** By status, size tier, and serving utility, with a live count. Search a
  county or facility to fly to it.
* **Scrub 2020 to 2035.** The timeline animates the build-out, counting each project as pipeline
  until its projected energization year and as online after.
* **Open a dossier.** Capacity by phase, water use, acreage, investment, developer, utility, IURC
  cause number, local impact (jobs, backup diesel generators, wetland acres where filed), and the
  source for each figure.
* **Check my area.** Enter a ZIP code or pick a county to see the serving utility, the projects
  in that county, any local restriction, and a bill projection for your monthly usage.
* **Write your official.** A prefilled public comment to the county plan commission and the
  Indiana Office of Utility Consumer Counselor, ready to copy or open in an email app.
* **Follow the process.** How to file an IURC comment, the active dockets, and where hearings
  are. It shows the process, not a position.
* **Take the data.** Export every facility record as CSV.

## How it works

**Data.** `public/data/facilities.json` is curated by hand from IURC filings, utility filings,
county records, the AI Law Tracker inventory, Citizens Action Coalition analysis, and reporting.
Each record has capacity (phase 1 and full), water, acreage, investment, utility, IURC cause,
announced and estimated online year, notes, sources, and a `last_verified` date. Power plants come
from the WRI Global Power Plant Database v1.3.0, transmission and utility territories from HIFLD,
counties from Census boundaries, and ZIP centroids from the Census ZCTA gazetteer.

**Pipeline.** `fetch_geo.py` pages and simplifies the ArcGIS layers into small static files using
only the Python standard library, and a dead source becomes an empty layer, not a crash.
`build_dataset.py` derives `meta.json`. `validate.py` checks schema and, with `--links`, that
every source URL resolves. `validate_input.py` checks a facilities file before publishing:
required fields, a source on every record, unique ids, coordinates in range, a known status, and
optionally that each county name matches the subdivision its coordinates fall in.

**Bill model.** For a chosen utility and monthly kWh, the current bill is usage times rate, and
the data-center share is the sum of filed data-center infrastructure costs, divided by the
utility's customers, amortized over 5 years, with a plus or minus 45% band. It sits next to the
utility's cited recent rate change for context. The utility serving a county is found with a
point-in-polygon test of the county centroid against HIFLD territories.

**Front end.** Vite and TypeScript, MapLibre GL JS v5 on a keyless CARTO dark-matter basemap, D3
for scales, hand-written CSS tokens. The build is static with a relative base, so it runs on
Vercel, Netlify, or GitHub Pages from any path.

**Maintenance.** Four GitHub Actions workflows keep the data honest:

* `maintain.yml` runs on the 3rd of each month. Tier 1 downloads EIA Form 861 and updates only
  three allowlisted utility fields (residential customers, residential revenue share, EIA average
  rate). Any change over 25% is held back and opened as a review issue instead. The job then
  re-runs validation and the pipeline tests before committing. Tier 2 checks every cited source
  for changes or dead links and opens a review issue; it never edits the dataset.
* `freshness.yml` runs on the 1st of each month and opens a "Dataset refresh due" issue once the
  data is older than 180 days. The app shows visitors a staleness banner on the same schedule.
* `test.yml` typechecks, runs the TypeScript and pipeline tests, builds, and validates the shipped
  dataset on pushes to `main` and on pull requests. `validate.yml` rebuilds the roll-ups and
  fails if `meta.json` is out of date.

**Requests and sign-ups.** A "Bring GridWatch to your state" form asks for a name, email, and
state or region, plus an optional role and note, and posts them to the maintainer through the
FormSubmit relay. A newsletter box posts an email address the same way. Optional analytics
(PostHog, Meta Pixel, a GTM data layer) load only when the matching `VITE_` variables are set at
build time. The GitHub Pages build reads them from repository variables, so a fork reports to its
own project or to none.

**Any region.** `npm run region -- --region "<name>"` resolves the outline and subdivisions from
OpenStreetMap, pulls generation, transmission, substations, and tagged data centers through
Overpass, adds PeeringDB colocation sites, de-duplicates, and writes a self-contained
folder under `regions/`. Every auto-discovered site is marked `rumored` with no megawatt figure
until someone sources it. `prompts/` holds four research prompts (facilities, utilities and
bills, civic process, an adversarial audit) that require a citation for every figure and leave
unknowns null. `pipeline/reconcile.py` compares the dataset with another tracker and reports
matches, conflicts, and records only one side has, without merging anything.

## Run it

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # production build into dist/
npm run preview      # serve the build on port 4173
npm run test:all     # typecheck, TypeScript tests, pipeline tests
```

Rebuild and check the data:

```bash
python3 pipeline/fetch_geo.py          # counties, plants, transmission, territories
python3 pipeline/build_dataset.py      # recompute meta.json
python3 pipeline/validate.py --links   # schema and source-link checks
npm run freshness                      # dataset age
npm run refresh                        # EIA-861 dry run (add -- --write to apply)
npm run watch                          # report changed or dead cited sources
```

Map another region:

```bash
npm run region -- --region "Ohio, United States" --activate
npm run validate -- my-facilities.json   # enforce the sourcing rule on your records
npm run dev
```

`vercel.json` and `netlify.toml` are included, and `.github/workflows/deploy.yml` publishes to
GitHub Pages on every push to `main`. See `FORKING.md` for the full guide.

## Layout

```
public/data/          facilities, dockets, bill models, county restrictions, timeline, meta, GeoJSON layers
pipeline/
  fetch_geo.py        base geodata (stdlib only)
  build_dataset.py    statewide roll-ups into meta.json
  validate.py         schema and link checks
  validate_input.py   pre-publish checks for a facilities file
  bootstrap.py        one-command region build
  scaffold.py         empty civic files for a new region
  providers/          OSM boundary, power, and data centers; Overpass; PeeringDB
  refresh_eia.py      EIA-861 refresh with allowlist and change guard
  watch_sources.py    detect changed or dead cited sources
  check_freshness.py  dataset age
  reconcile.py        compare with an external tracker
  fetch_zips.py       Census ZCTA centroids for the ZIP lookup
  tests/              geo and input-validation tests
src/
  main.ts             boot and app wiring
  lib/                map, controls, timeline, card, modals, theme, freshness, analytics, sign-up
  lib/__tests__/      format, theme, freshness, utility lookup
regions/              bootstrapped examples: ohio-united-states, virginia-united-states, indiana-pdb
prompts/              research prompts for building a region's dataset
templates/            facilities template
.github/workflows/    deploy, test, validate, maintain, freshness
docs/                 screenshots
METHODOLOGY.md        how each figure is sourced and derived
FORKING.md            guide to building a GridWatch for another region
```

## Honesty

* Facility curation is manual. The AI Law Tracker lists about 46 Indiana projects and other
  trackers count 90 or more; this file holds the 76 with a locatable site and at least one
  verifiable attribute, including 10 rumored proposals that are reported but unconfirmed.
* 15,142 MW is the full build-out of every project not withdrawn, rumored ones included. It is
  not current draw, and the 35,000 MW peak it is compared against is approximate.
* No pin is parcel-precise: 24 records are placed at a known site, 49 at a city centroid, and 3
  at a county centroid.
* Water use is known for 1 of 76 records, redacted for 2, and unknown for the rest. Only 4
  records carry an IURC cause number, and 9 use reported rather than filed capacity.
* Data vintages differ. Plant capacity is about 2021, transmission and territories about 2024.
  The Indiana substations layer is empty because HIFLD's hosted service was unavailable at build
  time.
* The bill figure spreads filed costs evenly over every customer. Real allocation is decided in
  contested rate cases. It is not a forecast and not financial advice.
* The validator checks structure. It cannot check whether a number is true.
* The Ohio and Virginia folders are auto-discovered examples: every facility is `rumored` with no
  megawatt figure, and the Virginia subdivision pull failed and is recorded as such.
* Form submissions go to a third-party relay, and analytics run when the deploy enables them.

Code is MIT licensed (`LICENSE`). The compiled data in `public/data` is CC BY 4.0
(`DATA-LICENSE.md`); source documents remain their publishers'.
