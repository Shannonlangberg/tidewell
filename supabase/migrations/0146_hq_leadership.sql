-- 0146_hq_leadership.sql
-- The leadership command center (docs/hq-command-center.md): what a task is WAITING ON, the founder's
-- own working plan for a task, launch requirements, and planning items (anticipated funding and other
-- founder-reported context). The TABLE, the new columns, guards, the waiting history trigger, RLS and
-- the task_overview columns are here; the RPCs are in 0147; function privileges in 0148.
--
-- Nothing here changes the task status model: to_do, in_progress, waiting, completed and cancelled stay
-- the only statuses. The Workboard's four lanes (Do now, In motion, Waiting, Coming next) are a VIEW
-- worked out from these fields in lib/hq/leadership/lanes.ts, never stored.
--
-- TASKS (new optional columns; every existing row keeps its values, all start null):
--   waiting_on              who or what the task is waiting on, in words ("Ailo to reply after the demo").
--                           1-200 characters.
--   waiting_since           the day the wait began, only when somebody recorded it. Never filled in for them.
--   expected_response_date  when a reply is expected, only when known.
--   next_follow_up_date     when to chase it next.
--   planned_for             the day the person PLANS to work on it: their own working plan. It is not the
--                           due date and not the priority, so moving it never changes an official
--                           commitment ("Organise my tasks for next week" sets this, nothing else).
--   planning_item_id        the planning item it waits on (for example the anticipated business funding).
--   Leaving the waiting status (to in progress, to do, completed or cancelled) clears waiting_on,
--   waiting_since, expected_response_date, planning_item_id and blocked_reason unless the same change
--   sets them, so a task that has moved on does not stay in Waiting; the history keeps what they were.
--
-- MILESTONES: launch_gate (default false) marks a milestone that must be done before the business can
--   open. Launch readiness = launch-gate milestones done / launch-gate milestones, shown apart from task
--   completion, so admin tasks never count the same as, say, the licence.
--
-- PLANNING ITEMS (hq.planning_items, shown as PLN-0001): founder-reported planning information, NOT
--   financial records. kind funding (an amount that is anticipated, never a balance), dependency (an
--   outside party or event several tasks wait on) or context (a note on the current situation).
--   status: funding and dependency go anticipated -> confirmed -> received, or closed; context is
--   current or closed. amount_anticipated is allowed on funding only and is a planning figure.
--   expected_text holds the founder's own words for timing ("within a month"); expected_by is a real
--   date only when one is known. Written only through hq.save_planning_item (0147); never deleted.
--
-- SETTINGS: launch_project_id (null or a live project): the project the command center tracks as the
--   business launch. When it is null, the command center looks for one live project whose name contains
--   "business launch" and asks a director to confirm it.
--
-- CAPABILITIES (data, in hq.role_capabilities; an assumption for the owner to confirm):
--   planning.read    director, administrator
--   planning.write   director

-- ------------------------------------------------------------------ enums
create type hq.planning_kind as enum ('funding', 'dependency', 'context');
create type hq.planning_status as enum ('anticipated', 'confirmed', 'received', 'current', 'closed');

-- ------------------------------------------------------------------ capabilities (an assumption for the owner to confirm)
insert into hq.role_capabilities (role, capability)
select r.role::hq.staff_role, r.capability
from (values
  ('director', 'planning.read'), ('director', 'planning.write'),
  ('administrator', 'planning.read')
) as r(role, capability)
on conflict do nothing;

-- ------------------------------------------------------------------ settings
insert into hq.settings (key, value) values ('launch_project_id', 'null'::jsonb) on conflict (key) do nothing;

-- settings_guard (0142) with launch_project_id: null or the id of a live project.
create or replace function hq_private.settings_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
declare
  v_max integer;
  v_date date;
begin
  if tg_op = 'UPDATE' and new.key is distinct from old.key then
    raise exception 'a setting key cannot change' using errcode = 'insufficient_privilege';
  end if;
  if new.key = 'require_mfa' and jsonb_typeof(new.value) is distinct from 'boolean' then
    raise exception 'require_mfa must be true or false' using errcode = 'invalid_parameter_value';
  end if;
  if new.key = 'ai_enabled' and jsonb_typeof(new.value) is distinct from 'boolean' then
    raise exception 'ai_enabled must be true or false' using errcode = 'invalid_parameter_value';
  end if;
  if new.key = 'email_chat_send_enabled' and jsonb_typeof(new.value) is distinct from 'boolean' then
    raise exception 'email_chat_send_enabled must be true or false' using errcode = 'invalid_parameter_value';
  end if;
  if new.key = 'enquiry_auto_reply_enabled' and jsonb_typeof(new.value) is distinct from 'boolean' then
    raise exception 'enquiry_auto_reply_enabled must be true or false' using errcode = 'invalid_parameter_value';
  end if;
  if new.key = 'knowledge_chat_approve_enabled' and jsonb_typeof(new.value) is distinct from 'boolean' then
    raise exception 'knowledge_chat_approve_enabled must be true or false' using errcode = 'invalid_parameter_value';
  end if;
  if new.key = 'timezone' and (
       jsonb_typeof(new.value) is distinct from 'string'
       or not exists (select 1 from pg_catalog.pg_timezone_names z where z.name = new.value #>> '{}')) then
    raise exception 'timezone must be an IANA timezone name' using errcode = 'invalid_parameter_value';
  end if;
  if new.key in ('contractor_min_reviews_for_rating', 'contractor_expiry_warning_days', 'ai_hourly_limit', 'goal_managed_properties', 'email_daily_limit',
                 'bulk_calls_per_hour', 'bulk_items_per_hour') then
    v_max := case new.key when 'contractor_min_reviews_for_rating' then 100 when 'ai_hourly_limit' then 1000
                          when 'goal_managed_properties' then 10000 when 'email_daily_limit' then 200
                          when 'bulk_calls_per_hour' then 60 when 'bulk_items_per_hour' then 2000 else 365 end;
    if jsonb_typeof(new.value) is distinct from 'number' or (new.value #>> '{}') !~ '^[0-9]{1,5}$' then
      raise exception '% must be a whole number from 1 to %', new.key, v_max using errcode = 'invalid_parameter_value';
    end if;
    if (new.value #>> '{}')::integer not between 1 and v_max then
      raise exception '% must be a whole number from 1 to %', new.key, v_max using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if new.key = 'goal_date' and jsonb_typeof(new.value) is distinct from 'null' then
    if jsonb_typeof(new.value) is distinct from 'string' or (new.value #>> '{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then
      raise exception 'goal_date must be null or a date (YYYY-MM-DD)' using errcode = 'invalid_parameter_value';
    end if;
    begin
      v_date := (new.value #>> '{}')::date;
    exception when others then
      raise exception 'goal_date must be null or a date (YYYY-MM-DD)' using errcode = 'invalid_parameter_value';
    end;
    if to_char(v_date, 'YYYY-MM-DD') <> (new.value #>> '{}') or v_date not between date '2000-01-01' and date '2100-12-31' then
      raise exception 'goal_date must be null or a date (YYYY-MM-DD)' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if new.key = 'launch_project_id' and jsonb_typeof(new.value) is distinct from 'null' then
    if jsonb_typeof(new.value) is distinct from 'string'
       or (new.value #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (select 1 from hq.projects p where p.id = (new.value #>> '{}')::uuid and p.deleted_at is null) then
      raise exception 'launch_project_id must be null or a live project' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if new.key = 'enquiry_default_owner_id' and jsonb_typeof(new.value) is distinct from 'null' then
    if jsonb_typeof(new.value) is distinct from 'string'
       or (new.value #>> '{}') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or not exists (select 1 from hq.staff_profiles sp
                      where sp.id = (new.value #>> '{}')::uuid and sp.is_active and sp.employment_status = 'active') then
      raise exception 'enquiry_default_owner_id must be null or an active member of staff' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end $$;

-- ------------------------------------------------------------------ planning_items
create table hq.planning_items (
  id uuid primary key default gen_random_uuid(),
  ref_number bigint generated always as identity,
  kind hq.planning_kind not null,
  title text not null,
  detail text,
  amount_anticipated numeric(12, 2),
  expected_text text,
  expected_by date,
  status hq.planning_status not null,
  sort_order integer not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid,
  constraint planning_items_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint planning_items_detail_length check (detail is null or char_length(detail) between 1 and 2000),
  constraint planning_items_expected_text_length check (expected_text is null or char_length(expected_text) between 1 and 200),
  constraint planning_items_expected_by_sane check (expected_by is null or expected_by between date '2000-01-01' and date '2100-12-31'),
  constraint planning_items_amount_funding_only check (amount_anticipated is null or kind = 'funding'),
  constraint planning_items_amount_range check (amount_anticipated is null or amount_anticipated between 0 and 100000000),
  constraint planning_items_status_by_kind check (
    (kind = 'context' and status in ('current', 'closed'))
    or (kind <> 'context' and status in ('anticipated', 'confirmed', 'received', 'closed'))),
  constraint planning_items_version_positive check (version >= 1)
);
comment on table hq.planning_items is 'Founder-reported planning information, shown as PLN-0001: anticipated funding (amount_anticipated is a PLANNING figure, never a balance), outside dependencies several tasks wait on, and notes on the current situation. status: anticipated | confirmed | received | closed (funding, dependency), current | closed (context). expected_text = the founder''s own words for timing; expected_by only when a real date is known. Tasks point at it through hq.tasks.planning_item_id. Written only by hq.save_planning_item; never deleted.';
comment on column hq.planning_items.amount_anticipated is 'A planning figure in AUD that is ANTICIPATED, not money held. Funding only.';
create unique index planning_items_ref_number_uq on hq.planning_items (ref_number);
create index planning_items_status_idx on hq.planning_items (status);

create function hq_private.planning_item_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  new.title := btrim(regexp_replace(new.title, '\s+', ' ', 'g'));
  new.detail := nullif(btrim(coalesce(new.detail, '')), '');
  new.expected_text := nullif(btrim(regexp_replace(coalesce(new.expected_text, ''), '\s+', ' ', 'g')), '');
  if tg_op = 'UPDATE' then
    if new.kind is distinct from old.kind then
      raise exception 'the kind of a planning item cannot change' using errcode = 'insufficient_privilege';
    end if;
    new.version := old.version + 1;
    new.updated_by := auth.uid();
  end if;
  return new;
end $$;

create trigger row_stamp before insert or update on hq.planning_items for each row execute function hq_private.row_stamp();
create trigger planning_item_guard before insert or update on hq.planning_items for each row execute function hq_private.planning_item_guard();
create trigger no_delete before delete on hq.planning_items for each row execute function hq_private.raise_immutable();
create trigger no_truncate before truncate on hq.planning_items for each statement execute function hq_private.raise_immutable();
create trigger audit after insert or update or delete on hq.planning_items for each row execute function hq_private.audit_row('planning_item');

-- ------------------------------------------------------------------ tasks: what it waits on, and the working plan
alter table hq.tasks add column waiting_on text;
alter table hq.tasks add column waiting_since date;
alter table hq.tasks add column expected_response_date date;
alter table hq.tasks add column next_follow_up_date date;
alter table hq.tasks add column planned_for date;
alter table hq.tasks add column planning_item_id uuid references hq.planning_items (id);
alter table hq.tasks add constraint tasks_waiting_on_length check (waiting_on is null or char_length(waiting_on) between 1 and 200);
alter table hq.tasks add constraint tasks_leadership_dates_sane check (
  (waiting_since is null or waiting_since between date '2000-01-01' and date '2100-12-31')
  and (expected_response_date is null or expected_response_date between date '2000-01-01' and date '2100-12-31')
  and (next_follow_up_date is null or next_follow_up_date between date '2000-01-01' and date '2100-12-31')
  and (planned_for is null or planned_for between date '2000-01-01' and date '2100-12-31'));
create index tasks_planning_item_id_idx on hq.tasks (planning_item_id) where planning_item_id is not null;
create index tasks_planned_for_idx on hq.tasks (assigned_to, planned_for) where planned_for is not null and deleted_at is null;
comment on column hq.tasks.waiting_on is 'Who or what the task is waiting on, in words. Cleared when the task leaves the waiting status (unless that change sets it).';
comment on column hq.tasks.waiting_since is 'The day the wait began, only when somebody recorded it.';
comment on column hq.tasks.expected_response_date is 'When a reply is expected, only when known.';
comment on column hq.tasks.next_follow_up_date is 'When to chase it next.';
comment on column hq.tasks.planned_for is 'The day the person plans to work on it (their working plan): not the due date, not the priority.';
comment on column hq.tasks.planning_item_id is 'The planning item (for example anticipated funding) the task waits on.';

-- Leaving the waiting status clears what it was waiting on (unless the same change sets it), and every
-- change to the waiting fields or the working plan is written to the task history.
create function hq_private.task_waiting_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  new.waiting_on := nullif(btrim(regexp_replace(coalesce(new.waiting_on, ''), '\s+', ' ', 'g')), '');
  if tg_op = 'UPDATE' and old.status = 'waiting' and new.status <> 'waiting' then
    if new.waiting_on is not distinct from old.waiting_on then new.waiting_on := null; end if;
    if new.waiting_since is not distinct from old.waiting_since then new.waiting_since := null; end if;
    if new.expected_response_date is not distinct from old.expected_response_date then new.expected_response_date := null; end if;
    if new.planning_item_id is not distinct from old.planning_item_id then new.planning_item_id := null; end if;
    if new.blocked_reason is not distinct from old.blocked_reason then new.blocked_reason := null; end if;
  end if;
  return new;
end $$;
create trigger task_waiting_guard before update on hq.tasks for each row execute function hq_private.task_waiting_guard();

create function hq_private.task_waiting_log() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_parts text[] := '{}';
  v_detail jsonb := '{}'::jsonb;
  v_title text;
begin
  if new.waiting_on is distinct from old.waiting_on then
    v_detail := v_detail || jsonb_build_object('waiting_on', jsonb_build_object('from', old.waiting_on, 'to', new.waiting_on));
    v_parts := v_parts || case when new.waiting_on is null then 'no longer waiting on ' || coalesce(old.waiting_on, 'anything')
                               else 'waiting on ' || new.waiting_on end;
  end if;
  if new.planning_item_id is distinct from old.planning_item_id then
    select p.title into v_title from hq.planning_items p where p.id = coalesce(new.planning_item_id, old.planning_item_id);
    v_detail := v_detail || jsonb_build_object('planning_item_id', jsonb_build_object('from', old.planning_item_id, 'to', new.planning_item_id));
    v_parts := v_parts || case when new.planning_item_id is null then 'no longer waiting on ' || coalesce(v_title, 'a planning item')
                               else 'waiting on ' || coalesce(v_title, 'a planning item') end;
  end if;
  if new.waiting_since is distinct from old.waiting_since then
    v_detail := v_detail || jsonb_build_object('waiting_since', jsonb_build_object('from', old.waiting_since, 'to', new.waiting_since));
    if new.waiting_since is not null then v_parts := v_parts || ('waiting since ' || to_char(new.waiting_since, 'YYYY-MM-DD')); end if;
  end if;
  if new.expected_response_date is distinct from old.expected_response_date then
    v_detail := v_detail || jsonb_build_object('expected_response_date', jsonb_build_object('from', old.expected_response_date, 'to', new.expected_response_date));
    if new.expected_response_date is not null then v_parts := v_parts || ('reply expected ' || to_char(new.expected_response_date, 'YYYY-MM-DD')); end if;
  end if;
  if new.next_follow_up_date is distinct from old.next_follow_up_date then
    v_detail := v_detail || jsonb_build_object('next_follow_up_date', jsonb_build_object('from', old.next_follow_up_date, 'to', new.next_follow_up_date));
    v_parts := v_parts || ('follow up ' || coalesce(to_char(new.next_follow_up_date, 'YYYY-MM-DD'), 'cleared'));
  end if;
  if new.planned_for is distinct from old.planned_for then
    v_detail := v_detail || jsonb_build_object('planned_for', jsonb_build_object('from', old.planned_for, 'to', new.planned_for));
    v_parts := v_parts || ('planned for ' || coalesce(to_char(new.planned_for, 'YYYY-MM-DD'), 'no particular day'));
  end if;
  if new.blocked_reason is distinct from old.blocked_reason then
    v_detail := v_detail || jsonb_build_object('blocked_reason', jsonb_build_object('from', old.blocked_reason, 'to', new.blocked_reason));
    v_parts := v_parts || case when new.blocked_reason is null then 'held-up reason cleared' else 'held up: ' || new.blocked_reason end;
  end if;
  if v_detail = '{}'::jsonb then
    return null;
  end if;
  insert into hq.task_activity (task_id, actor_id, kind, summary, detail)
  values (new.id, auth.uid(), 'waiting', left(upper(left(array_to_string(v_parts, ', '), 1)) || substr(array_to_string(v_parts, ', '), 2), 500), v_detail);
  return null;
end $$;
create trigger task_waiting_log after update on hq.tasks for each row execute function hq_private.task_waiting_log();

-- ------------------------------------------------------------------ milestones: launch requirements
alter table hq.project_milestones add column launch_gate boolean not null default false;
comment on column hq.project_milestones.launch_gate is 'True when this milestone must be done before the business can open. Launch readiness counts these, apart from task completion.';

-- ------------------------------------------------------------------ access
alter table hq.planning_items enable row level security;
alter table hq.planning_items force row level security;
create policy planning_items_select on hq.planning_items for select to authenticated
  using ((select hq_private.has_capability('planning.read')));
revoke all on hq.planning_items from public, anon, authenticated, service_role;
grant select on hq.planning_items to authenticated, service_role;

-- ------------------------------------------------------------------ task_overview, with the new columns at the end
-- planning_item_title / _kind / _status come through the reader's RLS: null without planning.read.
create or replace view hq.task_overview with (security_invoker = true) as
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
  t.deleted_at,
  t.waiting_on,
  t.waiting_since,
  t.expected_response_date,
  t.next_follow_up_date,
  t.planned_for,
  t.planning_item_id,
  pi.title as planning_item_title,
  pi.kind as planning_item_kind,
  pi.status as planning_item_status,
  coalesce(m.launch_gate, false) as milestone_launch_gate
from hq.tasks t
cross join (select hq.today() as d) td
left join hq.staff_profiles sp on sp.id = t.assigned_to
left join hq.staff_profiles cb on cb.id = t.created_by
left join hq.projects p on p.id = t.project_id
left join hq.project_milestones m on m.id = t.milestone_id
left join hq.tasks pt on pt.id = t.parent_task_id
left join hq.planning_items pi on pi.id = t.planning_item_id
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
comment on view hq.task_overview is 'One row per task the reader can see (tasks RLS; archived ones only for growth.delete; filter deleted_at is null): the task with assignee name, project ref / name / status / priority (null when the reader lacks projects.read), milestone name, due date and launch_gate, parent title (null when the parent is not visible), subtask counts (visible), checklist counts, dependency counts (dependency_count, open_dependency_count: correct even when the blocking task is not visible), is_blocked (open and waiting on an open dependency), blocking_count (visible open tasks waiting on this one), is_overdue and overdue_days; and (0146) waiting_on, waiting_since, expected_response_date, next_follow_up_date, planned_for, planning_item_id with its title, kind and status (null without planning.read).';
