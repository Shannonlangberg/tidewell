import { requireStaff } from "@/lib/hq/auth";
import { loadEmailSettings } from "@/lib/hq/email/queries";
import { emailFrom, emailProvider } from "@/lib/hq/email/send";
import { ErrorState } from "../../EmptyState";
import { InlineNote, KeyValueList, SectionLabel } from "../../Primitives";
import { EmailSettings } from "./EmailSettings";

/*
 * The Email card on Settings > AI and connected apps: who emails come from, chat sending and the
 * daily limit. Directors (settings.admin) change them; administrators see them. Self-loading, so the
 * AI settings page mounts it with one line.
 */
export async function EmailSettingsSection() {
  const { db, can } = await requireStaff();
  if (!can("settings.admin") && !can("audit.read")) return null;
  const loaded = await loadEmailSettings(db);
  const from = emailFrom();
  const provider = emailProvider();

  return (
    <section aria-labelledby="email-h">
      <SectionLabel as="h2" id="email-h" className="mb-3.5">
        Email
      </SectionLabel>
      <p className="mb-4 max-w-xl">
        Branded emails are sent from <strong>{from.name}</strong> &lt;{from.email}&gt;, one recipient each, to addresses already on HQ records. Replies go to the person who drafted
        the email.
        {provider === "fake" ? " On this server emails are not really sent: a test outbox records them." : provider === "none" ? " Sending is not set up on this server." : ""}
      </p>
      {!loaded.ok ? (
        <ErrorState />
      ) : can("settings.admin") ? (
        <EmailSettings chatSend={loaded.data.chatSend} dailyLimit={loaded.data.dailyLimit} />
      ) : (
        <div className="max-w-xl">
          <KeyValueList
            items={[
              { label: "Sending from chat", value: loaded.data.chatSend ? "On" : "Off" },
              { label: "Daily limit", value: `${loaded.data.dailyLimit} emails per person` },
            ]}
          />
          <InlineNote className="mt-4">These are changed by a director.</InlineNote>
        </div>
      )}
    </section>
  );
}
