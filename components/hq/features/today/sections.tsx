import Link from "next/link";
import type { ReactNode } from "react";
import { LinkButton } from "@/components/hq/Button";
import { HQ_ROUTES, hrefForSearchHit } from "@/components/hq/nav";
import { PriorityChip, StatusChip } from "@/components/hq/StatusChip";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { DOCUMENT_TYPE_LABEL } from "@/lib/hq/contractors/documents-rules";
import { daysSince, plural } from "@/lib/hq/format";
import { shortDay } from "@/lib/hq/greeting";
import { agoText, daysAgo } from "@/lib/hq/trades/rules";
import { expiryText, lastSpokeText, overdueText, phoneHref } from "@/lib/hq/today";
import type { ExpiryItem } from "@/lib/hq/contractors/widgets-data";
import { completeTaskAction } from "../dashboard/actions";
import { createExpiryTasksAction } from "../contractor-sections/actions";
import { snoozeFollowUpAction } from "./actions";
import type { CallItem, ContractorsToday, NewReferral, QuietPartner, TodayTask } from "./data";

/*
 * The sections of the Today screen. Plain Server Components that draw data the page has already
 * loaded. The rules (docs/hq-simple-layouts.md):
 *  - the heading says what to do; a row shows only what is different about that row;
 *  - a section with nothing in it is one quiet line (or is left out when it is optional);
 *  - buttons are labelled (Call, Log, Snooze, Complete) and at least 44px tall on a phone;
 *  - a Call button appears only where a phone number exists, as a tel: link.
 */

/** How many trade names Today lists before "N more". */
const TRADE_TAGS = 8;

export const FAILED_LINE = "This could not be loaded just now. Reload the page to try again.";

// ── chrome ───────────────────────────────────────────────────

export function TodaySection({
  id,
  title,
  count,
  link,
  children,
}: {
  id: string;
  title: string;
  count?: number;
  link?: { href: string; label: string };
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-h`} className="hq-today__section">
      <div className="hq-today__head">
        <h2 id={`${id}-h`} className="hq-today__title">
          {title}
          {count && count > 0 ? <span className="hq-today__count hq-nums">{count}</span> : null}
        </h2>
        {link ? (
          <Link href={link.href} className="hq-today__more">
            {link.label}
          </Link>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** What an empty (or failed) section collapses to: one quiet line. */
export function QuietLine({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <p id={id} className="hq-today__quiet">
      {children}
    </p>
  );
}

function Row({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <li className="hq-today__row">
      <div className="hq-today__main">
        <p className="hq-today__name">{title}</p>
        {sub ? <p className="hq-today__sub">{sub}</p> : null}
      </div>
      {actions ? <div className="hq-today__actions">{actions}</div> : null}
    </li>
  );
}

const Dot = () => <span aria-hidden="true"> · </span>;

function join(parts: ReactNode[]): ReactNode {
  const kept = parts.filter((p) => p !== null && p !== undefined && p !== false && p !== "");
  return kept.map((p, i) => (
    <span key={i}>
      {i > 0 ? <Dot /> : null}
      {p}
    </span>
  ));
}

function CallButton({ phone, who }: { phone: string | null; who: string }) {
  const href = phoneHref(phone, "tel");
  if (!href) return null;
  return (
    <LinkButton href={href} variant="primary" size="sm" icon="phone" className="hq-today__btn" aria-label={`Call ${who}`}>
      Call
    </LinkButton>
  );
}

function LogButton({ contactId, who }: { contactId: string; who: string }) {
  return (
    <LinkButton href={`${HQ_ROUTES.contacts}/${contactId}?log=phone_call`} size="sm" icon="note" className="hq-today__btn" aria-label={`Log a call with ${who}`}>
      Log
    </LinkButton>
  );
}

// ── growth ───────────────────────────────────────────────────

export function CallToday({ items, total, today, timezone, canWrite, returnTo }: { items: CallItem[]; total: number; today: string; timezone: string; canWrite: boolean; returnTo: string }) {
  if (items.length === 0) return <QuietLine id="call-today">No follow-ups due today.</QuietLine>;
  return (
    <TodaySection id="call-today" title="Call today" count={total} link={total > items.length ? { href: HQ_ROUTES.contacts, label: `All ${total}` } : undefined}>
      <ul className="hq-today__list" aria-label="Follow-ups due today and overdue, oldest first">
        {items.map((c) => {
          const overdue = overdueText(c.dueDate, today);
          const spoke = lastSpokeText(c.lastContactAt ? daysSince(c.lastContactAt, timezone) : null);
          return (
            <Row
              key={c.id}
              title={
                <Link href={`${HQ_ROUTES.contacts}/${c.id}`} className="hq-today__link">
                  {c.name}
                </Link>
              }
              sub={join([c.organisation, overdue ? <span className="hq-today__late">{overdue}</span> : null, spoke])}
              actions={
                <>
                  <CallButton phone={c.phone} who={c.name} />
                  {canWrite ? (
                    <>
                      <LogButton contactId={c.id} who={c.name} />
                      <form action={snoozeFollowUpAction}>
                        <input type="hidden" name="contactId" value={c.id} />
                        <input type="hidden" name="next" value={returnTo} />
                        <SubmitButton size="sm" variant="ghost" icon="clock" className="hq-today__btn" pendingLabel="Snoozing" aria-label={`Snooze the follow-up with ${c.name} for a week`}>
                          Snooze
                        </SubmitButton>
                      </form>
                    </>
                  ) : null}
                </>
              }
            />
          );
        })}
      </ul>
      {canWrite ? <p className="hq-today__note">Snooze moves a follow-up on by a week.</p> : null}
    </TodaySection>
  );
}

export function GoneQuiet({ items, total, never, partners, canWrite }: { items: QuietPartner[]; total: number; never: number; partners: number; canWrite: boolean }) {
  const neverLine =
    never > 0 ? (
      <>
        {never === partners ? `None of the ${plural(partners, "partner")} has been spoken to yet.` : `${plural(never, "partner")} not spoken to yet.`}{" "}
        <Link href={HQ_ROUTES.referralPartners} className="hq-today__inline">
          See partners
        </Link>
      </>
    ) : null;

  if (items.length === 0) {
    if (partners === 0) return null;
    return <QuietLine id="gone-quiet">{neverLine ?? "No partner has gone quiet: everyone has been spoken to in the last 30 days."}</QuietLine>;
  }
  return (
    <TodaySection id="gone-quiet" title="Gone quiet" count={total} link={{ href: `${HQ_ROUTES.referralPartners}?quiet=30`, label: total > items.length ? `All ${total}` : "Partners" }}>
      <p className="hq-today__lead">Not spoken to in over 30 days, longest first.</p>
      <ul className="hq-today__list" aria-label="Partners not spoken to in over 30 days">
        {items.map((p) => (
          <Row
            key={p.key}
            title={
              <Link href={p.href} className="hq-today__link">
                {p.name}
              </Link>
            }
            sub={join([p.person, lastSpokeText(p.days)])}
            actions={
              <>
                <CallButton phone={p.phone} who={p.person ?? p.name} />
                {canWrite && p.contactId ? <LogButton contactId={p.contactId} who={p.person ?? p.name} /> : null}
              </>
            }
          />
        ))}
      </ul>
      {neverLine ? <p className="hq-today__note">{neverLine}</p> : null}
    </TodaySection>
  );
}

export function NewReferrals({ items, total }: { items: NewReferral[]; total: number }) {
  if (items.length === 0) return null;
  return (
    <TodaySection id="new-referrals" title="New referrals" count={total} link={{ href: `${HQ_ROUTES.referrals}?direction=received`, label: "All referrals" }}>
      <p className="hq-today__lead">Received in the last two weeks.</p>
      <ul className="hq-today__list" aria-label="Referrals received in the last two weeks">
        {items.map((r) => (
          <Row
            key={r.id}
            title={
              <Link href={`${HQ_ROUTES.referrals}/${r.id}`} className="hq-today__link">
                {r.prospect ?? r.label}
              </Link>
            }
            sub={join([r.partner ? `From ${r.partner}` : null, r.suburb, shortDay(r.date)])}
          />
        ))}
      </ul>
    </TodaySection>
  );
}

// ── operations ───────────────────────────────────────────────

export function TasksToday({
  items,
  overdue,
  dueToday,
  teamOverdue,
  today,
  canComplete,
  returnTo,
}: {
  items: TodayTask[];
  overdue: number;
  dueToday: number;
  teamOverdue: number | null;
  today: string;
  canComplete: boolean;
  returnTo: string;
}) {
  const total = overdue + dueToday;
  const team =
    teamOverdue && teamOverdue > 0 ? (
      <>
        The rest of the team has {plural(teamOverdue, "overdue task")}.{" "}
        <Link href={`${HQ_ROUTES.operations}?view=team`} className="hq-today__inline">
          See team tasks
        </Link>
      </>
    ) : null;

  if (items.length === 0) {
    return (
      <QuietLine id="tasks-today">
        Nothing of yours is due today.{team ? <> {team}</> : null}
      </QuietLine>
    );
  }
  const title = overdue > 0 && dueToday > 0 ? "Overdue and due today" : overdue > 0 ? "Overdue tasks" : "Due today";
  return (
    <TodaySection id="tasks-today" title={title} count={total} link={{ href: HQ_ROUTES.operations, label: total > items.length ? `All ${total}` : "My tasks" }}>
      <ul className="hq-today__list" aria-label="Your tasks due today or overdue">
        {items.map((t) => {
          const late = overdueText(t.dueDate, today);
          const urgent = t.priority === "high" || t.priority === "urgent";
          return (
            <Row
              key={t.id}
              title={
                <Link href={hrefForSearchHit("tasks", t.id)} className="hq-today__link">
                  {t.title}
                </Link>
              }
              sub={late || urgent ? join([late ? <span className="hq-today__late">{late}</span> : null, urgent ? <PriorityChip priority={t.priority} /> : null]) : undefined}
              actions={
                canComplete ? (
                  <form action={completeTaskAction}>
                    <input type="hidden" name="taskId" value={t.id} />
                    <input type="hidden" name="next" value={returnTo} />
                    <SubmitButton size="sm" variant="secondary" icon="check" className="hq-today__btn" pendingLabel="Completing" aria-label={`Complete task: ${t.title}`}>
                      Done
                    </SubmitButton>
                  </form>
                ) : null
              }
            />
          );
        })}
      </ul>
      {team ? <p className="hq-today__note">{team}</p> : null}
    </TodaySection>
  );
}

function itemLabel(i: ExpiryItem): string {
  if (i.kind === "licence") return "Licence";
  if (i.kind === "insurance") return "Insurance";
  return i.documentType ? DOCUMENT_TYPE_LABEL[i.documentType] : "Document";
}

export function Paperwork({ data, today, canRemind, returnTo }: { data: ContractorsToday; today: string; canRemind: boolean; returnTo: string }) {
  if (data.none) return null;
  if (data.expiring.length === 0) return <QuietLine id="paperwork">No licence or insurance expires in the next {plural(data.warningDays, "day")}.</QuietLine>;
  return (
    <TodaySection id="paperwork" title="Paperwork expiring" count={data.expiringTotal} link={{ href: HQ_ROUTES.partners, label: data.expiringTotal > data.expiring.length ? `All ${data.expiringTotal}` : "Contractors" }}>
      <ul className="hq-today__list" aria-label="Contractor licences, insurance and documents expired or expiring soon">
        {data.expiring.map((i) => (
          <Row
            key={i.key}
            title={
              <Link href={`${HQ_ROUTES.partners}/${i.contractorId}`} className="hq-today__link">
                {i.name}
              </Link>
            }
            sub={
              <>
                {itemLabel(i)}
                <Dot />
                <StatusChip tone={i.state === "expired" ? "error" : "warning"}>{expiryText(i.expiresOn, today)}</StatusChip>
              </>
            }
          />
        ))}
      </ul>
      {canRemind ? (
        <form action={createExpiryTasksAction} className="hq-today__note">
          <input type="hidden" name="next" value={returnTo} />
          <SubmitButton size="sm" variant="secondary" icon="task" className="hq-today__btn" pendingLabel="Creating reminder tasks">
            Make reminder tasks
          </SubmitButton>
        </form>
      ) : null}
    </TodaySection>
  );
}

export function UncoveredTrades({ data, canWrite }: { data: ContractorsToday; canWrite: boolean }) {
  if (data.none) {
    return (
      <QuietLine id="trades">
        No contractors in HQ yet.{" "}
        <Link href={canWrite ? HQ_ROUTES.partnerNew : HQ_ROUTES.partners} className="hq-today__inline">
          {canWrite ? "Add a contractor" : "Contractors"}
        </Link>
      </QuietLine>
    );
  }
  if (data.uncovered.length === 0) return <QuietLine id="trades">Every trade has an approved contractor.</QuietLine>;
  const shown = data.uncovered.slice(0, TRADE_TAGS);
  const rest = data.uncovered.length - shown.length;
  return (
    <TodaySection id="trades" title="No approved contractor" count={data.uncovered.length} link={{ href: HQ_ROUTES.partnerTrades, label: "Trades" }}>
      <p className="hq-today__lead">
        {data.tradeCount > data.uncovered.length ? `${data.uncovered.length} of ${data.tradeCount} trades.` : "None of your trades has one yet."}
      </p>
      <ul className="hq-today__tags" aria-label="Trades with no approved contractor">
        {shown.map((t) => (
          <li key={t.slug}>
            <Link href={`${HQ_ROUTES.partnerTrades}#trade-${t.slug}`} className="hq-today__tag">
              {t.label}
            </Link>
          </li>
        ))}
        {rest > 0 ? (
          <li>
            <Link href={HQ_ROUTES.partnerTrades} className="hq-today__tag hq-today__tag--more">
              {rest} more
            </Link>
          </li>
        ) : null}
      </ul>
    </TodaySection>
  );
}

export function NotUsedLately({ data, today }: { data: ContractorsToday; today: string }) {
  if (!data.notUsed || data.notUsed.length === 0) return null;
  return (
    <TodaySection id="not-used" title="Not used lately" count={data.notUsed.length} link={{ href: `${HQ_ROUTES.partnerTrades}?sort=last_used`, label: "Trades" }}>
      <p className="hq-today__lead">Approved contractors with no job recorded for over three months.</p>
      <ul className="hq-today__list" aria-label="Approved contractors not used lately">
        {data.notUsed.map((c) => {
          const d = daysAgo(c.lastJobDate, today);
          return (
            <Row
              key={c.id}
              title={
                <Link href={`${HQ_ROUTES.partners}/${c.id}`} className="hq-today__link">
                  {c.name}
                </Link>
              }
              sub={d === null ? null : `Used ${agoText(d)}`}
            />
          );
        })}
      </ul>
    </TodaySection>
  );
}
