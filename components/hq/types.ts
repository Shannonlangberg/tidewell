/*
 * Shared prop types for the HQ shell. Server Actions are passed in as props by
 * the page or layout that renders the shell, so the components never import auth
 * or database code.
 */

import type { Capability, StaffRole } from "@/lib/hq/constants";

export type ShellStaff = {
  fullName: string;
  role: StaffRole;
  capabilities: readonly Capability[];
};

/** A Server Action that signs the person out. Posted from a form, so it receives FormData. */
export type SignOutAction = (formData: FormData) => void | Promise<void>;

/** One row in the global search results. */
export type SearchHit = {
  id: string;
  /** The main line: a name, a task title, a reference such as REF-0012. */
  title: string;
  /** A quieter second line: organisation, status, due date. */
  subtitle?: string | null;
};

/** The shape of hq.global_search(query, limit) once the server has parsed the jsonb. */
export type SearchResults = {
  contacts: SearchHit[];
  organisations: SearchHit[];
  referrals: SearchHit[];
  tasks: SearchHit[];
};

/** A Server Action that runs global search as the signed-in person. */
export type SearchAction = (query: string) => Promise<SearchResults>;
