import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { ROLE_LABEL, type StaffRole } from "@/lib/hq/constants";
import { formatDateTime } from "@/lib/hq/format";
import { isUuid } from "@/lib/hq/forms";
import { getEmail } from "@/lib/hq/email/queries";
import { renderEmail } from "@/lib/hq/email/render";
import { EMAIL_TEMPLATE_LABEL, STUCK_SENDING_MINUTES, sendErrorText, sendingIsStuck } from "@/lib/hq/email/rules";
import { emailFrom } from "@/lib/hq/email/send";
import { ErrorState, InlineNote, KeyValueList, LinkButton, PageHeader, Panel, PanelHeader, SectionLabel, type KeyValueItem } from "@/components/hq";
import { EmailControls } from "@/components/hq/features/email/EmailControls";
import { EmailPreview, EmailStatusChip } from "@/components/hq/features/email/EmailParts";
import { approveAndSendAction, discardEmailDraftAction, sendApprovedAction } from "../actions";

export const metadata: Metadata = { title: "Email" };

type Params = Promise<{ id: string }>;

export default async function EmailDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const { db, staff, can } = await requireStaff("email.draft", false, isUuid(id) ? `/hq/email/${id}` : "/hq/email");
  if (!isUuid(id)) notFound();

  const found = await getEmail(db, id);
  if (!found.ok) {
    return (
      <>
        <PageHeader title="Email" breadcrumbs={[{ label: "Email", href: "/hq/email" }, { label: "Email" }]} />
        <ErrorState
          title="We could not load this email"
          action={
            <LinkButton href={`/hq/email/${id}`} size="sm">
              Try again
            </LinkButton>
          }
        />
      </>
    );
  }
  // Missing and "not yours to see" are the same answer.
  if (!found.data) notFound();
  const e = found.data;

  const own = e.createdBy === staff.id;
  const creatorRole = own
    ? staff.role
    : (((await db.from("staff_profiles").select("role").eq("id", e.createdBy).maybeSingle()).data?.role ?? null) as StaffRole | null);
  const rendered = renderEmail({ subject: e.subject, body: e.body, senderName: e.createdByName ?? staff.fullName, senderRole: creatorRole ? ROLE_LABEL[creatorRole] : null });
  const from = emailFrom();
  const stuck = sendingIsStuck(e.status, e.sendStartedAt);

  const controls = {
    approveAndSend: can("email.send") && (e.status === "draft" || e.status === "failed") && (own || can("audit.read")),
    sendNow: can("email.send") && e.status === "approved" && (own || e.approvedBy === staff.id),
    edit: own && e.status === "draft",
    discard: (own || staff.role === "director") && (e.status === "draft" || e.status === "approved" || e.status === "failed" || stuck),
  };

  const details: KeyValueItem[] = [
    { label: "Status", value: <EmailStatusChip status={e.status} /> },
    { label: "To", value: <>{e.toName}<span className="block break-all text-grey-text">{e.toEmail}</span></> },
    { label: "From", value: <>{from.name}<span className="block break-all text-grey-text">{from.email}</span></> },
    { label: "Replies go to", value: <span className="break-all">{e.replyTo}</span> },
    { label: "Template", value: EMAIL_TEMPLATE_LABEL[e.template] },
    { label: "Drafted", value: <>{formatDateTime(e.createdAt, staff.timezone)}{e.createdByName ? ` by ${e.createdByName}` : ""}{e.createdVia === "mcp" ? " (through a connected app)" : ""}</> },
    ...(e.approvedAt ? [{ label: "Approved", value: <>{formatDateTime(e.approvedAt, staff.timezone)}{e.approvedByName ? ` by ${e.approvedByName}` : ""}</> }] : []),
    ...(e.sentAt ? [{ label: "Sent", value: <>{formatDateTime(e.sentAt, staff.timezone)}{e.sendVia === "chat" ? " (from a connected app)" : ""}</> }] : []),
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Email", href: "/hq/email" }, { label: e.ref }]}
        eyebrow={e.ref}
        title={e.subject}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <EmailStatusChip status={e.status} />
            <span className="text-[13px] text-grey-text">To {e.toName}</span>
          </span>
        }
      />

      {e.status === "draft" ? (
        <InlineNote className="mb-6">
          {can("email.send") ? "Not sent. Check the preview, then Approve and send." : "Not sent. It waits for a director, an administrator or a business development manager to approve it."}
        </InlineNote>
      ) : null}
      {e.status === "approved" ? <InlineNote className="mb-6">Approved but not sent yet (for example, the daily limit was reached). Send it when you are ready.</InlineNote> : null}
      {e.status === "failed" ? <InlineNote className="mb-6">Not sent: {sendErrorText(e.errorCode)} To try again, approve it again.</InlineNote> : null}
      {e.status === "sending" ? (
        <InlineNote className="mb-6">
          {stuck
            ? `This email started sending more than ${STUCK_SENDING_MINUTES} minutes ago and HQ never heard back. It may or may not have been delivered: check with the recipient before drafting it again. You can discard it.`
            : "Sending now. Reload in a moment."}
        </InlineNote>
      ) : null}
      {e.status === "sent" ? (
        <InlineNote className="mb-6">
          Sent {e.sentAt ? formatDateTime(e.sentAt, staff.timezone) : ""}.{" "}
          {e.recipientContactId && can("growth.read") ? (
            <Link href={`/hq/growth/contacts/${e.recipientContactId}`} className="underline underline-offset-2">
              It is on {e.toName}&rsquo;s timeline
            </Link>
          ) : null}
        </InlineNote>
      ) : null}
      {e.status === "discarded" ? <InlineNote className="mb-6">Discarded. It will never be sent.</InlineNote> : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-8">
          <section aria-labelledby="e-preview">
            <SectionLabel as="h2" id="e-preview" className="mb-4 border-b border-line pb-3.5">
              {e.status === "sent" ? "What was sent" : "Preview, exactly as it will be sent"}
            </SectionLabel>
            <EmailPreview html={rendered.html} title={`Preview of ${e.ref}`} />
          </section>
          <section aria-labelledby="e-text">
            <SectionLabel as="h2" id="e-text" className="mb-4 border-b border-line pb-3.5">
              Plain-text version
            </SectionLabel>
            <pre className="hq-email-text">{rendered.text}</pre>
          </section>
        </div>

        <aside className="grid content-start gap-6" aria-label="Email details">
          <Panel aria-labelledby="e-details">
            <PanelHeader id="e-details" title="Details" level={2} />
            <KeyValueList items={details} />
          </Panel>
          {controls.approveAndSend || controls.sendNow || controls.edit || controls.discard ? (
            <Panel aria-labelledby="e-actions">
              <PanelHeader id="e-actions" title="Actions" level={2} />
              <EmailControls
                id={e.id}
                refLabel={e.ref}
                toName={e.toName}
                toEmail={e.toEmail}
                fromLabel={`${from.name} (${from.email})`}
                replyTo={e.replyTo}
                can={controls}
                approveAndSend={approveAndSendAction}
                sendNow={sendApprovedAction}
                discard={discardEmailDraftAction}
              />
            </Panel>
          ) : null}
        </aside>
      </div>
    </>
  );
}
