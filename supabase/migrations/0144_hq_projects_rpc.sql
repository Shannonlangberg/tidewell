-- 0144_hq_projects_rpc.sql
-- Projects, milestones, richer tasks and the bulk task RPCs (docs/hq-projects.md section 2). Tables in
-- 0142, views and the focus functions in 0143, function privileges in 0145.
--
-- Every RPC here is security definer, pins search_path, checks the caller INSIDE (live staff row and an
-- MFA-satisfying session through require_staff / has_capability; never a JWT claim), is audited
-- (the row audit triggers, plus one hq_private.audit_write event per bulk call) and is executable by
-- authenticated only (0145).
--
-- WHO MAY DO WHAT
--   projects (create, update, status, links, documents, milestones)    projects.write
--   create_project_task                                                 tasks.write (+ projects.write when the task is in a project)
--   update_project_task, complete_task, set_task_checklist,             tasks.write and the task-update rule: the task is live and
--   add/remove_task_dependency                                          the caller is its assignee, its creator, or holds tasks.read_all
--                                                                       (anything else is "task not found")
--   moving a task into, out of or between projects, or setting its milestone: + projects.write
--   giving a task to someone else (not the caller): the caller created it or holds tasks.read_all (the
--   existing assignment rule); a new task may be assigned to any active member of staff
--   a dependency's other task, a parent task: must be visible to the caller (the task rule)
--   add_task_comment: tasks.write and the task visible; edit_task_comment: the author within 60
--   minutes (with tasks.write), or a director (settings.admin) at any time
--   bulk_create_tasks / bulk_update_tasks: tasks.write (+ projects.write when any entry, or the batch,
--   names a project), the bulk budget, then per entry exactly the single-task rules above
--
-- ERRORS: 42501 permission denied (detail 'requires <capability>'); 22023 invalid argument (plain
-- message); P0002 not found; 23505 already exists (hint project_name_taken | milestone_name_taken);
-- 23514 refused by a rule (hint project_stale | milestone_open_tasks | task_dependency_cycle |
-- task_subtask_depth ...); 54000 bulk budget used up (hint bulk_rate_limited).
--
-- BULK (bulk_create_tasks, bulk_update_tasks): 1 to 50 entries (0 or more than 50 refused, 22023, hint
-- bulk_size); ONE transaction; every entry runs in its own savepoint. p_atomic = false (default): valid
-- entries are written, invalid ones are returned in `failed` with index, ref (create) / id (update) and
-- errors[]; an entry that depends on, or is a subtask of, a failed entry fails with "depends on <ref>,
-- which failed" / "its parent <ref> failed". p_atomic = true: if any entry fails, nothing is written
-- (rolled_back = true, created / updated empty, failed lists the entries that failed). Entries can refer
-- to each other by `ref` (parent_ref, depends_on) in any order; a cycle inside the batch fails the
-- entries on it. Idempotency: (caller, scope, key) stores the result for 48 hours; the same key and the
-- same request (sha-256 of the canonical JSON of the arguments) returns the stored result with
-- duplicate = true and writes nothing (and uses no budget); the same key with a different request is
-- refused (22023, hint idempotency_key_reused). Budget: hq.consume_bulk_budget(1, number of entries)
-- before any entry is written: at most bulk_calls_per_hour calls (default 6) and bulk_items_per_hour
-- entries (default 300) per person per rolling hour (54000, hint bulk_rate_limited); an atomic batch
-- that rolls back still used its budget. Every created task has source 'bulk' and the activity row
-- 'Created in bulk'; ONE project activity row per project per call; ONE audit event per call
-- (action bulk_create | bulk_update, entity task_batch) besides the per-row task audit. The single
-- MCP request row (hq.ai_requests) for the call is written by the MCP server, not here.

-- ------------------------------------------------------------------ helpers (not granted to any API role: 0145)
create function hq_private.project_ref(p_n bigint) returns text
language sql immutable parallel safe set search_path = pg_catalog as $$
  select 'PRJ-' || lpad(p_n::text, greatest(4, length(p_n::text)), '0')
$$;

create function hq_private.project_json(p_p hq.projects) returns jsonb
language sql stable set search_path = pg_catalog, public, extensions as $$
  select jsonb_build_object(
    'project_id', p_p.id, 'ref', hq_private.project_ref(p_p.ref_number), 'ref_number', p_p.ref_number,
    'name', p_p.name, 'status', p_p.status, 'priority', p_p.priority, 'owner_id', p_p.owner_id,
    'start_date', p_p.start_date, 'target_date', p_p.target_date, 'completed_at', p_p.completed_at,
    'version', p_p.version, 'updated_at', p_p.updated_at)
$$;

create function hq_private.milestone_json(p_m hq.project_milestones) returns jsonb
language sql stable set search_path = pg_catalog, public, extensions as $$
  select jsonb_build_object(
    'milestone_id', p_m.id, 'project_id', p_m.project_id, 'name', p_m.name, 'description', p_m.description,
    'due_date', p_m.due_date, 'status', p_m.status, 'sort_order', p_m.sort_order, 'completed_at', p_m.completed_at)
$$;

create function hq_private.task_json(p_t hq.tasks) returns jsonb
language sql stable set search_path = pg_catalog, public, extensions as $$
  select jsonb_build_object(
    'task_id', p_t.id, 'title', p_t.title, 'status', p_t.status, 'priority', p_t.priority, 'due_date', p_t.due_date,
    'assigned_to', p_t.assigned_to, 'project_id', p_t.project_id, 'milestone_id', p_t.milestone_id,
    'parent_task_id', p_t.parent_task_id, 'sort_order', p_t.sort_order, 'source', p_t.source, 'updated_at', p_t.updated_at)
$$;

create function hq_private.project_activity_write(p_project uuid, p_kind text, p_summary text, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = pg_catalog, public, extensions as $$
  insert into hq.project_activity (project_id, actor_id, kind, summary, detail)
  values (p_project, auth.uid(), p_kind, left(p_summary, 500), coalesce(p_detail, '{}'::jsonb))
$$;

create function hq_private.task_activity_write(p_task uuid, p_kind text, p_summary text, p_detail jsonb default '{}'::jsonb) returns void
language sql security definer set search_path = pg_catalog, public, extensions as $$
  insert into hq.task_activity (task_id, actor_id, kind, summary, detail)
  values (p_task, auth.uid(), p_kind, left(p_summary, 500), coalesce(p_detail, '{}'::jsonb))
$$;

-- The project locked for a change, if live; anything else is "not found".
create function hq_private.project_lock(p_id uuid) returns hq.projects
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_p hq.projects;
begin
  select * into v_p from hq.projects p where p.id = p_id and p.deleted_at is null for update;
  if not found then
    raise exception 'project not found' using errcode = 'no_data_found';
  end if;
  return v_p;
end $$;

create function hq_private.milestone_lock(p_id uuid) returns hq.project_milestones
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_m hq.project_milestones;
begin
  select m.* into v_m from hq.project_milestones m join hq.projects p on p.id = m.project_id and p.deleted_at is null
  where m.id = p_id for update of m;
  if not found then
    raise exception 'milestone not found' using errcode = 'no_data_found';
  end if;
  return v_m;
end $$;

-- The task-update rule (tasks_update, restated for a security definer RPC).
create function hq_private.task_updatable(p_t hq.tasks) returns boolean
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select p_t.id is not null and p_t.deleted_at is null and hq_private.has_capability('tasks.write')
     and (p_t.assigned_to = auth.uid() or p_t.created_by = auth.uid() or hq_private.has_capability('tasks.read_all'))
$$;

-- The task locked for a change, if the caller may update it; anything else is "task not found".
create function hq_private.task_lock(p_id uuid) returns hq.tasks
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_t hq.tasks;
begin
  if p_id is null then
    raise exception 'say which task' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_t from hq.tasks t where t.id = p_id and t.deleted_at is null for update;
  if not found or not hq_private.task_updatable(v_t) then
    raise exception 'task not found' using errcode = 'no_data_found';
  end if;
  return v_t;
end $$;

create function hq_private.task_priority_from(p_value text) returns hq.task_priority
language plpgsql immutable set search_path = pg_catalog, public, extensions as $$
declare
  v text := lower(nullif(btrim(coalesce(p_value, '')), ''));
begin
  if v is null then return 'normal'; end if;
  if v not in ('low', 'normal', 'high', 'urgent') then
    raise exception 'priority is low, normal, high or urgent' using errcode = 'invalid_parameter_value';
  end if;
  return v::hq.task_priority;
end $$;

create function hq_private.task_status_from(p_value text) returns hq.task_status
language plpgsql immutable set search_path = pg_catalog, public, extensions as $$
declare
  v text := lower(replace(nullif(btrim(coalesce(p_value, '')), ''), ' ', '_'));
begin
  if v is null then return 'to_do'; end if;
  if v not in ('to_do', 'in_progress', 'waiting', 'completed', 'cancelled') then
    raise exception 'status is to_do, in_progress, waiting, completed or cancelled' using errcode = 'invalid_parameter_value';
  end if;
  return v::hq.task_status;
end $$;

-- A task due date: from 2000 up to five years ahead (null passes).
create function hq_private.task_due_check(p_due date) returns date
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
begin
  if p_due is not null and (p_due < date '2000-01-01' or p_due > hq.today() + 1826) then
    raise exception 'a due date must be within the next five years' using errcode = 'invalid_parameter_value';
  end if;
  return p_due;
end $$;

create function hq_private.task_sort_from(p_value text) returns integer
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v text := nullif(btrim(coalesce(p_value, '')), '');
begin
  if v is null then return null; end if;
  if v !~ '^[0-9]{1,6}$' or v::integer > 100000 then
    raise exception 'sort_order is a whole number from 0 to 100000' using errcode = 'invalid_parameter_value';
  end if;
  return v::integer;
end $$;

-- A JSON value that may be one string or a list of strings, as text[] (null = empty).
create function hq_private.json_strings(p_value jsonb, p_what text) returns text[]
language plpgsql immutable set search_path = pg_catalog as $$
begin
  if p_value is null or jsonb_typeof(p_value) = 'null' then return '{}'; end if;
  if jsonb_typeof(p_value) = 'string' then return array[p_value #>> '{}']; end if;
  if jsonb_typeof(p_value) <> 'array' or exists (select 1 from jsonb_array_elements(p_value) e where jsonb_typeof(e) <> 'string') then
    raise exception '% must be a list of text', p_what using errcode = 'invalid_parameter_value';
  end if;
  return array(select e #>> '{}' from jsonb_array_elements(p_value) e);
end $$;

-- A related record a task may point at: live and readable by the caller; anything else "not found".
create function hq_private.task_link_check(p_kind text, p_id uuid) returns void
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_ok boolean := false;
begin
  if p_id is null then return; end if;
  if p_kind = 'contact' and hq_private.has_capability('growth.read') then
    v_ok := exists (select 1 from hq.contacts c where c.id = p_id and c.deleted_at is null);
  elsif p_kind = 'organisation' and hq_private.has_capability('growth.read') then
    v_ok := exists (select 1 from hq.organisations o where o.id = p_id and o.deleted_at is null);
  elsif p_kind = 'opportunity' and hq_private.has_capability('growth.read') then
    v_ok := exists (select 1 from hq.opportunities o where o.id = p_id and o.deleted_at is null);
  elsif p_kind = 'contractor' and hq_private.has_capability('contractors.read') then
    v_ok := exists (select 1 from hq.contractors c where c.id = p_id and c.deleted_at is null);
  end if;
  if not v_ok then
    raise exception 'linked % not found', p_kind using errcode = 'no_data_found';
  end if;
end $$;

-- Adds "p_task waits for p_dep". The caller may update p_task (checked by the caller of this helper) and
-- must see p_dep. No self-dependency, no cycle, at most 50 per task. Returns true when added.
create function hq_private.task_dependency_add(p_task uuid, p_dep uuid) returns boolean
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_title text;
  v_id bigint;
begin
  if p_dep is null then
    raise exception 'say which task it depends on' using errcode = 'invalid_parameter_value';
  end if;
  if p_dep = p_task then
    raise exception 'a task cannot depend on itself' using errcode = 'invalid_parameter_value', hint = 'task_dependency_self';
  end if;
  if not hq_private.task_visible_to_caller(p_dep) then
    raise exception 'the task it depends on was not found' using errcode = 'no_data_found';
  end if;
  select t.title into v_title from hq.tasks t where t.id = p_dep;
  if exists (
    with recursive reach(t) as (
      select d.depends_on_task_id from hq.task_dependencies d where d.task_id = p_dep
      union
      select d.depends_on_task_id from hq.task_dependencies d join reach r on d.task_id = r.t
    )
    select 1 from reach where t = p_task
  ) then
    raise exception 'that would make a cycle: "%" already waits for this task', left(v_title, 120)
      using errcode = 'check_violation', hint = 'task_dependency_cycle';
  end if;
  if (select count(*) from hq.task_dependencies d where d.task_id = p_task) >= 50 then
    raise exception 'a task can wait for at most 50 others' using errcode = 'check_violation', hint = 'task_dependency_limit';
  end if;
  insert into hq.task_dependencies (task_id, depends_on_task_id) values (p_task, p_dep)
  on conflict do nothing returning id into v_id;
  if v_id is null then
    return false;
  end if;
  perform hq_private.task_activity_write(p_task, 'dependency_added', left('Waits for: ' || v_title, 500), jsonb_build_object('depends_on_task_id', p_dep));
  return true;
end $$;

-- Replaces a task's checklist. p_items: [text | {"text": text, "done": bool, "id": existing item id}]
-- (at most 50). Items with an id keep their done stamp; items not listed are removed. Returns
-- {total, done, changed}.
create function hq_private.task_checklist_apply(p_task uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_items jsonb := coalesce(p_items, '[]'::jsonb);
  e jsonb;
  i integer := 0;
  v_text text;
  v_done boolean;
  v_id bigint;
  v_keep bigint[] := '{}';
  v_before jsonb;
  v_after jsonb;
begin
  if jsonb_typeof(v_items) <> 'array' then
    raise exception 'a checklist must be a list' using errcode = 'invalid_parameter_value';
  end if;
  if jsonb_array_length(v_items) > 50 then
    raise exception 'a checklist has at most 50 items' using errcode = 'invalid_parameter_value', hint = 'task_checklist_limit';
  end if;
  select coalesce(jsonb_agg(jsonb_build_array(c.id, c.text, c.done, c.sort_order) order by c.id), '[]'::jsonb) into v_before
  from hq.task_checklist_items c where c.task_id = p_task;
  -- validate everything first
  for e in select x from jsonb_array_elements(v_items) x loop
    if jsonb_typeof(e) = 'string' then
      v_text := e #>> '{}';
    elsif jsonb_typeof(e) = 'object' then
      v_text := e ->> 'text';
      if e ? 'done' and jsonb_typeof(e -> 'done') not in ('boolean', 'null') then
        raise exception 'a checklist item''s done is true or false' using errcode = 'invalid_parameter_value';
      end if;
      if e ? 'id' and jsonb_typeof(e -> 'id') not in ('number', 'null') then
        raise exception 'a checklist item''s id is a number' using errcode = 'invalid_parameter_value';
      end if;
    else
      raise exception 'each checklist item is text or {text, done}' using errcode = 'invalid_parameter_value';
    end if;
    v_text := hq_private.knowledge_line(v_text, 300, 'a checklist item');
    if v_text is null then
      raise exception 'a checklist item needs text' using errcode = 'invalid_parameter_value';
    end if;
  end loop;
  -- ids that stay
  select coalesce(array_agg((x ->> 'id')::bigint), '{}') into v_keep
  from jsonb_array_elements(v_items) x where jsonb_typeof(x) = 'object' and jsonb_typeof(x -> 'id') = 'number';
  delete from hq.task_checklist_items c where c.task_id = p_task and not (c.id = any (v_keep));
  for e in select x from jsonb_array_elements(v_items) x loop
    v_text := hq_private.knowledge_line(case when jsonb_typeof(e) = 'string' then e #>> '{}' else e ->> 'text' end, 300, 'a checklist item');
    v_done := case when jsonb_typeof(e) = 'object' then coalesce((e ->> 'done')::boolean, false) else false end;
    v_id := case when jsonb_typeof(e) = 'object' and jsonb_typeof(e -> 'id') = 'number' then (e ->> 'id')::bigint end;
    if v_id is not null then
      update hq.task_checklist_items c set text = v_text, done = case when e ? 'done' then v_done else c.done end, sort_order = i
      where c.id = v_id and c.task_id = p_task;
      if not found then
        raise exception 'checklist item % is not on this task', v_id using errcode = 'no_data_found';
      end if;
    else
      insert into hq.task_checklist_items (task_id, text, done, sort_order) values (p_task, v_text, v_done, i);
    end if;
    i := i + 1;
  end loop;
  select coalesce(jsonb_agg(jsonb_build_array(c.id, c.text, c.done, c.sort_order) order by c.id), '[]'::jsonb) into v_after
  from hq.task_checklist_items c where c.task_id = p_task;
  return jsonb_build_object(
    'total', (select count(*) from hq.task_checklist_items c where c.task_id = p_task),
    'done', (select count(*) from hq.task_checklist_items c where c.task_id = p_task and c.done),
    'changed', v_before is distinct from v_after);
end $$;

-- Shape checks for one bulk / single task entry, collected (never raises). p_mode create | update.
create function hq_private.task_entry_errors(p_e jsonb, p_mode text) returns text[]
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_err text[] := '{}';
  v_allowed text[];
  v_key text;
  v_t text;
  v_list text[];
  v_x text;
begin
  if p_e is null or jsonb_typeof(p_e) <> 'object' then
    return array['each entry must be an object'];
  end if;
  v_allowed := case when p_mode = 'create' then
      array['ref', 'title', 'description', 'assignee', 'priority', 'status', 'due_date', 'project', 'milestone', 'parent_ref', 'parent',
            'depends_on', 'checklist', 'linked_contact', 'linked_organisation', 'linked_contractor', 'linked_opportunity', 'sort_order', 'blocked_reason']
    else
      array['id', 'title', 'description', 'assignee', 'priority', 'status', 'due_date', 'project', 'milestone', 'parent',
            'add_dependency', 'remove_dependency', 'complete', 'checklist', 'comment', 'sort_order', 'blocked_reason'] end;
  for v_key in select k from jsonb_object_keys(p_e) k loop
    if not v_key = any (v_allowed) then
      v_err := v_err || format('unknown field "%s"', left(v_key, 40));
    end if;
  end loop;
  for v_key in select k from unnest(array['ref', 'title', 'description', 'assignee', 'priority', 'status', 'due_date', 'project', 'milestone',
                                         'parent_ref', 'parent', 'linked_contact', 'linked_organisation', 'linked_contractor', 'linked_opportunity',
                                         'blocked_reason', 'id', 'comment']) k loop
    if p_e ? v_key and jsonb_typeof(p_e -> v_key) not in ('string', 'null') then
      v_err := v_err || format('%s must be text', v_key);
    end if;
  end loop;
  if v_err <> '{}' then return v_err; end if;

  if p_mode = 'create' then
    if p_e ? 'ref' and (char_length(btrim(coalesce(p_e ->> 'ref', ''))) not between 1 and 80) then
      v_err := v_err || 'ref is 1 to 80 characters'::text;
    end if;
    begin
      if hq_private.knowledge_line(p_e ->> 'title', 200, 'a title') is null then
        v_err := v_err || 'a task needs a title'::text;
      end if;
    exception when others then v_err := v_err || sqlerrm; end;
  else
    begin
      if hq_private.meeting_uuid(p_e ->> 'id', 'the task id') is null then
        v_err := v_err || 'say which task (id)'::text;
      end if;
    exception when others then v_err := v_err || sqlerrm; end;
    if p_e ? 'title' then
      begin
        if hq_private.knowledge_line(p_e ->> 'title', 200, 'a title') is null then
          v_err := v_err || 'a task needs a title'::text;
        end if;
      exception when others then v_err := v_err || sqlerrm; end;
    end if;
    if p_e ? 'complete' and jsonb_typeof(p_e -> 'complete') not in ('boolean', 'null') then
      v_err := v_err || 'complete is true or false'::text;
    end if;
    if p_e ? 'status' and jsonb_typeof(p_e -> 'status') = 'null' then
      v_err := v_err || 'status cannot be cleared'::text;
    end if;
    if p_e ? 'priority' and jsonb_typeof(p_e -> 'priority') = 'null' then
      v_err := v_err || 'priority cannot be cleared'::text;
    end if;
    begin perform hq_private.meeting_text(p_e ->> 'comment', 4000, 'a comment'); exception when others then v_err := v_err || sqlerrm; end;
  end if;
  begin perform hq_private.meeting_text(p_e ->> 'description', 4000, 'the description'); exception when others then v_err := v_err || sqlerrm; end;
  begin perform hq_private.knowledge_line(p_e ->> 'blocked_reason', 500, 'blocked_reason'); exception when others then v_err := v_err || sqlerrm; end;
  begin perform hq_private.task_priority_from(p_e ->> 'priority'); exception when others then v_err := v_err || sqlerrm; end;
  begin perform hq_private.task_status_from(p_e ->> 'status'); exception when others then v_err := v_err || sqlerrm; end;
  begin perform hq_private.task_due_check(hq_private.meeting_date(p_e ->> 'due_date', 'due_date')); exception when others then v_err := v_err || sqlerrm; end;
  begin perform hq_private.task_sort_from(p_e ->> 'sort_order'); exception when others then v_err := v_err || sqlerrm; end;
  foreach v_key in array array['assignee', 'project', 'linked_contact', 'linked_organisation', 'linked_contractor', 'linked_opportunity'] loop
    begin perform hq_private.meeting_uuid(p_e ->> v_key, v_key); exception when others then v_err := v_err || sqlerrm; end;
  end loop;
  if p_mode = 'update' then
    begin perform hq_private.meeting_uuid(p_e ->> 'parent', 'parent'); exception when others then v_err := v_err || sqlerrm; end;
    foreach v_key in array array['add_dependency', 'remove_dependency'] loop
      begin
        v_list := hq_private.json_strings(p_e -> v_key, v_key);
        foreach v_x in array v_list loop
          perform hq_private.meeting_uuid(v_x, v_key);
        end loop;
      exception when others then v_err := v_err || sqlerrm; end;
    end loop;
  else
    begin
      v_list := hq_private.json_strings(p_e -> 'depends_on', 'depends_on');
      if cardinality(v_list) > 50 then
        v_err := v_err || 'depends_on lists at most 50 tasks'::text;
      end if;
    exception when others then v_err := v_err || sqlerrm; end;
  end if;
  if p_e ? 'checklist' and jsonb_typeof(p_e -> 'checklist') <> 'null' then
    if jsonb_typeof(p_e -> 'checklist') <> 'array' then
      v_err := v_err || 'checklist must be a list'::text;
    elsif jsonb_array_length(p_e -> 'checklist') > 50 then
      v_err := v_err || 'a checklist has at most 50 items'::text;
    else
      for v_t in select case when jsonb_typeof(x) = 'string' then x #>> '{}' when jsonb_typeof(x) = 'object' then x ->> 'text' end from jsonb_array_elements(p_e -> 'checklist') x loop
        begin
          if hq_private.knowledge_line(v_t, 300, 'a checklist item') is null then
            v_err := v_err || 'a checklist item needs text'::text;
          end if;
        exception when others then v_err := v_err || sqlerrm; end;
      end loop;
    end if;
  end if;
  return v_err;
end $$;

-- Creates ONE task from an entry (the create shape above), through hq.tasks so its triggers, RLS rules,
-- audit and activity apply. p_refs maps batch refs to created task ids (bulk); p_default_project is the
-- batch project. Raises (22023 / P0002 / 42501 / 23514) on the first problem. Returns the task id.
create function hq_private.task_create_core(p_e jsonb, p_default_project uuid, p_source text, p_refs jsonb default '{}'::jsonb) returns uuid
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := auth.uid();
  v_errors text[] := hq_private.task_entry_errors(p_e, 'create');
  v_refs jsonb := coalesce(p_refs, '{}'::jsonb);
  v_title text;
  v_desc text;
  v_assignee uuid;
  v_priority hq.task_priority;
  v_status hq.task_status;
  v_due date;
  v_project uuid;
  v_parent uuid;
  v_parent_row hq.tasks;
  v_ms uuid;
  v_ms_text text := nullif(btrim(coalesce(p_e ->> 'milestone', '')), '');
  v_ref text;
  v_sort integer;
  v_id uuid;
  v_dep text;
  v_dep_id uuid;
begin
  if cardinality(v_errors) > 0 then
    raise exception '%', array_to_string(v_errors, '; ') using errcode = 'invalid_parameter_value';
  end if;
  v_title := hq_private.knowledge_line(p_e ->> 'title', 200, 'a title');
  v_desc := hq_private.meeting_text(p_e ->> 'description', 4000, 'the description');
  v_assignee := coalesce(hq_private.meeting_uuid(p_e ->> 'assignee', 'assignee'), v_caller);
  v_priority := hq_private.task_priority_from(p_e ->> 'priority');
  v_status := hq_private.task_status_from(p_e ->> 'status');
  v_due := hq_private.task_due_check(hq_private.meeting_date(p_e ->> 'due_date', 'due_date'));
  v_project := hq_private.meeting_uuid(p_e ->> 'project', 'project');
  perform hq_private.require_active_staff(v_assignee, 'the person a task is assigned to');

  -- parent: a batch ref, or an existing task the caller can see
  v_ref := nullif(btrim(coalesce(p_e ->> 'parent_ref', p_e ->> 'parent', '')), '');
  if v_ref is not null then
    if v_refs ? v_ref then
      v_parent := (v_refs ->> v_ref)::uuid;
    elsif v_ref ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_parent := v_ref::uuid;
    else
      raise exception 'parent "%" is not a task in this batch or an existing task id', left(v_ref, 80) using errcode = 'invalid_parameter_value';
    end if;
    if not hq_private.task_visible_to_caller(v_parent) then
      raise exception 'parent task not found' using errcode = 'no_data_found';
    end if;
    select * into v_parent_row from hq.tasks t where t.id = v_parent;
  end if;

  v_project := coalesce(v_project, p_default_project, v_parent_row.project_id);
  if v_project is not null then
    perform hq_private.require_capability('projects.write');
    if not exists (select 1 from hq.projects p where p.id = v_project and p.deleted_at is null) then
      raise exception 'project not found' using errcode = 'no_data_found';
    end if;
  end if;

  if v_ms_text is not null then
    if v_project is null then
      raise exception 'a milestone needs a project' using errcode = 'invalid_parameter_value';
    end if;
    if v_ms_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      select m.id into v_ms from hq.project_milestones m where m.id = v_ms_text::uuid and m.project_id = v_project;
    else
      select m.id into v_ms from hq.project_milestones m where m.project_id = v_project and lower(btrim(m.name)) = lower(btrim(regexp_replace(v_ms_text, '\s+', ' ', 'g')));
    end if;
    if v_ms is null then
      raise exception 'there is no milestone "%" in this project', left(v_ms_text, 80) using errcode = 'no_data_found';
    end if;
  end if;

  perform hq_private.task_link_check('contact', hq_private.meeting_uuid(p_e ->> 'linked_contact', 'linked_contact'));
  perform hq_private.task_link_check('organisation', hq_private.meeting_uuid(p_e ->> 'linked_organisation', 'linked_organisation'));
  perform hq_private.task_link_check('contractor', hq_private.meeting_uuid(p_e ->> 'linked_contractor', 'linked_contractor'));
  perform hq_private.task_link_check('opportunity', hq_private.meeting_uuid(p_e ->> 'linked_opportunity', 'linked_opportunity'));

  v_sort := hq_private.task_sort_from(p_e ->> 'sort_order');
  if v_sort is null then
    v_sort := case when v_project is null then 0 else least(coalesce((
      select max(t.sort_order) + 1 from hq.tasks t where t.project_id = v_project and t.deleted_at is null), 0), 100000) end;
  end if;

  insert into hq.tasks (title, description, assigned_to, due_date, priority, status, source, project_id, milestone_id, parent_task_id, sort_order,
                        blocked_reason, related_contact_id, related_organisation_id, related_contractor_id, related_opportunity_id)
  values (v_title, v_desc, v_assignee, v_due, v_priority, v_status, p_source, v_project, v_ms, v_parent, v_sort,
          hq_private.knowledge_line(p_e ->> 'blocked_reason', 500, 'blocked_reason'),
          hq_private.meeting_uuid(p_e ->> 'linked_contact', 'linked_contact'), hq_private.meeting_uuid(p_e ->> 'linked_organisation', 'linked_organisation'),
          hq_private.meeting_uuid(p_e ->> 'linked_contractor', 'linked_contractor'), hq_private.meeting_uuid(p_e ->> 'linked_opportunity', 'linked_opportunity'))
  returning id into v_id;

  if p_e ? 'checklist' and jsonb_typeof(p_e -> 'checklist') = 'array' and jsonb_array_length(p_e -> 'checklist') > 0 then
    perform hq_private.task_checklist_apply(v_id, p_e -> 'checklist');
  end if;

  foreach v_dep in array hq_private.json_strings(p_e -> 'depends_on', 'depends_on') loop
    v_dep := btrim(v_dep);
    if v_refs ? v_dep then
      v_dep_id := (v_refs ->> v_dep)::uuid;
    elsif v_dep ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      v_dep_id := v_dep::uuid;
    else
      raise exception 'depends_on "%" is not a task in this batch or an existing task id', left(v_dep, 80) using errcode = 'invalid_parameter_value';
    end if;
    perform hq_private.task_dependency_add(v_id, v_dep_id);
  end loop;
  return v_id;
end $$;

-- Changes ONE task from an entry (the update shape above): only the fields present change; a field
-- present with JSON null is cleared (assignee, due_date, project, milestone, parent, description,
-- blocked_reason). Same rules as a single update. Returns {id, changed: [field names]}.
create function hq_private.task_update_core(p_e jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := auth.uid();
  v_errors text[] := hq_private.task_entry_errors(p_e, 'update');
  v_cur hq.tasks;
  v_new hq.tasks;
  v_changed text[] := '{}';
  v_ms_text text;
  v_ms uuid;
  v_dep text;
  v_comment text;
  v_n integer;
  v_cl jsonb;
begin
  if cardinality(v_errors) > 0 then
    raise exception '%', array_to_string(v_errors, '; ') using errcode = 'invalid_parameter_value';
  end if;
  v_cur := hq_private.task_lock(hq_private.meeting_uuid(p_e ->> 'id', 'the task id'));
  v_new := v_cur;
  if p_e ? 'title' then v_new.title := hq_private.knowledge_line(p_e ->> 'title', 200, 'a title'); end if;
  if p_e ? 'description' then v_new.description := hq_private.meeting_text(p_e ->> 'description', 4000, 'the description'); end if;
  if p_e ? 'priority' then v_new.priority := hq_private.task_priority_from(p_e ->> 'priority'); end if;
  if p_e ? 'status' then v_new.status := hq_private.task_status_from(p_e ->> 'status'); end if;
  if coalesce((p_e ->> 'complete')::boolean, false) then v_new.status := 'completed'; end if;
  if p_e ? 'due_date' then v_new.due_date := hq_private.task_due_check(hq_private.meeting_date(p_e ->> 'due_date', 'due_date')); end if;
  if p_e ? 'blocked_reason' then v_new.blocked_reason := hq_private.knowledge_line(p_e ->> 'blocked_reason', 500, 'blocked_reason'); end if;
  if p_e ? 'sort_order' then v_new.sort_order := coalesce(hq_private.task_sort_from(p_e ->> 'sort_order'), 0); end if;
  if p_e ? 'assignee' then
    v_new.assigned_to := hq_private.meeting_uuid(p_e ->> 'assignee', 'assignee');
    if v_new.assigned_to is distinct from v_cur.assigned_to then
      perform hq_private.require_active_staff(v_new.assigned_to, 'the person a task is assigned to');
      if v_new.assigned_to is distinct from v_caller and not (v_cur.created_by = v_caller or hq_private.has_capability('tasks.read_all')) then
        raise exception 'only the person who created this task, or someone who can see everyone''s tasks, can give it to someone else'
          using errcode = 'insufficient_privilege', hint = 'task_assign_rule';
      end if;
    end if;
  end if;
  if p_e ? 'project' then
    v_new.project_id := hq_private.meeting_uuid(p_e ->> 'project', 'project');
    if v_new.project_id is distinct from v_cur.project_id then
      perform hq_private.require_capability('projects.write');
      if v_new.project_id is not null and not exists (select 1 from hq.projects p where p.id = v_new.project_id and p.deleted_at is null) then
        raise exception 'project not found' using errcode = 'no_data_found';
      end if;
      if not p_e ? 'milestone' then v_new.milestone_id := null; end if;
    end if;
  end if;
  if p_e ? 'milestone' then
    v_ms_text := nullif(btrim(coalesce(p_e ->> 'milestone', '')), '');
    v_ms := null;
    if v_ms_text is not null then
      if v_new.project_id is null then
        raise exception 'a milestone needs a project' using errcode = 'invalid_parameter_value';
      end if;
      if v_ms_text ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        select m.id into v_ms from hq.project_milestones m where m.id = v_ms_text::uuid and m.project_id = v_new.project_id;
      else
        select m.id into v_ms from hq.project_milestones m where m.project_id = v_new.project_id and lower(btrim(m.name)) = lower(btrim(regexp_replace(v_ms_text, '\s+', ' ', 'g')));
      end if;
      if v_ms is null then
        raise exception 'there is no milestone "%" in this project', left(v_ms_text, 80) using errcode = 'no_data_found';
      end if;
    end if;
    if v_ms is distinct from v_cur.milestone_id then
      perform hq_private.require_capability('projects.write');
    end if;
    v_new.milestone_id := v_ms;
  end if;
  if p_e ? 'parent' then
    v_new.parent_task_id := hq_private.meeting_uuid(p_e ->> 'parent', 'parent');
    if v_new.parent_task_id is not null and v_new.parent_task_id is distinct from v_cur.parent_task_id
       and not hq_private.task_visible_to_caller(v_new.parent_task_id) then
      raise exception 'parent task not found' using errcode = 'no_data_found';
    end if;
  end if;
  if v_new.title is null then
    raise exception 'a task needs a title' using errcode = 'invalid_parameter_value';
  end if;

  if v_new.title is distinct from v_cur.title then v_changed := v_changed || 'title'::text; end if;
  if v_new.description is distinct from v_cur.description then v_changed := v_changed || 'description'::text; end if;
  if v_new.priority is distinct from v_cur.priority then v_changed := v_changed || 'priority'::text; end if;
  if v_new.status is distinct from v_cur.status then v_changed := v_changed || 'status'::text; end if;
  if v_new.due_date is distinct from v_cur.due_date then v_changed := v_changed || 'due_date'::text; end if;
  if v_new.assigned_to is distinct from v_cur.assigned_to then v_changed := v_changed || 'assignee'::text; end if;
  if v_new.project_id is distinct from v_cur.project_id then v_changed := v_changed || 'project'::text; end if;
  if v_new.milestone_id is distinct from v_cur.milestone_id then v_changed := v_changed || 'milestone'::text; end if;
  if v_new.parent_task_id is distinct from v_cur.parent_task_id then v_changed := v_changed || 'parent'::text; end if;
  if v_new.sort_order is distinct from v_cur.sort_order then v_changed := v_changed || 'sort_order'::text; end if;
  if v_new.blocked_reason is distinct from v_cur.blocked_reason then v_changed := v_changed || 'blocked_reason'::text; end if;

  if cardinality(v_changed) > 0 then
    update hq.tasks set
      title = v_new.title, description = v_new.description, priority = v_new.priority, status = v_new.status, due_date = v_new.due_date,
      assigned_to = v_new.assigned_to, project_id = v_new.project_id, milestone_id = v_new.milestone_id, parent_task_id = v_new.parent_task_id,
      sort_order = v_new.sort_order, blocked_reason = v_new.blocked_reason
    where id = v_cur.id;
  end if;

  foreach v_dep in array hq_private.json_strings(p_e -> 'add_dependency', 'add_dependency') loop
    if hq_private.task_dependency_add(v_cur.id, hq_private.meeting_uuid(v_dep, 'add_dependency')) then
      v_changed := v_changed || 'add_dependency'::text;
    end if;
  end loop;
  foreach v_dep in array hq_private.json_strings(p_e -> 'remove_dependency', 'remove_dependency') loop
    delete from hq.task_dependencies d where d.task_id = v_cur.id and d.depends_on_task_id = hq_private.meeting_uuid(v_dep, 'remove_dependency');
    get diagnostics v_n = row_count;
    if v_n > 0 then
      perform hq_private.task_activity_write(v_cur.id, 'dependency_removed', 'No longer waits for another task', jsonb_build_object('depends_on_task_id', v_dep));
      v_changed := v_changed || 'remove_dependency'::text;
    end if;
  end loop;
  if p_e ? 'checklist' and jsonb_typeof(p_e -> 'checklist') <> 'null' then
    v_cl := hq_private.task_checklist_apply(v_cur.id, p_e -> 'checklist');
    if (v_cl ->> 'changed')::boolean then
      perform hq_private.task_activity_write(v_cur.id, 'checklist', format('Checklist updated (%s of %s done)', v_cl ->> 'done', v_cl ->> 'total'), v_cl);
      v_changed := v_changed || 'checklist'::text;
    end if;
  end if;
  v_comment := hq_private.meeting_text(p_e ->> 'comment', 4000, 'a comment');
  if v_comment is not null then
    insert into hq.task_comments (task_id, author_id, body) values (v_cur.id, v_caller, v_comment);
    perform hq_private.task_activity_write(v_cur.id, 'comment', 'Comment added', '{}'::jsonb);
    v_changed := v_changed || 'comment'::text;
  end if;
  return jsonb_build_object('id', v_cur.id, 'changed', to_jsonb(v_changed));
end $$;

-- ------------------------------------------------------------------ the bulk budget
create function hq_private.bulk_limits() returns jsonb
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select jsonb_build_object('calls_per_hour', hq_private.setting_int('bulk_calls_per_hour', 6), 'items_per_hour', hq_private.setting_int('bulk_items_per_hour', 300))
$$;

create function hq_private.bulk_used(p_staff uuid) returns jsonb
language sql stable security definer set search_path = pg_catalog, public, extensions as $$
  select jsonb_build_object('calls', coalesce(sum(u.calls), 0), 'items', coalesce(sum(u.items), 0))
  from hq.bulk_usage u where u.staff_id = p_staff and u.at > now() - interval '1 hour'
$$;

-- {calls_per_hour, items_per_hour, calls_used, items_used, calls_remaining, items_remaining} for the caller.
create function hq.bulk_budget() returns jsonb
language plpgsql stable security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_staff uuid := hq_private.require_staff();
  v_l jsonb := hq_private.bulk_limits();
  v_u jsonb := hq_private.bulk_used(v_staff);
begin
  return jsonb_build_object(
    'calls_per_hour', (v_l ->> 'calls_per_hour')::integer, 'items_per_hour', (v_l ->> 'items_per_hour')::integer,
    'calls_used', (v_u ->> 'calls')::integer, 'items_used', (v_u ->> 'items')::integer,
    'calls_remaining', greatest((v_l ->> 'calls_per_hour')::integer - (v_u ->> 'calls')::integer, 0),
    'items_remaining', greatest((v_l ->> 'items_per_hour')::integer - (v_u ->> 'items')::integer, 0));
end $$;
comment on function hq.bulk_budget() is 'Active staff. The caller''s bulk budget in the rolling hour: {calls_per_hour, items_per_hour, calls_used, items_used, calls_remaining, items_remaining}.';

-- Uses p_calls calls and p_items items of the caller's rolling-hour bulk budget, or refuses (54000,
-- hint bulk_rate_limited) and uses nothing. A per-person advisory lock makes the limit exact under
-- concurrent calls. Returns hq.bulk_budget() after the use.
create function hq.consume_bulk_budget(p_calls integer, p_items integer) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_staff uuid := hq_private.require_staff();
  v_l jsonb;
  v_u jsonb;
  v_calls integer := coalesce(p_calls, 0);
  v_items integer := coalesce(p_items, 0);
begin
  if v_calls not between 0 and 60 or v_items not between 0 and 2000 or (v_calls = 0 and v_items = 0) then
    raise exception 'calls are 0 to 60 and items 0 to 2000 (not both 0)' using errcode = 'invalid_parameter_value';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('hq.bulk_usage:' || v_staff::text, 0));
  v_l := hq_private.bulk_limits();
  v_u := hq_private.bulk_used(v_staff);
  if (v_u ->> 'calls')::integer + v_calls > (v_l ->> 'calls_per_hour')::integer then
    raise exception 'bulk limit reached: at most % bulk calls per hour; try again later', v_l ->> 'calls_per_hour'
      using errcode = 'program_limit_exceeded', hint = 'bulk_rate_limited',
            detail = format('%s of %s calls used in the last hour', v_u ->> 'calls', v_l ->> 'calls_per_hour');
  end if;
  if (v_u ->> 'items')::integer + v_items > (v_l ->> 'items_per_hour')::integer then
    raise exception 'bulk limit reached: at most % tasks per hour through bulk calls (% used); try again later or send fewer', v_l ->> 'items_per_hour', v_u ->> 'items'
      using errcode = 'program_limit_exceeded', hint = 'bulk_rate_limited',
            detail = format('%s of %s items used in the last hour', v_u ->> 'items', v_l ->> 'items_per_hour');
  end if;
  insert into hq.bulk_usage (staff_id, calls, items) values (v_staff, v_calls, v_items);
  return hq.bulk_budget();
end $$;
comment on function hq.consume_bulk_budget(integer, integer) is 'Active staff. Uses calls and items of the caller''s rolling-hour bulk budget (settings bulk_calls_per_hour default 6, bulk_items_per_hour default 300) or raises 54000 (hint bulk_rate_limited) and uses nothing. Returns the budget after the use.';

-- Idempotency: the stored result for (caller, scope, key) or null; refuses the same key with a different request.
create function hq_private.idempotency_check(p_staff uuid, p_scope text, p_key text, p_hash text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_prev hq.idempotency_keys;
begin
  perform pg_advisory_xact_lock(hashtextextended('hq.idempotency:' || p_staff::text || ':' || p_scope || ':' || p_key, 0));
  delete from hq.idempotency_keys k where k.staff_id = p_staff and k.created_at < now() - interval '48 hours';
  select * into v_prev from hq.idempotency_keys k where k.staff_id = p_staff and k.scope = p_scope and k.key = p_key;
  if not found then
    return null;
  end if;
  if v_prev.request_hash <> p_hash then
    raise exception 'that idempotency key was already used for a different request: use a new key for a new plan'
      using errcode = 'invalid_parameter_value', hint = 'idempotency_key_reused';
  end if;
  return v_prev.result || jsonb_build_object('duplicate', true);
end $$;

create function hq_private.idempotency_key_check(p_key text) returns text
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v text := btrim(coalesce(p_key, ''));
begin
  if char_length(v) not between 8 and 80 or v ~ '[[:cntrl:]]' then
    raise exception 'an idempotency key is 8 to 80 characters (a fresh UUID per plan is ideal)' using errcode = 'invalid_parameter_value', hint = 'idempotency_key_shape';
  end if;
  return v;
end $$;

create function hq_private.bulk_list(p_value jsonb, p_what text) returns integer
language plpgsql immutable set search_path = pg_catalog as $$
declare
  v_n integer;
begin
  if p_value is null or jsonb_typeof(p_value) <> 'array' then
    raise exception '% must be a list', p_what using errcode = 'invalid_parameter_value', hint = 'bulk_size';
  end if;
  v_n := jsonb_array_length(p_value);
  if v_n = 0 then
    raise exception 'give at least one entry in %', p_what using errcode = 'invalid_parameter_value', hint = 'bulk_size';
  end if;
  if v_n > 50 then
    raise exception 'at most 50 entries in one call (% given): split the plan into calls of 50 or fewer', v_n using errcode = 'invalid_parameter_value', hint = 'bulk_size';
  end if;
  return v_n;
end $$;

-- ------------------------------------------------------------------ bulk_create_tasks
-- p_tasks: [{ref, title, description, assignee, priority, status, due_date, project, milestone (id or
-- name in the project), parent_ref (a batch ref or an existing task id), depends_on ([batch refs or
-- existing task ids]), checklist ([text]), linked_contact, linked_organisation, linked_contractor,
-- linked_opportunity, sort_order, blocked_reason}] (1-50; title required; ref unique in the batch).
-- p_project: the default project of every entry. See the header for the full semantics.
create function hq.bulk_create_tasks(p_tasks jsonb, p_idempotency_key text, p_project uuid default null, p_atomic boolean default false) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_key text;
  v_n integer;
  v_atomic boolean := coalesce(p_atomic, false);
  v_hash text;
  v_prev jsonb;
  v_refs text[] := '{}';          -- ref of entry i (1-based), never null ('#i' when not given)
  v_given text[] := '{}';         -- the ref the caller gave, or null
  v_state text[] := '{}';         -- pending | created | failed
  v_ids uuid[] := '{}';
  v_errs jsonb[] := '{}';
  v_deps jsonb := '[]'::jsonb;    -- entry i -> [{"i": j, "parent": bool}] batch references
  v_refmap jsonb := '{}'::jsonb;  -- ref -> created id
  v_refidx jsonb := '{}'::jsonb;  -- ref -> entry index
  e jsonb;
  d jsonb;
  i integer;
  j integer;
  v_ref text;
  v_x text;
  v_list jsonb;
  v_progress boolean;
  v_wait boolean;
  v_fail text;
  v_id uuid;
  v_errors text[];
  v_frontier integer[];
  v_seen integer[];
  v_cycle boolean;
  v_created jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
  v_rolled boolean := false;
  v_result jsonb;
  v_projects uuid[];
  v_pid uuid;
  v_count integer;
begin
  perform hq_private.require_capability('tasks.write');
  v_key := hq_private.idempotency_key_check(p_idempotency_key);
  v_n := hq_private.bulk_list(p_tasks, 'tasks');
  if exists (select 1 from jsonb_array_elements(p_tasks) x where jsonb_typeof(x) <> 'object') then
    raise exception 'each task must be an object' using errcode = 'invalid_parameter_value';
  end if;
  v_hash := encode(extensions.digest(jsonb_build_object('tasks', p_tasks, 'project', p_project, 'atomic', v_atomic)::text, 'sha256'), 'hex');
  v_prev := hq_private.idempotency_check(v_caller, 'bulk_create_tasks', v_key, v_hash);
  if v_prev is not null then
    return v_prev;
  end if;
  if p_project is not null or exists (select 1 from jsonb_array_elements(p_tasks) x where nullif(btrim(coalesce(x ->> 'project', '')), '') is not null) then
    perform hq_private.require_capability('projects.write');
  end if;
  if p_project is not null and not exists (select 1 from hq.projects p where p.id = p_project and p.deleted_at is null) then
    raise exception 'project not found' using errcode = 'no_data_found';
  end if;
  perform hq.consume_bulk_budget(1, v_n);
  perform set_config('hq.project_activity_quiet', 'on', true);

  -- refs, shape errors and batch references
  for i in 1 .. v_n loop
    e := p_tasks -> (i - 1);
    v_ref := nullif(btrim(coalesce(case when jsonb_typeof(e -> 'ref') = 'string' then e ->> 'ref' end, '')), '');
    v_given := v_given || v_ref;
    v_refs := v_refs || coalesce(v_ref, '#' || i);
    v_state := v_state || 'pending'::text;
    v_ids := v_ids || null::uuid;
    v_errs := v_errs || '[]'::jsonb;
  end loop;
  for i in 1 .. v_n loop
    if v_given[i] is not null then
      if v_refidx ? v_given[i] then
        v_state[i] := 'failed';
        v_errs[i] := v_errs[i] || to_jsonb(format('ref "%s" is used by more than one entry', left(v_given[i], 80)));
        j := (v_refidx ->> v_given[i])::integer;
        if v_state[j] <> 'failed' or not (v_errs[j] @> to_jsonb(array[format('ref "%s" is used by more than one entry', left(v_given[i], 80))])) then
          v_state[j] := 'failed';
          v_errs[j] := v_errs[j] || to_jsonb(format('ref "%s" is used by more than one entry', left(v_given[i], 80)));
        end if;
      else
        v_refidx := v_refidx || jsonb_build_object(v_given[i], i);
      end if;
    end if;
  end loop;
  for i in 1 .. v_n loop
    e := p_tasks -> (i - 1);
    v_errors := hq_private.task_entry_errors(e, 'create');
    if cardinality(v_errors) > 0 then
      v_state[i] := 'failed';
      v_errs[i] := v_errs[i] || to_jsonb(v_errors);
    end if;
    v_list := '[]'::jsonb;
    v_x := nullif(btrim(coalesce(case when jsonb_typeof(e -> 'parent_ref') = 'string' then e ->> 'parent_ref' end, '')), '');
    if v_x is not null and v_refidx ? v_x then
      v_list := v_list || jsonb_build_array(jsonb_build_object('i', (v_refidx ->> v_x)::integer, 'parent', true));
    end if;
    if cardinality(v_errors) = 0 then
      foreach v_x in array hq_private.json_strings(e -> 'depends_on', 'depends_on') loop
        v_x := btrim(v_x);
        if v_refidx ? v_x then
          v_list := v_list || jsonb_build_array(jsonb_build_object('i', (v_refidx ->> v_x)::integer, 'parent', false));
        end if;
      end loop;
    end if;
    v_deps := v_deps || jsonb_build_array(v_list);
  end loop;

  begin
    loop
      -- process every pending entry whose batch references are all settled
      loop
        v_progress := false;
        for i in 1 .. v_n loop
          continue when v_state[i] <> 'pending';
          v_wait := false;
          v_fail := null;
          for d in select x from jsonb_array_elements(v_deps -> (i - 1)) x loop
            j := (d ->> 'i')::integer;
            if j = i then
              v_fail := case when (d ->> 'parent')::boolean then 'an entry cannot be its own parent' else 'a task cannot depend on itself' end;
            elsif v_state[j] = 'pending' then
              v_wait := true;
            elsif v_state[j] = 'failed' and v_fail is null then
              v_fail := case when (d ->> 'parent')::boolean then format('its parent %s failed', v_refs[j]) else format('depends on %s, which failed', v_refs[j]) end;
            end if;
          end loop;
          if v_fail is not null then
            v_state[i] := 'failed';
            v_errs[i] := v_errs[i] || to_jsonb(v_fail);
            v_progress := true;
            continue;
          end if;
          continue when v_wait;
          begin
            v_id := hq_private.task_create_core(p_tasks -> (i - 1), p_project, 'bulk', v_refmap);
            v_state[i] := 'created';
            v_ids[i] := v_id;
            if v_given[i] is not null then
              v_refmap := v_refmap || jsonb_build_object(v_given[i], v_id);
            end if;
          exception when others then
            v_state[i] := 'failed';
            v_errs[i] := v_errs[i] || to_jsonb(sqlerrm);
          end;
          v_progress := true;
        end loop;
        exit when not v_progress;
      end loop;
      exit when not ('pending' = any (v_state));
      -- what is left waits on a cycle: fail the entries ON a cycle, then settle the rest
      v_count := 0;
      for i in 1 .. v_n loop
        continue when v_state[i] <> 'pending';
        v_frontier := array(select (x ->> 'i')::integer from jsonb_array_elements(v_deps -> (i - 1)) x);
        v_seen := '{}';
        v_cycle := false;
        while cardinality(v_frontier) > 0 and not v_cycle loop
          j := v_frontier[1];
          v_frontier := v_frontier[2:];
          continue when j = any (v_seen) or v_state[j] not in ('pending', 'cycle');
          if j = i then v_cycle := true; exit; end if;
          v_seen := v_seen || j;
          v_frontier := v_frontier || array(select (x ->> 'i')::integer from jsonb_array_elements(v_deps -> (j - 1)) x);
        end loop;
        if v_cycle then
          v_errs[i] := v_errs[i] || to_jsonb(format('%s is part of a dependency cycle inside this batch', v_refs[i]));
          v_count := v_count + 1;
          v_state[i] := 'cycle';
        end if;
      end loop;
      for i in 1 .. v_n loop
        if v_state[i] = 'cycle' then v_state[i] := 'failed'; end if;
      end loop;
      if v_count = 0 then
        -- cannot happen (a pending entry that waits only on settled entries is processed); be safe
        for i in 1 .. v_n loop
          if v_state[i] = 'pending' then
            v_state[i] := 'failed';
            v_errs[i] := v_errs[i] || to_jsonb('its dependencies inside this batch could not be resolved'::text);
          end if;
        end loop;
      end if;
    end loop;

    if v_atomic and 'failed' = any (v_state) then
      raise exception 'atomic batch rolled back' using errcode = 'HQB01';
    end if;
  exception when sqlstate 'HQB01' then
    v_rolled := true;
  end;

  for i in 1 .. v_n loop
    if v_state[i] = 'created' and not v_rolled then
      v_created := v_created || jsonb_build_array(jsonb_build_object('index', i - 1, 'ref', v_given[i], 'id', v_ids[i],
        'title', hq_private.knowledge_line((p_tasks -> (i - 1)) ->> 'title', 200, 'a title')));
    elsif v_state[i] = 'failed' then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('index', i - 1, 'ref', v_given[i], 'errors', v_errs[i]));
    end if;
  end loop;

  perform set_config('hq.project_activity_quiet', '', true);
  if not v_rolled then
    v_projects := array(select distinct t.project_id from hq.tasks t where t.id = any (v_ids) and t.project_id is not null);
    foreach v_pid in array v_projects loop
      select count(*) into v_count from hq.tasks t where t.id = any (v_ids) and t.project_id = v_pid;
      perform hq_private.project_activity_write(v_pid, 'bulk_created', format('%s task%s created in bulk', v_count, case when v_count = 1 then '' else 's' end),
        jsonb_build_object('count', v_count, 'task_ids', to_jsonb(array(select t.id from hq.tasks t where t.id = any (v_ids) and t.project_id = v_pid))));
    end loop;
  end if;

  v_result := jsonb_build_object(
    'created', v_created, 'failed', v_failed, 'duplicate', false,
    'created_count', jsonb_array_length(v_created), 'failed_count', jsonb_array_length(v_failed),
    'atomic', v_atomic, 'rolled_back', v_rolled, 'project_id', p_project);
  perform hq_private.audit_write('bulk_create', 'task_batch', p_project,
    format('Created %s of %s tasks in bulk%s', jsonb_array_length(v_created), v_n, case when v_rolled then ' (atomic batch rolled back)' else '' end),
    jsonb_build_object('entries', v_n, 'created', jsonb_array_length(v_created), 'failed', jsonb_array_length(v_failed), 'atomic', v_atomic,
                       'rolled_back', v_rolled, 'project_id', p_project, 'key_hash', encode(extensions.digest(v_key, 'sha256'), 'hex')));
  insert into hq.idempotency_keys (staff_id, key, scope, request_hash, result) values (v_caller, v_key, 'bulk_create_tasks', v_hash, v_result);
  return v_result;
end $$;
comment on function hq.bulk_create_tasks(jsonb, text, uuid, boolean) is 'tasks.write (+ projects.write when a project is named). Creates 1-50 tasks in ONE call and ONE transaction (each entry in a savepoint): entries {ref, title, description, assignee, priority, status, due_date, project, milestone (id or name), parent_ref, depends_on [refs or ids], checklist [text], linked_contact, linked_organisation, linked_contractor, linked_opportunity, sort_order, blocked_reason}. p_atomic false: partial success; true: all or nothing. Idempotent by (caller, key) for 48 hours. Uses the bulk budget (1 call, n items). Returns {created: [{index, ref, id, title}], failed: [{index, ref, errors[]}], duplicate, created_count, failed_count, atomic, rolled_back, project_id}.';

-- ------------------------------------------------------------------ bulk_update_tasks
-- p_updates: [{id, title, description, assignee, priority, status, due_date, project, milestone, parent,
-- add_dependency (id or [ids]), remove_dependency, complete (true), checklist, comment, sort_order,
-- blocked_reason}] (1-50). Only fields present change; JSON null clears assignee, due_date, project,
-- milestone, parent, description, blocked_reason.
create function hq.bulk_update_tasks(p_updates jsonb, p_idempotency_key text, p_atomic boolean default false) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_key text;
  v_n integer;
  v_atomic boolean := coalesce(p_atomic, false);
  v_hash text;
  v_prev jsonb;
  v_out jsonb[] := '{}';
  v_err text[] := '{}';
  v_ok boolean[] := '{}';
  i integer;
  e jsonb;
  v_r jsonb;
  v_rolled boolean := false;
  v_updated jsonb := '[]'::jsonb;
  v_failed jsonb := '[]'::jsonb;
  v_result jsonb;
  v_any_failed boolean := false;
begin
  perform hq_private.require_capability('tasks.write');
  v_key := hq_private.idempotency_key_check(p_idempotency_key);
  v_n := hq_private.bulk_list(p_updates, 'updates');
  if exists (select 1 from jsonb_array_elements(p_updates) x where jsonb_typeof(x) <> 'object') then
    raise exception 'each update must be an object' using errcode = 'invalid_parameter_value';
  end if;
  v_hash := encode(extensions.digest(jsonb_build_object('updates', p_updates, 'atomic', v_atomic)::text, 'sha256'), 'hex');
  v_prev := hq_private.idempotency_check(v_caller, 'bulk_update_tasks', v_key, v_hash);
  if v_prev is not null then
    return v_prev;
  end if;
  perform hq.consume_bulk_budget(1, v_n);

  begin
    for i in 1 .. v_n loop
      e := p_updates -> (i - 1);
      begin
        v_r := hq_private.task_update_core(e);
        v_out := v_out || v_r;
        v_err := v_err || null::text;
        v_ok := v_ok || true;
      exception when others then
        v_out := v_out || null::jsonb;
        v_err := v_err || sqlerrm;
        v_ok := v_ok || false;
        v_any_failed := true;
      end;
    end loop;
    if v_atomic and v_any_failed then
      raise exception 'atomic batch rolled back' using errcode = 'HQB01';
    end if;
  exception when sqlstate 'HQB01' then
    v_rolled := true;
  end;

  for i in 1 .. v_n loop
    e := p_updates -> (i - 1);
    if v_ok[i] and not v_rolled then
      v_updated := v_updated || jsonb_build_array(jsonb_build_object('index', i - 1, 'id', v_out[i] -> 'id', 'changed', v_out[i] -> 'changed'));
    elsif not v_ok[i] then
      v_failed := v_failed || jsonb_build_array(jsonb_build_object('index', i - 1, 'id', case when jsonb_typeof(e -> 'id') = 'string' then e -> 'id' end,
        'errors', to_jsonb(array[v_err[i]])));
    end if;
  end loop;

  v_result := jsonb_build_object(
    'updated', v_updated, 'failed', v_failed, 'duplicate', false,
    'updated_count', jsonb_array_length(v_updated), 'failed_count', jsonb_array_length(v_failed),
    'atomic', v_atomic, 'rolled_back', v_rolled);
  perform hq_private.audit_write('bulk_update', 'task_batch', null,
    format('Updated %s of %s tasks in bulk%s', jsonb_array_length(v_updated), v_n, case when v_rolled then ' (atomic batch rolled back)' else '' end),
    jsonb_build_object('entries', v_n, 'updated', jsonb_array_length(v_updated), 'failed', jsonb_array_length(v_failed), 'atomic', v_atomic,
                       'rolled_back', v_rolled, 'key_hash', encode(extensions.digest(v_key, 'sha256'), 'hex')));
  insert into hq.idempotency_keys (staff_id, key, scope, request_hash, result) values (v_caller, v_key, 'bulk_update_tasks', v_hash, v_result);
  return v_result;
end $$;
comment on function hq.bulk_update_tasks(jsonb, text, boolean) is 'tasks.write. Changes 1-50 tasks in ONE call and ONE transaction (each entry in a savepoint) with exactly the single-update rules (a task the caller cannot update is "task not found"): entries {id, title, description, assignee, priority, status, due_date, project, milestone, parent, add_dependency, remove_dependency, complete, checklist, comment, sort_order, blocked_reason}. p_atomic as bulk_create_tasks; idempotent by (caller, key); bulk budget (1 call, n items). Returns {updated: [{index, id, changed[]}], failed: [{index, id, errors[]}], duplicate, updated_count, failed_count, atomic, rolled_back}.';

-- ------------------------------------------------------------------ single tasks
create function hq.create_project_task(
  p_title text,
  p_project uuid default null,
  p_milestone uuid default null,
  p_parent uuid default null,
  p_assignee uuid default null,
  p_due_date date default null,
  p_priority hq.task_priority default 'normal',
  p_description text default null,
  p_status hq.task_status default 'to_do',
  p_depends_on uuid[] default null,
  p_checklist text[] default null,
  p_sort_order integer default null,
  p_blocked_reason text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_id uuid;
  v_t hq.tasks;
  v_project uuid := p_project;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('tasks.write');
  if v_project is null and p_parent is not null then
    select t.project_id into v_project from hq.tasks t where t.id = p_parent;
  end if;
  v_id := hq_private.task_create_core(jsonb_strip_nulls(jsonb_build_object(
      'title', p_title, 'project', v_project, 'milestone', p_milestone, 'parent', p_parent, 'assignee', p_assignee,
      'due_date', p_due_date, 'priority', p_priority, 'description', p_description, 'status', p_status,
      'depends_on', to_jsonb(p_depends_on), 'checklist', to_jsonb(p_checklist),
      'sort_order', p_sort_order::text, 'blocked_reason', p_blocked_reason)),
    null, case when v_project is null then 'manual' else 'project' end, '{}'::jsonb);
  select * into v_t from hq.tasks t where t.id = v_id;
  return hq_private.task_json(v_t) || jsonb_build_object('changed', true);
end $$;
comment on function hq.create_project_task(text, uuid, uuid, uuid, uuid, date, hq.task_priority, text, hq.task_status, uuid[], text[], integer, text) is 'tasks.write (+ projects.write in a project). Creates one task (source project in a project, else manual) with the bulk entry rules: project (default the parent''s), milestone of that project, parent (one level, same project, visible), assignee (default the caller; active staff), due date within five years, depends_on (visible tasks; no cycle), checklist (max 50), sort_order (default next in the project), blocked_reason. Returns the task json plus {changed}.';

create function hq.update_project_task(p_id uuid, p_patch jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_r jsonb;
  v_t hq.tasks;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('tasks.write');
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    raise exception 'the changes must be an object' using errcode = 'invalid_parameter_value';
  end if;
  v_r := hq_private.task_update_core((p_patch - 'id') || jsonb_build_object('id', p_id));
  select * into v_t from hq.tasks t where t.id = p_id;
  return hq_private.task_json(v_t) || jsonb_build_object('changed', jsonb_array_length(v_r -> 'changed') > 0, 'changed_fields', v_r -> 'changed');
end $$;
comment on function hq.update_project_task(uuid, jsonb) is 'tasks.write. Changes one task the caller may update with a patch object (the bulk_update_tasks entry fields without id; JSON null clears assignee, due_date, project, milestone, parent, description, blocked_reason). Returns the task json plus {changed, changed_fields}.';

create function hq.complete_task(p_id uuid, p_note text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_t hq.tasks;
  v_note text;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('tasks.write');
  v_note := hq_private.knowledge_line(p_note, 300, 'a note');
  v_t := hq_private.task_lock(p_id);
  if v_t.status = 'completed' then
    return hq_private.task_json(v_t) || jsonb_build_object('changed', false);
  end if;
  perform hq_private.audit_context(null, left(v_note, 200));
  update hq.tasks set status = 'completed' where id = v_t.id returning * into v_t;
  perform hq_private.audit_context();
  if v_note is not null then
    perform hq_private.task_activity_write(v_t.id, 'note', left('Completion note: ' || v_note, 500), jsonb_build_object('note', v_note));
  end if;
  return hq_private.task_json(v_t) || jsonb_build_object('changed', true);
end $$;
comment on function hq.complete_task(uuid, text) is 'tasks.write. Marks one task the caller may update as completed, with an optional note (up to 300) in its activity. Already completed: {changed: false}. Returns the task json plus {changed}.';

create function hq.add_task_dependency(p_task uuid, p_depends_on uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_t hq.tasks;
  v_added boolean;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('tasks.write');
  v_t := hq_private.task_lock(p_task);
  v_added := hq_private.task_dependency_add(v_t.id, p_depends_on);
  return jsonb_build_object('task_id', v_t.id, 'depends_on_task_id', p_depends_on, 'changed', v_added,
    'blocked', exists (select 1 from hq.task_dependencies d where d.task_id = v_t.id and d.depends_on_open));
end $$;
comment on function hq.add_task_dependency(uuid, uuid) is 'tasks.write. p_task (one the caller may update) waits for p_depends_on (one the caller can see). No self-dependency (22023), no cycle (23514 task_dependency_cycle), at most 50. Already there: {changed: false}. Returns {task_id, depends_on_task_id, changed, blocked}.';

create function hq.remove_task_dependency(p_task uuid, p_depends_on uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_t hq.tasks;
  v_n integer;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('tasks.write');
  v_t := hq_private.task_lock(p_task);
  delete from hq.task_dependencies d where d.task_id = v_t.id and d.depends_on_task_id = p_depends_on;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform hq_private.task_activity_write(v_t.id, 'dependency_removed', 'No longer waits for another task', jsonb_build_object('depends_on_task_id', p_depends_on));
  end if;
  return jsonb_build_object('task_id', v_t.id, 'depends_on_task_id', p_depends_on, 'changed', v_n > 0,
    'blocked', exists (select 1 from hq.task_dependencies d where d.task_id = v_t.id and d.depends_on_open));
end $$;
comment on function hq.remove_task_dependency(uuid, uuid) is 'tasks.write. Removes "p_task waits for p_depends_on" from a task the caller may update. Not there: {changed: false}. Returns {task_id, depends_on_task_id, changed, blocked}.';

create function hq.set_task_checklist(p_task uuid, p_items jsonb) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_t hq.tasks;
  v_r jsonb;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('tasks.write');
  v_t := hq_private.task_lock(p_task);
  v_r := hq_private.task_checklist_apply(v_t.id, p_items);
  if (v_r ->> 'changed')::boolean then
    perform hq_private.task_activity_write(v_t.id, 'checklist', format('Checklist updated (%s of %s done)', v_r ->> 'done', v_r ->> 'total'), v_r);
  end if;
  return jsonb_build_object('task_id', v_t.id) || v_r || jsonb_build_object('items',
    (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'text', c.text, 'done', c.done, 'sort_order', c.sort_order) order by c.sort_order, c.id), '[]'::jsonb)
     from hq.task_checklist_items c where c.task_id = v_t.id));
end $$;
comment on function hq.set_task_checklist(uuid, jsonb) is 'tasks.write. Replaces the checklist of a task the caller may update: [text | {text, done, id}] (max 50, text 1-300); items with an existing id keep their done stamp, items not listed are removed. Returns {task_id, total, done, changed, items: [{id, text, done, sort_order}]}.';

create function hq.add_task_comment(p_task uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_body text;
  v_c hq.task_comments;
begin
  perform hq_private.require_capability('tasks.write');
  v_body := hq_private.meeting_text(p_body, 4000, 'a comment');
  if v_body is null then
    raise exception 'a comment needs text' using errcode = 'invalid_parameter_value';
  end if;
  if p_task is null or not hq_private.task_visible_to_caller(p_task) then
    raise exception 'task not found' using errcode = 'no_data_found';
  end if;
  insert into hq.task_comments (task_id, author_id, body) values (p_task, v_caller, v_body) returning * into v_c;
  perform hq_private.task_activity_write(p_task, 'comment', 'Comment added', jsonb_build_object('comment_id', v_c.id));
  return jsonb_build_object('comment_id', v_c.id, 'task_id', p_task, 'body', v_c.body, 'created_at', v_c.created_at, 'changed', true);
end $$;
comment on function hq.add_task_comment(uuid, text) is 'tasks.write. Adds a comment (1-4000) to a task the caller can see. Activity row. Returns {comment_id, task_id, body, created_at, changed}.';

create function hq.edit_task_comment(p_comment bigint, p_body text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_body text;
  v_c hq.task_comments;
begin
  v_body := hq_private.meeting_text(p_body, 4000, 'a comment');
  if v_body is null then
    raise exception 'a comment needs text' using errcode = 'invalid_parameter_value';
  end if;
  select * into v_c from hq.task_comments c where c.id = p_comment for update;
  if not found or not hq_private.task_visible_to_caller(v_c.task_id) then
    raise exception 'comment not found' using errcode = 'no_data_found';
  end if;
  if not (hq_private.has_capability('settings.admin')
          or (v_c.author_id = v_caller and v_c.created_at > now() - interval '60 minutes' and hq_private.has_capability('tasks.write'))) then
    raise exception 'a comment can be edited by its author within 60 minutes of posting, or by a director'
      using errcode = 'insufficient_privilege', hint = 'task_comment_edit_window';
  end if;
  if v_body = v_c.body then
    return jsonb_build_object('comment_id', v_c.id, 'task_id', v_c.task_id, 'body', v_c.body, 'edited_at', v_c.edited_at, 'changed', false);
  end if;
  update hq.task_comments set body = v_body where id = v_c.id returning * into v_c;
  perform hq_private.task_activity_write(v_c.task_id, 'comment_edited', 'Comment edited', jsonb_build_object('comment_id', v_c.id));
  return jsonb_build_object('comment_id', v_c.id, 'task_id', v_c.task_id, 'body', v_c.body, 'edited_at', v_c.edited_at, 'changed', true);
end $$;
comment on function hq.edit_task_comment(bigint, text) is 'Changes a comment''s text on a task the caller can see: its author within 60 minutes of posting (with tasks.write), or a director (settings.admin) at any time (else 42501 task_comment_edit_window). Same text: {changed: false}. Returns {comment_id, task_id, body, edited_at, changed}.';

-- ------------------------------------------------------------------ projects
create function hq.create_project(
  p_name text,
  p_description text default null,
  p_owner uuid default null,
  p_status hq.project_status default 'planning',
  p_priority hq.task_priority default 'normal',
  p_start date default null,
  p_target date default null,
  p_notes text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_name text;
  v_owner uuid := coalesce(p_owner, v_caller);
  v_p hq.projects;
begin
  perform hq_private.require_capability('projects.write');
  v_name := hq_private.knowledge_line(p_name, 200, 'a project name');
  if v_name is null then
    raise exception 'a project needs a name' using errcode = 'invalid_parameter_value';
  end if;
  perform hq_private.require_active_staff(v_owner, 'the project owner');
  if p_start is not null and p_target is not null and p_target < p_start then
    raise exception 'the target date cannot be before the start date' using errcode = 'invalid_parameter_value';
  end if;
  if (p_start is not null and p_start not between date '2000-01-01' and date '2100-12-31') or (p_target is not null and p_target not between date '2000-01-01' and date '2100-12-31') then
    raise exception 'that date is out of range' using errcode = 'invalid_parameter_value';
  end if;
  if exists (select 1 from hq.projects p where lower(btrim(p.name)) = lower(v_name) and p.deleted_at is null) then
    raise exception 'a project called "%" already exists', v_name using errcode = 'unique_violation', hint = 'project_name_taken';
  end if;
  insert into hq.projects (name, description, owner_id, status, priority, start_date, target_date, notes)
  values (v_name, hq_private.meeting_text(p_description, 5000, 'the description'), v_owner, coalesce(p_status, 'planning'), coalesce(p_priority, 'normal'),
          p_start, p_target, hq_private.knowledge_body(p_notes))
  returning * into v_p;
  perform hq_private.project_activity_write(v_p.id, 'created', 'Project created', jsonb_build_object('status', v_p.status));
  return hq_private.project_json(v_p) || jsonb_build_object('changed', true);
end $$;
comment on function hq.create_project(text, text, uuid, hq.project_status, hq.task_priority, date, date, text) is 'projects.write. Creates a project: name 1-200 (unique among live projects, 23505 project_name_taken), description up to 5000, owner (default the caller; active staff), status (default planning), priority, start and target dates (target >= start), notes up to 50000 (safe markdown). Activity, audit. Returns the project json plus {changed}.';

-- Patch semantics: null leaves a field; p_clear empties description, owner, start_date, target_date or
-- notes. p_expected_version, when given, must be the current version (else 23514 project_stale).
create function hq.update_project(
  p_id uuid,
  p_expected_version integer default null,
  p_name text default null,
  p_description text default null,
  p_owner uuid default null,
  p_status hq.project_status default null,
  p_priority hq.task_priority default null,
  p_start date default null,
  p_target date default null,
  p_notes text default null,
  p_clear text[] default null,
  p_note text default null
) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_caller uuid := hq_private.require_staff();
  v_cur hq.projects;
  v_new hq.projects;
  v_clear text[] := coalesce(p_clear, '{}');
  v_bad text;
  v_changed text[] := '{}';
  v_note text;
begin
  perform hq_private.require_capability('projects.write');
  v_note := hq_private.knowledge_line(p_note, 300, 'a note');
  select c into v_bad from unnest(v_clear) c where c not in ('description', 'owner', 'start_date', 'target_date', 'notes') limit 1;
  if v_bad is not null then
    raise exception 'only description, owner, start_date, target_date and notes can be cleared' using errcode = 'invalid_parameter_value';
  end if;
  v_cur := hq_private.project_lock(p_id);
  if p_expected_version is not null and v_cur.version <> p_expected_version then
    raise exception 'this project was changed by someone else (it is at version %, not version %); reload it and try again', v_cur.version, p_expected_version
      using errcode = 'check_violation', hint = 'project_stale';
  end if;
  v_new := v_cur;
  if p_name is not null then
    v_new.name := hq_private.knowledge_line(p_name, 200, 'a project name');
    if v_new.name is null then
      raise exception 'a project needs a name' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if p_description is not null then v_new.description := hq_private.meeting_text(p_description, 5000, 'the description'); end if;
  if p_owner is not null then
    perform hq_private.require_active_staff(p_owner, 'the project owner');
    v_new.owner_id := p_owner;
  end if;
  if p_status is not null then v_new.status := p_status; end if;
  if p_priority is not null then v_new.priority := p_priority; end if;
  if p_start is not null then v_new.start_date := p_start; end if;
  if p_target is not null then v_new.target_date := p_target; end if;
  if p_notes is not null then v_new.notes := hq_private.knowledge_body(p_notes); end if;
  if 'description' = any (v_clear) then v_new.description := null; end if;
  if 'owner' = any (v_clear) then v_new.owner_id := null; end if;
  if 'start_date' = any (v_clear) then v_new.start_date := null; end if;
  if 'target_date' = any (v_clear) then v_new.target_date := null; end if;
  if 'notes' = any (v_clear) then v_new.notes := null; end if;
  if v_new.start_date is not null and v_new.target_date is not null and v_new.target_date < v_new.start_date then
    raise exception 'the target date cannot be before the start date' using errcode = 'invalid_parameter_value';
  end if;
  if (v_new.start_date is not null and v_new.start_date not between date '2000-01-01' and date '2100-12-31') or (v_new.target_date is not null and v_new.target_date not between date '2000-01-01' and date '2100-12-31') then
    raise exception 'that date is out of range' using errcode = 'invalid_parameter_value';
  end if;
  if v_new.name is distinct from v_cur.name then v_changed := v_changed || 'name'::text; end if;
  if v_new.description is distinct from v_cur.description then v_changed := v_changed || 'description'::text; end if;
  if v_new.owner_id is distinct from v_cur.owner_id then v_changed := v_changed || 'owner'::text; end if;
  if v_new.status is distinct from v_cur.status then v_changed := v_changed || 'status'::text; end if;
  if v_new.priority is distinct from v_cur.priority then v_changed := v_changed || 'priority'::text; end if;
  if v_new.start_date is distinct from v_cur.start_date then v_changed := v_changed || 'start_date'::text; end if;
  if v_new.target_date is distinct from v_cur.target_date then v_changed := v_changed || 'target_date'::text; end if;
  if v_new.notes is distinct from v_cur.notes then v_changed := v_changed || 'notes'::text; end if;
  if cardinality(v_changed) = 0 then
    return hq_private.project_json(v_cur) || jsonb_build_object('changed', false, 'changed_fields', '[]'::jsonb);
  end if;
  if v_new.name is distinct from v_cur.name and exists (
       select 1 from hq.projects p where lower(btrim(p.name)) = lower(v_new.name) and p.deleted_at is null and p.id <> v_cur.id) then
    raise exception 'a project called "%" already exists', v_new.name using errcode = 'unique_violation', hint = 'project_name_taken';
  end if;
  perform hq_private.audit_context(null, left(v_note, 200));
  update hq.projects set
    name = v_new.name, description = v_new.description, owner_id = v_new.owner_id, status = v_new.status, priority = v_new.priority,
    start_date = v_new.start_date, target_date = v_new.target_date, notes = v_new.notes, version = v_cur.version + 1
  where id = v_cur.id
  returning * into v_new;
  perform hq_private.audit_context();
  perform hq_private.project_activity_write(v_new.id, case when v_changed = array['status'] then 'status' else 'updated' end,
    left('Changed ' || replace(array_to_string(v_changed, ', '), '_', ' ') || coalesce(': ' || v_note, ''), 500),
    jsonb_build_object('fields', to_jsonb(v_changed), 'version', v_new.version));
  return hq_private.project_json(v_new) || jsonb_build_object('changed', true, 'changed_fields', to_jsonb(v_changed));
end $$;
comment on function hq.update_project(uuid, integer, text, text, uuid, hq.project_status, hq.task_priority, date, date, text, text[], text) is 'projects.write. Changes one live project (null leaves a field; p_clear empties description, owner, start_date, target_date, notes). p_expected_version, when given, must be the current version (else 23514 project_stale). Name unique among live (23505 project_name_taken). Version + 1, activity, audit (with p_note). Nothing to change: {changed: false}. Returns the project json plus {changed, changed_fields}.';

create function hq.set_project_status(p_id uuid, p_status hq.project_status, p_note text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('projects.write');
  if p_status is null then
    raise exception 'choose a status' using errcode = 'invalid_parameter_value';
  end if;
  return hq.update_project(p_id, null, null, null, null, p_status, null, null, null, null, null, p_note);
end $$;
comment on function hq.set_project_status(uuid, hq.project_status, text) is 'projects.write. Sets a live project''s status (planning, active, on_hold, completed, cancelled) with an optional note (up to 300) in its activity and audit. Same rules and return as update_project.';

create function hq.add_project_link(p_project uuid, p_kind text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_p hq.projects;
  v_label text;
  v_id bigint;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('projects.write');
  if p_kind is null or p_kind not in ('contact', 'organisation', 'contractor', 'opportunity') then
    raise exception 'a link is to a contact, organisation, contractor or opportunity' using errcode = 'invalid_parameter_value';
  end if;
  v_p := hq_private.project_lock(p_project);
  perform hq_private.task_link_check(p_kind, coalesce(p_id, '00000000-0000-0000-0000-000000000000'::uuid));
  v_label := case p_kind
    when 'contact' then (select c.full_name from hq.contacts c where c.id = p_id)
    when 'organisation' then (select o.name from hq.organisations o where o.id = p_id)
    when 'contractor' then (select c.business_name from hq.contractors c where c.id = p_id)
    else (select coalesce(o.prospect_name, 'Lead') from hq.opportunities o where o.id = p_id) end;
  insert into hq.project_links (project_id, contact_id, organisation_id, contractor_id, opportunity_id)
  values (v_p.id, case when p_kind = 'contact' then p_id end, case when p_kind = 'organisation' then p_id end,
          case when p_kind = 'contractor' then p_id end, case when p_kind = 'opportunity' then p_id end)
  on conflict do nothing returning id into v_id;
  if v_id is not null then
    perform hq_private.project_activity_write(v_p.id, 'linked', left('Linked ' || p_kind || ' ' || coalesce(v_label, ''), 500), jsonb_build_object('kind', p_kind, 'id', p_id));
  end if;
  return jsonb_build_object('project_id', v_p.id, 'link_id', v_id, 'kind', p_kind, 'record_id', p_id, 'label', v_label, 'changed', v_id is not null);
end $$;
comment on function hq.add_project_link(uuid, text, uuid) is 'projects.write. Links a live project to a contact, organisation, opportunity (growth.read) or contractor (contractors.read) the caller can read (else P0002). Already linked: {changed: false}. Returns {project_id, link_id, kind, record_id, label, changed}.';

create function hq.remove_project_link(p_project uuid, p_kind text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_p hq.projects;
  v_n integer;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('projects.write');
  if p_kind is null or p_kind not in ('contact', 'organisation', 'contractor', 'opportunity') then
    raise exception 'a link is to a contact, organisation, contractor or opportunity' using errcode = 'invalid_parameter_value';
  end if;
  v_p := hq_private.project_lock(p_project);
  delete from hq.project_links l where l.project_id = v_p.id
    and case p_kind when 'contact' then l.contact_id when 'organisation' then l.organisation_id when 'contractor' then l.contractor_id else l.opportunity_id end = p_id;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform hq_private.project_activity_write(v_p.id, 'unlinked', 'Unlinked a ' || p_kind, jsonb_build_object('kind', p_kind, 'id', p_id));
  end if;
  return jsonb_build_object('project_id', v_p.id, 'kind', p_kind, 'record_id', p_id, 'changed', v_n > 0);
end $$;
comment on function hq.remove_project_link(uuid, text, uuid) is 'projects.write. Removes the link between a live project and a record. Not linked: {changed: false}. Returns {project_id, kind, record_id, changed}.';

create function hq.add_project_document(p_project uuid, p_title text, p_url text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_p hq.projects;
  v_title text;
  v_url text := btrim(coalesce(p_url, ''));
  v_d hq.project_documents;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('projects.write');
  v_title := hq_private.knowledge_line(p_title, 200, 'a document title');
  if v_title is null then
    raise exception 'a document link needs a title' using errcode = 'invalid_parameter_value';
  end if;
  if char_length(v_url) > 500 or v_url !~* '^https://[^[:space:]/?#]+[^[:space:]]*$' then
    raise exception 'a document link is an https:// address of at most 500 characters' using errcode = 'invalid_parameter_value';
  end if;
  v_p := hq_private.project_lock(p_project);
  insert into hq.project_documents (project_id, title, url) values (v_p.id, v_title, v_url) returning * into v_d;
  perform hq_private.project_activity_write(v_p.id, 'document_added', left('Document linked: ' || v_title, 500), jsonb_build_object('document_id', v_d.id));
  return jsonb_build_object('project_id', v_p.id, 'document_id', v_d.id, 'title', v_d.title, 'url', v_d.url, 'changed', true);
end $$;
comment on function hq.add_project_document(uuid, text, text) is 'projects.write. Adds a link to a document (title 1-200, https only, up to 500 characters; no file storage) to a live project, at most 50. Returns {project_id, document_id, title, url, changed}.';

create function hq.remove_project_document(p_project uuid, p_document bigint) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_p hq.projects;
  v_title text;
  v_n integer;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('projects.write');
  v_p := hq_private.project_lock(p_project);
  select d.title into v_title from hq.project_documents d where d.id = p_document and d.project_id = v_p.id;
  delete from hq.project_documents d where d.id = p_document and d.project_id = v_p.id;
  get diagnostics v_n = row_count;
  if v_n > 0 then
    perform hq_private.project_activity_write(v_p.id, 'document_removed', left('Document link removed: ' || v_title, 500), jsonb_build_object('document_id', p_document));
  end if;
  return jsonb_build_object('project_id', v_p.id, 'document_id', p_document, 'changed', v_n > 0);
end $$;
comment on function hq.remove_project_document(uuid, bigint) is 'projects.write. Removes one document link from a live project. Not there: {changed: false}.';

-- ------------------------------------------------------------------ milestones
create function hq.create_milestone(p_project uuid, p_name text, p_description text default null, p_due date default null, p_sort_order integer default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_p hq.projects;
  v_name text;
  v_m hq.project_milestones;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('projects.write');
  v_name := hq_private.knowledge_line(p_name, 200, 'a milestone name');
  if v_name is null then
    raise exception 'a milestone needs a name' using errcode = 'invalid_parameter_value';
  end if;
  if p_due is not null and p_due not between date '2000-01-01' and date '2100-12-31' then
    raise exception 'that date is out of range' using errcode = 'invalid_parameter_value';
  end if;
  if p_sort_order is not null and p_sort_order not between 0 and 100000 then
    raise exception 'sort_order is a whole number from 0 to 100000' using errcode = 'invalid_parameter_value';
  end if;
  v_p := hq_private.project_lock(p_project);
  if (select count(*) from hq.project_milestones m where m.project_id = v_p.id) >= 100 then
    raise exception 'a project can have at most 100 milestones' using errcode = 'check_violation', hint = 'milestone_limit';
  end if;
  if exists (select 1 from hq.project_milestones m where m.project_id = v_p.id and lower(btrim(m.name)) = lower(v_name)) then
    raise exception 'this project already has a milestone called "%"', v_name using errcode = 'unique_violation', hint = 'milestone_name_taken';
  end if;
  insert into hq.project_milestones (project_id, name, description, due_date, sort_order)
  values (v_p.id, v_name, hq_private.meeting_text(p_description, 2000, 'the description'), p_due,
          coalesce(p_sort_order, least((select coalesce(max(m.sort_order) + 1, 0) from hq.project_milestones m where m.project_id = v_p.id), 100000)))
  returning * into v_m;
  perform hq_private.project_activity_write(v_p.id, 'milestone_added', left('Milestone added: ' || v_name, 500), jsonb_build_object('milestone_id', v_m.id));
  return hq_private.milestone_json(v_m) || jsonb_build_object('changed', true);
end $$;
comment on function hq.create_milestone(uuid, text, text, date, integer) is 'projects.write. Adds a milestone to a live project: name 1-200 unique in the project (23505 milestone_name_taken), description up to 2000, due date, sort_order (default last). At most 100. Returns the milestone json plus {changed}.';

create function hq.update_milestone(p_id uuid, p_name text default null, p_description text default null, p_due date default null, p_clear text[] default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_m hq.project_milestones;
  v_new hq.project_milestones;
  v_clear text[] := coalesce(p_clear, '{}');
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('projects.write');
  if exists (select 1 from unnest(v_clear) c where c not in ('description', 'due_date')) then
    raise exception 'only description and due_date can be cleared' using errcode = 'invalid_parameter_value';
  end if;
  v_m := hq_private.milestone_lock(p_id);
  v_new := v_m;
  if p_name is not null then
    v_new.name := hq_private.knowledge_line(p_name, 200, 'a milestone name');
    if v_new.name is null then
      raise exception 'a milestone needs a name' using errcode = 'invalid_parameter_value';
    end if;
  end if;
  if p_description is not null then v_new.description := hq_private.meeting_text(p_description, 2000, 'the description'); end if;
  if p_due is not null then
    if p_due not between date '2000-01-01' and date '2100-12-31' then
      raise exception 'that date is out of range' using errcode = 'invalid_parameter_value';
    end if;
    v_new.due_date := p_due;
  end if;
  if 'description' = any (v_clear) then v_new.description := null; end if;
  if 'due_date' = any (v_clear) then v_new.due_date := null; end if;
  if (v_new.name, v_new.description, v_new.due_date) is not distinct from (v_m.name, v_m.description, v_m.due_date) then
    return hq_private.milestone_json(v_m) || jsonb_build_object('changed', false);
  end if;
  if lower(v_new.name) <> lower(v_m.name) and exists (
       select 1 from hq.project_milestones m where m.project_id = v_m.project_id and lower(btrim(m.name)) = lower(v_new.name) and m.id <> v_m.id) then
    raise exception 'this project already has a milestone called "%"', v_new.name using errcode = 'unique_violation', hint = 'milestone_name_taken';
  end if;
  update hq.project_milestones set name = v_new.name, description = v_new.description, due_date = v_new.due_date where id = v_m.id returning * into v_new;
  perform hq_private.project_activity_write(v_m.project_id, 'milestone_updated', left('Milestone changed: ' || v_new.name, 500), jsonb_build_object('milestone_id', v_m.id));
  return hq_private.milestone_json(v_new) || jsonb_build_object('changed', true);
end $$;
comment on function hq.update_milestone(uuid, text, text, date, text[]) is 'projects.write. Changes a milestone of a live project (null leaves a field; p_clear empties description or due_date). Name unique in the project. Nothing to change: {changed: false}. Returns the milestone json plus {changed}.';

create function hq.complete_milestone(p_id uuid, p_force boolean default false, p_note text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_m hq.project_milestones;
  v_open integer;
  v_note text;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('projects.write');
  v_note := hq_private.knowledge_line(p_note, 300, 'a note');
  v_m := hq_private.milestone_lock(p_id);
  if v_m.status = 'done' then
    return hq_private.milestone_json(v_m) || jsonb_build_object('changed', false, 'open_tasks', 0);
  end if;
  select count(*) into v_open from hq.tasks t where t.milestone_id = v_m.id and t.deleted_at is null and t.status not in ('completed', 'cancelled');
  if v_open > 0 and not coalesce(p_force, false) then
    raise exception 'this milestone has % open task%: finish them first, or complete it anyway with a note', v_open, case when v_open = 1 then '' else 's' end
      using errcode = 'check_violation', hint = 'milestone_open_tasks';
  end if;
  if v_open > 0 and v_note is null then
    raise exception 'say why you are completing this milestone with open tasks' using errcode = 'invalid_parameter_value', hint = 'milestone_force_note';
  end if;
  perform hq_private.audit_context(null, left(v_note, 200));
  update hq.project_milestones set status = 'done' where id = v_m.id returning * into v_m;
  perform hq_private.audit_context();
  perform hq_private.project_activity_write(v_m.project_id, 'milestone_done',
    left('Milestone done: ' || v_m.name || case when v_open > 0 then format(' (with %s open task%s: %s)', v_open, case when v_open = 1 then '' else 's' end, v_note) else '' end, 500),
    jsonb_build_object('milestone_id', v_m.id, 'open_tasks', v_open, 'forced', v_open > 0));
  return hq_private.milestone_json(v_m) || jsonb_build_object('changed', true, 'open_tasks', v_open);
end $$;
comment on function hq.complete_milestone(uuid, boolean, text) is 'projects.write. Marks a milestone done. Refused while it has open tasks (any, not only the caller''s: 23514 milestone_open_tasks) unless p_force with a note (22023 milestone_force_note). Already done: {changed: false}. Returns the milestone json plus {changed, open_tasks}.';

create function hq.reopen_milestone(p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_m hq.project_milestones;
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('projects.write');
  v_m := hq_private.milestone_lock(p_id);
  if v_m.status = 'open' then
    return hq_private.milestone_json(v_m) || jsonb_build_object('changed', false);
  end if;
  update hq.project_milestones set status = 'open' where id = v_m.id returning * into v_m;
  perform hq_private.project_activity_write(v_m.project_id, 'milestone_reopened', left('Milestone reopened: ' || v_m.name, 500), jsonb_build_object('milestone_id', v_m.id));
  return hq_private.milestone_json(v_m) || jsonb_build_object('changed', true);
end $$;
comment on function hq.reopen_milestone(uuid) is 'projects.write. Reopens a done milestone. Already open: {changed: false}.';

create function hq.reorder_milestones(p_project uuid, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_p hq.projects;
  v_all uuid[];
begin
  perform hq_private.require_staff();
  perform hq_private.require_capability('projects.write');
  v_p := hq_private.project_lock(p_project);
  v_all := array(select m.id from hq.project_milestones m where m.project_id = v_p.id order by m.id);
  if p_ids is null or cardinality(p_ids) <> cardinality(v_all) or array(select x from unnest(p_ids) x order by x) <> v_all
     or (select count(distinct x) from unnest(p_ids) x) <> cardinality(p_ids) then
    raise exception 'list every milestone of the project exactly once, in the new order' using errcode = 'invalid_parameter_value';
  end if;
  update hq.project_milestones m set sort_order = o.n - 1
  from unnest(p_ids) with ordinality as o(id, n)
  where m.id = o.id and m.sort_order is distinct from o.n - 1;
  perform hq_private.project_activity_write(v_p.id, 'milestones_reordered', 'Milestones reordered', jsonb_build_object('order', to_jsonb(p_ids)));
  return jsonb_build_object('project_id', v_p.id, 'order', to_jsonb(p_ids), 'changed', true);
end $$;
comment on function hq.reorder_milestones(uuid, uuid[]) is 'projects.write. Sets the order of a live project''s milestones: p_ids lists every milestone exactly once (sort_order 0, 1, 2 ...). Returns {project_id, order, changed}.';

-- ------------------------------------------------------------------ archive_record / restore_record (0140 extended with 'project')
create or replace function hq.archive_record(p_entity text, p_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_table text;
  v_caller uuid := hq_private.require_staff();
  v_deleted timestamptz;
  v_allowed boolean;
  v_needs text;
  v_ref hq.referrals;
  v_mtg hq.meetings;
  v_n integer;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 200);
begin
  v_table := case p_entity
    when 'organisation' then 'organisations' when 'contact' then 'contacts' when 'referral' then 'referrals'
    when 'task' then 'tasks' when 'opportunity' then 'opportunities' when 'interaction' then 'interactions'
    when 'contractor' then 'contractors' when 'contractor_document' then 'contractor_documents'
    when 'contractor_review' then 'contractor_reviews' when 'decision' then 'decisions'
    when 'managed_property' then 'managed_properties' when 'knowledge_document' then 'knowledge_documents'
    when 'meeting' then 'meetings' when 'project' then 'projects' end;
  if v_table is null then
    raise exception 'unknown entity %; expected organisation, contact, referral, task, opportunity, interaction, contractor, contractor_document, contractor_review, decision, managed_property, knowledge_document, meeting or project', p_entity
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
  elsif p_entity = 'managed_property' then
    v_needs := 'portfolio.write';
    v_allowed := hq_private.has_capability('portfolio.write');
  elsif p_entity = 'knowledge_document' then
    v_needs := 'knowledge.approve';
    v_allowed := hq_private.has_capability('knowledge.approve');
  elsif p_entity = 'meeting' then
    v_needs := 'meetings.write';
    v_allowed := hq_private.has_capability('meetings.write');
    if v_allowed then
      -- a confidential meeting the caller may not see is "not found", never a hint that it exists
      select m.* into v_mtg from hq.meetings m where m.id = p_id;
      if found and not hq_private.meeting_visible(v_mtg) then
        raise exception 'meeting not found' using errcode = 'no_data_found';
      end if;
    end if;
  elsif p_entity = 'project' then
    v_needs := 'projects.write';
    v_allowed := hq_private.has_capability('projects.write');
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
  if p_entity = 'meeting' then
    update hq.meetings set deleted_at = now(), version = version + 1 where id = p_id returning * into v_mtg;
  elsif p_entity = 'project' then
    update hq.projects set deleted_at = now(), version = version + 1 where id = p_id;
  else
    execute format('update hq.%I set deleted_at = now() where id = $1', v_table) using p_id;
  end if;
  perform hq_private.audit_context();
  if p_entity = 'decision' then
    perform hq_private.decision_history_write(p_id, 'archive', 'Archived', '{}'::jsonb, v_reason);
  elsif p_entity = 'meeting' then
    perform hq_private.meeting_history_write(v_mtg, 'archive', 'Archived', v_reason);
    perform hq_private.meeting_sync_touchpoints(p_id);
  elsif p_entity = 'project' then
    perform hq_private.project_activity_write(p_id, 'archived', 'Archived' || coalesce(': ' || v_reason, ''), '{}'::jsonb);
  end if;
  return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', true, 'changed', true);
end $$;
comment on function hq.archive_record(text, uuid, text) is 'Soft-deletes organisation, contact, referral, task, opportunity, interaction (growth.delete; a task also by its assignee or creator holding tasks.write; an opportunity that is a live managed property is refused), contractor (contractors.approve), contractor_document (contractors.documents), contractor_review (contractors.approve, or its recorder with contractors.write), decision (decisions.write; refused while a live decision is superseded by it; recorded in its history), managed_property (portfolio.write), knowledge_document (knowledge.approve), meeting (meetings.write and able to see it; recorded in its history; its touch points are archived, its action tasks are not), project (projects.write; recorded in its activity; its tasks stay as they are).';

create or replace function hq.restore_record(p_entity text, p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, public, extensions as $$
declare
  v_table text;
  v_deleted timestamptz;
  v_mtg hq.meetings;
  v_n integer;
begin
  perform hq_private.require_staff();
  v_table := case p_entity
    when 'organisation' then 'organisations' when 'contact' then 'contacts' when 'referral' then 'referrals'
    when 'task' then 'tasks' when 'opportunity' then 'opportunities' when 'interaction' then 'interactions'
    when 'contractor' then 'contractors' when 'contractor_document' then 'contractor_documents'
    when 'contractor_review' then 'contractor_reviews' when 'decision' then 'decisions'
    when 'managed_property' then 'managed_properties' when 'knowledge_document' then 'knowledge_documents'
    when 'meeting' then 'meetings' when 'project' then 'projects' end;
  if v_table is null then
    raise exception 'unknown entity %; expected organisation, contact, referral, task, opportunity, interaction, contractor, contractor_document, contractor_review, decision, managed_property, knowledge_document, meeting or project', p_entity
      using errcode = 'invalid_parameter_value';
  end if;
  perform hq_private.require_capability(case p_entity
    when 'contractor' then 'contractors.approve'
    when 'contractor_document' then 'contractors.documents'
    when 'contractor_review' then 'contractors.approve'
    when 'decision' then 'decisions.write'
    when 'managed_property' then 'portfolio.write'
    when 'knowledge_document' then 'knowledge.approve'
    when 'meeting' then 'meetings.write'
    when 'project' then 'projects.write'
    else 'growth.delete' end);
  if p_entity = 'meeting' then
    select m.* into v_mtg from hq.meetings m where m.id = p_id;
    if found and not hq_private.meeting_visible(v_mtg) then
      raise exception 'meeting not found' using errcode = 'no_data_found';
    end if;
  end if;
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
  elsif p_entity = 'meeting' then
    update hq.meetings set deleted_at = null, version = version + 1 where id = p_id returning * into v_mtg;
  elsif p_entity = 'project' then
    -- a live project that took the name meanwhile fails the restore (23505)
    update hq.projects set deleted_at = null, version = version + 1 where id = p_id;
  else
    -- a unique name, email, ABN, primary contact, address, Ailo reference or knowledge title that was
    -- taken meanwhile fails the restore (23505); a decision superseded by an archived decision is
    -- refused (restore that one first); a managed property whose opportunity is no longer signed and
    -- live is refused (23514)
    execute format('update hq.%I set deleted_at = null where id = $1', v_table) using p_id;
  end if;
  if p_entity = 'decision' then
    perform hq_private.decision_history_write(p_id, 'restore', 'Restored');
  elsif p_entity = 'meeting' then
    perform hq_private.meeting_history_write(v_mtg, 'restore', 'Restored');
    perform hq_private.meeting_sync_touchpoints(p_id);
  elsif p_entity = 'project' then
    perform hq_private.project_activity_write(p_id, 'restored', 'Restored', '{}'::jsonb);
  end if;
  return jsonb_build_object('entity', p_entity, 'id', p_id, 'archived', false, 'changed', true);
end $$;
comment on function hq.restore_record(text, uuid) is 'Restores a soft-deleted record: growth.delete for the Phase 1 entities, contractors.approve for contractor and contractor_review, contractors.documents for contractor_document, decisions.write for decision, portfolio.write for managed_property (refused when its opportunity is no longer signed and live), knowledge.approve for knowledge_document (refused when another live document took its title), meetings.write for meeting (one the caller can see; its touch points are logged again), projects.write for project (refused, 23505, when a live project took its name). A restored referral takes attribution back only when the opportunity has none.';

revoke execute on all functions in schema hq_private from public, anon;
revoke execute on all functions in schema hq from public, anon;
