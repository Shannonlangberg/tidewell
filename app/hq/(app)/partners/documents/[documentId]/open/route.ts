import { NextResponse } from "next/server";
import { requireStaff } from "@/lib/hq/auth";
import { DOCUMENT_BUCKET } from "@/lib/hq/contractors/documents-rules";
import { isUuid } from "@/lib/hq/forms";

/*
 * Opens a contractor document: GET /hq/partners/documents/<document id>/open
 *
 * The check comes first, as the signed-in person: requireStaff("contractors.documents"), then the
 * document row is read under row level security (a person who cannot see it gets nothing back),
 * then Storage is asked for a signed link with THEIR session (the bucket's own policy applies
 * again). The link lasts 60 seconds and is never stored, logged or shown; this handler redirects
 * the browser to it and the file opens in a new tab. Nothing about the file is public, and the
 * storage path is never sent to the page.
 */

const SIGNED_SECONDS = 60;
const NO_STORE = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } as const;

const notFound = () => new Response("That document could not be found.", { status: 404, headers: { ...NO_STORE, "Content-Type": "text/plain; charset=utf-8" } });

export async function GET(_request: Request, ctx: { params: Promise<{ documentId: string }> }) {
  const { db } = await requireStaff("contractors.documents");
  const { documentId } = await ctx.params;
  if (!isUuid(documentId)) return notFound();

  const doc = await db.from("contractor_documents").select("storage_path").eq("id", documentId).is("deleted_at", null).maybeSingle();
  if (doc.error) {
    console.error("[hq] opening a document: lookup failed:", doc.error.code);
    return new Response("We could not open that document. Try again in a moment.", { status: 500, headers: NO_STORE });
  }
  if (!doc.data) return notFound();

  const signed = await db.storage.from(DOCUMENT_BUCKET).createSignedUrl(doc.data.storage_path, SIGNED_SECONDS);
  if (signed.error || !signed.data?.signedUrl) {
    console.error("[hq] opening a document: signing failed:", signed.error?.name ?? "error");
    return notFound();
  }
  return NextResponse.redirect(signed.data.signedUrl, { status: 302, headers: NO_STORE });
}
