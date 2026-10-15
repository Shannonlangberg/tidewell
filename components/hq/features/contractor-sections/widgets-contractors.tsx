import Link from "next/link";
import { LinkButton } from "@/components/hq/Button";
import { EmptyState } from "@/components/hq/EmptyState";
import { StatusChip } from "@/components/hq/StatusChip";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { Timeline, TimelineItem } from "@/components/hq/Timeline";
import { HQ_ROUTES } from "@/components/hq/nav";
import { MoreLink, Rows, WidgetFailed, WidgetPanel, attempt, rowClass } from "@/components/hq/features/dashboard/widget-chrome";
import { hasCap, type DashCtx } from "@/components/hq/features/dashboard/data";
import {
  CLEARED_CONTRACTOR_STATUSES,
  CONTRACTOR_CATEGORY_LABEL,
  CONTRACTOR_STATUS_LABEL,
  CONTRACTOR_STATUS_TONE,
  VETTING_STEPS,
  isOneOf,
  CONTRACTOR_CATEGORIES,
} from "@/lib/hq/constants";
import { DOCUMENT_TYPE_LABEL, expiryBadge } from "@/lib/hq/contractors/documents-rules";
import { coveredTrades } from "@/lib/hq/contractors/widgets-summary";
import { loadAwaitingVetting, loadContractorSummary, loadExpiryWatch, loadRecentContractorActivity, type ExpiryItem } from "@/lib/hq/contractors/widgets-data";
import { formatDateTime, plural } from "@/lib/hq/format";
import { createExpiryTasksAction } from "./actions";
import { timelineIcon } from "./TimelineSection";
import type { TimelineEvent } from "@/lib/hq/contractors/timeline-queries";

/*
 * The four contractor dashboard widgets (Phase 2). Server Components in the same mould as the Phase 1
 * widgets: each loads its own data as the signed-in person, shows REAL figures only, and turns a failing
 * loader into a quiet error panel. renderPanel() in dashboard/widgets.tsx decides who gets them, from the
 * registry in lib/hq/dashboard-widgets.ts (they need contractors.read).
 */

const profile = (id: string) => `${HQ_ROUTES.partners}/${id}`;

function itemLabel(i: ExpiryItem): string {
  if (i.kind === "licence") return "Licence";
  if (i.kind === "insurance") return "Insurance";
  return i.documentType ? `${DOCUMENT_TYPE_LABEL[i.documentType]} (document)` : "Document";
}

// ── awaiting vetting ─────────────────────────────────────────

export async function AwaitingVettingWidget({ ctx }: { ctx: DashCtx }) {
  const r = await attempt("contractors-awaiting-vetting", async () => {
    const [summary, items] = await Promise.all([loadContractorSummary(), loadAwaitingVetting()]);
    return { summary, items };
  });
  const title = "Contractors awaiting vetting";
  if (!r.ok) return <WidgetFailed id="contractors-awaiting-vetting" title={title} />;
  const { summary, items } = r.data;

  return (
    <WidgetPanel id="contractors-awaiting-vetting" title={title} meta={summary.awaitingVetting > 0 ? String(summary.awaitingVetting) : undefined}>
      {items.length === 0 ? (
        summary.total === 0 ? (
          <EmptyState
            compact
            title="No contractors yet"
            action={
              <LinkButton href={HQ_ROUTES.partners} size="sm">
                Open partners
              </LinkButton>
            }
          >
            {hasCap(ctx, "contractors.write") ? "Add a contractor or import the maintenance prospects, and anyone being vetted appears here." : "Contractors being vetted will appear here."}
          </EmptyState>
        ) : (
          <EmptyState compact title="Nobody is awaiting vetting">
            Contractors in the vetting stage, or with checklist steps under way, appear here.
          </EmptyState>
        )
      ) : (
        <>
          <Rows label="Contractors awaiting vetting">
            {items.map((c) => (
              <li key={c.id} className={rowClass}>
                <div className="min-w-0">
                  <Link href={profile(c.id)} className="font-medium underline-offset-2 hover:underline">
                    {c.name}
                  </Link>
                  <p className="hq-muted hq-nums text-[13px]">
                    {c.doneCount} of {VETTING_STEPS.length} steps
                  </p>
                </div>
                <StatusChip tone={CONTRACTOR_STATUS_TONE[c.status]}>{CONTRACTOR_STATUS_LABEL[c.status]}</StatusChip>
              </li>
            ))}
          </Rows>
          <MoreLink shown={items.length} total={summary.awaitingVetting} href={HQ_ROUTES.partners} noun="contractor" />
        </>
      )}
    </WidgetPanel>
  );
}

// ── expiring documents ───────────────────────────────────────

export async function ExpiringDocumentsWidget({ ctx, returnTo }: { ctx: DashCtx; returnTo: string }) {
  const r = await attempt("contractors-expiring-documents", async () => {
    const [summary, watch] = await Promise.all([loadContractorSummary(), loadExpiryWatch()]);
    return { summary, ...watch };
  });
  const title = "Expiring contractor documents";
  if (!r.ok) return <WidgetFailed id="contractors-expiring-documents" title={title} />;
  const { summary, items, total } = r.data;
  const canRemind = hasCap(ctx, "contractors.write") && hasCap(ctx, "tasks.write");

  return (
    <WidgetPanel id="contractors-expiring-documents" title={title} meta={total > 0 ? String(total) : undefined}>
      {items.length === 0 ? (
        <EmptyState compact title="Nothing is expiring">
          {summary.total === 0
            ? "When contractors have licences, insurance or documents with expiry dates, anything expired or expiring within " + plural(summary.warningDays, "day") + " appears here."
            : `No licence, insurance or document has expired or expires within ${plural(summary.warningDays, "day")}.`}
        </EmptyState>
      ) : (
        <>
          {summary.clearedWithExpiredItems > 0 ? (
            <p className="mb-3 flex items-center gap-2 text-[14px]">
              <StatusChip tone="error">
                {plural(summary.clearedWithExpiredItems, "approved contractor")} with something expired
              </StatusChip>
              <span className="hq-muted text-[13px]">They stay approved until a person decides.</span>
            </p>
          ) : null}
          <Rows label="Expired and expiring contractor items">
            {items.map((i) => {
              const badge = expiryBadge(i.expiresOn, ctx.today, summary.warningDays);
              const cleared = CLEARED_CONTRACTOR_STATUSES.includes(i.status);
              return (
                <li key={i.key} className={rowClass}>
                  <div className="min-w-0">
                    <Link href={profile(i.contractorId)} className="font-medium underline-offset-2 hover:underline">
                      {i.name}
                    </Link>
                    <p className="hq-muted truncate text-[13px]">
                      {itemLabel(i)}
                      {i.fileName ? ` · ${i.fileName}` : ""} · {CONTRACTOR_STATUS_LABEL[i.status]}
                    </p>
                  </div>
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    {cleared && i.state === "expired" ? <StatusChip tone="error">Still {CONTRACTOR_STATUS_LABEL[i.status].toLowerCase()}</StatusChip> : null}
                    <StatusChip tone={badge.tone === "neutral" ? "warning" : badge.tone}>{badge.label}</StatusChip>
                  </span>
                </li>
              );
            })}
          </Rows>
          <MoreLink shown={items.length} total={total} href={HQ_ROUTES.partners} noun="item" />
        </>
      )}
      {total > 0 ? (
        <div className="mt-4 border-t border-line pt-4">
          {canRemind ? (
            <form action={createExpiryTasksAction} className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <input type="hidden" name="next" value={returnTo} />
              <SubmitButton size="sm" variant="secondary" icon="task" pendingLabel="Creating reminder tasks">
                Create reminder tasks
              </SubmitButton>
              <p className="hq-muted min-w-0 flex-1 basis-56 text-[13px]">One task per item, skipping any that already has an open one. HQ does not send emails or texts: the tasks are the reminder.</p>
            </form>
          ) : (
            <p className="hq-muted text-[13px]">
              Reminders are tasks, created by someone who manages contractors and tasks. HQ does not send emails or texts.
            </p>
          )}
        </div>
      ) : null}
    </WidgetPanel>
  );
}

// ── preferred contractor coverage ────────────────────────────

const labelFor = (category: string): string => (isOneOf(CONTRACTOR_CATEGORIES, category) ? CONTRACTOR_CATEGORY_LABEL[category] : category.replace(/_/g, " "));

export async function PreferredCoverageWidget({ ctx }: { ctx: DashCtx }) {
  const r = await attempt("contractors-preferred-coverage", () => loadContractorSummary());
  const title = "Preferred contractor coverage";
  if (!r.ok) return <WidgetFailed id="contractors-preferred-coverage" title={title} />;
  const s = r.data;
  const covered = coveredTrades(s.coverage);
  const uncovered = s.tradesWithoutCover;
  const tradeCount = covered.length + uncovered.length;

  return (
    <WidgetPanel id="contractors-preferred-coverage" title={title} meta={tradeCount > 0 ? `${covered.length} of ${tradeCount} trades` : undefined}>
      {s.total === 0 ? (
        <EmptyState
          compact
          title="No contractors yet"
          action={
            <LinkButton href={HQ_ROUTES.partners} size="sm">
              Open partners
            </LinkButton>
          }
        >
          {hasCap(ctx, "contractors.write") ? "Once contractors are approved, this shows which trades have one and which do not." : "This shows which trades have an approved contractor."}
        </EmptyState>
      ) : (
        <>
          {uncovered.length > 0 ? (
            <div>
              <p className="text-[14px] font-medium">No approved contractor for {plural(uncovered.length, "trade")}</p>
              <p className="hq-muted mt-1 text-[14px]">{uncovered.map(labelFor).join(", ")}.</p>
            </div>
          ) : (
            <p className="text-[14px] font-medium">Every trade has at least one approved contractor.</p>
          )}
          {covered.length > 0 ? (
            <Rows label="Trades with an approved contractor">
              <li className="mt-4 border-t border-line pt-3" aria-hidden="true" />
              {covered.map((c) => (
                <li key={c.category} className={rowClass}>
                  <span className="font-medium">{labelFor(c.category)}</span>
                  <span className="hq-muted hq-nums text-[13px]">
                    {c.approved} approved
                    {c.preferred > 0 ? ` · ${c.preferred} preferred` : ""}
                  </span>
                </li>
              ))}
            </Rows>
          ) : null}
          <p className="hq-muted mt-4 border-t border-line pt-3 text-[13px]">Counts contractors a person has approved or marked preferred. Prospects and contractors being vetted do not count.</p>
        </>
      )}
    </WidgetPanel>
  );
}

// ── recent activity ──────────────────────────────────────────

export async function RecentContractorActivityWidget({ ctx }: { ctx: DashCtx }) {
  const r = await attempt("contractors-recent-activity", () => loadRecentContractorActivity());
  const title = "Recent contractor activity";
  if (!r.ok) return <WidgetFailed id="contractors-recent-activity" title={title} />;

  return (
    <WidgetPanel id="contractors-recent-activity" title={title} meta={r.data.length > 0 ? "Newest first" : undefined}>
      {r.data.length === 0 ? (
        <EmptyState
          compact
          title="No activity yet"
          action={
            <LinkButton href={HQ_ROUTES.partners} size="sm">
              Open partners
            </LinkButton>
          }
        >
          Status changes, checklist steps, documents, feedback and logged contacts across your contractors appear here.
        </EmptyState>
      ) : (
        <Timeline label="Recent contractor activity">
          {r.data.map((a) => (
            <TimelineItem
              key={a.key}
              icon={timelineIcon({ kind: a.kind as TimelineEvent["kind"], interactionType: a.interactionType })}
              title={
                <Link href={profile(a.contractorId)} className="underline-offset-2 hover:underline">
                  {a.name}
                </Link>
              }
              meta={[formatDateTime(a.occurredAt, ctx.timezone), a.actorName].filter(Boolean).join(" · ")}
            >
              <span className="line-clamp-2">{a.summary}</span>
            </TimelineItem>
          ))}
        </Timeline>
      )}
    </WidgetPanel>
  );
}
