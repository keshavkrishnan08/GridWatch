import maplibregl, { Map as MLMap, LngLatBoundsLike } from "maplibre-gl";
import type { AppData, Facility } from "./data";
import { computeState, sevColor, fuelColor, utilColor, clamp } from "./util";

const INDIANA_BOUNDS: LngLatBoundsLike = [[-88.6, 37.6], [-84.5, 41.95]];
const INDIANA_CENTER: [number, number] = [-86.3, 39.9];

export interface MapHandlers {
  onSelect: (id: string | null) => void;
  onHover: (f: Facility | null, pt: { x: number; y: number } | null) => void;
}

/** Enrich the facilities into a render-ready FeatureCollection for a given year. */
function buildFacFC(facilities: Facility[], year: number): GeoJSON.FeatureCollection {
  const features = facilities.map((f) => {
    const s = computeState(f, year);
    const mw = f.mw_full ?? f.mw_phase1 ?? 0;
    const r = clamp(5 + Math.sqrt(mw) * 0.95, 6, 30);
    const ghost = f.status === "withdrawn";
    const coreOp = !s.visible ? 0 : ghost ? 0 : s.online ? 0.95 : 0.5 + 0.4 * s.ramp;
    const glowOp = !s.visible || ghost ? 0 : 0.12 + 0.34 * s.ramp;
    return {
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [f.lng, f.lat] },
      properties: {
        id: f.id, name: f.name, mw,
        color: mw > 0 ? sevColor(mw) : "#6B7684", // grey = capacity undisclosed
        r, coreOp, glowOp, glowR: r * 2.3,
        vis: s.visible ? 1 : 0, ghost: ghost ? 1 : 0,
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
  private labelHost: HTMLDivElement;
  private reduceMotion: boolean;

  constructor(container: string, data: AppData, handlers: MapHandlers, year: number) {
    this.data = data;
    this.handlers = handlers;
    this.year = year;
    this.reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

    this.map = new maplibregl.Map({
      container,
      style: {
        version: 8,
        name: "gridwatch-void",
        sources: {},
        layers: [{ id: "bg", type: "background", paint: { "background-color": "#070B10" } }],
      },
      center: INDIANA_CENTER,
      zoom: this.reduceMotion ? 6.4 : 3.4,
      minZoom: 5.2,
      maxZoom: 14,
      pitch: this.reduceMotion ? 0 : 34,
      bearing: this.reduceMotion ? 0 : -18,
      attributionControl: false,
      dragRotate: false,
      renderWorldCopies: false,
    });
    this.map.touchZoomRotate.disableRotation();
    this.map.addControl(
      new maplibregl.AttributionControl({
        compact: true,
        customAttribution:
          "Data: IURC filings · HIFLD · WRI GPPD · US Census · AI Law Tracker · CAC",
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

    /* ---- sources ---- */
    m.addSource("counties", { type: "geojson", data: this.data.counties });
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
    m.addSource("fac", { type: "geojson", data: buildFacFC(this.data.facilities.facilities, this.year) });

    /* ---- county landmass ---- */
    m.addLayer({ id: "county-fill", type: "fill", source: "counties",
      paint: { "fill-color": "#131C26", "fill-opacity": 0.92 } });
    m.addLayer({ id: "terr-fill", type: "fill", source: "territories",
      layout: { visibility: "none" },
      paint: { "fill-color": ["get", "_c"], "fill-opacity": 0.14 } });
    m.addLayer({ id: "county-line", type: "line", source: "counties",
      paint: { "line-color": "#243343", "line-width": 0.6, "line-opacity": 0.9 } });
    m.addLayer({ id: "terr-line", type: "line", source: "territories",
      layout: { visibility: "none" },
      paint: { "line-color": ["get", "_c"], "line-width": 1, "line-opacity": 0.4 } });

    /* ---- transmission ---- */
    m.addLayer({ id: "trans-base", type: "line", source: "trans",
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": "#58A6FF",
        "line-opacity": ["interpolate", ["linear"], ["coalesce", ["get", "kv"], 138], 138, 0.12, 345, 0.28, 765, 0.5],
        "line-width": ["interpolate", ["linear"], ["coalesce", ["get", "kv"], 138], 138, 0.4, 345, 1.1, 765, 2.2],
      } });
    m.addLayer({ id: "trans-flow", type: "line", source: "trans",
      filter: [">=", ["coalesce", ["get", "kv"], 0], 345],
      layout: { "line-cap": "round" },
      paint: { "line-color": "#7CC0FF", "line-width": 1.3, "line-opacity": 0.55, "line-dasharray": [0, 4, 3] } });

    /* ---- power plants ---- */
    m.addLayer({ id: "plants", type: "circle", source: "plants",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, ["*", ["get", "_r"], 0.7], 9, ["get", "_r"], 13, ["*", ["get", "_r"], 1.7]],
        "circle-color": ["get", "_c"], "circle-opacity": 0.55,
        "circle-stroke-color": ["get", "_c"], "circle-stroke-width": 0.8, "circle-stroke-opacity": 0.5,
      } });

    /* ---- data center ghosts (withdrawn) ---- */
    m.addLayer({ id: "dc-ghost", type: "circle", source: "fac",
      filter: ["==", ["get", "ghost"], 1],
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, ["*", ["get", "r"], 0.7], 7, ["get", "r"], 11, ["*", ["get", "r"], 1.8]],
        "circle-color": "rgba(0,0,0,0)",
        "circle-stroke-color": ["get", "color"],
        "circle-stroke-width": 1.1,
        "circle-stroke-opacity": ["*", 0.42, ["get", "vis"]],
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

    this.applyPadding();
    window.addEventListener("resize", this.onResize);
    this.wireEvents();
    this.ready = true;
    this.readyCbs.splice(0).forEach((cb) => cb());
    this.startLoop();
    const z = this.homeZoom();
    if (!this.reduceMotion) {
      setTimeout(() => m.flyTo({ center: INDIANA_CENTER, zoom: z, pitch: 0, bearing: 0, duration: 2600, essential: true }), 120);
    } else {
      m.jumpTo({ center: INDIANA_CENTER, zoom: z });
    }
  }

  /** Keep Indiana in the clear zone between the console and the rail. */
  private applyPadding() {
    const wide = window.innerWidth > 820;
    this.map.setPadding(
      wide
        ? { left: 388, right: 226, top: 58, bottom: 132 }
        : { left: 8, right: 8, top: 58, bottom: window.innerHeight * 0.42 }
    );
  }
  private homeZoom() { return window.innerWidth > 820 ? 6.25 : 6.15; }

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
      if (!s.visible || f.status === "withdrawn") return false;
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
      const r = clamp(5 + Math.sqrt(f.mw_full ?? 0) * 0.95, 6, 30) * (z >= 7 ? (z >= 11 ? 1.8 : 1) : 0.7);
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y - r - 11}px`;
      el.style.opacity = f.id === this.selectedId ? "1" : z < 6 ? "0" : "0.82";
    }
    this.labelHost.querySelectorAll<HTMLElement>("[data-lid]").forEach((el) => {
      if (!seen.has(el.dataset.lid!)) el.remove();
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
  setYear(year: number) {
    this.year = year;
    if (!this.ready) return;
    const apply = () => {
      this.applyAt = performance.now();
      (this.map.getSource("fac") as maplibregl.GeoJSONSource)
        .setData(buildFacFC(this.data.facilities.facilities, this.year));
    };
    clearTimeout(this.applyTimer);
    if (performance.now() - this.applyAt > 45) apply();
    else this.applyTimer = window.setTimeout(apply, 46);
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
      if (f) this.map.flyTo({ center: [f.lng, f.lat], zoom: Math.max(this.map.getZoom(), 9.2), duration: 1400, essential: true });
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
    this.map.flyTo({ center: INDIANA_CENTER, zoom: this.homeZoom(), pitch: 0, bearing: 0, duration: 1400, essential: true });
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
