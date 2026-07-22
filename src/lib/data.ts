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
  water_source?: string | null;
  jobs?: number | null;
  diesel_generators?: number | null;
  diesel_gallons_m?: number | null;
  wetland_acres?: number | null;
  utility: string | null;
  iurc_docket: string | null;
  docket_url: string | null;
  announced_year: number | null;
  online_year: number | null;
  tax_note: string | null;
  sources: Source[];
  notes: string;
  last_verified: string | null;
  /** "colocation" = a network/interconnection site, not a hyperscale campus. */
  facility_class?: string | null;
  /** "pending" = auto-discovered, not yet checked against a filing by a human. */
  verification?: string | null;
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
  state_peak_mw: number | null;
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
    withdrawn_avoided: number; pct_of_state_peak: number | null;
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
  /** RESIDENTIAL customers (not total meters) — the denominator for per-household cost. */
  customers: number;
  avg_rate_cents_kwh: number; typical_bill_1000kwh: number;
  /** Real tariff structure, when known: a fixed monthly charge plus a volumetric
   *  rate. Modelling both makes low- and high-usage households come out right,
   *  where a single blended rate would misstate them. Falls back to
   *  avg_rate_cents_kwh when absent. */
  fixed_charge_monthly?: number | null;
  energy_rate_cents_kwh?: number | null;
  /** Residential share of the utility's retail revenue (EIA-861). Infrastructure
   *  costs are spread across all classes, so only this share reaches residential bills. */
  residential_revenue_share_pct?: number | null;
  recent_increase: { pct: number; period: string; source: Source };
  cost_shifts: { usd: number; label: string; docket: string | null }[];
  notes: string; sources: Source[];
}
export interface BillFile {
  disclaimer: string;
  equation: string;
  statewide_context: { avg_bill_increase_this_year_pct: number; avg_bill_increase_decade_pct: number; avg_rate_cents_kwh: number; source: Source };
  assumptions: {
    amortize_years: number;
    uncertainty_band_pct: number;
    typical_household_kwh: number;
    /* Revenue-requirement inputs. When carrying_charge_pct is present the model
       uses it instead of straight-line amortization — see project() in modals.ts. */
    carrying_charge_pct?: number | null;
    residential_allocation_pct?: number | null;
  };
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

export interface CountyRestriction { name: string; type: "ban" | "moratorium"; detail: string; }
export interface RestrictionFile { note: string; sources: Source[]; counties: CountyRestriction[]; }

/* Region config — de-hardcodes Indiana so the atlas can be forked for any
   state / country / region. Everything the map needs to frame + label a
   region lives here; bounds are derived from the boundary polygon. */
export interface RegionConfig {
  name: string;
  region_label: string;
  tagline: string;
  boundary_file: string;
  subdivisions_file: string;
  subdivision_key: string;
  subdivision_singular: string;
  home_center: [number, number] | null;
  home_zoom_boost: number;
  min_zoom: number;
  max_zoom: number;
}
export const DEFAULT_REGION: RegionConfig = {
  name: "GridWatch Indiana",
  region_label: "INDIANA",
  tagline: "DATA CENTER ATLAS",
  boundary_file: "indiana.geojson",
  subdivisions_file: "counties.geojson",
  subdivision_key: "county",
  subdivision_singular: "county",
  home_center: [-86.43, 39.76],
  home_zoom_boost: 0.42,
  min_zoom: 3.5,
  max_zoom: 16,
};

/** Shape of public/data/theme.json — see src/lib/theme.ts for the full type. */
export type ThemeConfigFile = import("./theme").Theme;

/** ZIP -> [lng, lat]. Absent outside the US; the UI falls back to a picker. */
export interface ZipFile { _source?: string; zips: Record<string, [number, number]>; }

export type FC = GeoJSON.FeatureCollection;

export interface AppData {
  region: RegionConfig;
  theme: Partial<ThemeConfigFile> | null;
  zips: ZipFile | null;
  facilities: FacilitiesFile;
  meta: Meta;
  timeline: TimelineFile;
  bill: BillFile;
  action: ActionFile;
  dockets: DocketFile;
  restrictions: RestrictionFile;
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
  const region = await get<RegionConfig>("region.json").catch(() => DEFAULT_REGION);
  // theme.json is optional: absent means the built-in defaults
  const themeCfg = await get<Partial<ThemeConfigFile>>("theme.json").catch(() => null);
  const zips = await get<ZipFile>("zip_centroids.json").catch(() => null);
  const [
    facilities, meta, timeline, bill, action, dockets, restrictions,
    counties, indiana, powerPlants, transmission, territories, substations,
  ] = await Promise.all([
    get<FacilitiesFile>("facilities.json"),
    get<Meta>("meta.json"),
    get<TimelineFile>("timeline_events.json"),
    get<BillFile>("bill_impact_models.json"),
    get<ActionFile>("action_items.json"),
    get<DocketFile>("dockets.json"),
    get<RestrictionFile>("county_restrictions.json"),
    getFC(region.subdivisions_file),
    getFC(region.boundary_file),
    getFC("power_plants.geojson"),
    getFC("transmission.geojson"),
    getFC("utility_territories.geojson"),
    getFC("substations.geojson"),
  ]);
  return { region, theme: themeCfg, zips, facilities, meta, timeline, bill, action, dockets, restrictions, counties, indiana, powerPlants, transmission, territories, substations };
}
