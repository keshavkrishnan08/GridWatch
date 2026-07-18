# Prompt: research the data centers in your region

Copy everything below the line into an LLM that can search the web (Claude,
ChatGPT, Gemini — with search/browsing enabled). Replace `{{REGION}}` with your
region, e.g. `Ohio, United States` or `Republic of Ireland`.

Work in batches. Ten well-sourced facilities beat fifty guesses.

---

You are a research assistant for a public-interest transparency project that
maps data centers against the electrical grid. I need you to research data
centers in **{{REGION}}** and return them as JSON.

## The one rule that governs everything

**If you cannot cite it, do not state it.**

This dataset is read by journalists, regulators, and residents. A single
invented number discredits the whole thing. So:

- Every facility needs at least one real, working source URL.
- Any figure you cannot find in a document is `null`. Never `0`, never a
  placeholder, never a "typical" value for a facility of that size.
- Never average, extrapolate, or infer a capacity. If three sources say
  different things, use the most authoritative one and note the discrepancy.
- If you are not confident a project exists, leave it out entirely and list it
  under `uncertain` at the end instead.

I would much rather receive 8 facilities I can trust than 40 I have to check.

## Where to look

In rough order of authority:

1. **Utility regulator filings** — the strongest source. Interconnection
   requests, rate cases, and special-contract filings state real megawatts.
   (US: the state PUC/PSC docket portal. EU/UK: the national regulator.)
2. **Local government records** — rezoning petitions, planning-commission
   agendas and minutes, annexation records, tax-abatement agreements. These
   give acreage, location, and often the developer.
3. **Utility resource plans** — integrated resource plans and load forecasts
   name large new loads.
4. **Company announcements** — press releases from the operator or the
   economic-development agency.
5. **Local and trade press** — local papers, Data Center Dynamics, regional
   business journals. Good for context; weaker for figures.
6. **Industry trackers** — Baxtel, Cleanview, DataCenterMap. Useful for
   discovery; treat their numbers as unverified leads, not facts.

Prefer primary documents. When you use a tracker or news figure rather than a
filing, set `mw_estimated: true`.

## Output format

Return a single JSON object, nothing else — no commentary before or after:

```json
{
  "region": "{{REGION}}",
  "facilities": [ /* objects as specified below */ ],
  "uncertain": [
    { "name": "...", "why": "what you found and why it didn't meet the bar" }
  ],
  "coverage_note": "What you searched, what you likely missed, and where the gaps are."
}
```

### Each facility object

```json
{
  "id": "operator-town",
  "name": "Full facility name as reported",
  "developer": "Company, or \"Undisclosed\"",
  "city": "Town",
  "county": "Subdivision name WITHOUT the word County/Parish/Kreis",
  "lat": 40.0481,
  "lng": -86.4691,
  "geo_precision": "parcel | site | city | county",
  "status": "proposed | approved | construction | operational | rumored | withdrawn",
  "mw_phase1": 200,
  "mw_full": 600,
  "mw_estimated": false,
  "acres": 400,
  "investment_usd": 2000000000,
  "water_mgd": null,
  "water_status": "known | redacted | unknown",
  "utility": "Serving electric utility",
  "iurc_docket": "Regulator case number, or null",
  "docket_url": "Link to the regulator's portal, or null",
  "announced_year": 2025,
  "online_year": 2028,
  "tax_note": "Subsidies/abatements, or null",
  "sources": [
    { "label": "Publication — headline", "url": "https://..." }
  ],
  "notes": "Plain-language context. Say explicitly what is unconfirmed.",
  "last_verified": "YYYY-MM-DD (today's date)"
}
```

### Field rules

- **id** — lowercase, hyphenated, unique. `amazon-new-carlisle`.
- **county** — must be the bare subdivision name (`Boone`, not `Boone County`),
  because the app adds the noun itself.
- **lat/lng** — decimal degrees. Set `geo_precision` honestly: `parcel` only for
  a surveyed parcel, `site` for an approximate campus location, `city` if you
  only know the town, `county` if you only know the area.
- **status** — be precise, this drives the whole map:
  - `rumored` — reported but unconfirmed; no filing, or no named operator
  - `proposed` — formally proposed or filed, not yet approved
  - `approved` — approved or permitted, not yet building
  - `construction` — under construction
  - `operational` — running
  - `withdrawn` — cancelled, rejected, or denied at rezoning
- **mw_phase1 / mw_full** — megawatts. `mw_phase1` is the first phase if
  reported separately; `mw_full` is capacity at full build. If only one figure
  exists, put it in `mw_full`. Never exceed `mw_full` with `mw_phase1`.
- **mw_estimated** — `true` when the capacity comes from reporting or a tracker
  rather than a filing.
- **water_status** — `redacted` specifically means the developer withheld it in
  a public filing. That's a meaningful fact and the app displays it. Use
  `unknown` when it simply wasn't reported.
- **investment_usd** — a plain number in the region's currency, no separators.
- **sources** — at least one. Real URLs you actually found. Do not fabricate
  links; if you can't produce a URL, describe the document in `label` and put
  the portal's URL in `url`.
- **notes** — this is where honesty lives. "Capacity reported by a trade
  tracker, not filed." "Operator undisclosed; landowners under NDA."

## Also tell me, at the end

After the JSON, in plain prose:

1. **Coverage** — what you searched and what you probably missed. Be blunt.
2. **Conflicts** — where sources disagreed and how you resolved it.
3. **What to check by hand** — the two or three records most worth a human
   verifying before publishing.

## Self-check before you answer

Go back through your JSON and confirm:

- [ ] Every facility has ≥1 source with a real URL.
- [ ] No number appears that you cannot point to in a source.
- [ ] Every unknown is `null`, not `0` or a guess.
- [ ] `county` values have no "County"/"Parish" suffix.
- [ ] No duplicate `id`s, and no two entries describing the same physical site.
- [ ] `mw_phase1` ≤ `mw_full` wherever both are present.
- [ ] Every `status` is one of the six allowed values.
- [ ] Any figure not from a filing has `mw_estimated: true`.

If a check fails, fix it before responding.

---

## After you get the JSON

Save it as `my-facilities.json`, then:

```bash
npm run validate -- my-facilities.json
```

The validator enforces the sourcing rule mechanically. Fix anything it flags,
then drop the file in as `public/data/facilities.json`.

**Then spot-check by hand.** Open three or four of the source links yourself and
confirm the numbers match. LLMs are good at finding candidates and terrible at
being certain — the validator checks structure, not truth. You are the last
line of defense.
