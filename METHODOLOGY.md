# Methodology

This document explains exactly how GridWatch Indiana sources every number, what's verified versus estimated, and how the derived figures (the timeline, the bill projection) are built. The goal is simple: a reporter or a regulator should be able to check any claim on the map against a public document.

## The one rule

**AI does not invent numbers.** Every megawatt figure, cost, and docket reference is read from a public filing, a utility document, a county record, or news reporting, and stored with a link to that source. Where a figure is genuinely unknown or redacted, the data says so — it is never filled in with a guess dressed up as fact.

## Data provenance

| Dataset | File | Source | Vintage |
|---------|------|--------|---------|
| Data-center facilities | `facilities.json` | IURC filings, utility filings, county records, [AI Law Tracker](https://ailawtracker.org/data-centers), [Citizens Action Coalition](https://www.citact.org/ai-data-centers), news reporting | Verified 2026-07-16 |
| Power plants | `power_plants.geojson` | WRI Global Power Plant Database v1.3.0 | ~2021 |
| Transmission lines (≥138 kV) | `transmission.geojson` | HIFLD Electric Power Transmission Lines | 2024 vintage |
| Utility territories | `utility_territories.geojson` | HIFLD Electric Retail Service Territories | 2024 vintage |
| County boundaries | `counties.geojson` | US Census cartographic boundaries | current |
| IURC dockets | `dockets.json` | IURC docket portal + CAC analysis | 2026-07-16 |

The pipeline that fetches the geospatial layers is fully reproducible — see [`pipeline/`](pipeline/). The facility curation is done by hand, because reading filings and extracting figures with their sources is the credibility core of the project.

## The facility record

Each facility in `facilities.json` carries these fields, and here's where each comes from:

- **`mw_phase1` / `mw_full`** — filed or reported capacity. When a project has a phased build (e.g., Google Monrovia at 390 MW phase 1, up to 1,200 MW full), both are recorded. `mw_estimated: true` marks a figure taken from reporting rather than a filed number.
- **`water_mgd` / `water_status`** — water use in millions of gallons per day. Utilities and developers frequently redact this. `water_status` is one of `known`, `redacted`, or `unknown`, and the facility card renders the distinction rather than hiding it.
- **`utility`** — the serving utility per filings.
- **`iurc_docket`** — the IURC "Cause" number. Search it at [iurc.portal.in.gov](https://iurc.portal.in.gov/) to read the underlying filings.
- **`acres`, `investment_usd`, `tax_note`** — from county records, developer announcements, and filings.
- **`sources`** — one or more labeled links. Every facility has at least one.
- **`last_verified`** — the date a human last checked the record.

### Coordinate precision

Not every site has a released parcel. The `geo_precision` field is honest about this:

- `parcel` — mapped to the actual parcel outline
- `site` — approximate site location is known
- `city` — placed at the city/town centroid
- `county` — only the county is known; placed at county centroid

The facility card shows this label (e.g., "approx. site") so nobody mistakes a city-centroid pin for a surveyed location.

### Status vocabulary

`proposed`, `approved`, `construction`, `operational`, `rumored`, `withdrawn`. Withdrawn projects are kept and shown as faint "ghost" rings — they tell an important part of the story (community opposition has already stopped ~2,880 MW of proposals), and hiding them would flatter the picture.

## Derived figures

Two features are projections, not measurements. Both are labeled as such in the interface.

### The timeline (2020–2035)

The scrubber animates build-out using each facility's `announced_year` and an **estimated** `online_year` (projected energization). As you scrub to a given year, a facility ramps from 0 to its planned megawatts, and its load counts as "pipeline" until its projected energization year, then "online." Because energization years are estimates, the timeline is explicitly a projection of *shape and scale*, not a schedule. The statewide "share of state peak" uses an approximate Indiana summer peak of ~35,000 MW as an order-of-magnitude reference.

### The bill-impact projection

This is the feature most likely to be misread, so here's the whole model. For a chosen utility and monthly kWh:

```
monthly_base       = kwh × avg_residential_rate
approved_increase  = monthly_base × approved_rate_change_%
infra_share        = Σ(filed data-center infrastructure costs) ÷ utility_customers ÷ 5 years ÷ 12
projected_added    = approved_increase + infra_share   (± 45% uncertainty band)
```

Two honest simplifications live in there:

1. **Even split.** Real cost allocation depends on rate-case outcomes and is contested. Spreading a filed cost evenly across all of a utility's customers is an *illustration* of scale, not a prediction of your specific bill.
2. **Approximate rates.** Average residential rates are utility-level approximations for mid-2026.

The approved-increase figures are cited (e.g., AES Indiana's 3.7% two-phase increase; NIPSCO's ~20% revenue increase). The cost-shift figures come from IURC filings and CAC analysis (e.g., $216M in Duke network upgrades tied to Meta Jeffersonville, Cause 45647; >$400M in I&M interconnection, Cause 46301). It's a civic-orientation tool. **It is not a forecast of your bill and not financial advice.**

## Utility lookup

The "which utility serves my county" answer uses a ray-casting point-in-polygon test against the real HIFLD retail service territories, preferring the investor-owned utility when a centroid falls in overlapping footprints. Service territories don't follow county lines, so this is the utility serving the county *centroid* — a good approximation for orientation, not a guarantee for a specific address.

## Known limitations

- **Facility coverage.** 27 of the 46 tracked projects are curated in detail here (the ones with a locatable site and at least one verifiable attribute). Aggregate counts reference the AI Law Tracker inventory.
- **Data vintages differ.** Power-plant capacity is ~2021; transmission and territories are ~2024; facilities are current to the `last_verified` dates. Each is labeled.
- **Substations** were unavailable from HIFLD's hosted service at build time, so that layer is intentionally empty rather than faked.
- **Redactions are everywhere.** Where utilities redact, GridWatch shows the redaction as a feature — it's exactly what residents aren't being told.

## Corrections

Found an error, or a filing that's moved? That's the point of keeping the data open. Open a pull request against `public/data/facilities.json` with a source link, or file an issue. Corrections with a public source are merged quickly, and the `last_verified` date is bumped.

---

*Nonpartisan. Not legal or financial advice. Dataset last updated 2026-07-16.*
