import { describe, it, expect, beforeEach } from "vitest";
import { fmtUSD, fmtAcres, fmtGpd, fmtMW, fmtInt, fmtYear, verifiedLabel, esc, safeUrl } from "../format";
import { configureTheme, DEFAULT_THEME } from "../theme";

beforeEach(() => configureTheme(DEFAULT_THEME));

describe("money", () => {
  it("compacts to K/M/B/T", () => {
    expect(fmtUSD(500)).toBe("$500");
    expect(fmtUSD(15_000)).toBe("$15K");
    expect(fmtUSD(11_000_000_000)).toBe("$11B");
  });

  it("uses the region's currency symbol", () => {
    configureTheme({ units: { ...DEFAULT_THEME.units, currency: { code: "EUR", symbol: "€" } } });
    expect(fmtUSD(2_000_000_000)).toBe("€2.0B");
  });

  it("shows placeholders instead of inventing zeros", () => {
    expect(fmtUSD(null)).toBe("——");
    expect(fmtMW(null)).toBe("——");
    expect(fmtInt(null)).toBe("——");
  });
});

describe("units", () => {
  it("keeps acres and MGD for imperial regions", () => {
    expect(fmtAcres(1200)).toContain("ac");
    expect(fmtGpd(5)).toContain("MGD");
  });

  it("converts to hectares and m³/d for metric regions", () => {
    configureTheme({ units: { ...DEFAULT_THEME.units, system: "metric", water: "m3d" } });
    expect(fmtAcres(1000)).toContain("ha");
    expect(fmtAcres(1000)).toContain("405");        // 1000 ac ≈ 404.7 ha
    expect(fmtGpd(1)).toContain("m³/d");
    expect(fmtGpd(1)).toContain("3,785");           // 1 MGD ≈ 3785 m³/d
  });
});

describe("dates", () => {
  it("formats fractional years as month + year", () => {
    expect(fmtYear(2026)).toBe("2026");
    expect(fmtYear(2026.54)).toBe("JUL 2026");
  });

  /* Auto-discovered records have no dates; these must not render "NaN". */
  it("handles unknown dates", () => {
    expect(fmtYear(null)).toBe("—");
    expect(verifiedLabel(null)).toBe("NOT YET SOURCE-VERIFIED");
    expect(verifiedLabel("2026-07-17")).toContain("2026-07-17");
  });
});

describe("escaping", () => {
  /* Forked datasets are rendered with innerHTML, so this is a real boundary. */
  it("escapes HTML in user/forked data", () => {
    expect(esc('<img src=x onerror="alert(1)">')).not.toContain("<img");
    expect(esc("Tom & Jerry")).toBe("Tom &amp; Jerry");
    expect(esc(null)).toBe("");
  });

  it("allows only http(s) and mailto links", () => {
    expect(safeUrl("https://example.com")).toBe("https://example.com");
    expect(safeUrl("mailto:a@b.com")).toBe("mailto:a@b.com");
    expect(safeUrl("javascript:alert(1)")).toBe("#");
    expect(safeUrl("data:text/html,<script>")).toBe("#");
    expect(safeUrl(null)).toBe("#");
  });
});
