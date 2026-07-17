import type { AppData, Facility } from "./data";
import type { GridMap } from "./map";
import { fmtInt, fmtMW, esc } from "./format";
import { SEV_COLOR, UTIL_DISPLAY, type Sev, type UtilKey, type Filters } from "./util";

const STATUS_CHIPS = [
  { k: "proposed", label: "Proposed" },
  { k: "approved", label: "Approved" },
  { k: "built", label: "Built" },
  { k: "withdrawn", label: "Withdrawn" },
];
const SIZE_CHIPS: { k: Sev; label: string }[] = [
  { k: "mega", label: "Mega" },
  { k: "high", label: "Large" },
  { k: "med", label: "Medium" },
  { k: "low", label: "Small" },
];
const UTIL_OPTS: [UtilKey | "all", string][] = [
  ["all", "All utilities"], ["aes", "AES Indiana"], ["duke", "Duke Energy"],
  ["im", "Indiana Michigan (I&M)"], ["nipsco", "NIPSCO"], ["cp", "CenterPoint"],
  ["other", "Co-op / Municipal"],
];

export interface ControlHandlers { select: (id: string) => void; }

export class Controls {
  private root: HTMLElement;
  private data: AppData;
  private map: GridMap;
  private h: ControlHandlers;
  private facs: Facility[];
  private status = new Set<string>();
  private size = new Set<string>();
  private utility: UtilKey | "all" = "all";

  constructor(root: HTMLElement, data: AppData, map: GridMap, h: ControlHandlers) {
    this.root = root; this.data = data; this.map = map; this.h = h;
    this.facs = data.facilities.facilities;
    this.render();
  }

  private render() {
    this.root.innerHTML = `
      <div class="ctrl-head">
        <span class="ctrl-title">◧ FILTER</span>
        <span class="ctrl-count"><b id="ctrl-count">—</b> shown · <b id="ctrl-mw">—</b> MW</span>
      </div>
      <div class="ctrl-search">
        <span class="s-ico">⌕</span>
        <input id="ctrl-input" type="text" autocomplete="off" spellcheck="false" placeholder="Find a county or facility…" aria-label="Search" />
        <div class="ctrl-results" id="ctrl-results"></div>
      </div>
      <div class="ctrl-group">
        <div class="ctrl-lab">Status</div>
        <div class="chips" data-group="status">
          <button class="chip on" data-all="1">All</button>
          ${STATUS_CHIPS.map((c) => `<button class="chip" data-val="${c.k}">${c.label}</button>`).join("")}
        </div>
      </div>
      <div class="ctrl-group">
        <div class="ctrl-lab">Size · MW</div>
        <div class="chips" data-group="size">
          <button class="chip on" data-all="1">All</button>
          ${SIZE_CHIPS.map((c) => `<button class="chip dot" data-val="${c.k}" style="--dot:${SEV_COLOR[c.k]}"><i></i>${c.label}</button>`).join("")}
        </div>
      </div>
      <div class="ctrl-group">
        <div class="ctrl-lab">Utility</div>
        <select id="ctrl-util" class="ctrl-select" aria-label="Filter by utility">
          ${UTIL_OPTS.map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}
        </select>
      </div>
      <div class="ctrl-foot">
        <span class="ctrl-lab" style="margin:0">Layers</span>
        <div class="lay-row">
          <button class="lay on" data-layer="transmission">grid</button>
          <button class="lay" data-layer="plants">plants</button>
          <button class="lay" data-layer="territories">utilities</button>
        </div>
      </div>`;

    this.wireChips("status", this.status);
    this.wireChips("size", this.size);
    this.root.querySelector<HTMLSelectElement>("#ctrl-util")!.addEventListener("change", (e) => {
      this.utility = (e.target as HTMLSelectElement).value as UtilKey | "all";
      this.apply();
    });
    this.root.querySelectorAll<HTMLElement>(".lay").forEach((b) =>
      b.addEventListener("click", () => {
        const on = b.classList.toggle("on");
        this.map.setLayerVisible(b.dataset.layer!, on);
      }));
    this.wireSearch();
    this.apply();
  }

  private wireChips(group: string, set: Set<string>) {
    const wrap = this.root.querySelector<HTMLElement>(`.chips[data-group="${group}"]`)!;
    const allBtn = wrap.querySelector<HTMLElement>("[data-all]")!;
    wrap.querySelectorAll<HTMLElement>("[data-val]").forEach((chip) =>
      chip.addEventListener("click", () => {
        const v = chip.dataset.val!;
        chip.classList.contains("on") ? set.delete(v) : set.add(v);
        chip.classList.toggle("on");
        allBtn.classList.toggle("on", set.size === 0);
        this.apply();
      }));
    allBtn.addEventListener("click", () => {
      set.clear();
      wrap.querySelectorAll(".chip").forEach((c) => c.classList.remove("on"));
      allBtn.classList.add("on");
      this.apply();
    });
  }

  private computeFilters(): Filters {
    const status: string[] = [];
    this.status.forEach((k) => k === "built" ? status.push("construction", "operational") : status.push(k));
    return { status, size: [...this.size] as Sev[], utility: this.utility };
  }

  private apply() {
    this.map.setFilters(this.computeFilters());
    this.updateCount();
  }

  updateCount() {
    const t = this.map.shownTotals();
    const c = this.root.querySelector<HTMLElement>("#ctrl-count");
    const m = this.root.querySelector<HTMLElement>("#ctrl-mw");
    if (c) c.textContent = fmtInt(t.nodes);
    if (m) m.textContent = fmtMW(t.total);
  }

  private wireSearch() {
    const input = this.root.querySelector<HTMLInputElement>("#ctrl-input")!;
    const results = this.root.querySelector<HTMLElement>("#ctrl-results")!;
    const counties = [...new Set(this.data.counties.features.map((f) => (f.properties as any).county as string))];
    const run = () => {
      const q = input.value.trim().toLowerCase();
      if (!q) { results.innerHTML = ""; results.classList.remove("on"); return; }
      const fac = this.facs.filter((f) => [f.name, f.city, f.county].some((s) => (s || "").toLowerCase().includes(q))).slice(0, 5);
      const cty = counties.filter((c) => (c || "").toLowerCase().includes(q)).slice(0, 3);
      results.innerHTML =
        cty.map((c) => `<div class="cr" data-county="${esc(c)}">◱ ${esc(c)} County</div>`).join("") +
        fac.map((f) => `<div class="cr" data-fac="${esc(f.id)}">${esc(f.name)}</div>`).join("");
      results.classList.toggle("on", results.children.length > 0);
      results.querySelectorAll<HTMLElement>("[data-fac]").forEach((el) =>
        el.addEventListener("click", () => { this.h.select(el.dataset.fac!); this.clearSearch(); }));
      results.querySelectorAll<HTMLElement>("[data-county]").forEach((el) =>
        el.addEventListener("click", () => { this.map.flyToCounty(el.dataset.county!); this.clearSearch(); }));
    };
    input.addEventListener("input", run);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") results.querySelector<HTMLElement>(".cr")?.click(); });
  }
  private clearSearch() {
    const input = this.root.querySelector<HTMLInputElement>("#ctrl-input")!;
    input.value = "";
    const r = this.root.querySelector<HTMLElement>("#ctrl-results")!;
    r.innerHTML = ""; r.classList.remove("on");
  }
}
