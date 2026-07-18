import { describe, it, expect, beforeEach } from "vitest";
import {
  computeState, totalsAt, matchFacility, sevOf, sevColor, utilKey,
  bboxOf, countyCentroid, countyAt, servingUtility, haversineMiles, ALL_FILTERS,
} from "../util";
import { configureTheme, DEFAULT_THEME } from "../theme";
import type { Facility } from "../data";

/** Minimal valid facility; override what a test cares about. */
const fac = (over: Partial<Facility> = {}): Facility => ({
  id: "x", name: "X", developer: "D", city: "C", county: "Boone",
  lat: 40, lng: -86, geo_precision: "site", status: "proposed",
  mw_phase1: null, mw_full: 100, mw_estimated: false, acres: null,
  investment_usd: null, water_mgd: null, water_status: "unknown",
  utility: null, iurc_docket: null, docket_url: null,
  announced_year: 2024, online_year: 2027, tax_note: null,
  sources: [], notes: "", last_verified: "2026-01-01",
  ...over,
});

beforeEach(() => configureTheme(DEFAULT_THEME));

describe("computeState", () => {
  it("hides a facility before it was announced", () => {
    const s = computeState(fac({ announced_year: 2030 }), 2026);
    expect(s.visible).toBe(false);
  });

  /* Regression: auto-discovered records carry no announce date. Treating
     missing as Infinity hid every site on a bootstrapped region — the map
     rendered "0 shown" with no error. */
  it("shows a facility with no announce date", () => {
    const s = computeState(fac({ announced_year: null }), 2026);
    expect(s.visible).toBe(true);
    expect(s.online).toBe(true);
  });

  it("ramps from announcement to energization", () => {
    const f = fac({ announced_year: 2024, online_year: 2028 });
    expect(computeState(f, 2024).ramp).toBeCloseTo(0, 2);
    expect(computeState(f, 2026).ramp).toBeCloseTo(0.5, 2);
    expect(computeState(f, 2028).ramp).toBeCloseTo(1, 2);
    expect(computeState(f, 2029).online).toBe(true);
  });

  it("keeps withdrawn projects as ghosts, never online", () => {
    const s = computeState(fac({ status: "withdrawn" }), 2030);
    expect(s.phase).toBe("ghost");
    expect(s.online).toBe(false);
  });

  it("does not divide by zero when announced === online", () => {
    const s = computeState(fac({ announced_year: 2026, online_year: 2026 }), 2026);
    expect(Number.isFinite(s.ramp)).toBe(true);
  });
});

describe("totalsAt", () => {
  it("excludes withdrawn projects from load totals", () => {
    const list = [fac({ id: "a", mw_full: 100 }), fac({ id: "b", mw_full: 900, status: "withdrawn" })];
    expect(totalsAt(list, 2026, ALL_FILTERS).total).toBe(100);
  });
});

describe("severity scale", () => {
  it("bands by the theme's thresholds", () => {
    expect(sevOf(10)).toBe("low");
    expect(sevOf(100)).toBe("med");
    expect(sevOf(300)).toBe("high");
    expect(sevOf(2000)).toBe("mega");
  });

  it("treats null capacity as the lowest band rather than throwing", () => {
    expect(sevOf(null)).toBe("low");
    expect(sevColor(null)).toBeTruthy();
  });

  it("follows reconfigured bands", () => {
    configureTheme({
      ...DEFAULT_THEME,
      bands: [
        { key: "small", label: "S", max: 5, color: "#111" },
        { key: "big", label: "B", max: null, color: "#222" },
      ],
    });
    expect(sevOf(1)).toBe("small");
    expect(sevOf(50)).toBe("big");
    expect(sevColor(50)).toBe("#222");
  });
});

describe("utilKey", () => {
  it("matches configured utilities case-insensitively", () => {
    expect(utilKey("Duke Energy Indiana")).toBe("duke");
    expect(utilKey("NIPSCO")).toBe("nipsco");
    expect(utilKey("Indiana Michigan Power (I&M)")).toBe("im");
  });

  it("falls back to 'other' for unknown or empty input", () => {
    expect(utilKey("Some Rural Co-op")).toBe("other");
    expect(utilKey(null)).toBe("other");
    expect(utilKey("")).toBe("other");
  });

  it("uses the region's own utilities after reconfiguration", () => {
    configureTheme({
      ...DEFAULT_THEME,
      utilities: [{ id: "eon", display: "E.ON", color: "#000", match: ["e.on", "eon"] }],
    });
    expect(utilKey("E.ON Bayern")).toBe("eon");
    expect(utilKey("Duke Energy")).toBe("other");   // Indiana's list is gone
  });
});

describe("matchFacility", () => {
  it("passes everything when no filters are set", () => {
    expect(matchFacility(fac(), ALL_FILTERS)).toBe(true);
  });
  it("filters by status, size and utility together", () => {
    const f = fac({ status: "proposed", mw_full: 600, utility: "Duke Energy Indiana" });
    expect(matchFacility(f, { status: ["proposed"], size: ["mega"], utility: "duke" })).toBe(true);
    expect(matchFacility(f, { status: ["withdrawn"], size: [], utility: "all" })).toBe(false);
    expect(matchFacility(f, { status: [], size: ["low"], utility: "all" })).toBe(false);
  });
});

describe("geometry helpers", () => {
  const squares: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { county: "Square" },
      geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] },
    }],
  };

  it("computes a bounding box across features", () => {
    expect(bboxOf(squares)).toEqual([[0, 0], [2, 2]]);
  });

  it("returns null for an empty collection", () => {
    expect(bboxOf({ type: "FeatureCollection", features: [] })).toBeNull();
  });

  it("finds the subdivision containing a point, and none outside it", () => {
    expect(countyAt([1, 1], squares)).toBe("Square");
    expect(countyAt([9, 9], squares)).toBeNull();
  });

  it("honors a custom subdivision key", () => {
    const fc: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: [{ ...squares.features[0], properties: { kreis: "Bayern" } } as any],
    };
    expect(countyAt([1, 1], fc, "kreis")).toBe("Bayern");
  });

  it("returns a centroid inside the polygon", () => {
    expect(countyCentroid("Square", squares)).toEqual([1, 1]);
    expect(countyCentroid("Nowhere", squares)).toBeNull();
  });

  it("measures distance in miles", () => {
    expect(haversineMiles([-86, 40], [-86, 40])).toBe(0);
    // ~1 degree of latitude ≈ 69 miles
    expect(haversineMiles([-86, 40], [-86, 41])).toBeGreaterThan(68);
    expect(haversineMiles([-86, 40], [-86, 41])).toBeLessThan(70);
  });

  it("returns null when no territory covers the point", () => {
    expect(servingUtility([9, 9], { type: "FeatureCollection", features: [] })).toBeNull();
  });
});
