import Link from "next/link";
import { formatDate, formatDateTime } from "@/lib/hq/format";
import { HEALTH_LABEL, PROJECT_STATUS_LABEL, TASK_PRIORITY_WORD, dueWords, healthLines, healthTone, isOpenTask, isTaskOverdue } from "@/lib/hq/projects/rules";
import type { ActivityEntry, Dependency, Milestone, ProjectDocument, ProjectLink, ProjectSummary, ProjectTask } from "@/lib/hq/projects/types";
import { KnowledgeMarkdown } from "../knowledge/KnowledgeMarkdown";
import { Dot, ProgressRule, Section } from "./ProjectParts";
import { MilestoneDone } from "./MilestoneDone";
import { DocumentForm } from "./ProjectForms";

/*
 * The Overview: what someone opening the project needs, in order. How it is going and why (the
 * database's health and reasons), how far along, the milestones, what is blocked and by what,
 * what is overdue and what is next, then the notes and recent activity; the side column holds the
 * details, the related contacts and organisations, and the document links. Empty parts collapse to
 * one quiet line.
 */

type PickerOptions = { value: string; label: string; group?: string }[];

const LINK_KIND: Record<ProjectLink["kind"], string> = { contact: "Contact", organisation: "Organisation", contractor: "Contractor", opportunity: "Lead" };
const LINK_HREF: Record<ProjectLink["kind"], (id: string) => string> = {
  contact: (id) => `/hq/growth/contacts/${id}`,
  organisation: (id) => `/hq/growth/organisations/${id}`,
  contractor: (id) => `/hq/partners/${id}`,
  opportunity: (id) => `/hq/growth/opportunities/${id}`,
};

export function ProjectOverview({
  project: p,
  milestones,
  tasks,
  blockers,
  links,
  documents,
  activity,
  today,
  timezone,
  canWriteProject,
  linkOptions,
  actions,
}: {
  project: ProjectSummary;
  milestones: Milestone[];
  tasks: ProjectTask[];
  /** For each blocked task: the visible tasks it waits on, and how many it waits on that this person cannot see. */
  blockers: Map<string, { visible: Dependency[]; hiddenOpen: number }>;
  links: ProjectLink[];
  documents: ProjectDocument[];
  activity: ActivityEntry[];
  today: string;
  timezone: string;
  canWriteProject: boolean;
  linkOptions: { contacts: PickerOptions; organisations: PickerOptions };
  actions: {
    setMilestoneDone: (fd: FormData) => Promise<void>;
    addLink: (fd: FormData) => Promise<void>;
    removeLink: (fd: FormData) => Promise<void>;
    addDocument: (prev: import("@/lib/hq/forms").ActionState, fd: FormData) => Promise<import("@/lib/hq/forms").ActionState>;
    removeDocument: (fd: FormData) => Promise<void>;
  };
}) {
  const lines = healthLines({ health: p.health, reasons: p.healthReasons, blockedCount: p.blockedCount, totalCount: p.totalCount });
  const open = tasks.filter((t) => isOpenTask(t.status));
  const blocked = open.filter((t) => t.blocked);
  const overdue = open.filter((t) => isTaskOverdue(t.status, t.dueDate, today)).sort((a, b) => ((a.dueDate ?? "") < (b.dueDate ?? "") ? -1 : 1));
  const upcoming = open
    .filter((t) => t.dueDate !== null && t.dueDate >= today)
    .sort((a, b) => ((a.dueDate ?? "") < (b.dueDate ?? "") ? -1 : 1))
    .slice(0, 6);
  const openByMs = new Map<string, number>();
  const allByMs = new Map<string, { done: number; total: number }>();
  for (const t of tasks) {
    if (!t.milestoneId || t.status === "cancelled") continue;
    const c = allByMs.get(t.milestoneId) ?? { done: 0, total: 0 };
    c.total += 1;
    if (t.status === "completed") c.done += 1;
    allByMs.set(t.milestoneId, c);
    if (isOpenTask(t.status)) openByMs.set(t.milestoneId, (openByMs.get(t.milestoneId) ?? 0) + 1);
  }
  const listHref = `/hq/projects/${p.id}?view=list`;
  const related = links.filter((l) => l.kind === "contact" || l.kind === "organisation" || l.label !== null);

  return (
    <div className="hq-prj-overview">
      <div className="hq-prj-main">
        <section aria-labelledby="prj-health" className="hq-prj-health">
          <h2 id="prj-health" className="sr-only">
            How it is going
          </h2>
          <p className="hq-prj-health__word">
            <Dot tone={healthTone(p.health)}>{HEALTH_LABEL[p.health]}</Dot>
          </p>
          {lines.length > 0 ? (
            <ul className="hq-prj-reasons">
              {lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          ) : null}
          <div className="hq-prj-health__progress">
            <ProgressRule done={p.doneCount} total={p.totalCount} progress={p.progress} large label="Project progress" />
            <p className="hq-prj-health__figures m-0">
              <span>
                <b>{p.openCount}</b> open
              </span>
              {p.overdueCount > 0 ? (
                <span className="hq-prj-late">
                  <b className="text-[inherit]">{p.overdueCount}</b> overdue
                </span>
              ) : null}
              {p.blockedCount > 0 ? (
                <span>
                  <b>{p.blockedCount}</b> blocked
                </span>
              ) : null}
              {p.milestoneCount > 0 ? (
                <span>
                  <b>{p.milestonesDone}</b> of {p.milestoneCount} milestones done
                </span>
              ) : null}
            </p>
          </div>
        </section>

        <Section id="prj-ms" title="Milestones" link={milestones.length > 0 ? <Link href={listHref} className="hq-prj-section__link">Tasks by milestone</Link> : null}>
          {milestones.length === 0 ? (
            <p className="hq-prj-quiet">No milestones yet. {canWriteProject ? "Add them in the List view to break the work into stages." : ""}</p>
          ) : (
            <ol className="hq-prj-ms">
              {milestones.map((m) => {
                const late = m.status === "open" && m.dueDate !== null && m.dueDate < today;
                const c = allByMs.get(m.id);
                return (
                  <li key={m.id} className="hq-prj-ms__item" data-done={m.status === "done" || undefined} data-late={late || undefined}>
                    <span className="hq-prj-ms__mark" aria-hidden="true" />
                    <p className="hq-prj-ms__name">
                      {m.name}
                      <span className="sr-only">{m.status === "done" ? ", done" : late ? ", overdue" : ""}</span>
                    </p>
                    <span className={late ? "hq-prj-ms__due hq-prj-ms__due--late" : "hq-prj-ms__due"}>
                      {m.status === "done" ? (m.completedAt ? `Done ${formatDate(m.completedAt, timezone)}` : "Done") : m.dueDate ? `${late ? "Was due" : "Due"} ${formatDate(m.dueDate)}` : "No due date"}
                    </span>
                    {c && c.total > 0 ? <p className="hq-prj-ms__sub">{c.done} of {c.total} tasks done</p> : null}
                    {canWriteProject ? (
                      <div className="hq-prj-ms__actions">
                        <MilestoneDone projectId={p.id} milestone={m} openTasks={openByMs.get(m.id) ?? 0} action={actions.setMilestoneDone} />
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          )}
        </Section>

        {blocked.length > 0 ? (
          <Section id="prj-blockers" title="Blocked">
            <ul className="hq-prj-lines">
              {blocked.map((t) => {
                const b = blockers.get(t.id);
                const waits = (b?.visible ?? []).filter((d) => d.status !== "completed" && d.status !== "cancelled");
                return (
                  <li key={t.id} className="hq-prj-line">
                    <p className="hq-prj-line__title">
                      <Link href={`/hq/operations/tasks/${t.id}`}>{t.title}</Link>
                      <span className="hq-prj-line__sub">
                        {waits.length > 0 ? (
                          <>
                            Waiting on{" "}
                            {waits.map((d, i) => (
                              <span key={d.taskId}>
                                {i > 0 ? ", " : ""}
                                <Link href={`/hq/operations/tasks/${d.taskId}`} className="underline underline-offset-3">
                                  {d.title}
                                </Link>
                              </span>
                            ))}
                            {b && b.hiddenOpen > 0 ? ` and ${b.hiddenOpen === 1 ? "a task" : `${b.hiddenOpen} tasks`} you can't see` : ""}
                          </>
                        ) : (
                          "Waiting on a task you can't see"
                        )}
                        {t.blockedReason ? ` · ${t.blockedReason}` : ""}
                      </span>
                    </p>
                    <span className="hq-prj-line__meta">{t.assignedToName ?? "Unassigned"}</span>
                  </li>
                );
              })}
            </ul>
          </Section>
        ) : null}

        <div className="hq-prj-two">
          <Section id="prj-overdue" title="Overdue">
            {overdue.length === 0 ? (
              <p className="hq-prj-quiet">Nothing overdue.</p>
            ) : (
              <TaskLines tasks={overdue.slice(0, 6)} today={today} more={overdue.length > 6 ? { n: overdue.length - 6, href: listHref } : null} />
            )}
          </Section>
          <Section id="prj-next" title="Coming up">
            {upcoming.length === 0 ? <p className="hq-prj-quiet">No dated tasks ahead.</p> : <TaskLines tasks={upcoming} today={today} more={null} />}
          </Section>
        </div>

        {p.notes ? (
          <Section id="prj-notes" title="Notes">
            <div className="hq-prj-notes">
              <KnowledgeMarkdown text={p.notes} />
            </div>
          </Section>
        ) : null}

        <Section id="prj-activity" title="Recent activity">
          {activity.length === 0 ? (
            <p className="hq-prj-quiet">Nothing recorded yet.</p>
          ) : (
            <ol className="hq-prj-activity">
              {activity.map((a) => (
                <li key={a.id}>
                  <span>{a.summary}</span>
                  <span className="hq-prj-activity__who">
                    <time dateTime={a.at}>{formatDateTime(a.at, timezone)}</time>
                    {a.actorName ? ` · ${a.actorName}` : ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </Section>
      </div>

      <aside className="hq-prj-side" aria-label="Project details">
        <Section id="prj-details" title="Details">
          <dl className="hq-prj-kv">
            <div>
              <dt>Status</dt>
              <dd>{PROJECT_STATUS_LABEL[p.status]}</dd>
            </div>
            <div>
              <dt>Owner</dt>
              <dd className={p.ownerName ? undefined : "hq-prj-nil"}>{p.ownerName ?? "No owner"}</dd>
            </div>
            <div>
              <dt>Priority</dt>
              <dd>{TASK_PRIORITY_WORD[p.priority]}</dd>
            </div>
            <div>
              <dt>Dates</dt>
              <dd className={p.startDate || p.targetDate ? undefined : "hq-prj-nil"}>
                {p.startDate || p.targetDate ? `${p.startDate ? formatDate(p.startDate) : "No start"} → ${p.targetDate ? formatDate(p.targetDate) : "no target"}` : "No dates set"}
              </dd>
            </div>
            {p.description ? (
              <div>
                <dt>About</dt>
                <dd className="whitespace-pre-wrap font-normal">{p.description}</dd>
              </div>
            ) : null}
          </dl>
        </Section>

        <Section id="prj-related" title="Related">
          {related.length === 0 ? (
            <p className="hq-prj-quiet">No contacts or organisations linked.</p>
          ) : (
            <ul className="hq-prj-related">
              {related.map((l) => (
                <li key={l.id}>
                  <span className="min-w-0">
                    <span className="hq-prj-related__kind">{LINK_KIND[l.kind]}</span>
                    {l.label ? <Link href={LINK_HREF[l.kind](l.targetId)}>{l.label}</Link> : <span className="hq-muted">Not visible to you</span>}
                  </span>
                  {canWriteProject ? (
                    <form action={actions.removeLink}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="kind" value={l.kind} />
                      <input type="hidden" name="target_id" value={l.targetId} />
                      <button type="submit" className="hq-btn hq-btn--ghost hq-btn--sm" aria-label={`Remove ${l.label ?? LINK_KIND[l.kind].toLowerCase()}`}>
                        <span className="hq-btn__label">Remove</span>
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canWriteProject && (linkOptions.contacts.length > 0 || linkOptions.organisations.length > 0) ? (
            <details className="mt-3">
              <summary className="hq-prj-section__link inline-flex min-h-11 cursor-pointer items-center">Link a contact or organisation</summary>
              <form action={actions.addLink} className="hq-prj-inline-form">
                <input type="hidden" name="id" value={p.id} />
                {linkOptions.contacts.length > 0 ? <PickerField name="link_contact" label="Contact" placeholder="Choose a contact" options={linkOptions.contacts} /> : null}
                {linkOptions.organisations.length > 0 ? <PickerField name="link_organisation" label="Or an organisation" placeholder="Choose an organisation" options={linkOptions.organisations} /> : null}
                <button type="submit" className="hq-btn hq-btn--secondary hq-btn--sm justify-self-start">
                  <span className="hq-btn__label">Link</span>
                </button>
              </form>
            </details>
          ) : null}
        </Section>

        <Section id="prj-docs" title="Documents">
          {documents.length === 0 ? (
            <p className="hq-prj-quiet">No document links. HQ keeps links to documents (for example a shared drive), not the files.</p>
          ) : (
            <ul className="hq-prj-related">
              {documents.map((d) => (
                <li key={d.id}>
                  <a href={d.url} target="_blank" rel="noopener noreferrer nofollow" className="min-w-0">
                    {d.title}
                    <span className="sr-only"> (opens in a new tab)</span>
                  </a>
                  {canWriteProject ? (
                    <form action={actions.removeDocument}>
                      <input type="hidden" name="id" value={p.id} />
                      <input type="hidden" name="document_id" value={d.id} />
                      <button type="submit" className="hq-btn hq-btn--ghost hq-btn--sm" aria-label={`Remove link ${d.title}`}>
                        <span className="hq-btn__label">Remove</span>
                      </button>
                    </form>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
          {canWriteProject ? <DocumentForm projectId={p.id} action={actions.addDocument} /> : null}
        </Section>
      </aside>
    </div>
  );
}

function TaskLines({ tasks, today, more }: { tasks: ProjectTask[]; today: string; more: { n: number; href: string } | null }) {
  return (
    <>
      <ul className="hq-prj-lines">
        {tasks.map((t) => {
          const late = isTaskOverdue(t.status, t.dueDate, today);
          return (
            <li key={t.id} className="hq-prj-line">
              <p className="hq-prj-line__title">
                <Link href={`/hq/operations/tasks/${t.id}`}>{t.title}</Link>
                <span className="hq-prj-line__sub">
                  {t.assignedToName ?? "Unassigned"}
                  {t.milestoneName ? ` · ${t.milestoneName}` : ""}
                </span>
              </p>
              <span className={late ? "hq-prj-line__meta hq-prj-late" : "hq-prj-line__meta"}>{dueWords(t.dueDate, t.status, today) || (t.dueDate ? formatDate(t.dueDate) : "")}</span>
            </li>
          );
        })}
      </ul>
      {more ? (
        <p className="hq-prj-quiet mt-2">
          <Link href={more.href} className="underline underline-offset-4">
            {more.n} more in the list
          </Link>
        </p>
      ) : null}
    </>
  );
}

function PickerField({ name, label, placeholder, options }: { name: string; label: string; placeholder: string; options: PickerOptions }) {
  const id = `f-${name}`;
  return (
    <div className="hq-field">
      <label htmlFor={id} className="hq-field__label">
        {label}
      </label>
      <span className="hq-select">
        <select id={id} name={name} className="hq-input hq-input--select" defaultValue="">
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.group ? `${o.label} (${o.group})` : o.label}
            </option>
          ))}
        </select>
      </span>
    </div>
  );
}
