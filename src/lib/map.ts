import maplibregl, { Map as MLMap, LngLatBoundsLike } from "maplibre-gl";
import type { AppData, Facility } from "./data";
import {
  computeState, sevColor, fuelColor, utilColor, clamp,
  matchFacility, totalsAt, ALL_FILTERS, type Filters, type LoadTotals,
} from "./util";

// snug to the state so the whole outline fills the frame
const INDIANA_BOUNDS: LngLatBoundsLike = [[-88.12, 37.74], [-84.74, 41.79]];
const INDIANA_CENTER: [number, number] = [-86.3, 39.9];
const UPCOMING = new Set(["proposed", "approved", "rumored"]); // get dashed "targeting" rings

/** Base pixel radius of a facility node, by megawatts. Kept small so nodes
 *  don't swamp the state. */
function nodeRadius(mw: number): number {
  return clamp(3 + Math.sqrt(mw) * 0.55, 4, 16);
}

export interface MapHandlers {
  onSelect: (id: string | null) => void;
  onHover: (f: Facility | null, pt: { x: number; y: number } | null) => void;
}

/** Enrich the facilities into a render-ready FeatureCollection for a year + filters. */
function buildFacFC(facilities: Facility[], year: number, filters: Filters): GeoJSON.FeatureCollection {
  const features = facilities.map((f) => {
    const s = computeState(f, year);
    const mw = f.mw_full ?? f.mw_phase1 ?? 0;
    const ghost = f.status === "withdrawn";
    const match = s.visible && matchFacility(f, filters);
    const r = nodeRadius(mw);
    const coreOp = !match || ghost ? 0 : s.online ? 0.95 : 0.5 + 0.4 * s.ramp;
    const glowOp = !match || ghost ? 0 : 0.12 + 0.34 * s.ramp;
    const ghostOp = match && ghost ? 0.5 : 0;
    return {
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [f.lng, f.lat] },
      properties: {
        id: f.id, name: f.name, mw,
        color: mw > 0 ? sevColor(mw) : "#6B7684", // grey = capacity undisclosed
        r, coreOp, glowOp, ghostOp, glowR: r * 2.3,
        vis: match ? 1 : 0, ghost: ghost ? 1 : 0,
        online: s.online ? 1 : 0, phase: s.phase,
      },
    };
  });
  return { type: "FeatureCollection", features };
}

function enrich(fc: GeoJSON.FeatureCollection, fn: (p: any) => void): GeoJSON.FeatureCollection {
  for (const f of fc.features) fn(f.properties || (f.properties = {}));
  return fc;
}

/** A world polygon with Indiana punched out — masks everything beyond the
 *  state so roads/buildings/labels never leave the border (spotlight effect). */
function buildMask(indiana: GeoJSON.FeatureCollection): GeoJSON.Feature {
  const world = [[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]];
  const holes: number[][][] = [];
  for (const f of indiana.features) {
    const g: any = f.geometry;
    if (g?.type === "Polygon") holes.push(g.coordinates[0]);
    else if (g?.type === "MultiPolygon") g.coordinates.forEach((poly: number[][][]) => holes.push(poly[0]));
  }
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [world, ...holes] } };
}

export class GridMap {
  map: MLMap;
  private data: AppData;
  private handlers: MapHandlers;
  centroids = new Map<string, [number, number]>();
  private ready = false;
  private raf = 0;
  private t0 = 0;
  private lastDash = -1;
  private lastAnim = 0;
  private lastLabels = 0;
  private applyAt = 0;
  private applyTimer = 0;
  private readyCbs: Array<() => void> = [];
  private onResize = () => this.applyPadding();
  private hoveredId: string | null = null;
  private selectedId: string | null = null;
  private year: number;
  private filters: Filters = ALL_FILTERS;
  private labelHost: HTMLDivElement;
  private reduceMotion: boolean;

  constructor(container: string, data: AppData, handlers: MapHandlers, year: number) {
    this.data = data;
    this.handlers = handlers;
    this.year = year;
    this.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.map = new maplibregl.Map({
      container,
      // keyless dark vector basemap: roads, water, labels, building footprints
      style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
      center: INDIANA_CENTER,
      zoom: this.reduceMotion ? 7.2 : 4.6, // flat top-down; brief zoom-in
      minZoom: 3.5,
      maxZoom: 16,
      pitch: 0,
      bearing: 0,
      dragRotate: false,
      pitchWithRotate: false,
      touchPitch: false,
      maxPitch: 0, // strictly 2D — never tilt
      attributionControl: false,
    });
    this.map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          "© OpenStreetMap · © CARTO · Data: IURC · HIFLD · WRI · US Census · AI Law Tracker · CAC",
      }),
      "bottom-right"
    );
    this.map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "bottom-right");

    const host = document.createElement("div");
    host.id = "map-labels";
    host.style.cssText = "position:absolute;inset:0;pointer-events:none;z-index:6;overflow:hidden;";
    this.map.getContainer().appendChild(host);
    this.labelHost = host;

    this.map.on("load", () => this.init());
  }

  private init() {
    const m = this.map;
    this.computeCentroids();

    // darken the CARTO base toward the console void
    try {
      m.setPaintProperty("background", "background-color", "#080c12");
      if (m.getLayer("water")) m.setPaintProperty("water", "fill-color", "#0a1622");
    } catch { /* layer names vary between styles */ }
    const firstLabel = (m.getStyle().layers || []).find((l) => l.type === "symbol")?.id;

    /* ---- sources ---- */
    m.addSource("territories", {
      type: "geojson",
      data: enrich(this.data.territories, (p) => (p._c = utilColor(p.utility))),
    });
    m.addSource("trans", { type: "geojson", data: this.data.transmission });
    m.addSource("plants", {
      type: "geojson",
      data: enrich(this.data.powerPlants, (p) => {
        p._c = fuelColor(p.fuel);
        p._r = clamp(1.6 + Math.sqrt(p.capacity_mw || 1) * 0.28, 2, 9);
      }),
    });
    m.addSource("fac", { type: "geojson", data: buildFacFC(this.data.facilities.facilities, this.year, this.filters) });
    m.addSource("state", { type: "geojson", data: this.data.indiana });
    m.addSource("mask", { type: "geojson", data: buildMask(this.data.indiana) });

    /* ---- utility territories (beneath labels) ---- */
    m.addLayer({ id: "terr-fill", type: "fill", source: "territories",
      layout: { visibility: "none" },
      paint: { "fill-color": ["get", "_c"], "fill-opacity": 0.16 } }, firstLabel);
    m.addLayer({ id: "terr-line", type: "line", source: "territories",
      layout: { visibility: "none" },
      paint: { "line-color": ["get", "_c"], "line-width": 1, "line-opacity": 0.45 } }, firstLabel);

    /* ---- transmission (beneath labels) ---- */
    m.addLayer({ id: "trans-base", type: "line", source: "trans",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#58A6FF",
        "line-opacity": ["interpolate", ["linear"], ["coalesce", ["get", "kv"], 138], 138, 0.1, 345, 0.22, 765, 0.42],
        "line-width": ["interpolate", ["linear"], ["coalesce", ["get", "kv"], 138], 138, 0.4, 345, 1.0, 765, 2.0],
      } }, firstLabel);
    m.addLayer({ id: "trans-flow", type: "line", source: "trans",
      filter: [">=", ["coalesce", ["get", "kv"], 0], 345],
      layout: { "line-cap": "round" },
      paint: { "line-color": "#7CC0FF", "line-width": 1.2, "line-opacity": 0.4, "line-dasharray": [0, 4, 3] } }, firstLabel);

    /* ---- power plants (beneath labels) ---- */
    m.addLayer({ id: "plants", type: "circle", source: "plants",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, ["*", ["get", "_r"], 0.7], 9, ["get", "_r"], 13, ["*", ["get", "_r"], 1.7]],
        "circle-color": ["get", "_c"], "circle-opacity": 0.6,
        "circle-stroke-color": ["get", "_c"], "circle-stroke-width": 0.8, "circle-stroke-opacity": 0.55,
      } }, firstLabel);

    /* ---- spotlight: mask everything outside Indiana ---- */
    m.addLayer({ id: "state-mask", type: "fill", source: "mask",
      paint: { "fill-color": "#070b11", "fill-opacity": 1 } });
    m.addLayer({ id: "state-glow", type: "line", source: "state",
      paint: { "line-color": "#3FB950", "line-width": 7, "line-opacity": 0.16, "line-blur": 5 } });
    m.addLayer({ id: "state-border", type: "line", source: "state",
      paint: { "line-color": "#56E06A", "line-width": 1.4, "line-opacity": 0.85, "line-blur": 0.3 } });

    /* ---- data center ghosts (withdrawn) ---- */
    m.addLayer({ id: "dc-ghost", type: "circle", source: "fac",
      filter: ["==", ["get", "ghost"], 1],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, ["*", ["get", "r"], 0.7], 7, ["get", "r"], 11, ["*", ["get", "r"], 1.8]],
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": 1.1,
        "circle-stroke-opacity": ["get", "ghostOp"],
      } });

    /* ---- data center glow (pulsing) ---- */
    m.addLayer({ id: "dc-glow", type: "circle", source: "fac",
      filter: ["==", ["get", "ghost"], 0],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, ["*", ["get", "glowR"], 0.7], 7, ["get", "glowR"], 11, ["*", ["get", "glowR"], 1.8]],
        "circle-color": ["get", "color"],
        "circle-opacity": ["get", "glowOp"],
        "circle-blur": 1.0,
      } });

    /* ---- data center core ---- */
    m.addLayer({ id: "dc-core", type: "circle", source: "fac",
      filter: ["==", ["get", "ghost"], 0],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, ["*", ["get", "r"], 0.7], 7, ["get", "r"], 11, ["*", ["get", "r"], 1.8]],
        "circle-color": ["get", "color"],
        "circle-opacity": ["*", 0.55, ["get", "coreOp"]],
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": 1.4,
        "circle-stroke-opacity": ["get", "coreOp"],
      } });

    /* ---- selected ring ---- */
    m.addLayer({ id: "dc-selected", type: "circle", source: "fac",
      filter: ["==", ["get", "id"], "__none__"],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"],
          5, ["+", ["*", ["get", "r"], 0.7], 6],
          7, ["+", ["get", "r"], 6],
          11, ["+", ["*", ["get", "r"], 1.8], 6]],
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": "#E6EDF3",
        "circle-stroke-width": 1.5,
        "circle-stroke-opacity": 0.9,
      } });

    (window as any).__gwmap = this.map; // exposed for power users / debugging
    this.applyPadding();
    window.addEventListener("resize", this.onResize);
    this.wireEvents();
    this.ready = true;
    this.readyCbs.splice(0).forEach((cb) => cb());
    this.startLoop();
    const cam = this.homeCamera();
    if (!this.reduceMotion) {
      setTimeout(() => m.flyTo({ ...cam, pitch: 0, bearing: 0, duration: 2400, essential: true }), 180);
    } else {
      m.jumpTo({ ...cam, pitch: 0, bearing: 0 } as any);
    }
  }

  /** Padding that keeps the fit clear of whichever panels are open. */
  private pad() {
    if (window.innerWidth <= 820)
      return { top: Math.round(window.innerHeight * 0.3), bottom: 70, left: 10, right: 10 };
    const open = !document.getElementById("controls")?.classList.contains("collapsed");
    return { top: 58, bottom: 94, left: open ? 304 : 16, right: 16 };
  }

  applyPadding() { this.map.setPadding(this.pad()); }

  /** Camera that fits the whole state into the current clear zone.
   *  cameraForBounds can return an implausible zoom before layout settles, so
   *  we sanity-check and fall back to a fixed Indiana framing. */
  private homeCamera(): { center: [number, number]; zoom: number } {
    // fixed geographic center of the state; setPadding handles the offset for
    // the filter panel, so Indiana stays balanced in the clear area.
    const center: [number, number] = [-86.43, 39.76];
    let zoom = window.innerWidth > 820 ? 6.4 : 5.8;
    try {
      const cam: any = this.map.cameraForBounds(INDIANA_BOUNDS, { padding: this.pad(), maxZoom: 9 });
      if (cam && typeof cam.zoom === "number" && cam.zoom >= 5.5) {
        zoom = Math.min(9, cam.zoom + 0.28);
      }
    } catch { /* keep fallback zoom */ }
    return { center, zoom };
  }

  /** Re-fit the state after a panel is collapsed/expanded. */
  reframe() {
    this.applyPadding();
    this.map.flyTo({ ...this.homeCamera(), duration: 620, essential: true });
  }

  private wireEvents() {
    const m = this.map;
    const hoverLayers = ["dc-core", "dc-ghost"];
    for (const layer of hoverLayers) {
      m.on("mouseenter", layer, () => (m.getCanvas().style.cursor = "pointer"));
      m.on("mouseleave", layer, () => {
        m.getCanvas().style.cursor = "";
        if (this.hoveredId) { this.hoveredId = null; this.handlers.onHover(null, null); }
      });
      m.on("mousemove", layer, (e) => {
        const feat = e.features?.[0];
        if (!feat) return;
        const id = feat.properties!.id as string;
        if ((feat.properties!.vis as number) < 1) return;
        this.hoveredId = id;
        const f = this.facById(id);
        if (f) this.handlers.onHover(f, { x: e.point.x, y: e.point.y });
      });
      m.on("click", layer, (e) => {
        const feat = e.features?.[0];
        if (!feat || (feat.properties!.vis as number) < 1) return;
        this.handlers.onSelect(feat.properties!.id as string);
      });
    }
    m.on("click", (e) => {
      const hits = m.queryRenderedFeatures(e.point, { layers: ["dc-core", "dc-ghost"] });
      if (!hits.length) this.handlers.onSelect(null);
    });
  }

  private facById(id: string): Facility | undefined {
    return this.data.facilities.facilities.find((f) => f.id === id);
  }

  private computeCentroids() {
    for (const f of this.data.counties.features) {
      const name = (f.properties as any)?.county as string;
      if (!name) continue;
      const b = bbox(f.geometry as any);
      this.centroids.set(name.toLowerCase(), [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]);
    }
  }

  /* ---------- animation ----------
     Labels track the map via its own render events (so they cost nothing when
     the map is idle). Ambient pulse/flow runs on a ~30fps-gated RAF only when
     motion is allowed — under prefers-reduced-motion there is no loop at all. */
  private startLoop() {
    this.map.on("render", () => this.positionLabels());
    this.positionLabels();
    if (this.reduceMotion) return;

    const step = (t: number) => {
      if (!this.t0) this.t0 = t;
      if (this.ready && t - this.lastAnim > 32) {
        this.lastAnim = t;
        const el = (t - this.t0) / 1000;
        const pulse = 1 + 0.16 * Math.sin(el * 2.1);
        try {
          this.map.setPaintProperty("dc-glow", "circle-radius", [
            "interpolate", ["linear"], ["zoom"],
            5, ["*", ["get", "glowR"], 0.7 * pulse],
            7, ["*", ["get", "glowR"], pulse],
            11, ["*", ["get", "glowR"], 1.8 * pulse],
          ] as any);
          this.map.setPaintProperty("dc-glow", "circle-opacity",
            ["*", ["get", "glowOp"], 0.75 + 0.25 * Math.sin(el * 2.1 + 1)] as any);
          const off = Math.round(((el * 1.6) % 7) * 2) / 2;
          if (off !== this.lastDash) {
            this.lastDash = off;
            this.map.setPaintProperty("trans-flow", "line-dasharray", [off, 4, 3] as any);
          }
        } catch { /* style not ready */ }
      }
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  /* ---------- labels for the biggest facilities + selected ---------- */
  private positionLabels() {
    if (!this.ready) return;
    const now = performance.now();
    if (now - this.lastLabels < 30) return; // ~33fps cap; render can fire faster
    this.lastLabels = now;
    const m = this.map;
    const z = m.getZoom();
    const wanted = this.data.facilities.facilities.filter((f) => {
      const mw = f.mw_full ?? 0;
      const s = computeState(f, this.year);
      if (f.id === this.selectedId || f.id === this.hoveredId) return true;
      if (!s.visible || f.status === "withdrawn" || !matchFacility(f, this.filters)) return false;
      return mw >= 500 && z >= 6.8; // ambient labels for hyperscalers once zoomed in a touch
    });
    const seen = new Set<string>();
    for (const f of wanted) {
      seen.add(f.id);
      let el = this.labelHost.querySelector<HTMLElement>(`[data-lid="${f.id}"]`);
      if (!el) {
        el = document.createElement("div");
        el.dataset.lid = f.id;
        el.className = "map-label";
        el.style.cssText =
          "position:absolute;transform:translate(-50%,-50%);font-family:var(--mono);font-size:9.5px;letter-spacing:.04em;color:#cfe;white-space:nowrap;text-shadow:0 0 8px #000,0 1px 2px #000;padding:1px 5px;border-left:2px solid " +
          sevColor(f.mw_full ?? 0) + ";background:rgba(7,11,16,.55);border-radius:2px;";
        el.textContent = f.name.replace(/ (Campus|Data Center|Center)$/i, "");
        this.labelHost.appendChild(el);
      }
      const p = m.project([f.lng, f.lat]);
      const r = nodeRadius(f.mw_full ?? 0) * (z >= 7 ? (z >= 11 ? 1.8 : 1) : 0.7);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y - r - 11}px`;
      el.style.opacity = f.id === this.selectedId ? "1" : z < 6 ? "0" : "0.82";
    }
    this.labelHost.querySelectorAll<HTMLElement>("[data-lid]").forEach((el) => {
      if (!seen.has(el.dataset.lid!)) el.remove();
    });

    // dashed, rotating "targeting" rings on upcoming projects
    const ringSeen = new Set<string>();
    for (const f of this.data.facilities.facilities) {
      if (!UPCOMING.has(f.status)) continue;
      const s = computeState(f, this.year);
      if (!s.visible || !matchFacility(f, this.filters)) continue;
      ringSeen.add(f.id);
      const mw = f.mw_full ?? f.mw_phase1 ?? 0;
      let el = this.labelHost.querySelector<HTMLElement>(`[data-ring="${f.id}"]`);
      if (!el) {
        el = document.createElement("div");
        el.dataset.ring = f.id;
        el.className = "dc-ring";
        el.style.setProperty("--rc", mw > 0 ? sevColor(mw) : "#6B7684");
        this.labelHost.appendChild(el);
      }
      const p = m.project([f.lng, f.lat]);
      const rNode = nodeRadius(mw) * (z >= 7 ? (z >= 11 ? 1.8 : 1) : 0.7);
      const d = Math.max(20, rNode * 2.8 + 7);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y}px`;
      el.style.width = el.style.height = `${d}px`;
      el.style.opacity = String(0.45 + 0.45 * s.ramp);
    }
    this.labelHost.querySelectorAll<HTMLElement>("[data-ring]").forEach((el) => {
      if (!ringSeen.has(el.dataset.ring!)) el.remove();
    });
  }

  /* ---------- public API ---------- */
  whenReady(cb: () => void) {
    if (this.ready) cb(); else this.readyCbs.push(cb);
  }

  /** Throttle the source re-upload to ~22fps during playback. Labels/counters
   *  still update every frame elsewhere; the map ramp stays smooth without
   *  reparsing the whole GeoJSON source 60x/sec. A trailing apply guarantees
   *  the final scrub value always lands. */
  private applyFac() {
    if (!this.ready) return;
    (this.map.getSource("fac") as maplibregl.GeoJSONSource)
      .setData(buildFacFC(this.data.facilities.facilities, this.year, this.filters));
  }

  setYear(year: number) {
    this.year = year;
    if (!this.ready) return;
    const apply = () => { this.applyAt = performance.now(); this.applyFac(); };
    clearTimeout(this.applyTimer);
    if (performance.now() - this.applyAt > 45) apply();
    else this.applyTimer = window.setTimeout(apply, 46);
  }

  /** Apply interactive filters — the crux of the map. */
  setFilters(filters: Filters) {
    this.filters = filters;
    this.applyFac();
  }

  /** Live totals for whatever is currently shown (year + filters). */
  shownTotals(): LoadTotals {
    return totalsAt(this.data.facilities.facilities, this.year, this.filters);
  }

  setLayerVisible(key: string, on: boolean) {
    if (!this.ready) return;
    const vis = on ? "visible" : "none";
    const map: Record<string, string[]> = {
      territories: ["terr-fill", "terr-line"],
      transmission: ["trans-base", "trans-flow"],
      plants: ["plants"],
      datacenters: ["dc-glow", "dc-core"],
      withdrawn: ["dc-ghost"],
    };
    (map[key] || []).forEach((l) => { try { this.map.setLayoutProperty(l, "visibility", vis); } catch {} });
  }

  select(id: string | null, fly = true) {
    this.selectedId = id;
    if (!this.ready) return;
    try { this.map.setFilter("dc-selected", ["==", ["get", "id"], id ?? "__none__"]); } catch {}
    if (id && fly) {
      const f = this.facById(id);
      // fly in to reveal local roads around the site (flat, top-down)
      if (f) this.map.flyTo({ center: [f.lng, f.lat], zoom: 12.5, pitch: 0, bearing: 0, duration: 1600, essential: true });
    }
  }

  flyTo(lng: number, lat: number, zoom = 9) {
    this.map.flyTo({ center: [lng, lat], zoom, duration: 1500, essential: true });
  }

  flyToCounty(name: string): [number, number] | null {
    const c = this.centroids.get(name.toLowerCase());
    if (c) this.flyTo(c[0], c[1], 8.4);
    return c || null;
  }

  resetView() {
    this.map.flyTo({ ...this.homeCamera(), pitch: 0, bearing: 0, duration: 1400, essential: true });
  }

  fitIndiana() { this.map.fitBounds(INDIANA_BOUNDS, { padding: 60, duration: 1200 }); }

  destroy() {
    cancelAnimationFrame(this.raf);
    clearTimeout(this.applyTimer);
    window.removeEventListener("resize", this.onResize);
    this.map.remove();
  }
}

/* minimal bbox for Polygon/MultiPolygon */
function bbox(geom: GeoJSON.Geometry): [number, number, number, number] {
  let x0 = 180, y0 = 90, x1 = -180, y1 = -90;
  const scan = (co: any) => {
    if (typeof co[0] === "number") {
      x0 = Math.min(x0, co[0]); y0 = Math.min(y0, co[1]);
      x1 = Math.max(x1, co[0]); y1 = Math.max(y1, co[1]);
    } else co.forEach(scan);
  };
  if ((geom as any).coordinates) scan((geom as any).coordinates);
  return [x0, y0, x1, y1];
}
