import type { AppData, UtilityModel } from "./data";
import { fmtUSD, fmtInt, esc, safeUrl } from "./format";

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
  const utils = data.bill.utilities;
  const a = data.bill.assumptions;
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
    sel.addEventListener("change", compute);
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

/* ---------------- Action layer ---------------- */
export function openAction(data: AppData) {
  const items = [...data.action.items].sort((x, y) => x.priority - y.priority);
  const dockets = data.dockets.dockets;
  const typeClass = (t: string) => (/^[a-z]+$/.test(t) ? t : "howto");
  openModal("Take Action · Public Process", `
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
  `);
}

/* ---------------- About / methodology ---------------- */
export function openAbout(data: AppData) {
  const m = data.meta;
  const committedPct = ((m.load_mw.committed / m.state_peak_mw) * 100).toFixed(0);
  openModal("About GridWatch Indiana", `
    <div class="prose">
      <p><strong>GridWatch Indiana</strong> maps every proposed and existing data center in the state against the power grid — megawatts, water, dockets, and projected bill impact — from public records. It's built to be genuinely useful to residents, reporters, and officials, and it's open-source under MIT so anyone can fork it for their own state.</p>

      <h3>What you're looking at</h3>
      <p>${m.counts.facilities_curated} curated facilities of <strong>${m.counts.facilities_tracked_statewide} tracked statewide</strong>, drawn against ${fmtInt(m.counts.power_plants)} power plants, ${fmtInt(m.counts.transmission_lines)} transmission segments, and ${m.counts.utility_territories} utility service territories. Proposed and committed data-center load already totals <strong>${m.load_mw.pct_of_state_peak}% of Indiana's peak demand</strong> (about ${committedPct}% is committed/under construction), on a grid that is ${m.generation_mix[0]?.pct}% ${m.generation_mix[0]?.fuel}.</p>

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
      <p>MIT-licensed and static — no accounts, no tracking, no API keys. Reporters and officials are welcome to cite it; the data lives in version-controlled JSON at <code>/public/data</code>. Corrections and new filings are welcome as pull requests.</p>
      <p style="color:var(--text-dim);font-size:11px;font-family:var(--mono)">DATASET UPDATED ${esc(m.last_updated)} · NONPARTISAN · NOT LEGAL OR FINANCIAL ADVICE</p>
    </div>
  `);
}
