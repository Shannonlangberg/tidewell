import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import { LinkButton } from "@/components/hq/Button";
import { PageHeader } from "@/components/hq/PageHeader";
import { KeyValueList, SectionLabel } from "@/components/hq/Primitives";
import { StatusChip } from "@/components/hq/StatusChip";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { TimezoneForm } from "@/components/hq/features/people/TimezoneForm";
import { requireStaff } from "@/lib/hq/auth";
import { ROLE_LABEL } from "@/lib/hq/constants";
import { formatDate } from "@/lib/hq/format";
import { listGrants } from "@/lib/hq/mcp/oauth-server";
import { revokeConnectedAppAction } from "../../oauth/actions";
import { signOutAction } from "../../actions";

export const metadata: Metadata = { title: "Profile" };

/*
 * Your own profile. Everyone may open it; it only ever shows (and changes) the signed-in person,
 * identified by the session and never by anything in the URL or a form. Name, role and pod are shown
 * but not editable here: a director or administrator changes those in People.
 */
export default async function ProfilePage() {
  const { staff, db, session, can } = await requireStaff();

  const { data: me, error } = await db
    .from("staff_profiles")
    .select("email, pod_id, start_date, responsibilities, timezone")
    .eq("id", staff.id)
    .maybeSingle();
  if (error) console.error("[hq] reading the profile failed:", error.code);

  const podRes = me?.pod_id ? await db.from("pods").select("name").eq("id", me.pod_id).maybeSingle() : null;
  const grants = await listGrants(session.accessToken);
  const mcpUrl = await mcpAddress();

  return (
    <>
      <PageHeader
        title={staff.fullName}
        description="Your details and your own preferences."
        meta={<StatusChip plain>{ROLE_LABEL[staff.role]}</StatusChip>}
        actions={
          <form action={signOutAction}>
            <SubmitButton variant="secondary" pendingLabel="Signing out">
              Sign out
            </SubmitButton>
          </form>
        }
      />

      <div className="mt-10 grid gap-12">
        <section aria-labelledby="who-h">
          <SectionLabel as="h2" id="who-h" className="mb-3.5">
            Who you are
          </SectionLabel>
          <div className="max-w-xl">
            <KeyValueList
              items={[
                { label: "Name", value: staff.fullName },
                { label: "Email", value: me?.email ?? null },
                { label: "Role", value: ROLE_LABEL[staff.role] },
                { label: "Pod", value: podRes?.data?.name ?? null, empty: "No pod" },
                { label: "Started", value: me?.start_date ? formatDate(me.start_date, staff.timezone) : null },
                { label: "Responsibilities", value: me?.responsibilities ?? null },
              ]}
            />
            <p className="hq-muted mt-4 text-[14px]">
              To change your name, role or pod, ask a director or administrator. They do it in <Link href="/hq/people" className="underline underline-offset-2">People</Link>.
            </p>
          </div>
        </section>

        <section aria-labelledby="tz-h">
          <SectionLabel as="h2" id="tz-h" className="mb-3.5">
            Timezone
          </SectionLabel>
          <TimezoneForm current={me?.timezone ?? staff.timezone} />
        </section>

        <section aria-labelledby="mfa-h" className="max-w-xl">
          <SectionLabel as="h2" id="mfa-h" className="mb-3.5">
            Two-step verification
          </SectionLabel>
          <p className="mb-2">
            <StatusChip tone={staff.mfaRequired ? "success" : "warning"}>{staff.mfaRequired ? "Required" : "Not required"}</StatusChip>
          </p>
          <p>
            {staff.mfaRequired
              ? "Planted HQ asks for a code from your authenticator app each time you sign in, as well as the emailed code."
              : "A director has not switched on the second step, so an emailed code is enough for now. You can set up an authenticator app already."}
          </p>
          <div className="mt-4">
            <LinkButton href="/hq/mfa?next=%2Fhq%2Fprofile">Set up or replace my authenticator</LinkButton>
          </div>
        </section>

        <section aria-labelledby="apps-h" className="max-w-xl">
          <SectionLabel as="h2" id="apps-h" className="mb-3.5">
            Connected apps
          </SectionLabel>
          <p>
            {can("ai.use")
              ? "Apps such as ChatGPT or Claude that you have allowed to use Planted HQ as you. They have exactly your permissions, and every call is logged."
              : "Your role does not include connecting apps such as ChatGPT or Claude. Any you connected before are listed here so you can disconnect them."}
          </p>
          {grants === null ? (
            <p className="hq-muted mt-4 text-[14px]">Connected apps could not be loaded just now. Try again in a moment.</p>
          ) : grants.length === 0 ? (
            <p className="hq-muted mt-4 text-[14px]">No apps are connected.</p>
          ) : (
            <ul className="mt-4 grid gap-0 border-t border-line">
              {grants.map((g) => (
                <li key={g.client.id} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3.5">
                  <div className="min-w-0">
                    <p className="font-medium">{g.client.name || "Unnamed app"}</p>
                    <p className="hq-muted text-[13px]">
                      {g.grantedAt ? `Allowed ${formatDate(g.grantedAt, staff.timezone)}` : "Allowed"}
                      {g.client.uri ? <> &middot; <span className="break-all">{g.client.uri}</span></> : null}
                    </p>
                  </div>
                  <form action={revokeConnectedAppAction}>
                    <input type="hidden" name="client_id" value={g.client.id} />
                    <SubmitButton variant="secondary" size="sm" pendingLabel="Disconnecting">
                      Disconnect
                    </SubmitButton>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <p className="hq-muted mt-4 text-[13px]">
            Disconnecting stops the app refreshing its access at once; access it already holds runs out within an hour.
            {can("ai.use") ? (
              <>
                {" "}
                To connect one, add a custom connector in ChatGPT or Claude with the address <span className="break-all font-medium">{mcpUrl}</span>, then sign in and approve.
              </>
            ) : null}
          </p>
          {can("settings.admin") || can("audit.read") ? (
            <p className="mt-4 text-[14px]">
              <Link href="/hq/settings/ai" className="underline underline-offset-2">
                AI and connected apps
              </Link>
              : the connection for everyone, the hourly limit and every call made.
            </p>
          ) : null}
        </section>
      </div>
    </>
  );
}

/** The MCP endpoint's address on this site, to show people what to paste into ChatGPT or Claude. */
async function mcpAddress(): Promise<string> {
  const configured = process.env.HQ_PUBLIC_ORIGIN;
  if (configured && /^https?:\/\/[^/]+$/.test(configured)) return `${configured}/mcp`;
  const host = (await headers()).get("host") ?? "";
  if (!/^[A-Za-z0-9.\-:[\]]{1,255}$/.test(host)) return "/mcp";
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|[^:]+\.localhost)(:\d+)?$/.test(host);
  return `${local ? "http" : "https"}://${host}/mcp`;
}
