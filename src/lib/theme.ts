/* ------------------------------------------------------------------
   The visual + semantic toolkit.

   Everything that used to be an Indiana constant lives here as config:
   the load-severity scale and its colors, the fuel palette, the utilities
   that serve the region, units, and terminology.

   A fork edits public/data/theme.json (or lets the bootstrap generate it)
   and the whole atlas re-tunes — legend, node colors, filter chips, cards,
   stats. Nothing else needs touching.

   Defaults below reproduce Indiana exactly, so an unconfigured build is
   identical to the reference implementation.
   ------------------------------------------------------------------ */

export interface ScaleBand {
  key: string;        // stable id used by filters + CSS classes
  label: string;      // chip label, e.g. "Mega"
  /** upper bound in MW, exclusive; null = no ceiling (top band) */
  max: number | null;
  color: string;
}

export interface UtilityDef {
  id: string;
  display: string;
  color: string;
  /** lowercase substrings that identify this utility in raw data */
  match: string[];
}

export interface Units {
  system: "imperial" | "metric";
  currency: { code: string; symbol: string };
  /** water: "mgd" (US million gallons/day) or "m3d" (m³/day) */
  water: "mgd" | "m3d";
  locale: string;
}

export interface Terminology {
  /** what one clickable subdivision is called: county, département, council… */
  subdivision: string;
  subdivision_plural: string;
  /** who regulates utilities, e.g. "IURC" — used in civic copy */
  regulator: string | null;
  regulator_url: string | null;
  /** ratepayer advocate / comment venue, e.g. "OUCC" */
  consumer_advocate: string | null;
  consumer_advocate_url: string | null;
}

export interface JobsModel {
  /** permanent jobs per MW for data centers */
  datacenter: number;
  /** jobs per MW for comparison industry (set null to hide the comparison) */
  comparison: number | null;
  comparison_label: string;
  source: string | null;
}

export interface Theme {
  /** "fixed" uses `bands` as written; "auto" re-derives bounds from the data */
  scale_mode: "fixed" | "auto";
  bands: ScaleBand[];
  /** color for a site whose capacity is undisclosed */
  unknown_color: string;
  fuels: Record<string, { label: string; color: string }>;
  utilities: UtilityDef[];
  other_utility: { display: string; color: string };
  units: Units;
  terminology: Terminology;
  jobs: JobsModel;
}

/* ---------- defaults: Indiana, exactly as shipped ---------- */
export const DEFAULT_THEME: Theme = {
  scale_mode: "fixed",
  bands: [
    { key: "low", label: "Small", max: 50, color: "#3FB950" },
    { key: "med", label: "Medium", max: 250, color: "#E3A72B" },
    { key: "high", label: "Large", max: 500, color: "#F85149" },
    { key: "mega", label: "Mega", max: null, color: "#FF6BFF" },
  ],
  unknown_color: "#6B7684",
  fuels: {
    coal: { label: "Coal", color: "#B24A45" },
    gas: { label: "Gas", color: "#E3862B" },
    solar: { label: "Solar", color: "#EBCB3E" },
    wind: { label: "Wind", color: "#47C7B0" },
    nuclear: { label: "Nuclear", color: "#B06BE0" },
    hydro: { label: "Hydro", color: "#3D9BE0" },
    battery: { label: "Battery", color: "#3FB950" },
    oil: { label: "Oil", color: "#8A6A55" },
    biomass: { label: "Biomass", color: "#7F9A4E" },
    other: { label: "Other", color: "#6B7684" },
  },
  utilities: [
    { id: "aes", display: "AES Indiana", color: "#4E7BE8", match: ["aes", "indianapolis power"] },
    { id: "duke", display: "Duke Energy Indiana", color: "#4F9E6B", match: ["duke"] },
    { id: "im", display: "Indiana Michigan Power", color: "#C7743A", match: ["indiana michigan", "i&m", "i and m"] },
    { id: "nipsco", display: "NIPSCO", color: "#9A5BD0", match: ["nipsco", "northern indiana"] },
    { id: "cp", display: "CenterPoint Energy", color: "#C74A78", match: ["centerpoint", "vectren", "southern indiana gas"] },
  ],
  other_utility: { display: "Municipal / Cooperative", color: "#46586B" },
  units: {
    system: "imperial",
    currency: { code: "USD", symbol: "$" },
    water: "mgd",
    locale: "en-US",
  },
  terminology: {
    subdivision: "county",
    subdivision_plural: "counties",
    regulator: "IURC",
    regulator_url: "https://www.in.gov/iurc/",
    consumer_advocate: "OUCC",
    consumer_advocate_url: "https://www.in.gov/oucc/2504.htm",
  },
  jobs: {
    datacenter: 0.26,
    comparison: 41,
    comparison_label: "typical Indiana industry",
    source: "I&M 2024 disclosure",
  },
};

let active: Theme = DEFAULT_THEME;

export const theme = (): Theme => active;

/** Merge a partial theme (from theme.json) over the defaults. */
export function configureTheme(partial: Partial<Theme> | null | undefined) {
  if (!partial) return;
  active = {
    ...DEFAULT_THEME,
    ...partial,
    // keep nested shapes whole rather than half-overwritten
    bands: partial.bands?.length ? partial.bands : DEFAULT_THEME.bands,
    fuels: { ...DEFAULT_THEME.fuels, ...(partial.fuels || {}) },
    units: { ...DEFAULT_THEME.units, ...(partial.units || {}) },
    terminology: { ...DEFAULT_THEME.terminology, ...(partial.terminology || {}) },
    jobs: { ...DEFAULT_THEME.jobs, ...(partial.jobs || {}) },
    other_utility: { ...DEFAULT_THEME.other_utility, ...(partial.other_utility || {}) },
    utilities: partial.utilities?.length ? partial.utilities : DEFAULT_THEME.utilities,
  };
}

/**
 * Re-derive band bounds from the actual capacities present.
 *
 * A county's build-out and a country's are orders of magnitude apart; fixed
 * Indiana thresholds would paint every site in one color. With scale_mode
 * "auto" the bands are spread across the observed distribution (quantiles),
 * keeping colors meaningful at any scale. Labels and colors are preserved.
 */
export function autoScale(capacities: number[]) {
  if (active.scale_mode !== "auto") return;
  const mw = capacities.filter((v) => v > 0).sort((a, b) => a - b);
  if (mw.length < 4) return;                       // too little data to infer
  const q = (p: number) => mw[Math.min(mw.length - 1, Math.floor(p * mw.length))];
  const cuts = [q(0.4), q(0.7), q(0.9)].map((v) => Math.max(1, Math.round(v)));
  // strictly increasing bounds, top band always open-ended
  const bands = active.bands.slice(0, 4);
  for (let i = 0; i < bands.length - 1; i++) {
    const prev = i === 0 ? 0 : (bands[i - 1].max ?? 0);
    bands[i] = { ...bands[i], max: Math.max(prev + 1, cuts[i] ?? prev + 1) };
  }
  bands[bands.length - 1] = { ...bands[bands.length - 1], max: null };
  active = { ...active, bands };
}

/* ---------- terminology helpers ---------- */
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** "County" / "Département" — the singular subdivision noun, title-cased. */
export const subName = () => titleCase(active.terminology.subdivision);
/** "counties" / "départements" — plural, lowercase. */
export const subPlural = () => active.terminology.subdivision_plural;
/**
 * Suffix form used after a name: "Boone County".
 * Regions whose subdivisions don't take a suffix (e.g. "Bavaria") can set
 * subdivision to "" in theme.json and the suffix disappears.
 */
export const withSub = (name: string) => {
  const t = active.terminology.subdivision.trim();
  return t ? `${name} ${titleCase(t)}` : name;
};
