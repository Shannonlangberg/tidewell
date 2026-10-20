-- 0142_hq_projects.sql
-- Projects, milestones and richer tasks (docs/hq-projects.md sections 1 and 2): the TABLES, the task
-- column extensions, guards, the activity trigger, RLS and table privileges. Views, my_focus and
-- overdue_tasks are in 0143; the RPCs (including bulk_create_tasks / bulk_update_tasks) in 0144;
-- function privileges in 0145. Same patterns as decisions (0125), knowledge (0138) and meetings (0140).
--
-- TABLES (schema hq; RLS enabled and forced; the API may only SELECT the new tables; every write to
-- them goes through the security definer RPCs in 0144):
--   projects               one row per project, shown as PRJ-0001 (ref_number). Name 1-200, unique
--                          among live projects (case-insensitive). Soft deletion only (archive_record /
--                          restore_record, entity 'project'). `version` goes up by one with every
--                          recorded change (optimistic concurrency for edits). completed_at follows
--                          status = completed.
--   project_milestones     named stages of a project (unique name per project, case-insensitive), open
--                          or done, ordered by sort_order. completed_at / completed_by follow status.
--   project_links          related records: exactly one of a contact, organisation, contractor or lead
--                          (opportunity) per row; one row per record per project.
--   project_documents      LINKS to documents (https only, at most 500 characters). There is no file
--                          storage in this phase.
--   project_activity       append-only: what happened on a project (who, when, kind, summary, detail).
--   task_dependencies      task_id cannot start until depends_on_task_id is done. No self-dependency,
--                          no cycles (checked in the RPCs and by a deferred constraint trigger). Cross
--                          project allowed. depends_on_open is kept by triggers: true while the
--                          depends-on task is live and not completed/cancelled. A task is BLOCKED while
--                          any of its dependency rows has depends_on_open (so a reader who cannot see
--                          the blocking task still sees, correctly, that the task is blocked).
--   task_checklist_items   up to 50 short items (text 1-300) per task, done or not.
--   task_comments          comments on a task (body 1-4000). The author edits within 60 minutes of
--                          posting; a director (settings.admin) at any time. Never deleted.
--   task_activity          append-only history of a task: written by the RPCs (comments, checklist,
--                          dependencies, completion notes) and by the security definer trigger
--                          task_activity_log on hq.tasks for EVERY insert and update of status,
--                          assignee, due date, priority, project, milestone, parent, title and
--                          archive/restore (so direct table writes are recorded too). Inserts with
--                          source 'bulk' read 'Created in bulk'.
--   idempotency_keys       one stored result per (staff, scope, key) for the bulk RPCs; 48 hours.
--   bulk_usage             one row per bulk call (staff, when, items): the rolling-hour bulk budget.
--
-- TASKS (hq.tasks keeps every column, row, policy and trigger): new columns project_id, milestone_id
-- (must belong to the same project), parent_task_id (ONE level deep, same project, never itself),
-- sort_order, blocked_reason (optional text up to 500). tasks_source_known gains 'project' and 'bulk'.
-- The guard task_structure_guard runs for every writer. For a person's DIRECT write (the existing task
-- form path) it also needs projects.write to put a task in a project or move it between projects, and
-- reads the project, milestone and parent under the person's own RLS (so a parent they cannot see is
-- "not found").
--
-- CAPABILITIES (data, in hq.role_capabilities; an assumption for the owner to confirm):
--   projects.read    director, administrator, senior_property_manager, property_manager,
--                    business_development_manager, virtual_assistant, read_only
--   projects.write   the same without read_only
--   junior_property_manager: none. Tasks inside a project keep the existing task rule (assignee,
--   creator or tasks.read_all), so a private task stays private inside a project.

-- ------------------------------------------------------------------ enums
create type hq.project_status as enum ('planning', 'active', 'on_hold', 'completed', 'cancelled');
create type hq.milestone_status as enum ('open', 'done');

-- ------------------------------------------------------------------ capabilities (an assumption for the owner to confirm)
insert into hq.role_capabilities (role, capability)
select r.role::hq.staff_role, r.capability
from (values
  ('director', 'projects.read'), ('director', 'projects.write'),
  ('administrator', 'projects.read'), ('administrator', 'projects.write'),
  ('senior_property_manager', 'projects.read'), ('senior_property_manager', 'projects.write'),
  ('property_manager', 'projects.read'), ('property_manager', 'projects.write'),
  ('business_development_manager', 'projects.read'), ('business_development_manager', 'projects.write'),
  ('virtual_assistant', 'projects.read'), ('virtual_assistant', 'projects.write'),
  ('read_only', 'projects.read')
) as r(role, capability)
on conflict do nothing;

-- ------------------------------------------------------------------ the bulk budget settings
insert into hq.settings (key, value) values
  ('bulk_calls_per_hour', '6'::jsonb),
  ('bulk_items_per_hour', '300'::jsonb)
on conflict (key) do nothing;

-- settings_guard (0138) with the two bulk budget keys: whole numbers, 1-60 calls and 1-2000 items.
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

-- ------------------------------------------------------------------ projects
create table hq.projects (
  id uuid primary key default gen_random_uuid(),
  ref_number bigint generated always as identity,
  name text not null,
  description text,
  owner_id uuid references hq.staff_profiles (id),
  status hq.project_status not null default 'planning',
  priority hq.task_priority not null default 'normal',
  start_date date,
  target_date date,
  completed_at timestamptz,
  notes text,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  updated_by uuid,
  deleted_at timestamptz,
  deleted_by uuid,
  constraint projects_name_length check (char_length(btrim(name)) between 1 and 200),
  constraint projects_description_length check (description is null or char_length(description) between 1 and 5000),
  constraint projects_notes_length check (notes is null or char_length(notes) between 1 and 50000),
  constraint projects_dates_order check (start_date is null or target_date is null or target_date >= start_date),
  constraint projects_dates_sane check ((start_date is null or start_date between date '2000-01-01' and date '2100-12-31')
                                        and (target_date is null or target_date between date '2000-01-01' and date '2100-12-31')),
  constraint projects_completed_iff_status check ((status = 'completed') = (completed_at is not null)),
  constraint projects_version_positive check (version >= 1),
  constraint projects_deleted_by_needs_deleted_at check (deleted_by is null or deleted_at is not null)
);
comment on table hq.projects is 'Projects, shown as PRJ-0001: name (unique among live), description, owner, status, priority, start and target dates, notes (safe markdown). Milestones, links, documents and activity hang off it; tasks join it through hq.tasks.project_id. Written only by the project RPCs and archive_record / restore_record (entity project). Never deleted.';
comment on column hq.projects.version is 'Goes up by one with every recorded change; update_project refuses an edit made against an older version.';
create unique index projects_ref_number_uq on hq.projects (ref_number);
create unique index projects_name_live_uq on hq.projects (lower(btrim(name))) where deleted_at is null;
create index projects_owner_id_idx on hq.projects (owner_id);
create index projects_status_idx on hq.projects (status) where deleted_at is null;
create index projects_name_trgm_idx on hq.projects using gin (name extensions.gin_trgm_ops);

-- ------------------------------------------------------------------ project_milestones
create table hq.project_milestones (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references hq.projects (id),
  name text not null,
  description text,
  due_date date,
  status hq.milestone_status not null default 'open',
  sort_order integer not null default 0,
  completed_at timestamptz,
  completed_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  constraint project_milestones_name_length check (char_length(btrim(name)) between 1 and 200),
  constraint project_milestones_description_length check (description is null or char_length(description) between 1 and 2000),
  constraint project_milestones_due_sane check (due_date is null or due_date between date '2000-01-01' and date '2100-12-31'),
  constraint project_milestones_done_iff_completed check ((status = 'done') = (completed_at is not null)),
  constraint project_milestones_sort_sane check (sort_order between 0 and 100000)
);
comment on table hq.project_milestones is 'Milestones of a project: unique name per project (case-insensitive), optional due date, open or done, ordered by sort_order. Written only by the milestone RPCs. Never deleted.';
create unique index project_milestones_name_uq on hq.project_milestones (project_id, lower(btrim(name)));
create index project_milestones_project_id_idx on hq.project_milestones (project_id, sort_order);

-- ------------------------------------------------------------------ project_links
create table hq.project_links (
  id bigint generated always as identity primary key,
  project_id uuid not null references hq.projects (id),
  contact_id uuid references hq.contacts (id),
  organisation_id uuid references hq.organisations (id),
  contractor_id uuid references hq.contractors (id),
  opportunity_id uuid references hq.opportunities (id),
  linked_by uuid default auth.uid(),
  linked_at timestamptz not null default now(),
  constraint project_links_exactly_one check (num_nonnulls(contact_id, organisation_id, contractor_id, opportunity_id) = 1)
);
comment on table hq.project_links is 'Records a project relates to: exactly one of a contact, organisation, contractor or lead (opportunity) per row, one row per record per project. Written only by add_project_link / remove_project_link.';
create unique index project_links_contact_uq on hq.project_links (project_id, contact_id) where contact_id is not null;
create unique index project_links_organisation_uq on hq.project_links (project_id, organisation_id) where organisation_id is not null;
create unique index project_links_contractor_uq on hq.project_links (project_id, contractor_id) where contractor_id is not null;
create unique index project_links_opportunity_uq on hq.project_links (project_id, opportunity_id) where opportunity_id is not null;
create index project_links_project_id_idx on hq.project_links (project_id);
create index project_links_contact_id_idx on hq.project_links (contact_id);
create index project_links_organisation_id_idx on hq.project_links (organisation_id);
create index project_links_contractor_id_idx on hq.project_links (contractor_id);
create index project_links_opportunity_id_idx on hq.project_links (opportunity_id);

-- ------------------------------------------------------------------ project_documents (links only)
create table hq.project_documents (
  id bigint generated always as identity primary key,
  project_id uuid not null references hq.projects (id),
  title text not null,
  url text not null,
  added_by uuid default auth.uid(),
  added_at timestamptz not null default now(),
  constraint project_documents_title_length check (char_length(btrim(title)) between 1 and 200),
  constraint project_documents_url_https check (char_length(url) <= 500 and url ~* '^https://[^[:space:]/?#]+[^[:space:]]*$')
);
comment on table hq.project_documents is 'Links to documents for a project (https only, at most 500 characters). No file storage in this phase. At most 50 per project. Written only by add_project_document / remove_project_document.';
create index project_documents_project_id_idx on hq.project_documents (project_id, added_at);

-- ------------------------------------------------------------------ project_activity (append-only)
create table hq.project_activity (
  id bigint generated always as identity primary key,
  project_id uuid not null references hq.projects (id),
  actor_id uuid,
  at timestamptz not null default now(),
  kind text not null,
  summary text not null,
  detail jsonb not null default '{}'::jsonb,
  constraint project_activity_kind_shape check (kind ~ '^[a-z][a-z_]{1,39}$'),
  constraint project_activity_summary_length check (char_length(summary) between 1 and 500),
  constraint project_activity_detail_object check (jsonb_typeof(detail) = 'object')
);
comment on table hq.project_activity is 'Append-only history of a project: who (null = system), when, kind, a plain summary and a small detail object. Written by the project RPCs and the task activity trigger. Readable by anyone who can see the project.';
create index project_activity_project_id_idx on hq.project_activity (project_id, at desc, id desc);

-- ------------------------------------------------------------------ the task column extensions
alter table hq.tasks drop constraint tasks_source_known;
alter table hq.tasks add constraint tasks_source_known check (source in ('manual', 'interaction', 'ai_draft', 'website_enquiry', 'meeting', 'project', 'bulk'));
alter table hq.tasks add column project_id uuid references hq.projects (id);
alter table hq.tasks add column milestone_id uuid references hq.project_milestones (id);
alter table hq.tasks add column parent_task_id uuid references hq.tasks (id);
alter table hq.tasks add column sort_order integer not null default 0;
alter table hq.tasks add column blocked_reason text;
alter table hq.tasks add constraint tasks_milestone_needs_project check (milestone_id is null or project_id is not null);
alter table hq.tasks add constraint tasks_parent_not_self check (parent_task_id is null or parent_task_id <> id);
alter table hq.tasks add constraint tasks_sort_order_sane check (sort_order between 0 and 100000);
alter table hq.tasks add constraint tasks_blocked_reason_length check (blocked_reason is null or char_length(blocked_reason) between 1 and 500);
create index tasks_project_id_idx on hq.tasks (project_id, sort_order) where deleted_at is null;
create index tasks_project_id_all_idx on hq.tasks (project_id);
create index tasks_milestone_id_idx on hq.tasks (milestone_id);
create index tasks_parent_task_id_idx on hq.tasks (parent_task_id);
comment on column hq.tasks.project_id is 'The project this task belongs to (null = none). Moving a task between projects needs projects.write.';
comment on column hq.tasks.milestone_id is 'A milestone of the same project (null = none).';
comment on column hq.tasks.parent_task_id is 'Subtask of this task: one level deep only, same project, never itself.';
comment on column hq.tasks.blocked_reason is 'An optional note on why the task is waiting (free text; "blocked" itself is computed from task_dependencies).';

-- ------------------------------------------------------------------ task_dependencies
create table hq.task_dependencies (
  id bigint generated always as identity primary key,
  task_id uuid not null references hq.tasks (id) on delete cascade,
  depends_on_task_id uuid not null references hq.tasks (id) on delete cascade,
  depends_on_open boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint task_dependencies_not_self check (task_id <> depends_on_task_id)
);
comment on table hq.task_dependencies is 'task_id waits for depends_on_task_id. No self-dependency, no cycles (RPC check plus the deferred constraint trigger task_dependency_cycle). depends_on_open is maintained by triggers (true while the depends-on task is live and not completed or cancelled). A task is blocked while any of its rows has depends_on_open. Written only by the task RPCs.';
create unique index task_dependencies_pair_uq on hq.task_dependencies (task_id, depends_on_task_id);
create index task_dependencies_depends_on_idx on hq.task_dependencies (depends_on_task_id);

-- ------------------------------------------------------------------ task_checklist_items
create table hq.task_checklist_items (
  id bigint generated always as identity primary key,
  task_id uuid not null references hq.tasks (id) on delete cascade,
  text text not null,
  done boolean not null default false,
  sort_order integer not null default 0,
  done_by uuid,
  done_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  constraint task_checklist_items_text_length check (char_length(btrim(text)) between 1 and 300),
  constraint task_checklist_items_done_iff_at check (done = (done_at is not null)),
  constraint task_checklist_items_sort_sane check (sort_order between 0 and 100000)
);
comment on table hq.task_checklist_items is 'A short checklist on a task (at most 50 items, text 1-300). Written only by set_task_checklist and the bulk / project task RPCs.';
create index task_checklist_items_task_id_idx on hq.task_checklist_items (task_id, sort_order);

-- ------------------------------------------------------------------ task_comments
create table hq.task_comments (
  id bigint generated always as identity primary key,
  task_id uuid not null references hq.tasks (id) on delete cascade,
  author_id uuid not null references hq.staff_profiles (id),
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  constraint task_comments_body_length check (char_length(btrim(body)) between 1 and 4000)
);
comment on table hq.task_comments is 'Comments on a task. Edited by the author within 60 minutes of posting, or by a director (settings.admin). Never deleted (except with the task itself, see task_history_guard). Written only by add_task_comment / edit_task_comment.';
create index task_comments_task_id_idx on hq.task_comments (task_id, created_at);
create index task_comments_author_id_idx on hq.task_comments (author_id);

-- ------------------------------------------------------------------ task_activity (append-only)
create table hq.task_activity (
  id bigint generated always as identity primary key,
  task_id uuid not null references hq.tasks (id) on delete cascade,
  actor_id uuid,
  at timestamptz not null default now(),
  kind text not null,
  summary text not null,
  detail jsonb not null default '{}'::jsonb,
  constraint task_activity_kind_shape check (kind ~ '^[a-z][a-z_]{1,39}$'),
  constraint task_activity_summary_length check (char_length(summary) between 1 and 500),
  constraint task_activity_detail_object check (jsonb_typeof(detail) = 'object')
);
comment on table hq.task_activity is 'Append-only history of a task: who (null = system), when, kind (created, updated, status, completed, archived, restored, comment, comment_edited, checklist, dependency_added, dependency_removed), a plain summary and a detail object (field: {from, to}). Written by the task RPCs and the trigger task_activity_log on hq.tasks. Readable only for tasks the reader can see.';
create index task_activity_task_id_idx on hq.task_activity (task_id, at desc, id desc);

-- ------------------------------------------------------------------ idempotency_keys
create table hq.idempotency_keys (
  id bigint generated always as identity primary key,
  staff_id uuid not null references hq.staff_profiles (id),
  key text not null,
  scope text not null,
  request_hash text not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  constraint idempotency_keys_key_length check (char_length(key) between 8 and 80),
  constraint idempotency_keys_scope_known check (scope in ('bulk_create_tasks', 'bulk_update_tasks')),
  constraint idempotency_keys_hash_shape check (request_hash ~ '^[0-9a-f]{64}$')
);
comment on table hq.idempotency_keys is 'The stored result of a bulk call by (staff, scope, key), for 48 hours. A replay of the same request returns it with duplicate true; the same key with a different request is refused. Written only by the bulk RPCs (expired keys purged there). Each person reads only their own.';
create unique index idempotency_keys_uq on hq.idempotency_keys (staff_id, scope, key);
create index idempotency_keys_created_at_idx on hq.idempotency_keys (created_at);

-- ------------------------------------------------------------------ bulk_usage (the bulk budget)
create table hq.bulk_usage (
  id bigint generated always as identity primary key,
  staff_id uuid not null references hq.staff_profiles (id),
  at timestamptz not null default now(),
  calls integer not null,
  items integer not null,
  constraint bulk_usage_calls_sane check (calls between 0 and 60),
  constraint bulk_usage_items_sane check (items between 0 and 2000)
);
comment on table hq.bulk_usage is 'One row per consumed bulk budget (hq.consume_bulk_budget): who, when, calls and items. The rolling hour of these rows is the per-person bulk budget (settings bulk_calls_per_hour, bulk_items_per_hour). Each person reads only their own.';
create index bulk_usage_staff_at_idx on hq.bulk_usage (staff_id, at desc);

-- ------------------------------------------------------------------ guards (every writer, including the table owner)
create function hq_private.project_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  if tg_op = 'UPDATE' then
    if new.ref_number is distinct from old.ref_number then
      raise exception 'a project''s number cannot change' using errcode = 'insufficient_privilege';
    end if;
    if new.version < old.version then
      raise exception 'a project''s version never goes back' using errcode = 'insufficient_privilege';
    end if;
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  else
    new.updated_by := null;
  end if;
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status <> 'completed' or new.completed_at is null then
      new.completed_at := coalesce(case when tg_op = 'UPDATE' and old.status = 'completed' then old.completed_at end, now());
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end $$;

create function hq_private.milestone_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  new.name := btrim(regexp_replace(new.name, '\s+', ' ', 'g'));
  if tg_op = 'UPDATE' then
    if new.project_id is distinct from old.project_id then
      raise exception 'a milestone cannot move to another project' using errcode = 'insufficient_privilege';
    end if;
    if new.id is distinct from old.id then
      raise exception 'the id of a milestone cannot change' using errcode = 'insufficient_privilege';
    end if;
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  if new.status = 'done' then
    if tg_op = 'INSERT' or old.status <> 'done' then
      new.completed_at := now();
      new.completed_by := auth.uid();
    else
      new.completed_at := old.completed_at;
      new.completed_by := old.completed_by;
    end if;
  else
    new.completed_at := null;
    new.completed_by := null;
  end if;
  return new;
end $$;

create function hq_private.project_link_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  raise exception 'a link is added or removed, never changed' using errcode = 'insufficient_privilege';
end $$;

create function hq_private.project_document_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'a document link is added or removed, never changed' using errcode = 'insufficient_privilege';
  end if;
  new.title := btrim(regexp_replace(new.title, '\s+', ' ', 'g'));
  new.url := btrim(new.url);
  if (select count(*) from hq.project_documents d where d.project_id = new.project_id) >= 50 then
    raise exception 'a project can have at most 50 document links' using errcode = 'check_violation', hint = 'project_document_limit';
  end if;
  return new;
end $$;

-- Tasks: the project / milestone / parent rules, for every writer. Security definer (a person's direct
-- write cannot name hq_private helpers itself), so the person checks key on auth.uid(): a signed-in
-- caller (a direct write, or an RPC acting for them) needs projects.write to put a task in a project or
-- move it, and can only make it a subtask of a task they can see (the task rule). A system writer
-- (no auth.uid(): migrations, seed scripts) passes those two checks; the structural rules hold for all.
create function hq_private.task_structure_guard() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_person boolean := auth.uid() is not null;
  v_project_changed boolean := tg_op = 'INSERT' or new.project_id is distinct from old.project_id;
  v_parent hq.tasks;
  v_ms_project uuid;
begin
  new.blocked_reason := nullif(btrim(coalesce(new.blocked_reason, '')), '');
  -- a person's direct write may put a task in a project, or move it, only with projects.write
  if v_project_changed and v_person and (new.project_id is not null or (tg_op = 'UPDATE' and old.project_id is not null))
     and not hq_private.has_capability('projects.write') then
    raise exception 'putting a task in a project needs projects.write' using errcode = 'insufficient_privilege';
  end if;
  if v_project_changed and new.project_id is not null then
    if not exists (select 1 from hq.projects p where p.id = new.project_id and p.deleted_at is null) then
      raise exception 'project not found' using errcode = 'no_data_found';
    end if;
  end if;
  -- a task that moves project leaves its old milestone behind unless a new one is given
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id and new.milestone_id is not distinct from old.milestone_id then
    new.milestone_id := null;
  end if;
  if new.milestone_id is not null and (tg_op = 'INSERT' or new.milestone_id is distinct from old.milestone_id or new.project_id is distinct from old.project_id) then
    select m.project_id into v_ms_project from hq.project_milestones m where m.id = new.milestone_id;
    if not found then
      raise exception 'milestone not found' using errcode = 'no_data_found';
    end if;
    if v_ms_project is distinct from new.project_id then
      raise exception 'that milestone belongs to another project' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if new.parent_task_id is not null and (tg_op = 'INSERT' or new.parent_task_id is distinct from old.parent_task_id or new.project_id is distinct from old.project_id) then
    if new.parent_task_id = new.id then
      raise exception 'a task cannot be its own subtask' using errcode = 'invalid_parameter_value';
    end if;
    select t.* into v_parent from hq.tasks t where t.id = new.parent_task_id and t.deleted_at is null;
    if not found or (v_person and (tg_op = 'INSERT' or new.parent_task_id is distinct from old.parent_task_id)
                     and not hq_private.task_visible_to_caller(new.parent_task_id)) then
      raise exception 'parent task not found' using errcode = 'no_data_found';
    end if;
    if v_parent.parent_task_id is not null then
      raise exception 'subtasks go one level deep: that task is already a subtask' using errcode = 'invalid_parameter_value', hint = 'task_subtask_depth';
    end if;
    if v_parent.project_id is distinct from new.project_id then
      raise exception 'a subtask must be in the same project as its parent' using errcode = 'invalid_parameter_value', hint = 'task_subtask_project';
    end if;
    if tg_op = 'UPDATE' and exists (select 1 from hq.tasks c where c.parent_task_id = new.id and c.deleted_at is null) then
      raise exception 'subtasks go one level deep: this task has subtasks of its own' using errcode = 'invalid_parameter_value', hint = 'task_subtask_depth';
    end if;
  end if;
  -- a parent cannot leave its subtasks in another project
  if tg_op = 'UPDATE' and new.project_id is distinct from old.project_id
     and exists (select 1 from hq.tasks c where c.parent_task_id = new.id and c.deleted_at is null and c.project_id is distinct from new.project_id) then
    raise exception 'this task has subtasks: move them with it (subtasks stay in their parent''s project)' using errcode = 'invalid_parameter_value', hint = 'task_subtask_project';
  end if;
  return new;
end $$;
create trigger task_structure_guard before insert or update on hq.tasks for each row execute function hq_private.task_structure_guard();

-- depends_on_open on insert (every writer)
create function hq_private.task_dependency_stamp() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
begin
  if tg_op = 'UPDATE' and (new.task_id, new.depends_on_task_id, new.created_by, new.created_at) is distinct from (old.task_id, old.depends_on_task_id, old.created_by, old.created_at) then
    raise exception 'a dependency is added or removed, never changed' using errcode = 'insufficient_privilege';
  end if;
  new.depends_on_open := exists (select 1 from hq.tasks t where t.id = new.depends_on_task_id and t.deleted_at is null and t.status not in ('completed', 'cancelled'));
  return new;
end $$;
create trigger task_dependency_stamp before insert or update on hq.task_dependencies for each row execute function hq_private.task_dependency_stamp();

-- No cycles: checked at commit (deferred), so a batch that adds edges in any order is judged whole.
create function hq_private.task_dependency_cycle() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
begin
  if exists (select 1 from hq.task_dependencies d where d.id = new.id) and exists (
    with recursive reach(t) as (
      select d.depends_on_task_id from hq.task_dependencies d where d.task_id = new.depends_on_task_id
      union
      select d.depends_on_task_id from hq.task_dependencies d join reach r on d.task_id = r.t
    )
    select 1 from reach where t = new.task_id
  ) or new.depends_on_task_id = new.task_id then
    raise exception 'that dependency would make a cycle (a task would end up waiting for itself)' using errcode = 'check_violation', hint = 'task_dependency_cycle';
  end if;
  return null;
end $$;
create constraint trigger task_dependency_cycle after insert on hq.task_dependencies
  deferrable initially deferred for each row execute function hq_private.task_dependency_cycle();

-- Keep depends_on_open in step when a task's status or archive state changes.
create function hq_private.task_dependency_refresh() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_open boolean := new.deleted_at is null and new.status not in ('completed', 'cancelled');
begin
  update hq.task_dependencies d set depends_on_open = v_open
  where d.depends_on_task_id = new.id and d.depends_on_open is distinct from v_open;
  return null;
end $$;
create trigger task_dependency_refresh after update of status, deleted_at on hq.tasks
  for each row when (old.status is distinct from new.status or old.deleted_at is distinct from new.deleted_at)
  execute function hq_private.task_dependency_refresh();

create function hq_private.checklist_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  new.text := btrim(regexp_replace(new.text, '\s+', ' ', 'g'));
  if tg_op = 'INSERT' then
    if (select count(*) from hq.task_checklist_items c where c.task_id = new.task_id) >= 50 then
      raise exception 'a checklist has at most 50 items' using errcode = 'check_violation', hint = 'task_checklist_limit';
    end if;
  else
    if new.task_id is distinct from old.task_id then
      raise exception 'a checklist item cannot move to another task' using errcode = 'insufficient_privilege';
    end if;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  if new.done then
    if tg_op = 'INSERT' or not old.done then
      new.done_at := now();
      new.done_by := auth.uid();
    else
      new.done_at := old.done_at;
      new.done_by := old.done_by;
    end if;
  else
    new.done_at := null;
    new.done_by := null;
  end if;
  return new;
end $$;

create function hq_private.task_comment_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  new.body := btrim(regexp_replace(new.body, E'\r\n?', E'\n', 'g'));
  if tg_op = 'UPDATE' then
    if (new.task_id, new.author_id, new.created_at) is distinct from (old.task_id, old.author_id, old.created_at) then
      raise exception 'only a comment''s text can change' using errcode = 'insufficient_privilege';
    end if;
    if new.body is distinct from old.body then
      new.edited_at := now();
    else
      new.edited_at := old.edited_at;
    end if;
  else
    new.edited_at := null;
  end if;
  return new;
end $$;

-- The task activity trigger: one row for every insert, and one for every update that changes status,
-- assignee, due date, priority, project, milestone, parent, title or the archive state, whoever writes
-- (an RPC or a person's direct table write). Project activity: a task created in, moved into or out of,
-- or completed in a project (bulk calls write ONE project row instead, setting hq.project_activity_quiet).
create function hq_private.task_activity_log() returns trigger
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_actor uuid := auth.uid();
  v_detail jsonb := '{}'::jsonb;
  v_parts text[] := '{}';
  v_kind text := 'updated';
  v_quiet boolean := coalesce(current_setting('hq.project_activity_quiet', true), '') = 'on';
  v_name_from text;
  v_name_to text;
begin
  if tg_op = 'INSERT' then
    insert into hq.task_activity (task_id, actor_id, kind, summary, detail)
    values (new.id, v_actor, 'created', case when new.source = 'bulk' then 'Created in bulk' else 'Created' end,
            jsonb_build_object('source', new.source, 'title', left(new.title, 200)));
    if new.project_id is not null and not v_quiet then
      insert into hq.project_activity (project_id, actor_id, kind, summary, detail)
      values (new.project_id, v_actor, 'task_created', left('Task added: ' || new.title, 500), jsonb_build_object('task_id', new.id));
    end if;
    return null;
  end if;

  if new.status is distinct from old.status then
    v_detail := v_detail || jsonb_build_object('status', jsonb_build_object('from', old.status, 'to', new.status));
    v_parts := v_parts || ('status ' || replace(old.status::text, '_', ' ') || ' to ' || replace(new.status::text, '_', ' '));
    v_kind := case when new.status = 'completed' then 'completed' else 'status' end;
  end if;
  if new.assigned_to is distinct from old.assigned_to then
    select sp.full_name into v_name_from from hq.staff_profiles sp where sp.id = old.assigned_to;
    select sp.full_name into v_name_to from hq.staff_profiles sp where sp.id = new.assigned_to;
    v_detail := v_detail || jsonb_build_object('assigned_to', jsonb_build_object('from', old.assigned_to, 'to', new.assigned_to));
    v_parts := v_parts || ('assigned to ' || coalesce(v_name_to, 'nobody'));
  end if;
  if new.due_date is distinct from old.due_date then
    v_detail := v_detail || jsonb_build_object('due_date', jsonb_build_object('from', old.due_date, 'to', new.due_date));
    v_parts := v_parts || ('due date ' || coalesce(to_char(new.due_date, 'YYYY-MM-DD'), 'cleared'));
  end if;
  if new.priority is distinct from old.priority then
    v_detail := v_detail || jsonb_build_object('priority', jsonb_build_object('from', old.priority, 'to', new.priority));
    v_parts := v_parts || ('priority ' || new.priority::text);
  end if;
  if new.project_id is distinct from old.project_id then
    v_detail := v_detail || jsonb_build_object('project_id', jsonb_build_object('from', old.project_id, 'to', new.project_id));
    v_parts := v_parts || case when new.project_id is null then 'removed from its project' else 'moved to a project' end;
  end if;
  if new.milestone_id is distinct from old.milestone_id then
    v_detail := v_detail || jsonb_build_object('milestone_id', jsonb_build_object('from', old.milestone_id, 'to', new.milestone_id));
    v_parts := v_parts || case when new.milestone_id is null then 'milestone cleared' else 'milestone set' end;
  end if;
  if new.parent_task_id is distinct from old.parent_task_id then
    v_detail := v_detail || jsonb_build_object('parent_task_id', jsonb_build_object('from', old.parent_task_id, 'to', new.parent_task_id));
    v_parts := v_parts || case when new.parent_task_id is null then 'no longer a subtask' else 'made a subtask' end;
  end if;
  if new.title is distinct from old.title then
    v_detail := v_detail || jsonb_build_object('title', jsonb_build_object('from', left(old.title, 200), 'to', left(new.title, 200)));
    v_parts := v_parts || 'title changed'::text;
  end if;
  if new.deleted_at is distinct from old.deleted_at then
    v_detail := v_detail || jsonb_build_object('archived', jsonb_build_object('from', old.deleted_at is not null, 'to', new.deleted_at is not null));
    v_parts := v_parts || case when new.deleted_at is null then 'restored' else 'archived' end;
    v_kind := case when new.deleted_at is null then 'restored' else 'archived' end;
  end if;
  if v_detail = '{}'::jsonb then
    return null;
  end if;
  insert into hq.task_activity (task_id, actor_id, kind, summary, detail)
  values (new.id, v_actor, v_kind, left(upper(left(array_to_string(v_parts, ', '), 1)) || substr(array_to_string(v_parts, ', '), 2), 500), v_detail);

  if not v_quiet then
    if new.project_id is distinct from old.project_id then
      if old.project_id is not null and exists (select 1 from hq.projects p where p.id = old.project_id) then
        insert into hq.project_activity (project_id, actor_id, kind, summary, detail)
        values (old.project_id, v_actor, 'task_moved_out', left('Task moved out: ' || new.title, 500), jsonb_build_object('task_id', new.id));
      end if;
      if new.project_id is not null then
        insert into hq.project_activity (project_id, actor_id, kind, summary, detail)
        values (new.project_id, v_actor, 'task_moved_in', left('Task moved in: ' || new.title, 500), jsonb_build_object('task_id', new.id));
      end if;
    elsif new.project_id is not null and new.status = 'completed' and old.status <> 'completed' then
      insert into hq.project_activity (project_id, actor_id, kind, summary, detail)
      values (new.project_id, v_actor, 'task_completed', left('Task completed: ' || new.title, 500), jsonb_build_object('task_id', new.id));
    end if;
  end if;
  return null;
end $$;
create trigger task_activity_log after insert or update on hq.tasks for each row execute function hq_private.task_activity_log();

-- Task history (activity, comments) is never changed or deleted, by anyone. The one exception is the
-- cascade when the table OWNER hard-deletes a task (no API role holds delete on hq.tasks): the task's
-- dependencies, checklist, comments and activity go with it (the FKs are on delete cascade).
create function hq_private.task_history_guard() returns trigger
language plpgsql set search_path = pg_catalog, public, extensions as $$
begin
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 and not exists (select 1 from hq.tasks t where t.id = old.task_id) then
    return old; -- the task itself is being deleted (foreign key cascade)
  end if;
  raise exception '% is append-only', tg_table_name using errcode = 'insufficient_privilege';
end $$;

create trigger row_stamp before insert or update on hq.projects for each row execute function hq_private.row_stamp();
create trigger soft_delete_guard before insert or update on hq.projects for each row execute function hq_private.soft_delete_guard();
create trigger project_guard before insert or update on hq.projects for each row execute function hq_private.project_guard();
create trigger no_delete before delete on hq.projects for each row execute function hq_private.raise_immutable();
create trigger no_truncate before truncate on hq.projects for each statement execute function hq_private.raise_immutable();
create trigger audit after insert or update or delete on hq.projects for each row execute function hq_private.audit_row('project');

create trigger milestone_guard before insert or update on hq.project_milestones for each row execute function hq_private.milestone_guard();
create trigger no_delete before delete on hq.project_milestones for each row execute function hq_private.raise_immutable();
create trigger no_truncate before truncate on hq.project_milestones for each statement execute function hq_private.raise_immutable();
create trigger audit after insert or update or delete on hq.project_milestones for each row execute function hq_private.audit_row('project_milestone');

create trigger project_link_guard before update on hq.project_links for each row execute function hq_private.project_link_guard();
create trigger no_truncate before truncate on hq.project_links for each statement execute function hq_private.raise_immutable();

create trigger project_document_guard before insert or update on hq.project_documents for each row execute function hq_private.project_document_guard();
create trigger no_truncate before truncate on hq.project_documents for each statement execute function hq_private.raise_immutable();

create trigger append_only before update or delete on hq.project_activity for each row execute function hq_private.raise_immutable();
create trigger append_only_truncate before truncate on hq.project_activity for each statement execute function hq_private.raise_immutable();

create trigger no_truncate before truncate on hq.task_dependencies for each statement execute function hq_private.raise_immutable();

create trigger checklist_guard before insert or update on hq.task_checklist_items for each row execute function hq_private.checklist_guard();
create trigger no_truncate before truncate on hq.task_checklist_items for each statement execute function hq_private.raise_immutable();

create trigger task_comment_guard before insert or update on hq.task_comments for each row execute function hq_private.task_comment_guard();
create trigger no_delete before delete on hq.task_comments for each row execute function hq_private.task_history_guard();
create trigger no_truncate before truncate on hq.task_comments for each statement execute function hq_private.raise_immutable();

create trigger append_only before update or delete on hq.task_activity for each row execute function hq_private.task_history_guard();
create trigger append_only_truncate before truncate on hq.task_activity for each statement execute function hq_private.raise_immutable();

create trigger no_truncate before truncate on hq.idempotency_keys for each statement execute function hq_private.raise_immutable();
create trigger append_only before update on hq.idempotency_keys for each row execute function hq_private.raise_immutable();
create trigger append_only before update or delete on hq.bulk_usage for each row execute function hq_private.raise_immutable();
create trigger append_only_truncate before truncate on hq.bulk_usage for each statement execute function hq_private.raise_immutable();

-- ------------------------------------------------------------------ access
alter table hq.projects enable row level security;             alter table hq.projects force row level security;
alter table hq.project_milestones enable row level security;   alter table hq.project_milestones force row level security;
alter table hq.project_links enable row level security;        alter table hq.project_links force row level security;
alter table hq.project_documents enable row level security;    alter table hq.project_documents force row level security;
alter table hq.project_activity enable row level security;     alter table hq.project_activity force row level security;
alter table hq.task_dependencies enable row level security;    alter table hq.task_dependencies force row level security;
alter table hq.task_checklist_items enable row level security; alter table hq.task_checklist_items force row level security;
alter table hq.task_comments enable row level security;        alter table hq.task_comments force row level security;
alter table hq.task_activity enable row level security;        alter table hq.task_activity force row level security;
alter table hq.idempotency_keys enable row level security;     alter table hq.idempotency_keys force row level security;
alter table hq.bulk_usage enable row level security;           alter table hq.bulk_usage force row level security;

-- Everyone with projects.read sees live projects; archived ones only projects.write holders (who can restore them).
create policy projects_select on hq.projects for select to authenticated
  using ((select hq_private.has_capability('projects.read'))
         and (deleted_at is null or (select hq_private.has_capability('projects.write'))));
-- Milestones, links, documents and activity of a project the reader can see (the subquery runs under the reader's RLS).
create policy project_milestones_select on hq.project_milestones for select to authenticated
  using ((select hq_private.has_capability('projects.read')) and exists (select 1 from hq.projects p where p.id = project_id));
create policy project_links_select on hq.project_links for select to authenticated
  using ((select hq_private.has_capability('projects.read')) and exists (select 1 from hq.projects p where p.id = project_id));
create policy project_documents_select on hq.project_documents for select to authenticated
  using ((select hq_private.has_capability('projects.read')) and exists (select 1 from hq.projects p where p.id = project_id));
create policy project_activity_select on hq.project_activity for select to authenticated
  using ((select hq_private.has_capability('projects.read')) and exists (select 1 from hq.projects p where p.id = project_id));
-- Dependencies, checklists, comments and activity of a task the reader can see (tasks RLS in the subquery).
create policy task_dependencies_select on hq.task_dependencies for select to authenticated
  using ((select hq_private.staff_session()) and exists (select 1 from hq.tasks t where t.id = task_id));
create policy task_checklist_items_select on hq.task_checklist_items for select to authenticated
  using ((select hq_private.staff_session()) and exists (select 1 from hq.tasks t where t.id = task_id));
create policy task_comments_select on hq.task_comments for select to authenticated
  using ((select hq_private.staff_session()) and exists (select 1 from hq.tasks t where t.id = task_id));
create policy task_activity_select on hq.task_activity for select to authenticated
  using ((select hq_private.staff_session()) and exists (select 1 from hq.tasks t where t.id = task_id));
-- Your own idempotency keys and bulk usage.
create policy idempotency_keys_select on hq.idempotency_keys for select to authenticated
  using ((select hq_private.staff_session()) and staff_id = (select auth.uid()));
create policy bulk_usage_select on hq.bulk_usage for select to authenticated
  using ((select hq_private.staff_session()) and staff_id = (select auth.uid()));

revoke all on hq.projects, hq.project_milestones, hq.project_links, hq.project_documents, hq.project_activity,
  hq.task_dependencies, hq.task_checklist_items, hq.task_comments, hq.task_activity, hq.idempotency_keys, hq.bulk_usage
  from public, anon, authenticated, service_role;
grant select on hq.projects, hq.project_milestones, hq.project_links, hq.project_documents, hq.project_activity,
  hq.task_dependencies, hq.task_checklist_items, hq.task_comments, hq.task_activity, hq.idempotency_keys, hq.bulk_usage
  to authenticated, service_role;

revoke execute on all functions in schema hq_private from public, anon;
