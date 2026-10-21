import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/hq/auth";
import { isUuid } from "@/lib/hq/forms";
import { RESOURCE_BUCKET, SIGNED_DOWNLOAD_SECONDS } from "@/lib/hq/resources/rules";

/*
 * Downloads a brand resource: GET /hq/resources/<id>/download, or ?v=<version number> for an earlier file.
 *
 * The check comes first, as the signed-in person: requireStaff("resources.read"), then the row is read
 * under row level security (a person who cannot see it gets nothing back), then Storage is asked for a
 * signed link with THEIR session (the bucket's own policy applies again) that makes the browser SAVE the
 * file under its own name, never display it: an uploaded SVG or HTML file is never rendered from this
 * address. The link lasts 60 seconds and is never stored, logged or shown; this handler redirects to it.
 * The storage path is never sent to the page.
 */

const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;

const notFound = () => new Response("That resource could not be found.", { status: 404, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { db } = await requireStaff("resources.read");
  const { id } = await ctx.params;
  if (!isUuid(id)) return notFound();
  const wanted = new URL(request.url).searchParams.get("v");
  const version = wanted === null ? null : /^\d{1,4}$/.test(wanted) ? Number(wanted) : NaN;
  if (Number.isNaN(version)) return notFound();

  let path: string | null = null;
  let fileName = "";
  if (version === null) {
    const row = await db.from("brand_resources").select("storage_path, file_name").eq("id", id).maybeSingle();
    if (row.error) {
      console.error("[hq] downloading a resource: lookup failed:", row.error.code);
      return new Response("We could not open that file. Try again in a moment.", { status: 500, headers: NO_STORE });
    }
    path = row.data?.storage_path ?? null;
    fileName = row.data?.file_name ?? "";
  } else {
    const row = await db.from("brand_resource_versions").select("storage_path, file_name").eq("resource_id", id).eq("version_number", version).maybeSingle();
    if (row.error) {
      console.error("[hq] downloading a resource version: lookup failed:", row.error.code);
      return new Response("We could not open that file. Try again in a moment.", { status: 500, headers: NO_STORE });
    }
    path = row.data?.storage_path ?? null;
    fileName = row.data?.file_name ?? "";
  }
  if (!path) return notFound();

  const signed = await db.storage.from(RESOURCE_BUCKET).createSignedUrl(path, SIGNED_DOWNLOAD_SECONDS, { download: fileName || true });
  if (signed.error || !signed.data?.signedUrl) {
    console.error("[hq] downloading a resource: signing failed:", signed.error?.name ?? "error");
    return notFound();
  }
  return NextResponse.redirect(signed.data.signedUrl, { status: 302, headers: NO_STORE });
}
