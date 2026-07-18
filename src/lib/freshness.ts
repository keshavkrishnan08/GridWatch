/* ------------------------------------------------------------------
   Data freshness.

   A dataset like this doesn't fail loudly when it goes stale — it just
   quietly becomes wrong while still looking authoritative. That's the most
   embarrassing failure mode available to us, so the age of the data is a
   first-class, visible fact rather than a footnote.
   ------------------------------------------------------------------ */

export type FreshLevel = "fresh" | "aging" | "stale";

export interface Freshness {
  days: number;
  level: FreshLevel;
  label: string;      // "updated 3 days ago"
  note: string | null; // shown when the data needs a caveat
}

/** Above this many days the UI starts warning; above the second, it insists. */
const AGING_DAYS = 60;
const STALE_DAYS = 180;

export function freshness(lastUpdated: string | null | undefined, now = new Date()): Freshness {
  if (!lastUpdated) {
    return {
      days: Infinity, level: "stale", label: "update date unknown",
      note: "This dataset carries no update date. Treat every figure as unverified.",
    };
  }
  const then = new Date(lastUpdated + "T00:00:00Z");
  if (isNaN(then.getTime())) {
    return {
      days: Infinity, level: "stale", label: "update date unreadable",
      note: "This dataset's update date could not be read.",
    };
  }
  const days = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 86_400_000));

  const label =
    days === 0 ? "updated today"
    : days === 1 ? "updated yesterday"
    : days < 45 ? `updated ${days} days ago`
    : days < 365 ? `updated ${Math.round(days / 30)} months ago`
    : `updated ${(days / 365).toFixed(1)} years ago`;

  if (days >= STALE_DAYS) {
    return {
      days, level: "stale", label,
      note: `This data is ${label.replace("updated ", "")} and is probably out of date. ` +
            `Data-center proposals move fast — verify against current filings before relying on it.`,
    };
  }
  if (days >= AGING_DAYS) {
    return {
      days, level: "aging", label,
      note: `New filings may have landed since this snapshot. Check the sources on any figure you cite.`,
    };
  }
  return { days, level: "fresh", label, note: null };
}

export const FRESH_COLOR: Record<FreshLevel, string> = {
  fresh: "var(--phosphor)",
  aging: "var(--load-med)",
  stale: "var(--warning)",
};

/** Per-record staleness, for facilities that haven't been re-checked. */
export function staleRecords(
  facs: { last_verified?: string | null }[],
  now = new Date(),
  thresholdDays = STALE_DAYS
): number {
  return facs.filter((f) => {
    if (!f.last_verified) return true;
    const t = new Date(f.last_verified + "T00:00:00Z").getTime();
    if (isNaN(t)) return true;
    return (now.getTime() - t) / 86_400_000 >= thresholdDays;
  }).length;
}
