import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { isUuid } from "@/lib/hq/forms";
import { getEmail } from "@/lib/hq/email/queries";
import { ErrorState, LinkButton, PageHeader } from "@/components/hq";
import { withToast } from "@/components/hq/flash";
import { ComposeForm } from "@/components/hq/features/email/ComposeForm";
import { updateEmailDraftAction } from "../../actions";

export const metadata: Metadata = { title: "Edit email draft" };

type Params = Promise<{ id: string }>;

/** Edit the subject, message and template of your own draft while it waits for approval. The recipient is fixed. */
export default async function EditEmailPage({ params }: { params: Params }) {
  const { id } = await params;
  const { db, staff } = await requireStaff("email.draft", false, isUuid(id) ? `/hq/email/${id}/edit` : "/hq/email");
  if (!isUuid(id)) notFound();
  const found = await getEmail(db, id);
  if (!found.ok) {
    return (
      <>
        <PageHeader title="Edit email draft" />
        <ErrorState title="We could not load this email" action={<LinkButton href={`/hq/email/${id}/edit`} size="sm">Try again</LinkButton>} />
      </>
    );
  }
  if (!found.data) notFound();
  const e = found.data;
  // Only the drafter, and only while it is a draft (the database refuses anything else too).
  if (e.createdBy !== staff.id || e.status !== "draft") redirect(withToast(`/hq/email/${id}`, "Only your own draft, while it waits for approval, can be edited.", "info"));

  return (
    <>
      <PageHeader breadcrumbs={[{ label: "Communications", href: "/hq/communications" }, { label: "Emails", href: "/hq/communications/emails" }, { label: e.ref, href: `/hq/email/${id}` }, { label: "Edit" }]} title={`Edit ${e.ref}`} />
      <ComposeForm
        action={updateEmailDraftAction}
        draftId={e.id}
        recipient={{ kind: e.recipientContactId ? "contact" : "staff", id: e.recipientContactId ?? e.recipientStaffId ?? "", name: e.toName, email: e.toEmail, detail: null }}
        initial={{ template: e.template, subject: e.subject, body: e.body }}
        cancelHref={`/hq/email/${id}`}
      />
    </>
  );
}
