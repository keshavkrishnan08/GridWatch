# Prompt: build your region's bill-impact model

This produces `bill_impact_models.json` — what powers the "will this raise my
bill?" calculator, which is the question most residents actually care about.

Replace `{{REGION}}` and paste into an LLM with web search.

---

You are a research assistant for a public-interest project that shows residents
how data-center growth affects their electricity bills. I need the utility and
rate data for **{{REGION}}** as JSON.

## The one rule

**If you cannot cite it, do not state it.** This calculator makes a claim about
someone's money. Every figure needs a source — a rate order, a tariff sheet, a
regulator filing, or an official utility page. Anything you can't source is
`null`, and the app will simply show less.

Do not estimate rates from national averages. Do not carry a figure from a
neighboring region.

## What I need

For each major electric utility serving **{{REGION}}**:

1. **Customer count** — residential customers served (regulator annual reports,
   utility fact sheets, EIA-861 in the US).
2. **Average residential rate** — cents per kWh, and the date it took effect.
3. **Typical monthly bill** at 1,000 kWh.
4. **Recent rate change** — the most recent approved increase: percentage,
   period it covers, and the order approving it.
5. **Filed data-center infrastructure costs** — this is the important one.
   Money the utility has filed to spend on generation/transmission specifically
   to serve large data-center load: the amount, what it's for, and the docket
   number. If none has been filed, use an empty array — that's a real finding.

## Output format

Return one JSON object, nothing else:

```json
{
  "disclaimer": "One or two sentences stating plainly that this is an illustrative model built from approved rate changes and filed infrastructure costs, not a forecast or a bill estimate.",
  "equation": "dc_impact_per_month = filed_infrastructure_usd / customers / (amortize_years * 12)",
  "statewide_context": {
    "avg_bill_increase_this_year_pct": 0.0,
    "avg_bill_increase_decade_pct": 0.0,
    "avg_rate_cents_kwh": 0.0,
    "source": { "label": "...", "url": "https://..." }
  },
  "assumptions": {
    "amortize_years": 20,
    "uncertainty_band_pct": 25,
    "typical_household_kwh": 1000
  },
  "utilities": [
    {
      "id": "short-slug",
      "display_name": "Utility Name",
      "raw_match": ["lowercase", "aliases", "as they appear in filings"],
      "customers": 900000,
      "avg_rate_cents_kwh": 15.6,
      "typical_bill_1000kwh": 156,
      "recent_increase": {
        "pct": 5.2,
        "period": "2025–2026",
        "source": { "label": "Rate order, Cause 12345", "url": "https://..." }
      },
      "cost_shifts": [
        {
          "usd": 2000000000,
          "label": "What this money is for, in plain language",
          "docket": "Case number or null"
        }
      ],
      "notes": "One sentence a resident would find useful.",
      "sources": [{ "label": "...", "url": "https://..." }]
    }
  ]
}
```

### Field rules

- **id** — short slug (`duke`, `nipsco`). Must match the utility `id` you use in
  `theme.json`, so the map's utility filter lines up with the calculator.
- **raw_match** — lowercase substrings that identify this utility in messy
  source data (`["duke", "duke energy indiana"]`).
- **customers** — residential customers, a plain integer.
- **cost_shifts** — only money **actually filed** and attributable to
  data-center load. Do not include general capital spending. An empty array is
  a legitimate and useful answer.
- **assumptions.amortize_years** — how long the infrastructure cost is spread
  over. 20 is a reasonable default; change it if your regulator uses another
  figure and say so.

## How the calculator uses this

```
monthly impact = (sum of cost_shifts) ÷ customers ÷ (amortize_years × 12)
```

It's deliberately simple and shown to the user, so they can check the math. Your
job is to get the inputs right and sourced; the model stays transparent.

## Self-check

- [ ] Every rate, customer count, and cost-shift traces to a specific document.
- [ ] No figure was carried over from another region or a national average.
- [ ] `cost_shifts` contains only data-center-attributable filed spending.
- [ ] `id` values match what you'll put in `theme.json`.
- [ ] Anything unfindable is `null` or an empty array, not a guess.

## Also tell me

- Which utilities you could not find good data for, and what's missing.
- Whether any rate case is currently pending that would change these numbers.
- Any figure you're less than confident in.

---

## After

Save as `public/data/bill_impact_models.json`. If the `utilities` array is
empty, the app honestly reports that no model is configured rather than showing
numbers from somewhere else — so it's safe to ship partial.
