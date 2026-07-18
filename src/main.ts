import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/tokens.css";
import "./styles/app.css";

import { loadAll, type AppData } from "./lib/data";
import { GridMap } from "./lib/map";
import { Controls } from "./lib/controls";
import { Timeline } from "./lib/timeline";
import { Card } from "./lib/card";
import { Reticle } from "./lib/reticle";
import { Newsletter } from "./lib/newsletter";
import { openBillCalc, openAction, openAbout, openStats, openImpact, openLetter, closeModal } from "./lib/modals";
import { servingUtility, UTIL_DISPLAY } from "./lib/util";
import { fmtMW, esc } from "./lib/format";
import { track, initAnalytics } from "./lib/track";
import { configureTheme, autoScale, subName, withSub, theme } from "./lib/theme";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function boot() {
  const bootLog = $("intro-boot");
  const bar = document.querySelector<HTMLElement>(".intro-bar > span")!;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lines = [
    "ESTABLISHING UPLINK · IURC DOCKET FEED",
    "LOADING HIFLD TRANSMISSION GRID",
    "TRIANGULATING DATA-CENTER SITES",
    "GRID INTELLIGENCE ONLINE",
  ];
  let li = 0;
  const tick = setInterval(() => {
    if (bootLog && li < lines.length) bootLog.textContent = "› " + lines[li];
    bar.style.width = `${Math.min(100, (li / (lines.length - 1)) * 100)}%`;
    li++;
  }, reduce ? 90 : 400);

  let data: AppData;
  try { data = await loadAll(); }
  catch (e) {
    clearInterval(tick);
    $("intro").innerHTML = `<div class="fatal">Failed to load data.<br><span class="mono" style="font-size:11px">${(e as Error).message}</span></div>`;
    return;
  }

  // Theme first: colors, scale bands, units and terminology must be live
  // before any component reads them.
  configureTheme(data.theme);
  autoScale(data.facilities.facilities.map((f) => f.mw_full ?? f.mw_phase1 ?? 0));

  initAnalytics();
  const app = new App(data);
  app.start();

  let introDone = false;
  const finishIntro = () => {
    if (introDone) return;
    introDone = true;
    clearInterval(tick);
    bar.style.width = "100%";
    $("intro").classList.add("done");
    setTimeout(() => { $("intro").style.display = "none"; app.maybeHint(); app.newsletter.maybeShow(); }, 720);
  };
  $("intro-skip").addEventListener("click", finishIntro, { once: true });
  setTimeout(finishIntro, reduce ? 200 : 1700);
}

class App {
  data: AppData;
  map!: GridMap;
  controls!: Controls;
  timeline!: Timeline;
  card!: Card;
  reticle!: Reticle;
  newsletter!: Newsletter;
  selectedId: string | null = null;

  constructor(data: AppData) { this.data = data; }

  start() {
    const d = this.data;
    this.applyBranding();
    this.card = new Card($("card"), () => this.select(null));
    this.reticle = new Reticle($("reticle"), $("telemetry"));
    this.newsletter = new Newsletter($("newsletter"));

    this.map = new GridMap("map", d, {
      onSelect: (id) => this.select(id),
      onHover: (f, pt) => { if (f && pt) this.reticle.show(f, pt); else this.reticle.hide(); },
      onCounty: (county, lngLat) => { if (county) this.showCounty(county, lngLat); else this.select(null); },
    }, d.timeline.now);

    this.controls = new Controls($("controls"), d, this.map, { select: (id) => this.select(id) });

    this.timeline = new Timeline($("timeline"), d, (y) => {
      this.map.setYear(y);
      this.controls.updateCount();
    });

    // minimalist defaults: nodes + subtle grid, no plant/territory clutter
    this.map.whenReady(() => {
      this.map.setLayerVisible("transmission", true);
      this.map.setLayerVisible("plants", false);
      this.map.setLayerVisible("territories", false);
      this.controls.updateCount();
    });

    this.wireTopbar();
    this.setupPanels();
    this.wireKeys();
    this.setupActions();
    this.applyDeepLink();
  }

  /** Re-brand the header + tab from region.json so forks only edit config. */
  private applyBranding() {
    const r = this.data.region;
    const sub = document.querySelector(".brand-sub");
    const tag = document.querySelector(".brand-tag");
    if (sub) sub.textContent = ` / ${r.region_label}`;
    if (tag) tag.textContent = r.tagline;
    if (r.name) document.title = r.name;
  }

  /** Delegated handlers for the civic-action links sprinkled through cards/modals. */
  private setupActions() {
    document.addEventListener("click", (e) => {
      const t = e.target as HTMLElement;
      const lf = t.closest<HTMLElement>("[data-letter-fac]");
      if (lf) { const f = this.data.facilities.facilities.find((x) => x.id === lf.dataset.letterFac); if (f) openLetter(this.data, { facility: f }); return; }
      const lc = t.closest<HTMLElement>("[data-letter-cty]");
      if (lc) { openLetter(this.data, { county: lc.dataset.letterCty! }); return; }
      const cv = t.closest<HTMLElement>("[data-civic]");
      if (cv) track("civic_click", { target: cv.dataset.civic });
    });
  }

  select(id: string | null) {
    const f = id ? this.data.facilities.facilities.find((x) => x.id === id) ?? null : null;
    this.selectedId = f ? f.id : null;
    this.map.select(this.selectedId);
    if (f) { this.card.show(f); this.dismissHint(); track("facility_view", { id: f.id, status: f.status, mw: f.mw_full ?? f.mw_phase1 ?? 0 }); }
    else { this.card.hide(); }
    this.syncUrl();
  }

  showCounty(county: string, lngLat: [number, number]) {
    this.selectedId = null;
    this.map.select(null);
    track("county_view", { county });
    const d = this.data;
    const util = servingUtility(lngLat, d.territories);
    const key = util ? util.key : "other";
    const utilName = util ? (key !== "other" ? UTIL_DISPLAY[key] : util.name.replace(/\b\w/g, (c) => c.toUpperCase())) : "Multiple / cooperative";
    const inCounty = d.facilities.facilities.filter((f) => f.county === county && f.status !== "withdrawn");
    const totalMW = inCounty.reduce((s, f) => s + (f.mw_full ?? f.mw_phase1 ?? 0), 0);
    const restr = d.restrictions.counties.find((c) => c.name.toLowerCase() === county.toLowerCase());
    const label = restr ? (restr.type === "ban" ? "BANNED" : "MORATORIUM") : "NO RESTRICTION";
    const col = restr ? (restr.type === "ban" ? "#F85149" : "#E3A72B") : "#3FB950";
    const model = util ? d.bill.utilities.find((u) => u.id === (key === "cp" ? "centerpoint" : key)) : null;
    this.card.showContent(col, `
      <div class="card-top">
        <div class="card-sev-bar" style="background:${col}"></div>
        <button class="card-close" aria-label="Close">✕</button>
        <span class="card-status" style="border-color:${col};color:${col}">◱ ${label}</span>
        <h2 class="card-name">${esc(withSub(county))}</h2>
        <div class="card-loc">Served by ${esc(utilName)}</div>
      </div>
      <div class="card-body">
        <div class="stat-grid">
          <div class="stat"><div class="k">Data centers</div><div class="v">${inCounty.length}</div></div>
          <div class="stat"><div class="k">Combined load</div><div class="v">${fmtMW(totalMW)}<small> MW</small></div></div>
        </div>
        ${restr ? `<div class="card-notes" style="border-color:${col}"><b>${label}.</b> ${esc(restr.detail)}</div>` : ""}
        ${inCounty.length
          ? `<div class="card-sources"><span class="eyebrow">Data centers here</span>${inCounty.map((f) => `<a class="src-link" style="cursor:pointer" data-fac="${esc(f.id)}">${esc(f.name)} · ${fmtMW(f.mw_full ?? f.mw_phase1)} MW</a>`).join("")}</div>`
          : `<div class="mini-note" style="margin-top:12px">No tracked data centers in this county — yet.</div>`}
        ${model ? `<button class="docket-btn" id="cty-bill">▤ PROJECT MY BILL IMPACT · ${esc(model.display_name)}</button>` : ""}
        <div class="card-action" style="margin-top:11px">
          <span class="eyebrow">Get involved</span>
          <a class="act-link hot" data-letter-cty="${esc(county)}">✉ Write your official about ${esc(withSub(county))}</a>
          <a class="act-link" data-civic="cac" href="https://www.citact.org/cac-email-sign-up" target="_blank" rel="noopener">◈ Citizens Action Coalition — join &amp; get alerts</a>
          <a class="act-link" data-civic="county" href="${theme().terminology.regulator_url || "#"}" target="_blank" rel="noopener">◱ ${esc(withSub(county))} meetings &amp; the public process</a>
        </div>
        <div class="verified">TAP ANY ${esc(subName().toUpperCase())} FOR ITS PROFILE</div>
      </div>`);
    const el = document.getElementById("card")!;
    el.querySelectorAll<HTMLElement>("[data-fac]").forEach((a) => a.addEventListener("click", () => this.select(a.dataset.fac!)));
    el.querySelector("#cty-bill")?.addEventListener("click", () => openBillCalc(this.data, model!.id));
    this.dismissHint();
  }

  private wireTopbar() {
    $("btn-impact").addEventListener("click", () => openImpact(this.data));
    $("btn-stats").addEventListener("click", () => openStats(this.data));
    $("btn-bill").addEventListener("click", () => openBillCalc(this.data));
    $("btn-action").addEventListener("click", () => openAction(this.data));
    $("btn-about").addEventListener("click", () => openAbout(this.data));
    $("btn-share").addEventListener("click", async () => {
      this.syncUrl();
      const btn = $("btn-share");
      const prev = btn.textContent;
      try { await navigator.clipboard.writeText(location.href); btn.textContent = "✓"; }
      catch { btn.textContent = "⧉"; }
      setTimeout(() => (btn.textContent = prev), 1500);
      track("share", { kind: this.selectedId ? "facility" : "map" });
    });
  }

  private setupPanels() {
    const toggle = (collapsed: boolean) => {
      const p = $("controls");
      p.classList.toggle("collapsed", collapsed);
      p.inert = collapsed;
      $("controls-collapse").hidden = collapsed;
      $("controls-reopen").hidden = !collapsed;
      this.map.reframe();
    };
    $("controls-collapse").addEventListener("click", () => toggle(true));
    $("controls-reopen").addEventListener("click", () => toggle(false));
  }

  private wireKeys() {
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        if (!$("modal-root").hidden) closeModal();
        else if (this.selectedId) this.select(null);
      }
      const tgt = e.target as HTMLElement;
      const interactive = /^(INPUT|BUTTON|SELECT|TEXTAREA|A)$/.test(tgt.tagName) || tgt.isContentEditable;
      if (e.key === " " && !interactive && $("modal-root").hidden) {
        e.preventDefault();
        this.timeline.toggle();
      }
    });
  }

  private applyDeepLink() {
    const p = new URLSearchParams(location.search);
    const y = parseFloat(p.get("y") || "");
    if (!isNaN(y)) this.timeline.setYear(y);
    const fid = p.get("f");
    const county = p.get("c");
    if (!fid && !county) return;
    this.map.whenReady(() => {
      if (fid && this.data.facilities.facilities.some((f) => f.id === fid)) this.select(fid);
      if (county) { const c = this.map.flyToCounty(county); if (c) this.showCounty(county, c); }
    });
  }

  private syncUrl() {
    const p = new URLSearchParams();
    const y = this.timeline.getYear();
    if (Math.abs(y - this.data.timeline.now) > 0.05) p.set("y", y.toFixed(2));
    if (this.selectedId) p.set("f", this.selectedId);
    const qs = p.toString();
    history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
  }

  maybeHint() {
    if (localStorage.getItem("gw-hint") === "1") return;
    const hint = $("hint");
    hint.hidden = false;
    hint.innerHTML = `
      <span class="hint-item"><kbd>FILTER</kbd> by status, size &amp; utility</span>
      <span class="hint-item"><kbd>DRAG</kbd> the timeline to scrub 2020–2035</span>
      <span class="hint-item"><kbd>CLICK</kbd> a node for details</span>
      <button class="hint-close" aria-label="Dismiss">✕</button>`;
    hint.querySelector(".hint-close")!.addEventListener("click", () => this.dismissHint());
    setTimeout(() => this.dismissHint(), 11000);
  }
  dismissHint() {
    const h = $("hint");
    if (!h.hidden) { h.hidden = true; localStorage.setItem("gw-hint", "1"); }
  }
}

boot();
