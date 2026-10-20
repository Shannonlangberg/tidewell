import Link from "next/link";
import { requireStaff } from "@/lib/hq/auth";
import { waitingForApproval } from "@/lib/hq/knowledge/queries";

/*
 * One quiet line on Today for people who approve knowledge (knowledge.approve): how many documents have
 * a draft waiting, linking to the list filtered to them (or straight to the one document). Unwritten
 * starter templates are not counted. Nothing is shown when none are waiting.
 */
export async function KnowledgeApprovalsToday() {
  const { db, can } = await requireStaff();
  if (!can("knowledge.approve")) return null;
  const loaded = await waitingForApproval(db, 1);
  if (!loaded.ok) return <p className="hq-today__quiet">Knowledge approvals: this could not be loaded just now. Reload the page to try again.</p>;
  const { rows, total } = loaded.data;
  if (total === 0) return null;
  const one = total === 1 ? rows[0] : null;
  return (
    <p className="hq-today__quiet" id="knowledge-approvals">
      Needs approval:{" "}
      {one ? (
        <Link href={`/hq/knowledge/${one.id}${one.approvedVersion === null ? "" : `/versions/${one.currentVersion}`}`} className="hq-today__inline">
          {one.ref} {one.title}
        </Link>
      ) : (
        <Link href="/hq/knowledge?status=waiting" className="hq-today__inline">
          {total} knowledge documents
        </Link>
      )}{" "}
      {total === 1 ? "has a draft" : "have drafts"} waiting for you to review.
    </p>
  );
}
