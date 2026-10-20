import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/hq/auth";
import { OPEN_TASK_STATUSES, TASK_STATUS_LABEL, type TaskStatus } from "@/lib/hq/constants";
import { formatDate, formatDateTime } from "@/lib/hq/format";
import { isUuid } from "@/lib/hq/forms";
import { HISTORY_ACTION_LABEL, LINK_KIND_LABEL, MEETING_TYPE_LABEL, durationLabel, isHistoryAction } from "@/lib/hq/meetings/rules";
import { getMeeting } from "@/lib/hq/meetings/queries";
import { formOptions } from "@/lib/hq/meetings/form-options";
import { overdueText } from "@/lib/hq/today";
import { todayIn } from "@/lib/hq/format";
import { Button, ErrorState, InlineNote, KeyValueList, LinkButton, PageHeader, Panel, PanelHeader, SectionLabel, SubmitButton, TaskStatusChip, TextInput, type KeyValueItem } from "@/components/hq";
import { NativeSelectPicker } from "@/components/hq/Select";
import { KnowledgeMarkdown } from "@/components/hq/features/knowledge/KnowledgeMarkdown";
import { ConfidentialChip, MeetingTypeTag, whenLine } from "@/components/hq/features/meetings/MeetingParts";
import { AddActionButton, ArchiveMeeting, PromoteDecisionButton, RestoreMeeting } from "@/components/hq/features/meetings/MeetingControls";
import { completeTaskAction } from "@/components/hq/features/dashboard/actions";
import { addAction, addAttendee, archiveMeeting, linkRecord, promoteDecision, removeAttendee, restoreMeeting, unlinkRecord } from "../actions";

export const metadata: Metadata = { title: "Meeting" };

type Params = Promise<{ id: string }>;

/*
 * One meeting: the summary first, then the minutes (the knowledge base's safe markdown reader: text is
 * escaped by React, links only http, https and mailto), the decisions, the action tasks, and every
 * version in the history. On the side: the details, who was there and what it is linked to. Missing,
 * archived-for-a-reader and "confidential, not yours" all look the same: not found.
 */
export default async function MeetingPage({ params }: { params: Params }) {
  const { id } = await params;
  const { db, staff, can } = await requireStaff("meetings.read", false, isUuid(id) ? `/hq/meetings/${id}` : "/hq/meetings");
  if (!isUuid(id)) notFound();
  const canWrite = can("meetings.write");
  const tz = staff.timezone;

  const found = await getMeeting(db, id);
  if (!found.ok) {
    return (
      <>
        <PageHeader title="Meeting" breadcrumbs={[{ label: "Meetings", href: "/hq/meetings" }, { label: "Meeting" }]} />
        <ErrorState
          title="We could not load this meeting"
          action={
            <LinkButton href={`/hq/meetings/${id}`} size="sm">
              Try again
            </LinkButton>
          }
        />
      </>
    );
  }
  if (!found.data) notFound();
  const { meeting: m, attendees, links, actions, hiddenActionCount, history } = found.data;
  const live = !m.archived;
  const editable = canWrite && live;
  const options = editable ? await formOptions(db, can) : { staff: [], contacts: [], organisations: [], leads: [], contractors: [] };
  const today = todayIn(tz);
  const decisions = (m.decisionsText ?? "")
    .split("\n")
    .map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, "").trim())
    .filter(Boolean);
  const returnTo = `/hq/meetings/${m.id}#actions`;
  const linkedDecision = links.filter((l) => l.kind === "decision");

  const details: KeyValueItem[] = [
    { label: "When", value: <time dateTime={m.heldAt}>{formatDateTime(m.heldAt, tz)}</time> },
    ...(m.durationMinutes ? [{ label: "How long", value: durationLabel(m.durationMinutes) }] : []),
    ...(m.location ? [{ label: "Where", value: m.location }] : []),
    { label: "Kind", value: MEETING_TYPE_LABEL[m.type] },
    { label: "Saved by", value: `${m.createdByName ?? "A colleague"}${m.createdVia === "mcp" ? ", from a chat app" : ""}` },
    { label: "Version", value: <span className="hq-nums">{m.version}</span> },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Meetings", href: "/hq/meetings" }, { label: m.ref }]}
        eyebrow={m.ref}
        title={m.title}
        meta={
          <span className="flex flex-wrap items-center gap-2">
            <MeetingTypeTag type={m.type} />
            {m.confidential ? <ConfidentialChip /> : null}
            <span className="text-[13px] text-grey-text">{whenLine(m, tz)}</span>
          </span>
        }
        actions={
          editable ? (
            <LinkButton href={`/hq/meetings/${m.id}/edit`} icon="note">
              Edit
            </LinkButton>
          ) : undefined
        }
      />

      {m.archived ? <InlineNote className="mb-6">This meeting is archived: it is not in the meetings list or on the linked records&rsquo; timelines. Restore it to bring it back.</InlineNote> : null}
      {m.confidential && live ? (
        <InlineNote className="mb-6">Confidential: only the team members who were there, the person who saved it, and directors and administrators can see this meeting. Linked records show only that a meeting happened.</InlineNote>
      ) : null}

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="grid min-w-0 content-start gap-10">
          <section aria-labelledby="m-summary">
            <SectionLabel as="h2" id="m-summary" className="mb-4 border-b border-line pb-3.5">
              Summary
            </SectionLabel>
            {m.summary ? <p className="whitespace-pre-wrap break-words text-[16px] leading-relaxed">{m.summary}</p> : <p className="hq-muted">No summary recorded.</p>}
          </section>

          <section aria-labelledby="m-minutes">
            <SectionLabel as="h2" id="m-minutes" className="mb-4 border-b border-line pb-3.5">
              Minutes
            </SectionLabel>
            {m.minutes ? <KnowledgeMarkdown text={m.minutes} label="Minutes" /> : <p className="hq-muted">No minutes recorded.</p>}
          </section>

          <section aria-labelledby="m-decisions" id="decisions">
            <SectionLabel as="h2" id="m-decisions" className="mb-4 border-b border-line pb-3.5">
              Decisions
            </SectionLabel>
            {decisions.length ? (
              <ul className="m-0 grid list-disc gap-1.5 pl-5 text-[15px]">
                {decisions.map((d, i) => (
                  <li key={i} className="break-words">
                    {d}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="hq-muted">No decisions recorded.</p>
            )}
            {linkedDecision.length ? (
              <p className="mt-3 text-[14px]">
                In the Decisions register:{" "}
                {linkedDecision.map((l, i) => (
                  <span key={l.id}>
                    {i > 0 ? ", " : null}
                    {l.href ? (
                      <Link href={l.href} className="underline underline-offset-4">
                        {l.label}
                      </Link>
                    ) : (
                      "a decision you cannot open"
                    )}
                  </span>
                ))}
              </p>
            ) : null}
            {editable && can("decisions.write") ? (
              <div className="mt-4">
                <PromoteDecisionButton meetingId={m.id} suggestions={decisions.slice(0, 20)} action={promoteDecision} />
              </div>
            ) : null}
          </section>

          <section aria-labelledby="m-actions" id="actions">
            <SectionLabel as="h2" id="m-actions" className="mb-4 border-b border-line pb-3.5">
              Actions
            </SectionLabel>
            {actions.length === 0 ? (
              hiddenActionCount > 0 ? null : <p className="hq-muted">No actions recorded.</p>
            ) : (
              <ul className="m-0 grid list-none gap-0 p-0">
                {actions.map((t) => {
                  const open = (OPEN_TASK_STATUSES as readonly string[]).includes(t.status);
                  const late = open && t.dueDate ? overdueText(t.dueDate, today) : null;
                  return (
                    <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
                      <span className="min-w-0">
                        <Link href={`/hq/operations/tasks/${t.id}`} className="font-medium">
                          {t.title}
                        </Link>
                        <span className="block text-[13px] text-grey-text">
                          {t.assigneeName ?? "Unassigned"}
                          {t.dueDate ? (late ? <> · <span className="hq-today__late">{late}</span></> : ` · due ${formatDate(t.dueDate)}`) : ""}
                        </span>
                      </span>
                      <span className="flex items-center gap-3">
                        {t.status in TASK_STATUS_LABEL ? <TaskStatusChip status={t.status as TaskStatus} /> : null}
                        {open && can("tasks.write") ? (
                          <form action={completeTaskAction}>
                            <input type="hidden" name="taskId" value={t.id} />
                            <input type="hidden" name="next" value={returnTo} />
                            <SubmitButton size="sm" variant="secondary" icon="check" pendingLabel="Completing" aria-label={`Mark done: ${t.title}`}>
                              Done
                            </SubmitButton>
                          </form>
                        ) : null}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {hiddenActionCount > 0 ? (
              <p className="hq-muted mt-2 text-[13px]">
                {hiddenActionCount === 1 ? "1 more action is" : `${hiddenActionCount} more actions are`} not shown: assigned to someone else, or archived.
              </p>
            ) : null}
            {editable && can("tasks.write") ? (
              <div className="mt-4">
                <AddActionButton meetingId={m.id} staff={options.staff} action={addAction} />
              </div>
            ) : null}
          </section>

          <section aria-labelledby="m-history">
            <SectionLabel as="h2" id="m-history" className="mb-5 border-b border-line pb-3.5">
              History
            </SectionLabel>
            {history.length === 0 ? (
              <p className="hq-muted">No history recorded.</p>
            ) : (
              <ol className="m-0 grid list-none gap-0 p-0">
                {history.map((h) => (
                  <li key={h.id} className="border-b border-line py-3 text-[14px] last:border-b-0">
                    <p className="m-0">
                      <span className="font-medium">
                        Version {h.version}: {isHistoryAction(h.action) ? HISTORY_ACTION_LABEL[h.action] : h.action}
                      </span>
                      <span className="text-grey-text">
                        {" "}
                        · <time dateTime={h.at}>{formatDateTime(h.at, tz)}</time>
                        {h.byName ? ` · ${h.byName}` : ""}
                        {h.via === "mcp" ? " · from a chat app" : ""}
                      </span>
                    </p>
                    <p className="m-0 mt-0.5 text-grey-text">
                      {h.summary}
                      {h.note ? ` (${h.note})` : ""}
                    </p>
                    {(h.action === "create" || h.action === "update") && (h.minutesSnapshot || h.summarySnapshot) ? (
                      <details className="mt-2">
                        <summary className="cursor-pointer text-[13px] underline underline-offset-4">Read this version</summary>
                        <div className="mt-3 grid gap-3 border-l-2 border-line pl-4">
                          {h.summarySnapshot ? <p className="m-0 whitespace-pre-wrap text-[14px]">{h.summarySnapshot}</p> : null}
                          {h.minutesSnapshot ? <KnowledgeMarkdown text={h.minutesSnapshot} label={`Minutes at version ${h.version}`} /> : null}
                        </div>
                      </details>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <aside className="grid content-start gap-6" aria-label="Meeting details">
          <Panel aria-labelledby="m-details">
            <PanelHeader id="m-details" title="Details" level={2} />
            <KeyValueList items={details} />
          </Panel>

          <Panel aria-labelledby="m-attendees" id="attendees">
            <PanelHeader id="m-attendees" title={`Who was there${attendees.length ? ` (${attendees.length})` : ""}`} level={2} />
            {attendees.length === 0 ? (
              <p className="hq-muted text-[14px]">No attendees recorded.</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {attendees.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 border-b border-line py-2 text-[14px] last:border-b-0">
                    <span className="min-w-0 break-words">
                      {a.href ? <Link href={a.href}>{a.name}</Link> : a.name}
                      <span className="hq-muted text-[12.5px]">{a.kind === "staff" ? " · team" : a.kind === "contact" ? " · contact" : " · not in HQ"}</span>
                    </span>
                    {editable ? (
                      <form action={removeAttendee}>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="attendee_id" value={a.id} />
                        <Button type="submit" size="sm" variant="ghost" aria-label={`Remove ${a.name}`}>
                          Remove
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {editable ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-[14px] underline underline-offset-4">Add someone</summary>
                <div className="mt-3 grid gap-4">
                  <form action={addAttendee} className="grid gap-2">
                    <input type="hidden" name="id" value={m.id} />
                    <NativeSelectPicker name="staff_id" idPrefix="att-s" label="From the team" placeholder="Choose a team member" options={options.staff} />
                    <Button type="submit" size="sm">
                      Add team member
                    </Button>
                  </form>
                  {options.contacts.length ? (
                    <form action={addAttendee} className="grid gap-2">
                      <input type="hidden" name="id" value={m.id} />
                      <NativeSelectPicker name="contact_id" idPrefix="att-c" label="A contact" placeholder="Choose a contact" options={options.contacts} />
                      <Button type="submit" size="sm">
                        Add contact
                      </Button>
                    </form>
                  ) : null}
                  <form action={addAttendee} className="grid gap-2">
                    <input type="hidden" name="id" value={m.id} />
                    <TextInput name="name" idPrefix="att-n" label="Someone not in HQ" maxLength={120} hint="Saved as a name only." />
                    <Button type="submit" size="sm">
                      Add name
                    </Button>
                  </form>
                </div>
              </details>
            ) : null}
          </Panel>

          <Panel aria-labelledby="m-links" id="links">
            <PanelHeader id="m-links" title="Linked to" level={2} />
            {links.length === 0 ? (
              <p className="hq-muted text-[14px]">Not linked to a partner, lead or contractor.</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {links.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-2 border-b border-line py-2 text-[14px] last:border-b-0">
                    <span className="min-w-0 break-words">
                      {l.href ? <Link href={l.href}>{l.label}</Link> : <span className="hq-muted">A record you cannot open</span>}
                      <span className="hq-muted text-[12.5px]">
                        {" "}
                        · {LINK_KIND_LABEL[l.kind].toLowerCase()}
                        {l.hasTouchPoint ? ", logged on its timeline" : ""}
                      </span>
                    </span>
                    {editable && l.kind !== "decision" ? (
                      <form action={unlinkRecord}>
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="kind" value={l.kind} />
                        <input type="hidden" name="record_id" value={l.recordId} />
                        <Button type="submit" size="sm" variant="ghost" aria-label={`Unlink ${l.label ?? "this record"}`}>
                          Unlink
                        </Button>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {editable && options.contacts.length + options.organisations.length + options.leads.length + options.contractors.length > 0 ? (
              <details className="mt-3">
                <summary className="cursor-pointer text-[14px] underline underline-offset-4">Link a record</summary>
                <p className="hq-field__hint mt-2">The meeting is logged once on each linked contact, organisation, lead or contractor.</p>
                <div className="mt-3 grid gap-4">
                  {(
                    [
                      ["organisation", "An organisation", options.organisations],
                      ["contact", "A contact", options.contacts],
                      ["opportunity", "A lead", options.leads],
                      ["contractor", "A contractor", options.contractors],
                    ] as const
                  )
                    .filter(([, , list]) => list.length > 0)
                    .map(([kind, label, list]) => (
                      <form key={kind} action={linkRecord} className="grid gap-2">
                        <input type="hidden" name="id" value={m.id} />
                        <input type="hidden" name="kind" value={kind} />
                        <NativeSelectPicker name="record_id" idPrefix={`lk-${kind}`} label={label} placeholder="Choose one" options={list} />
                        <Button type="submit" size="sm">
                          Link
                        </Button>
                      </form>
                    ))}
                </div>
              </details>
            ) : null}
          </Panel>

          {canWrite ? (
            <Panel aria-labelledby="m-manage">
              <PanelHeader id="m-manage" title="Manage" level={2} />
              {m.archived ? <RestoreMeeting id={m.id} restore={restoreMeeting} /> : <ArchiveMeeting id={m.id} title={m.title} archive={archiveMeeting} />}
            </Panel>
          ) : null}
        </aside>
      </div>
    </>
  );
}
