import type { AppData, Facility } from "./data";
import type { GridMap } from "./map";
import { fmtInt, fmtMW, fmtPct, esc } from "./format";
import {
  totalsAt, haversineMiles, servingUtility, utilKey, UTIL_DISPLAY,
  fuelColor, FUEL_LABEL, sevColor,
} from "./util";

export interface ConsoleHandlers {
  select: (id: string) => void;
  openBill: (utilId?: string) => void;
  openAction: () => void;
  openAbout: () => void;
}

export class Console {
  private root: HTMLElement;
  private data: AppData;
  private map: GridMap;
  private h: ConsoleHandlers;
  private facs: Facility[];

  constructor(root: HTMLElement, data: AppData, map: GridMap, h: ConsoleHandlers) {
    this.root = root;
    this.data = data;
    this.map = map;
    this.h = h;
    this.facs = data.facilities.facilities;
    this.render();
  }

  private render() {
    const meta = this.data.meta;
    this.root.innerHTML = `
      <div class="panel bracket card-block" id="c-search">
        <div class="block-head"><h3>Locate</h3><span class="eyebrow">${meta.counts.facilities_tracked_statewide} tracked</span></div>
        <div class="search-wrap">
          <span class="search-icon">⌖</span>
          <input id="c-input" type="text" autocomplete="off" spellcheck="false"
            placeholder="Enter your county or a facility…" aria-label="Search county or facility" />
        </div>
        <div class="search-results" id="c-results"></div>
        <div id="c-county"></div>
      </div>

      <div class="panel bracket card-block" id="c-readout">
        <div class="block-head"><h3>Indiana Grid Status</h3><span class="eyebrow" id="ro-year">JUL 2026</span></div>
        <div class="readout">
          <div class="ro-cell">
            <div class="ro-label">DC Load · Online</div>
            <div class="ro-value committed" id="ro-online">—<small>MW</small></div>
          </div>
          <div class="ro-cell">
            <div class="ro-label">DC Load · Pipeline</div>
            <div class="ro-value proposed" id="ro-pipeline">—<small>MW</small></div>
          </div>
          <div class="ro-cell wide">
            <div class="ro-label">Share of State Peak Demand (~${fmtInt(meta.state_peak_mw)} MW)</div>
            <div class="ro-value" id="ro-pct">—</div>
            <div class="ro-bar"><span id="ro-bar" style="width:0%"></span></div>
          </div>
          <div class="ro-cell">
            <div class="ro-label">Hyperscale Sites</div>
            <div class="ro-value mega" id="ro-mega">${meta.mega_facilities.length}<small>&gt;500MW</small></div>
          </div>
          <div class="ro-cell">
            <div class="ro-label">Active Dockets</div>
            <div class="ro-value" id="ro-dockets">${this.data.dockets.dockets.length}</div>
          </div>
        </div>
        <div class="mini-note" id="ro-note"></div>
      </div>

      <div class="panel bracket card-block">
        <div class="block-head"><h3>Existing Generation Mix</h3><span class="eyebrow">${fmtInt(meta.total_generation_mw)} MW</span></div>
        <div class="genmix" id="c-genmix"></div>
        <div class="genmix-legend" id="c-genlegend"></div>
      </div>

      <div class="console-actions">
        <button class="panel big-btn" id="c-bill">
          <span class="bb-ico">▤</span>
          <span class="bb-title">BILL IMPACT</span>
          <span class="bb-sub">What could it cost you?</span>
        </button>
        <button class="panel big-btn" id="c-action">
          <span class="bb-ico">◈</span>
          <span class="bb-title">TAKE ACTION</span>
          <span class="bb-sub">Comment periods &amp; hearings</span>
        </button>
      </div>
    `;

    // generation mix
    const mix = meta.generation_mix.filter((g) => g.pct >= 0.3);
    const gm = this.root.querySelector<HTMLElement>("#c-genmix")!;
    const gl = this.root.querySelector<HTMLElement>("#c-genlegend")!;
    gm.innerHTML = mix.map((g) =>
      `<span style="width:${g.pct}%;background:${fuelColor(g.fuel)}" title="${FUEL_LABEL[g.fuel]} ${g.pct}%"></span>`).join("");
    gl.innerHTML = mix.slice(0, 6).map((g) =>
      `<span class="gl-item"><span class="gl-swatch" style="background:${fuelColor(g.fuel)}"></span>${FUEL_LABEL[g.fuel]} ${g.pct}%</span>`).join("");

    // wire
    this.root.querySelector("#c-bill")!.addEventListener("click", () => this.h.openBill());
    this.root.querySelector("#c-action")!.addEventListener("click", () => this.h.openAction());
    this.wireSearch();
    this.updateReadout(this.data.timeline.now);
  }

  private wireSearch() {
    const input = this.root.querySelector<HTMLInputElement>("#c-input")!;
    const results = this.root.querySelector<HTMLElement>("#c-results")!;
    const county = this.root.querySelector<HTMLElement>("#c-county")!;

    const counties = [...new Set(this.data.counties.features.map((f) => (f.properties as any).county as string))];

    const run = () => {
      const q = input.value.trim().toLowerCase();
      county.innerHTML = "";
      if (!q) { results.innerHTML = ""; return; }
      const facHits = this.facs.filter((f) =>
        [f.name, f.city, f.county, f.developer].some((s) => (s || "").toLowerCase().includes(q))).slice(0, 6);
      const cHits = counties.filter((c) => (c || "").toLowerCase().includes(q)).slice(0, 4);

      results.innerHTML =
        cHits.map((c) => `<div class="sr-item" data-county="${esc(c)}"><span class="sr-name">◱ ${esc(c)} County</span><span class="sr-meta">LOCATE</span></div>`).join("") +
        facHits.map((f) => {
          const mw = f.mw_full ?? f.mw_phase1;
          return `<div class="sr-item" data-fac="${esc(f.id)}"><span class="sr-name">${esc(f.name)}</span><span class="sr-meta" style="color:${sevColor(mw)}">${mw ? fmtMW(mw) + " MW" : esc(f.status.toUpperCase())}</span></div>`;
        }).join("");

      results.querySelectorAll<HTMLElement>("[data-fac]").forEach((el) =>
        el.addEventListener("click", () => { this.h.select(el.dataset.fac!); }));
      results.querySelectorAll<HTMLElement>("[data-county]").forEach((el) =>
        el.addEventListener("click", () => this.showCounty(el.dataset.county!)));
    };
    input.addEventListener("input", run);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const first = results.querySelector<HTMLElement>(".sr-item");
        first?.click();
      }
    });
  }

  showCounty(name: string) {
    const centroid = this.map.flyToCounty(name);
    const county = this.root.querySelector<HTMLElement>("#c-county")!;
    this.root.querySelector<HTMLInputElement>("#c-input")!.value = `${name} County`;
    this.root.querySelector<HTMLElement>("#c-results")!.innerHTML = "";
    if (!centroid) { county.innerHTML = `<div class="mini-note">County boundary not found.</div>`; return; }

    const nearby = this.facs
      .filter((f) => f.status !== "withdrawn")
      .map((f) => ({ f, d: haversineMiles(centroid, [f.lng, f.lat]) }))
      .filter((x) => x.d <= 25)
      .sort((a, b) => a.d - b.d);
    const totalMW = nearby.reduce((s, x) => s + (x.f.mw_full ?? x.f.mw_phase1 ?? 0), 0);
    const util = servingUtility(centroid, this.data.territories);
    const utilName = util ? (utilKey(util.name) !== "other" ? UTIL_DISPLAY[util.key] : util.name.replace(/\b\w/g, (c) => c.toUpperCase())) : "Multiple / cooperative";
    const model = util ? this.data.bill.utilities.find((u) => u.id === (util.key === "cp" ? "centerpoint" : util.key)) : null;

    county.innerHTML = `
      <div style="margin-top:11px;padding-top:11px;border-top:1px solid var(--panel-line)">
        <div class="eyebrow" style="margin-bottom:8px">Within 25 mi of ${esc(name)} County</div>
        <div class="readout" style="grid-template-columns:1fr 1fr">
          <div class="ro-cell"><div class="ro-label">Data Centers</div><div class="ro-value" style="font-size:18px">${nearby.length}</div></div>
          <div class="ro-cell"><div class="ro-label">Combined Load</div><div class="ro-value ${totalMW > 500 ? "mega" : totalMW >= 250 ? "proposed" : "committed"}" style="font-size:18px">${fmtMW(totalMW)}<small>MW</small></div></div>
        </div>
        <div class="mini-note">Served by <b>${esc(utilName)}</b>${model ? ` · avg ~${model.avg_rate_cents_kwh}¢/kWh` : ""}.</div>
        ${nearby.length ? `<div class="search-results" style="margin-top:8px;max-height:130px">${nearby.slice(0, 6).map((x) => `<div class="sr-item" data-fac="${esc(x.f.id)}"><span class="sr-name">${esc(x.f.name)}</span><span class="sr-meta" style="color:${sevColor(x.f.mw_full)}">${x.d.toFixed(0)} mi · ${fmtMW(x.f.mw_full ?? x.f.mw_phase1)} MW</span></div>`).join("")}</div>` : `<div class="mini-note">No tracked data centers within 25 miles — yet.</div>`}
        ${model ? `<button class="act-cta" style="margin-top:10px;width:100%;text-align:center" id="c-county-bill">▤ PROJECT MY BILL IMPACT (${esc(model.display_name)})</button>` : ""}
      </div>`;

    county.querySelectorAll<HTMLElement>("[data-fac]").forEach((el) =>
      el.addEventListener("click", () => this.h.select(el.dataset.fac!)));
    county.querySelector("#c-county-bill")?.addEventListener("click", () => this.h.openBill(model!.id));
  }

  updateReadout(year: number) {
    const t = totalsAt(this.facs, year);
    const meta = this.data.meta;
    const pct = (t.total / meta.state_peak_mw) * 100;
    const set = (id: string, html: string) => {
      const el = this.root.querySelector<HTMLElement>(id);
      if (el) el.innerHTML = html;
    };
    set("#ro-online", `${fmtMW(t.online)}<small>MW</small>`);
    set("#ro-pipeline", `${fmtMW(t.pipeline)}<small>MW</small>`);
    set("#ro-pct", `${fmtPct(pct)}`);
    const bar = this.root.querySelector<HTMLElement>("#ro-bar");
    if (bar) bar.style.width = `${Math.min(100, pct)}%`;
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const yr = Math.floor(year), mo = months[Math.min(11, Math.floor((year - yr) * 12))];
    set("#ro-year", `${mo} ${yr}`);
    set("#ro-note", `Showing <b>${t.nodes}</b> active of ${meta.counts.facilities_tracked_statewide} tracked · <b>${fmtMW(meta.load_mw.withdrawn_avoided)} MW</b> withdrawn after opposition`);
  }
}
