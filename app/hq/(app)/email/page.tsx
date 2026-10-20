import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { commsHref } from "@/lib/hq/communications";
import { buildHref } from "@/components/hq";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/*
 * The old address of the email list. The list now lives in Communications > Emails; this keeps old
 * links and bookmarks working (the view, page and any notice are kept). An email's own pages
 * (/hq/email/<id>, /hq/email/new, /hq/email/<id>/edit) stay where they are.
 */
export default async function EmailListRedirect({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  await requireStaff("email.draft", false, buildHref("/hq/email", sp));
  redirect(commsHref("emails", sp));
}
