import "server-only";

import type { HqClient } from "../db";
import { logTag } from "../contractors/db-errors";
import type { Loaded } from "../contractors/types";
import { sortTrades, tradeLookup, type Trade, type TradeLookup } from "./rules";

/*
 * Reads hq.trades AS the signed-in person (RLS: contractors.read). Every screen that shows or edits
 * trades reads them here, never from a hard-coded list: the owner renames, adds, reorders and
 * archives them. Archived trades are included (they still label contractors that carry them);
 * callers filter with `isActive` when offering choices.
 */

type TradeRow = { id: string; slug: string; label: string; description: string | null; sort_order: number; is_active: boolean | null; archived_at: string | null };

export function toTrade(r: TradeRow): Trade {
  return { id: r.id, slug: r.slug, label: r.label, description: r.description, sortOrder: r.sort_order, isActive: r.is_active ?? r.archived_at === null };
}

/** Every trade (active and archived), in the owner's order. */
export async function loadTrades(db: HqClient): Promise<Loaded<Trade[]>> {
  const { data, error } = await db.from("trades").select("id, slug, label, description, sort_order, is_active, archived_at").order("sort_order").order("label").limit(500);
  if (error) {
    console.error("[hq] loadTrades failed:", logTag(error));
    return { ok: false };
  }
  return { ok: true, data: sortTrades((data ?? []).map(toTrade)) };
}

/** The trades and a slug -> label lookup; an empty list (and a humanised fallback) when they cannot be read. */
export async function tradesAndLookup(db: HqClient): Promise<{ ok: boolean; trades: Trade[]; lookup: TradeLookup }> {
  const r = await loadTrades(db);
  const trades = r.ok ? r.data : [];
  return { ok: r.ok, trades, lookup: tradeLookup(trades) };
}
