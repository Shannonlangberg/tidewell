-- 0125_hq_decisions.sql
-- The Business Decisions Register: what the business decided, why, who decided, when, whether it is
-- still in force, what replaced it, and every change since. Same patterns as Phases 1 to 3 and trades.
--
-- TABLES (schema hq; RLS enabled and forced; the API may only SELECT; every write goes through the
-- security definer RPCs below, as with hq.ai_requests and hq.trades):
--   decisions          one row per decision, shown as DEC-0001 (ref_number). Soft deletion only
--                      (archive_record / restore_record, entity 'decision'); never deleted.
--   decision_history   append-only for every role: one row per recorded change, written inside the
--                      RPCs (who, when, a plain summary, changes {field: {from, to}}, the note).
--   decision_tasks     which tasks a decision led to (decision, task, who linked it, when). A link row
--                      is removed only by unlink_decision_task (recorded in the history). A link to a
--                      PROJECT is planned for when projects exist; there is no projects table yet.
--
-- CAPABILITIES (data, in hq.role_capabilities; change the matrix there, not in code):
--   decisions.read   director, administrator, senior_property_manager, business_development_manager, read_only
--   decisions.write  director, administrator (create, edit, change status, supersede, reverse, link, archive)
--
-- RULES (database-enforced):
--   * title 1..200 characters (trimmed); description and rationale at most 5000; notes at most 1000;
--   * decision_date from 1990-01-01 to at most 7 days after hq.today() (checked when it is set);
--   * the decision maker is an ACTIVE member of staff when set or changed (a maker who later leaves
--     stays on the decisions they made);
--   * status superseded  <=> superseded_by_id is set; never self; the target is a live decision; no loops;
--     status reversed    <=> reversed_note is set (a note is required to reverse);
--   * superseded and reversed are CLOSED: their status never changes again (record a new decision);
--   * a decision that a live decision is superseded by cannot be archived (archive that one first);
--   * a task can be linked only if the person linking it can see it (the tasks_select rule).
--
-- RPCs (security definer, search_path pinned, capability checked inside, audited, history written):
--   create_decision, update_decision, supersede_decision, link_decision_task, unlink_decision_task
--   archive_record / restore_record gain entity 'decision' (decisions.write).

-- ------------------------------------------------------------------ enums
create type hq.decision_category as enum (
  'strategy', 'finance', 'people', 'operations', 'partners', 'marketing', 'technology', 'legal_compliance', 'service_offering', 'other');
create type hq.decision_status as enum ('proposed', 'decided', 'in_effect', 'superseded', 'reversed');

-- ------------------------------------------------------------------ capabilities (an assumption for the owner to confirm)
insert into hq.role_capabilities (role, capability)
select r.role::hq.staff_role, r.capability
from (values
  ('director', 'decisions.read'), ('director', 'decisions.write'),
  ('administrator', 'decisions.read'), ('administrator', 'decisions.write'),
  ('senior_property_manager', 'decisions.read'),
  ('business_development_manager', 'decisions.read'),
  ('read_only', 'decisions.read')
) as r(role, capability)
on conflict do nothing;

-- ------------------------------------------------------------------ decisions
create table hq.decisions (
  id uuid primary key default gen_random_uuid(),
  ref_number bigint generated always as identity,
  title text not null,
  description text,
  rationale text,
  category hq.decision_category not null,
  decision_date date not null,
  status hq.decision_status not null default 'decided',
  decision_maker_id uuid not null references hq.staff_profiles (id),
  superseded_by_id uuid references hq.decisions (id),
  reversed_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint decisions_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint decisions_description_length check (description is null or char_length(description) <= 5000),
  constraint decisions_rationale_length check (rationale is null or char_length(rationale) <= 5000),
  constraint decisions_reversed_note_length check (reversed_note is null or char_length(btrim(reversed_note)) between 1 and 1000),
  constraint decisions_date_sane check (decision_date >= date '1990-01-01'),
  constraint decisions_not_self_superseded check (superseded_by_id is null or superseded_by_id <> id),
  constraint decisions_superseded_iff_target check ((status = 'superseded') = (superseded_by_id is not null)),
  constraint decisions_reversed_iff_note check ((status = 'reversed') = (reversed_note is not null))
);
comment on table hq.decisions is 'The Business Decisions Register. ref_number is shown as DEC-0001. Written only through create_decision / update_decision / supersede_decision and archive_record / restore_record (entity decision). Never deleted.';
comment on column hq.decisions.status is 'proposed | decided | in_effect (open) | superseded (needs superseded_by_id) | reversed (needs reversed_note). superseded and reversed are closed.';
comment on column hq.decisions.decision_maker_id is 'Who made the decision: an active member of staff when it was recorded or changed.';
create unique index decisions_ref_number_uq on hq.decisions (ref_number);
create index decisions_decision_maker_id_idx on hq.decisions (decision_maker_id);
create index decisions_superseded_by_id_idx on hq.decisions (superseded_by_id);
create index decisions_date_idx on hq.decisions (decision_date desc, ref_number desc) where deleted_at is null;
create index decisions_status_idx on hq.decisions (status) where deleted_at is null;
create index decisions_title_trgm_idx on hq.decisions using gin (title extensions.gin_trgm_ops);

-- ------------------------------------------------------------------ decision_history (append-only)
create table hq.decision_history (
  id bigint generated always as identity primary key,
  decision_id uuid not null references hq.decisions (id),
  changed_by uuid,
  changed_by_name text,
  changed_at timestamptz not null default now(),
  action text not null,
  summary text not null,
  changes jsonb not null default '{}'::jsonb,
  note text,
  constraint decision_history_action_known check (action in ('create', 'update', 'status_change', 'supersede', 'supersedes', 'reverse', 'link_task', 'unlink_task', 'archive', 'restore')),
  constraint decision_history_summary_length check (char_length(summary) between 1 and 500),
  constraint decision_history_note_length check (note is null or char_length(note) <= 1000),
  constraint decision_history_changes_object check (jsonb_typeof(changes) = 'object')
);
comment on table hq.decision_history is 'Append-only history of each decision: one row per recorded change (who, when, summary, changes {field: {from, to}}, note). Written inside the decision RPCs and archive_record / restore_record.';
create index decision_history_decision_id_idx on hq.decision_history (decision_id, changed_at, id);

-- ------------------------------------------------------------------ decision_tasks (links)
create table hq.decision_tasks (
  decision_id uuid not null references hq.decisions (id),
  task_id uuid not null references hq.tasks (id),
  linked_by uuid,
  linked_at timestamptz not null default now(),
  primary key (decision_id, task_id)
);
comment on table hq.decision_tasks is 'Tasks a decision led to. Written only by link_decision_task / unlink_decision_task (each recorded in decision_history and the audit log). A project link will be added when HQ has projects.';
create index decision_tasks_task_id_idx on hq.decision_tasks (task_id);

-- ------------------------------------------------------------------ guard (every writer, including the table owner)
create function hq_private.decision_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_cur uuid;
  v_n integer := 0;
begin
  new.title := btrim(new.title);
  new.description := nullif(btrim(coalesce(new.description, '')), '');
  new.rationale := nullif(btrim(coalesce(new.rationale, '')), '');
  if new.reversed_note is not null then
    new.reversed_note := nullif(btrim(new.reversed_note), '');
  end if;

  if tg_op = 'UPDATE' then
    if new.ref_number is distinct from old.ref_number then
      raise exception 'a decision''s number cannot change' using errcode = 'insufficient_privilege';
    end if;
    -- superseded and reversed are closed: the status never moves again
    if old.status in ('superseded', 'reversed') and (new.status is distinct from old.status
         or new.superseded_by_id is distinct from old.superseded_by_id or new.reversed_note is distinct from old.reversed_note) then
      raise exception 'a % decision is closed: record a new decision instead', old.status
        using errcode = 'check_violation', hint = 'decision_closed';
    end if;
    -- archiving: refused while a live decision is superseded by this one (its target must stay live)
    if old.deleted_at is null and new.deleted_at is not null
       and exists (select 1 from hq.decisions x where x.superseded_by_id = new.id and x.deleted_at is null) then
      raise exception 'another decision is superseded by this one; archive that decision first'
        using errcode = 'check_violation', hint = 'decision_is_supersession_target';
    end if;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  else
    new.updated_by := null;
  end if;

  if new.superseded_by_id is not null and (tg_op = 'INSERT' or new.superseded_by_id is distinct from old.superseded_by_id
       or (old.deleted_at is not null and new.deleted_at is null)) then
    if not exists (select 1 from hq.decisions x where x.id = new.superseded_by_id and x.deleted_at is null) then
      raise exception 'the superseding decision must be a live (not archived) decision'
        using errcode = 'check_violation', hint = 'decision_target_not_live';
    end if;
    -- no loops: follow the chain from the target; reaching this decision again is a loop
    v_cur := new.superseded_by_id;
    while v_cur is not null and v_n < 10000 loop
      if v_cur = new.id then
        raise exception 'that would make a loop of decisions superseding each other'
          using errcode = 'check_violation', hint = 'decision_supersession_loop';
      end if;
      select x.superseded_by_id into v_cur from hq.decisions x where x.id = v_cur;
      v_n := v_n + 1;
    end loop;
  end if;

  if tg_op = 'INSERT' or new.decision_maker_id is distinct from old.decision_maker_id then
    if not exists (select 1 from hq.staff_profiles sp where sp.id = new.decision_maker_id and sp.is_active and sp.employment_status = 'active') then
      raise exception 'the decision maker must be an active member of staff' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if tg_op = 'INSERT' or new.decision_date is distinct from old.decision_date then
    if new.decision_date > hq.today() + 7 then
      raise exception 'a decision date can be at most 7 days ahead' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  return new;
end $$;

create trigger row_stamp before insert or update on hq.decisions for each row execute function hq_private.row_stamp();
create trigger soft_delete_guard before insert or update on hq.decisions for each row execute function hq_private.soft_delete_guard();
create trigger decision_guard before insert or update on hq.decisions for each row execute function hq_private.decision_guard();
create trigger no_delete before delete on hq.decisions for each row execute function hq_private.raise_immutable();
create trigger no_truncate before truncate on hq.decisions for each statement execute function hq_private.raise_immutable();

create trigger append_only before update or delete on hq.decision_history for each row execute function hq_private.raise_immutable();
create trigger append_only_truncate before truncate on hq.decision_history for each statement execute function hq_private.raise_immutable();

-- links are inserted and removed, never edited
create trigger no_update before update on hq.decision_tasks for each row execute function hq_private.raise_immutable();
create trigger no_truncate before truncate on hq.decision_tasks for each statement execute function hq_private.raise_immutable();

-- ------------------------------------------------------------------ audit: decisions are labelled DEC-0001 title
create or replace function hq_private.audit_row() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_entity text := tg_argv[0];
  v_new jsonb;
  v_old jsonb;
  v_row jsonb;
  v_changes jsonb := '{}'::jsonb;
  -- bookkeeping and derived columns never appear in a diff
  v_skip constant text[] := array['id', 'created_at', 'created_by', 'updated_at', 'deleted_by', 'updated_by', 'name_key', 'ref_number', 'display_number'];
  v_key text;
  v_val jsonb;
  v_action text;
  v_label text;
  v_summary text;
  v_note text := nullif(current_setting('hq.audit_note', true), '');
  v_override text := nullif(current_setting('hq.audit_action', true), '');
  v_actor uuid := auth.uid();
begin
  if v_override = 'skip' then
    return null; -- an RPC's own bookkeeping update (for example linking a task to its interaction)
  end if;
  if tg_op = 'DELETE' then
    v_old := to_jsonb(old);
    v_row := v_old;
  elsif tg_op = 'INSERT' then
    v_new := to_jsonb(new);
    v_row := v_new;
  else
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);
    v_row := v_new;
  end if;

  if tg_op = 'UPDATE' then
    for v_key, v_val in select e.key, e.value from jsonb_each(v_new) e loop
      if v_key = any (v_skip) then continue; end if;
      if v_val is distinct from (v_old -> v_key) then
        v_changes := v_changes || jsonb_build_object(v_key,
          jsonb_build_object('from', hq_private.audit_trim(v_old -> v_key), 'to', hq_private.audit_trim(v_val)));
      end if;
    end loop;
    if v_changes = '{}'::jsonb then
      return null; -- nothing but bookkeeping changed
    end if;
  else
    for v_key, v_val in select e.key, e.value from jsonb_each(case when tg_op = 'INSERT' then v_new else v_old end) e loop
      if v_key = any (v_skip) or v_val in ('null'::jsonb, '{}'::jsonb, '[]'::jsonb) then continue; end if;
      v_changes := v_changes || jsonb_build_object(v_key,
        jsonb_build_object(case when tg_op = 'INSERT' then 'to' else 'from' end, hq_private.audit_trim(v_val)));
    end loop;
  end if;

  v_action := case
    when v_override is not null then v_override
    when tg_op = 'INSERT' then 'create'
    when tg_op = 'DELETE' then 'delete'
    when v_old ->> 'deleted_at' is null and v_new ->> 'deleted_at' is not null then 'archive'
    when v_old ->> 'deleted_at' is not null and v_new ->> 'deleted_at' is null then 'restore'
    when tg_table_name = 'trades' and v_old ->> 'archived_at' is null and v_new ->> 'archived_at' is not null then 'archive'
    when tg_table_name = 'trades' and v_old ->> 'archived_at' is not null and v_new ->> 'archived_at' is null then 'restore'
    when tg_table_name = 'opportunities' and v_old ->> 'stage' is distinct from v_new ->> 'stage' then 'stage_change'
    when tg_table_name in ('contractors', 'decisions') and v_old ->> 'status' is distinct from v_new ->> 'status' then 'status_change'
    else 'update'
  end;

  v_label := coalesce(
    case when tg_table_name = 'referrals' then 'REF-' || lpad(v_row ->> 'ref_number', 4, '0') end,
    case when tg_table_name = 'decisions' then 'DEC-' || lpad(v_row ->> 'ref_number', greatest(4, length(v_row ->> 'ref_number')), '0') || ' ' || (v_row ->> 'title') end,
    case when tg_table_name = 'role_capabilities' then (v_row ->> 'role') || ' ' || (v_row ->> 'capability') end,
    case when tg_table_name = 'interactions' then v_row ->> 'interaction_type' end,
    case when tg_table_name = 'contractor_vetting_steps' then replace(v_row ->> 'step', '_', ' ') || ' ' || replace(v_row ->> 'status', '_', ' ') end,
    case when tg_table_name = 'contractor_documents' then replace(v_row ->> 'document_type', '_', ' ') || ' ' || (v_row ->> 'file_name') end,
    case when tg_table_name = 'contractor_reviews' then v_row ->> 'job_reference' end,
    case when tg_table_name = 'trades' then v_row ->> 'label' end,
    v_row ->> 'name', v_row ->> 'full_name', v_row ->> 'business_name', v_row ->> 'prospect_name', v_row ->> 'title', v_row ->> 'key');

  v_summary := initcap(replace(v_action, '_', ' ')) || ' ' || v_entity
    || coalesce(': ' || v_label, '')
    || case when v_action = 'stage_change' then ' (' || (v_old ->> 'stage') || ' to ' || (v_new ->> 'stage') || ')'
            when tg_table_name in ('contractors', 'decisions') and tg_op = 'UPDATE' and v_old ->> 'status' is distinct from v_new ->> 'status'
              then ' (' || (v_old ->> 'status') || ' to ' || (v_new ->> 'status') || ')'
            else '' end
    || coalesce(' [' || v_note || ']', '');

  insert into hq.audit_events (actor_id, actor_name, action, entity_type, entity_id, summary, changes)
  values (
    v_actor,
    coalesce((select sp.full_name from hq.staff_profiles sp where sp.id = v_actor), case when v_actor is null then 'System' end),
    v_action, v_entity,
    case when v_row ? 'id' then (v_row ->> 'id')::uuid
         when tg_table_name = 'contractor_vetting_steps' then (v_row ->> 'contractor_id')::uuid end,
    left(v_summary, 500), v_changes);
  return null;
end $$;

create trigger audit after insert or update or delete on hq.decisions for each row execute function hq_private.audit_row('decision');

-- ------------------------------------------------------------------ access
alter table hq.decisions enable row level security;         alter table hq.decisions force row level security;
alter table hq.decision_history enable row level security;  alter table hq.decision_history force row level security;
alter table hq.decision_tasks enable row level security;    alter table hq.decision_tasks force row level security;

-- Readers see live decisions; archived ones only decisions.write holders (who can restore them).
create policy decisions_select on hq.decisions for select to authenticated
  using ((select hq_private.has_capability('decisions.read'))
         and (deleted_at is null or (select hq_private.has_capability('decisions.write'))));
-- History and links of a decision the reader can see (the subquery runs under the reader's RLS).
create policy decision_history_select on hq.decision_history for select to authenticated
  using ((select hq_private.has_capability('decisions.read'))
         and exists (select 1 from hq.decisions d where d.id = decision_id));
create policy decision_tasks_select on hq.decision_tasks for select to authenticated
  using ((select hq_private.has_capability('decisions.read'))
         and exists (select 1 from hq.decisions d where d.id = decision_id));

revoke all on hq.decisions, hq.decision_history, hq.decision_tasks from public, anon, authenticated, service_role;
grant select on hq.decisions, hq.decision_history, hq.decision_tasks to authenticated, service_role;

-- ------------------------------------------------------------------ the overview (list, search, detail)
-- security_invoker: the reader's RLS applies to every table it reads, so the decision maker's name
-- needs people.read, and the linked-task counts include ONLY tasks the reader can see.
create view hq.decision_overview with (security_invoker = true) as
select
  d.id,
  d.ref_number,
  'DEC-' || lpad(d.ref_number::text, greatest(4, length(d.ref_number::text)), '0') as ref,
  d.title,
  d.description,
  d.rationale,
  d.category,
  d.status,
  d.decision_date,
  d.decision_maker_id,
  dm.full_name as decision_maker_name,
  d.superseded_by_id,
  case when sb.id is not null then 'DEC-' || lpad(sb.ref_number::text, greatest(4, length(sb.ref_number::text)), '0') end as superseded_by_ref,
  sb.title as superseded_by_title,
  d.reversed_note,
  coalesce(lt.total, 0) as linked_task_count,
  coalesce(lt.open, 0) as open_linked_task_count,
  d.created_by,
  d.created_at,
  d.updated_at,
  d.deleted_at
from hq.decisions d
left join hq.staff_profiles dm on dm.id = d.decision_maker_id
left join hq.decisions sb on sb.id = d.superseded_by_id
left join lateral (
  select count(*) as total, count(*) filter (where t.status not in ('completed', 'cancelled')) as open
  from hq.decision_tasks dt
  join hq.tasks t on t.id = dt.task_id and t.deleted_at is null
  where dt.decision_id = d.id
) lt on true;
comment on view hq.decision_overview is 'One row per decision the reader can see, with DEC-0001 ref, decision maker name, superseded-by ref and title, and counts of linked tasks the reader can see. Filter deleted_at is null for the live register.';
revoke all on hq.decision_overview from public, anon, authenticated, service_role;
grant select on hq.decision_overview to authenticated;

-- ------------------------------------------------------------------ RPC helpers (not granted to any API role)
create function hq_private.decision_ref(p_n bigint) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select 'DEC-' || lpad(p_n::text, greatest(4, length(p_n::text)), '0')
$$;

create function hq_private.decision_json(p_d hq.decisions) returns jsonb
language sql stable set search_path = pg_catalog, public, extensions as $$
  select jsonb_build_object(
    'decision_id', p_d.id, 'ref', hq_private.decision_ref(p_d.ref_number), 'ref_number', p_d.ref_number,
    'title', p_d.title, 'category', p_d.category, 'status', p_d.status, 'decision_date', p_d.decision_date,
    'decision_maker_id', p_d.decision_maker_id, 'superseded_by_id', p_d.superseded_by_id,
    'reversed_note', p_d.reversed_note, 'updated_at', p_d.updated_at)
$$;

-- Plain words for the history summaries.
create function hq_private.decision_status_label(p_status hq.decision_status) returns text
language sql immutable parallel safe set search_path = pg_catalog, public, extensions as $$
  select case p_status when 'proposed' then 'Proposed' when 'decided' then 'Decided' when 'in_effect' then 'In effect'
    when 'superseded' then 'Superseded' when 'reversed' then 'Reversed' end
$$;

create function hq_private.decision_history_write(
  p_decision uuid, p_action text, p_summary text, p_changes jsonb default '{}'::jsonb, p_note text default null
) returns void
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_actor uuid := auth.uid();
begin
  insert into hq.decision_history (decision_id, changed_by, changed_by_name, action, summary, changes, note)
  values (p_decision, v_actor,
          coalesce((select sp.full_name from hq.staff_profiles sp where sp.id = v_actor), case when v_actor is null then 'System' end),
          p_action, left(p_summary, 500), coalesce(p_changes, '{}'::jsonb), p_note);
end $$;

-- Text a person typed: trimmed, blank = null, bounded (22023 with a plain message).
create function hq_private.decision_text(p_value text, p_max integer, p_what text) returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if v is not null and char_length(v) > p_max then
    raise exception '% is at most % characters', p_what, p_max using errcode = 'invalid_parameter_value';
  end if;
  return v;
end $$;

-- A task the caller may see (the tasks_select policy, restated for a security definer RPC):
-- live, and assigned to them, created by them, or they hold tasks.read_all.
create function hq_private.task_visible_to_caller(p_task uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select hq_private.staff_session() and exists (
    select 1 from hq.tasks t
    where t.id = p_task and t.deleted_at is null
      and (t.assigned_to = auth.uid() or t.created_by = auth.uid() or hq_private.has_capability('tasks.read_all')))
$$;

-- ------------------------------------------------------------------ create_decision
create function hq.create_decision(
  p_title text,
  p_category hq.decision_category,
  p_decision_date date default null,
  p_status hq.decision_status default 'decided',
  p_description text default null,
  p_rationale text default null,
  p_decision_maker uuid default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_title text;
  v_desc text;
  v_rat text;
  v_note text;
  v_date date := coalesce(p_decision_date, hq.today());
  v_status hq.decision_status := coalesce(p_status, 'decided');
  v_d hq.decisions;
begin
  perform hq_private.require_capability('decisions.write');
  v_title := hq_private.decision_text(p_title, 200, 'a title');
  if v_title is null then
    raise exception 'a decision needs a title' using errcode = 'invalid_parameter_value';
  end if;
  if p_category is null then
    raise exception 'choose a category' using errcode = 'invalid_parameter_value';
  end if;
  v_desc := hq_private.decision_text(p_description, 5000, 'a description');
  v_rat := hq_private.decision_text(p_rationale, 5000, 'a rationale');
  v_note := hq_private.decision_text(p_note, 1000, 'a note');
  if v_status in ('superseded', 'reversed') then
    raise exception 'a new decision is proposed, decided or in effect; supersede or reverse it afterwards'
      using errcode = 'invalid_parameter_value';
  end if;
  if v_date > hq.today() + 7 then
    raise exception 'a decision date can be at most 7 days ahead' using errcode = 'invalid_parameter_value';
  end if;
  if v_date < date '1990-01-01' then
    raise exception 'that decision date is too far in the past' using errcode = 'invalid_parameter_value';
  end if;
  perform hq_private.require_active_staff(coalesce(p_decision_maker, v_caller), 'the decision maker');

  perform hq_private.audit_context(null, left(v_note, 200));
  insert into hq.decisions (title, description, rationale, category, decision_date, status, decision_maker_id)
  values (v_title, v_desc, v_rat, p_category, v_date, v_status, coalesce(p_decision_maker, v_caller))
  returning * into v_d;
  perform hq_private.audit_context();

  perform hq_private.decision_history_write(v_d.id, 'create',
    'Recorded ' || hq_private.decision_ref(v_d.ref_number) || ' as ' || lower(hq_private.decision_status_label(v_d.status)),
    jsonb_build_object('title', jsonb_build_object('to', v_d.title), 'category', jsonb_build_object('to', v_d.category),
      'status', jsonb_build_object('to', v_d.status), 'decision_date', jsonb_build_object('to', v_d.decision_date),
      'decision_maker_id', jsonb_build_object('to', v_d.decision_maker_id)),
    v_note);
  return hq_private.decision_json(v_d) || jsonb_build_object('changed', true);
end $$;
comment on function hq.create_decision(text, hq.decision_category, date, hq.decision_status, text, text, uuid, text) is 'decisions.write. Records a decision: title 1-200, category, date (default today, at most 7 days ahead), status proposed | decided (default) | in_effect, description and rationale up to 5000, decision maker (default the caller; active staff), optional note up to 1000. Writes the first history row and an audit event. Returns {decision_id, ref, ref_number, title, category, status, decision_date, decision_maker_id, superseded_by_id, reversed_note, updated_at, changed}.';

-- ------------------------------------------------------------------ update_decision
-- Patch semantics: a null argument leaves that field as it is; an empty description or rationale
-- clears it. A change that changes nothing writes nothing ({changed: false}). Status moves:
--   proposed / decided / in_effect: any of the three (corrections allowed);
--   reversed: needs p_note (kept as reversed_note);
--   superseded: needs p_superseded_by (a live decision in force, not this one) and p_note;
--   from superseded or reversed: never (closed).
-- p_expected_updated_at (optional): refuse if someone else changed the decision since it was read.
create function hq.update_decision(
  p_decision uuid,
  p_title text default null,
  p_description text default null,
  p_rationale text default null,
  p_category hq.decision_category default null,
  p_decision_date date default null,
  p_status hq.decision_status default null,
  p_decision_maker uuid default null,
  p_superseded_by uuid default null,
  p_note text default null,
  p_expected_updated_at timestamptz default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_cur hq.decisions;
  v_new hq.decisions;
  v_target hq.decisions;
  v_note text;
  v_status hq.decision_status;
  v_changes jsonb := '{}'::jsonb;
  v_parts text[] := '{}';
  v_action text := 'update';
  v_summary text;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('decisions.write');
  v_note := hq_private.decision_text(p_note, 1000, 'a note');

  select d.* into v_cur from hq.decisions d where d.id = p_decision and d.deleted_at is null for update;
  if not found then
    raise exception 'decision not found' using errcode = 'no_data_found';
  end if;
  if p_expected_updated_at is not null and v_cur.updated_at <> p_expected_updated_at then
    raise exception 'this decision was changed by someone else; reload it and try again'
      using errcode = 'check_violation', hint = 'decision_stale';
  end if;

  v_new := v_cur;
  if p_title is not null then
    v_new.title := hq_private.decision_text(p_title, 200, 'a title');
    if v_new.title is null then
      raise exception 'a decision needs a title' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if p_description is not null then v_new.description := hq_private.decision_text(p_description, 5000, 'a description'); end if;
  if p_rationale is not null then v_new.rationale := hq_private.decision_text(p_rationale, 5000, 'a rationale'); end if;
  if p_category is not null then v_new.category := p_category; end if;
  if p_decision_date is not null then
    if p_decision_date > hq.today() + 7 then
      raise exception 'a decision date can be at most 7 days ahead' using errcode = 'invalid_parameter_value';
    end if;
    if p_decision_date < date '1990-01-01' then
      raise exception 'that decision date is too far in the past' using errcode = 'invalid_parameter_value';
    end if;
    v_new.decision_date := p_decision_date;
  end if;
  if p_decision_maker is not null and p_decision_maker is distinct from v_cur.decision_maker_id then
    perform hq_private.require_active_staff(p_decision_maker, 'the decision maker');
    v_new.decision_maker_id := p_decision_maker;
  end if;

  -- status
  if p_superseded_by is not null and p_status is not null and p_status <> 'superseded' then
    raise exception 'a superseding decision can only be given when the status is superseded' using errcode = 'invalid_parameter_value';
  end if;
  v_status := coalesce(p_status, case when p_superseded_by is not null then 'superseded'::hq.decision_status end, v_cur.status);
  if v_status is distinct from v_cur.status or (v_status = 'superseded' and p_superseded_by is distinct from v_cur.superseded_by_id and p_superseded_by is not null) then
    if v_cur.status in ('superseded', 'reversed') then
      raise exception 'a % decision is closed: record a new decision instead', v_cur.status
        using errcode = 'check_violation', hint = 'decision_closed';
    end if;
    if v_status = 'superseded' then
      if p_superseded_by is null then
        raise exception 'say which decision supersedes this one' using errcode = 'invalid_parameter_value';
      end if;
      if p_superseded_by = v_cur.id then
        raise exception 'a decision cannot supersede itself' using errcode = 'invalid_parameter_value';
      end if;
      if v_note is null then
        raise exception 'a note is required to supersede a decision' using errcode = 'invalid_parameter_value';
      end if;
      select d.* into v_target from hq.decisions d where d.id = p_superseded_by and d.deleted_at is null;
      if not found then
        raise exception 'the superseding decision was not found' using errcode = 'no_data_found';
      end if;
      if v_target.status in ('superseded', 'reversed') then
        raise exception 'the superseding decision is itself %; choose the decision that is in force', v_target.status
          using errcode = 'check_violation', hint = 'decision_target_closed';
      end if;
      v_new.status := 'superseded';
      v_new.superseded_by_id := v_target.id;
      v_action := 'supersede';
    elsif v_status = 'reversed' then
      if v_note is null then
        raise exception 'a note is required to reverse a decision' using errcode = 'invalid_parameter_value';
      end if;
      v_new.status := 'reversed';
      v_new.reversed_note := v_note;
      v_action := 'reverse';
    else
      v_new.status := v_status;
      v_action := 'status_change';
    end if;
  end if;

  -- what changed (field -> {from, to}), in a fixed order
  if v_new.title is distinct from v_cur.title then
    v_changes := v_changes || jsonb_build_object('title', jsonb_build_object('from', v_cur.title, 'to', v_new.title));
    v_parts := v_parts || 'the wording'::text;
  end if;
  if v_new.description is distinct from v_cur.description then
    v_changes := v_changes || jsonb_build_object('description', jsonb_build_object('from', v_cur.description, 'to', v_new.description));
    v_parts := v_parts || 'the details'::text;
  end if;
  if v_new.rationale is distinct from v_cur.rationale then
    v_changes := v_changes || jsonb_build_object('rationale', jsonb_build_object('from', v_cur.rationale, 'to', v_new.rationale));
    v_parts := v_parts || 'the reasons'::text;
  end if;
  if v_new.category is distinct from v_cur.category then
    v_changes := v_changes || jsonb_build_object('category', jsonb_build_object('from', v_cur.category, 'to', v_new.category));
    v_parts := v_parts || 'the category'::text;
  end if;
  if v_new.decision_date is distinct from v_cur.decision_date then
    v_changes := v_changes || jsonb_build_object('decision_date', jsonb_build_object('from', v_cur.decision_date, 'to', v_new.decision_date));
    v_parts := v_parts || 'the decision date'::text;
  end if;
  if v_new.decision_maker_id is distinct from v_cur.decision_maker_id then
    v_changes := v_changes || jsonb_build_object('decision_maker_id', jsonb_build_object('from', v_cur.decision_maker_id, 'to', v_new.decision_maker_id));
    v_parts := v_parts || 'the decision maker'::text;
  end if;
  if v_new.status is distinct from v_cur.status then
    v_changes := v_changes || jsonb_build_object('status', jsonb_build_object('from', v_cur.status, 'to', v_new.status));
  end if;
  if v_new.superseded_by_id is distinct from v_cur.superseded_by_id then
    v_changes := v_changes || jsonb_build_object('superseded_by_id', jsonb_build_object('from', v_cur.superseded_by_id, 'to', v_new.superseded_by_id),
      'superseded_by', jsonb_build_object('from', null, 'to', hq_private.decision_ref(v_target.ref_number)));
  end if;

  if v_changes = '{}'::jsonb then
    return hq_private.decision_json(v_cur) || jsonb_build_object('changed', false);
  end if;
  if v_new.status = v_cur.status then
    v_action := 'update';
  end if;

  perform hq_private.audit_context(case when v_action = 'update' then null else v_action end, left(v_note, 200));
  update hq.decisions set
    title = v_new.title, description = v_new.description, rationale = v_new.rationale, category = v_new.category,
    decision_date = v_new.decision_date, decision_maker_id = v_new.decision_maker_id, status = v_new.status,
    superseded_by_id = v_new.superseded_by_id, reversed_note = v_new.reversed_note
  where id = v_cur.id
  returning * into v_new;
  perform hq_private.audit_context();

  v_summary := case v_action
    when 'supersede' then 'Superseded by ' || hq_private.decision_ref(v_target.ref_number)
    when 'reverse' then 'Reversed'
    when 'status_change' then 'Status changed from ' || hq_private.decision_status_label(v_cur.status) || ' to ' || hq_private.decision_status_label(v_new.status)
    else null end;
  if cardinality(v_parts) > 0 then
    v_summary := concat_ws('; ', v_summary, 'Changed ' || array_to_string(v_parts, ', '));
  end if;
  perform hq_private.decision_history_write(v_cur.id, v_action, v_summary, v_changes, v_note);
  if v_action = 'supersede' then
    perform hq_private.decision_history_write(v_target.id, 'supersedes',
      'Supersedes ' || hq_private.decision_ref(v_cur.ref_number) || ': ' || v_cur.title,
      jsonb_build_object('supersedes_id', jsonb_build_object('to', v_cur.id)), v_note);
  end if;
  return hq_private.decision_json(v_new) || jsonb_build_object('changed', true, 'changed_fields', to_jsonb(array(select jsonb_object_keys(v_changes))));
end $$;
comment on function hq.update_decision(uuid, text, text, text, hq.decision_category, date, hq.decision_status, uuid, uuid, text, timestamptz) is 'decisions.write. Changes one live decision (null leaves a field; an empty description or rationale clears it). Status: proposed, decided and in_effect move freely; reversed needs p_note; superseded needs p_superseded_by (a live decision in force) and p_note; superseded and reversed are closed. Nothing to change: {changed: false}, nothing written. Writes one history row (two when superseding: one on each decision) and an audit event. Returns the decision json plus {changed, changed_fields}.';

-- ------------------------------------------------------------------ supersede_decision
create function hq.supersede_decision(p_decision uuid, p_superseded_by uuid, p_note text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('decisions.write');
  if p_superseded_by is null then
    raise exception 'say which decision supersedes this one' using errcode = 'invalid_parameter_value';
  end if;
  return hq.update_decision(p_decision, p_status => 'superseded', p_superseded_by => p_superseded_by, p_note => p_note);
end $$;
comment on function hq.supersede_decision(uuid, uuid, text) is 'decisions.write. Marks p_decision superseded by p_superseded_by (a live decision in force, not itself, no loop) with a required note; the same rules and history as update_decision. Already superseded by that decision: {changed: false}.';

-- ------------------------------------------------------------------ link / unlink a task
create function hq.link_decision_task(p_decision uuid, p_task uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_d hq.decisions;
  v_n integer;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('decisions.write');
  select d.* into v_d from hq.decisions d where d.id = p_decision and d.deleted_at is null for update;
  if not found then
    raise exception 'decision not found' using errcode = 'no_data_found';
  end if;
  -- only a task the caller can see; anything else is "not found", never a hint that it exists
  if p_task is null or not hq_private.task_visible_to_caller(p_task) then
    raise exception 'task not found' using errcode = 'no_data_found';
  end if;
  insert into hq.decision_tasks (decision_id, task_id, linked_by) values (v_d.id, p_task, auth.uid())
  on conflict do nothing;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('decision_id', v_d.id, 'task_id', p_task, 'linked', true, 'changed', false);
  end if;
  perform hq_private.decision_history_write(v_d.id, 'link_task', 'Linked a task', jsonb_build_object('task_id', jsonb_build_object('to', p_task)));
  perform hq_private.audit_write('link_task', 'decision', v_d.id,
    'Linked a task to decision: ' || hq_private.decision_ref(v_d.ref_number), jsonb_build_object('task_id', jsonb_build_object('to', p_task)));
  return jsonb_build_object('decision_id', v_d.id, 'task_id', p_task, 'linked', true, 'changed', true);
end $$;
comment on function hq.link_decision_task(uuid, uuid) is 'decisions.write. Links a live decision to a task the caller can see (else P0002 task not found). Already linked: {changed: false}. History and audit. Returns {decision_id, task_id, linked, changed}.';

create function hq.unlink_decision_task(p_decision uuid, p_task uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_d hq.decisions;
  v_n integer;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('decisions.write');
  select d.* into v_d from hq.decisions d where d.id = p_decision and d.deleted_at is null for update;
  if not found then
    raise exception 'decision not found' using errcode = 'no_data_found';
  end if;
  delete from hq.decision_tasks dt where dt.decision_id = v_d.id and dt.task_id = p_task;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    return jsonb_build_object('decision_id', v_d.id, 'task_id', p_task, 'linked', false, 'changed', false);
  end if;
  perform hq_private.decision_history_write(v_d.id, 'unlink_task', 'Unlinked a task', jsonb_build_object('task_id', jsonb_build_object('from', p_task)));
  perform hq_private.audit_write('unlink_task', 'decision', v_d.id,
    'Unlinked a task from decision: ' || hq_private.decision_ref(v_d.ref_number), jsonb_build_object('task_id', jsonb_build_object('from', p_task)));
  return jsonb_build_object('decision_id', v_d.id, 'task_id', p_task, 'linked', false, 'changed', true);
end $$;
comment on function hq.unlink_decision_task(uuid, uuid) is 'decisions.write. Removes the link between a live decision and a task. Not linked: {changed: false}. History and audit. Returns {decision_id, task_id, linked, changed}.';

-- ------------------------------------------------------------------ archive_record / restore_record (0117 extended with 'decision')
create or replace function hq.archive_record(p_entity text, p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_table text;
  v_caller uuid := hq_private.require_staff();
  v_deleted timestamptz;
  v_allowed boolean;
  v_needs text;
  v_ref hq.referrals;
  v_n integer;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 200);
begin
  v_table := case p_entity
    when 'organisation' then 'organisations' when 'contact' then 'contacts' when 'referral' then 'referrals'
    when 'task' then 'tasks' when 'opportunity' then 'opportunities' when 'interaction' then 'interactions'
    when 'contractor' then 'contractors' when 'contractor_document' then 'contractor_documents'
    when 'contractor_review' then 'contractor_reviews' when 'decision' then 'decisions' end;
  if v_table is null then
    raise exception 'unknown entity %; expected organisation, contact, referral, task, opportunity, interaction, contractor, contractor_document, contractor_review or decision', p_entity
      using errcode = 'invalid_parameter_value';
  end if;
  if p_entity = 'contractor' then
    v_needs := 'contractors.approve';
    v_allowed := hq_private.has_capability('contractors.approve');
  elsif p_entity = 'contractor_document' then
    v_needs := 'contractors.documents';
    v_allowed := hq_private.has_capability('contractors.documents');
  elsif p_entity = 'contractor_review' then
    v_needs := 'contractors.approve';
    v_allowed := hq_private.has_capability('contractors.approve')
      or (hq_private.has_capability('contractors.write')
          and exists (select 1 from hq.contractor_reviews r where r.id = p_id and r.recorded_by = v_caller));
  elsif p_entity = 'decision' then
    v_needs := 'decisions.write';
    v_allowed := hq_private.has_capability('decisions.write');
  else
    v_needs := 'growth.delete';
    v_allowed := hq_private.has_capability('growth.delete');
    if not v_allowed and p_entity = 'task' and hq_private.has_capability('tasks.write') then
      v_allowed := exists (
        select 1 from hq.tasks t
        where t.id = p_id and (t.assigned_to = v_caller or t.created_by = v_caller or hq_private.has_capability('tasks.read_all')));
    end if;
  end if;
  if not v_allowed then
    raise exception 'permission denied' using errcode = 'insufficient_privilege', detail = 'requires ' || v_needs;
  end if;

  execute format('select deleted_at from hq.%I where id = $1 for update', v_table) into v_deleted using p_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception '% not found', p_entity using errcode = 'no_data_found';
  end if;
  if v_deleted is not null then
    return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', true, 'changed', false);
  end if;

  if p_entity = 'referral' then
    select r.* into v_ref from hq.referrals r where r.id = p_id;
    if v_ref.is_attributed and exists (
      select 1 from hq.referrals r
      where r.opportunity_id = v_ref.opportunity_id and r.id <> v_ref.id and r.direction = 'received' and r.deleted_at is null
    ) then
      raise exception 'this referral is the attributed source; move attribution to another referral first' using errcode = 'check_violation';
    end if;
  end if;

  perform hq_private.audit_context(null, v_reason);
  execute format('update hq.%I set deleted_at = now() where id = $1', v_table) using p_id;
  perform hq_private.audit_context();
  if p_entity = 'decision' then
    perform hq_private.decision_history_write(p_id, 'archive', 'Archived', '{}'::jsonb, v_reason);
  end if;
  return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', true, 'changed', true);
end $$;
comment on function hq.archive_record(text, uuid, text) is 'Soft-deletes organisation, contact, referral, task, opportunity, interaction (growth.delete; a task also by its assignee or creator holding tasks.write), contractor (contractors.approve), contractor_document (contractors.documents), contractor_review (contractors.approve, or its recorder with contractors.write), decision (decisions.write; refused while a live decision is superseded by it; recorded in its history).';

create or replace function hq.restore_record(p_entity text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_table text;
  v_deleted timestamptz;
  v_n integer;
begin
  perform hq_private.require_staff();
  v_table := case p_entity
    when 'organisation' then 'organisations' when 'contact' then 'contacts' when 'referral' then 'referrals'
    when 'task' then 'tasks' when 'opportunity' then 'opportunities' when 'interaction' then 'interactions'
    when 'contractor' then 'contractors' when 'contractor_document' then 'contractor_documents'
    when 'contractor_review' then 'contractor_reviews' when 'decision' then 'decisions' end;
  if v_table is null then
    raise exception 'unknown entity %; expected organisation, contact, referral, task, opportunity, interaction, contractor, contractor_document, contractor_review or decision', p_entity
      using errcode = 'invalid_parameter_value';
  end if;
  perform hq_private.require_capability(case p_entity
    when 'contractor' then 'contractors.approve'
    when 'contractor_document' then 'contractors.documents'
    when 'contractor_review' then 'contractors.approve'
    when 'decision' then 'decisions.write'
    else 'growth.delete' end);
  execute format('select deleted_at from hq.%I where id = $1 for update', v_table) into v_deleted using p_id;
  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception '% not found', p_entity using errcode = 'no_data_found';
  end if;
  if v_deleted is null then
    return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', false, 'changed', false);
  end if;

  perform hq_private.audit_context();
  if p_entity = 'referral' then
    -- take credit back only if the opportunity has no attributed referral now
    update hq.referrals r set
      deleted_at = null,
      is_attributed = (r.direction = 'received' and not exists (
        select 1 from hq.referrals o where o.opportunity_id = r.opportunity_id and o.id <> r.id and o.is_attributed and o.deleted_at is null))
    where r.id = p_id;
  else
    -- a unique name, email, ABN or primary contact that was taken meanwhile fails the restore (23505);
    -- a decision superseded by an archived decision is refused (restore that one first)
    execute format('update hq.%I set deleted_at = null where id = $1', v_table) using p_id;
  end if;
  if p_entity = 'decision' then
    perform hq_private.decision_history_write(p_id, 'restore', 'Restored');
  end if;
  return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', false, 'changed', true);
end $$;
comment on function hq.restore_record(text, uuid) is 'Restores a soft-deleted record: growth.delete for the Phase 1 entities, contractors.approve for contractor and contractor_review, contractors.documents for contractor_document, decisions.write for decision. A restored referral takes attribution back only when the opportunity has none.';

revoke execute on all functions in schema hq_private from public, anon;
revoke execute on all functions in schema hq from public, anon;
