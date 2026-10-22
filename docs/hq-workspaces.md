# Planted HQ: workspaces

HQ opens in a **workspace**: a view of Today for the job the person is doing. Phase 1 (this document) builds **Grow the business** and keeps the leadership command center as the **Business overview**. Deliver the service (property manager) and Keep things moving (EA / business support) are proposed and approved in shape, and are not built yet.

Code: `lib/hq/workspaces.ts` (which workspace, the navigation order and the phone tabs; pure, tested), `lib/hq/growth/next-calls.ts` (the call rules; pure, tested), `lib/hq/growth/next-calls-queries.ts` (the reads, shared by the page and chat), `lib/hq/growth/call-log.ts` (the "log outcome" rules; pure, tested), `components/hq/features/grow/*` (the Grow view, the switch, the log drawer and their actions), `lib/hq/mcp/tools/next-calls.ts` (chat). Migrations `0160_hq_workspaces.sql`, `0161_hq_function_acl_workspaces.sql`; tests `supabase/tests/hq_19_workspaces.sql`, `lib/hq/workspaces.test.mts`, `lib/hq/growth/next-calls.test.mts`, `lib/hq/growth/call-log.test.mts`.

## 1. A workspace is a preference, never a permission

A workspace decides three things: what Today shows, the order of the navigation groups, and the phone's three tabs. It never shows a record the person could not already open. Pages and queries still check capabilities, and row level security is the control.

| Workspace | Question | Offered with | Role default |
|---|---|---|---|
| Grow the business | Who should I contact next, and what will move the business forward? | `growth.read` | business development manager |
| Deliver the service | What needs attention across my properties and work? | (Phase 2) | senior PM, PM, junior PM |
| Keep things moving | What needs organising, preparing or chasing? | (Phase 3) | virtual assistant |
| Business overview | Are we on track to launch and to the goal? | everyone | director, administrator, read only |

Today opens in the first of these that the person may use: the `?view=` they chose, their saved default (`staff_profiles.workspace`, set only by themself with `hq.set_my_workspace` from "Make this my default"), the role's default, then the Business overview. Until Deliver and Support are built, people whose role defaults to them see the Business overview on Today. The navigation already follows their workspace: a property manager's Deliver group comes first, and their phone tabs stay Today, Tasks, Contractors.

## 2. Navigation

Today, then four labelled groups. The person's workspace puts its own group first, and nothing is hidden by it:

- **Grow**: Contacts (also organisations, referrals, import), Referral partners, Pipeline (also lead pages), Enquiries (with the new-enquiry badge; also the Communications hub).
- **Work**: Tasks, Projects, Meetings, Emails.
- **Deliver**: Properties, Contractors.
- **Company**: Decisions, Knowledge, Resources, People, Reports. The Growth overview's referral figures (`/hq/growth`) light Reports.

Phone tabs: Grow: Today, Contacts, Pipeline. Deliver: Today, Tasks, Contractors. Support: Today, Enquiries, Tasks. Overview: Today, Tasks, Projects. A page the person cannot see is skipped, and the next one takes its place. The shell follows the saved default. The `?view=` switch changes Today only.

## 3. Your next calls (the rules)

Only people the person owns: contacts by relationship owner, leads by assignee. Each appears **once**, in the first group that matches, with the reason written out. A lead's landlord contact is the same person as the lead, so they appear once, as the lead.

1. **Promised callbacks**: the last call was logged with "I promised to call them back", that date has come, and the follow-up has not been moved since. Why: "You promised to call back by 21 Oct. 1 day overdue."
2. **Overdue follow-ups**: a contact's follow-up date, or a lead's next action, before today. Why: "Follow-up you set for 18 Oct, 4 days overdue."
3. **Due today**: the same, today. A new website enquiry's reply is due the day it arrives. Why: "New website enquiry ENQ-0012: the reply is due today."
4. **Warm prospects**: open leads at qualified, appraisal requested, appraisal completed or proposal sent, with no activity for 7 days. These show even when the next action is planned for later, because an open lead always has one. Why: "Proposal sent, no activity since 12 Oct. Next action planned for 30 Oct."
5. **Partners to introduce ourselves to**: partner contacts never contacted. High priority comes first, then the oldest added. They are **never sorted by name**. Why: "High priority, never contacted, added 3 Oct."
6. **Relationships needing attention**: met, active or referring partners with no contact for more than 30 days (the same "quiet" threshold as Referral partners). Why: "Active relationship, no contact for 43 days."

Apart from warm prospects, a follow-up set for a later day keeps someone off the list until that day. Inactive contacts never appear. Within a group, the earliest date comes first, then priority, then the older record. Partner contacts with no owner are not ranked. They are counted under the list, with a link to assign them (Contacts filtered to partners with no owner). The rules read records only and never change a priority, a stage or a date.

The same reads feed `next_calls` in chat and the "Your next calls" section of `daily_brief`. `who_to_contact` keeps its team-wide view and now orders the same way (date, then priority, then the longest waiting).

## 4. Call, then log the outcome, then set the next follow-up

"Log outcome" on a call opens a drawer. It saves through `record_interaction` (contact) or `log_opportunity_activity` (lead), so the timeline, last contact, history and audit trail work as before.

- **How it went** (required): spoke, left a message, no answer, wrong number. Stored as `interactions.outcome`, on phone calls only.
- **What was said**: required when they spoke. For the other outcomes the outcome itself is the summary.
- **Next step**: optional. On a lead it replaces the next action, and blank keeps it.
- **Next follow-up** (required): tomorrow, in 3 days, in a week, a date, or **no further follow-up** with a reason. The no-follow-up option is for contacts only, because an open lead always has a next step and is closed as Lost on its page. A contact's follow-up is cleared, and the reason is added to the summary.
- **"I promised to call them back by then"**: stored as `interactions.callback_promised`, and needs the date.

The contact and lead "log a call" drawers and the chat tools `log_interaction` and `log_opportunity_activity` take the outcome and the promised callback too. There they stay optional.

## 5. The Grow view

Under the greeting: the switch, then a short line (calls lined up, promised callbacks, overdue, warm). Then:

- **Your next calls**: six shown, then "Show all".
- **Beside it**: the first-year goal (managed property records, active or onboarding, against `goal_managed_properties`), open leads by stage, referral partners by Connect, Cultivate and Champion, and **one line** on launch readiness that links to the Business overview.
- **Your growth tasks**: open tasks linked to a contact, organisation, referral or lead. A task linked to someone on the call list is shown on their call instead.

Email drafts waiting for approval and knowledge waiting for approval follow, when the person approves them. Every figure is a count of HQ records, and nothing is estimated. A failed read says so in one line.

## 6. Website enquiries

From 0160, a rental appraisal request starts its **new** lead at Appraisal requested. The contact form still starts at Introduction received. Existing leads are not touched, and an enquiry that attaches to an open lead never moves its stage.
