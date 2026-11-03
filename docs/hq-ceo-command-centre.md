# HQ: the CEO Command Centre

`/hq/ceo`, "Command Centre" in the navigation, under Today. A founder's view of the whole business, live from HQ's records. It answers five questions: how the business is performing, whether it is growing fast enough, whether it is financially healthy, whether service is excellent, and what needs a decision today.

Today stays the place for the day's own work (the command center: focus, workboard, waiting). The Command Centre is the view of the business. Reports keeps its figure panels.

## Who sees it

You need `planning.read` to open it (directors, and administrators to read). Each row also needs the capability its records need, and is absent without it: properties need `portfolio.read`, and the pipeline, partners and activity need `growth.read`. Projects need `projects.read`, decisions `decisions.read`, and priorities use the person's own tasks (`tasks.write`). Row level security and the checks inside each RPC are the control. Hiding a row is only a courtesy.

## Where every figure comes from

| Figure | Source | Notes |
|---|---|---|
| Managed properties, goal, pace | `hq.business_summary()` | Managed = active + onboarding. The goal (target and date) is the `goal_managed_properties` / `goal_date` settings, edited in Settings. Nothing is hardcoded. |
| Period figures, history, funnel, partners, activity | `hq.ceo_overview(from, to, prev_from, prev_to)` (0162) | One aggregate, capability-gated jsonb. |
| Priorities | `lib/hq/ceo/priorities.ts` over the command center's reads | The command center's `scoreTask` is the only ranking (see below). |
| Launch readiness | `lib/hq/leadership` (`loadLaunchProject`, `launchReadiness`) | The same as Today. |
| Projects, decisions | `project_overview`, `decisions` | |
| Planning figures (anticipated funding) | `planning_items` | Always "a planning figure, not money held". |

Calculations from the counts live in `lib/hq/ceo/rules.ts`, periods in `lib/hq/ceo/periods.ts` and the weekly report in `lib/hq/ceo/report.ts`. All three are pure and unit tested.

## Definitions

- **Period.** This month, last 30 days, this quarter, financial year (from 1 July), or a custom range. It never reaches past today. A period still running is compared with the **same number of days** from the start of the previous one (3 days of November against 3 days of October, never all of October). Rolling and custom ranges are compared with the same number of days immediately before.
- **When a management began.** `managed_from`, else `agreement_signed_on`, else the date it was recorded. It ends on `ended_on`. The monthly history counts a property from the month it began until the month it ended.
- **Contracted annual fees.** For a percentage fee: weekly rent × 52 × the fee %. For a flat fee, other basis or short-term: the agreed yearly fee. Both are recorded excluding GST. This is what the agreements say. It is never income received (Ailo holds that) and never profit. Properties without their terms recorded are left out of the figure and counted, so the figure never looks complete when it isn't.
- **Pipeline value.** People's own yearly estimates on open opportunities. It is labelled an estimate and kept apart from contracted fees.
- **Signing pace.** Properties still needed for the goal, spread over the months to the goal date, scaled to the period's days. Without a goal date there is no pace.
- **Retention.** Of the properties managed at the start of the period, those that did not end in it. A percentage is shown only from 10 properties. End reasons are as recorded; a missing one shows as "Reason not recorded".
- **Conversion.** From stage history. Of the leads that ever reached a stage (furthest stage reached, lost excluded), how many went on to the next. A rate is shown only from 5 leads.
- **Stalled.** An open lead 21+ days in its stage with nothing logged for 14 days.
- **Activity.** Relationship actions are calls, meetings, emails and messages with referral partners (partner contacts or organisations, not leads). Discovery conversations are calls and meetings logged on a lead. Qualified, appraisals completed, proposals sent and signings count each lead's first time reaching that stage.
- **Weekly targets.** The `ceo_weekly_targets` setting. It starts empty, and a director sets it on the page (`set_ceo_targets`, `settings.admin`). Activity is compared as a trend: four-week averages and the last two complete weeks against the two before. There is no gamification.
- **Website enquiry response.** The median time from an enquiry arriving to someone picking it up in HQ (`handled_at`). Spam is excluded.

The pgTAP file `hq_19` checks that `ceo_overview`'s qualified, signed and referrals-received figures equal `growth_summary`'s.

## Priorities: one ranking

The command center's focus score (`scoreTask`, docs/hq-command-center.md) orders everything. Other things that need the CEO are put in the same terms a task is scored in:

- **Lead follow-up** (from `overdue_opportunities`): treated as a task due on the follow-up date and linked to a lead. Priority is high when nobody owns the lead.
- **Decision for you** (proposed, you are the decision maker): treated as a high-priority task with no due date, because HQ records no decide-by date.
- **Website enquiry** still New after a day: treated as a high-priority task due the day after it arrived.

At most five are shown, each with its reasons and a link to its real record. Nothing on the page changes a record except the weekly targets.

## This week at Planted

`/hq/ceo/report` covers the last seven days against the seven before. Every line is labelled **Fact**, **Estimate**, **Assumption** or **Recommended**. It is generated on open, and the browser's print dialog saves it as a PDF. `weeklyReport()` is pure, so a scheduled email can render the same lines later.

## Gaps closed by 0162 (the smallest extensions)

- `managed_properties.weekly_rent_cents` and `annual_fee_cents`: the agreed terms, set on the property page ("Agreement terms", `set_property_terms`, `portfolio.write`, audited).
- `managed_properties.end_reason`: why a management is ending (offboarding or ended only).
- The `ceo_weekly_targets` setting with its own guard.
- `hq.ceo_overview`.

## Not built: waiting on an integration

These are shown as honest states, never as placeholder numbers:

- **Accounting:** revenue, costs, profit, cash, margin and break-even.
- **Ailo:** maintenance, inspections, arrears, owner and tenant response times, satisfaction and reviews.
- **Short-term bookings:** commissionable booking revenue, occupancy, ADR and contribution margin.
- **Offices and teams:** properties have no office field yet, and pods belong to staff only.

There is no combined service score, because too little is measured to justify one.
