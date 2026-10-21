import type { Metadata } from "next";
import Link from "next/link";
import { requireStaff } from "@/lib/hq/auth";
import { isUuid, strParam } from "@/lib/hq/forms";
import { isEmailTemplate, templateStart } from "@/lib/hq/email/rules";
import { recipientById, searchRecipients } from "@/lib/hq/email/queries";
import { Button, EmptyState, InlineNote, LinkButton, PageHeader, SearchInput, SectionLabel } from "@/components/hq";
import { ComposeForm } from "@/components/hq/features/email/ComposeForm";
import { createEmailDraftAction } from "../actions";

export const metadata: Metadata = { title: "Draft an email" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
const PATH = "/hq/email/new";

/*
 * Draft an email. Step one: choose who it is to, from HQ's own contacts (with an address) and active
 * staff, by searching names, or (only for roles that hold growth.write as well) "Email someone new".
 * Step two: template, subject and message; for someone new that is also where their name and address
 * are typed (never in the URL), and saving adds them to Contacts as needing a check. Saving makes a
 * draft only.
 */
export default async function NewEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const { db, can } = await requireStaff("email.draft", false, PATH);
  const contactId = strParam(sp.contact, 40);
  const staffId = strParam(sp.staff, 40);
  const q = strParam(sp.q, 80);
  const template = isEmailTemplate(strParam(sp.template, 20)) ? (strParam(sp.template, 20) as Parameters<typeof templateStart>[0]) : "general";
  const canContacts = can("growth.read");
  const canStaff = can("people.read");
  const canNew = can("growth.write");
  const wantsNew = canNew && strParam(sp.new, 4) === "1";

  const chosen =
    isUuid(contactId) && canContacts ? await recipientById(db, "contact", contactId) : isUuid(staffId) && canStaff ? await recipientById(db, "staff", staffId) : null;

  const header = (
    <PageHeader
      breadcrumbs={[{ label: "Communications", href: "/hq/communications" }, { label: "Emails", href: "/hq/communications/emails" }, { label: "Draft an email" }]}
      title="Draft an email"
      description="To one person. Nothing is sent until it is approved."
    />
  );

  if (chosen) {
    if (!chosen.email) {
      return (
        <>
          {header}
          <EmptyState
            title={`There is no email address for ${chosen.name}`}
            action={
              chosen.kind === "contact" ? (
                <LinkButton href={`/hq/growth/contacts/${chosen.id}/edit`} variant="primary">
                  Add their address
                </LinkButton>
              ) : undefined
            }
          >
            Add their address to their record first, then draft the email.
          </EmptyState>
        </>
      );
    }
    const start = templateStart(template, chosen.name);
    return (
      <>
        {header}
        <p className="mb-6 text-[14px]">
          <Link href={PATH} className="underline underline-offset-2">
            Choose someone else
          </Link>
        </p>
        <ComposeForm action={createEmailDraftAction} recipient={chosen} initial={{ template, subject: start.subject, body: start.body }} cancelHref={chosen.kind === "contact" ? `/hq/growth/contacts/${chosen.id}` : "/hq/communications/emails"} />
      </>
    );
  }

  if (wantsNew) {
    return (
      <>
        {header}
        <p className="mb-6 text-[14px]">
          <Link href={PATH} className="underline underline-offset-2">
            Choose someone HQ already holds
          </Link>
        </p>
        <InlineNote className="mb-6">Saving adds them to Contacts, marked as needing a check. Nothing is sent until the email is approved.</InlineNote>
        <ComposeForm action={createEmailDraftAction} recipient={null} initial={{ template, subject: templateStart(template, "").subject, body: templateStart(template, "").body }} cancelHref="/hq/communications/emails" />
      </>
    );
  }

  const results = q.length >= 2 ? await searchRecipients(db, q, { contacts: canContacts, staff: canStaff }) : [];
  const where = [canContacts ? "contacts" : null, canStaff ? "staff" : null].filter(Boolean).join(" and ");

  return (
    <>
      {header}
      {(contactId || staffId) && !chosen ? <InlineNote className="mb-6">That person could not be found. Search for them below.</InlineNote> : null}
      <section aria-labelledby="to-h" className="grid max-w-2xl gap-4">
        <SectionLabel as="h2" id="to-h">
          Who is it to?
        </SectionLabel>
        <form action={PATH} method="get" role="search" className="flex flex-wrap items-end gap-3">
          <SearchInput label={`Search ${where}`} placeholder="A name, organisation or address on record" defaultValue={q} className="min-w-0 flex-1" />
          <Button type="submit">Search</Button>
        </form>
        {q.length >= 2 ? (
          results.length === 0 ? (
            <p className="hq-muted">Nobody with an email address on record matches &ldquo;{q}&rdquo;.{canNew ? " To email them anyway, use Email someone new below." : " To email someone new, a person who can edit contacts needs to add them with their address first."}</p>
          ) : (
            <ul className="hq-email-pick" aria-label="Matching people">
              {results.map((r) => (
                <li key={`${r.kind}:${r.id}`} className="hq-email-pick__row">
                  <span className="min-w-0">
                    <span className="hq-email-pick__name">{r.name}</span>
                    <span className="hq-email-pick__sub">
                      <span className="break-all">{r.email}</span>
                      {r.detail ? <> &middot; {r.detail}</> : null}
                    </span>
                  </span>
                  <LinkButton href={`${PATH}?${r.kind}=${r.id}`} size="sm" className="hq-today__btn" aria-label={`Write to ${r.name}`}>
                    Write to them
                  </LinkButton>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="hq-muted text-[14px]">Search for someone HQ already holds an address for.</p>
        )}
      </section>
      {canNew ? (
        <section aria-labelledby="new-h" className="mt-10 grid max-w-2xl gap-3">
          <SectionLabel as="h2" id="new-h">
            Email someone new
          </SectionLabel>
          <p className="text-[14px]">
            Not in HQ yet? Type their name and email address on the next step. They are added to Contacts, marked as needing a check, and nothing is sent until the email is approved.
          </p>
          <div>
            <LinkButton href={`${PATH}?new=1`}>Email someone new</LinkButton>
          </div>
        </section>
      ) : null}
    </>
  );
}
