# Prompt: audit a dataset before you publish it

Run this **before** any dataset goes live, and periodically afterwards. Use a
different model or a fresh session from the one that produced the data — you
want a skeptic, not the author reviewing itself.

LLMs are good at finding candidates and bad at being certain. This prompt is
where that gets caught.

---

You are fact-checking a public dataset before publication. Your job is to
**find what's wrong with it**, not to confirm it. A polite review that misses a
fabricated source is a failure; a harsh review that catches one is a success.

I will paste a `facilities.json` describing data centers. For each record,
verify against current public sources and report problems.

## Check every record for

1. **Fabricated or dead sources.** Does each URL resolve, and does the page
   actually say what the record claims? This is the highest-priority check —
   an invented citation is the worst failure mode here.
2. **Wrong numbers.** Does the megawatt, acreage, or investment figure match the
   cited document? Flag any figure you cannot confirm in a source.
3. **Wrong status.** Has the project been approved, denied, cancelled, or
   completed since this was written? Rezoning denials and withdrawals are
   commonly missed.
4. **Wrong location.** Do the coordinates fall in the stated city and
   subdivision? Is `geo_precision` honest, or is a town-level guess claiming to
   be `parcel`?
5. **Duplicates.** Are two records describing the same physical campus under
   different names or operators?
6. **Stale figures.** Has a phase been added, a capacity revised, or a redacted
   figure since disclosed?
7. **Silent guesses.** Any figure that looks like a round-number estimate
   presented as fact, or `mw_estimated: false` on a number that clearly came
   from reporting rather than a filing.

## Also look for what's missing

Search independently for data centers in this region that are **not** in the
dataset. Recently announced projects and denied proposals are the usual gaps.

## Report format

```
## Critical — fix before publishing
- <facility id>: <what's wrong> — <source proving it> — <suggested correction>

## Likely wrong
- ...

## Worth checking by hand
- ...

## Missing from the dataset
- <name, location, why it qualifies, source>

## Verified clean
- <ids you checked and found accurate>
```

Then, in one paragraph: **would you personally stand behind this dataset if a
journalist cited it?** If not, say exactly what would have to change first.

## Rules

- Be specific. "This seems off" is useless; give the record, the claim, and the
  source that contradicts it.
- If you can't verify something either way, say so — that goes in "worth
  checking by hand", not "verified clean".
- Do not invent corrections. If you don't know the right value, say the current
  one is unverified and leave it at that.
- Do not soften findings to be agreeable. A dataset that looks trustworthy but
  isn't causes more harm than one that's visibly incomplete.

---

Here is the dataset:

```json
{{PASTE YOUR facilities.json HERE}}
```

---

## After

Apply the corrections, bump `last_verified` on every record you re-checked,
then:

```bash
npm run validate -- public/data/facilities.json
npm run freshness
```

Anything the audit couldn't confirm should get honest language in `notes`
("capacity reported by a trade tracker, not filed") or be dropped to
`status: "rumored"` — which the app displays behind a CHATTER banner. Being
visibly unsure is fine. Being confidently wrong is not.
