# Research prompts

GridWatch is an **interface**. It renders any region's data-center and grid
picture — you bring the data for your region.

Gathering that data used to mean weeks in docket portals. These prompts hand
that work to an LLM with web search, structured so the output drops straight
into the app and so the model can't quietly invent numbers along the way.

## The workflow

```bash
npm run region -- --region "Ohio, United States" --activate   # map + grid, automatic
```

Then, with an LLM that can search the web:

| Step | Prompt | Produces |
|---|---|---|
| 1 | [`01-facilities.md`](01-facilities.md) | `facilities.json` — the data centers |
| 2 | [`02-utilities-and-bills.md`](02-utilities-and-bills.md) | `bill_impact_models.json` — the bill calculator |
| 3 | [`03-civic-process.md`](03-civic-process.md) | `action_items.json`, `dockets.json`, `county_restrictions.json`, terminology |
| 4 | [`04-audit.md`](04-audit.md) | corrections — **run before publishing** |

Each prompt has a `{{REGION}}` placeholder. Replace it, paste, done.

Do step 1 and you have a working atlas. Steps 2 and 3 are what make it useful
to residents rather than just interesting. Step 4 is what makes it publishable.

## Why the prompts are written the way they are

Every prompt repeats one rule: **if you cannot cite it, do not state it.** Not
politeness — it's the constraint the whole project rests on. A model asked for
"the data centers in Ohio" will happily produce plausible megawatt figures for
facilities that don't exist. Asked to leave unknowns as `null` and cite every
number, it produces less, and what it produces can be checked.

That's also why step 4 exists as a separate pass with a different model. Authors
don't catch their own fabrications.

## Verify mechanically, then by hand

```bash
npm run validate -- my-facilities.json
```

The validator enforces structure: every facility has a source, no duplicate ids,
coordinates in range, phase capacity not exceeding full capacity. It passes or
fails without judgment.

**It cannot tell you whether a number is true.** So before you publish, open a
few source links yourself and check the figures match. The tooling narrows what
you have to verify; it doesn't remove the need to.

## Keeping it honest afterwards

- Records you haven't re-checked show their `last_verified` age.
- `npm run freshness` reports dataset and per-record staleness.
- Past six months, the app shows visitors a staleness banner on its own.
- Re-run [`04-audit.md`](04-audit.md) periodically — proposals get approved,
  denied, and cancelled constantly.

Nothing here is unique to data centers. The same four-prompt pattern —
research, contextualize, map the civic process, audit — works for any local
infrastructure fight where the facts are public but scattered.
