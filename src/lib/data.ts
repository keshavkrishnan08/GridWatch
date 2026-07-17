/* Data types + loader. All static JSON/GeoJSON is fetched once at boot. */

export interface Source { label: string; url: string; }

export interface Facility {
  id: string;
  name: string;
  developer: string;
  city: string;
  county: string;
  lat: number; lng: number;
  geo_precision: "parcel" | "site" | "city" | "county";
  status: "proposed" | "approved" | "construction" | "operational" | "rumored" | "withdrawn";
  mw_phase1: number | null;
  mw_full: number | null;
  mw_estimated: boolean;
  acres: number | null;
  investment_usd: number | null;
  water_mgd: number | null;
  water_status: "known" | "redacted" | "unknown";
  utility: string | null;
  iurc_docket: string | null;
  docket_url: string | null;
  announced_year: number;
  online_year: number | null;
  tax_note: string | null;
  sources: Source[];
  notes: string;
  last_verified: string;
}

export interface FacilitiesFile {
  schema_version: string;
  last_updated: string;
  coverage_note: string;
  primary_sources: Source[];
  facilities: Facility[];
}

export interface Meta {
  last_updated: string;
  state_peak_mw: number;
  counts: {
    facilities_curated: number;
    facilities_tracked_statewide: number;
    by_status: Record<string, number>;
    counties_with_projects: number;
    power_plants: number;
    transmission_lines: number;
    utility_territories: number;
    substations: number;
  };
  load_mw: {
    committed: number; proposed: number; active_total: number;
    withdrawn_avoided: number; pct_of_state_peak: number;
  };
  mega_facilities: { name: string; mw: number; county: string }[];
  generation_mix: { fuel: string; mw: number; pct: number }[];
  total_generation_mw: number;
  top_counties: { county: string; count: number; mw: number; utility: string | null }[];
  utilities: { utility: string; count: number; mw: number }[];
  sources: Record<string, string>;
}

export interface TimelineEvent {
  date: number; label: string; detail: string; kind: string;
  highlight?: boolean; off_scale?: boolean;
}
export interface TimelineFile {
  range: { start: number; end: number }; now: number; events: TimelineEvent[];
}

export interface UtilityModel {
  id: string; display_name: string; raw_match: string[];
  customers: number; avg_rate_cents_kwh: number;
  approved_increase: { pct: number; timing: string; source: Source };
  cost_shifts: { usd: number; label: string; docket: string | null }[];
  notes: string; sources: Source[];
}
export interface BillFile {
  disclaimer: string;
  statewide_context: { avg_bill_increase_this_year_pct: number; avg_bill_increase_decade_pct: number; source: Source };
  assumptions: { amortize_years: number; uncertainty_band_pct: number; typical_household_kwh: number };
  utilities: UtilityModel[];
}

export interface ActionItem {
  type: string; title: string; org: string; detail: string;
  action: string; url: string; deadline: string | null; priority: number; phone?: string;
}
export interface ActionFile { intro: string; items: ActionItem[]; }

export interface Docket {
  cause: string; title: string; utility: string; filed: string;
  status: string; decision_expected: string | null; ratepayer_note: string; sources: Source[];
}
export interface DocketFile { portal: string; note: string; dockets: Docket[]; }

export type FC = GeoJSON.FeatureCollection;

export interface AppData {
  facilities: FacilitiesFile;
  meta: Meta;
  timeline: TimelineFile;
  bill: BillFile;
  action: ActionFile;
  dockets: DocketFile;
  counties: FC;
  indiana: FC;
  powerPlants: FC;
  transmission: FC;
  territories: FC;
  substations: FC;
}

const BASE = import.meta.env.BASE_URL || "/";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}data/${path}`);
  if (!res.ok) throw new Error(`Failed to load ${path}: ${res.status}`);
  return res.json() as Promise<T>;
}

async function getFC(path: string): Promise<FC> {
  try { return await get<FC>(path); }
  catch { return { type: "FeatureCollection", features: [] }; }
}

export async function loadAll(): Promise<AppData> {
  const [
    facilities, meta, timeline, bill, action, dockets,
    counties, indiana, powerPlants, transmission, territories, substations,
  ] = await Promise.all([
    get<FacilitiesFile>("facilities.json"),
    get<Meta>("meta.json"),
    get<TimelineFile>("timeline_events.json"),
    get<BillFile>("bill_impact_models.json"),
    get<ActionFile>("action_items.json"),
    get<DocketFile>("dockets.json"),
    getFC("counties.geojson"),
    getFC("indiana.geojson"),
    getFC("power_plants.geojson"),
    getFC("transmission.geojson"),
    getFC("utility_territories.geojson"),
    getFC("substations.geojson"),
  ]);
  return { facilities, meta, timeline, bill, action, dockets, counties, indiana, powerPlants, transmission, territories, substations };
}
