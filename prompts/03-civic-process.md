# Prompt: map your region's civic process

This fills the parts of the atlas that turn information into action — how a
resident actually weighs in, which cases are live, and where local governments
have already restricted data centers. It produces `action_items.json`,
`dockets.json`, `county_restrictions.json`, and the terminology block of
`theme.json`.

Replace `{{REGION}}` and paste into an LLM with web search.

---

You are a research assistant for a nonpartisan civic transparency project. I
need to document how residents of **{{REGION}}** can participate in decisions
about data centers and the electrical grid.

## Ground rules

- **Nonpartisan.** Describe the process, never advocate a position. No language
  urging people to oppose or support projects — just how to be heard.
- **Cite everything.** Every organization, deadline, and case number needs a
  real URL.
- **Accuracy over completeness.** An empty section is fine; a wrong deadline or
  a dead link is worse than nothing.

## 1. Who regulates, and what things are called

```json
{
  "terminology": {
    "subdivision": "county",
    "subdivision_plural": "counties",
    "regulator": "Short name of the utility regulator, e.g. IURC",
    "regulator_url": "https://...",
    "consumer_advocate": "Short name of the ratepayer advocate, e.g. OUCC",
    "consumer_advocate_url": "https://... (the public-comment page if there is one)"
  }
}
```

- **subdivision** — what one clickable local division is called here: county,
  parish, borough, council area, département, Kreis, município. Singular,
  lowercase.
- **regulator** — the body that approves utility rates and large-load
  agreements.
- **consumer_advocate** — the office representing ratepayers, if one exists
  (many countries have none — use `null`). Prefer a direct link to the page
  where the public can file a comment.

## 2. How to take part — `action_items.json`

```json
{
  "intro": "One or two neutral sentences: this shows the process, not a position.",
  "items": [
    {
      "type": "comment | decision | howto | org",
      "title": "Short, concrete action",
      "org": "Body or organization responsible",
      "detail": "What this is and what happens when someone does it. 1–2 sentences.",
      "action": "Button text, e.g. \"File a consumer comment\"",
      "url": "https://...",
      "deadline": "A real date or window, or null if ongoing",
      "priority": 1,
      "phone": "optional"
    }
  ]
}
```

Include, where they exist:

- **How to file a comment** with the regulator or ratepayer advocate.
- **Live decisions** with dates — pending rate cases, scheduled votes.
- **How local land-use approval works here** — who votes on rezoning, whether
  hearings take public testimony, how to find the agenda.
- **Independent organizations** working on utility/ratepayer issues in the
  region — consumer advocates, environmental groups, ratepayer coalitions.
  List them factually with what they do. Include groups across the spectrum
  where they exist; don't curate for one viewpoint.

Sort by `priority`, 1 = most immediately useful.

## 3. Live regulator cases — `dockets.json`

```json
{
  "portal": "https://... the searchable docket portal",
  "note": "One line on how to look up a case here.",
  "dockets": [
    {
      "cause": "Case number",
      "title": "What the case is about",
      "utility": "Petitioner",
      "filed": "YYYY-MM",
      "status": "pending | approved | denied | settled",
      "decision_expected": "YYYY-MM or null",
      "ratepayer_note": "One neutral sentence on why a resident might care.",
      "sources": [{ "label": "...", "url": "https://..." }]
    }
  ]
}
```

Only cases actually related to data centers or large-load growth.

## 4. Local restrictions — `county_restrictions.json`

Places that have adopted a moratorium, ban, or significant restriction on data
centers:

```json
{
  "note": "One line on what's covered and the cutoff date of this research.",
  "sources": [{ "label": "...", "url": "https://..." }],
  "counties": [
    {
      "name": "Subdivision name WITHOUT the noun (e.g. \"Marshall\", not \"Marshall County\")",
      "type": "ban | moratorium",
      "detail": "What was adopted, by which body, and when. One or two sentences."
    }
  ]
}
```

`name` must exactly match a subdivision name in the map data, or the overlay
won't render. Use `ban` for an outright prohibition, `moratorium` for a
time-limited pause. If a restriction is partial (only in certain zones), say so
in `detail`.

## Output

Return the four JSON objects, each clearly labeled, in one response. Then in
prose tell me:

- What you couldn't find, and where a human should look instead.
- Anything time-sensitive that will be stale within a few months.
- Whether the region has a ratepayer advocate at all.

## Self-check

- [ ] Every URL is real and specific — no invented deep links.
- [ ] Every deadline is a date you actually found, not an assumption.
- [ ] Restriction `name` values match the map's subdivision names exactly.
- [ ] Nothing in the copy urges a position for or against data centers.
- [ ] Organizations are described factually, not endorsed.

---

## After

Save each into `public/data/`. Anything you leave empty degrades gracefully —
the app shows "not configured for this region" rather than another region's
process. Then set `terminology` in `public/data/theme.json` from part 1.

Deadlines rot fast. Re-run this prompt every few months, and note that
`npm run freshness` will remind you.
