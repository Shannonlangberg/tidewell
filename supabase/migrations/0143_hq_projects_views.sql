-- 0143_hq_projects_views.sql
-- Projects: the three views (project_overview, task_overview, project_timeline) and the two focus
-- functions (my_focus, overdue_tasks). Tables in 0142, RPCs in 0144, function privileges in 0145.
--
-- VISIBILITY. Every view is security_invoker: the reader's RLS applies to every table read. A project
-- is visible to everyone with projects.read; the TASKS inside it still follow the task rule (assignee,
-- creator, or tasks.read_all), so a private task stays private and every count, progress figure and
-- health rule below uses ONLY the tasks the reader can see. A holder of tasks.read_all sees every task,
-- so for directors, administrators and senior property managers the figures ARE the project-wide ones
-- (no separate definer view is needed, and none exists: every hq view stays security_invoker).
-- "Blocked" is read from task_dependencies.depends_on_open, so a reader who cannot see the blocking task
-- still sees correctly that a task is blocked (without learning what blocks it).
--
-- PROGRESS (project_overview.progress_pct): top-level tasks only (parent_task_id is null), so subtasks
-- are never double counted; live (not archived); visible to the reader. progress_pct =
-- floor(100 * completed / (all top-level tasks that are not cancelled)), and 0 when there are none.
-- No partial credit for subtasks or checklists.
--
-- HEALTH (project_overview.health), "today" = hq.today() (the configured timezone), "overdue task" =
-- a live, visible task (any level) that is not completed or cancelled and whose due_date < today,
-- days overdue = today - due_date. First rule that matches wins:
--   1. done       the project status is completed or cancelled
--   2. on_hold    the project status is on_hold
--   3. off_track  any overdue task is MORE than 7 days overdue (8 or more);
--                 or any open milestone has due_date < today;
--                 or the project's target_date < today
--   4. at_risk    any overdue task exists (1 to 7 days overdue);
--                 or target_date is today or within the next 14 days (target_date <= today + 14)
--                 and progress_pct < 60
--   5. on_track   otherwise (planning and active projects alike)
-- health_reasons lists, in plain words, every rule that matched at the winning level (for off_track and
-- at_risk), or one line for the others.

-- ------------------------------------------------------------------ project_overview
create view hq.project_overview with (security_invoker = true) as
select
  p.id,
  p.ref_number,
  'PRJ-' || lpad(p.ref_number::text, greatest(4, length(p.ref_number::text)), '0') as ref,
  p.name,
  p.description,
  p.owner_id,
  ow.full_name as owner_name,
  p.status,
  p.priority,
  p.start_date,
  p.target_date,
  p.completed_at,
  p.notes,
  p.version,
  coalesce(tc.total, 0) as task_count,
  coalesce(tc.to_do, 0) as to_do_count,
  coalesce(tc.in_progress, 0) as in_progress_count,
  coalesce(tc.waiting, 0) as waiting_count,
  coalesce(tc.completed, 0) as completed_count,
  coalesce(tc.cancelled, 0) as cancelled_count,
  coalesce(tc.open, 0) as open_count,
  coalesce(tc.overdue, 0) as overdue_count,
  coalesce(tc.max_overdue_days, 0) as max_overdue_days,
  coalesce(tc.blocked, 0) as blocked_count,
  coalesce(tc.top_done, 0) as progress_done,
  coalesce(tc.top_counted, 0) as progress_total,
  pr.pct as progress_pct,
  coalesce(ms.total, 0) as milestone_count,
  coalesce(ms.done, 0) as milestones_done,
  coalesce(ms.overdue, 0) as overdue_milestone_count,
  nm.id as next_milestone_id,
  nm.name as next_milestone_name,
  nm.due_date as next_milestone_due,
  h.health,
  h.reasons as health_reasons,
  case when p.target_date is null then null else p.target_date - td.d end as days_to_target,
  p.created_by,
  p.created_at,
  p.updated_at,
  p.deleted_at
from hq.projects p
cross join (select hq.today() as d) td
left join hq.staff_profiles ow on ow.id = p.owner_id
left join lateral (
  select count(*) as total,
         count(*) filter (where t.status = 'to_do') as to_do,
         count(*) filter (where t.status = 'in_progress') as in_progress,
         count(*) filter (where t.status = 'waiting') as waiting,
         count(*) filter (where t.status = 'completed') as completed,
         count(*) filter (where t.status = 'cancelled') as cancelled,
         count(*) filter (where t.status not in ('completed', 'cancelled')) as open,
         count(*) filter (where t.status not in ('completed', 'cancelled') and t.due_date < td.d) as overdue,
         max(td.d - t.due_date) filter (where t.status not in ('completed', 'cancelled') and t.due_date < td.d) as max_overdue_days,
         count(*) filter (where t.status not in ('completed', 'cancelled')
                            and exists (select 1 from hq.task_dependencies d where d.task_id = t.id and d.depends_on_open)) as blocked,
         count(*) filter (where t.parent_task_id is null and t.status = 'completed') as top_done,
         count(*) filter (where t.parent_task_id is null and t.status <> 'cancelled') as top_counted
  from hq.tasks t
  where t.project_id = p.id and t.deleted_at is null
) tc on true
cross join lateral (
  select case when coalesce(tc.top_counted, 0) = 0 then 0
              else floor(100.0 * coalesce(tc.top_done, 0) / tc.top_counted)::integer end as pct
) pr
left join lateral (
  select count(*) as total,
         count(*) filter (where m.status = 'done') as done,
         count(*) filter (where m.status = 'open' and m.due_date < td.d) as overdue
  from hq.project_milestones m where m.project_id = p.id
) ms on true
left join lateral (
  select m.id, m.name, m.due_date
  from hq.project_milestones m
  where m.project_id = p.id and m.status = 'open'
  order by m.due_date nulls last, m.sort_order, m.created_at
  limit 1
) nm on true
cross join lateral (
  select case
    when p.status in ('completed', 'cancelled') then 'done'
    when p.status = 'on_hold' then 'on_hold'
    when coalesce(tc.max_overdue_days, 0) > 7 or coalesce(ms.overdue, 0) > 0 or p.target_date < td.d then 'off_track'
    when coalesce(tc.overdue, 0) > 0 or (p.target_date <= td.d + 14 and pr.pct < 60) then 'at_risk'
    else 'on_track' end as health,
  case
    when p.status = 'completed' then array['The project is completed']
    when p.status = 'cancelled' then array['The project was cancelled']
    when p.status = 'on_hold' then array['The project is on hold']
    when coalesce(tc.max_overdue_days, 0) > 7 or coalesce(ms.overdue, 0) > 0 or p.target_date < td.d then array_remove(array[
      case when coalesce(tc.max_overdue_days, 0) > 7 then 'A task is ' || tc.max_overdue_days || ' days overdue' end,
      case when coalesce(ms.overdue, 0) = 1 then 'A milestone is past its due date'
           when coalesce(ms.overdue, 0) > 1 then ms.overdue || ' milestones are past their due date' end,
      case when p.target_date < td.d then 'The target date has passed' end], null)
    when coalesce(tc.overdue, 0) > 0 or (p.target_date <= td.d + 14 and pr.pct < 60) then array_remove(array[
      case when coalesce(tc.overdue, 0) = 1 then '1 task is overdue'
           when coalesce(tc.overdue, 0) > 1 then tc.overdue || ' tasks are overdue' end,
      case when p.target_date <= td.d + 14 and pr.pct < 60
           then 'The target date is ' || case when p.target_date = td.d then 'today' else 'in ' || (p.target_date - td.d) || ' days' end
                || ' and progress is ' || pr.pct || '%' end], null)
    else array['No overdue work and the target date is comfortable'] end as reasons
) h;
comment on view hq.project_overview is 'One row per project the reader can see (archived ones only for projects.write; filter deleted_at is null for the live list): PRJ-0001 ref, owner, status, dates, task counts by status, open, overdue (and the most days overdue), blocked, progress (top-level, non-cancelled tasks: progress_done of progress_total, progress_pct floored), milestones (total, done, overdue, the next open one) and health (on_track | at_risk | off_track | done | on_hold) with plain-language health_reasons. Task figures use ONLY the tasks the reader can see (tasks.read_all holders see all). Rules: migration 0143 header.';
revoke all on hq.project_overview from public, anon, authenticated, service_role;
grant select on hq.project_overview to authenticated;

-- ------------------------------------------------------------------ task_overview
create view hq.task_overview with (security_invoker = true) as
select
  t.id,
  t.title,
  t.description,
  t.status,
  t.priority,
  t.due_date,
  t.assigned_to,
  sp.full_name as assignee_name,
  t.source,
  t.project_id,
  case when p.id is null then null else 'PRJ-' || lpad(p.ref_number::text, greatest(4, length(p.ref_number::text)), '0') end as project_ref,
  p.name as project_name,
  p.status as project_status,
  p.priority as project_priority,
  t.milestone_id,
  m.name as milestone_name,
  m.due_date as milestone_due_date,
  t.parent_task_id,
  pt.title as parent_title,
  t.sort_order,
  t.blocked_reason,
  coalesce(st.total, 0) as subtask_count,
  coalesce(st.open, 0) as open_subtask_count,
  coalesce(cl.total, 0) as checklist_total,
  coalesce(cl.done, 0) as checklist_done,
  coalesce(dp.total, 0) as dependency_count,
  coalesce(dp.open, 0) as open_dependency_count,
  (t.status not in ('completed', 'cancelled') and coalesce(dp.open, 0) > 0) as is_blocked,
  coalesce(bk.n, 0) as blocking_count,
  (t.status not in ('completed', 'cancelled') and t.due_date < td.d) as is_overdue,
  case when t.status not in ('completed', 'cancelled') and t.due_date < td.d then td.d - t.due_date else 0 end as overdue_days,
  t.related_contact_id,
  t.related_organisation_id,
  t.related_referral_id,
  t.related_opportunity_id,
  t.related_contractor_id,
  t.completed_at,
  t.completed_by,
  t.created_by,
  cb.full_name as created_by_name,
  t.created_at,
  t.updated_at,
  t.deleted_at
from hq.tasks t
cross join (select hq.today() as d) td
left join hq.staff_profiles sp on sp.id = t.assigned_to
left join hq.staff_profiles cb on cb.id = t.created_by
left join hq.projects p on p.id = t.project_id
left join hq.project_milestones m on m.id = t.milestone_id
left join hq.tasks pt on pt.id = t.parent_task_id
left join lateral (
  select count(*) as total, count(*) filter (where s.status not in ('completed', 'cancelled')) as open
  from hq.tasks s where s.parent_task_id = t.id and s.deleted_at is null
) st on true
left join lateral (
  select count(*) as total, count(*) filter (where c.done) as done
  from hq.task_checklist_items c where c.task_id = t.id
) cl on true
left join lateral (
  select count(*) as total, count(*) filter (where d.depends_on_open) as open
  from hq.task_dependencies d where d.task_id = t.id
) dp on true
left join lateral (
  select count(*) as n
  from hq.task_dependencies d
  join hq.tasks w on w.id = d.task_id and w.deleted_at is null and w.status not in ('completed', 'cancelled')
  where d.depends_on_task_id = t.id
) bk on true;
comment on view hq.task_overview is 'One row per task the reader can see (tasks RLS; archived ones only for growth.delete; filter deleted_at is null): the task with assignee name, project ref / name / status / priority (null when the reader lacks projects.read), milestone name and due date, parent title (null when the parent is not visible), subtask counts (visible), checklist counts, dependency counts (dependency_count, open_dependency_count: correct even when the blocking task is not visible), is_blocked (open and waiting on an open dependency), blocking_count (visible open tasks waiting on this one), is_overdue and overdue_days.';
revoke all on hq.task_overview from public, anon, authenticated, service_role;
grant select on hq.task_overview to authenticated;

-- ------------------------------------------------------------------ project_timeline
create view hq.project_timeline with (security_invoker = true) as
select
  m.project_id,
  'milestone'::text as kind,
  m.id as item_id,
  m.name as title,
  m.id as milestone_id,
  m.name as milestone_name,
  m.due_date as start_date,
  m.due_date as end_date,
  m.status::text as status,
  (m.status = 'done') as is_done,
  (m.status = 'open' and m.due_date < td.d) as is_overdue,
  false as is_blocked,
  null::uuid as assigned_to,
  null::text as assignee_name,
  null::uuid as parent_task_id,
  '{}'::uuid[] as depends_on,
  m.sort_order
from hq.project_milestones m
cross join (select hq.today() as d) td
union all
select
  t.project_id,
  'task'::text as kind,
  t.id as item_id,
  t.title,
  t.milestone_id,
  m.name as milestone_name,
  least((t.created_at at time zone tz.z)::date, t.due_date) as start_date,
  t.due_date as end_date,
  t.status::text as status,
  (t.status in ('completed', 'cancelled')) as is_done,
  (t.status not in ('completed', 'cancelled') and t.due_date < td.d) as is_overdue,
  (t.status not in ('completed', 'cancelled') and exists (select 1 from hq.task_dependencies d where d.task_id = t.id and d.depends_on_open)) as is_blocked,
  t.assigned_to,
  sp.full_name as assignee_name,
  t.parent_task_id,
  coalesce((select array_agg(d.depends_on_task_id order by d.id) from hq.task_dependencies d
            join hq.tasks dt on dt.id = d.depends_on_task_id where d.task_id = t.id), '{}'::uuid[]) as depends_on,
  t.sort_order
from hq.tasks t
cross join (select hq.today() as d) td
cross join (select coalesce((select s.value #>> '{}' from hq.settings s where s.key = 'timezone'), 'Australia/Adelaide') as z) tz
left join hq.project_milestones m on m.id = t.milestone_id
left join hq.staff_profiles sp on sp.id = t.assigned_to
where t.project_id is not null and t.deleted_at is null and t.due_date is not null;
comment on view hq.project_timeline is 'The timeline of each project the reader can see: one row per milestone (kind milestone; start_date = end_date = due_date, may be null) and one per live DATED task the reader can see (kind task; start_date = the day it was created or its due date if earlier, end_date = due_date), with milestone, status, is_done, is_overdue, is_blocked, assignee, parent and depends_on (ids of the visible tasks it waits for). Filter by project_id.';
revoke all on hq.project_timeline from public, anon, authenticated, service_role;
grant select on hq.project_timeline to authenticated;

-- ------------------------------------------------------------------ my_focus
-- The caller's next actionable tasks: assigned to the caller, live, not completed or cancelled, NOT
-- blocked (no open dependency), and not a parent with open subtasks (the subtasks are the work).
-- Order: overdue first; then task priority (urgent, high, normal, low); then due date (nulls last);
-- then project priority (urgent, high, normal, low; a task outside a project ranks as normal); then
-- oldest first (created_at), then id. why: up to three short reasons joined with '; ' in this order:
-- 'Overdue by N day(s)' | 'Due today' | 'Due tomorrow' | 'Due in N days' (within a week); 'Urgent' |
-- 'High priority'; 'Unblocks N task(s)' (open live tasks waiting on it); 'Next up' when none apply.
-- Project ref and name are given only to callers with projects.read.
create function hq.my_focus(p_limit integer default 3)
returns table (
  task_id uuid, title text, status hq.task_status, priority hq.task_priority, due_date date,
  project_id uuid, project_ref text, project_name text, milestone_name text,
  overdue_days integer, unblocks integer, why text, rank integer)
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_today date := hq.today();
  v_limit integer := least(greatest(coalesce(p_limit, 3), 1), 20);
  v_projects boolean := hq_private.has_capability('projects.read');
begin
  return query
  with c as (
    select t.*,
           case when t.due_date < v_today then v_today - t.due_date else 0 end as od,
           (select count(*)::integer from hq.task_dependencies d join hq.tasks w on w.id = d.task_id and w.deleted_at is null and w.status not in ('completed', 'cancelled')
             where d.depends_on_task_id = t.id) as ub,
           case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end as prank,
           case coalesce(p.priority, 'normal') when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end as pprank,
           p.ref_number as p_ref, p.name as p_name, m.name as m_name
    from hq.tasks t
    left join hq.projects p on p.id = t.project_id and p.deleted_at is null
    left join hq.project_milestones m on m.id = t.milestone_id
    where t.assigned_to = v_caller and t.deleted_at is null and t.status not in ('completed', 'cancelled')
      and not exists (select 1 from hq.task_dependencies d where d.task_id = t.id and d.depends_on_open)
      and not exists (select 1 from hq.tasks s where s.parent_task_id = t.id and s.deleted_at is null and s.status not in ('completed', 'cancelled'))
  ), o as (
    select c.*, row_number() over (order by (c.od > 0) desc, c.prank, c.due_date nulls last, c.pprank, c.created_at, c.id)::integer as rn
    from c
  )
  select o.id, o.title, o.status, o.priority, o.due_date,
         case when v_projects then o.project_id end,
         case when v_projects and o.p_ref is not null then 'PRJ-' || lpad(o.p_ref::text, greatest(4, length(o.p_ref::text)), '0') end,
         case when v_projects then o.p_name end,
         case when v_projects then o.m_name end,
         o.od, o.ub,
         coalesce(nullif(array_to_string(array_remove(array[
           case when o.od = 1 then 'Overdue by 1 day' when o.od > 1 then 'Overdue by ' || o.od || ' days'
                when o.due_date = v_today then 'Due today' when o.due_date = v_today + 1 then 'Due tomorrow'
                when o.due_date between v_today + 2 and v_today + 7 then 'Due in ' || (o.due_date - v_today) || ' days' end,
           case o.priority when 'urgent' then 'Urgent' when 'high' then 'High priority' end,
           case when o.ub = 1 then 'Unblocks 1 task' when o.ub > 1 then 'Unblocks ' || o.ub || ' tasks' end], null), '; '), ''), 'Next up'),
         o.rn
  from o
  where o.rn <= v_limit
  order by o.rn;
end $$;
comment on function hq.my_focus(integer) is 'Active staff. The caller''s next actionable tasks (default 3, at most 20): assigned to the caller, open, not blocked, not a parent with open subtasks; ordered overdue first, priority, due date (nulls last), project priority, oldest. Returns task_id, title, status, priority, due_date, project_id / project_ref / project_name / milestone_name (projects.read only), overdue_days, unblocks, why, rank.';

-- ------------------------------------------------------------------ overdue_tasks
-- p_scope 'mine' (assigned to the caller, the default) or 'all' (every task the caller can see: the task
-- rule). Optional p_project narrows to one project (needs projects.read). Ordered most overdue first,
-- then priority.
create function hq.overdue_tasks(p_scope text default 'mine', p_project uuid default null)
returns table (
  task_id uuid, title text, status hq.task_status, priority hq.task_priority, due_date date, overdue_days integer,
  assigned_to uuid, assignee_name text, project_id uuid, project_ref text, project_name text, is_blocked boolean)
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_today date := hq.today();
  v_scope text := lower(coalesce(nullif(btrim(p_scope), ''), 'mine'));
  v_all boolean := hq_private.has_capability('tasks.read_all');
  v_projects boolean := hq_private.has_capability('projects.read');
begin
  if v_scope not in ('mine', 'all') then
    raise exception 'scope is mine or all' using errcode = 'invalid_parameter_value';
  end if;
  if p_project is not null and not v_projects then
    raise exception 'permission denied' using errcode = 'insufficient_privilege', detail = 'requires projects.read';
  end if;
  return query
  select t.id, t.title, t.status, t.priority, t.due_date, (v_today - t.due_date)::integer,
         t.assigned_to, sp.full_name,
         case when v_projects then t.project_id end,
         case when v_projects and p.id is not null then 'PRJ-' || lpad(p.ref_number::text, greatest(4, length(p.ref_number::text)), '0') end,
         case when v_projects then p.name end,
         exists (select 1 from hq.task_dependencies d where d.task_id = t.id and d.depends_on_open)
  from hq.tasks t
  left join hq.staff_profiles sp on sp.id = t.assigned_to
  left join hq.projects p on p.id = t.project_id
  where t.deleted_at is null and t.status not in ('completed', 'cancelled') and t.due_date < v_today
    and (case when v_scope = 'mine' then t.assigned_to = v_caller
              else (t.assigned_to = v_caller or t.created_by = v_caller or v_all) end)
    and (p_project is null or t.project_id = p_project)
  order by t.due_date, case t.priority when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end, t.created_at, t.id
  limit 200;
end $$;
comment on function hq.overdue_tasks(text, uuid) is 'Active staff. Overdue open tasks (due_date before today): scope mine (assigned to the caller, default) or all (every task the caller can see under the task rule), optionally one project (projects.read). At most 200, most overdue first. Project fields only for projects.read holders.';

revoke execute on all functions in schema hq from public, anon;
