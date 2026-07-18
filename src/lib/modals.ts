import type { AppData, UtilityModel, Facility } from "./data";
import { fmtUSD, fmtInt, fmtMW, esc, safeUrl } from "./format";
import {
  fuelColor, FUEL_LABEL, JOBS_PER_MW_DC, JOBS_PER_MW_OTHER,
  servingUtility, countyCentroid, UTIL_DISPLAY,
} from "./util";
import { newsletterFormHTML, wireNewsletterForm } from "./newsletter";
import { track } from "./track";

const root = () => document.getElementById("modal-root")!;
const BG_SELECTORS = ["#topbar", "#controls", "#timeline", "#card", "#map"];

let lastFocus: HTMLElement | null = null;
let inerted: Array<[HTMLElement, boolean]> = [];

function trapTab(e: KeyboardEvent) {
  if (e.key !== "Tab") return;
  const f = root().querySelectorAll<HTMLElement>(
    'a[href],button:not([disabled]),select,input,textarea,[tabindex]:not([tabindex="-1"])'
  );
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

export function closeModal() {
  const r = root();
  r.hidden = true;
  r.innerHTML = "";
  r.onclick = null;
  document.removeEventListener("keydown", trapTab, true);
  inerted.forEach(([el, prev]) => (el.inert = prev));
  inerted = [];
  lastFocus?.focus?.();
  lastFocus = null;
}

export function openModal(title: string, bodyHTML: string, onMount?: (el: HTMLElement) => void) {
  const r = root();
  lastFocus = document.activeElement as HTMLElement;
  r.hidden = false;
  r.innerHTML = `
    <div class="modal panel" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <div class="modal-head"><h2>${esc(title)}</h2><button class="modal-close" aria-label="Close">✕</button></div>
      <div class="modal-body">${bodyHTML}</div>
    </div>`;
  // backdrop close — assign (not addEventListener) so it never stacks on the persistent node
  r.onclick = (e) => { if (e.target === r) closeModal(); };
  r.querySelector(".modal-close")!.addEventListener("click", closeModal);
  // take the background out of the tab order + a11y tree, remembering prior state
  inerted = BG_SELECTORS
    .map((s) => document.querySelector<HTMLElement>(s))
    .filter((el): el is HTMLElement => !!el)
    .map((el) => { const prev = el.inert; el.inert = true; return [el, prev] as [HTMLElement, boolean]; });
  document.addEventListener("keydown", trapTab, true);
  if (onMount) onMount(r.querySelector(".modal-body")!);
  (r.querySelector(".modal-close") as HTMLElement)?.focus();
}

/* ---------------- Bill impact calculator ----------------
   Headline = data-center-specific impact: filed infrastructure $ split across
   customers and amortized. Fully data-driven — edit bill_impact_models.json and
   every number here recomputes. */
function project(u: UtilityModel, kwh: number, a: AppData["bill"]["assumptions"]) {
  const base = kwh * (u.avg_rate_cents_kwh / 100);
  const dcTotal = u.cost_shifts.reduce((s, c) => s + c.usd, 0);
  const dcMonthly = dcTotal / u.customers / (a.amortize_years * 12);
  const band = a.uncertainty_band_pct / 100;
  return { base, dcTotal, dcMonthly, low: dcMonthly * (1 - band), high: dcMonthly * (1 + band) };
}

export function openBillCalc(data: AppData, prefillId?: string) {
  track("bill_open", { prefill: prefillId ?? null });
  const utils = data.bill.utilities;
  const a = data.bill.assumptions;

  // A freshly bootstrapped region has no local rate data yet. Say so plainly
  // rather than rendering a model built from another region's numbers.
  if (!utils.length) {
    openModal("Bill Impact", `
      <div class="prose">
        <p>No bill-impact model is configured for this region yet.</p>
        <p>Rates, customer counts, and filed cost-shifts have to come from local
        utility and regulator filings — GridWatch won't estimate them. Add them to
        <code>public/data/bill_impact_models.json</code> and this calculator turns on.</p>
        <p style="color:var(--text-dim);font-size:11px;font-family:var(--mono)">${esc(data.bill.disclaimer || "")}</p>
      </div>`);
    return;
  }
  const options = utils.map((u) => `<option value="${esc(u.id)}">${esc(u.display_name)}</option>`).join("");

  openModal("Bill Impact · Data Centers", `
    <div class="bc-field">
      <label for="bc-util">Your electric utility</label>
      <select class="bc-select" id="bc-util">${options}</select>
    </div>
    <div class="bc-field">
      <label for="bc-kwh">Monthly usage (kWh)</label>
      <input class="bc-input" id="bc-kwh" type="number" min="100" max="5000" value="${a.typical_household_kwh}" />
      <div class="bc-usage-btns">
        <button class="bc-chip on" data-k="1000">Typical · 1,000</button>
        <button class="bc-chip" data-k="700">Small · 700</button>
        <button class="bc-chip" data-k="1500">Large · 1,500</button>
      </div>
    </div>
    <div class="bc-result" id="bc-result"></div>
    <div class="bc-disclaim">${esc(data.bill.disclaimer)}</div>
  `, (el) => {
    const sel = el.querySelector<HTMLSelectElement>("#bc-util")!;
    const kwh = el.querySelector<HTMLInputElement>("#bc-kwh")!;
    if (prefillId && utils.some((u) => u.id === prefillId)) sel.value = prefillId;
    const compute = () => {
      const u = utils.find((x) => x.id === sel.value) ?? utils[0];
      const k = Math.max(100, Math.min(5000, +kwh.value || a.typical_household_kwh));
      const p = project(u, k, a);
      const headline = p.dcTotal > 0
        ? `<div class="bc-headline">+$${p.low.toFixed(0)}–$${p.high.toFixed(0)}<small> / mo</small></div>
           <div class="bc-sub">from data-center infrastructure filed to date · ≈ +$${(p.low * 12).toFixed(0)}–$${(p.high * 12).toFixed(0)} / yr, spread over ~${a.amortize_years} yrs</div>`
        : `<div class="bc-headline" style="color:var(--text-mid);font-size:22px">No DC docket filed yet</div>
           <div class="bc-sub">No single data-center infrastructure cost is broken out for this utility — but rates are climbing (see below).</div>`;
      el.querySelector("#bc-result")!.innerHTML = `
        ${headline}
        <div class="bc-break">
          <div class="bc-line"><span class="bl-k">Your current monthly bill (${fmtInt(k)} kWh)</span><span class="bl-v">$${p.base.toFixed(0)}</span></div>
          <div class="bc-line"><span class="bl-k">Overall rate change, ${esc(u.recent_increase.period)}</span><span class="bl-v">+${u.recent_increase.pct}%</span></div>
          <div class="bc-line"><span class="bl-k">Filed data-center infrastructure${p.dcTotal ? ` (${fmtUSD(p.dcTotal)} ÷ ${fmtInt(u.customers)} customers)` : ""}</span><span class="bl-v">${p.dcTotal ? "+$" + p.dcMonthly.toFixed(2) + "/mo" : "none filed"}</span></div>
        </div>
        <div class="mini-note" style="margin-top:12px">${esc(u.notes)} <a href="${safeUrl(u.recent_increase.source.url)}" target="_blank" rel="noopener">Source ▸</a></div>
        <div class="mini-note" style="margin-top:8px;font-size:9px;color:var(--text-faint)">${esc(data.bill.equation)}</div>`;
    };
    sel.addEventListener("change", () => {
      const u = utils.find((x) => x.id === sel.value) ?? utils[0];
      track("bill_estimate", { utility: u.id });
      compute();
    });
    kwh.addEventListener("input", () => {
      el.querySelectorAll(".bc-chip").forEach((c) => c.classList.remove("on"));
      compute();
    });
    el.querySelectorAll<HTMLElement>(".bc-chip").forEach((c) =>
      c.addEventListener("click", () => {
        el.querySelectorAll(".bc-chip").forEach((x) => x.classList.remove("on"));
        c.classList.add("on");
        kwh.value = c.dataset.k!;
        compute();
      }));
    compute();
  });
}

/* ---------------- Check My Area · personalized exposure ----------------
   A single, shareable conversion: pick your county → your utility, the
   data centers near you, and the projected bill hit. Each run is a KPI. */
export function openImpact(data: AppData) {
  const names = [...new Set(
    data.counties.features.map((f) => String((f.properties as any)?.county ?? "")).filter(Boolean)
  )].sort();
  const options = names.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  openModal("Check My Area · Your Exposure", `
    <div class="prose" style="margin-bottom:12px">Pick your county to see who powers your home, what's being built nearby, and the projected hit to your bill — all from public records.</div>
    <div class="bc-field">
      <label for="im-county">Your county</label>
      <select class="bc-select" id="im-county"><option value="">Select a county…</option>${options}</select>
    </div>
    <div id="im-result"></div>
  `, (el) => {
    const sel = el.querySelector<HTMLSelectElement>("#im-county")!;
    const a = data.bill.assumptions;
    sel.addEventListener("change", () => {
      const county = sel.value;
      const out = el.querySelector("#im-result")!;
      if (!county) { out.innerHTML = ""; return; }
      const centroid = countyCentroid(county, data.counties);
      const util = centroid ? servingUtility(centroid, data.territories) : null;
      const key = util ? util.key : "other";
      const utilName = util ? (key !== "other" ? UTIL_DISPLAY[key] : util.name.replace(/\b\w/g, (c) => c.toUpperCase())) : "Multiple / cooperative";
      const inCounty = data.facilities.facilities.filter((f) => f.county === county && f.status !== "withdrawn");
      const totalMW = inCounty.reduce((s, f) => s + (f.mw_full ?? f.mw_phase1 ?? 0), 0);
      const model = util ? data.bill.utilities.find((u) => u.id === (key === "cp" ? "centerpoint" : key)) : null;
      const p = model ? project(model, a.typical_household_kwh, a) : null;
      const restr = data.restrictions.counties.find((c) => c.name.toLowerCase() === county.toLowerCase());
      track("impact_report_run", { county, utility: key, facilities: inCounty.length, monthly: p ? +p.dcMonthly.toFixed(2) : 0 });
      out.innerHTML = `
        <div class="stats-hero" style="margin-top:12px">
          <div class="sh-cell"><div class="sh-num phos">${inCounty.length}</div><div class="sh-lab">data center${inCounty.length === 1 ? "" : "s"} in ${esc(county)}</div></div>
          <div class="sh-cell"><div class="sh-num" style="color:var(--load-high)">${fmtMW(totalMW)}<small>MW</small></div><div class="sh-lab">combined load</div></div>
        </div>
        <div class="bc-break">
          <div class="bc-line"><span class="bl-k">Your electric utility</span><span class="bl-v">${esc(utilName)}</span></div>
          ${p && p.dcTotal > 0
            ? `<div class="bc-line"><span class="bl-k">Projected bill impact (filed DC infrastructure)</span><span class="bl-v">+$${p.low.toFixed(0)}–$${p.high.toFixed(0)}/mo</span></div>`
            : `<div class="bc-line"><span class="bl-k">Projected bill impact</span><span class="bl-v">no DC docket filed yet</span></div>`}
          <div class="bc-line"><span class="bl-k">Local restriction</span><span class="bl-v">${restr ? (restr.type === "ban" ? "BANNED" : "MORATORIUM") : "none"}</span></div>
        </div>
        ${inCounty.length
          ? `<div class="card-sources" style="margin-top:10px"><span class="eyebrow">Near you</span>${inCounty.slice(0, 8).map((f) => `<span class="src-link">${esc(f.name)} · ${fmtMW(f.mw_full ?? f.mw_phase1)} MW</span>`).join("")}</div>`
          : `<div class="mini-note" style="margin-top:10px">No tracked data centers in ${esc(county)} — yet. It can change fast.</div>`}
        <div class="card-action" style="margin-top:12px">
          <span class="eyebrow">Make your voice count</span>
          <a class="act-link hot" data-letter-cty="${esc(county)}">✉ Write your official about ${esc(county)} County</a>
          <a class="act-link" data-civic="oucc" href="https://www.in.gov/oucc/2504.htm" target="_blank" rel="noopener">◈ File a public comment (OUCC)</a>
          ${model ? `<a class="act-link" data-bill="${esc(model.id)}">▤ See the full bill breakdown</a>` : ""}
        </div>`;
      out.querySelector<HTMLElement>("[data-letter-cty]")?.addEventListener("click", () => openLetter(data, { county }));
      out.querySelector<HTMLElement>("[data-bill]")?.addEventListener("click", () => model && openBillCalc(data, model.id));
    });
  });
}

/* ---------------- Write Your Official · advocacy letter generator ----------------
   Generates an editable, sourced letter for a project or county. Copy or open
   in email. Every letter generated is a distinct civic-action KPI. */
export function openLetter(data: AppData, opts: { facility?: Facility; county?: string } = {}) {
  const f = opts.facility;
  const county = f ? f.county : (opts.county || "your");
  const subjectName = f ? f.name : `${county} County data center`;
  const docket = f?.iurc_docket ? ` (IURC Cause ${f.iurc_docket})` : "";
  const mw = f ? (f.mw_full ?? f.mw_phase1) : null;
  const mwLine = mw ? ` The project is sized at roughly ${fmtMW(mw)} MW —` : "";
  const proj = f ? f.name : `data-center development in ${county} County`;
  const body = `To the ${county} County Plan Commission and the Indiana Office of Utility Consumer Counselor,

I am a resident writing about ${proj}${docket}.${mwLine} I have serious questions about its impact on our electric rates, our water, and our community.

Data centers this size draw enormous amounts of power. When utilities build new generation and transmission to serve them, those costs can land on every household's bill unless regulators make the developer pay its own way. I am asking you to:

  1. Require the developer to cover the full cost of the power and infrastructure it needs, with binding rate protections for existing customers.
  2. Make water use, backup diesel generators, and true megawatt demand public, not redacted.
  3. Hold accessible public hearings before any approval.

Please enter my comment into the record and keep residents informed of upcoming meetings and decisions.

Thank you,
[Your name]
[Your address / ZIP]`;
  openModal("Write Your Official", `
    <div class="prose" style="margin-bottom:10px">A ready-to-send letter about <strong>${esc(subjectName)}</strong>. Make it yours, then copy it or open it in your email app. It takes two minutes and it goes on the public record.</div>
    <textarea class="letter-box" id="lt-body" spellcheck="true" rows="16">${esc(body)}</textarea>
    <div class="letter-actions">
      <button class="docket-btn" id="lt-copy">⧉ COPY LETTER</button>
      <a class="docket-btn" id="lt-mail" href="#">✉ OPEN IN EMAIL</a>
    </div>
    <div class="card-action" style="margin-top:12px">
      <span class="eyebrow">Where to send it</span>
      <a class="act-link hot" data-civic="oucc" href="https://www.in.gov/oucc/2504.htm" target="_blank" rel="noopener">◈ File it with the OUCC (utility consumer counselor)</a>
      <a class="act-link" data-civic="county" href="https://www.in.gov/iurc/" target="_blank" rel="noopener">◱ Find ${esc(county)} County's plan-commission contact</a>
    </div>
  `, (el) => {
    const box = el.querySelector<HTMLTextAreaElement>("#lt-body")!;
    const target = f ? f.id : county;
    const mail = el.querySelector<HTMLAnchorElement>("#lt-mail")!;
    const setMail = () => { mail.href = `mailto:?subject=${encodeURIComponent("Public comment: " + subjectName)}&body=${encodeURIComponent(box.value)}`; };
    setMail(); box.addEventListener("input", setMail);
    mail.addEventListener("click", () => track("letter_generated", { target, via: "email" }));
    el.querySelector("#lt-copy")!.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(box.value); } catch { /* clipboard may be blocked */ }
      const b = el.querySelector<HTMLElement>("#lt-copy")!; const t = b.textContent;
      b.textContent = "✓ COPIED"; setTimeout(() => (b.textContent = t), 1500);
      track("letter_generated", { target, via: "copy" });
    });
  });
}

/* ---------------- Open dataset · CSV export ----------------
   Reinforces the open-source story and gives a reporter/researcher KPI. */
export function exportCSV(data: AppData) {
  const cols = ["id", "name", "developer", "city", "county", "status", "mw_full", "mw_phase1",
    "mw_estimated", "acres", "investment_usd", "water_status", "utility", "iurc_docket",
    "announced_year", "online_year", "lat", "lng", "last_verified"];
  const cell = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const rows = [cols.join(",")].concat(
    data.facilities.facilities.map((f) => cols.map((c) => cell((f as any)[c])).join(","))
  );
  const blob = new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = "gridwatch-indiana-datacenters.csv";
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  track("dataset_download", { format: "csv", rows: data.facilities.facilities.length });
}

/* ---------------- Action layer ---------------- */
export function openAction(data: AppData) {
  track("action_open");
  const items = [...data.action.items].sort((x, y) => x.priority - y.priority);
  const dockets = data.dockets.dockets;
  const typeClass = (t: string) => (/^[a-z]+$/.test(t) ? t : "howto");
  openModal("Take Action · Public Process", `
    <div class="nl-embed">
      <div class="nl-eyebrow">◈ GRIDWATCH SIGNAL</div>
      <div class="nl-embed-head">Get a brief when Indiana's grid numbers move</div>
      ${newsletterFormHTML(false)}
    </div>
    <div class="prose" style="margin-bottom:16px">${esc(data.action.intro)}</div>
    ${items.map((it) => `
      <div class="act-item">
        <div class="act-top">
          <span class="act-type ${typeClass(it.type)}">${esc(it.type)}</span>
          <div>
            <div class="act-title">${esc(it.title)}</div>
            <div class="act-org">${esc(it.org)}${it.phone ? " · " + esc(it.phone) : ""}</div>
          </div>
        </div>
        <div class="act-detail">${esc(it.detail)}</div>
        <div class="act-foot">
          <span class="act-deadline">${it.deadline ? "⏱ " + esc(it.deadline) : ""}</span>
          <a class="act-cta" href="${safeUrl(it.url)}" target="_blank" rel="noopener">${esc(it.action)} ▸</a>
        </div>
      </div>`).join("")}
    <div class="prose"><h3>Active IURC Dockets</h3></div>
    ${dockets.map((d) => `
      <div class="act-item">
        <div class="act-top"><span class="act-type comment">CAUSE ${esc(d.cause)}</span>
          <div><div class="act-title">${esc(d.title)}</div><div class="act-org">${esc(d.utility)} · ${esc(d.status.toUpperCase())}${d.decision_expected ? " · decision " + esc(d.decision_expected) : ""}</div></div>
        </div>
        <div class="act-detail">${esc(d.ratepayer_note)}</div>
      </div>`).join("")}
    <div class="mini-note" style="margin-top:6px;text-align:center">Search any Cause number at <a href="${safeUrl(data.dockets.portal)}" target="_blank" rel="noopener">iurc.portal.in.gov</a></div>
  `, (el) => wireNewsletterForm(el));
}

/* ---------------- Indiana at a glance ---------------- */
export function openStats(data: AppData) {
  track("stats_open");
  const m = data.meta;
  const mix = m.generation_mix.filter((g) => g.pct >= 0.3);
  const total = m.load_mw.active_total;
  const dcJobs = Math.round(total * JOBS_PER_MW_DC);
  const otherJobs = Math.round(total * JOBS_PER_MW_OTHER);
  const restricted = data.restrictions.counties.length;
  openModal("Indiana at a Glance", `
    <div class="stats-hero">
      <div class="sh-cell"><div class="sh-num phos">${fmtMW(total)}<small>MW</small></div><div class="sh-lab">Active data-center load</div></div>
      ${m.load_mw.pct_of_state_peak != null
        ? `<div class="sh-cell"><div class="sh-num" style="color:var(--load-high)">${m.load_mw.pct_of_state_peak}<small>%</small></div><div class="sh-lab">of peak demand</div></div>`
        : `<div class="sh-cell"><div class="sh-num" style="color:var(--text-dim);font-size:20px">—</div><div class="sh-lab">peak demand not configured</div></div>`}
    </div>
    <div class="stats-grid">
      <div class="sg"><span class="sg-v" style="color:var(--phosphor-bright)">${fmtMW(m.load_mw.committed)}</span><span class="sg-k">MW online / building</span></div>
      <div class="sg"><span class="sg-v" style="color:var(--load-med)">${fmtMW(m.load_mw.proposed)}</span><span class="sg-k">MW proposed</span></div>
      <div class="sg"><span class="sg-v" style="color:var(--load-mega)">${m.mega_facilities.length}</span><span class="sg-k">hyperscale sites (&gt;500MW)</span></div>
      <div class="sg"><span class="sg-v">${m.counts.facilities_tracked_statewide}</span><span class="sg-k">projects tracked</span></div>
      <div class="sg"><span class="sg-v" style="color:var(--load-high)">${restricted}</span><span class="sg-k">counties restricting</span></div>
      <div class="sg"><span class="sg-v">${fmtMW(m.load_mw.withdrawn_avoided)}</span><span class="sg-k">MW withdrawn</span></div>
    </div>

    ${mix.length ? `<div class="prose"><h3>Existing generation mix — ${fmtInt(m.total_generation_mw)} MW mapped</h3></div>` : ""}
    <div class="genmix">${mix.map((g) => `<span style="width:${g.pct}%;background:${fuelColor(g.fuel)}" title="${FUEL_LABEL[g.fuel]} ${g.pct}%"></span>`).join("")}</div>
    <div class="genmix-legend">${mix.slice(0, 6).map((g) => `<span class="gl-item"><span class="gl-swatch" style="background:${fuelColor(g.fuel)}"></span>${FUEL_LABEL[g.fuel]} ${g.pct}%</span>`).join("")}</div>

    <div class="prose">
      <h3>Jobs</h3>
      <p>At the data-center average of <strong>~0.26 jobs/MW</strong>, ${fmtMW(total)} MW supports roughly <strong>${fmtInt(dcJobs)} permanent jobs</strong>. The same load in typical Indiana industry (~41 jobs/MW) would support about <strong>${fmtInt(otherJobs)}</strong> — a ${Math.round(otherJobs / Math.max(1, dcJobs))}× difference.</p>
      <h3>Scale comparisons</h3>
      <ul>
        <li>A single large AI data center uses about as much energy as <strong>730,000 Hoosier households</strong>.</li>
        <li>Amazon's New Carlisle campus alone could draw as much power as <strong>half of Indiana's 2.8 million households</strong>.</li>
        <li>The grid is <strong>${mix[0]?.pct}% ${mix[0]?.fuel}</strong> today; I&amp;M and NIPSCO plan <strong>5.6 GW of new gas by 2030</strong> to serve the load.</li>
      </ul>
      <p style="color:var(--text-dim);font-size:11px;font-family:var(--mono)">DATA UPDATED ${esc(m.last_updated)} · Σ OF ${m.counts.facilities_curated} CURATED FACILITIES · SOURCES IN EACH CARD &amp; ABOUT</p>
    </div>
  `);
}

/* ---------------- About / methodology ---------------- */
export function openAbout(data: AppData) {
  track("about_open");
  const m = data.meta;
  const committedPct = m.state_peak_mw
    ? ((m.load_mw.committed / m.state_peak_mw) * 100).toFixed(0)
    : null;
  openModal("About GridWatch Indiana", `
    <div class="prose">
      <p><strong>GridWatch Indiana</strong> maps every proposed and existing data center in the state against the power grid — megawatts, water, dockets, and projected bill impact — from public records. It's built to be genuinely useful to residents, reporters, and officials, and it's open-source under MIT so anyone can fork it for their own state.</p>

      <h3>What you're looking at</h3>
      <p>${m.counts.facilities_curated} curated facilities of <strong>${m.counts.facilities_tracked_statewide} tracked statewide</strong>, drawn against ${fmtInt(m.counts.power_plants)} power plants, ${fmtInt(m.counts.transmission_lines)} transmission segments, and ${m.counts.utility_territories} utility service territories. Proposed and committed data-center load totals <strong>${fmtMW(m.load_mw.active_total)} MW</strong>${
        m.load_mw.pct_of_state_peak != null
          ? ` — <strong>${m.load_mw.pct_of_state_peak}% of peak demand</strong>${committedPct ? ` (about ${committedPct}% committed/under construction)` : ""}`
          : ""
      }${m.generation_mix[0] ? `, on a grid that is ${m.generation_mix[0].pct}% ${m.generation_mix[0].fuel}` : ""}.</p>

      <h3>How the numbers are sourced</h3>
      <p>Every facility carries its sources and a verification date. Megawatt and cost figures come from IURC filings, utility filings, county records, and reporting — cited per record. Where a developer redacts a figure, the card flags it <span class="redaction-chip">◈ redacted</span> rather than guessing. Nothing here is invented.</p>
      <ul>
        <li><strong>Facilities:</strong> ${esc(m.sources.facilities)}</li>
        <li><strong>Power plants:</strong> ${esc(m.sources.power_plants)}</li>
        <li><strong>Transmission:</strong> ${esc(m.sources.transmission)}</li>
        <li><strong>Utility territories:</strong> ${esc(m.sources.territories)}</li>
        <li><strong>Counties:</strong> ${esc(m.sources.counties)}</li>
      </ul>

      <h3>What's estimated</h3>
      <p>The <strong>timeline</strong> uses projected energization years to animate build-out — a projection, labeled as such. The <strong>bill calculator</strong> is an illustrative model (approved rate increases plus an even split of filed infrastructure costs), not a forecast. Coordinates for some sites are city- or county-level approximations, flagged on each card. See <code>METHODOLOGY.md</code> in the repo for the full method.</p>

      <h3>Use it, cite it, fork it</h3>
      <p>MIT-licensed and static — no account required. Reporters and officials are welcome to cite it; the full dataset lives in version-controlled JSON at <code>/public/data</code>. Corrections and new filings are welcome as pull requests, and the whole atlas can be re-pointed at any other state, country, or region (see <code>FORKING.md</code>).</p>
      <button class="docket-btn" id="ab-csv">⭳ DOWNLOAD THE DATASET · CSV</button>
      <p style="color:var(--text-dim);font-size:11px;font-family:var(--mono)">DATASET UPDATED ${esc(m.last_updated)} · NONPARTISAN · NOT LEGAL OR FINANCIAL ADVICE</p>
    </div>
  `, (el) => {
    el.querySelector("#ab-csv")?.addEventListener("click", () => exportCSV(data));
  });
}
