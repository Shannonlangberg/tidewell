import type { Metadata } from "next";
import Link from "next/link";
import { LinkButton } from "@/components/hq/Button";
import { ErrorState } from "@/components/hq/EmptyState";
import { PageHeader } from "@/components/hq/PageHeader";
import { InlineNote, KeyValueList, SectionLabel } from "@/components/hq/Primitives";
import { BusinessSettings } from "@/components/hq/features/people/BusinessSettings";
import { requireStaff } from "@/lib/hq/auth";
import { DEFAULT_TIMEZONE } from "@/lib/hq/format";
import { AU_TIMEZONES } from "@/lib/hq/timezones";

export const metadata: Metadata = { title: "Settings" };

/*
 * Settings. Everyone sees their own, with a way to change each one. People with settings.admin
 * (directors) also see and change the business settings; everyone else can read them. The
 * AI and connected apps screen (settings.admin or audit.read) and the audit log (audit.read) are
 * one link away.
 */
export default async function SettingsPage() {
  const { staff, db, can } = await requireStaff();

  const settingsRes = await db.from("settings").select("key, value");
  if (settingsRes.error) console.error("[hq] reading settings failed:", settingsRes.error.code);

  const byKey = new Map((settingsRes.data ?? []).map((s) => [s.key, s.value]));
  // Same rule as the database: MFA is required unless the setting is exactly false.
  const requireMfa = byKey.get("require_mfa") !== false;
  const aiEnabled = byKey.get("ai_enabled") === true;
  const rawTz = byKey.get("timezone");
  const businessTimezone = typeof rawTz === "string" ? rawTz : DEFAULT_TIMEZONE;
  const tzLabel = AU_TIMEZONES.find((z) => z.value === businessTimezone)?.label ?? businessTimezone;

  return (
    <>
      <PageHeader title="Settings" description="Your own settings, and the settings that apply to the whole business." />

      <div className="mt-10 grid gap-12">
        <section aria-labelledby="own-h" className="max-w-xl">
          <SectionLabel as="h2" id="own-h" className="mb-3.5">
            Your settings
          </SectionLabel>
          <KeyValueList
            items={[
              {
                label: "Timezone",
                value: (
                  <>
                    {staff.timezone}{" "}
                    <Link href="/hq/profile" className="hq-muted ml-1 underline underline-offset-2">
                      Change
                    </Link>
                  </>
                ),
              },
              {
                label: "Two-step verification",
                value: (
                  <>
                    {staff.mfaRequired ? "Required" : "Not required"}{" "}
                    <Link href="/hq/mfa?next=%2Fhq%2Fsettings" className="hq-muted ml-1 underline underline-offset-2">
                      Set up or replace
                    </Link>
                  </>
                ),
              },
            ]}
          />
        </section>

        <section aria-labelledby="biz-h">
          <SectionLabel as="h2" id="biz-h" className="mb-3.5">
            Business settings
          </SectionLabel>
          {settingsRes.error ? (
            <ErrorState />
          ) : can("settings.admin") ? (
            <BusinessSettings requireMfa={requireMfa} timezone={businessTimezone} />
          ) : (
            <div className="max-w-xl">
              <KeyValueList
                items={[
                  { label: "Two-step verification", value: requireMfa ? "Required for everyone" : "Not required" },
                  { label: "Business timezone", value: tzLabel },
                ]}
              />
              <InlineNote className="mt-4">These apply to everyone and are changed by a director.</InlineNote>
            </div>
          )}
        </section>

        {can("settings.admin") || can("audit.read") ? (
          <section aria-labelledby="ai-h" className="max-w-xl">
            <SectionLabel as="h2" id="ai-h" className="mb-3.5">
              AI and connected apps
            </SectionLabel>
            <p className="mb-4">
              {aiEnabled ? "The connection is on: ChatGPT and Claude can use HQ as each person." : "The connection is off: ChatGPT and Claude cannot use HQ."}{" "}
              {can("settings.admin") ? "Switch it on or off, set the hourly limit, and see every call." : "See the settings and every call."}
            </p>
            <LinkButton href="/hq/settings/ai">Open AI and connected apps</LinkButton>
          </section>
        ) : null}

        {can("audit.read") ? (
          <section aria-labelledby="audit-h" className="max-w-xl">
            <SectionLabel as="h2" id="audit-h" className="mb-3.5">
              Audit log
            </SectionLabel>
            <p className="mb-4">A record of who changed what in HQ, and when. It cannot be edited or deleted.</p>
            <LinkButton href="/hq/settings/audit">Open the audit log</LinkButton>
          </section>
        ) : null}
      </div>
    </>
  );
}
