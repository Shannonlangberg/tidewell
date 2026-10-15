import type { Metadata } from "next";
import { PageHeader } from "@/components/hq/PageHeader";
import { InviteForm } from "@/components/hq/features/people/InviteForm";
import { requireStaff } from "@/lib/hq/auth";
import { ROLE_LABEL, STAFF_ROLES } from "@/lib/hq/constants";

export const metadata: Metadata = { title: "Add a person" };

/*
 * people.admin only (requireStaff redirects anyone else). Only a director sees "Director" in the role
 * list; the database refuses it for anyone else anyway.
 */
export default async function InvitePage() {
  const { staff, db } = await requireStaff("people.admin");

  const { data: pods, error } = await db.from("pods").select("id, name").eq("is_active", true).order("name");
  if (error) console.error("[hq] reading pods failed:", error.code);

  const roles = STAFF_ROLES.filter((r) => r !== "director" || staff.role === "director").map((r) => ({ value: r, label: ROLE_LABEL[r] }));

  return (
    <>
      <PageHeader
        breadcrumbs={[{ label: "People", href: "/hq/people" }, { label: "Add a person" }]}
        title="Add a person"
        description="They sign in with a code sent to their email address, so there is no password to set. After you add them, ask them to open HQ and request a code."
      />
      <div className="mt-8">
        <InviteForm roles={roles} pods={(pods ?? []).map((p) => ({ value: p.id, label: p.name }))} />
      </div>
    </>
  );
}
