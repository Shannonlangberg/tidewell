import type { Metadata } from "next";
import { requireStaff } from "@/lib/hq/auth";
import { intParam } from "@/lib/hq/forms";
import { EMAIL_VIEWS, EMAIL_VIEW_LABEL, parseEmailView } from "@/lib/hq/email/rules";
import { EMAIL_PAGE_SIZE, emailViewCounts, listEmails } from "@/lib/hq/email/queries";
import { EmptyState, ErrorState, LinkButton, PageHeader, Pagination, Tabs, buildHref } from "@/components/hq";
import { EmailsTable } from "@/components/hq/features/email/EmailParts";

export const metadata: Metadata = { title: "Email" };

const PATH = "/hq/email";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/*
 * Email: branded emails drafted in HQ or by a connected chat app, one recipient each, sent only after
 * someone with email.send approves them. A person sees their own; directors and administrators
 * (audit.read) see everyone's: row level security decides, not this page.
 */
export default async function EmailPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, staff, can } = await requireStaff("email.draft", false, buildHref(PATH, sp));
  const view = parseEmailView(sp.view);
  const page = intParam(sp.page, 1, 1, 10_000);
  const [list, counts] = await Promise.all([listEmails(db, { view, page }), emailViewCounts(db)]);
  const everyone = can("audit.read");

  const draft = (
    <LinkButton href={`${PATH}/new`} variant="primary" icon="plus">
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
      <PageHeader
        title="Email"
        description={
          everyone
            ? "Branded emails to people HQ holds an address for. Nothing is sent until it is approved. You see everyone's."
            : "Branded emails to people HQ holds an address for. Nothing is sent until it is approved."
        }
        actions={draft}
      />

      <Tabs
        label="Email views"
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
