import { requireStaff } from "@/lib/hq/auth";
import { staffOptions } from "@/lib/hq/queries/options";
import { setEnquiryOwnerAction } from "@/app/hq/(app)/growth/enquiries/actions";
import { ErrorState } from "../../EmptyState";
import { InlineNote, KeyValueList, SectionLabel } from "../../Primitives";
import { Select } from "../../Select";
import { SubmitButton } from "../../SubmitButton";
import { EnquiryAutoReplySetting } from "./EnquiryAutoReplySetting";

/*
 * Settings: "Who gets website enquiries". Each enquiry from the website becomes a lead owned by this
 * person, with a reply task due the day it arrives. Empty means the first director (the earliest
 * active director). Directors (settings.admin) change it; anyone with growth.read sees who it is.
 * Self-loading, so the Settings page mounts it with one line. A plain form: works without JavaScript.
 */
export async function EnquiryOwnerSetting() {
  const { db, can } = await requireStaff();
  if (!can("settings.admin") && !can("growth.read")) return null;

  const [setting, staff] = await Promise.all([db.from("settings").select("value").eq("key", "enquiry_default_owner_id").maybeSingle(), staffOptions(db)]);
  const raw = setting.data?.value;
  const current = typeof raw === "string" ? raw : null;
  const currentName = current ? (staff.find((s) => s.value === current)?.label ?? null) : null;

  return (
    <section aria-labelledby="enquiries-h" id="enquiries" className="max-w-xl scroll-mt-24">
      <SectionLabel as="h2" id="enquiries-h" className="mb-3.5">
        Who gets website enquiries
      </SectionLabel>
      <p className="mb-4">
        Every enquiry from the forms on plantedproperty.com.au becomes a lead owned by this person, with a reply task due the day it arrives. A lead that already exists keeps its
        owner.
      </p>
      {setting.error ? (
        <ErrorState />
      ) : can("settings.admin") ? (
        <form action={setEnquiryOwnerAction} className="grid gap-4">
          <Select
            name="owner"
            label="Website enquiries go to"
            hint={current && !currentName ? "The person chosen before has left, so enquiries go to the first director until you choose again." : undefined}
            placeholder="The first director (the default)"
            defaultValue={currentName ? (current ?? "") : ""}
            options={staff}
          />
          <div>
            <SubmitButton variant="secondary">Save</SubmitButton>
          </div>
        </form>
      ) : (
        <>
          <KeyValueList items={[{ label: "Website enquiries go to", value: currentName ?? "The first director" }]} />
          <InlineNote className="mt-4">This is chosen by a director.</InlineNote>
        </>
      )}
      <EnquiryAutoReplySetting />
    </section>
  );
}
