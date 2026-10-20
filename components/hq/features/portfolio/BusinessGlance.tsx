import Link from "next/link";
import { requireStaff } from "@/lib/hq/auth";
import { formatAud, formatDate, plural } from "@/lib/hq/format";
import { loadBusinessSummary } from "@/lib/hq/portfolio/queries";
import { financialYearLabel, managedOfGoalText, paceText, serviceSplitText, type BusinessSummary } from "@/lib/hq/portfolio/rules";
import { SectionLabel } from "../../Primitives";
import { Stat, StatBand } from "../../Stat";

/*
 * "Business at a glance": the CEO's five-second view, from hq.business_summary() (read as the
 * signed-in person; growth.read or portfolio.read). Every figure carries its kind:
 *   Actual    counted from records in HQ (managed properties, open leads)
 *   Signed    managements marked signed in HQ (from HQ records)
 *   Estimate  people's own yearly-value guesses on open leads, never income
 * The pace appears only when the owner has set a goal date (none is ever invented). Nothing recorded
 * yet says so plainly. Never a mock value: a failed load is one quiet line.
 *
 *   <BusinessGlance />        the strip at the top of Reports
 *   <BusinessGlanceToday />   the compact line on Today, for directors and administrators only
 */

const PORTFOLIO = "/hq/portfolio";
const PIPELINE = "/hq/growth/pipeline";

function Kind({ children }: { children: string }) {
  return <span className="hq-pf-kind">{children}</span>;
}

function hasNothing(s: BusinessSummary): boolean {
  return (s.managed?.recorded ?? 0) === 0 && (s.signed?.financialYear ?? 0) === 0 && (s.pipeline?.open ?? 0) === 0;
}

export async function BusinessGlance() {
  const { db, can, staff } = await requireStaff();
  if (!can("growth.read") && !can("portfolio.read")) return null;
  const loaded = await loadBusinessSummary(db);

  return (
    <section aria-labelledby="glance-h" className="hq-pf-glance">
      <div className="hq-reports__head">
        <SectionLabel as="h2" id="glance-h">
          Business at a glance
        </SectionLabel>
        {loaded.ok && loaded.data.goal.date ? (
          <p className="hq-pf-glance__goal">
            Goal: {loaded.data.goal.target} managed by {formatDate(loaded.data.goal.date, staff.timezone)}
          </p>
        ) : null}
      </div>
      {!loaded.ok ? (
        <p className="hq-today__quiet">The business figures could not be loaded just now.</p>
      ) : (
        <GlanceBody s={loaded.data} canSetGoal={can("settings.admin")} />
      )}
    </section>
  );
}

function GlanceBody({ s, canSetGoal }: { s: BusinessSummary; canSetGoal: boolean }) {
  const m = s.managed;
  const pace = paceText(s.pace);
  const value = s.pipeline && s.pipeline.estimatedYearlyValueCents > 0 ? formatAud(s.pipeline.estimatedYearlyValueCents) : null;
  const fy = s.signed ? financialYearLabel(s.signed.financialYearStart) : "";

  return (
    <>
      {hasNothing(s) ? <p className="hq-pf-glance__empty">No managed properties recorded yet. Signed managements become managed properties from their lead&rsquo;s page.</p> : null}
      <StatBand label="Business at a glance" columns={s.leadsNeedingAttention !== null ? 4 : 3}>
        {m ? (
          <Stat
            label="Managed"
            value={`${m.managed} of ${s.goal.target}`}
            quiet={m.managed === 0}
            href={PORTFOLIO}
            hint={
              <>
                <Kind>Actual</Kind> {m.managed > 0 ? serviceSplitText(m.longTerm.managed, m.shortTerm.managed) : "No managed properties recorded yet"}
                {m.onboarding > 0 ? `; ${m.onboarding} onboarding` : ""}
              </>
            }
          />
        ) : null}
        {s.signed ? (
          <Stat
            label="Signed this month"
            value={s.signed.thisMonth}
            href={PIPELINE}
            hint={
              <>
                <Kind>Signed</Kind> {s.signed.financialYear} in {fy}, from HQ records
              </>
            }
          />
        ) : null}
        {s.pipeline ? (
          <Stat
            label="Open pipeline"
            value={s.pipeline.open}
            href={PIPELINE}
            hint={
              <>
                <Kind>Estimate</Kind> {value ? `${value} a year, people's own guesses` : s.pipeline.open > 0 ? "no yearly values estimated yet" : "no open leads"}
              </>
            }
          />
        ) : null}
        {s.leadsNeedingAttention !== null ? (
          <Stat label="Leads needing attention" value={s.leadsNeedingAttention} href={PIPELINE} hint={<><Kind>Actual</Kind> no owner, no next step or overdue</>} />
        ) : null}
      </StatBand>
      <p className="hq-pf-glance__pace">
        {pace ? (
          <>
            <span className="font-medium">Pace:</span> {pace}
          </>
        ) : (
          <>
            No goal date set, so there is no pace to show.
            {canSetGoal ? (
              <>
                {" "}
                <Link href="/hq/settings#goal">Set the goal date</Link>
              </>
            ) : null}
          </>
        )}
      </p>
    </>
  );
}

/** The compact Today version: one line, directors and administrators only. */
export async function BusinessGlanceToday() {
  const { db, staff, can } = await requireStaff();
  if (staff.role !== "director" && staff.role !== "administrator") return null;
  if (!can("growth.read") && !can("portfolio.read")) return null;
  const loaded = await loadBusinessSummary(db);
  if (!loaded.ok) return <p className="hq-today__quiet">Business at a glance: the figures could not be loaded just now.</p>;
  const s = loaded.data;
  const parts: string[] = [];
  if (s.managed) parts.push(s.managed.recorded === 0 ? "No managed properties recorded yet" : `${managedOfGoalText(s.managed.managed, s.goal.target)} (${serviceSplitText(s.managed.longTerm.managed, s.managed.shortTerm.managed)})`);
  if (s.signed) parts.push(`${plural(s.signed.thisMonth, "signed this month", "signed this month")}`);
  if (s.pipeline) parts.push(`${plural(s.pipeline.open, "open lead")}${s.pipeline.estimatedYearlyValueCents > 0 ? `, est. ${formatAud(s.pipeline.estimatedYearlyValueCents)} a year` : ""}`);
  const pace = paceText(s.pace);
  return (
    <section aria-labelledby="glance-today-h" className="hq-pf-today">
      <p className="hq-label" id="glance-today-h">
        Business at a glance
      </p>
      <p className="hq-pf-today__line">
        {parts.join(" · ")}
        {pace ? <span className="hq-pf-today__pace"> {pace}</span> : null}
      </p>
      <p className="hq-pf-today__kinds">
        Managed is actual, signed is from HQ records, the yearly value is an estimate. <Link href="/hq/reports">More in Reports</Link>
      </p>
    </section>
  );
}
