import type { Facility } from "./data";
import { theme } from "./theme";

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/* Jobs per megawatt. Region-configurable in theme.json — Indiana ships I&M's
 * 2024 disclosure: data centers ~0.26 jobs/MW vs ~41 for other industry. */
export const JOBS_PER_MW_DC = 0.26;      // legacy re-export; prefer jobsModel()
export const JOBS_PER_MW_OTHER = 41;
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/* ---------- load severity (driven by theme.json) ---------- */
export type Sev = string;
export function sevOf(mw: number | null | undefined): Sev {
  const v = mw ?? 0;
  const bands = theme().bands;
  for (const b of bands) if (b.max == null || v < b.max) return b.key;
  return bands[bands.length - 1].key;
}
/** Live view of band colors — read after configureTheme() at boot. */
export const SEV_COLOR = new Proxy({} as Record<Sev, string>, {
  get: (_t, k: string) => theme().bands.find((b) => b.key === k)?.color ?? theme().unknown_color,
  ownKeys: () => theme().bands.map((b) => b.key),
  getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
});
export const sevBands = () => theme().bands;
export const sevColor = (mw: number | null | undefined) => SEV_COLOR[sevOf(mw)];
export const sevClass = (mw: number | null | undefined) => `sev-${sevOf(mw)}`;
export const unknownColor = () => theme().unknown_color;

/* jobs model — per-MW employment, from theme.json */
export const jobsModel = () => theme().jobs;

/* ---------- fuel colors ---------- */
export const fuelColor = (f: string) =>
  theme().fuels[f]?.color ?? theme().fuels.other?.color ?? "#6B7684";
export const FUEL_LABEL = new Proxy({} as Record<string, string>, {
  get: (_t, k: string) => theme().fuels[k]?.label ?? k,
});

/* ---------- utility identity (region-defined) ---------- */
export type UtilKey = string;
export const UTIL_COLOR = new Proxy({} as Record<UtilKey, string>, {
  get: (_t, k: string) =>
    theme().utilities.find((u) => u.id === k)?.color ?? theme().other_utility.color,
});
export const UTIL_DISPLAY = new Proxy({} as Record<UtilKey, string>, {
  get: (_t, k: string) =>
    theme().utilities.find((u) => u.id === k)?.display ?? theme().other_utility.display,
});
export const utilityList = () => theme().utilities;
export function utilKey(name: string | null | undefined): UtilKey {
  const n = (name || "").toLowerCase();
  if (!n) return "other";
  for (const u of theme().utilities) {
    if (u.match.some((m) => n.includes(m.toLowerCase()))) return u.id;
  }
  return "other";
}
export const utilColor = (name: string | null | undefined) => UTIL_COLOR[utilKey(name)];

/* ---------- geo ---------- */
export function haversineMiles(a: [number, number], b: [number, number]): number {
  const R = 3958.8, toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]), dLng = toRad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a[1])) * Math.cos(toRad(b[1])) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/* ---------- timeline model ----------
   Given a scrub year, derive each facility's presence + ramp. Estimated
   energization years drive this projection; the UI labels it as such. */
export interface FacState {
  visible: boolean;
  planned: number;   // planned full MW (stable, drives node size)
  ramp: number;      // 0..1 build progress
  online: boolean;   // has reached projected energization
  phase: "none" | "proposed" | "construction" | "online" | "ghost";
}
export function computeState(f: Facility, year: number): FacState {
  const planned = f.mw_full ?? f.mw_phase1 ?? 0;
  const announced = f.announced_year;
  if (f.status === "withdrawn") {
    return { visible: announced == null || year >= announced, planned, ramp: 0, online: false, phase: "ghost" };
  }
  /* No announce date — typical of auto-discovered sites, which are mapped
     because they already exist. Show them across the whole timeline instead of
     hiding them behind a date we don't have. */
  if (announced == null) {
    return { visible: true, planned, ramp: 1, online: true, phase: "online" };
  }
  if (year < announced) return { visible: false, planned, ramp: 0, online: false, phase: "none" };
  const online = f.online_year ?? announced + 3;
  const span = Math.max(0.5, online - announced);
  const ramp = clamp((year - announced) / span, 0, 1);
  const isOnline = year >= online;
  const phase = isOnline ? "online" : ramp > 0.5 ? "construction" : "proposed";
  return { visible: true, planned, ramp, online: isOnline, phase };
}

export interface LoadTotals { online: number; pipeline: number; total: number; nodes: number; }
export function totalsAt(facilities: Facility[], year: number, filters?: Filters): LoadTotals {
  let online = 0, pipeline = 0, nodes = 0;
  for (const f of facilities) {
    const s = computeState(f, year);
    if (!s.visible || f.status === "withdrawn") continue;
    if (filters && !matchFacility(f, filters)) continue;
    nodes++;
    if (s.online) online += s.planned; else pipeline += s.planned;
  }
  return { online, pipeline, total: online + pipeline, nodes };
}

/* ---------- interactive filters (the crux) ---------- */
export interface Filters { status: string[]; size: Sev[]; utility: UtilKey | "all"; }
export const ALL_FILTERS: Filters = { status: [], size: [], utility: "all" };
export function matchFacility(f: Facility, filters: Filters): boolean {
  const mw = f.mw_full ?? f.mw_phase1 ?? 0;
  const sOk = !filters.status.length || filters.status.includes(f.status);
  const zOk = !filters.size.length || filters.size.includes(sevOf(mw));
  const uOk = filters.utility === "all" || utilKey(f.utility) === filters.utility;
  return sOk && zOk && uOk;
}

/* ---------- tiny reactive store ---------- */
export type Sub<T> = (v: T) => void;
export interface Store<T> { get(): T; set(v: T): void; update(fn: (v: T) => T): void; subscribe(f: Sub<T>): () => void; }
export function writable<T>(initial: T): Store<T> {
  let value = initial;
  const subs = new Set<Sub<T>>();
  return {
    get: () => value,
    set(v) { value = v; subs.forEach((f) => f(value)); },
    update(fn) { this.set(fn(value)); },
    subscribe(f) { subs.add(f); f(value); return () => subs.delete(f); },
  };
}

/* ---------- point-in-polygon (ray casting) ---------- */
function pipRing(pt: [number, number], ring: number[][]): boolean {
  if (!ring || ring.length < 3) return false;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > pt[1]) !== (yj > pt[1])) &&
        (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function pipGeom(pt: [number, number], geom: any): boolean {
  if (!geom || !geom.coordinates) return false;
  if (geom.type === "Polygon") return pipRing(pt, geom.coordinates[0]);
  if (geom.type === "MultiPolygon") return geom.coordinates.some((poly: number[][][]) => poly && pipRing(pt, poly[0]));
  return false;
}

/** Which utility serves a point? Prefer the big investor-owned utilities. */
export function servingUtility(
  pt: [number, number],
  territories: GeoJSON.FeatureCollection
): { name: string; key: UtilKey } | null {
  const hits: { name: string; customers: number }[] = [];
  for (const f of territories.features) {
    if (pipGeom(pt, f.geometry)) {
      const p = f.properties as any;
      hits.push({ name: p.utility || "", customers: p.customers || 0 });
    }
  }
  if (!hits.length) return null;
  // prefer a recognized IOU, else the largest by customers
  const iou = hits.find((h) => utilKey(h.name) !== "other");
  const chosen = iou || hits.sort((a, b) => b.customers - a.customers)[0];
  return { name: chosen.name, key: utilKey(chosen.name) };
}

/** Which subdivision (county/province/…) contains a point? */
export function countyAt(pt: [number, number], counties: GeoJSON.FeatureCollection, key = "county"): string | null {
  for (const f of counties.features) {
    if (pipGeom(pt, f.geometry)) return ((f.properties as any)?.[key]) ?? null;
  }
  return null;
}

/** Bounding box of a FeatureCollection as [[minLng,minLat],[maxLng,maxLat]]. */
export function bboxOf(fc: GeoJSON.FeatureCollection): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const scan = (c: any) => {
    if (typeof c[0] === "number") {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
    } else if (Array.isArray(c)) c.forEach(scan);
  };
  for (const f of fc.features) if (f.geometry && "coordinates" in f.geometry) scan((f.geometry as any).coordinates);
  if (!isFinite(minX)) return null;
  return [[minX, minY], [maxX, maxY]];
}

/** Representative interior point (bbox center) for a named subdivision. */
export function countyCentroid(
  name: string,
  counties: GeoJSON.FeatureCollection,
  key = "county"
): [number, number] | null {
  const feat = counties.features.find(
    (f) => String((f.properties as any)?.[key] ?? "").toLowerCase() === name.toLowerCase()
  );
  if (!feat) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const scan = (c: any) => {
    if (typeof c[0] === "number") {
      minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
      minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
    } else c.forEach(scan);
  };
  scan((feat.geometry as any).coordinates);
  if (!isFinite(minX)) return null;
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/* shared app state */
export interface AppState {
  year: number;
  playing: boolean;
  selectedId: string | null;
  hoveredId: string | null;
  layers: Record<string, boolean>;
  focusCounty: string | null;
}
export const state = writable<AppState>({
  year: 2026.54,
  playing: false,
  selectedId: null,
  hoveredId: null,
  layers: { territories: false, transmission: true, plants: true, datacenters: true, withdrawn: true },
  focusCounty: null,
});
