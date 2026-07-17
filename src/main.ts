import "maplibre-gl/dist/maplibre-gl.css";
import "./styles/tokens.css";
import "./styles/app.css";

import { loadAll, type AppData } from "./lib/data";
import { GridMap } from "./lib/map";
import { Controls } from "./lib/controls";
import { Timeline } from "./lib/timeline";
import { Card } from "./lib/card";
import { Reticle } from "./lib/reticle";
import { openBillCalc, openAction, openAbout, closeModal } from "./lib/modals";

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
  selectedId: string | null = null;

  constructor(data: AppData) { this.data = data; }

  start() {
    const d = this.data;
    this.card = new Card($("card"), () => this.select(null));
    this.reticle = new Reticle($("reticle"), $("telemetry"));

    this.map = new GridMap("map", d, {
      onSelect: (id) => this.select(id),
      onHover: (f, pt) => { if (f && pt) this.reticle.show(f, pt); else this.reticle.hide(); },
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
    this.applyDeepLink();
  }

  select(id: string | null) {
    const f = id ? this.data.facilities.facilities.find((x) => x.id === id) ?? null : null;
    this.selectedId = f ? f.id : null;
    this.map.select(this.selectedId);
    if (f) { this.card.show(f); this.dismissHint(); }
    else { this.card.hide(); }
    this.syncUrl();
  }

  private wireTopbar() {
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
      if (county) this.map.flyToCounty(county);
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
