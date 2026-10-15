import "server-only";

import type { HqClient } from "../db";

/** id -> full name for the staff ids given. Staff are readable by every member of staff (people.read). A failure returns an empty map: names are a nicety. */
export async function staffNameMap(db: HqClient, ids: ReadonlyArray<string | null | undefined>): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((i): i is string => !!i))];
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const { data, error } = await db.from("staff_profiles").select("id, full_name").in("id", unique);
  if (error) {
    console.error("[hq] staff names failed:", error.code);
    return out;
  }
  for (const s of data ?? []) out.set(s.id, s.full_name);
  return out;
}
