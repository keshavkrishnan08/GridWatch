import type { Facility } from "./data";
import { fmtMW, STATUS_LABEL } from "./format";
import { sevColor, utilKey, UTIL_DISPLAY } from "./util";

export class Reticle {
  private ret: HTMLElement;
  private tel: HTMLElement;
  constructor(ret: HTMLElement, tel: HTMLElement) {
    this.ret = ret;
    this.tel = tel;
  }

  show(f: Facility, pt: { x: number; y: number }) {
    const mw = f.mw_full ?? f.mw_phase1 ?? 0;
    const col = sevColor(mw);
    this.ret.style.left = `${pt.x}px`;
    this.ret.style.top = `${pt.y}px`;
    this.ret.style.setProperty("--sev", col);
    (this.ret.style as any).borderColor = col;
    this.ret.classList.add("on");

    const util = f.utility ? (utilKey(f.utility) !== "other" ? UTIL_DISPLAY[utilKey(f.utility)] : f.utility) : "—";
    const water = f.water_status === "known" ? `${f.water_mgd} MGD`
      : f.water_status === "redacted" ? "REDACTED" : "N/D";
    this.tel.style.setProperty("--sev", col);
    this.tel.innerHTML = `
      <div class="tel-name">${f.name}</div>
      <div class="tel-grid">
        <span class="tel-k">LOAD</span><span class="tel-v">${mw ? fmtMW(mw) + " MW" : "N/D"}</span>
        <span class="tel-k">STATUS</span><span class="tel-v">${STATUS_LABEL[f.status]}</span>
        <span class="tel-k">UTILITY</span><span class="tel-v" style="color:var(--text-mid)">${util}</span>
        <span class="tel-k">WATER</span><span class="tel-v" style="color:${f.water_status === "redacted" ? "var(--warning)" : "var(--text-mid)"}">${water}</span>
      </div>
      <div class="tel-hint">▸ CLICK NODE FOR FULL DOSSIER</div>`;

    const w = window.innerWidth, offset = 34;
    const right = pt.x + offset + 190 > w;
    this.tel.style.left = `${right ? pt.x - offset - 190 : pt.x + offset}px`;
    this.tel.style.top = `${Math.max(60, pt.y - 30)}px`;
    this.tel.classList.add("on");
  }

  hide() {
    this.ret.classList.remove("on");
    this.tel.classList.remove("on");
  }
}
