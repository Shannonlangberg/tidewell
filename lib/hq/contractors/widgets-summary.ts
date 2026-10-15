/*
 * Reads hq.contractor_summary() (a jsonb document) into a typed, defensive shape for the
 * dashboard widgets. Pure with no value imports, so `node --test` runs it.
 *
 * Nothing is invented: a missing or malformed field becomes 0 or an empty list, and a trade
 * is named as "without cover" only when the database says so (`trades_without_cover`).
 */

export type CoverageRow = { category: string; approved: number; preferred: number; total: number };

export type ContractorSummary = {
  asOf: string;
  warningDays: number;
  total: number;
  awaitingVetting: number;
  expiringSoon: number;
  expired: number;
  clearedWithExpiredItems: number;
  coverage: CoverageRow[];
  tradesWithoutCover: string[];
};

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export function parseContractorSummary(json: unknown): ContractorSummary {
  const o: Obj = isObj(json) ? json : {};
  const coverage: CoverageRow[] = [];
  if (Array.isArray(o.preferred_coverage)) {
    for (const r of o.preferred_coverage) {
      if (isObj(r) && typeof r.category === "string") {
        coverage.push({ category: r.category, approved: num(r.approved), preferred: num(r.preferred), total: num(r.total) });
      }
    }
  }
  return {
    asOf: typeof o.as_of === "string" ? o.as_of : "",
    warningDays: num(o.warning_days) > 0 ? num(o.warning_days) : 30,
    total: num(o.total),
    awaitingVetting: num(o.awaiting_vetting),
    expiringSoon: num(o.expiring_soon),
    expired: num(o.expired),
    clearedWithExpiredItems: num(o.cleared_with_expired_items),
    coverage,
    tradesWithoutCover: Array.isArray(o.trades_without_cover) ? o.trades_without_cover.filter((t): t is string => typeof t === "string") : [],
  };
}

/** The trades the coverage widget counts: every category except "other" (the database never lists "other" as uncovered). */
export function coveredTrades(rows: readonly CoverageRow[]): CoverageRow[] {
  return rows.filter((r) => r.category !== "other" && r.total > 0);
}
