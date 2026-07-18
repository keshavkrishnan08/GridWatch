import type { Facility } from "./data";
import {
  fmtMW, fmtUSD, fmtAcres, fmtCoord, fmtYear, fmtGpd, fmtInt, STATUS_LABEL, verifiedLabel, esc, safeUrl,
} from "./format";
import { sevColor, sevClass, utilKey, UTIL_DISPLAY, jobsModel } from "./util";
import { withSub, theme } from "./theme";

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

    const jm = jobsModel();
    const jobs = f.jobs ?? (mw ? Math.round(mw * jm.datacenter) : null);
    const otherJobs = mw && jm.comparison ? Math.round(mw * jm.comparison) : null;
    const impactRows = [
      jobs != null ? `<div class="card-row"><span class="rk">Permanent jobs</span><span class="rv">${fmtInt(jobs)}${f.jobs == null ? ` <span style="color:var(--text-faint)">est · ${jm.datacenter}/MW</span>` : ""}</span></div>` : "",
      f.water_source ? `<div class="card-row"><span class="rk">Water source</span><span class="rv" style="max-width:58%">${esc(f.water_source)}</span></div>` : "",
      f.diesel_generators ? `<div class="card-row"><span class="rk">Backup diesel</span><span class="rv" style="color:var(--warning)">${fmtInt(f.diesel_generators)} gens${f.diesel_gallons_m ? ` · ${f.diesel_gallons_m}M gal` : ""}</span></div>` : "",
      f.wetland_acres ? `<div class="card-row"><span class="rk">Wetland destroyed</span><span class="rv" style="color:var(--warning)">${f.wetland_acres} acres</span></div>` : "",
    ].join("");
    const jobsCompare = otherJobs
      ? `<div class="mini-note" style="margin-top:8px">At <b>${jm.comparison} jobs/MW</b> (${esc(jm.comparison_label)}) this ${fmtMW(mw)} MW would support ~<b>${fmtInt(otherJobs)}</b> jobs; data centers average <b>~${jm.datacenter} jobs/MW</b>.</div>`
      : "";
    const impactBlock = (impactRows || jobsCompare)
      ? `<div class="card-impact"><span class="eyebrow">Local impact</span>${impactRows}${jobsCompare}</div>` : "";

    const chatterBlock = f.status === "rumored"
      ? `<div class="card-chatter">◌ CHATTER — reported but <b>unconfirmed</b>. No filing or named operator yet; any figures come from reporting or grid trackers, not filed records.</div>`
      : "";

    const prospective = ["proposed", "approved", "rumored"].includes(f.status);
    const involveBlock = f.status === "withdrawn"
      ? `<div class="card-action">
          <span class="eyebrow">Withdrawn after public opposition</span>
          <a class="act-link" data-civic="cac-story" href="https://www.citact.org/ai-data-centers" target="_blank" rel="noopener">◈ How residents pushed back — Citizens Action Coalition</a>
        </div>`
      : `<div class="card-action">
          <span class="eyebrow">Get involved${prospective ? " · this one is still in play" : ""}</span>
          <a class="act-link hot" data-letter-fac="${esc(f.id)}">✉ Write your official about this project</a>
          <a class="act-link" data-civic="cac" href="https://www.citact.org/cac-email-sign-up" target="_blank" rel="noopener">◈ Citizens Action Coalition — join &amp; get alerts</a>
          <a class="act-link" data-civic="oucc" href="${theme().terminology.consumer_advocate_url || "#"}" target="_blank" rel="noopener">✎ File a public comment on ${f.iurc_docket ? "Cause " + esc(f.iurc_docket) : "this case"}${theme().terminology.consumer_advocate ? " (" + esc(theme().terminology.consumer_advocate) + ")" : ""}</a>
        </div>`;

    this.root.className = "";
    this.root.style.setProperty("--sev", col);
    this.root.innerHTML = `
      <div class="card-top">
        <div class="card-sev-bar"></div>
        <button class="card-close" aria-label="Close">✕</button>
        <span class="card-status ${sevClass(mw)}">${STATUS_LABEL[f.status] ?? "TRACKED"}</span>
        <h2 class="card-name">${esc(f.name)}</h2>
        <div class="card-loc">${esc(f.city)}, ${esc(withSub(f.county))} · ${fmtCoord(f.lat, f.lng)} <span style="color:var(--text-faint)">(${geoNote})</span></div>
      </div>
      <div class="card-body">
        ${chatterBlock}
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

        ${impactBlock}

        ${f.notes ? `<div class="card-notes">${esc(f.notes)}</div>` : ""}
        ${f.tax_note ? `<div class="card-row"><span class="rk">Incentives</span><span class="rv" style="max-width:60%">${esc(f.tax_note)}</span></div>` : ""}

        ${(f.water_status === "redacted" || f.mw_estimated)
          ? `<div class="mini-note" style="margin-top:12px"><span class="redaction-chip">◈ TRANSPARENCY</span> ${[
              f.water_status === "redacted" ? "Water usage is redacted in public filings." : "",
              f.mw_estimated ? "Capacity is estimated from public reporting, not a filed figure." : "",
            ].filter(Boolean).join(" ")}</div>`
          : ""}

        ${involveBlock}

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

  /** Render arbitrary card content (used for the county profile). */
  showContent(sev: string, html: string) {
    this.root.className = "";
    this.root.style.setProperty("--sev", sev);
    this.root.innerHTML = html;
    this.root.querySelector(".card-close")?.addEventListener("click", () => this.onClose());
    this.root.inert = false;
    requestAnimationFrame(() => this.root.classList.add("on"));
  }

  hide() { this.root.classList.remove("on"); this.root.inert = true; }
}
