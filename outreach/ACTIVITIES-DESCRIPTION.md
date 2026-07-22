# Activities description + KPIs

## The constraint

Common App activity entries cap at:

| Field | Limit |
|---|---|
| Position / leadership | 50 characters |
| Organization | 100 characters |
| **Description** | **150 characters** |

150 characters is brutally short. Numbers survive it; adjectives don't.

---

## Common App — description (150 char)

**Option A — build + scale (recommended)**

```
Built open-source atlas mapping 76 Indiana data centers (15,142MW, 43% of state
peak) vs the grid; 103 sourced citations; forkable to any region.
```
`148 characters`

**Option B — lead with impact, once you have it**

```
Open-source grid atlas: 76 data centers, 15,142MW mapped, 103 citations. Cited by
[outlet]; drove [N] public comments to state regulators.
```
`145 characters` — swap in real numbers only when true.

**Option C — lead with the discipline**

```
Built Indiana's data-center grid atlas: 76 sites, 103 filings cited, 0 estimated
figures. Found+fixed errors in the state watchdog's dataset.
```
`147 characters`

## Position / leadership (50 char)

```
Founder & Lead Developer
```

## Organization (100 char)

```
GridWatch Indiana — open-source civic data atlas
```

---

## Longer version (supplement / Additional Info, ~650 char)

> I built GridWatch Indiana, a free open-source atlas mapping all 76 tracked
> data-center projects in the state against the electrical grid — 15,142 MW, about
> 43% of Indiana's peak demand — with 103 source citations and a rule that no
> figure appears unless it traces to a public filing. It includes a ZIP-level bill
> impact model built from utility rate orders, and a tool that generates public
> comments to regulators. Cross-checking against the state's leading watchdog
> dataset surfaced errors in both, including two counties I had wrong. I then
> generalized the engine so any state or country can deploy it with one command,
> and wrote the research prompts so a forker doesn't repeat my months of work.

---

# KPIs

## Tier 1 — true right now, verifiable in the repo

Use these immediately. Anyone can check every one.

| Metric | Value |
|---|---|
| Data centers tracked | **76** |
| Facilities with ≥1 source | **76 (100%)** |
| Source citations | **103** |
| Megawatts mapped | **15,142** |
| Share of state peak demand | **43.3%** |
| Indiana counties covered | **35 of 92** |
| Power plants layered | **205** |
| Transmission segments | **1,237** |
| ZIP codes supported | **807** |
| Lines of code (TS + Python) | **7,004** |
| Automated tests | **83** |
| Git commits | **39** |

## Tier 2 — easy to get within weeks of publishing

Wire analytics **before** any outreach or these are lost forever.

| Metric | How you get it |
|---|---|
| **Unique visitors** | PostHog / Plausible |
| **Public comments generated** | `letter_generated` event — already instrumented |
| **Bill-impact reports run** | `impact_report_run` event — already instrumented |
| **Clicks driven to nonprofits** | `civic_click` event, per organization |
| **Newsletter subscribers** | already instrumented |
| **Dataset downloads** | `dataset_download` event |
| **GitHub stars / forks** | GitHub Insights |
| **Search impressions + ranking** | Google Search Console (free — set up day one) |
| **Organic reach** | Reddit/HN native analytics |

## Tier 3 — the trophies, worth more than all of the above

| Metric | Why it beats everything |
|---|---|
| **Cited by a news outlet** | A reporter choosing your data is third-party validation you cannot manufacture |
| **Linked by an advocacy org** | Same logic |
| **Entered into a public record** | The Prop 238 submission does this — permanent and citable |
| **Errors found in another dataset** | You have this already: 20 conflicts + 2 self-corrections |
| **Regions deployed** | If anyone forks it, you're a platform, not a project |

---

## How to phrase KPIs honestly

**Do:**
- "76 data centers tracked, every figure linked to a public filing"
- "Drove N public comments to state utility regulators"
- "Found and corrected errors in both my dataset and the state watchdog's"

**Don't:**
- Cite **paid ad impressions** as reach. It reads as "I spent $50," and a savvy
  reader discounts everything after it.
- Say "used by thousands" without analytics behind it.
- Claim national coverage. You have Indiana deeply and a toolkit that generalizes
  — that's the stronger and true claim.

## The single line to aim for

> "I cross-checked my dataset against the state's leading utility watchdog and
> found errors in both — then fixed mine and sent them theirs."

That's a claim with receipts, it's already true, and it's not something a
scraping project can say.
