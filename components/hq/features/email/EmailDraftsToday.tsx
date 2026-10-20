import Link from "next/link";
import { requireStaff } from "@/lib/hq/auth";
import { formatDateTime } from "@/lib/hq/format";
import { listEmails } from "@/lib/hq/email/queries";
import { emailFrom } from "@/lib/hq/email/send";
import { approveAndSendAction, discardEmailDraftAction, sendApprovedAction } from "@/app/hq/(app)/email/actions";
import { EmailControls } from "./EmailControls";

/*
 * "Drafts waiting for approval" on Today, for people who can approve and send (email.send). The
 * drafts are the ones the database lets them see: their own, or everyone's for directors and
 * administrators. One tap (then a confirmation naming the recipient) approves and sends; Edit and
 * Discard sit beside it. When nothing is waiting, the section is left out.
 */

const SHOWN = 5;

export async function EmailDraftsToday() {
  const { db, staff, can } = await requireStaff();
  if (!can("email.send")) return null;
  const loaded = await listEmails(db, { statuses: ["draft", "approved"], limit: SHOWN, page: 1 });
  if (!loaded.ok) return <p className="hq-today__quiet">Drafts waiting for approval: this could not be loaded just now. Reload the page to try again.</p>;
  const { rows, total } = loaded.data;
  if (rows.length === 0) return null;
  const from = emailFrom();

  return (
    <section id="email-drafts" aria-labelledby="email-drafts-h" className="hq-today__section hq-email-today">
      <div className="hq-today__head">
        <h2 id="email-drafts-h" className="hq-today__title">
          Drafts waiting for approval
          <span className="hq-today__count hq-nums">{total}</span>
        </h2>
        <Link href="/hq/email" className="hq-today__more">
          {total > rows.length ? `All ${total}` : "Email"}
        </Link>
      </div>
      <ul className="hq-today__list">
        {rows.map((e) => {
          const own = e.createdBy === staff.id;
          return (
            <li key={e.id} className="hq-today__row">
              <div className="hq-today__main">
                <p className="hq-today__name">
                  <Link href={`/hq/email/${e.id}`}>{e.toName}</Link>
                </p>
                <p className="hq-today__sub">
                  {e.subject}
                  <span aria-hidden="true"> · </span>
                  {e.status === "approved" ? "approved, not sent" : own ? "your draft" : `from ${e.createdByName ?? "a colleague"}`}
                  <span aria-hidden="true"> · </span>
                  {formatDateTime(e.createdAt, staff.timezone)}
                </p>
              </div>
              <EmailControls
                compact
                id={e.id}
                refLabel={e.ref}
                toName={e.toName}
                toEmail={e.toEmail}
                fromLabel={`${from.name} (${from.email})`}
                replyTo={e.replyTo}
                returnTo="/hq"
                can={{
                  approveAndSend: e.status === "draft" && (own || can("audit.read")),
                  sendNow: e.status === "approved" && (own || e.approvedBy === staff.id),
                  edit: own && e.status === "draft",
                  discard: own || staff.role === "director",
                }}
                approveAndSend={approveAndSendAction}
                sendNow={sendApprovedAction}
                discard={discardEmailDraftAction}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}
