import { describe, it, expect } from "vitest";
import { freshness, staleRecords } from "../freshness";

const at = (iso: string) => new Date(iso + "T00:00:00Z");

describe("freshness", () => {
  it("reads as fresh the day it was updated", () => {
    const f = freshness("2026-07-18", at("2026-07-18"));
    expect(f.days).toBe(0);
    expect(f.level).toBe("fresh");
    expect(f.label).toBe("updated today");
    expect(f.note).toBeNull();
  });

  it("counts days and stays fresh inside the window", () => {
    const f = freshness("2026-07-01", at("2026-07-18"));
    expect(f.days).toBe(17);
    expect(f.level).toBe("fresh");
    expect(f.label).toBe("updated 17 days ago");
  });

  it("flags aging data with a caveat", () => {
    const f = freshness("2026-05-01", at("2026-07-18"));
    expect(f.level).toBe("aging");
    expect(f.note).toBeTruthy();
  });

  it("flags stale data loudly", () => {
    const f = freshness("2025-07-18", at("2026-07-18"));
    expect(f.level).toBe("stale");
    expect(f.label).toContain("year");
    expect(f.note).toContain("out of date");
  });

  it("treats a missing date as stale rather than fine", () => {
    const f = freshness(null, at("2026-07-18"));
    expect(f.level).toBe("stale");
    expect(f.note).toBeTruthy();
  });

  it("treats an unparseable date as stale rather than NaN", () => {
    const f = freshness("not-a-date", at("2026-07-18"));
    expect(f.level).toBe("stale");
    expect(f.label).not.toContain("NaN");
  });

  it("never reports negative age for a future date", () => {
    expect(freshness("2027-01-01", at("2026-07-18")).days).toBe(0);
  });

  it("switches from days to months in its wording", () => {
    expect(freshness("2026-05-18", at("2026-07-18")).label).toContain("months ago");
  });
});

describe("staleRecords", () => {
  const now = at("2026-07-18");

  it("counts records not re-verified inside the threshold", () => {
    const facs = [
      { last_verified: "2026-07-01" },   // recent
      { last_verified: "2025-01-01" },   // stale
      { last_verified: null },           // never verified
    ];
    expect(staleRecords(facs, now)).toBe(2);
  });

  it("counts unparseable dates as stale", () => {
    expect(staleRecords([{ last_verified: "soon" }], now)).toBe(1);
  });

  it("returns zero for an empty dataset", () => {
    expect(staleRecords([], now)).toBe(0);
  });
});
