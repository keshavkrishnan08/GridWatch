import type { Facility } from "./data";
import {
  fmtMW, fmtUSD, fmtAcres, fmtCoord, fmtYear, fmtGpd, STATUS_LABEL, verifiedLabel, esc, safeUrl,
} from "./format";
import { sevColor, sevClass, utilKey, UTIL_DISPLAY } from "./util";

export class Card {
  private root: HTMLElement;
  private onClose: () => void;
  constructor(root: HTMLElement, onClose: () => void) {
    this.root = root;
    this.onClose = onClose;
    this.root.inert = true; // keep the closed card out of the tab order + a11y tree
  }

  show(f: Facility) {
    const mw = f.mw_full ?? f.mw_phase1 ?? 0;
    const col = sevColor(mw);
    const utilName = f.utility
      ? (utilKey(f.utility) !== "other" ? UTIL_DISPLAY[utilKey(f.utility)] : f.utility)
      : "—";

    const mwCell = (() => {
      if (!mw) return `<div class="v">—</div>`;
      const est = f.mw_estimated ? ` <span class="redaction-chip">EST</span>` : "";
      if (f.mw_phase1 && f.mw_full && f.mw_phase1 !== f.mw_full)
        return `<div class="v">${fmtMW(f.mw_full)}<small> MW full</small>${est}</div><div class="k" style="margin-top:4px">Phase 1: ${fmtMW(f.mw_phase1)} MW</div>`;
      return `<div class="v">${fmtMW(mw)}<small> MW</small>${est}</div>`;
    })();

    const waterCell = f.water_status === "known"
      ? `<div class="v">${fmtGpd(f.water_mgd)}</div>`
      : f.water_status === "redacted"
        ? `<div class="v redacted">◈ DEVELOPER-REDACTED</div>`
        : `<div class="v redacted" style="color:var(--text-dim)">NOT DISCLOSED</div>`;

    const geoNote = f.geo_precision === "parcel" ? "parcel"
      : f.geo_precision === "site" ? "approx. site" : f.geo_precision === "city" ? "city-level" : "county-level";

    this.root.className = "";
    this.root.style.setProperty("--sev", col);
    this.root.innerHTML = `
      <div class="card-top">
        <div class="card-sev-bar"></div>
        <button class="card-close" aria-label="Close">✕</button>
        <span class="card-status ${sevClass(mw)}">${STATUS_LABEL[f.status] ?? "TRACKED"}</span>
        <h2 class="card-name">${esc(f.name)}</h2>
        <div class="card-loc">${esc(f.city)}, ${esc(f.county)} County · ${fmtCoord(f.lat, f.lng)} <span style="color:var(--text-faint)">(${geoNote})</span></div>
      </div>
      <div class="card-body">
        <div class="stat-grid">
          <div class="stat"><div class="k">Power Draw</div>${mwCell}</div>
          <div class="stat"><div class="k">Water Use</div>${waterCell}</div>
          <div class="stat"><div class="k">Site</div><div class="v">${fmtAcres(f.acres)}</div></div>
          <div class="stat"><div class="k">Investment</div><div class="v">${fmtUSD(f.investment_usd)}</div></div>
        </div>

        <div class="card-row"><span class="rk">Developer</span><span class="rv">${esc(f.developer)}</span></div>
        <div class="card-row"><span class="rk">Utility</span><span class="rv">${esc(utilName)}</span></div>
        <div class="card-row"><span class="rk">Projected energization</span><span class="rv">${f.online_year ? "~" + f.online_year + " (est.)" : "—"}</span></div>
        <div class="card-row"><span class="rk">First tracked</span><span class="rv">${fmtYear(f.announced_year)}</span></div>
        ${f.iurc_docket ? `<div class="card-row"><span class="rk">IURC Cause</span><span class="rv mono">${esc(f.iurc_docket)}</span></div>` : ""}

        ${f.notes ? `<div class="card-notes">${esc(f.notes)}</div>` : ""}
        ${f.tax_note ? `<div class="card-row"><span class="rk">Incentives</span><span class="rv" style="max-width:60%">${esc(f.tax_note)}</span></div>` : ""}

        ${(f.water_status === "redacted" || f.mw_estimated)
          ? `<div class="mini-note" style="margin-top:12px"><span class="redaction-chip">◈ TRANSPARENCY</span> ${[
              f.water_status === "redacted" ? "Water usage is redacted in public filings." : "",
              f.mw_estimated ? "Capacity is estimated from public reporting, not a filed figure." : "",
            ].filter(Boolean).join(" ")}</div>`
          : ""}

        <div class="card-sources">
          <span class="eyebrow">Sources · every figure is traceable</span>
          ${f.sources.map((s) => `<a class="src-link" href="${safeUrl(s.url)}" target="_blank" rel="noopener">${esc(s.label)}</a>`).join("")}
        </div>
        ${f.docket_url ? `<a class="docket-btn" href="${safeUrl(f.docket_url)}" target="_blank" rel="noopener">⎋ OPEN IURC DOCKET PORTAL${f.iurc_docket ? " · CAUSE " + esc(f.iurc_docket) : ""}</a>` : ""}
        <div class="verified">${verifiedLabel(f.last_verified)}</div>
      </div>`;

    this.root.querySelector(".card-close")!.addEventListener("click", () => this.onClose());
    this.root.inert = false;
    requestAnimationFrame(() => this.root.classList.add("on"));
  }

  hide() { this.root.classList.remove("on"); this.root.inert = true; }
}
