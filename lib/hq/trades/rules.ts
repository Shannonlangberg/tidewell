/*
 * Trades (hq.trades, migration 0123): the owner-editable list of industries contractors work in.
 * A trade has a stable `slug` (stored in contractors.categories, never changes) and a `label` the
 * owner can rename ("Plumbing" -> "Plumbers").
 *
 * Pure and import-free, so `node --test` runs it (rules.test.mts) and both the server and the
 * client can use it: slug derivation (the database's rule, mirrored), ordering, label lookup with
 * a fallback, loose matching of a typed trade name (for the MCP tools and the import), the
 * per-trade containers on the Trades page, the coverage wording, and "last used" wording.
 */

export type Trade = {
  id: string;
  slug: string;
  label: string;
  description: string | null;
  sortOrder: number;
  isActive: boolean;
};

// ── slugs (mirrors hq_private.trade_slug_base / trade_unique_slug) ──

/** The slug a label would get: lower snake, "&" read as "and", at most 40 characters, starting with a letter. */
export function tradeSlugBase(label: string): string {
  const s = label
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
    .replace(/^_+|_+$/g, "");
  if (s === "") return "trade";
  if (/^[0-9]/.test(s)) return `t_${s}`.slice(0, 40);
  return s;
}

/** The base slug, or base_2, base_3 ... when taken (archived trades keep their slugs for ever). */
export function uniqueTradeSlug(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  const base = tradeSlugBase(label);
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** A label as the database stores it: trimmed, inner whitespace collapsed. */
export function cleanTradeLabel(label: string): string {
  return label.replace(/\s+/g, " ").trim();
}

// ── order and labels ─────────────────────────────────────────

/** The owner's order: sort_order, then label (case-insensitive), then slug. Returns a new array. */
export function sortTrades<T extends Pick<Trade, "sortOrder" | "label" | "slug">>(trades: readonly T[]): T[] {
  return [...trades].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.label.localeCompare(b.label, "en-AU", { sensitivity: "base" }) || a.slug.localeCompare(b.slug),
  );
}

/** "air_conditioning" -> "Air conditioning": only when a slug has no trade row (it should not happen). */
export function humaniseSlug(slug: string): string {
  const t = slug.replace(/_/g, " ").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : slug;
}

export type TradeLookup = ReadonlyMap<string, Pick<Trade, "label" | "isActive">>;

export function tradeLookup(trades: readonly Pick<Trade, "slug" | "label" | "isActive">[]): Map<string, Pick<Trade, "label" | "isActive">> {
  return new Map(trades.map((t) => [t.slug, { label: t.label, isActive: t.isActive }]));
}

export function tradeLabel(slug: string, lookup: TradeLookup): string {
  return lookup.get(slug)?.label ?? humaniseSlug(slug);
}

export function tradeLabels(slugs: readonly string[], lookup: TradeLookup): string[] {
  return slugs.map((s) => tradeLabel(s, lookup));
}

/**
 * The trades a form offers: every active trade in order, plus any archived trade the record already
 * carries (so editing never silently drops it), marked as archived.
 */
export function tradeOptions(trades: readonly Trade[], current: readonly string[] = []): Array<{ value: string; label: string }> {
  const have = new Set(current);
  return sortTrades(trades.filter((t) => t.isActive || have.has(t.slug))).map((t) => ({ value: t.slug, label: t.isActive ? t.label : `${t.label} (archived)` }));
}

/** The slugs a form may submit: active trades plus what the record already carries. */
export function allowedTradeSlugs(trades: readonly Trade[], current: readonly string[] = []): string[] {
  const have = new Set(current);
  return trades.filter((t) => t.isActive || have.has(t.slug)).map((t) => t.slug);
}

// ── loose matching ("electricians" -> electrical) ─────────────

const words = (s: string): string[] =>
  s
    .toLowerCase()
    .replace(/&/g, " and ")
    .split(/[^a-z0-9]+/)
    .filter((w) => w && w !== "and");

/** A rough stem: "electricians", "electrical", "plumbers", "plumbing", "painters" -> electric / electr / plumb / plumb / paint. */
function stem(w: string): string {
  for (const suffix of ["icians", "ician", "ians", "ian", "ical", "ers", "er", "ing", "al", "es", "s"]) {
    if (w.length - suffix.length >= 4 && w.endsWith(suffix)) return w.slice(0, -suffix.length);
  }
  return w;
}

const close = (a: string, b: string): boolean => {
  const x = stem(a);
  const y = stem(b);
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  return short.length >= 4 && long.startsWith(short);
};

export type TradeMatch<T> = { kind: "match"; trade: T; exact: boolean } | { kind: "ambiguous"; options: T[] } | { kind: "none" };

/**
 * Finds the trade a person meant. Exact first (slug, slug with spaces, label; any case), then close:
 * every typed word stem-matches a word of the label or slug ("electricians" -> Electrical), preferring
 * a trade whose every word was typed ("cleaning" -> Cleaning, not Carpet cleaning). Archived trades
 * are only matched exactly. Never guesses between several: those come back as "ambiguous".
 */
export function matchTrade<T extends Pick<Trade, "slug" | "label" | "isActive">>(input: string, trades: readonly T[]): TradeMatch<T> {
  const raw = input.trim().toLowerCase();
  if (!raw) return { kind: "none" };
  const flat = words(raw).join(" ");
  const exact = trades.filter((t) => t.slug === raw || t.slug.replace(/_/g, " ") === flat || words(t.label).join(" ") === flat);
  if (exact.length === 1) return { kind: "match", trade: exact[0], exact: true };
  if (exact.length > 1) return { kind: "ambiguous", options: exact };

  const typed = words(raw);
  if (typed.length === 0) return { kind: "none" };
  // partial: every typed word is found in the trade; full: and every word of the trade was typed
  const partial: T[] = [];
  const full: T[] = [];
  for (const t of trades) {
    if (!t.isActive) continue;
    let isPartial = false;
    let isFull = false;
    for (const target of [words(t.label), words(t.slug)]) {
      if (target.length === 0) continue;
      if (typed.every((w) => target.some((x) => close(w, x)))) {
        isPartial = true;
        if (target.every((x) => typed.some((w) => close(w, x)))) isFull = true;
      }
    }
    if (isPartial) partial.push(t);
    if (isFull) full.push(t);
  }
  if (full.length === 1) return { kind: "match", trade: full[0], exact: false };
  if (full.length > 1) return { kind: "ambiguous", options: full };
  if (partial.length === 1) return { kind: "match", trade: partial[0], exact: false };
  if (partial.length > 1) return { kind: "ambiguous", options: partial };
  return { kind: "none" };
}

// ── the Trades page: one container per trade ─────────────────

export type ContainerContractor = {
  id: string;
  businessName: string;
  status: string;
  categories: readonly string[];
  lastJobDate: string | null;
};

export type TradeCounts = { cleared: number; approved: number; preferred: number; vetting: number; prospects: number; total: number };

export type TradeContainer<C extends ContainerContractor> = {
  /** The trade, or null for the bucket of contractors whose trades are all unknown (should stay empty). */
  trade: Trade | null;
  contractors: C[];
  counts: TradeCounts;
  /** The most recent last_job_date among its contractors, or null. */
  lastUsed: string | null;
};

const STATUS_RANK: Record<string, number> = { preferred: 0, approved: 1, vetting: 2, contacted: 3, prospect: 4, suspended: 5, inactive: 6 };

export function countContractors(list: readonly Pick<ContainerContractor, "status">[]): TradeCounts {
  const c: TradeCounts = { cleared: 0, approved: 0, preferred: 0, vetting: 0, prospects: 0, total: list.length };
  for (const x of list) {
    if (x.status === "approved") c.approved++;
    if (x.status === "preferred") c.preferred++;
    if (x.status === "vetting") c.vetting++;
    if (x.status === "prospect" || x.status === "contacted") c.prospects++;
  }
  c.cleared = c.approved + c.preferred;
  return c;
}

export type ContainerSort = "status" | "name" | "last_used";
export const CONTAINER_SORTS: readonly ContainerSort[] = ["status", "name", "last_used"];

const byName = (a: ContainerContractor, b: ContainerContractor) => a.businessName.localeCompare(b.businessName, "en-AU", { sensitivity: "base" }) || a.id.localeCompare(b.id);

/** status: preferred, approved, vetting ... then name. last_used: most recent first, never-recorded last, then name. */
export function sortContainerContractors<C extends ContainerContractor>(list: readonly C[], sort: ContainerSort): C[] {
  const out = [...list];
  if (sort === "name") return out.sort(byName);
  if (sort === "last_used") {
    return out.sort((a, b) => {
      if (a.lastJobDate && b.lastJobDate && a.lastJobDate !== b.lastJobDate) return a.lastJobDate < b.lastJobDate ? 1 : -1;
      if (!!a.lastJobDate !== !!b.lastJobDate) return a.lastJobDate ? -1 : 1;
      return byName(a, b);
    });
  }
  return out.sort((a, b) => (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || byName(a, b));
}

/**
 * One container per active trade (in the owner's order), each holding every contractor that carries
 * it (a contractor in several trades appears in each). An archived trade that a contractor still
 * carries gets a container too, after the active ones, so nobody disappears. Contractors none of
 * whose trades is known go in a final container with trade null (only shown when not empty).
 */
export function buildTradeContainers<C extends ContainerContractor>(trades: readonly Trade[], contractors: readonly C[], sort: ContainerSort = "status"): TradeContainer<C>[] {
  const bySlug = new Map<string, C[]>();
  const unknown: C[] = [];
  const known = new Set(trades.map((t) => t.slug));
  for (const c of contractors) {
    let placed = false;
    for (const slug of new Set(c.categories)) {
      if (!known.has(slug)) continue;
      placed = true;
      const list = bySlug.get(slug);
      if (list) list.push(c);
      else bySlug.set(slug, [c]);
    }
    if (!placed) unknown.push(c);
  }
  const shown = [...sortTrades(trades.filter((t) => t.isActive)), ...sortTrades(trades.filter((t) => !t.isActive && (bySlug.get(t.slug)?.length ?? 0) > 0))];
  const make = (trade: Trade | null, list: C[]): TradeContainer<C> => ({
    trade,
    contractors: sortContainerContractors(list, sort),
    counts: countContractors(list),
    lastUsed: list.reduce<string | null>((m, c) => (c.lastJobDate && (!m || c.lastJobDate > m) ? c.lastJobDate : m), null),
  });
  const out = shown.map((t) => make(t, bySlug.get(t.slug) ?? []));
  if (unknown.length > 0) out.push(make(null, unknown));
  return out;
}

/** The plain coverage line for a container. "warning" when nobody is approved for the trade. */
export function coverageLine(counts: TradeCounts, label: string): { tone: "ok" | "warning" | "empty"; text: string } {
  if (counts.total === 0) return { tone: "empty", text: `No contractors in ${label} yet.` };
  if (counts.cleared === 0) {
    const pending = counts.vetting + counts.prospects;
    return {
      tone: "warning",
      text: `No approved contractor for ${label}.${pending > 0 ? ` ${pending} ${pending === 1 ? "is" : "are"} still a prospect or being vetted.` : ""}`,
    };
  }
  const parts = [counts.approved > 0 ? `${counts.approved} approved` : null, counts.preferred > 0 ? `${counts.preferred} preferred` : null].filter(Boolean);
  return { tone: "ok", text: `Covered: ${parts.join(", ")}.` };
}

// ── "last used" (contractors.last_job_date, recorded by staff) ──

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Oct 2026" from YYYY-MM-DD, without a timezone (a calendar date is the same day everywhere). */
export function shortDate(date: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!m) return date;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
}

/** Whole days from `date` back to `today` (both YYYY-MM-DD); negative when `date` is after today. */
export function daysAgo(date: string, today: string): number | null {
  const a = Date.parse(`${date.slice(0, 10)}T00:00:00Z`);
  const b = Date.parse(`${today.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/** "today", "yesterday", "3 days ago", "2 weeks ago", "4 months ago", "2 years ago". */
export function agoText(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 14) return `${days} days ago`;
  if (days < 60) return `${Math.floor(days / 7)} weeks ago`;
  if (days < 730) {
    const m = Math.floor(days / 30.4375);
    return `${m} month${m === 1 ? "" : "s"} ago`;
  }
  return `${Math.floor(days / 365.25)} years ago`;
}

/** "Last used 12 Oct 2026 (3 days ago)" or "Never recorded". */
export function lastUsedText(date: string | null | undefined, today: string): string {
  if (!date) return "Never recorded";
  const d = daysAgo(date, today);
  return d === null ? `Last used ${shortDate(date)}` : `Last used ${shortDate(date)} (${agoText(d)})`;
}
