import type { AppData } from "./data";
import { totalsAt } from "./util";
import { fmtMW, fmtPct } from "./format";

export class Timeline {
  private root: HTMLElement;
  private data: AppData;
  private onYear: (y: number) => void;
  private start: number;
  private end: number;
  private year: number;
  private playing = false;
  private raf = 0;
  private lastT = 0;
  private track!: HTMLElement;
  private playhead!: HTMLElement;
  private fill!: HTMLElement;
  private label!: HTMLElement;

  constructor(root: HTMLElement, data: AppData, onYear: (y: number) => void) {
    this.root = root;
    this.data = data;
    this.onYear = onYear;
    this.start = data.timeline.range.start;
    this.end = data.timeline.range.end;
    this.year = data.timeline.now;
    this.render();
    this.setYear(this.year, true);
  }

  private pct(y: number) { return ((y - this.start) / (this.end - this.start)) * 100; }

  private render() {
    const evs = this.data.timeline.events.filter((e) => !e.off_scale);
    this.root.innerHTML = `
      <div class="tl-top">
        <button class="tl-play" id="tl-play" aria-label="Play timeline">▶</button>
        <div class="tl-counters">
          <div class="tl-counter"><div class="lab">Load Online</div><div class="val c-online" id="tl-online"><span class="n">—</span> <small>MW</small></div></div>
          <div class="tl-counter"><div class="lab">In Pipeline</div><div class="val c-pipeline" id="tl-pipeline"><span class="n">—</span> <small>MW</small></div></div>
          <div class="tl-counter"><div class="lab">% State Peak</div><div class="val c-year" id="tl-pct">—</div></div>
        </div>
        <div class="tl-counter tl-year-big"><div class="lab">Scrub Year</div><div class="val c-year" id="tl-year">2026</div></div>
      </div>
      <div class="tl-track-wrap" id="tl-wrap">
        <div class="tl-track"><div class="tl-fill" id="tl-fill"></div></div>
        <div class="tl-now" style="left:${this.pct(this.data.timeline.now)}%"></div>
        ${evs.map((e, i) => `<div class="tl-event ${e.highlight ? "highlight" : ""}" data-ev="${i}" style="left:${this.pct(e.date)}%" title="${e.label}"></div>`).join("")}
        <div class="tl-playhead" id="tl-playhead" style="left:${this.pct(this.year)}%"></div>
        <div class="tl-eventlabel" id="tl-evlabel"></div>
        <div class="tl-ticks">${this.ticks()}</div>
      </div>`;

    this.track = this.root.querySelector("#tl-wrap")!;
    this.playhead = this.root.querySelector("#tl-playhead")!;
    this.fill = this.root.querySelector("#tl-fill")!;
    this.label = this.root.querySelector("#tl-evlabel")!;

    this.root.querySelector("#tl-play")!.addEventListener("click", () => this.toggle());
    this.wireDrag();
    this.wireEvents(evs);
  }

  private ticks() {
    const out: string[] = [];
    for (let y = this.start; y <= this.end; y += 5)
      out.push(`<span class="tl-tick" style="position:absolute;left:${this.pct(y)}%;transform:translateX(-50%)">${y}</span>`);
    return out.join("");
  }

  private wireDrag() {
    const setFromX = (clientX: number) => {
      const r = this.track.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      this.setYear(this.start + p * (this.end - this.start));
    };
    let dragging = false;
    const down = (e: PointerEvent) => {
      dragging = true;
      this.pause();
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
      setFromX(e.clientX);
    };
    const move = (e: PointerEvent) => { if (dragging) setFromX(e.clientX); };
    const up = () => { dragging = false; };
    this.track.addEventListener("pointerdown", down);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    // keyboard on playhead
    this.playhead.tabIndex = 0;
    this.playhead.setAttribute("role", "slider");
    this.playhead.addEventListener("keydown", (e) => {
      if (e.key === "ArrowLeft") this.setYear(this.year - 0.25);
      else if (e.key === "ArrowRight") this.setYear(this.year + 0.25);
      else return;
      e.preventDefault();
    });
  }

  private wireEvents(evs: AppData["timeline"]["events"]) {
    this.root.querySelectorAll<HTMLElement>(".tl-event").forEach((el) => {
      const ev = evs[+el.dataset.ev!];
      const showLabel = () => {
        this.label.innerHTML = `<div class="el-date">${this.dateLabel(ev.date)} · ${ev.kind.toUpperCase()}</div><div>${ev.label}</div><div class="el-detail">${ev.detail}</div>`;
        this.label.style.left = `${this.pct(ev.date)}%`;
        this.label.style.transform = `translateX(${this.pct(ev.date) > 65 ? "-90%" : this.pct(ev.date) < 15 ? "-10%" : "-50%"})`;
        this.label.classList.add("on");
      };
      el.addEventListener("mouseenter", showLabel);
      el.addEventListener("mouseleave", () => this.label.classList.remove("on"));
      el.addEventListener("click", () => { this.setYear(ev.date); showLabel(); });
    });
  }

  private dateLabel(y: number) {
    const yr = Math.floor(y);
    const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
    const frac = y - yr;
    return Math.abs(frac) < 0.02 ? `${yr}` : `${months[Math.min(11, Math.floor(frac * 12))]} ${yr}`;
  }

  setYear(y: number, silent = false) {
    this.year = Math.min(this.end, Math.max(this.start, y));
    const p = this.pct(this.year);
    this.playhead.style.left = `${p}%`;
    this.fill.style.width = `${p}%`;
    const t = totalsAt(this.data.facilities.facilities, this.year);
    const pct = (t.total / this.data.meta.state_peak_mw) * 100;
    (this.root.querySelector("#tl-online .n") as HTMLElement).textContent = fmtMW(t.online);
    (this.root.querySelector("#tl-pipeline .n") as HTMLElement).textContent = fmtMW(t.pipeline);
    this.root.querySelector("#tl-pct")!.textContent = fmtPct(pct);
    this.root.querySelector("#tl-year")!.textContent = this.dateLabel(this.year);
    this.playhead.setAttribute("aria-valuenow", this.year.toFixed(1));
    if (!silent) this.onYear(this.year);
  }

  getYear() { return this.year; }

  toggle() { this.playing ? this.pause() : this.play(); }

  play() {
    if (this.playing) return;
    if (this.year >= this.end - 0.01) this.setYear(this.start);
    this.playing = true;
    this.root.querySelector("#tl-play")!.textContent = "❚❚";
    this.lastT = performance.now();
    const loop = (t: number) => {
      if (!this.playing) return;
      const dt = (t - this.lastT) / 1000;
      this.lastT = t;
      const next = this.year + dt * 4.6; // ~3.3s for full sweep
      if (next >= this.end) { this.setYear(this.end); this.pause(); return; }
      this.setYear(next);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause() {
    this.playing = false;
    cancelAnimationFrame(this.raf);
    const btn = this.root.querySelector("#tl-play");
    if (btn) btn.textContent = this.year >= this.end - 0.01 ? "↻" : "▶";
  }
}
