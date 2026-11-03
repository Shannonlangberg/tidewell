import type { Metadata } from "next";
import Link from "next/link";
import { cx } from "@/components/hq/cx";
import { Icon } from "@/components/hq/icons";
import { ceo as s } from "@/components/hq/features/ceo/parts";
import { PrintButton } from "@/components/hq/features/ceo/PrintButton";
import { derive, risksOf, type CeoView } from "@/components/hq/features/ceo/sections";
import { requireStaff } from "@/lib/hq/auth";
import { HQ_BASE } from "@/lib/hq/constants";
import { formatAud, formatDate, formatDateTime, todayIn } from "@/lib/hq/format";
import { addDays, resolvePeriod } from "@/lib/hq/ceo/periods";
import { hoursText } from "@/lib/hq/ceo/rules";
import { LINE_KIND_LABEL, weeklyReport, type LineKind } from "@/lib/hq/ceo/report";
import { loadCeoData } from "@/lib/hq/ceo/queries";
import { planningAmount, planningStatusLabel } from "@/lib/hq/leadership/rules";

export const metadata: Metadata = { title: "This week at Planted" };

const KIND_CLASS: Record<LineKind, string> = { fact: s.kindFact, estimate: s.kindEstimate, assumption: s.kindAssumption, recommendation: s.kindRecommendation };

/*
 * "This week at Planted": the last seven days against the seven before, generated when the page is opened
 * from the same reads as the Command Centre (lib/hq/ceo/report.ts says what each line is). Print-ready: the
 * browser's print dialog saves it as a PDF. Read-only, for planning.read holders.
 */
export default async function WeeklyReportPage() {
  const { staff, db, can } = await requireStaff("planning.read", false, `${HQ_BASE}/ceo/report`);
  const t = await db.rpc("today");
  const today = typeof t.data === "string" ? t.data : todayIn(staff.timezone);
  const period = resolvePeriod("custom", today, { from: addDays(today, -6), to: today });
  const data = await loadCeoData(db, staff, can, period, today);
  const v: CeoView = { data, period, today, timezone: staff.timezone, can };
  const { o, managed, goal, totals, fees } = derive(v);
  const sections = weeklyReport({
    overview: o,
    managed: managed ? { managed: managed.managed, onboarding: managed.onboarding } : null,
    goal,
    totals,
    fees,
    economics: o?.economics ?? null,
    priorities: data.priorities?.ok ? data.priorities.data : [],
    risks: risksOf(v).map((r) => r.text),
    planning: (data.planning?.ok ? data.planning.data : []).filter((p) => p.kind === "funding").map((p) => ({ title: p.title, status: planningStatusLabel(p.kind, p.status).toLowerCase(), amount: planningAmount(p.amountAnticipated) })),
    money: formatAud,
    hours: hoursText,
    date: (d) => formatDate(d, staff.timezone),
  });

  return (
    <article className={s.report}>
      <p className={cx(s.noPrint)} style={{ marginBottom: 18 }}>
        <Link href={`${HQ_BASE}/ceo`} className={s.panelLink}>
          <Icon name="chevron-left" size={13} /> Command Centre
        </Link>
      </p>
      <p className={s.eyebrow}>Executive report</p>
      <h1 className={s.greeting}>This week at Planted</h1>
      <p className={s.briefing}>
        {formatDate(period.from, staff.timezone)} to {formatDate(period.to, staff.timezone)}, compared with the seven days before. Generated {o ? formatDateTime(o.generatedAt, staff.timezone) : "now"} from the records in HQ.
      </p>
      <div className={s.noPrint} style={{ display: "flex", gap: 8, marginTop: 18 }}>
        <PrintButton />
      </div>
      {sections.map((sec) => (
        <section key={sec.key} aria-labelledby={`r-${sec.key}`}>
          <h2 id={`r-${sec.key}`}>{sec.heading}</h2>
          <ul>
            {sec.lines.map((l, i) => (
              <li key={i}>
                <span className={cx(s.kind, KIND_CLASS[l.kind])}>{LINE_KIND_LABEL[l.kind]}</span>
                <span>{l.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <p className={s.how}>Facts are counted from HQ records. Estimates are people&rsquo;s own and never income. Assumptions are planning figures or things HQ cannot see yet. Recommendations come from the same priority score as Today.</p>
    </article>
  );
}
