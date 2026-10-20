import "server-only";

import type { Capability } from "../constants";
import type { HqClient } from "../db";
import { contractorOptions } from "../contractors/queries";
import { contactOptions, organisationOptions, staffOptions } from "../queries/options";
import { leadOptions } from "./queries";

/*
 * The pickers for the meeting form and the meeting page, each only when the person may read that kind
 * of record (row level security would return nothing anyway; this saves the query).
 */
export async function formOptions(db: HqClient, can: (c: Capability) => boolean) {
  const growth = can("growth.read");
  const [staff, contacts, organisations, leads, contractors] = await Promise.all([
    staffOptions(db),
    growth ? contactOptions(db) : Promise.resolve([]),
    growth ? organisationOptions(db) : Promise.resolve([]),
    growth ? leadOptions(db) : Promise.resolve([]),
    can("contractors.read") ? contractorOptions(db) : Promise.resolve([]),
  ]);
  return { staff, contacts, organisations, leads, contractors };
}
