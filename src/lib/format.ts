/* Telemetry-grade number formatting. Everything here renders as monospace.
   Currency, area, and water units follow theme.json, so an international fork
   reads in its own units without touching code. */

import { theme } from "./theme";

/** Escape text before it goes into innerHTML. Cheap defense so forked datasets
 *  (the About panel invites PRs for other states) can't inject markup. */
const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string | null | undefined): string =>
  s == null ? "" : String(s).replace(/[&<>"']/g, (c) => ESC[c]);

/** Only allow http(s)/mailto in hrefs — blocks javascript: and data: URLs. */
export const safeUrl = (u: string | null | undefined): string => {
  const t = (u || "").trim();
  return /^(https?:|mailto:)/i.test(t) ? esc(t) : "#";
};

const loc = () => theme().units.locale || "en-US";

export const fmtInt = (n: number | null | undefined): string =>
  n == null ? "——" : Math.round(n).toLocaleString(loc());

export const fmtMW = (n: number | null | undefined): string =>
  n == null ? "——" : `${Math.round(n).toLocaleString(loc())}`;

/** Compact money in the region's currency (name kept for call-site stability). */
export function fmtUSD(n: number | null | undefined): string {
  if (n == null) return "——";
  const c = theme().units.currency.symbol || "$";
  const sign = n < 0 ? "-" : "";
  const a = Math.abs(n);
  if (a >= 1e12) return `${sign}${c}${(a / 1e12).toFixed(1)}T`;
  if (a >= 1e9) return `${sign}${c}${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${sign}${c}${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${sign}${c}${(a / 1e3).toFixed(0)}K`;
  return `${sign}${c}${Math.round(a)}`;
}

export const fmtPct = (n: number | null | undefined, d = 1): string =>
  n == null ? "——" : `${n.toFixed(d)}%`;

/** Water use. Source data is million gallons/day; converts if the region is metric. */
export const fmtGpd = (n: number | null | undefined): string => {
  if (n == null) return "——";
  if (theme().units.water === "m3d") {
    return `${Math.round(n * 3785.41).toLocaleString(loc())} m³/d`;
  }
  return `${n.toLocaleString(loc())} MGD`;
};

export function fmtCoord(lat: number, lng: number): string {
  const la = `${Math.abs(lat).toFixed(4)}°${lat >= 0 ? "N" : "S"}`;
  const lo = `${Math.abs(lng).toFixed(4)}°${lng >= 0 ? "E" : "W"}`;
  return `${la} ${lo}`;
}

/** Site area. Source data is acres; converts to hectares for metric regions. */
export const fmtAcres = (n: number | null | undefined): string => {
  if (n == null) return "——";
  if (theme().units.system === "metric") {
    return `${Math.round(n * 0.404686).toLocaleString(loc())} ha`;
  }
  return `${n.toLocaleString(loc())} ac`;
};

/** 2026.54 -> "JUL 2026" ; integer years -> "2026" ; unknown -> "—" */
export function fmtYear(y: number | null | undefined): string {
  if (y == null) return "—";
  const yr = Math.floor(y);
  const frac = y - yr;
  if (Math.abs(frac) < 0.02) return `${yr}`;
  const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const m = Math.min(11, Math.max(0, Math.floor(frac * 12)));
  return `${months[m]} ${yr}`;
}

export const STATUS_LABEL: Record<string, string> = {
  proposed: "PROPOSED",
  approved: "APPROVED",
  construction: "UNDER CONSTRUCTION",
  operational: "OPERATIONAL",
  rumored: "RUMORED",
  withdrawn: "WITHDRAWN",
};

/** compact "time since" for the verified date */
export function verifiedLabel(dateStr: string | null | undefined): string {
  return dateStr ? `SRC VERIFIED ${dateStr}` : "NOT YET SOURCE-VERIFIED";
}
