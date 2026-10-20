import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { COMMS_TAB_PATH } from "@/lib/hq/communications";
import { intParam } from "@/lib/hq/forms";
import { EMAIL_VIEWS, EMAIL_VIEW_LABEL, parseEmailView } from "@/lib/hq/email/rules";
import { EMAIL_PAGE_SIZE, emailViewCounts, listEmails } from "@/lib/hq/email/queries";
import { countNewEnquiries } from "@/lib/hq/enquiry-queries";
import { EmptyState, ErrorState, LinkButton, Pagination, Tabs, buildHref } from "@/components/hq";
import { CommsHeader } from "@/components/hq/features/communications/CommsHeader";
import { EmailsTable } from "@/components/hq/features/email/EmailParts";

export const metadata: Metadata = { title: "Emails · Communications" };

const PATH = COMMS_TAB_PATH.emails;

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/*
 * Communications > Emails: branded emails drafted in HQ or by a connected chat app, one recipient each,
 * sent only after someone with email.send approves them. A person sees their own; directors and
 * administrators (audit.read) see everyone's: row level security decides, not this page.
 * (The old address /hq/email redirects here; an email's own pages stay at /hq/email/<id>.)
 */
export default async function CommsEmailsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, staff, can } = await requireStaff("email.draft", false, buildHref(PATH, sp));
  const view = parseEmailView(sp.view);
  const page = intParam(sp.page, 1, 1, 10_000);
  const [list, counts, fresh] = await Promise.all([
    listEmails(db, { view, page }),
    emailViewCounts(db),
    can("growth.read") ? countNewEnquiries(db) : Promise.resolve(null),
  ]);
  const everyone = can("audit.read");

  const draft = (
    <LinkButton href="/hq/email/new" variant="primary" icon="plus">
      Draft an email
    </LinkButton>
  );

  const empty =
    view === "waiting" ? (
      <EmptyState title="No drafts waiting" action={draft}>
        {can("email.send")
          ? "Draft an email to a contact or a colleague. You can approve and send it from its page."
          : "Draft an email to a contact or a colleague. A director, an administrator or a business development manager approves it before it is sent."}
      </EmptyState>
    ) : view === "sent" ? (
      <EmptyState title="Nothing sent yet">Emails appear here once they are sent, and on the contact&rsquo;s timeline.</EmptyState>
    ) : (
      <EmptyState title="Nothing here">Emails whose send failed, and drafts that were discarded, are kept here.</EmptyState>
    );

  return (
    <>
      <CommsHeader current="emails" capabilities={staff.capabilities} newEnquiries={fresh?.ok ? fresh.data : null} actions={draft} />
      {everyone ? <p className="hq-muted mt-1 text-[14px]">You see everyone&rsquo;s.</p> : null}

      <Tabs
        label="Email views"
        className="mt-6"
        items={EMAIL_VIEWS.map((v) => ({ label: EMAIL_VIEW_LABEL[v], href: v === "waiting" ? PATH : `${PATH}?view=${v}`, current: v === view, count: counts[v] }))}
      />

      <div className="mt-6">
        {!list.ok ? (
          <ErrorState
            title="We could not load the emails"
            action={
              <LinkButton href={buildHref(PATH, sp)} size="sm">
                Try again
              </LinkButton>
            }
          />
        ) : (
          <>
            <EmailsTable
              rows={list.data.rows}
              caption={`${EMAIL_VIEW_LABEL[view]}, ${list.data.total} ${list.data.total === 1 ? "email" : "emails"}, newest first`}
              empty={empty}
              timezone={staff.timezone}
              showCreator={everyone}
            />
            <Pagination page={page} pageSize={EMAIL_PAGE_SIZE} total={list.data.total} pathname={PATH} searchParams={sp} noun="email" className="mt-6" />
          </>
        )}
      </div>
    </>
  );
}
