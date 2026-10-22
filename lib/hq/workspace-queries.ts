import "server-only";

import { cache } from "react";
import type { HqClient } from "./db";
import { isWorkspace, type Workspace } from "./workspaces";

/*
 * The person's saved workspace (staff_profiles.workspace), read once per request for the shell and Today.
 * Null when they have not chosen one (the role's default applies) or when it cannot be read: a preference
 * that fails to load only changes the order things appear in, never what the person may see.
 */
export const loadSavedWorkspace = cache(async (db: HqClient, staffId: string): Promise<Workspace | null> => {
  const { data, error } = await db.from("staff_profiles").select("workspace").eq("id", staffId).maybeSingle();
  if (error) {
    console.error("[hq] saved workspace failed:", error.code ?? "unknown");
    return null;
  }
  const w = (data as { workspace?: unknown } | null)?.workspace;
  return isWorkspace(w) ? w : null;
});
