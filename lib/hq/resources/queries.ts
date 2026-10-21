import "server-only";

import type { HqClient } from "../db";
import {
  RESOURCE_BUCKET,
  SIGNED_PREVIEW_SECONDS,
  matchesSearch,
  type ResourceCategory,
} from "./rules";

/*
 * Reads for the Resources screens, the download routes and the MCP tools. Every query runs as the signed-in
 * person, so row level security is the control: without resources.read nothing comes back (not the rows, the
 * versions, nor the stored files); archived resources are visible to resources.manage holders only.
 *
 * Files are never public. A person gets a short-lived signed link made with THEIR session (the bucket's own
 * policy applies again). Nothing here logs more than an error code.
 */

export type Result<T> = { ok: true; data: T } | { ok: false };

export type ResourceRow = {
  id: string;
  ref: string;
  refNumber: number;
  title: string;
  description: string | null;
  category: ResourceCategory;
  fileName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  tags: string[];
  sortOrder: number;
  version: string;
  versionNumber: number;
  note: string | null;
  createdByName: string | null;
  updatedByName: string | null;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
};

export type VersionRow = {
  id: string;
  versionNumber: number;
  label: string;
  fileName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  contentSha256: string;
  changeNote: string | null;
  createdAt: string;
  createdByName: string | null;
};

export const RESOURCE_COLUMNS =
  "id, ref, ref_number, title, description, category, file_name, storage_path, mime_type, size_bytes, content_sha256, tags, sort_order, version, version_number, note, created_by_name, updated_by_name, created_at, updated_at, deleted_at";

type OverviewRow = {
  id: string | null;
  ref: string | null;
  ref_number: number | null;
  title: string | null;
  description: string | null;
  category: ResourceCategory | null;
  file_name: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  content_sha256: string | null;
  tags: string[] | null;
  sort_order: number | null;
  version: string | null;
  version_number: number | null;
  note: string | null;
  created_by_name: string | null;
  updated_by_name: string | null;
  created_at: string | null;
  updated_at: string | null;
  deleted_at: string | null;
};

export function toResourceRow(r: OverviewRow): ResourceRow | null {
  if (!r.id || !r.ref || r.ref_number === null || !r.title || !r.category || !r.file_name || !r.storage_path || !r.mime_type || r.size_bytes === null || !r.content_sha256 || !r.created_at || !r.updated_at) {
    return null;
  }
  return {
    id: r.id,
    ref: r.ref,
    refNumber: r.ref_number,
    title: r.title,
    description: r.description,
    category: r.category,
    fileName: r.file_name,
    storagePath: r.storage_path,
    mimeType: r.mime_type,
    sizeBytes: Number(r.size_bytes),
    contentSha256: r.content_sha256,
    tags: r.tags ?? [],
    sortOrder: r.sort_order ?? 0,
    version: r.version ?? "v1",
    versionNumber: r.version_number ?? 1,
    note: r.note,
    createdByName: r.created_by_name,
    updatedByName: r.updated_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    archived: r.deleted_at !== null,
  };
}

export const resourceRowsOf = (data: unknown): ResourceRow[] => ((data ?? []) as OverviewRow[]).map(toResourceRow).filter((r): r is ResourceRow => r !== null);

/** The most resources one list reads. The library is a few hundred files at most; a search narrows it. */
export const LIBRARY_MAX = 1000;

/**
 * The live library, by category, then sort order, then title. Search words are matched here (the library is
 * small): title, file name, description, tags and the RES number.
 */
export async function listResources(db: HqClient, filter: { category?: ResourceCategory | null; q?: string } = {}): Promise<Result<ResourceRow[]>> {
  let q = db.from("brand_resource_overview").select(RESOURCE_COLUMNS).is("deleted_at", null);
  if (filter.category) q = q.eq("category", filter.category);
  const { data, error } = await q.order("category").order("sort_order").order("title").limit(LIBRARY_MAX);
  if (error) {
    console.error("[hq] listResources failed:", error.code);
    return { ok: false };
  }
  const rows = resourceRowsOf(data);
  return { ok: true, data: filter.q ? rows.filter((r) => matchesSearch(r, filter.q ?? "")) : rows };
}

/** One resource by id: live ones for everyone with resources.read, archived ones for managers. Null when not found or not visible. */
export async function getResource(db: HqClient, id: string): Promise<Result<ResourceRow | null>> {
  const { data, error } = await db.from("brand_resource_overview").select(RESOURCE_COLUMNS).eq("id", id).maybeSingle();
  if (error) {
    console.error("[hq] getResource failed:", error.code);
    return { ok: false };
  }
  return { ok: true, data: data ? toResourceRow(data as OverviewRow) : null };
}

/** The files a resource has had, newest first. */
export async function listVersions(db: HqClient, id: string): Promise<Result<VersionRow[]>> {
  const { data, error } = await db
    .from("brand_resource_versions")
    .select("id, version_number, label, file_name, storage_path, mime_type, size_bytes, content_sha256, change_note, created_at, created_by_name")
    .eq("resource_id", id)
    .order("version_number", { ascending: false });
  if (error) {
    console.error("[hq] listVersions failed:", error.code);
    return { ok: false };
  }
  return {
    ok: true,
    data: (data ?? []).map((v) => ({
      id: v.id,
      versionNumber: v.version_number,
      label: v.label,
      fileName: v.file_name,
      storagePath: v.storage_path,
      mimeType: v.mime_type,
      sizeBytes: Number(v.size_bytes),
      contentSha256: v.content_sha256,
      changeNote: v.change_note,
      createdAt: v.created_at,
      createdByName: v.created_by_name,
    })),
  };
}

/** The live resource that already holds this content in this category, if any (for an early, friendly refusal). */
export async function findDuplicate(db: HqClient, category: ResourceCategory, sha256: string, exceptId?: string): Promise<Result<{ ref: string; title: string } | null>> {
  let q = db.from("brand_resource_overview").select("id, ref, title").eq("category", category).eq("content_sha256", sha256).is("deleted_at", null);
  if (exceptId) q = q.neq("id", exceptId);
  const { data, error } = await q.limit(1);
  if (error) {
    console.error("[hq] findDuplicate failed:", error.code);
    return { ok: false };
  }
  const hit = data?.[0];
  return { ok: true, data: hit?.ref && hit.title ? { ref: hit.ref, title: hit.title } : null };
}

/** True when a live resource other than `exceptId` already has this title (ignoring case). */
export async function titleTaken(db: HqClient, title: string, exceptId?: string): Promise<Result<boolean>> {
  let q = db.from("brand_resource_overview").select("id").is("deleted_at", null).ilike("title", title.replace(/[\\%_]/g, (c) => `\\${c}`));
  if (exceptId) q = q.neq("id", exceptId);
  const { data, error } = await q.limit(1);
  if (error) {
    console.error("[hq] titleTaken failed:", error.code);
    return { ok: false };
  }
  return { ok: true, data: (data ?? []).length > 0 };
}

// ── files ────────────────────────────────────────────────────

/** Short-lived links for pictures, made in ONE call with the person's session. A path the person cannot read is simply left out. */
export async function signedPreviewUrls(db: HqClient, paths: readonly string[], seconds = SIGNED_PREVIEW_SECONDS): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (paths.length === 0) return out;
  const { data, error } = await db.storage.from(RESOURCE_BUCKET).createSignedUrls([...paths], seconds);
  if (error) {
    console.error("[hq] signing previews failed:", error.name);
    return out;
  }
  for (const item of data ?? []) if (item.path && item.signedUrl) out.set(item.path, item.signedUrl);
  return out;
}

/** The stored file's bytes, read as the person (the bucket's policy applies). Null when it cannot be read. */
export async function readObject(db: HqClient, path: string): Promise<Uint8Array | null> {
  const { data, error } = await db.storage.from(RESOURCE_BUCKET).download(path);
  if (error || !data) {
    console.error("[hq] reading a stored file failed:", error?.name ?? "empty");
    return null;
  }
  return new Uint8Array(await data.arrayBuffer());
}

/** A stored text file, decoded as UTF-8 and cut to `maxBytes`. Null when it cannot be read. */
export async function readText(db: HqClient, path: string, maxBytes: number): Promise<{ text: string; truncated: boolean } | null> {
  const bytes = await readObject(db, path);
  if (!bytes) return null;
  const cut = bytes.length > maxBytes;
  return { text: new TextDecoder("utf-8", { fatal: false }).decode(cut ? bytes.subarray(0, maxBytes) : bytes), truncated: cut };
}
