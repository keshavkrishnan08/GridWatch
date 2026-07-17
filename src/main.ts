import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/tokens.css";
import "./styles/app.css";

import { loadAll, type AppData } from "./lib/data";
import { GridMap } from "./lib/map";
import { Console } from "./lib/console";
import { Timeline } from "./lib/timeline";
import { Card } from "./lib/card";
import { Reticle } from "./lib/reticle";
import { openBillCalc, openAction, openAbout, closeModal } from "./lib/modals";
import { fmtInt, esc, safeUrl } from "./lib/format";
import { sevColor } from "./lib/util";

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

async function boot() {
  const bootLog = $("intro-boot");
  const bar = document.querySelector<HTMLElement>(".intro-bar > span")!;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const lines = [
    "ESTABLISHING UPLINK · IURC DOCKET FEED",
    "LOADING HIFLD TRANSMISSION GRID",
    "TRIANGULATING DATA-CENTER SITES",
    "SYNCING RATEPAYER IMPACT MODELS",
    "GRID INTELLIGENCE ONLINE",
  ];
  let li = 0;
  const tick = setInterval(() => {
    if (bootLog && li < lines.length) { bootLog.textContent = "› " + lines[li]; }
    bar.style.width = `${Math.min(100, (li / (lines.length - 1)) * 100)}%`;
    li++;
  }, reduce ? 90 : 380);

  let data: AppData;
  try {
    data = await loadAll();
  } catch (e) {
    clearInterval(tick);
    $("intro").innerHTML = `<div class="fatal">Failed to load data.<br><span class="mono" style="font-size:11px">${(e as Error).message}</span></div>`;
    return;
  }

  const app = new App(data);
  app.start();

  let introDone = false;
  const finishIntro = () => {
    if (introDone) return;
    introDone = true;
    clearInterval(tick);
    bar.style.width = "100%";
    $("intro").classList.add("done");
    setTimeout(() => { $("intro").style.display = "none"; app.maybeHint(); }, 720);
  };
  const minWait = reduce ? 200 : 1900;
  const introSkip = $("intro-skip");
  introSkip.addEventListener("click", finishIntro, { once: true });
  setTimeout(finishIntro, minWait);
}

class App {
  data: AppData;
  map!: GridMap;
  console!: Console;
  timeline!: Timeline;
  card!: Card;
  reticle!: Reticle;
  selectedId: string | null = null;

  constructor(data: AppData) { this.data = data; }

  start() {
    const d = this.data;
    // top bar
    $("pill-updated").textContent = `UPD ${d.meta.last_updated}`;

    this.card = new Card($("card"), () => this.select(null));
    this.reticle = new Reticle($("reticle"), $("telemetry"));

    this.map = new GridMap("map", d, {
      onSelect: (id) => this.select(id),
      onHover: (f, pt) => { if (f && pt) this.reticle.show(f, pt); else this.reticle.hide(); },
    }, d.timeline.now);

    this.console = new Console($("console"), d, this.map, {
      select: (id) => this.select(id),
      openBill: (u) => openBillCalc(d, u),
      openAction: () => openAction(d),
      openAbout: () => openAbout(d),
    });

    this.timeline = new Timeline($("timeline"), d, (y) => {
      this.map.setYear(y);
      this.console.updateReadout(y);
    });

    this.buildRail();
    this.wireTopbar();
    this.setupPanels();
    this.wireKeys();
    this.applyDeepLink();
  }

  select(id: string | null) {
    const f = id ? this.data.facilities.facilities.find((x) => x.id === id) ?? null : null;
    this.selectedId = f ? f.id : null; // never hold/emit an id that doesn't resolve
    this.map.select(this.selectedId);
    if (f) { this.card.show(f); this.dismissHint(); }
    else { this.card.hide(); }
    this.syncUrl();
  }

  private buildRail() {
    const d = this.data;
    const rail = $("rail");
    const c = d.meta.counts;
    const topAction = [...d.action.items].sort((a, b) => a.priority - b.priority).slice(0, 3);
    const layers: [string, string, number, string][] = [
      ["datacenters", "Data Centers", c.facilities_curated, "var(--load-high)"],
      ["withdrawn", "Withdrawn (ghosts)", c.by_status.withdrawn || 0, "var(--text-dim)"],
      ["transmission", "Transmission ≥138kV", c.transmission_lines, "var(--transmission)"],
      ["plants", "Power Plants", c.power_plants, "var(--fuel-gas)"],
      ["territories", "Utility Territories", c.utility_territories, "var(--util-duke)"],
    ];
    const initial = { datacenters: true, withdrawn: true, transmission: true, plants: true, territories: false } as Record<string, boolean>;
    rail.innerHTML = `
      <div class="panel bracket card-block">
        <div class="block-head"><h3>Layers</h3></div>
        ${layers.map(([k, name, n, col]) => `
          <div class="layer-row ${initial[k] ? "on" : ""}" data-layer="${k}">
            <span class="sw" style="background:${col};opacity:.85"></span>
            <span class="layer-name">${name}<span class="layer-count"> ${fmtInt(n)}</span></span>
            <span class="toggle"></span>
          </div>`).join("")}
      </div>
      <div class="panel bracket card-block">
        <div class="block-head"><h3>Load Scale</h3></div>
        <div class="legend-scale">
          <div class="ls-row"><span class="ls-dot" style="background:${sevColor(600)};box-shadow:0 0 10px ${sevColor(600)}"></span> &gt;500 MW · hyperscale</div>
          <div class="ls-row"><span class="ls-dot" style="background:${sevColor(300)}"></span> 250–500 MW</div>
          <div class="ls-row"><span class="ls-dot" style="background:${sevColor(100)}"></span> 50–250 MW</div>
          <div class="ls-row"><span class="ls-dot" style="background:${sevColor(20)}"></span> &lt;50 MW</div>
          <div class="ls-row"><span class="ls-dot" style="background:#6B7684"></span> capacity undisclosed</div>
        </div>
        <div class="mini-note">Node size ∝ megawatts. Magenta = off the scale Indiana's grid was built for.</div>
      </div>

      <div class="panel bracket card-block rail-act">
        <div class="block-head"><h3>Take Action</h3><span class="eyebrow">nonpartisan</span></div>
        ${topAction.map((it) => `
          <a class="r-item" href="${safeUrl(it.url)}" target="_blank" rel="noopener">
            <span class="r-type ${it.type === "decision" || it.type === "comment" ? "hot" : "go"}">${esc(it.type)}</span>
            <div class="r-title">${esc(it.title)}</div>
            ${it.deadline ? `<div class="r-dead">⏱ ${esc(it.deadline)}</div>` : ""}
          </a>`).join("")}
        <button class="r-all" id="rail-action-all">VIEW ALL · DOCKETS &amp; HEARINGS ▸</button>
      </div>`;

    rail.querySelector("#rail-action-all")!.addEventListener("click", () => openAction(this.data));
    rail.querySelectorAll<HTMLElement>(".layer-row").forEach((row) => {
      const key = row.dataset.layer!;
      this.map.setLayerVisible(key, initial[key]);
      row.addEventListener("click", () => {
        const on = row.classList.toggle("on");
        this.map.setLayerVisible(key, on);
      });
    });
  }

  private wireTopbar() {
    $("btn-about").addEventListener("click", () => openAbout(this.data));
    $("btn-share").addEventListener("click", async () => {
      this.syncUrl();
      const btn = $("btn-share");
      try {
        await navigator.clipboard.writeText(location.href);
        btn.textContent = "COPIED ✓";
        setTimeout(() => (btn.textContent = "SHARE"), 1600);
      } catch {
        btn.textContent = "COPY URL"; setTimeout(() => (btn.textContent = "SHARE"), 1600);
      }
    });
  }

  private setupPanels() {
    const toggle = (panel: string, collapseBtn: string, reopenBtn: string, collapsed: boolean) => {
      const p = $(panel);
      p.classList.toggle("collapsed", collapsed);
      p.inert = collapsed;
      $(collapseBtn).hidden = collapsed;
      $(reopenBtn).hidden = !collapsed;
      this.map.reframe();
    };
    $("console-collapse").addEventListener("click", () => toggle("console", "console-collapse", "console-reopen", true));
    $("console-reopen").addEventListener("click", () => toggle("console", "console-collapse", "console-reopen", false));
    $("rail-collapse").addEventListener("click", () => toggle("rail", "rail-collapse", "rail-reopen", true));
    $("rail-reopen").addEventListener("click", () => toggle("rail", "rail-collapse", "rail-reopen", false));
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
        e.preventDefault(); this.timeline.toggle();
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
    // wait for the map (centroids + layers) rather than a fixed timer
    this.map.whenReady(() => {
      if (fid && this.data.facilities.facilities.some((f) => f.id === fid)) this.select(fid);
      if (county) this.console.showCounty(county);
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
      <span class="hint-item"><kbd>DRAG</kbd> the timeline to watch the grid fill</span>
      <span class="hint-item"><kbd>CLICK</kbd> a node for its dossier</span>
      <span class="hint-item"><kbd>TYPE</kbd> your county to locate</span>
      <button class="hint-close" aria-label="Dismiss">✕</button>`;
    hint.querySelector(".hint-close")!.addEventListener("click", () => this.dismissHint());
    setTimeout(() => this.dismissHint(), 12000);
  }
  dismissHint() {
    const h = $("hint");
    if (!h.hidden) { h.hidden = true; localStorage.setItem("gw-hint", "1"); }
  }
}

boot();
