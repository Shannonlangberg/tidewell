import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { LinkButton } from "@/components/hq/Button";
import { PageHeader } from "@/components/hq/PageHeader";
import { InlineNote, KeyValueList, Panel, PanelHeader, SectionLabel } from "@/components/hq/Primitives";
import { StatusChip } from "@/components/hq/StatusChip";
import { DeactivateStaff } from "@/components/hq/features/people/DeactivateStaff";
import { EditStaffForm } from "@/components/hq/features/people/EditStaffForm";
import { EmploymentChip, staffStanding } from "@/components/hq/features/people/EmploymentChip";
import { requireStaff } from "@/lib/hq/auth";
import { EMPLOYMENT_LABEL, EMPLOYMENT_STATUSES, ROLE_LABEL, STAFF_ROLES } from "@/lib/hq/constants";
import { formatDate, formatDateTime } from "@/lib/hq/format";
import { isUuid } from "@/lib/hq/forms";

export const metadata: Metadata = { title: "Person" };

type SP = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** The address a new person should open, worked out from this request so it is right in every environment. */
async function signInAddress(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!host) return "/hq";
  const local = /^(localhost|127\.0\.0\.1|\[::1\]|[^:]+\.localhost)(:\d+)?$/.test(host);
  const proto = h.get("x-forwarded-proto") ?? (local ? "http" : "https");
  return `${proto}://${host}/hq`;
}

export default async function PersonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  const { staff, db, can } = await requireStaff("people.read");
  const { id } = await params;
  const sp = await searchParams;
  if (!isUuid(id)) notFound();

  const { data: person, error } = await db
    .from("staff_profiles")
    .select("id, full_name, first_name, email, role, pod_id, employment_status, is_active, start_date, responsibilities, timezone, invited_by, invited_at")
    .eq("id", id)
    .maybeSingle();
  if (error) console.error("[hq] reading a person failed:", error.code);
  if (!person) notFound();

  const canAdmin = can("people.admin");
  const isSelf = person.id === staff.id;
  const standing = staffStanding(person);
  // A director may be changed only by a director (the database enforces it; the form is simply not offered).
  const mayEdit = canAdmin && (person.role !== "director" || staff.role === "director");

  const [podsRes, inviterRes] = await Promise.all([
    db.from("pods").select("id, name, is_active").order("name"),
    person.invited_by ? db.from("staff_profiles").select("full_name").eq("id", person.invited_by).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const pods = podsRes.data ?? [];
  const pod = pods.find((p) => p.id === person.pod_id) ?? null;
  const podOptions = pods
    .filter((p) => p.is_active || p.id === person.pod_id)
    .map((p) => ({ value: p.id, label: p.is_active ? p.name : `${p.name} (inactive)` }));
  const roleOptions = STAFF_ROLES.filter((r) => r !== "director" || staff.role === "director" || person.role === "director").map((r) => ({ value: r, label: ROLE_LABEL[r] }));
  const statusOptions = EMPLOYMENT_STATUSES.map((s) => ({ value: s, label: EMPLOYMENT_LABEL[s] }));

  const invited = one(sp.invited) === "1" && canAdmin;
  const address = invited ? await signInAddress() : null;

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "People", href: "/hq/people" }, { label: person.full_name }]}
        title={person.full_name}
        description={isSelf ? "This is you." : person.email}
        meta={
          <>
            <EmploymentChip standing={standing} />
            <StatusChip plain>{ROLE_LABEL[person.role]}</StatusChip>
            {pod ? <StatusChip plain>{pod.name}</StatusChip> : null}
          </>
        }
        actions={
          isSelf ? (
            <LinkButton href="/hq/profile">Your profile</LinkButton>
          ) : mayEdit && standing === "active" ? (
            <DeactivateStaff staffId={person.id} name={person.first_name} />
          ) : null
        }
      />

      {invited && address ? (
        <Panel aria-labelledby="invited-h" className="mt-8">
          <PanelHeader id="invited-h" level={2} title={`Next step: ask ${person.first_name} to sign in`} />
          <p>
            {person.first_name} has been added as {ROLE_LABEL[person.role]}, but Planted HQ does not email them for you. Ask them to open{" "}
            <span className="font-medium">{address}</span> and request a sign-in code with <span className="font-medium">{person.email}</span>. The code arrives by
            email and there is no password to set.
          </p>
        </Panel>
      ) : null}

      <div className="mt-10 grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section aria-labelledby="details-h">
          <SectionLabel as="h2" id="details-h" className="mb-3.5">
            Details
          </SectionLabel>
          <KeyValueList
            items={[
              { label: "Email", value: person.email },
              { label: "Role", value: ROLE_LABEL[person.role] },
              { label: "Pod", value: pod?.name ?? null, empty: "No pod" },
              { label: "Status", value: EMPLOYMENT_LABEL[standing] },
              { label: "Started", value: person.start_date ? formatDate(person.start_date, staff.timezone) : null },
              { label: "Timezone", value: person.timezone },
              { label: "Responsibilities", value: person.responsibilities },
              {
                label: "Added",
                value: person.invited_at
                  ? `${formatDateTime(person.invited_at, staff.timezone)}${inviterRes.data ? `, by ${inviterRes.data.full_name}` : ""}`
                  : null,
                empty: "Set up when HQ was created",
              },
            ]}
          />
        </section>

        <section aria-labelledby="edit-h">
          <SectionLabel as="h2" id="edit-h" className="mb-3.5">
            {mayEdit ? "Edit" : "Access"}
          </SectionLabel>
          {mayEdit ? (
            <EditStaffForm
              person={{
                id: person.id,
                fullName: person.full_name,
                firstName: person.first_name,
                role: person.role,
                employmentStatus: person.employment_status,
                podId: person.pod_id,
                startDate: person.start_date,
                responsibilities: person.responsibilities,
              }}
              roles={roleOptions}
              statuses={statusOptions}
              pods={podOptions}
              isSelf={isSelf}
            />
          ) : canAdmin ? (
            <InlineNote>Only a director can change a director.</InlineNote>
          ) : (
            <InlineNote>
              Roles and access are managed by a director or administrator.{" "}
              {isSelf ? (
                <>
                  Your own timezone and dashboard are in <Link href="/hq/profile" className="underline underline-offset-2">Profile</Link>.
                </>
              ) : null}
            </InlineNote>
          )}
        </section>
      </div>
    </>
  );
}
