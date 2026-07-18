# Contributing to GridWatch

Thanks for being here. This project is useful only if people trust it, so most
of these guidelines are really about one thing: **every number has to be
traceable to a public document.**

## The one rule

> If you can't cite it, don't add it.

No estimated megawatts presented as filed figures. No "roughly" numbers without
saying so. When a developer redacts something, we show that it was redacted —
we don't fill the gap with a guess.

In practice:

- Every facility needs at least one entry in `sources` (the validator enforces this).
- A figure from reporting rather than a filing gets `mw_estimated: true`.
- An unconfirmed project gets `status: "rumored"` — the UI flags it as CHATTER.
- Unknown means `null`. Never `0`, never a placeholder.

If you're unsure whether something is solid enough, open an issue and ask. A
question costs nothing; a wrong number costs the project's credibility.

## Quick start

```bash
npm install
npm run dev          # http://localhost:5173
npm run test:all     # typecheck + TS tests + Python tests
```

## Before you open a PR

```bash
npm run test:all
```

That runs `tsc --noEmit`, the vitest suite, and the Python suite. CI runs the
same thing. If you touched data:

```bash
npm run validate -- public/data/facilities.json --subdivisions public/data/counties.geojson
```

## Adding or correcting a facility

Edit `public/data/facilities.json`. The file is hand-formatted (grouped keys,
compact source lines) — please match the surrounding style rather than
reformatting the whole file, so diffs stay readable.

```json
{
  "id": "acme-springfield",
  "name": "Acme Springfield Campus",
  "developer": "Acme Corp",
  "city": "Springfield", "county": "Boone",
  "lat": 40.0481, "lng": -86.4691, "geo_precision": "site",
  "status": "proposed",
  "mw_phase1": null, "mw_full": 600, "mw_estimated": false,
  "sources": [
    { "label": "IURC Cause 12345 — petition", "url": "https://iurc.portal.in.gov/..." }
  ],
  "notes": "600 MW at full build. Water use redacted in the filing.",
  "last_verified": "2026-07-18"
}
```

Set `last_verified` to the date **you** checked the sources — not the date the
document was published. See `templates/facilities.template.json` for every
field, and `METHODOLOGY.md` for how figures are derived.

**Corrections are the most valuable contribution here.** If a number is wrong,
open an issue with the source that shows it. That's not a nuisance, it's the
point.

## Adding a region

GridWatch works anywhere. See [FORKING.md](FORKING.md) for the full guide.

```bash
npm run region -- --region "Ohio, United States"
```

We generally don't merge whole new regions into this repo — fork it and run
your own. What we'd love in a PR:

- fixes to the pipeline that make other regions work better
- a new provider (a national regulator's API, a government open-data portal)
- better default `admin_level` mappings for a country we get wrong

## Adding a data source

Providers are independent modules behind a small protocol:

```python
class MyProvider:
    key = "my_source"
    outputs = ["my_layer.geojson"]

    def run(self, ctx: RegionContext) -> dict:
        ...
        return {"ok": True, "count": n, "file": "my_layer.geojson"}
```

Register it in `pipeline/providers/__init__.py`. Two requirements:

1. **Fail loudly.** If the source is unreachable, return `{"ok": False, ...}`
   and write nothing. Never write an empty file — "no data centers found" and
   "the server timed out" must not look identical downstream.
2. **Mark what's inferred.** Anything auto-discovered gets `_auto: true`, a
   source link, and no invented figures.

## Code notes

- **TypeScript**, no framework. Small modules under `src/lib/`.
- **Config over constants.** Anything region-specific belongs in `theme.json`
  or `region.json`, not in code. If you find yourself typing "Indiana" into a
  `.ts` file, it probably belongs in config.
- **MapLibre gotcha:** in an expression, `["zoom"]` must be a top-level input to
  `step`/`interpolate`. Nesting it inside `*` silently fails to add the layer.
  This has bitten us twice.
- **Escape forked data.** Card and modal content is rendered with `innerHTML`;
  run text through `esc()` and URLs through `safeUrl()`.

## Tests

Add a test when you fix a bug — that's how the current suite got written. Both
of these were real regressions:

- a facility with no `announced_year` silently vanished from the map
- map labels clipped off the top edge of the viewport

```bash
npm run test          # TS (vitest)
npm run test:py       # pipeline (unittest)
```

## Keeping data honest over time

Data decays. Run:

```bash
npm run freshness
```

It reports the dataset's age and any records not re-verified recently. The app
shows visitors a staleness banner automatically after 6 months — please don't
remove it. Better to look out of date than to look confidently wrong.

## Tone

The project is nonpartisan by design. It shows the process and the numbers, and
lets people draw conclusions. Please keep advocacy language out of the data and
the UI copy — including in `notes` fields.

## Licensing

MIT. By contributing you agree your work is licensed the same way.
