# GridWatch Indiana

**An interactive atlas that maps every proposed and existing data center in Indiana against the state's power grid — megawatts, water use, IURC dockets, and projected bill impact — all from public records.**

![GridWatch Indiana — the grid intelligence console](docs/screenshot.png)

Indiana is in the middle of a live fight over data-center energy. As of mid-2026 there are **46 tracked data-center projects** across the state, and the active ones already add up to roughly **12,600 MW — about 36% of Indiana's peak demand** — on a grid that's still **61% coal**. Meanwhile residential electric bills jumped ~17% this year.

All of that information exists. It's just scattered across hundreds of IURC docket filings, utility integrated resource plans, county planning documents, and news stories. Nobody had assembled it into one navigable picture. So a Hamilton County resident couldn't easily answer a simple question: *what's being built near me, how much power will it draw, and will it raise my bill?*

GridWatch answers exactly that.

---

## What it does

- **Maps the whole fleet.** Every data center renders as a glowing node sized by megawatts and colored by load severity — green under 50 MW up to magenta for the hyperscalers that are off the scale Indiana's grid was built for. Existing power plants, ≥138 kV transmission lines, and utility service territories layer underneath.
- **Filters to what matters.** Filter the map live by status (proposed, approved, built, withdrawn), by size tier (small up to off-the-scale hyperscale), and by serving utility. The count updates as you go. Search any county or facility to fly straight to it.
- **Scrubs through time.** A 2020 → 2035 timeline animates the build-out. Drag it and watch the grid fill as nodes appear and grow toward their projected energization.
- **Shows the receipts.** Click any node for a full dossier: capacity, water use, acreage, investment, developer, serving utility, IURC cause number, and **every figure linked to its public source**. When a developer redacts a number, the card flags it `◈ DEVELOPER-REDACTED` instead of guessing.
- **Projects your bill.** A transparent calculator combines each utility's IURC-approved rate change with an illustrative split of filed data-center infrastructure costs. Clearly labeled as a projection, with the math shown.
- **Points to the process.** A nonpartisan action layer lists how to file an IURC comment, the active dockets, and where the public hearings are. It shows the process, not a position.

No accounts. No tracking. No API keys. It loads straight into the console from a single link.

## Live data, honestly sourced

Every number traces to a public document. The data lives as version-controlled JSON/GeoJSON in [`/public/data`](public/data) so anyone can audit or reuse it.

| Layer | Source |
|-------|--------|
| Data-center facilities | IURC filings, utility filings, county records, [AI Law Tracker](https://ailawtracker.org/data-centers), and news reporting — **cited per record** |
| Power plants | [WRI Global Power Plant Database](https://datasets.wri.org/dataset/globalpowerplantdatabase) v1.3.0 |
| Transmission (≥138 kV) | [HIFLD](https://hifld-geoplatform.hub.arcgis.com/) Electric Power Transmission Lines |
| Utility territories | HIFLD Electric Retail Service Territories |
| County boundaries | US Census cartographic boundaries |
| Ratepayer / docket context | [IURC docket portal](https://iurc.portal.in.gov/), [Citizens Action Coalition](https://www.citact.org/ai-data-centers) |

The full sourcing method — including what's verified versus estimated versus redacted — is in **[METHODOLOGY.md](METHODOLOGY.md)**.

## Tech

Deliberately boring and forkable:

- **[MapLibre GL JS](https://maplibre.org/) v5** renders a 3D globe with a keyless dark vector basemap ([CARTO](https://carto.com/basemaps) dark-matter) — streets, water, labels, and 3D building extrusions. No Mapbox/Google key. The facility, grid, and territory overlays are self-hosted GeoJSON.
- **[Vite](https://vitejs.dev/)** + **TypeScript**, hand-written CSS design tokens, **[D3](https://d3js.org/)** for scales.
- **[Python](pipeline/)** pipeline fetches and simplifies the geodata into static files.
- Ships as static files. Host it free on Vercel, Netlify, or GitHub Pages, forever.

## Quickstart

```bash
npm install
npm run dev        # local dev server at http://localhost:5173
npm run build      # production build → dist/
npm run preview    # serve the production build
```

Refresh the underlying data any time:

```bash
python3 pipeline/fetch_geo.py       # pull counties, plants, transmission, territories
python3 pipeline/build_dataset.py   # recompute statewide roll-ups → meta.json
python3 pipeline/validate.py --links # schema + source-link checks
```

## Deploy

It's a static site, so deployment is one step:

- **Vercel** — import the repo; `vercel.json` sets build + output. Or `npx vercel --prod`.
- **Netlify** — `netlify.toml` is included; drag-and-drop `dist/` also works.
- **GitHub Pages** — push to `main`; the included [workflow](.github/workflows/deploy.yml) builds and publishes automatically.

Because `vite.config.ts` uses a relative base, the same build runs from any host or sub-path.

## Fork it for your state

That keyless, static architecture is the whole point. An Ohio resident could clone this into "GridWatch Ohio" in an afternoon:

1. Swap `public/data/facilities.json` for your state's projects (keep the schema and the `sources` on every record).
2. Point `pipeline/fetch_geo.py` at your state (change `IN_BBOX` and the county FIPS filter).
3. Re-run the pipeline and `build_dataset.py`. Done.

## Contributing

Corrections and new filings are welcome. A data center moved, a docket got decided, a redacted figure became public? Open a PR against `public/data/facilities.json` with a source link, or file an issue. Every record carries a `last_verified` date — help keep them fresh.

## Project structure

```
public/data/     static JSON + GeoJSON — the whole dataset, auditable
pipeline/        reproducible Python fetch + build + validate scripts
src/lib/         map engine, console, timeline, calculator, modals
src/styles/      design tokens + component CSS
docs/            screenshots + notes
```

## A note on scope

GridWatch is civic infrastructure, not an awareness campaign. It's meant to be *used and cited* — by residents checking their county, reporters chasing a filing, and officials in a hearing. It's nonpartisan and it is **not legal or financial advice**.

## License

Code: [MIT](LICENSE). Compiled data: CC BY 4.0 (source documents remain their publishers'). Attribution appreciated.

*Built with public data and a lot of docket-reading. Dataset last updated 2026-07-16.*
