# Planted HQ: the leadership command center

The top of `/hq` for anyone who holds tasks. It answers, in five seconds and in this order: my three most important actions today; what is moving; what is waiting and on whom; what decisions need me; whether we are getting closer to launch and to the goal. Built on the existing tasks, projects, milestones, dependencies, decisions, growth records, permissions, audit trail and MCP server. Nothing about the task status model changes.

Code: `components/hq/features/leadership/*` (page sections and controls), `lib/hq/leadership/rules.ts` (every rule below, pure and unit tested), `lib/hq/leadership/queries.ts` (the loaders the page AND the chat tools share), `lib/hq/mcp/tools/leadership.ts` (chat). Migrations `0148_hq_leadership.sql`, `0149_hq_leadership_rpc.sql`, `0150_hq_function_acl_leadership.sql`; tests `supabase/tests/hq_18_leadership.sql`, `lib/hq/leadership/rules.test.mts`, the command-center section of `scripts/hq/mcp-tools-smoke.mts`.

## 1. What is new in the data (all optional; existing rows unchanged)

| Where | Field | Meaning |
|---|---|---|
| `hq.tasks` | `waiting_on` | Who or what the task waits on, in words (1-200). |
| | `waiting_since` | The day the wait began, **only when somebody recorded it**. Never filled in for them. |
| | `expected_response_date` | When a reply is expected, only when known. |
| | `next_follow_up_date` | When to chase it next. |
| | `planned_for` | The person's own working plan for the task. **Not** the due date and not the priority: moving it never changes a commitment. |
| | `planning_item_id` | The planning item it waits on (for example the anticipated funding). |
| `hq.project_milestones` | `launch_gate` | Required before the business can open. Launch readiness counts these. |
| `hq.planning_items` (PLN-0001) | kind `funding` / `dependency` / `context` | Founder-reported planning information, **not financial records**. `amount_anticipated` (funding only) is a planning figure, never a balance. `expected_text` keeps the founder's own words ("within a month"); `expected_by` is a real date only when one is known. Status: anticipated, confirmed, received, closed (funding, dependency); current, closed (context). Never deleted; audited. |
| `hq.settings` | `launch_project_id` | The project tracked as the business launch. When empty, the one live project whose name contains "business launch" is used, and a director is asked to confirm it. |

Leaving the waiting status (any path: the workboard, the task form, the project board, chat) clears `waiting_on`, `waiting_since`, `expected_response_date`, `planning_item_id` and `blocked_reason` unless the same change sets them, so a task that has moved on does not stay in Waiting. The task history keeps what they were (`task_activity` kind `waiting`), and every task change is in the audit trail as before.

Capabilities (an assumption for the owner to confirm): `planning.read` director and administrator; `planning.write` director. Tasks keep their rule (assignee, creator or `tasks.read_all`).

## 2. The workboard lanes (a view, never a status)

First rule that matches (`laneOf`):

1. completed or cancelled: not on the board;
2. anything holding it up: **Waiting** (an unfinished dependency, a live planning item, `waiting_on`, a held-up reason, or simply the waiting status);
3. status in progress: **In motion**;
4. overdue: **Do now** (an overdue task never hides in a later lane);
5. planned for a later day: **Coming next** (the person's own plan wins over "due soon");
6. planned for today or earlier: **Do now**;
7. due within two days, or urgent: **Do now**;
8. otherwise: **Coming next**.

Moving a card (`laneMove`) changes the status and `planned_for` only: Do now = to do, planned today; In motion = in progress; Waiting = waiting, with what it waits on; Coming next = to do, planned for a later day (default next Monday). A task that waits on another unfinished task stays in Waiting and the toast says so.

## 3. The focus score (explainable, deterministic, never written back)

`scoreTask` adds points, each with its reason; `pickFocus` takes the person's own open tasks that can move now (not waiting, not a parent whose open subtasks are the work, not planned for a later day unless overdue), highest score first, at most three.

| Factor | Points |
|---|---|
| Overdue | 40 + 2 a day (up to 14 days) |
| Due today / tomorrow / within 3 days / within 7 days | 35 / 28 / 20 / 10 |
| Planned by you for today or earlier | 25 |
| Official priority urgent / high / normal / low | 30 / 18 / 6 / 0 |
| Project priority urgent / high | +8 / +4 |
| Milestone required to open | +10 |
| Its milestone overdue, or due within 14 days | +12, or +8 |
| Unblocks other open tasks | +6 each, at most +18 |
| Linked to a contact, organisation or referral (relationship follow-up) | +6 |
| Linked to a lead (business development) | +6 |
| Already in progress | +5 |

Ties: earlier due date, then older task. "Important" = high or urgent priority, a launch requirement, a high or urgent project, or it unblocks others; "pressing" = overdue, due within three days, or planned for today. The page and chat say "Important and due now", "Due now", "Important, not pressing" or "Next up", so important work is not confused with today's work. The same function ranks `focus_today`, `founder_priorities` and the dashboard: they cannot disagree. Nothing here changes a priority; only a person does, in Quick edit or the task form.

## 4. Launch readiness

**Ready to open** = milestones marked required to open that are done, of all marked; shown as segments, one per requirement. **Tasks done** = the project's own progress (top-level, non-cancelled tasks), shown separately and labelled "every task counts the same". When no milestone is marked, no readiness figure is shown. The next actionable milestone is the first open one (by date, then order) with a task that can move now; its best task (by the focus score) is the next action. Blockers are the project's tasks in the Waiting lane. Commitments are open milestones and top-level tasks due within three weeks (and overdue ones).

## 5. Chat (MCP) tools

| Tool | Capability | Kind | Phrase it answers |
|---|---|---|---|
| `focus_today` | `tasks.write` | read | "What's my focus today?" |
| `workboard` | `tasks.write` | read | "What's moving?", "Show my workboard" |
| `launch_progress` | `projects.read` | read | "What is blocking business launch?" |
| `waiting_on` | `tasks.write` | read | "What's waiting?"; with `item`: "What can I do before the $25,000 arrives?" |
| `weekly_leadership_review` | `tasks.write` | read | "Give me my weekly leadership review." |
| `list_planning_items` | `planning.read` | read | "What planning items do we have?" |
| `set_task_waiting` | `tasks.write` | write | "Move training into Waiting on funding." |
| `resolve_waiting` | `tasks.write` | write | "Ailo has called me back, update the task." |
| `move_task_to_lane` | `tasks.write` | write | "Put the referral research in Do now." |
| `plan_next_week` | `tasks.write` | bulk | "Organise my tasks for next week." Proposes first; saves `planned_for` only for the entries the person agrees, one transaction, idempotency key, the bulk budget. |
| `save_planning_item` | `planning.write` | write | "The funding has been confirmed." / "Record the $25,000 we expect within a month." |
| `set_launch_requirement` | `projects.write` | write | "Licensing must be done before we open." |

Existing tools still cover status, owner, project link and held-up reason (`update_task`, `bulk_update_tasks`) and dependencies (`add_task_dependency`, `remove_task_dependency`). Every write goes through an RPC that checks the capability and the task rule again, records the history and the audit trail, and counts against the single-write cap (bulk: the bulk budget). Planning amounts are always said as anticipated.

## 6. What it never does

- It never changes a priority or due date unless the person sets that field.
- It never treats an anticipated amount as money held: nothing is "available" until marked received, and even then it is a planning record, not a ledger.
- It never invents a date, an amount, a rate or a forecast. Growth shows counts of HQ records only.
- It never deletes anything.
