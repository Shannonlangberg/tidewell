import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DataTable, ResponsiveTable, type Column } from "@/components/hq/DataTable";
import { EmptyState, ErrorState } from "@/components/hq/EmptyState";
import { FilterBar } from "@/components/hq/FilterBar";
import { MobileList, MobileListItem } from "@/components/hq/MobileList";
import { PageHeader } from "@/components/hq/PageHeader";
import { Pagination } from "@/components/hq/Pagination";
import { InlineNote, KeyValueList, SectionLabel } from "@/components/hq/Primitives";
import { Select } from "@/components/hq/Select";
import { StatusChip } from "@/components/hq/StatusChip";
import { AiSettings } from "@/components/hq/features/people/AiSettings";
import { EmailSettingsSection } from "@/components/hq/features/email/EmailSettingsSection";
import { KnowledgeSettingsSection } from "@/components/hq/features/knowledge/KnowledgeSettingsSection";
import { AI_STATUSES, AI_STATUS_LABEL, AI_STATUS_TONE, isAiStatus, parseAiQuestion, readAiSettings, shortClientId, toolFilter, type AiStatus } from "@/lib/hq/ai-log";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { formatDateTime } from "@/lib/hq/format";
import { intParam, isUuid, strParam } from "@/lib/hq/forms";
import { DEFAULT_BULK_CALLS_PER_HOUR, DEFAULT_BULK_ITEMS_PER_HOUR, writeHourlyLimit } from "@/lib/hq/mcp/limits";
import { TOOLS } from "@/lib/hq/mcp/tools";

export const metadata: Metadata = { title: "AI and connected apps" };

type SP = Record<string, string | string[] | undefined>;

const PATH = `${HQ_BASE}/settings/ai`;
const PAGE_SIZE = 25;

const TOOL_TITLE = new Map(TOOLS.map((t) => [t.name, t.title]));
const TOOL_OPTIONS = [...TOOLS].sort((a, b) => a.title.localeCompare(b.title)).map((t) => ({ value: t.name, label: t.title }));

/** How a call through an app is labelled: a bulk call is ONE call that changed many records (bulk_create_tasks, bulk_update_tasks). */
const KIND_LABEL: Record<"read" | "write" | "bulk", string> = { read: "Read", write: "Change", bulk: "Bulk change" };

type Row = { id: string; staff_id: string; asked_at: string; question: string; tools_used: string[]; status: string };

/*
 * AI and connected apps: the switch that lets ChatGPT and Claude use HQ (hq.settings.ai_enabled),
 * the hourly limit, and the log of every call those apps made (hq.ai_requests).
 *
 * Directors (settings.admin) change the settings; directors and administrators (audit.read) see
 * everyone's calls. Anyone else is sent back to Today. The database is the control behind both:
 * the settings policy and guard refuse a change from anyone without settings.admin, and the
 * ai_requests policy returns only a person's own rows unless they hold audit.read.
 */
export default async function AiSettingsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { staff, db, can } = await requireStaff(undefined, false, PATH);
  const admin = can("settings.admin");
  const auditor = can("audit.read");
  if (!admin && !auditor) redirect(`${HQ_BASE}?denied=${encodeURIComponent("settings.admin")}`);

  const sp = await searchParams;
  const page = intParam(sp.page, 1, 1, 10_000);
  const personParam = strParam(sp.person, 40);
  const person = auditor && isUuid(personParam) ? personParam : "";
  const toolParam = strParam(sp.tool, 64);
  const tool = TOOL_TITLE.has(toolParam) ? toolParam : "";
  const statusParam = strParam(sp.status, 20);
  const status: AiStatus | "" = isAiStatus(statusParam) ? statusParam : "";

  const from = (page - 1) * PAGE_SIZE;
  let query = db
    .from("ai_requests")
    .select("id, staff_id, asked_at, question, tools_used, status", { count: "exact" })
    .order("asked_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  if (person) query = query.eq("staff_id", person);
  if (status) query = query.eq("status", status);
  const tf = tool ? toolFilter(tool) : null;
  if (tf) query = query.or(tf);

  const [settingsRes, logRes, peopleRes] = await Promise.all([
    db.from("settings").select("key, value").in("key", ["ai_enabled", "ai_hourly_limit", "require_mfa"]),
    query,
    db.from("staff_profiles").select("id, full_name").order("full_name"),
  ]);
  if (settingsRes.error) console.error("[hq] reading the AI settings failed:", settingsRes.error.code);
  if (logRes.error) console.error("[hq] reading the connected-app log failed:", logRes.error.code);

  const byKey = new Map<string, unknown>((settingsRes.data ?? []).map((s) => [s.key, s.value]));
  const { enabled, hourlyLimit } = readAiSettings(byKey);
  // Same rule as the database: MFA is required unless the setting is exactly false.
  const requireMfa = byKey.get("require_mfa") !== false;
  const names = new Map((peopleRes.data ?? []).map((p) => [p.id, p.full_name]));

  const rows = (logRes.data ?? []) as Row[];
  const total = logRes.count ?? rows.length;
  const filtered = Boolean(person || tool || status);

  const described = rows.map((r) => {
    const parsed = parseAiQuestion(r.question);
    const toolName = parsed.source === "mcp" ? parsed.tool : (r.tools_used[0] ?? null);
    return {
      ...r,
      who: names.get(r.staff_id) ?? "Former member of staff",
      toolLabel: toolName ? (TOOL_TITLE.get(toolName) ?? toolName.replace(/_/g, " ")) : "Not recorded",
      kindLabel: parsed.source === "mcp" ? KIND_LABEL[parsed.kind] : "Other",
      clientId: parsed.source === "mcp" ? parsed.clientId : null,
      statusKey: (isAiStatus(r.status) ? r.status : "error") as AiStatus,
    };
  });
  type Described = (typeof described)[number];

  const app = (r: Described) =>
    r.clientId ? (
      <span title={`App ${r.clientId}`} className="hq-nums">
        {shortClientId(r.clientId)}
      </span>
    ) : (
      <span className="hq-cell-nil">Not recorded</span>
    );
  const chip = (r: Described) => <StatusChip tone={AI_STATUS_TONE[r.statusKey]}>{AI_STATUS_LABEL[r.statusKey]}</StatusChip>;

  const columns: Column<Described>[] = [
    { key: "when", header: "When", primary: true, nowrap: true, cell: (r) => formatDateTime(r.asked_at, staff.timezone) },
    { key: "who", header: "Who", cell: (r) => r.who },
    { key: "tool", header: "Tool", cell: (r) => r.toolLabel },
    { key: "kind", header: "Read or change", nowrap: true, hideBelow: "lg", cell: (r) => r.kindLabel },
    { key: "app", header: "App", nowrap: true, hideBelow: "lg", cell: app },
    { key: "status", header: "Status", nowrap: true, cell: chip },
  ];

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "Settings", href: `${HQ_BASE}/settings` }, { label: "AI and connected apps" }]}
        title="AI and connected apps"
        description="Whether ChatGPT and Claude may use HQ, how often, and every call they have made."
      />

      <div className="mt-10 grid gap-12">
        <section aria-labelledby="ai-status-h" className="max-w-xl">
          <SectionLabel as="h2" id="ai-status-h" className="mb-3.5">
            Status
          </SectionLabel>
          {settingsRes.error ? (
            <ErrorState />
          ) : (
            <>
              <p className="mb-3">
                <StatusChip tone={enabled ? "success" : "neutral"}>{enabled ? "On" : "Off"}</StatusChip>
              </p>
              <p className="font-medium">
                {enabled ? "Connection is ON: ChatGPT and Claude can use HQ as each person." : "Connection is OFF: ChatGPT and Claude cannot use HQ. Every call is refused."}
              </p>
              <p className="hq-muted mt-2 text-[14px]">
                {enabled
                  ? "Each app acts as the person who connected it, with exactly that person's permissions, and every call is logged below."
                  : "People can still see and disconnect their apps on their Profile. Nothing is read or changed through them while the connection is off."}
              </p>
              {enabled && requireMfa ? (
                <InlineNote className="mt-4">
                  Two-step verification is required for everyone, and the access an app is given does not carry the second step, so HQ refuses every connected app at present. This
                  is a known limitation with a planned fix.
                </InlineNote>
              ) : null}
            </>
          )}
        </section>

        <section aria-labelledby="ai-settings-h">
          <SectionLabel as="h2" id="ai-settings-h" className="mb-3.5">
            Settings
          </SectionLabel>
          {settingsRes.error ? (
            <ErrorState />
          ) : admin ? (
            <AiSettings enabled={enabled} hourlyLimit={hourlyLimit} />
          ) : (
            <div className="max-w-xl">
              <KeyValueList
                items={[
                  { label: "Connection", value: enabled ? "On for everyone" : "Off" },
                  { label: "Hourly limit", value: `${hourlyLimit} calls per person` },
                ]}
              />
              <InlineNote className="mt-4">These are changed by a director.</InlineNote>
            </div>
          )}
          <p className="hq-muted mt-6 max-w-xl text-[13px]">
            Changes made through an app have a lower limit of {writeHourlyLimit()} per person per hour, set on the server. Bulk changes (many tasks in one call) use their own budget instead, kept by the
            database: by default {DEFAULT_BULK_CALLS_PER_HOUR} calls and {DEFAULT_BULK_ITEMS_PER_HOUR} tasks per person per hour. Some things are never available through an app:
            approving or suspending contractors, archiving or deleting (knowledge documents aside: approvers can archive and restore them), documents, imports, people, roles and settings.
          </p>
        </section>

        <EmailSettingsSection />
        <KnowledgeSettingsSection />

        <section aria-labelledby="ai-stop-h" className="max-w-xl">
          <SectionLabel as="h2" id="ai-stop-h" className="mb-3.5">
            Disconnecting and stopping access
          </SectionLabel>
          <ul className="grid list-disc gap-2 pl-5">
            <li>
              Each person disconnects their own apps, on their{" "}
              <Link href={`${HQ_BASE}/profile`} className="underline underline-offset-2">
                Profile
              </Link>{" "}
              under Connected apps. HQ cannot disconnect someone else&rsquo;s app for them.
            </li>
            <li>A disconnected app can keep working for up to an hour, until the access it already holds runs out.</li>
            <li>
              To stop access at once: switch the connection off here (everyone), or deactivate the person in{" "}
              <Link href={`${HQ_BASE}/people`} className="underline underline-offset-2">
                People
              </Link>{" "}
              (just them). Either takes effect on the app&rsquo;s next call.
            </li>
          </ul>
        </section>

        <section aria-labelledby="ai-log-h">
          <SectionLabel as="h2" id="ai-log-h" className="mb-3.5">
            Activity
          </SectionLabel>
          <p className="mb-4 max-w-xl">
            {auditor
              ? "Every call a connected app has made, newest first. Only the tool and record ids are kept, never what was typed in the chat."
              : "The calls your own apps have made, newest first. Directors and administrators see everyone's."}
          </p>
          <FilterBar action={PATH} label="Filter the activity" resetHref={PATH} active={filtered}>
            {auditor ? (
              <Select
                name="person"
                label="Who"
                hideLabel
                placeholder="Everyone"
                options={(peopleRes.data ?? []).map((p) => ({ value: p.id, label: p.full_name }))}
                defaultValue={person}
              />
            ) : null}
            <Select name="tool" label="Tool" hideLabel placeholder="Every tool" options={TOOL_OPTIONS} defaultValue={tool} />
            <Select
              name="status"
              label="Status"
              hideLabel
              placeholder="Every status"
              options={AI_STATUSES.map((s) => ({ value: s, label: AI_STATUS_LABEL[s] }))}
              defaultValue={status}
            />
          </FilterBar>

          {logRes.error ? (
            <ErrorState className="mt-6" />
          ) : (
            <>
              <ResponsiveTable
                table={
                  <DataTable
                    caption={`Connected app calls, ${total} ${filtered ? "matching" : "in total"}, newest first`}
                    columns={columns}
                    rows={described}
                    rowKey={(r) => r.id}
                    empty={
                      <EmptyState title={filtered ? "Nothing matches those filters" : "No calls yet"}>
                        {filtered ? "Clear the filters to see every call." : "When someone uses HQ from ChatGPT or Claude, each call appears here."}
                      </EmptyState>
                    }
                  />
                }
                list={
                  <MobileList label="Connected app calls">
                    {described.map((r) => (
                      <MobileListItem
                        key={r.id}
                        title={r.toolLabel}
                        subtitle={
                          <>
                            {formatDateTime(r.asked_at, staff.timezone)} · {r.who} · {r.kindLabel}
                            {r.clientId ? ` · app ${shortClientId(r.clientId)}` : ""}
                          </>
                        }
                        status={chip(r)}
                      />
                    ))}
                  </MobileList>
                }
              />
              <Pagination page={page} pageSize={PAGE_SIZE} total={total} pathname={PATH} searchParams={sp} noun="call" />
            </>
          )}
        </section>
      </div>
    </>
  );
}
