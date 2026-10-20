import { requireStaff } from "@/lib/hq/auth";
import { CONTACT } from "@/lib/planted";
import { setEnquiryAutoReplyAction } from "@/app/hq/(app)/growth/enquiries/actions";
import { ErrorState } from "../../EmptyState";
import { InlineNote, KeyValueList } from "../../Primitives";
import { StatusChip } from "../../StatusChip";
import { SubmitButton } from "../../SubmitButton";

/*
 * Settings, on the "Who gets website enquiries" card: the automatic thank-you email to the person who
 * filled in the form (enquiry_auto_reply_enabled, on by default). Directors (settings.admin) switch it;
 * anyone with growth.read sees whether it is on. Self-loading, so the card mounts it with one line. A
 * plain form: works without JavaScript. The limits are the database's (one per address per 24 hours,
 * 30 an hour across HQ), not this screen's.
 */
export async function EnquiryAutoReplySetting() {
  const { db, can } = await requireStaff();
  if (!can("settings.admin") && !can("growth.read")) return null;

  const setting = await db.from("settings").select("value").eq("key", "enquiry_auto_reply_enabled").maybeSingle();
  if (setting.error) console.error("[hq] reading enquiry_auto_reply_enabled failed:", setting.error.code);
  // Same rule as the database: on unless the setting is exactly false.
  const on = setting.data?.value !== false;
  const reach = [CONTACT.email ? "email address" : null, CONTACT.phone ? "phone number" : null].filter(Boolean).join(" and ");
  const says = `It thanks them for getting in touch, says we have received their message and will be in touch${reach ? `, and gives our ${reach}` : ""}.`;

  return (
    <div className="mt-8 grid gap-3 border-t border-line pt-6" id="enquiry-thank-you">
      <h3 className="font-semibold">Thank-you email to the enquirer</h3>
      <p className="hq-muted text-[14px]">
        When it is on, each person who sends a new enquiry gets one short, automatic email. {says} It never repeats what they wrote. At most one per email address a day, and at most 30 an hour in total. Replies go to the
        lead&rsquo;s owner.
      </p>
      {setting.error ? (
        <ErrorState />
      ) : can("settings.admin") ? (
        <form action={setEnquiryAutoReplyAction} className="flex flex-wrap items-center gap-3">
          <StatusChip tone={on ? "success" : "neutral"}>{on ? "On" : "Off"}</StatusChip>
          <input type="hidden" name="enabled" value={on ? "false" : "true"} />
          <SubmitButton variant="secondary" pendingLabel={on ? "Switching off" : "Switching on"}>
            {on ? "Switch thank-you emails off" : "Switch thank-you emails on"}
          </SubmitButton>
        </form>
      ) : (
        <>
          <KeyValueList items={[{ label: "Thank-you email", value: on ? "On" : "Off" }]} />
          <InlineNote>This is switched by a director.</InlineNote>
        </>
      )}
    </div>
  );
}
