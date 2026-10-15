"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createCookieClient } from "@/lib/supabase/server";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { HQ_OTP_EMAIL_COOKIE } from "@/lib/hq/cookies";
import type { SearchHit, SearchResults } from "@/components/hq/types";

/*
 * Server Actions the HQ shell is given as props. They are reachable by direct POST, so
 * each one checks who is calling for itself. They never trust anything the browser
 * sends about identity.
 */

// ── sign out ─────────────────────────────────────────────────

export async function signOutAction(): Promise<void> {
  const supabase = await createCookieClient();
  try {
    // "local": this device only. A person signed in on a second device stays signed in there.
    await supabase.auth.signOut({ scope: "local" });
  } catch (e) {
    console.error("[hq] signOut failed:", e instanceof Error ? e.message : e);
  }
  const store = await cookies();
  store.set(HQ_OTP_EMAIL_COOKIE, "", { path: HQ_BASE, maxAge: 0 });
  redirect(`${HQ_BASE}/sign-in`);
}

// ── global search ────────────────────────────────────────────

const EMPTY: SearchResults = { contacts: [], organisations: [], referrals: [], tasks: [], contractors: [] };

function hits(value: unknown): SearchHit[] {
  if (!Array.isArray(value)) return [];
  const out: SearchHit[] = [];
  for (const v of value) {
    if (!v || typeof v !== "object") continue;
    const r = v as Record<string, unknown>;
    const id = typeof r.id === "string" ? r.id : null;
    const title = typeof r.title === "string" ? r.title : null;
    if (!id || !title) continue;
    out.push({ id, title, subtitle: typeof r.subtitle === "string" ? r.subtitle : null });
  }
  return out;
}

/**
 * hq.global_search runs as the signed-in person (security invoker), so row level security
 * decides what they can find. A person who may not read contacts gets no contacts back.
 */
export async function searchAction(query: string): Promise<SearchResults> {
  const { db } = await requireStaff();
  const q = typeof query === "string" ? query.trim().slice(0, 100) : "";
  if (q.length < 2) return EMPTY;

  const { data, error } = await db.rpc("global_search", { p_query: q, p_limit: 6 });
  if (error) {
    console.error("[hq] global_search failed:", error.code);
    throw new Error("Search is unavailable right now.");
  }
  const r = (data ?? {}) as Record<string, unknown>;
  return {
    contacts: hits(r.contacts),
    organisations: hits(r.organisations),
    referrals: hits(r.referrals),
    tasks: hits(r.tasks),
    contractors: hits(r.contractors),
  };
}
