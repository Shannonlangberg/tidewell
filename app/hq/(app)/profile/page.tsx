import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton } from "@/components/hq/Button";
import { PageHeader } from "@/components/hq/PageHeader";
import { KeyValueList, SectionLabel } from "@/components/hq/Primitives";
import { StatusChip } from "@/components/hq/StatusChip";
import { SubmitButton } from "@/components/hq/SubmitButton";
import { resetDashboardLayoutAction } from "@/components/hq/features/dashboard/actions";
import { TimezoneForm } from "@/components/hq/features/people/TimezoneForm";
import { requireStaff } from "@/lib/hq/auth";
import { ROLE_LABEL } from "@/lib/hq/constants";
import { hasCustomLayout, resolveWidgets } from "@/lib/hq/dashboard-widgets";
import { formatDate } from "@/lib/hq/format";
import { signOutAction } from "../../actions";

export const metadata: Metadata = { title: "Profile" };

/*
 * Your own profile. Everyone may open it; it only ever shows (and changes) the signed-in person,
 * identified by the session and never by anything in the URL or a form. Name, role and pod are shown
 * but not editable here: a director or administrator changes those in People.
 */
export default async function ProfilePage() {
  const { staff, db } = await requireStaff();

  const { data: me, error } = await db
    .from("staff_profiles")
    .select("email, pod_id, start_date, responsibilities, timezone, dashboard_widgets")
    .eq("id", staff.id)
    .maybeSingle();
  if (error) console.error("[hq] reading the profile failed:", error.code);

  const podRes = me?.pod_id ? await db.from("pods").select("name").eq("id", me.pod_id).maybeSingle() : null;
  const customised = hasCustomLayout(me?.dashboard_widgets);
  const shown = resolveWidgets({ role: staff.role, capabilities: staff.capabilities, saved: me?.dashboard_widgets ?? null });

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

        <section aria-labelledby="dash-h" className="max-w-xl">
          <SectionLabel as="h2" id="dash-h" className="mb-3.5">
            Dashboard layout
          </SectionLabel>
          <p>
            {customised
              ? `You have chosen your own layout: ${shown.length} ${shown.length === 1 ? "widget" : "widgets"}.`
              : "You are using the default layout for your role."}
          </p>
          <div className="mt-4 flex flex-wrap gap-3">
            <LinkButton href="/hq">Customise on the dashboard</LinkButton>
            {customised ? (
              <form action={resetDashboardLayoutAction}>
                <SubmitButton variant="secondary" pendingLabel="Resetting your dashboard">
                  Use my role&rsquo;s default
                </SubmitButton>
              </form>
            ) : null}
          </div>
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
      </div>
    </>
  );
}
