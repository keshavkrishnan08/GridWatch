import { describe, it, expect, beforeEach } from "vitest";
import {
  configureTheme, autoScale, theme, DEFAULT_THEME, subName, subPlural, withSub,
} from "../theme";

beforeEach(() => configureTheme(DEFAULT_THEME));

describe("configureTheme", () => {
  it("keeps Indiana's defaults when given nothing", () => {
    configureTheme(null);
    expect(theme().bands[0].max).toBe(50);
    expect(theme().units.currency.code).toBe("USD");
    expect(theme().terminology.subdivision).toBe("county");
  });

  it("merges a partial theme without dropping unspecified sections", () => {
    configureTheme({ units: { ...DEFAULT_THEME.units, system: "metric", water: "m3d" } });
    expect(theme().units.system).toBe("metric");
    // untouched sections survive
    expect(theme().bands.length).toBe(4);
    expect(theme().fuels.coal.label).toBe("Coal");
  });

  it("adds region fuels while keeping the base palette", () => {
    configureTheme({ fuels: { geothermal: { label: "Geothermal", color: "#abc" } } as any });
    expect(theme().fuels.geothermal.color).toBe("#abc");
    expect(theme().fuels.gas).toBeTruthy();
  });

  it("ignores an empty utilities list rather than blanking the region", () => {
    configureTheme({ utilities: [] });
    expect(theme().utilities.length).toBeGreaterThan(0);
  });
});

describe("autoScale", () => {
  it("does nothing in fixed mode", () => {
    configureTheme({ ...DEFAULT_THEME, scale_mode: "fixed" });
    autoScale([1, 2, 3, 4, 900]);
    expect(theme().bands[0].max).toBe(50);
  });

  it("re-derives bounds from the data in auto mode", () => {
    configureTheme({ ...DEFAULT_THEME, scale_mode: "auto" });
    autoScale([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const maxes = theme().bands.map((b) => b.max);
    expect(maxes[0]).toBeLessThan(50);      // scaled down to this small region
    expect(maxes[maxes.length - 1]).toBeNull();  // top band stays open-ended
  });

  it("produces strictly increasing bounds", () => {
    configureTheme({ ...DEFAULT_THEME, scale_mode: "auto" });
    autoScale([5, 5, 5, 5, 5, 5, 5, 5]);   // degenerate: every value identical
    const b = theme().bands;
    for (let i = 1; i < b.length - 1; i++) {
      expect(b[i].max!).toBeGreaterThan(b[i - 1].max!);
    }
  });

  it("leaves bands alone when there is too little data to infer", () => {
    configureTheme({ ...DEFAULT_THEME, scale_mode: "auto" });
    autoScale([100]);
    expect(theme().bands[0].max).toBe(50);
  });

  it("ignores zero/unknown capacities when deriving", () => {
    configureTheme({ ...DEFAULT_THEME, scale_mode: "auto" });
    autoScale([0, 0, 0, 10, 20, 30, 40, 50]);
    expect(theme().bands[0].max!).toBeGreaterThan(0);
  });
});

describe("terminology", () => {
  it("renders US county wording", () => {
    expect(subName()).toBe("County");
    expect(subPlural()).toBe("counties");
    expect(withSub("Boone")).toBe("Boone County");
  });

  it("adapts to another country's subdivision", () => {
    configureTheme({
      terminology: { ...DEFAULT_THEME.terminology, subdivision: "kreis", subdivision_plural: "kreise" },
    });
    expect(subName()).toBe("Kreis");
    expect(withSub("Nürnberg")).toBe("Nürnberg Kreis");
  });

  it("drops the suffix when a region has no subdivision noun", () => {
    configureTheme({ terminology: { ...DEFAULT_THEME.terminology, subdivision: "" } });
    expect(withSub("Bavaria")).toBe("Bavaria");
  });
});
